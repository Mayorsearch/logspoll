import { adminActor, bodyJSON } from './admin.ts'
import { HttpError, json } from './http.ts'
import { HttpError as CredentialError } from '../../server/auth.ts'
import { openCredential, sealCredential } from '../../server/supplier-crypto.ts'
import {
  DigitalTopError,
  fetchDigitalTopProfile,
  normalizeDigitalTopCatalog,
  DIGITALTOP_DEFAULT_BASE_URL,
} from '../../server/digitaltop.ts'
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

export async function digitaltopAdmin(request: Request, env: ApiEnv) {
  const actor = await adminActor(request, env)
  const db = env.DB!

  if (request.method === 'GET') {
    const conn = await db
      .prepare(
        `SELECT enabled, revision, requested, page, phase, total, scanned, next_attempt, last_success, last_status, lease_until, base_url,
          (SELECT count(*) FROM digitaltop_catalog_items) AS imported,
          (SELECT count(*) FROM digitaltop_catalog_items WHERE approval_status='approved') AS approved,
          (SELECT count(*) FROM digitaltop_catalog_items WHERE stock > 0) AS in_stock
         FROM digitaltop_connection WHERE id='digitaltop'`
      )
      .first()
    return json({ provider: 'digitaltop', connection: conn })
  }

  if (request.method !== 'POST') throw new HttpError(405, 'Method not permitted.')
  const body = await bodyJSON(request, 8192)
  const row = await db.prepare("SELECT * FROM digitaltop_connection WHERE id='digitaltop'").first<Connection>()

  if (body.action === 'save') {
    const baseUrl =
      typeof body.base_url === 'string' && body.base_url.trim()
        ? body.base_url.trim().replace(/\/+$/, '')
        : DIGITALTOP_DEFAULT_BASE_URL
    if (!baseUrl.startsWith('https://') && !baseUrl.startsWith('http://localhost')) {
      throw new HttpError(400, 'Base URL must use HTTPS.')
    }

    if (body.api_key !== undefined) {
      if (typeof body.api_key !== 'string' || !body.api_key.trim()) {
        throw new HttpError(400, 'Enter a valid DigitalTop API key.')
      }
      const rawCreds = {
        apiKey: body.api_key.trim(),
        apiSecret: typeof body.api_secret === 'string' ? body.api_secret.trim() : undefined,
        baseUrl,
      }
      let sealed: Awaited<ReturnType<typeof sealCredential>>
      try {
        sealed = await sealCredential(JSON.stringify(rawCreds), 'digitaltop', env.SUPPLIER_ENCRYPTION_KEY)
      } catch (err) {
        if (err instanceof CredentialError) throw new HttpError(err.status, err.message)
        throw err
      }

      await db
        .prepare(
          `INSERT INTO digitaltop_connection(id, ciphertext, nonce, enabled, base_url)
           VALUES('digitaltop', ?, ?, ?, ?)
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

      return json({ saved: true })
    }

    if (!row) throw new HttpError(400, 'Configure API key first.')

    const enabledVal = typeof body.enabled === 'boolean' ? (body.enabled ? 1 : 0) : row.enabled
    await db
      .prepare(
        `UPDATE digitaltop_connection SET enabled=?, base_url=?, lease_owner=NULL, lease_until=NULL WHERE id='digitaltop'`
      )
      .bind(enabledVal, baseUrl)
      .run()

    return json({ saved: true })
  }

  if (body.action === 'toggle') {
    if (!row) throw new HttpError(400, 'Configure DigitalTop credentials first.')
    const nextEnabled = row.enabled ? 0 : 1
    await db
      .prepare(`UPDATE digitaltop_connection SET enabled=?, lease_owner=NULL, lease_until=NULL WHERE id='digitaltop'`)
      .bind(nextEnabled)
      .run()
    return json({ saved: true, enabled: Boolean(nextEnabled) })
  }

  if (body.action === 'test') {
    if (!row) throw new HttpError(409, 'Configure DigitalTop credentials first.')
    try {
      const creds = JSON.parse(
        await openCredential(row.ciphertext, row.nonce, 'digitaltop', env.SUPPLIER_ENCRYPTION_KEY)
      ) as { apiKey: string; apiSecret?: string; baseUrl?: string }

      const profile = await fetchDigitalTopProfile({
        apiKey: creds.apiKey,
        apiSecret: creds.apiSecret,
        baseUrl: row.base_url,
      })

      if (profile.connected === false) {
        const statusMsg = profile.message || 'DigitalTop documentation and endpoint specifications pending.'
        await db
          .prepare("UPDATE digitaltop_connection SET last_status=? WHERE id='digitaltop'")
          .bind(statusMsg)
          .run()
          .catch(() => {})
        return json({ connected: false, error: statusMsg, layer: 'supplier', pendingDocumentation: true }, 200)
      }

      const statusMsg = `Connected: ${profile.username || 'Verified AI Tools Merchant'}`
      await db
        .prepare("UPDATE digitaltop_connection SET last_status=?, last_success=? WHERE id='digitaltop'")
        .bind(statusMsg, Date.now())
        .run()
        .catch(() => {})

      return json({
        connected: true,
        message: statusMsg,
        username: profile.username,
        balance: profile.balance,
      })
    } catch (error) {
      const rawMsg =
        error instanceof DigitalTopError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'DigitalTop connection test failed.'
      const message = rawMsg.replace(/api_key=[^&\s]+/gi, 'api_key=[REDACTED]')
      const status = error instanceof DigitalTopError ? error.status : 502

      await db
        .prepare("UPDATE digitaltop_connection SET last_status=? WHERE id='digitaltop'")
        .bind(message.slice(0, 500))
        .run()
        .catch(() => {})

      return json({ connected: false, error: message, layer: 'supplier', provider_status: status }, 200)
    }
  }

  if (body.action === 'sync') {
    if (!row) throw new HttpError(409, 'Configure DigitalTop credentials first.')
    if (!row.enabled) throw new HttpError(409, 'Enable DigitalTop first.')
    await db.prepare("UPDATE digitaltop_connection SET requested=1 WHERE id='digitaltop'").run()
    return json(
      {
        queued: true,
        phase: row.phase,
        message: 'Background synchronization queued for DigitalTop (Server 4).',
      },
      202
    )
  }

  throw new HttpError(400, 'Unknown supplier action.')
}

export async function syncDigitalTopBatch(env: ApiEnv) {
  if (env.CATALOG_SYNC_ENABLED !== 'true' || !env.DB) return
  const db = env.DB,
    now = Date.now(),
    owner = crypto.randomUUID()

  const row = await db
    .prepare(
      `UPDATE digitaltop_connection SET lease_owner=?, lease_until=?
       WHERE id='digitaltop' AND enabled=1 AND next_attempt<=?
         AND (requested=1 OR last_success IS NULL OR last_success<=?)
         AND (lease_until IS NULL OR lease_until<=?)
       RETURNING *`
    )
    .bind(owner, now + 60000, now, now - 43200000, now)
    .first<Connection>()

  if (!row) return

  const fence = () =>
    db
      .prepare(
        `INSERT INTO shopviaclone22_sync_fences(owner, valid)
         SELECT ?, CASE WHEN EXISTS(
           SELECT 1 FROM digitaltop_connection
           WHERE id='digitaltop' AND enabled=1 AND revision=? AND lease_owner=? AND lease_until>?
         ) THEN 1 ELSE 0 END`
      )
      .bind(owner, row.revision, owner, Date.now())

  async function commit(statements: Statement[]) {
    await db.batch([
      fence(),
      ...statements,
      db.prepare('DELETE FROM shopviaclone22_sync_fences WHERE owner=?').bind(owner),
      db
        .prepare("UPDATE digitaltop_connection SET lease_owner=NULL, lease_until=NULL WHERE id='digitaltop' AND lease_owner=?")
        .bind(owner),
    ])
  }

  try {
    const creds = JSON.parse(
      await openCredential(row.ciphertext, row.nonce, 'digitaltop', env.SUPPLIER_ENCRYPTION_KEY)
    ) as { apiKey: string; apiSecret?: string; baseUrl?: string }

    if (row.base_url.includes('.core') || row.base_url.includes('placeholder')) {
      await db
        .prepare(
          "UPDATE digitaltop_connection SET last_status='Sync paused: waiting for official supplier documentation', requested=0, lease_owner=NULL, lease_until=NULL WHERE id='digitaltop'"
        )
        .run()
      return
    }

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

    const defaultMarkup = globalCfg?.markup_bps ?? 5000
    const autoPublish = globalCfg?.auto_publish === 1
    const autoApprove = globalCfg?.auto_approve === 1

    const defaultCat = (
      await db.prepare("SELECT id FROM categories WHERE slug='server4' OR slug='ai-tools' OR active=1 ORDER BY CASE WHEN slug='server4' THEN 0 ELSE 1 END LIMIT 1").first<{ id: string }>()
    )?.id

    // DigitalTop dynamic catalog request
    const response = await fetch(`${row.base_url}/catalog`, {
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LogsPoll/2.0',
      },
      signal: AbortSignal.timeout(20000),
    })

    if (!response.ok) {
      throw new DigitalTopError(`DigitalTop catalog fetch returned HTTP ${response.status}`, response.status)
    }

    const rawData = await response.json()
    const { products } = normalizeDigitalTopCatalog(rawData, effectiveFxRate)

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
      writes.push(
        db
          .prepare(
            `INSERT INTO digitaltop_catalog_items(external_id, category_id, name, description, plan_options, cost_minor, stock, raw_metadata, snapshot_id, checked_at, selling_price_minor)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(external_id) DO UPDATE SET
               name=excluded.name,
               description=excluded.description,
               plan_options=excluded.plan_options,
               cost_minor=excluded.cost_minor,
               stock=excluded.stock,
               raw_metadata=excluded.raw_metadata,
               snapshot_id=excluded.snapshot_id,
               checked_at=excluded.checked_at,
               selling_price_minor=excluded.selling_price_minor`
          )
          .bind(
            item.id,
            defaultCat ?? null,
            item.name,
            item.description,
            JSON.stringify(item.plans),
            item.costMinor,
            item.stock,
            JSON.stringify(item.raw),
            jobId,
            now,
            price
          )
      )

      if ((autoApprove || autoPublish) && item.stock > 0) {
        writes.push(
          db
            .prepare(
              `INSERT INTO products(id, category_id, slug, name, description, price_minor, supplier_name, authorized_resale, status, delivery_type, supplier_image_urls, pricing_mode, publication_verified, server_number)
               VALUES(?, ?, ?, ?, ?, ?, 'DigitalTop', 1, 'active', 'Subscription activation', '[]', 'auto', 1, 4)
               ON CONFLICT(slug) DO UPDATE SET
                 status='active',
                 publication_verified=1,
                 authorized_resale=1,
                 price_minor=CASE WHEN pricing_mode='override' THEN products.price_minor ELSE excluded.price_minor END,
                 category_id=excluded.category_id`
            )
            .bind(
              crypto.randomUUID(),
              defaultCat ?? null,
              slug,
              item.name.slice(0, 200),
              item.description.slice(0, 10000),
              price
            ),
          db
            .prepare(
              `UPDATE digitaltop_catalog_items
               SET approval_status='approved', product_id=(SELECT id FROM products WHERE slug=?), reviewed_at=?
               WHERE external_id=?`
            )
            .bind(slug, now, item.id)
        )
      }
    }

    writes.push(
      db
        .prepare(
          `UPDATE digitaltop_connection
           SET phase='complete', total=?, scanned=?, last_success=?, last_status='Catalog synchronized', requested=0
           WHERE id='digitaltop'`
        )
        .bind(products.length, products.length, now)
    )

    await commit(writes)
  } catch (error) {
    const rawMsg =
      error instanceof DigitalTopError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'DigitalTop sync failed.'
    const message = rawMsg.replace(/api_key=[^&\s]+/gi, 'api_key=[REDACTED]')
    await db
      .prepare(
        `UPDATE digitaltop_connection
         SET last_status=?, next_attempt=?, lease_owner=NULL, lease_until=NULL
         WHERE id='digitaltop' AND revision=? AND lease_owner=?`
      )
      .bind(message.slice(0, 500), Date.now() + 60000, row.revision, owner)
      .run()
  }
}

export async function bulkPublishDigitalTop(
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
  const markup = markup_bps > 0 ? markup_bps : 5000

  const s4Writes: Statement[] = [
    db.prepare(
      `UPDATE digitaltop_catalog_items
       SET
         cost_minor = CAST(ROUND(CAST(json_extract(raw_metadata, '$.price_usd') AS REAL) * ? * 100.0) AS INTEGER),
         selling_price_minor = CAST(ROUND(
           (CASE WHEN cost_minor > 0 THEN cost_minor ELSE CAST(ROUND(CAST(json_extract(raw_metadata, '$.price_usd') AS REAL) * ? * 100.0) AS INTEGER) END) * (1.0 + ? / 10000.0)
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
         substr(COALESCE(s4.description, 'DigitalTop authorized AI tool subscription'), 1, 10000),
         s4.selling_price_minor,
         'DigitalTop',
         1,
         'active',
         'Subscription activation',
         '[]',
         ${restore_overrides ? "'auto'" : "CASE WHEN s4.product_id IS NOT NULL AND (SELECT pricing_mode FROM products WHERE id=s4.product_id)='override' THEN 'override' ELSE 'auto' END"},
         1,
         4
       FROM digitaltop_catalog_items s4
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
      `UPDATE digitaltop_catalog_items
       SET product_id = (SELECT p.id FROM products p WHERE p.slug = 's4-' || digitaltop_catalog_items.external_id)
       WHERE approval_status = 'approved'`
    ),
    db.prepare(
      `INSERT INTO product_authorizations(product_id, evidence, reviewer_id, verified_at)
       SELECT
         p.id,
         json_object('delivery', 1, 'privacy', 1, 'provider', 1, 'reference', 'DigitalTop authorized provider'),
         ?,
         ?
       FROM products p
       WHERE p.server_number = 4
       ON CONFLICT(product_id) DO UPDATE SET verified_at = excluded.verified_at`
    ).bind(actorId, now),
  ]
  await db.batch(s4Writes)
  return (
    (await db.prepare("SELECT count(*) n FROM digitaltop_catalog_items WHERE approval_status='approved'").first<{ n: number }>())?.n ?? 0
  )
}

