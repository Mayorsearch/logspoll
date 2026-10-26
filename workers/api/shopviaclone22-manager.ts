import { adminActor, bodyJSON } from './admin.ts'
import { HttpError, json } from './http.ts'
import { HttpError as CredentialError } from '../../server/auth.ts'
import { openCredential, sealCredential } from '../../server/supplier-crypto.ts'
import {
  ShopViaError,
  fetchShopViaProfile,
  fetchShopViaCatalog,
  normalizeShopViaCatalog,
  type NormalizedProduct,
} from '../../server/shopviaclone22.ts'
import { calculateSellingPrice } from '../../server/pricing.ts'
import type { ApiEnv, Statement } from './types.ts'

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

export async function shopviaclone22Admin(request: Request, env: ApiEnv) {
  const actor = await adminActor(request, env)
  const db = env.DB!

  if (request.method === 'GET') {
    const conn = await db
      .prepare(
        `SELECT enabled, revision, requested, page, phase, total, scanned, next_attempt, last_success, last_status, lease_until, base_url,
          (SELECT count(*) FROM shopviaclone22_catalog_items) AS imported,
          (SELECT count(*) FROM shopviaclone22_catalog_items WHERE approval_status='approved') AS approved,
          (SELECT count(*) FROM shopviaclone22_catalog_items WHERE stock > 0) AS in_stock
         FROM shopviaclone22_connection WHERE id='shopviaclone22'`
      )
      .first()
    return json({ provider: 'shopviaclone22', connection: conn })
  }

  if (request.method !== 'POST') throw new HttpError(405, 'Method not permitted.')
  const body = await bodyJSON(request, 8192)
  const row = await db.prepare("SELECT * FROM shopviaclone22_connection WHERE id='shopviaclone22'").first<Connection>()

  if (body.action === 'save') {
    const baseUrl = typeof body.base_url === 'string' && body.base_url.trim() ? body.base_url.trim().replace(/\/+$/, '') : 'https://shopviaclone22.com/api'
    if (!baseUrl.startsWith('https://') && !baseUrl.startsWith('http://localhost')) {
      throw new HttpError(400, 'Base URL must use HTTPS.')
    }

    if (body.api_key !== undefined) {
      if (typeof body.api_key !== 'string' || !body.api_key.trim()) {
        throw new HttpError(400, 'Enter a valid ShopViaClone22 API key.')
      }
      const rawKey = body.api_key.trim()
      let sealed: Awaited<ReturnType<typeof sealCredential>>
      try {
        sealed = await sealCredential(rawKey, 'shopviaclone22', env.SUPPLIER_ENCRYPTION_KEY)
      } catch (err) {
        if (err instanceof CredentialError) throw new HttpError(err.status, err.message)
        throw err
      }

      await db
        .prepare(
          `INSERT INTO shopviaclone22_connection(id, ciphertext, nonce, enabled, base_url)
           VALUES('shopviaclone22', ?, ?, ?, ?)
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
        `UPDATE shopviaclone22_connection SET enabled=?, base_url=?, lease_owner=NULL, lease_until=NULL WHERE id='shopviaclone22'`
      )
      .bind(enabledVal, baseUrl)
      .run()

    return json({ saved: true })
  }

  if (body.action === 'toggle') {
    if (!row) throw new HttpError(400, 'Configure ShopViaClone22 credentials first.')
    const nextEnabled = row.enabled ? 0 : 1
    await db
      .prepare(`UPDATE shopviaclone22_connection SET enabled=?, lease_owner=NULL, lease_until=NULL WHERE id='shopviaclone22'`)
      .bind(nextEnabled)
      .run()
    return json({ saved: true, enabled: Boolean(nextEnabled) })
  }

  if (body.action === 'test') {
    if (!row) throw new HttpError(409, 'Configure ShopViaClone22 credentials first.')
    try {
      const apiKey = await openCredential(row.ciphertext, row.nonce, 'shopviaclone22', env.SUPPLIER_ENCRYPTION_KEY)
      // Task 3: Use /profile.php for initial read-only connection test
      const profile = await fetchShopViaProfile(apiKey, row.base_url)

      const username = profile.username || (typeof profile.user === 'object' && (profile.user as any)?.username) || 'Verified Account'
      const balance = profile.balance !== undefined ? String(profile.balance) : undefined
      const currency = profile.currency || 'NGN'

      const statusMsg = `Connected via profile.php: ${username}${balance ? ` (Balance: ${currency} ${balance})` : ''}`
      await db
        .prepare("UPDATE shopviaclone22_connection SET last_status=?, last_success=? WHERE id='shopviaclone22'")
        .bind(statusMsg, Date.now())
        .run()
        .catch(() => {})

      return json({
        connected: true,
        message: statusMsg,
        username,
        balance,
        currency,
      })
    } catch (error) {
      const rawMsg = error instanceof ShopViaError ? error.message : (error instanceof Error ? error.message : 'Supplier connection test failed.')
      const message = rawMsg.replace(/api_key=[^&\s]+/gi, 'api_key=[REDACTED]')
      const status = error instanceof ShopViaError ? error.status : 502

      await db
        .prepare("UPDATE shopviaclone22_connection SET last_status=? WHERE id='shopviaclone22'")
        .bind(message.slice(0, 500))
        .run()
        .catch(() => {})

      return json({ connected: false, error: message, layer: 'supplier', provider_status: status }, 200)
    }
  }

  if (body.action === 'sync') {
    if (!row) throw new HttpError(409, 'Configure ShopViaClone22 credentials first.')
    if (!row.enabled) throw new HttpError(409, 'Enable ShopViaClone22 first.')
    await db.prepare("UPDATE shopviaclone22_connection SET requested=1 WHERE id='shopviaclone22'").run()
    return json(
      {
        queued: true,
        phase: row.phase,
        message: 'Background synchronization queued for ShopViaClone22.',
      },
      202
    )
  }

  throw new HttpError(400, 'Unknown supplier action.')
}

export async function syncShopViaClone22Batch(env: ApiEnv) {
  if (env.CATALOG_SYNC_ENABLED !== 'true' || !env.DB) return
  const db = env.DB,
    now = Date.now(),
    owner = crypto.randomUUID()

  const row = await db
    .prepare(
      `UPDATE shopviaclone22_connection SET lease_owner=?, lease_until=?
       WHERE id='shopviaclone22' AND enabled=1 AND next_attempt<=?
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
           SELECT 1 FROM shopviaclone22_connection
           WHERE id='shopviaclone22' AND enabled=1 AND revision=? AND lease_owner=? AND lease_until>?
         ) THEN 1 ELSE 0 END`
      )
      .bind(owner, row.revision, owner, Date.now())

  async function commit(statements: Statement[]) {
    await db.batch([
      fence(),
      ...statements,
      db.prepare('DELETE FROM shopviaclone22_sync_fences WHERE owner=?').bind(owner),
      db
        .prepare("UPDATE shopviaclone22_connection SET lease_owner=NULL, lease_until=NULL WHERE id='shopviaclone22' AND lease_owner=?")
        .bind(owner),
    ])
  }

  try {
    const apiKey = await openCredential(row.ciphertext, row.nonce, 'shopviaclone22', env.SUPPLIER_ENCRYPTION_KEY)
    const rawData = await fetchShopViaCatalog(apiKey, row.base_url)

    // 1. Map/create categories
    const defaultCat = (
      await db.prepare("SELECT id FROM categories WHERE slug='server3' OR active=1 ORDER BY CASE WHEN slug='server3' THEN 0 ELSE 1 END LIMIT 1").first<{ id: string }>()
    )?.id

    // 2. Query global pricing config (50% markup = 5000 bps) and supplier automation settings
    const globalCfg = await db
      .prepare("SELECT markup_bps, auto_publish, automatic_pricing, auto_approve, usd_to_ngn_rate FROM global_pricing_config WHERE id='global'")
      .first<{ markup_bps: number; auto_publish: number; automatic_pricing: number; auto_approve: number; usd_to_ngn_rate?: number }>()
      .catch(() => null)

    const usdToNgnRate = Number(globalCfg?.usd_to_ngn_rate) > 0 ? Number(globalCfg?.usd_to_ngn_rate) : 1500.0
    const { categories, products } = normalizeShopViaCatalog(rawData, usdToNgnRate, 'NGN')

    const jobId = crypto.randomUUID()
    const writes: Statement[] = []

    const pol = await db
      .prepare("SELECT markup_bps, automatic_pricing, auto_publish, auto_approve FROM supplier_automation WHERE provider='shopviaclone22'")
      .first<{ markup_bps: number; automatic_pricing: number; auto_publish: number; auto_approve: number }>()
      .catch(() => null)

    const defaultMarkup = globalCfg?.markup_bps ?? pol?.markup_bps ?? 5000
    const autoPublish = (globalCfg?.auto_publish === 1) || (pol?.auto_publish === 1)
    const autoApprove = (globalCfg?.auto_approve === 1) || (pol?.auto_approve === 1)

    const catRules = (
      await db.prepare('SELECT category_id, markup_bps, trusted, delivery_type, authorization_reference FROM supplier_category_rules WHERE provider=?').bind('shopviaclone22').all<{
        category_id: string
        markup_bps: number
        trusted: number
        delivery_type: string
        authorization_reference: string
      }>()
    ).results
    const catRuleMap = new Map(catRules.map((r) => [r.category_id, r]))

    // 3. Upsert products into shopviaclone22_catalog_items
    for (const item of products) {
      const catId = defaultCat
      const catRule = catId ? catRuleMap.get(catId) : undefined
      const effectiveMarkup = catRule && catRule.markup_bps > 0 ? catRule.markup_bps : defaultMarkup
      const price = calculateSellingPrice(item.costMinor, {
        id: 'markup',
        enabled: true,
        mode: 'markup',
        rateBps: effectiveMarkup,
        fixedMinor: 0,
        minProfitMinor: 0,
        feeBps: 0,
        feeFixedMinor: 0,
        fxBufferBps: 0,
        roundingMinor: 1,
      }).sellingPriceMinor

      const slug = `s3-${item.id}`
      const deliveryType = catRule?.delivery_type || 'Manual fulfillment'
      const authRef = catRule?.authorization_reference || 'ShopViaClone22 authorized supplier'

      writes.push(
        db
          .prepare(
            `INSERT INTO shopviaclone22_catalog_items(external_id, category_id, name, description, cost_minor, stock, raw_metadata, snapshot_id, checked_at, selling_price_minor)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(external_id) DO UPDATE SET
               name=excluded.name,
               description=excluded.description,
               cost_minor=excluded.cost_minor,
               stock=excluded.stock,
               raw_metadata=excluded.raw_metadata,
               snapshot_id=excluded.snapshot_id,
               checked_at=excluded.checked_at,
               selling_price_minor=excluded.selling_price_minor`
          )
          .bind(
            item.id,
            catId ?? null,
            item.name,
            item.description,
            item.costMinor,
            item.stock,
            JSON.stringify(item.raw),
            jobId,
            now,
            price
          )
      )

      // If auto-approve or auto-publish is active and stock is positive:
      if ((autoApprove || autoPublish || catRule?.trusted === 1) && item.stock > 0) {
        writes.push(
          db
            .prepare(
              `INSERT INTO products(id, category_id, slug, name, description, price_minor, supplier_name, authorized_resale, status, delivery_type, supplier_image_urls, pricing_mode, publication_verified, server_number)
               VALUES(?, ?, ?, ?, ?, ?, 'ShopViaClone22', 1, 'active', ?, '[]', 'auto', 1, 3)
               ON CONFLICT(slug) DO UPDATE SET
                 status='active',
                 publication_verified=1,
                 authorized_resale=1,
                 price_minor=CASE WHEN pricing_mode='override' THEN products.price_minor ELSE excluded.price_minor END,
                 category_id=excluded.category_id`
            )
            .bind(
              crypto.randomUUID(),
              catId ?? null,
              slug,
              item.name.slice(0, 200),
              item.description.slice(0, 10000),
              price,
              deliveryType
            ),
          db
            .prepare(
              `UPDATE shopviaclone22_catalog_items
               SET approval_status='approved', product_id=(SELECT id FROM products WHERE slug=?), reviewed_at=?
               WHERE external_id=?`
            )
            .bind(slug, now, item.id),
          db
            .prepare(
              `INSERT INTO product_authorizations(product_id, evidence, reviewer_id, verified_at)
               SELECT id, ?, (SELECT user_id FROM user_roles WHERE role='admin' LIMIT 1), ? FROM products WHERE slug=?
               ON CONFLICT(product_id) DO UPDATE SET verified_at=excluded.verified_at`
            )
            .bind(JSON.stringify({ delivery: true, privacy: true, provider: true, reference: authRef }), now, slug)
        )
      }
    }

    writes.push(
      db
        .prepare(
          `UPDATE shopviaclone22_connection
           SET phase='complete', total=?, scanned=?, last_success=?, last_status='Catalog synchronized', requested=0
           WHERE id='shopviaclone22'`
        )
        .bind(products.length, products.length, now)
    )

    await commit(writes)
  } catch (error) {
    const rawMsg = error instanceof ShopViaError ? error.message : (error instanceof Error ? error.message : 'ShopViaClone22 sync failed.')
    const message = rawMsg.replace(/api_key=[^&\s]+/gi, 'api_key=[REDACTED]')
    await db
      .prepare(
        `UPDATE shopviaclone22_connection
         SET last_status=?, next_attempt=?, lease_owner=NULL, lease_until=NULL
         WHERE id='shopviaclone22' AND revision=? AND lease_owner=?`
      )
      .bind(message.slice(0, 500), Date.now() + 60000, row.revision, owner)
      .run()
  }
}

