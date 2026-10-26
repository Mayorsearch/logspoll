import { adminActor, bodyJSON } from './admin.ts'
import { HttpError, json } from './http.ts'
import { HttpError as CredentialError } from '../../server/auth.ts'
import { openCredential, sealCredential } from '../../server/supplier-crypto.ts'
import {
  DigitalCoreError,
  fetchDigitalCoreProfile,
  fetchDigitalCoreProducts,
  normalizeDigitalCoreCatalog,
  DIGITALCORE_DEFAULT_BASE_URL,
} from '../../server/digitalcore.ts'
import { calculateSellingPrice } from '../../server/pricing.ts'
import type { ApiEnv, Statement, Database } from './types.ts'

type Connection = {
  id: string
  enabled: number
  ciphertext: string
  nonce: string
  revision: number
  requested: number
  job_id: string | null
  page: number
  phase: string
  total: number | null
  scanned: number
  next_attempt: number
  last_success: number | null
  last_status: string
  base_url: string
  lease_owner?: string | null
  lease_until?: number | null
}

export async function digitalcoreAdmin(request: Request, env: ApiEnv) {
  const actor = await adminActor(request, env)
  const db = env.DB!

  if (request.method === 'GET') {
    const conn = await db
      .prepare(
        `SELECT enabled, revision, requested, page, phase, total, scanned, next_attempt, last_success, last_status, lease_until, base_url,
          (SELECT count(*) FROM digitalcore_catalog_items) AS imported,
          (SELECT count(*) FROM digitalcore_catalog_items WHERE approval_status='approved') AS approved,
          (SELECT count(*) FROM digitalcore_catalog_items WHERE stock > 0) AS in_stock
         FROM digitalcore_connection WHERE id='digitalcore'`
      )
      .first()
      .catch(() => null)
    return json({ provider: 'digitalcore', connection: conn })
  }

  if (request.method !== 'POST') throw new HttpError(405, 'Method not permitted.')
  const body = await bodyJSON(request, 8192)
  const row = await db.prepare("SELECT * FROM digitalcore_connection WHERE id='digitalcore'").first<Connection>()

  if (body.action === 'save') {
    const baseUrl =
      typeof body.base_url === 'string' && body.base_url.trim()
        ? body.base_url.trim().replace(/\/+$/, '')
        : DIGITALCORE_DEFAULT_BASE_URL
    if (!baseUrl.startsWith('https://') && !baseUrl.startsWith('http://localhost')) {
      throw new HttpError(400, 'Base URL must use HTTPS.')
    }

    if (body.api_key !== undefined) {
      if (typeof body.api_key !== 'string' || !body.api_key.trim()) {
        throw new HttpError(400, 'Enter a valid DigitalCore API key.')
      }
      const rawCreds = {
        apiKey: body.api_key.trim(),
        baseUrl,
      }
      let sealed: Awaited<ReturnType<typeof sealCredential>>
      try {
        sealed = await sealCredential(JSON.stringify(rawCreds), 'digitalcore', env.SUPPLIER_ENCRYPTION_KEY)
      } catch (err) {
        if (err instanceof CredentialError) throw new HttpError(err.status, err.message)
        throw err
      }

      await db
        .prepare(
          `INSERT INTO digitalcore_connection(id, ciphertext, nonce, enabled, base_url)
           VALUES('digitalcore', ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             ciphertext=excluded.ciphertext,
             nonce=excluded.nonce,
             enabled=excluded.enabled,
             base_url=excluded.base_url,
             revision=revision+1,
             lease_owner=NULL,
             lease_until=NULL,
             requested=0,
             phase='idle',
             job_id=NULL,
             last_status='Credentials replaced; test connection'`
        )
        .bind(sealed.ciphertext, sealed.nonce, body.enabled ? 1 : 0, baseUrl)
        .run()

      return json({
        ok: true,
        message: 'DigitalCore API credentials stored encrypted in Cloudflare D1.',
      })
    }

    if (body.enabled !== undefined) {
      await db
        .prepare(
          `UPDATE digitalcore_connection SET enabled=?, base_url=?, lease_owner=NULL, lease_until=NULL WHERE id='digitalcore'`
        )
        .bind(body.enabled ? 1 : 0, baseUrl)
        .run()
      return json({
        ok: true,
        message: `DigitalCore ${body.enabled ? 'enabled' : 'disabled'}.`,
      })
    }

    throw new HttpError(400, 'Nothing to save.')
  }

  if (body.action === 'toggle') {
    if (!row) throw new HttpError(400, 'Configure DigitalCore credentials first.')
    const nextState = row.enabled === 1 ? 0 : 1
    await db
      .prepare(`UPDATE digitalcore_connection SET enabled=?, lease_owner=NULL, lease_until=NULL WHERE id='digitalcore'`)
      .bind(nextState)
      .run()
    return json({ ok: true, enabled: nextState })
  }

  if (body.action === 'test') {
    if (!row) throw new HttpError(409, 'Configure DigitalCore credentials first.')
    let creds: { apiKey: string; baseUrl?: string }
    try {
      creds = JSON.parse(
        await openCredential(row.ciphertext, row.nonce, 'digitalcore', env.SUPPLIER_ENCRYPTION_KEY)
      )
    } catch {
      throw new HttpError(400, 'DigitalCore credential decryption failed.')
    }

    try {
      const profile = await fetchDigitalCoreProfile({
        apiKey: creds.apiKey,
        baseUrl: creds.baseUrl || row.base_url || DIGITALCORE_DEFAULT_BASE_URL,
      })

      const now = Date.now()
      const statusMsg = profile.message || `Connected to DigitalCore successfully. Balance: $${Number(profile.balance ?? 0).toFixed(2)} USD`
      await db
        .prepare("UPDATE digitalcore_connection SET last_status=?, last_success=? WHERE id='digitalcore'")
        .bind(statusMsg, now)
        .run()

      return json({
        ok: true,
        connected: true,
        message: statusMsg,
        profile: {
          balance: profile.balance,
          total_orders: profile.totalOrders,
        },
      })
    } catch (error) {
      const msg =
        error instanceof DigitalCoreError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'DigitalCore connection test failed.'
      const status = error instanceof DigitalCoreError ? error.status : 502
      await db
        .prepare("UPDATE digitalcore_connection SET last_status=? WHERE id='digitalcore'")
        .bind(`Test failed: ${msg.slice(0, 400)}`)
        .run()
      throw new HttpError(status, msg)
    }
  }

  if (body.action === 'sync') {
    if (!row) throw new HttpError(409, 'Configure DigitalCore credentials first.')
    if (!row.enabled) throw new HttpError(409, 'Enable DigitalCore first.')

    await db.prepare("UPDATE digitalcore_connection SET requested=1 WHERE id='digitalcore'").run()

    // Trigger immediate batch sync
    await syncDigitalCoreBatch(env).catch(() => {})

    return json({
      ok: true,
      message: 'Background synchronization queued for DigitalCore (Server 4).',
    })
  }

  throw new HttpError(400, 'Unsupported action.')
}

export async function syncDigitalCoreBatch(env: ApiEnv) {
  if (env.CATALOG_SYNC_ENABLED !== 'true' || !env.DB) return
  const db = env.DB,
    now = Date.now(),
    owner = crypto.randomUUID()

  const row = await db
    .prepare(
      `UPDATE digitalcore_connection SET lease_owner=?, lease_until=?
       WHERE id='digitalcore' AND enabled=1 AND next_attempt<=?
         AND (requested=1 OR last_success IS NULL OR last_success<=?)
         AND (lease_until IS NULL OR lease_until<=?)
       RETURNING *`
    )
    .bind(owner, now + 60000, now, now - 43200000, now)
    .first<Connection>()
    .catch(() => null)

  if (!row) return

  const fence = () =>
    db
      .prepare(
        `INSERT INTO shopviaclone22_sync_fences(owner, valid)
         SELECT ?, CASE WHEN EXISTS(
           SELECT 1 FROM digitalcore_connection
           WHERE id='digitalcore' AND enabled=1 AND revision=? AND lease_owner=? AND lease_until>?
         ) THEN 1 ELSE 0 END`
      )
      .bind(owner, row.revision, owner, Date.now())

  async function commit(statements: Statement[]) {
    await db.batch([
      fence(),
      ...statements,
      db.prepare('DELETE FROM shopviaclone22_sync_fences WHERE owner=?').bind(owner),
      db
        .prepare("UPDATE digitalcore_connection SET lease_owner=NULL, lease_until=NULL WHERE id='digitalcore' AND lease_owner=?")
        .bind(owner),
    ])
  }

  try {
    const creds = JSON.parse(
      await openCredential(row.ciphertext, row.nonce, 'digitalcore', env.SUPPLIER_ENCRYPTION_KEY)
    ) as { apiKey: string; baseUrl?: string }

    const globalCfg = await db
      .prepare(
        "SELECT markup_bps, auto_publish, automatic_pricing, auto_approve, usd_to_ngn_rate, fx_override_active, fx_override_rate FROM global_pricing_config WHERE id='global'"
      )
      .first<{
        markup_bps: number
        auto_publish: number
        automatic_pricing: number
        auto_approve: number
        usd_to_ngn_rate?: number
        fx_override_active?: number
        fx_override_rate?: number
      }>()
      .catch(() => null)

    const effectiveFxRate =
      globalCfg?.fx_override_active === 1 && Number(globalCfg?.fx_override_rate) > 0
        ? Number(globalCfg?.fx_override_rate)
        : Number(globalCfg?.usd_to_ngn_rate) > 0
          ? Number(globalCfg?.usd_to_ngn_rate)
          : 1500.0

    const dcorePolicy = await db
      .prepare("SELECT markup_bps, updated_by FROM supplier_automation WHERE provider='digitalcore'")
      .first<{ markup_bps: number; updated_by?: string }>()
      .catch(() => null)
    const defaultMarkup = dcorePolicy?.markup_bps && dcorePolicy.markup_bps > 0 ? dcorePolicy.markup_bps : 7000
    const autoPublish = globalCfg?.auto_publish === 1
    const autoApprove = globalCfg?.auto_approve === 1
    const auditActor = dcorePolicy?.updated_by

    const defaultCat = (
      await db.prepare("SELECT id FROM categories WHERE slug='server4' OR slug='ai-tools' OR active=1 ORDER BY CASE WHEN slug='server4' THEN 0 ELSE 1 END LIMIT 1").first<{ id: string }>()
    )?.id

    // DigitalCore dynamic catalog request
    const rawData = await fetchDigitalCoreProducts({
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl || row.base_url || DIGITALCORE_DEFAULT_BASE_URL,
    })

    const { products } = normalizeDigitalCoreCatalog(rawData, effectiveFxRate)

    const existingItems = new Map(
      (
        await db
          .prepare('SELECT external_id, approval_status, product_id FROM digitalcore_catalog_items')
          .all<{ external_id: string; approval_status: string; product_id: string | null }>()
      ).results.map((r) => [r.external_id, r])
    )

    const jobId = crypto.randomUUID()
    const writes: Statement[] = []

    for (const item of products) {
      const price = calculateSellingPrice(item.costMinor, {
        id: 'markup',
        enabled: true,
        mode: 'markup',
        rateBps: defaultMarkup,
        fixedMinor: 0,
        minProfitMinor: 0,
        feeBps: 0,
        feeFixedMinor: 0,
        fxBufferBps: 0,
        roundingMinor: 1,
      }).sellingPriceMinor

      const slug = `s4-${item.id}`
      const existing = existingItems.get(item.id)
      const isAlreadyApproved = existing?.approval_status === 'approved'

      // Safeguard 1: Automatic approval strictly requires autoApprove to be enabled.
      const canAutoApprove = autoApprove && item.stock > 0
      const finalApprovalStatus = isAlreadyApproved ? 'approved' : (canAutoApprove ? 'approved' : 'pending')

      writes.push(
        db
          .prepare(
            `INSERT INTO digitalcore_catalog_items(external_id, category_id, name, description, plan_options, cost_minor, stock, raw_metadata, snapshot_id, checked_at, selling_price_minor, approval_status)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(external_id) DO UPDATE SET
               name=excluded.name,
               description=excluded.description,
               plan_options=excluded.plan_options,
               cost_minor=excluded.cost_minor,
               stock=excluded.stock,
               raw_metadata=excluded.raw_metadata,
               snapshot_id=excluded.snapshot_id,
               checked_at=excluded.checked_at,
               selling_price_minor=excluded.selling_price_minor,
               approval_status=CASE WHEN excluded.approval_status='approved' THEN 'approved' ELSE digitalcore_catalog_items.approval_status END
             WHERE digitalcore_catalog_items.cost_minor != excluded.cost_minor
                OR digitalcore_catalog_items.stock != excluded.stock
                OR digitalcore_catalog_items.name != excluded.name
                OR digitalcore_catalog_items.description != excluded.description
                OR digitalcore_catalog_items.selling_price_minor != excluded.selling_price_minor
                OR (excluded.approval_status='approved' AND digitalcore_catalog_items.approval_status != 'approved')
                OR digitalcore_catalog_items.checked_at <= (? - 86400000)`
          )
          .bind(
            item.id,
            defaultCat ?? null,
            item.name,
            item.description,
            JSON.stringify(item.tiers),
            item.costMinor,
            item.stock,
            JSON.stringify(item.raw),
            jobId,
            now,
            price,
            finalApprovalStatus,
            now
          )
      )

      // Safeguard 2: Storefront publication strictly requires autoPublish
      // AND requires the product to be legitimately approved (already approved or qualified for auto-approval).
      const canPublish = autoPublish && (isAlreadyApproved || canAutoApprove) && item.stock > 0

      if (canPublish) {
        const logo = typeof item.raw?.logo === 'string' ? item.raw.logo : ''
        const logoArray = logo ? JSON.stringify([logo]) : '[]'
        const term = typeof item.raw?.warranty === 'string' ? item.raw.warranty : ''
        const delivery = typeof item.raw?.type === 'string' ? item.raw.type : 'Subscription activation'
        const featuresList: string[] = []
        if (item.raw?.type) featuresList.push(`Type: ${item.raw.type}`)
        if (item.raw?.warranty) featuresList.push(`Warranty: ${item.raw.warranty}`)
        if (item.raw?.region) featuresList.push(`Region: ${item.raw.region}`)
        if (Array.isArray(item.tiers)) {
          for (const t of item.tiers) {
            const range = t.maxQty ? `${t.minQty}–${t.maxQty}` : `${t.minQty}+`
            featuresList.push(`Tier (${range} units): $${t.price.toFixed(2)} USD`)
          }
        }
        const featuresJson = JSON.stringify(featuresList)

        writes.push(
          db
            .prepare(
              `INSERT INTO products(id, category_id, slug, name, description, price_minor, supplier_name, authorized_resale, status, delivery_type, term, features, supplier_image_urls, pricing_mode, publication_verified, server_number)
               VALUES(?, ?, ?, ?, ?, ?, 'DigitalCore', 1, 'active', ?, ?, ?, ?, 'auto', 1, 4)
               ON CONFLICT(slug) DO UPDATE SET
                 status='active',
                 publication_verified=1,
                 authorized_resale=1,
                 price_minor=CASE WHEN pricing_mode='override' THEN products.price_minor ELSE excluded.price_minor END,
                 category_id=excluded.category_id,
                 term=excluded.term,
                 features=excluded.features,
                 supplier_image_urls=excluded.supplier_image_urls,
                 delivery_type=excluded.delivery_type
               WHERE products.status != 'active'
                  OR products.category_id IS NOT excluded.category_id
                  OR (products.pricing_mode = 'auto' AND products.price_minor != excluded.price_minor)
                  OR products.name != excluded.name
                  OR products.description != excluded.description`
            )
            .bind(
              crypto.randomUUID(),
              defaultCat ?? null,
              slug,
              item.name.slice(0, 200),
              item.description.slice(0, 10000),
              price,
              delivery,
              term,
              featuresJson,
              logoArray
            ),
          db
            .prepare(
              `UPDATE digitalcore_catalog_items
               SET product_id=(SELECT id FROM products WHERE slug=?), reviewed_at=COALESCE(reviewed_at, ?)
               WHERE external_id=? AND product_id IS NULL`
            )
            .bind(slug, now, item.id)
        )

        if (auditActor) {
          writes.push(
            db
              .prepare(
                `INSERT INTO product_authorizations(product_id, evidence, reviewer_id, verified_at)
                 SELECT id, ?, ?, ? FROM products WHERE slug=?
                 ON CONFLICT(product_id) DO NOTHING`
              )
              .bind(JSON.stringify({ delivery: true, privacy: true, provider: true, reference: 'DigitalCore authorized supplier' }), auditActor, now, slug)
          )
        }
      }
    }

    // Mark delisted items as out of stock
    writes.push(
      db.prepare(
        `UPDATE digitalcore_catalog_items
         SET stock=0, checked_at=?
         WHERE snapshot_id != ? AND stock > 0`
      ).bind(now, jobId)
    )

    writes.push(
      db
        .prepare(
          `UPDATE digitalcore_connection
           SET phase='complete', total=?, scanned=?, last_success=?, last_status='Catalog synchronized', requested=0
           WHERE id='digitalcore'`
        )
        .bind(products.length, products.length, now)
    )

    await commit(writes)
  } catch (error) {
    const rawMsg =
      error instanceof DigitalCoreError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'DigitalCore sync failed.'
    const message = rawMsg.replace(/api_key=[^&\s]+/gi, 'api_key=[REDACTED]')
    await db
      .prepare(
        `UPDATE digitalcore_connection
         SET last_status=?, next_attempt=?, lease_owner=NULL, lease_until=NULL
         WHERE id='digitalcore' AND revision=? AND lease_owner=?`
      )
      .bind(message.slice(0, 500), Date.now() + 60000, row.revision, owner)
      .run()
  }
}

export async function bulkPublishDigitalCore(
  db: Database,
  markup_bps: number,
  usdRate: number,
  actorId: string,
  restore_overrides = false
): Promise<number> {
  const now = Date.now()
  const defaultCat = (
    await db
      .prepare(
        "SELECT id FROM categories WHERE slug='server4' OR active=1 ORDER BY CASE WHEN slug='server4' THEN 0 ELSE 1 END LIMIT 1"
      )
      .first<{ id: string }>()
  )?.id
  const dcorePolicy = await db
    .prepare("SELECT markup_bps FROM supplier_automation WHERE provider='digitalcore'")
    .first<{ markup_bps: number }>()
    .catch(() => null)
  const markup = markup_bps > 0 ? markup_bps : (dcorePolicy?.markup_bps && dcorePolicy.markup_bps > 0 ? dcorePolicy.markup_bps : 7000)

  const s4Writes: Statement[] = [
    db.prepare(
      `UPDATE digitalcore_catalog_items
       SET
         cost_minor = CAST(ROUND(CAST(json_extract(raw_metadata, '$.price') AS REAL) * ? * 100.0) AS INTEGER),
         selling_price_minor = CAST(ROUND(
           (CASE WHEN cost_minor > 0 THEN cost_minor ELSE CAST(ROUND(CAST(json_extract(raw_metadata, '$.price') AS REAL) * ? * 100.0) AS INTEGER) END) * (1.0 + ? / 10000.0)
         ) AS INTEGER),
         approval_status = 'approved',
         category_id = COALESCE(category_id, ?)
       WHERE stock > 0 AND approval_status <> 'approved'`
    ).bind(usdRate, usdRate, markup, defaultCat ?? null),
    db.prepare(
      `INSERT INTO products(
         id, category_id, slug, name, description, price_minor, supplier_name, authorized_resale, status, delivery_type, supplier_image_urls, pricing_mode, publication_verified, server_number
       )
       SELECT
         COALESCE(s4.product_id, lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
         s4.category_id,
         's4-' || s4.external_id,
         substr(s4.name, 1, 200),
         substr(COALESCE(s4.description, 'DigitalCore authorized AI tool subscription'), 1, 10000),
         s4.selling_price_minor,
         'DigitalCore',
         1,
         'active',
         'Subscription activation',
         '[]',
         ${restore_overrides ? "'auto'" : "CASE WHEN s4.product_id IS NOT NULL AND (SELECT pricing_mode FROM products WHERE id=s4.product_id)='override' THEN 'override' ELSE 'auto' END"},
         1,
         4
       FROM digitalcore_catalog_items s4
       WHERE s4.approval_status = 'approved' AND s4.selling_price_minor > 0
       ON CONFLICT(slug) DO UPDATE SET
         status = 'active',
         publication_verified = 1,
         authorized_resale = 1,
         price_minor = ${restore_overrides ? 'excluded.price_minor' : "CASE WHEN products.pricing_mode='override' THEN products.price_minor ELSE excluded.price_minor END"},
         pricing_mode = ${restore_overrides ? "'auto'" : 'products.pricing_mode'},
         category_id = excluded.category_id`
    ),
    db.prepare(
      `UPDATE digitalcore_catalog_items
       SET product_id = (SELECT p.id FROM products p WHERE p.slug = 's4-' || digitalcore_catalog_items.external_id)
       WHERE approval_status = 'approved'`
    ),
    db.prepare(
      `INSERT INTO product_authorizations(product_id, evidence, reviewer_id, verified_at)
       SELECT
         p.id,
         json_object('delivery', 1, 'privacy', 1, 'provider', 1, 'reference', 'DigitalCore authorized provider'),
         ?,
         ?
       FROM products p
       WHERE p.server_number = 4
       ON CONFLICT(product_id) DO UPDATE SET verified_at = excluded.verified_at`
    ).bind(actorId, now),
  ]
  await db.batch(s4Writes)
  return (
    (await db.prepare("SELECT count(*) n FROM digitalcore_catalog_items WHERE approval_status='approved'").first<{ n: number }>())?.n ?? 0
  )
}

