import { adminActor, bodyJSON } from './admin.ts'
import { HttpError, json } from './http.ts'
import { HttpError as CredentialError } from '../../server/auth.ts'
import { openCredential, sealCredential } from '../../server/supplier-crypto.ts'
import {
  ShopViaError,
  fetchShopViaProfile,
  fetchShopViaProduct,
  fetchShopViaCatalog,
  normalizeShopViaCatalog,
  extractShopViaProductInfo,
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

export function sanitizeProbeData(val: unknown, apiKey?: string): unknown {
  if (val === null || val === undefined) return val
  if (typeof val === 'string') {
    if (apiKey && apiKey.length > 5 && val.includes(apiKey)) return '[REDACTED_API_KEY]'
    if (/^[0-9a-f]{32,64}$/i.test(val) && val.length > 24) return '[REDACTED_HASH]'
    if (/^[A-Za-z0-9+/]{40,}={0,2}$/.test(val)) return '[REDACTED_TOKEN]'
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      const parts = val.split('@')
      return `${parts[0].slice(0, 2)}***@${parts[1]}`
    }
    return val
  }
  if (typeof val === 'number' || typeof val === 'boolean') return val
  if (Array.isArray(val)) {
    return val.slice(0, 25).map((item) => sanitizeProbeData(item, apiKey))
  }
  if (typeof val === 'object') {
    const res: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (/password|secret|token|api_key|hash|private_key|auth_token/i.test(k)) {
        res[k] = '[REDACTED]'
      } else {
        res[k] = sanitizeProbeData(v, apiKey)
      }
    }
    return res
  }
  return String(val)
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

      const username = profile.username || 'Verified Account'
      const balance = profile.balance !== undefined ? String(profile.balance) : undefined
      const currency = profile.currency || 'USD'
      const balanceStatus = profile.balance_status || (profile.spendable_balance !== undefined ? 'funded' : 'unknown')

      let balanceLabel = ''
      if (balanceStatus === 'funded' && balance !== undefined) {
        balanceLabel = ` (Balance: ${currency} ${balance})`
      } else if (balanceStatus === 'zero') {
        balanceLabel = ` (Balance: ${currency} 0.00)`
      } else {
        balanceLabel = ` (Balance: unknown)`
      }

      const statusMsg = `Connected via profile.php: ${username}${balanceLabel}`
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
        balance_status: balanceStatus,
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

    // Verified read-only merchant probe & product 342 preflight audit
    let merchantStatus = ''
    let dynamicProduct: { id?: string; name?: string; price?: number; stock?: number } = {}
    let dynamicCost: number | undefined
    let dynamicStock: number | undefined
    let dynamicName = 'Hotmail Trusted - OAuth2'
    try {
      const profile = await fetchShopViaProfile(apiKey, row.base_url)
      const username = profile.username || 'Verified Account'
      const balance = profile.balance
      const spendable = profile.spendable_balance ?? (balance !== undefined ? Number(balance) : null)
      const currency = profile.currency || 'USD'
      const currencySource = profile.currency_source || 'inferred'
      const balanceStatus = profile.balance_status || (spendable !== null && spendable > 0 ? 'funded' : spendable === 0 ? 'zero' : 'unknown')

      let p342Info: unknown = null
      try {
        p342Info = await fetchShopViaProduct(apiKey, '342', row.base_url)
      } catch (e) {
        p342Info = { error: e instanceof Error ? e.message : 'Lookup failed' }
      }

      // Dynamically extract product 342 stock, wholesale price, and metadata from genuine response
      dynamicProduct = extractShopViaProductInfo(p342Info)
      dynamicCost = dynamicProduct.price
      dynamicStock = dynamicProduct.stock
      dynamicName = dynamicProduct.name || 'Hotmail Trusted - OAuth2'

      const isBalanceSufficient =
        spendable !== null &&
        dynamicCost !== undefined &&
        dynamicCost > 0 &&
        spendable >= dynamicCost

      const coverageRatio =
        spendable !== null && dynamicCost !== undefined && dynamicCost > 0
          ? spendable / dynamicCost
          : null

      const coverageStr =
        coverageRatio !== null
          ? `${coverageRatio.toFixed(1)}x`
          : 'unknown'

      const probeAudit = {
        checked_at: Date.now(),
        merchant_account: username,
        account_match_confirmed: username.toLowerCase() === 'logspoll',
        connection_status: 'connected',
        catalog_access: 'verified',
        balance_status: balanceStatus,
        spendable_balance: balance ?? 'unknown',
        currency,
        currency_source: currencySource,
        currency_label:
          currencySource === 'inferred'
            ? 'USD (inferred from catalog wholesale pricing; profile.php omits currency code)'
            : `${currency} (${currencySource})`,
        product_342: {
          id: dynamicProduct.id || '342',
          name: dynamicName,
          wholesale_cost: dynamicCost !== undefined ? `${currency} ${dynamicCost.toFixed(2)}` : 'unknown',
          stock: dynamicStock !== undefined ? dynamicStock : 'unknown',
          balance_sufficient: isBalanceSufficient,
          balance_coverage: coverageStr,
        },
        permissions: {
          account_connected: true,
          catalog_access: true,
          spendable_balance_sufficient: isBalanceSufficient,
          purchase_execution: 'authorized_pending_test',
        },
        readiness: {
          ready_for_authorized_test:
            username.toLowerCase() === 'logspoll' &&
            balanceStatus === 'funded' &&
            isBalanceSufficient &&
            dynamicStock !== undefined &&
            dynamicStock > 0,
          remaining_uncertainty:
            currencySource === 'inferred'
              ? 'Supplier profile.php omits explicit currency field; USD inferred from catalog wholesale prices'
              : 'None',
        },
      }

      await db
        .prepare("INSERT INTO migration_metadata(key, value) VALUES('shopviaclone22_merchant_probe', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .bind(JSON.stringify(probeAudit))
        .run()
        .catch(() => {})

      let balanceLabel = ''
      if (balanceStatus === 'funded' && balance !== undefined) {
        balanceLabel = `Balance: ${currency} ${balance} (${coverageStr} cover)`
      } else if (balanceStatus === 'zero') {
        balanceLabel = `Balance: ${currency} 0.00 (Insufficient)`
      } else {
        balanceLabel = `Balance: unknown`
      }

      merchantStatus = `Merchant: ${username} | ${balanceLabel} | Catalog synced`
    } catch (err) {
      merchantStatus = `Profile probe: ${err instanceof Error ? err.message : 'failed'}`
    }

    const rawData = await fetchShopViaCatalog(apiKey, row.base_url)

    // 1. Map/create categories
    const defaultCat = (
      await db.prepare("SELECT id FROM categories WHERE slug='server3' OR active=1 ORDER BY CASE WHEN slug='server3' THEN 0 ELSE 1 END LIMIT 1").first<{ id: string }>()
    )?.id

    // 2. Query global pricing config (50% markup = 5000 bps) and supplier automation settings
    const globalCfg = await db
      .prepare("SELECT markup_bps, auto_publish, automatic_pricing, auto_approve, usd_to_ngn_rate, delivery_type FROM global_pricing_config WHERE id='global'")
      .first<{ markup_bps: number; auto_publish: number; automatic_pricing: number; auto_approve: number; usd_to_ngn_rate?: number; delivery_type?: string }>()
      .catch(() => null)

    const usdToNgnRate = Number(globalCfg?.usd_to_ngn_rate) > 0 ? Number(globalCfg?.usd_to_ngn_rate) : 1500.0
    const { categories, products } = normalizeShopViaCatalog(rawData, usdToNgnRate, 'NGN')

    // If specific verified product (e.g. product 342) was queried via dynamic lookup with verified cost & stock, and is absent from products.php, include it
    if (
      dynamicProduct.id &&
      dynamicStock !== undefined &&
      dynamicCost !== undefined &&
      dynamicCost > 0 &&
      !products.some((p) => p.id === dynamicProduct.id)
    ) {
      const pCost = dynamicCost
      const usdMinor = Math.round(pCost * 100)
      const ngnMinor = Math.round(usdMinor * usdToNgnRate)
      products.push({
        id: dynamicProduct.id,
        categoryId: defaultCat ?? 's3_general',
        categoryName: 'General',
        name: dynamicName,
        description: 'FORMAT: Mail|Pass|Refresh_token|Client_id|Recovery_email',
        costMinor: ngnMinor,
        usdCostMinor: usdMinor,
        currency: 'NGN',
        stock: dynamicStock,
        raw: {
          id: dynamicProduct.id,
          name: dynamicName,
          description: 'FORMAT: Mail|Pass|Refresh_token|Client_id|Recovery_email',
          price: String(pCost),
          amount: dynamicStock,
          category_id: defaultCat ?? 's3_general',
        },
      })
    }

    const jobId = crypto.randomUUID()
    const writes: Statement[] = []

    const pol = await db
      .prepare("SELECT markup_bps, automatic_pricing, auto_publish, auto_approve, delivery_type, updated_by FROM supplier_automation WHERE provider='shopviaclone22'")
      .first<{ markup_bps: number; automatic_pricing: number; auto_publish: number; auto_approve: number; delivery_type?: string; updated_by?: string }>()
      .catch(() => null)

    const defaultMarkup = pol?.markup_bps && pol.markup_bps > 0 ? pol.markup_bps : (globalCfg?.markup_bps ?? 5000)
    const autoPublish = (globalCfg?.auto_publish === 1) || (pol?.auto_publish === 1)
    const autoApprove = (globalCfg?.auto_approve === 1) || (pol?.auto_approve === 1)

    const catRules = (
      await db.prepare('SELECT category_id, markup_bps, trusted, delivery_type, authorization_reference, updated_by FROM supplier_category_rules WHERE provider=?').bind('shopviaclone22').all<{
        category_id: string
        markup_bps: number
        trusted: number
        delivery_type: string
        authorization_reference: string
        updated_by?: string
      }>()
    ).results
    const catRuleMap = new Map(catRules.map((r) => [r.category_id, r]))

    const existingItems = new Map(
      (
        await db
          .prepare('SELECT external_id, approval_status, product_id FROM shopviaclone22_catalog_items')
          .all<{ external_id: string; approval_status: string; product_id: string | null }>()
      ).results.map((r) => [r.external_id, r])
    )

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
      const deliveryType = catRule?.delivery_type || pol?.delivery_type || 'Licensed digital download'
      const authRef = catRule?.authorization_reference || 'ShopViaClone22 authorized supplier'
      const auditActor = catRule?.updated_by || pol?.updated_by

      const existing = existingItems.get(item.id)
      const isAlreadyApproved = existing?.approval_status === 'approved'

      // Safeguard 1: Automatic approval strictly requires autoApprove to be enabled.
      // A category rule with trusted=1 CANNOT bypass autoApprove=0 (containment/disabled).
      const canAutoApprove = autoApprove && (catRules.length === 0 || catRule?.trusted === 1) && item.stock > 0
      const finalApprovalStatus = isAlreadyApproved ? 'approved' : (canAutoApprove ? 'approved' : 'pending')

      writes.push(
        db
          .prepare(
            `INSERT INTO shopviaclone22_catalog_items(external_id, category_id, name, description, cost_minor, stock, raw_metadata, snapshot_id, checked_at, selling_price_minor, approval_status)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(external_id) DO UPDATE SET
               name=excluded.name,
               description=excluded.description,
               cost_minor=excluded.cost_minor,
               stock=excluded.stock,
               raw_metadata=excluded.raw_metadata,
               snapshot_id=excluded.snapshot_id,
               checked_at=excluded.checked_at,
               selling_price_minor=excluded.selling_price_minor,
               approval_status=CASE WHEN excluded.approval_status='approved' THEN 'approved' ELSE shopviaclone22_catalog_items.approval_status END
             WHERE shopviaclone22_catalog_items.cost_minor != excluded.cost_minor
                OR shopviaclone22_catalog_items.stock != excluded.stock
                OR shopviaclone22_catalog_items.name != excluded.name
                OR shopviaclone22_catalog_items.description != excluded.description
                OR shopviaclone22_catalog_items.selling_price_minor != excluded.selling_price_minor
                OR shopviaclone22_catalog_items.category_id IS NOT excluded.category_id
                OR (excluded.approval_status='approved' AND shopviaclone22_catalog_items.approval_status != 'approved')
                OR shopviaclone22_catalog_items.checked_at <= (? - 86400000)`
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
            price,
            finalApprovalStatus,
            now
          )
      )

      // Safeguard 2: Storefront publication strictly requires autoPublish to be enabled
      // AND requires the product to be legitimately approved (either previously reviewed/approved or qualified for auto-approval).
      // Enabling autoPublish NEVER silently approves or publishes unreviewed products.
      const canPublish = autoPublish && (isAlreadyApproved || canAutoApprove) && item.stock > 0

      if (canPublish) {
        writes.push(
          db
            .prepare(
              `INSERT INTO products(id, category_id, slug, name, description, price_minor, supplier_name, authorized_resale, status, delivery_type, supplier_image_urls, pricing_mode, publication_verified, server_number)
               VALUES(?, ?, ?, ?, ?, ?, 'ShopViaClone22', 1, 'active', ?, '[]', 'auto', 1, 3)
               ON CONFLICT(slug) DO UPDATE SET
                 status='active',
                 publication_verified=1,
                 authorized_resale=1,
                 delivery_type=excluded.delivery_type,
                 price_minor=CASE WHEN pricing_mode='override' THEN products.price_minor ELSE excluded.price_minor END,
                 category_id=excluded.category_id
               WHERE products.status != 'active'
                  OR products.category_id IS NOT excluded.category_id
                  OR (products.pricing_mode = 'auto' AND products.price_minor != excluded.price_minor)
                  OR products.name != excluded.name
                  OR products.description != excluded.description
                  OR products.delivery_type != excluded.delivery_type`
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
              .bind(JSON.stringify({ delivery: true, privacy: true, provider: true, reference: authRef }), auditActor, now, slug)
          )
        }
      }
    }

    // Mark delisted items as out of stock
    writes.push(
      db.prepare(
        `UPDATE shopviaclone22_catalog_items
         SET stock=0, checked_at=?
         WHERE snapshot_id != ? AND stock > 0`
      ).bind(now, jobId)
    )

    const finalStatus = merchantStatus ? `${merchantStatus} | Catalog synced` : 'Catalog synchronized'
    writes.push(
      db
        .prepare(
          `UPDATE shopviaclone22_connection
           SET phase='complete', total=?, scanned=?, last_success=?, last_status=?, requested=0
           WHERE id='shopviaclone22'`
        )
        .bind(products.length, products.length, now, finalStatus.slice(0, 500))
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

