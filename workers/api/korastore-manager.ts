import { adminActor, bodyJSON } from './admin.ts'
import { HttpError, json } from './http.ts'
import { HttpError as CredentialError } from '../../server/auth.ts'
import { openCredential, sealCredential } from '../../server/supplier-crypto.ts'
import {
  KoraStoreError,
  KORASTORE_DEFAULT_BASE_URL,
  fetchKoraProfile,
  fetchKoraProducts,
  getKoraOrders,
  calculateKoraSellingPrice,
  type KoraProduct,
} from '../../server/korastore.ts'
import type { ApiEnv, Statement } from './types.ts'

export type KoraConnection = {
  id: string
  enabled: number
  ciphertext: string
  nonce: string
  revision: number
  requested: number
  auto_monitor: number
  monitor_interval_hours: number
  job_id: string | null
  total: number | null
  scanned: number
  phase: string
  lease_owner?: string | null
  lease_until?: number | null
  next_attempt: number
  last_success: number | null
  last_status: string
  base_url: string
}

export type KoraCatalogItem = {
  external_id: string
  name: string
  description: string
  cost_minor: number
  previous_cost_minor: number | null
  selling_price_minor: number
  currency: string
  stock: number | null
  available: number
  delivery_type: string
  pricing_mode: 'markup' | 'override'
  markup_bps: number
  approval_status: 'pending' | 'approved' | 'rejected'
  product_id: string | null
  raw_metadata: string
  checked_at: number
  reviewed_at: number | null
  price_updated_at: number | null
}

export async function korastoreAdmin(request: Request, env: ApiEnv) {
  const actor = await adminActor(request, env)
  const db = env.DB!

  if (request.method === 'GET') {
    const conn = await db
      .prepare(
        `SELECT enabled, revision, requested, auto_monitor, monitor_interval_hours,
                phase, total, scanned, next_attempt, last_success, last_status, base_url,
                (SELECT count(*) FROM korastore_catalog_items) AS imported,
                (SELECT count(*) FROM korastore_catalog_items WHERE approval_status='approved') AS approved,
                (SELECT count(*) FROM korastore_catalog_items WHERE available=1 AND (stock IS NULL OR stock > 0)) AS in_stock
         FROM korastore_connection WHERE id='korastore'`
      )
      .first()
      .catch(() => null)

    const items = await db
      .prepare(
        `SELECT k.*, p.status AS product_status, p.slug AS product_slug
         FROM korastore_catalog_items k
         LEFT JOIN products p ON p.id = k.product_id
         ORDER BY k.checked_at DESC`
      )
      .all<KoraCatalogItem & { product_status?: string; product_slug?: string }>()
      .catch(() => ({ results: [] }))

    const priceHistory = await db
      .prepare(
        `SELECT h.*, k.name AS product_name
         FROM korastore_price_history h
         LEFT JOIN korastore_catalog_items k ON k.external_id = h.external_id
         ORDER BY h.recorded_at DESC
         LIMIT 50`
      )
      .all()
      .catch(() => ({ results: [] }))

    return json({
      provider: 'korastore',
      connection: conn,
      items: items.results,
      priceHistory: priceHistory.results,
    })
  }

  if (request.method !== 'POST') throw new HttpError(405, 'Method not permitted.')
  const body = await bodyJSON(request, 32768)
  const row = await db.prepare("SELECT * FROM korastore_connection WHERE id='korastore'").first<KoraConnection>()

  // 1. Action: save configuration & settings
  if (body.action === 'save') {
    const baseUrl =
      typeof body.base_url === 'string' && body.base_url.trim()
        ? body.base_url.trim().replace(/\/+$/, '')
        : KORASTORE_DEFAULT_BASE_URL

    if (!baseUrl.startsWith('https://') && !baseUrl.startsWith('http://localhost')) {
      throw new HttpError(400, 'Base URL must use HTTPS.')
    }

    if (body.api_key !== undefined) {
      if (typeof body.api_key !== 'string' || !body.api_key.trim()) {
        throw new HttpError(400, 'Enter a valid Kora Store API key.')
      }
      const rawCreds = {
        apiKey: body.api_key.trim(),
        baseUrl,
      }
      let sealed: Awaited<ReturnType<typeof sealCredential>>
      try {
        sealed = await sealCredential(JSON.stringify(rawCreds), 'korastore', env.SUPPLIER_ENCRYPTION_KEY)
      } catch (err) {
        if (err instanceof CredentialError) throw new HttpError(err.status, err.message)
        throw err
      }

      await db
        .prepare(
          `INSERT INTO korastore_connection(id, ciphertext, nonce, enabled, base_url, auto_monitor, monitor_interval_hours)
           VALUES('korastore', ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             ciphertext=excluded.ciphertext,
             nonce=excluded.nonce,
             enabled=excluded.enabled,
             base_url=excluded.base_url,
             auto_monitor=excluded.auto_monitor,
             monitor_interval_hours=excluded.monitor_interval_hours,
             revision=revision+1,
             lease_owner=NULL,
             lease_until=NULL,
             last_status='Credentials replaced; test connection'`
        )
        .bind(
          sealed.ciphertext,
          sealed.nonce,
          body.enabled ? 1 : 0,
          baseUrl,
          body.auto_monitor ? 1 : 0,
          Number(body.monitor_interval_hours) > 0 ? Number(body.monitor_interval_hours) : 6
        )
        .run()

      return json({
        ok: true,
        message: 'Kora Store API credentials securely encrypted in Cloudflare D1.',
      })
    }

    // Save non-credential settings (enabled, auto_monitor, monitor_interval_hours)
    if (row) {
      const nextEnabled = body.enabled !== undefined ? (body.enabled ? 1 : 0) : row.enabled
      const nextAutoMonitor = body.auto_monitor !== undefined ? (body.auto_monitor ? 1 : 0) : row.auto_monitor
      const nextInterval = Number(body.monitor_interval_hours) > 0 ? Number(body.monitor_interval_hours) : row.monitor_interval_hours

      await db
        .prepare(
          `UPDATE korastore_connection
           SET enabled=?, auto_monitor=?, monitor_interval_hours=?, base_url=?
           WHERE id='korastore'`
        )
        .bind(nextEnabled, nextAutoMonitor, nextInterval, baseUrl)
        .run()

      return json({
        ok: true,
        message: 'Kora Store settings updated.',
      })
    }

    throw new HttpError(400, 'Configure Kora Store credentials first.')
  }

  // 2. Action: toggle enabled state
  if (body.action === 'toggle') {
    if (!row) throw new HttpError(400, 'Configure Kora Store credentials first.')
    const nextState = row.enabled === 1 ? 0 : 1
    await db
      .prepare(`UPDATE korastore_connection SET enabled=?, lease_owner=NULL, lease_until=NULL WHERE id='korastore'`)
      .bind(nextState)
      .run()
    return json({ ok: true, enabled: nextState })
  }

  // 3. Action: test connection (GET /v1/me)
  if (body.action === 'test') {
    if (!row) throw new HttpError(409, 'Configure Kora Store credentials first.')
    const creds = await decryptKoraCredentials(row, env)
    try {
      const profile = await fetchKoraProfile(creds.apiKey, creds.baseUrl || row.base_url)
      const now = Date.now()
      const statusMsg = `Connected to Kora Store. Balance: ₦${Number(profile.balance_naira).toLocaleString('en-US', { minimumFractionDigits: 2 })} (${profile.balance_kobo.toLocaleString()} kobo)`
      await db
        .prepare("UPDATE korastore_connection SET last_status=?, last_success=? WHERE id='korastore'")
        .bind(statusMsg, now)
        .run()

      return json({
        ok: true,
        connected: true,
        message: statusMsg,
        balance_kobo: profile.balance_kobo,
        balance_naira: profile.balance_naira,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Kora connection test failed.'
      const status = error instanceof KoraStoreError ? error.status : 502
      await db
        .prepare("UPDATE korastore_connection SET last_status=? WHERE id='korastore'")
        .bind(`Test failed: ${msg.slice(0, 400)}`)
        .run()
      throw new HttpError(status, msg)
    }
  }

  // 4. Action: supplier balance check
  if (body.action === 'balance') {
    if (!row) throw new HttpError(409, 'Configure Kora Store credentials first.')
    const creds = await decryptKoraCredentials(row, env)
    const profile = await fetchKoraProfile(creds.apiKey, creds.baseUrl || row.base_url)
    return json({
      ok: true,
      balance_kobo: profile.balance_kobo,
      balance_naira: profile.balance_naira,
    })
  }

  // 5. Action: fetch catalog from Kora
  if (body.action === 'fetch_catalog') {
    if (!row) throw new HttpError(409, 'Configure Kora Store credentials first.')
    const creds = await decryptKoraCredentials(row, env)
    const liveProducts = await fetchKoraProducts(creds.apiKey, creds.baseUrl || row.base_url)

    // Tag each product with current import status
    const existing = new Map(
      (
        await db
          .prepare('SELECT external_id, approval_status, selling_price_minor, pricing_mode, markup_bps FROM korastore_catalog_items')
          .all<{ external_id: string; approval_status: string; selling_price_minor: number; pricing_mode: string; markup_bps: number }>()
      ).results.map((r) => [r.external_id, r])
    )

    const tagged = liveProducts.map((p) => {
      const match = existing.get(p.id)
      return {
        ...p,
        imported: Boolean(match),
        approval_status: match?.approval_status ?? null,
        current_selling_price_minor: match?.selling_price_minor ?? null,
        pricing_mode: match?.pricing_mode ?? null,
        markup_bps: match?.markup_bps ?? null,
      }
    })

    return json({ ok: true, products: tagged })
  }

  // 6. Action: selective product import
  if (body.action === 'import_products') {
    if (!row) throw new HttpError(409, 'Configure Kora Store credentials first.')
    const productIds: string[] = Array.isArray(body.product_ids) ? body.product_ids.map(String).filter(Boolean) : []
    if (productIds.length === 0) throw new HttpError(400, 'Select at least one product to import.')

    const markupBps = typeof body.markup_bps === 'number' && body.markup_bps >= 0 ? body.markup_bps : 5000 // default 50%
    const creds = await decryptKoraCredentials(row, env)
    const liveProducts = await fetchKoraProducts(creds.apiKey, creds.baseUrl || row.base_url)
    const selected = liveProducts.filter((p) => productIds.includes(p.id))

    if (selected.length === 0) throw new HttpError(400, 'None of the selected products were found in Kora catalog.')

    const now = Date.now()
    const writes: Statement[] = []

    for (const item of selected) {
      const sellingPrice = calculateKoraSellingPrice(item.price_kobo, markupBps)
      writes.push(
        db
          .prepare(
            `INSERT INTO korastore_catalog_items(
               external_id, name, description, cost_minor, previous_cost_minor,
               selling_price_minor, currency, stock, available, delivery_type,
               pricing_mode, markup_bps, approval_status, raw_metadata, checked_at
             )
             VALUES(?, ?, ?, ?, ?, ?, 'NGN', ?, ?, ?, 'markup', ?, 'pending', ?, ?)
             ON CONFLICT(external_id) DO UPDATE SET
               name=excluded.name,
               cost_minor=excluded.cost_minor,
               stock=excluded.stock,
               available=excluded.available,
               delivery_type=excluded.delivery_type,
               checked_at=excluded.checked_at,
               raw_metadata=excluded.raw_metadata`
          )
          .bind(
            item.id,
            item.name,
            `Authorized ${item.name} license subscription via Kora Store`,
            item.price_kobo,
            item.price_kobo,
            sellingPrice,
            item.stock,
            item.available ? 1 : 0,
            item.delivery,
            markupBps,
            JSON.stringify(item),
            now
          )
      )

      writes.push(
        db
          .prepare(
            `INSERT INTO korastore_price_history(id, external_id, old_cost_minor, new_cost_minor, old_price_minor, new_price_minor, markup_bps, change_type, recorded_at)
             VALUES(?, ?, ?, ?, 0, ?, ?, 'initial', ?)`
          )
          .bind(
            crypto.randomUUID(),
            item.id,
            item.price_kobo,
            item.price_kobo,
            sellingPrice,
            markupBps,
            now
          )
      )
    }

    await db.batch(writes)
    return json({
      ok: true,
      imported: selected.length,
      message: `Successfully imported ${selected.length} products into draft/pending status. Configure pricing and publish when ready.`,
    })
  }

  // 7. Action: update pricing (Option A: Percentage Markup vs Option B: Fixed Price)
  if (body.action === 'update_pricing') {
    const externalId = String(body.external_id ?? '').trim()
    if (!externalId) throw new HttpError(400, 'Product external ID required.')

    const item = await db
      .prepare('SELECT * FROM korastore_catalog_items WHERE external_id=?')
      .bind(externalId)
      .first<KoraCatalogItem>()
    if (!item) throw new HttpError(404, 'Imported product not found.')

    const mode = body.pricing_mode === 'override' ? 'override' : 'markup'
    let newSellingPrice: number
    let markupBps = item.markup_bps

    if (mode === 'markup') {
      if (typeof body.markup_bps === 'number' && body.markup_bps >= 0 && body.markup_bps <= 1000000) {
        markupBps = Math.round(body.markup_bps)
      }
      newSellingPrice = calculateKoraSellingPrice(item.cost_minor, markupBps)
    } else {
      // Fixed price mode (Option B)
      const fixedKobo = Number(body.selling_price_minor)
      if (!Number.isSafeInteger(fixedKobo) || fixedKobo <= 0) {
        throw new HttpError(400, 'Enter a valid positive selling price in kobo.')
      }
      newSellingPrice = fixedKobo
    }

    const lossWarning = newSellingPrice < item.cost_minor
    const now = Date.now()
    const writes: Statement[] = [
      db
        .prepare(
          `UPDATE korastore_catalog_items
           SET pricing_mode=?, markup_bps=?, selling_price_minor=?, price_updated_at=?
           WHERE external_id=?`
        )
        .bind(mode, markupBps, newSellingPrice, now, externalId),
      db
        .prepare(
          `INSERT INTO korastore_price_history(id, external_id, old_cost_minor, new_cost_minor, old_price_minor, new_price_minor, markup_bps, change_type, recorded_at)
           VALUES(?, ?, ?, ?, ?, ?, ?, 'manual', ?)`
        )
        .bind(
          crypto.randomUUID(),
          externalId,
          item.cost_minor,
          item.cost_minor,
          item.selling_price_minor,
          newSellingPrice,
          mode === 'markup' ? markupBps : 0,
          now
        ),
    ]

    // If already published to products table, update products.price_minor
    if (item.product_id) {
      writes.push(
        db
          .prepare(
            `UPDATE products
             SET price_minor=?, pricing_mode=?
             WHERE id=? AND server_number=4`
          )
          .bind(newSellingPrice, mode === 'markup' ? 'auto' : 'override', item.product_id)
      )
    }

    await db.batch(writes)
    return json({
      ok: true,
      external_id: externalId,
      pricing_mode: mode,
      markup_bps: markupBps,
      selling_price_minor: newSellingPrice,
      loss_warning: lossWarning,
      profit_minor: newSellingPrice - item.cost_minor,
    })
  }

  // 8. Action: bulk pricing update
  if (body.action === 'bulk_pricing') {
    const externalIds: string[] = Array.isArray(body.external_ids) ? body.external_ids.map(String).filter(Boolean) : []
    if (externalIds.length === 0) throw new HttpError(400, 'Select at least one product.')
    const markupBps = Number(body.markup_bps)
    if (!Number.isSafeInteger(markupBps) || markupBps < 0 || markupBps > 1000000) {
      throw new HttpError(400, 'Enter a valid markup percentage (basis points: 0–1,000,000).')
    }

    const items = await db
      .prepare(
        `SELECT * FROM korastore_catalog_items WHERE external_id IN (${externalIds.map(() => '?').join(',')})`
      )
      .bind(...externalIds)
      .all<KoraCatalogItem>()

    const now = Date.now()
    const writes: Statement[] = []

    for (const item of items.results) {
      const newPrice = calculateKoraSellingPrice(item.cost_minor, markupBps)
      writes.push(
        db
          .prepare(
            `UPDATE korastore_catalog_items
             SET pricing_mode='markup', markup_bps=?, selling_price_minor=?, price_updated_at=?
             WHERE external_id=?`
          )
          .bind(markupBps, newPrice, now, item.external_id),
        db
          .prepare(
            `INSERT INTO korastore_price_history(id, external_id, old_cost_minor, new_cost_minor, old_price_minor, new_price_minor, markup_bps, change_type, recorded_at)
             VALUES(?, ?, ?, ?, ?, ?, ?, 'bulk_markup', ?)`
          )
          .bind(
            crypto.randomUUID(),
            item.external_id,
            item.cost_minor,
            item.cost_minor,
            item.selling_price_minor,
            newPrice,
            markupBps,
            now
          )
      )

      if (item.product_id) {
        writes.push(
          db
            .prepare(
              `UPDATE products
               SET price_minor=?, pricing_mode='auto'
               WHERE id=? AND server_number=4`
            )
            .bind(newPrice, item.product_id)
        )
      }
    }

    if (writes.length > 0) {
      await db.batch(writes)
    }

    return json({
      ok: true,
      updated_count: items.results.length,
      markup_bps: markupBps,
    })
  }

  // 9. Action: toggle publish / approve product to Server 4 storefront
  if (body.action === 'toggle_publish') {
    const externalId = String(body.external_id ?? '').trim()
    const publish = Boolean(body.publish)

    const item = await db
      .prepare('SELECT * FROM korastore_catalog_items WHERE external_id=?')
      .bind(externalId)
      .first<KoraCatalogItem>()
    if (!item) throw new HttpError(404, 'Imported product not found.')

    const now = Date.now()

    if (publish) {
      // Find Server 4 category ID
      const catRow = await db
        .prepare(
          "SELECT id FROM categories WHERE slug='server4' OR slug='ai-tools' OR active=1 ORDER BY CASE WHEN slug='server4' THEN 0 ELSE 1 END LIMIT 1"
        )
        .first<{ id: string }>()
      const categoryId = catRow?.id ?? 'c8402d52-37ef-4dfb-df2f-47cd20cd7004'

      const productId = item.product_id || `s4-kora-${item.external_id}`
      const slug = `s4-kora-${item.external_id}`
      const deliveryMethod = item.delivery_type === 'instant' ? 'Subscription activation' : 'Manual fulfillment'
      const features = JSON.stringify(['Authorized AI Tool License', 'Instant Digital Delivery', 'Kora Store Resale Rights'])

      const writes: Statement[] = [
        db
          .prepare(
            `INSERT INTO products(
               id, category_id, slug, name, description, price_minor, currency,
               supplier_name, authorized_resale, status, delivery_type, term,
               features, supplier_image_urls, pricing_mode, publication_verified, server_number
             )
             VALUES(?, ?, ?, ?, ?, ?, 'NGN', 'KoraStore', 1, 'active', ?, 'Instant delivery', ?, '[]', ?, 1, 4)
             ON CONFLICT(slug) DO UPDATE SET
               status='active',
               publication_verified=1,
               authorized_resale=1,
               price_minor=excluded.price_minor,
               pricing_mode=excluded.pricing_mode,
               category_id=excluded.category_id,
               name=excluded.name,
               description=excluded.description,
               delivery_type=excluded.delivery_type`
          )
          .bind(
            productId,
            categoryId,
            slug,
            item.name,
            item.description || `Authorized ${item.name} license subscription via Kora Store`,
            item.selling_price_minor,
            deliveryMethod,
            features,
            item.pricing_mode === 'markup' ? 'auto' : 'override'
          ),
        db
          .prepare(
            `INSERT INTO product_authorizations(product_id, evidence, reviewer_id, verified_at)
             VALUES(?, json_object('delivery', 1, 'privacy', 1, 'provider', 1, 'reference', 'Kora Store authorized provider resale'), ?, ?)
             ON CONFLICT(product_id) DO UPDATE SET
               evidence=excluded.evidence,
               reviewer_id=excluded.reviewer_id,
               verified_at=excluded.verified_at`
          )
          .bind(productId, actor.id, now),
        db
          .prepare(
            `UPDATE korastore_catalog_items
             SET approval_status='approved', product_id=?, reviewed_at=?
             WHERE external_id=?`
          )
          .bind(productId, now, externalId),
      ]

      await db.batch(writes)
      return json({ ok: true, published: true, status: 'approved', product_id: productId })
    } else {
      // Unpublish: set approval_status to 'pending' and product to 'draft'
      const writes: Statement[] = [
        db
          .prepare("UPDATE korastore_catalog_items SET approval_status='pending' WHERE external_id=?")
          .bind(externalId),
      ]
      if (item.product_id) {
        writes.push(
          db
            .prepare("UPDATE products SET status='draft', publication_verified=0 WHERE id=?")
            .bind(item.product_id)
        )
      }
      await db.batch(writes)
      return json({ ok: true, published: false, status: 'pending' })
    }
  }

  // 10. Action: toggle manual stock override
  if (body.action === 'toggle_stock') {
    const externalId = String(body.external_id ?? '').trim()
    const available = body.available !== undefined ? (body.available ? 1 : 0) : undefined
    const stock = body.stock !== undefined ? (body.stock === null ? null : Number(body.stock)) : undefined

    await db
      .prepare(
        `UPDATE korastore_catalog_items
         SET available=COALESCE(?, available), stock=CASE WHEN ? THEN ? ELSE stock END
         WHERE external_id=?`
      )
      .bind(
        available !== undefined ? available : null,
        stock !== undefined ? 1 : 0,
        stock !== undefined ? stock : null,
        externalId
      )
      .run()

    return json({ ok: true, external_id: externalId })
  }

  // 11. Action: view price history
  if (body.action === 'price_history') {
    const externalId = body.external_id ? String(body.external_id).trim() : null
    let query = 'SELECT * FROM korastore_price_history'
    const params: string[] = []
    if (externalId) {
      query += ' WHERE external_id=?'
      params.push(externalId)
    }
    query += ' ORDER BY recorded_at DESC LIMIT 100'

    const rows = await db.prepare(query).bind(...params).all()
    return json({ ok: true, history: rows.results })
  }

  // 12. Action: sync prices (price monitoring pass across selected products only)
  if (body.action === 'sync_prices') {
    if (!row) throw new HttpError(409, 'Configure Kora Store credentials first.')
    const syncSummary = await runKoraPriceSync(env, row)
    return json({ ok: true, ...syncSummary })
  }

  // 13. Action: view Kora supplier orders
  if (body.action === 'orders') {
    if (!row) throw new HttpError(409, 'Configure Kora Store credentials first.')
    const creds = await decryptKoraCredentials(row, env)
    const orders = await getKoraOrders(creds.apiKey, creds.baseUrl || row.base_url)
    return json({ ok: true, orders })
  }

  throw new HttpError(400, 'Unsupported action.')
}

async function decryptKoraCredentials(row: KoraConnection, env: ApiEnv): Promise<{ apiKey: string; baseUrl?: string }> {
  try {
    return JSON.parse(
      await openCredential(row.ciphertext, row.nonce, 'korastore', env.SUPPLIER_ENCRYPTION_KEY)
    )
  } catch {
    throw new HttpError(400, 'Kora Store credential decryption failed.')
  }
}

/**
 * Runs price monitoring across imported Kora products with STRICT D1 write containment:
 * - Selected products only (korastore_catalog_items).
 * - Automatic price increase: preserves percentage markup.
 * - Automatic price decrease: preserves percentage markup.
 * - Option B (override): fixed price remains completely unchanged on cost changes.
 * - ZERO D1 WRITES if supplier costs, prices, and stock are unchanged.
 */
export async function runKoraPriceSync(env: ApiEnv, row: KoraConnection) {
  const db = env.DB!
  const creds = await decryptKoraCredentials(row, env)
  const liveProducts = await fetchKoraProducts(creds.apiKey, creds.baseUrl || row.base_url)
  const liveMap = new Map(liveProducts.map((p) => [p.id, p]))

  const imported = (
    await db.prepare('SELECT * FROM korastore_catalog_items').all<KoraCatalogItem>()
  ).results

  const now = Date.now()
  let priceIncreases = 0
  let priceDecreases = 0
  let stockUpdates = 0
  let unchanged = 0
  const writes: Statement[] = []

  for (const item of imported) {
    const live = liveMap.get(item.external_id)
    if (!live) continue

    const oldCost = item.cost_minor
    const newCost = live.price_kobo
    const oldStock = item.stock
    const newStock = live.stock
    const oldAvailable = item.available
    const newAvailable = live.available ? 1 : 0

    const costChanged = oldCost !== newCost
    const stockChanged = oldStock !== newStock || oldAvailable !== newAvailable

    // Strict write containment: if neither cost nor stock changed, DO NOT WRITE!
    if (!costChanged && !stockChanged) {
      unchanged++
      continue
    }

    let newSellingPrice = item.selling_price_minor
    if (costChanged) {
      if (item.pricing_mode === 'markup') {
        // Option A: recalculate selling price following percentage markup formula
        newSellingPrice = calculateKoraSellingPrice(newCost, item.markup_bps)
      }
      // Option B: fixed price (pricing_mode === 'override') stays completely unchanged!

      if (newCost > oldCost) priceIncreases++
      else priceDecreases++

      writes.push(
        db
          .prepare(
            `INSERT INTO korastore_price_history(id, external_id, old_cost_minor, new_cost_minor, old_price_minor, new_price_minor, markup_bps, change_type, recorded_at)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            crypto.randomUUID(),
            item.external_id,
            oldCost,
            newCost,
            item.selling_price_minor,
            newSellingPrice,
            item.pricing_mode === 'markup' ? item.markup_bps : 0,
            newCost > oldCost ? 'increase' : 'decrease',
            now
          )
      )
    }

    if (stockChanged) {
      stockUpdates++
    }

    writes.push(
      db
        .prepare(
          `UPDATE korastore_catalog_items
           SET cost_minor=?, previous_cost_minor=?, selling_price_minor=?, stock=?, available=?, checked_at=?, price_updated_at=CASE WHEN ?=1 THEN ? ELSE price_updated_at END
           WHERE external_id=?`
        )
        .bind(
          newCost,
          oldCost,
          newSellingPrice,
          newStock,
          newAvailable,
          now,
          costChanged ? 1 : 0,
          now,
          item.external_id
        )
    )

    // If published and in markup mode, update storefront product price
    if (item.product_id && item.pricing_mode === 'markup' && costChanged) {
      writes.push(
        db
          .prepare(
            `UPDATE products
             SET price_minor=?
             WHERE id=? AND server_number=4 AND (pricing_mode='auto' OR pricing_mode IS NULL)`
          )
          .bind(newSellingPrice, item.product_id)
      )
    }
  }

  // Execute in bounded batches of 50 statements
  if (writes.length > 0) {
    for (let i = 0; i < writes.length; i += 50) {
      await db.batch(writes.slice(i, i + 50))
    }
  }

  await db
    .prepare("UPDATE korastore_connection SET last_status=?, last_success=? WHERE id='korastore'")
    .bind(
      `Price check complete. Checked: ${imported.length}, Price increases: ${priceIncreases}, Price decreases: ${priceDecreases}, Stock updates: ${stockUpdates}, Unchanged: ${unchanged}`,
      now
    )
    .run()

  return {
    total_checked: imported.length,
    price_increases: priceIncreases,
    price_decreases: priceDecreases,
    stock_updates: stockUpdates,
    unchanged,
    d1_statements_executed: writes.length,
  }
}

/**
 * Scheduled cron batch worker for Kora Store price monitoring:
 * - Checks auto_monitor flag and monitor_interval_hours.
 * - Leased concurrency control prevents duplicate runs.
 * - Respects Cloudflare billing containment (zero D1 writes on unchanged prices).
 */
export async function syncKoraStoreBatch(env: ApiEnv) {
  if (env.CATALOG_SYNC_ENABLED !== 'true' || !env.DB) return
  const db = env.DB,
    now = Date.now(),
    owner = crypto.randomUUID()

  // Acquire lease if auto_monitor is enabled and interval has elapsed
  const row = await db
    .prepare(
      `UPDATE korastore_connection SET lease_owner=?, lease_until=?
       WHERE id='korastore' AND enabled=1 AND auto_monitor=1
         AND (lease_until IS NULL OR lease_until<=?)
         AND (next_attempt<=? OR last_success IS NULL OR last_success<=(? - monitor_interval_hours * 3600000))
       RETURNING *`
    )
    .bind(owner, now + 60000, now, now, now)
    .first<KoraConnection>()
    .catch(() => null)

  if (!row) return

  try {
    await runKoraPriceSync(env, row)
    const intervalHours = row.monitor_interval_hours > 0 ? row.monitor_interval_hours : 6
    await db
      .prepare(
        `UPDATE korastore_connection
         SET lease_owner=NULL, lease_until=NULL, last_success=?, next_attempt=?
         WHERE id='korastore' AND lease_owner=?`
      )
      .bind(Date.now(), Date.now() + intervalHours * 3600000, owner)
      .run()
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Cron price check failed'
    await db
      .prepare(
        `UPDATE korastore_connection
         SET lease_owner=NULL, lease_until=NULL, last_status=?, next_attempt=?
         WHERE id='korastore' AND lease_owner=?`
      )
      .bind(`Sync error: ${errorMsg.slice(0, 300)}`, Date.now() + 600000, owner)
      .run()
  }
}
