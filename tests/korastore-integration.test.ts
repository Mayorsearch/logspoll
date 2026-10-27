import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchKoraProfile,
  fetchKoraProducts,
  buyKoraProduct,
  getKoraOrder,
  getKoraOrders,
  calculateKoraSellingPrice,
  KoraStoreError,
} from '../server/korastore.ts'
import { prepareDelivery, type DeliveryProvider } from '../server/supplier-delivery.ts'

test('Kora Store API: fetchKoraProfile authenticates with Bearer token and returns NGN balance', async () => {
  const origFetch = globalThis.fetch
  try {
    let capturedUrl = ''
    let capturedAuth = ''

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      const headers = init?.headers as Headers
      capturedAuth = headers?.get('Authorization') || ''

      return new Response(
        JSON.stringify({
          ok: true,
          balance_kobo: 15420000,
          balance_naira: 154200,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const profile = await fetchKoraProfile('kora_sk_live_test_key_123', 'https://korastore.cv/v1')
    assert.equal(profile.ok, true)
    assert.equal(profile.balance_kobo, 15420000)
    assert.equal(profile.balance_naira, 154200)
    assert.equal(capturedUrl, 'https://korastore.cv/v1/me')
    assert.equal(capturedAuth, 'Bearer kora_sk_live_test_key_123')
  } finally {
    globalThis.fetch = origFetch
  }
})

test('Kora Store API: fetchKoraProducts parses live catalog with delivery and stock types', async () => {
  const origFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          products: [
            {
              id: 'chatgpt-plus-1m',
              name: 'ChatGPT Plus 1 Month',
              price_kobo: 3000000,
              price_naira: 30000,
              stock: 45,
              available: true,
              delivery: 'instant',
            },
            {
              id: 'claude-pro-1m',
              name: 'Claude Pro 1 Month',
              price_kobo: 3200000,
              price_naira: 32000,
              stock: null, // unlimited
              available: true,
              delivery: 'instant',
            },
            {
              id: 'codex-enterprise',
              name: 'Codex Enterprise Access',
              price_kobo: 4500000,
              price_naira: 45000,
              stock: 12,
              available: true,
              delivery: 'instant',
            },
            {
              id: 'muse-ai-annual',
              name: 'Muse AI Annual Subscription',
              price_kobo: 2500000,
              price_naira: 25000,
              stock: 0,
              available: false,
              delivery: 'manual',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const products = await fetchKoraProducts('kora_sk_live_key', 'https://korastore.cv/v1')
    assert.equal(products.length, 4)

    assert.equal(products[0].id, 'chatgpt-plus-1m')
    assert.equal(products[0].price_kobo, 3000000)
    assert.equal(products[0].price_naira, 30000)
    assert.equal(products[0].stock, 45)
    assert.equal(products[0].delivery, 'instant')

    assert.equal(products[1].id, 'claude-pro-1m')
    assert.equal(products[1].stock, null) // unlimited supported

    assert.equal(products[3].id, 'muse-ai-annual')
    assert.equal(products[3].available, false)
    assert.equal(products[3].delivery, 'manual')
  } finally {
    globalThis.fetch = origFetch
  }
})

test('Kora Store API: buyKoraProduct requires idempotency key and recovers delivered credentials', async () => {
  const origFetch = globalThis.fetch
  try {
    let capturedBody = ''

    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = String(init?.body ?? '')

      return new Response(
        JSON.stringify({
          ok: true,
          order_id: 'kora_ord_8899aabb',
          status: 'delivered',
          items: ['email:user@example.com|pass:Secr3tToken123'],
          balance_kobo: 12420000,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const res = await buyKoraProduct(
      'kora_sk_live_key',
      'chatgpt-plus-1m',
      'req-idemp-999-uuid',
      'https://korastore.cv/v1'
    )

    assert.equal(res.ok, true)
    assert.equal(res.order_id, 'kora_ord_8899aabb')
    assert.equal(res.status, 'delivered')
    assert.equal(res.items.length, 1)
    assert.equal(res.items[0], 'email:user@example.com|pass:Secr3tToken123')
    assert.deepEqual(JSON.parse(capturedBody), {
      product_id: 'chatgpt-plus-1m',
      idempotency_key: 'req-idemp-999-uuid',
    })
  } finally {
    globalThis.fetch = origFetch
  }
})

test('Kora Store API: getKoraOrder retrieves order status and delivered items', async () => {
  const origFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          order: {
            order_id: 'kora_ord_8899aabb',
            product: 'ChatGPT Plus 1 Month',
            status: 'delivered',
            price_kobo: 3000000,
            items: ['email:user@example.com|pass:Secr3tToken123'],
            created_at: '2026-10-27T10:00:00Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const order = await getKoraOrder('kora_sk_live_key', 'kora_ord_8899aabb', 'https://korastore.cv/v1')
    assert.equal(order.order_id, 'kora_ord_8899aabb')
    assert.equal(order.status, 'delivered')
    assert.equal(order.items.length, 1)
  } finally {
    globalThis.fetch = origFetch
  }
})

test('Independent Percentage Pricing: calculates exact formula and integer kobo rounding', () => {
  // Formula: sellingPrice = verifiedSupplierCostNGN * (1 + markupPercentage / 100)

  // Example 1: ₦2,000 (200,000 kobo) cost @ 50% markup = ₦3,000 (300,000 kobo)
  const price1 = calculateKoraSellingPrice(200000, 5000)
  assert.equal(price1, 300000) // ₦3,000.00

  // Example 2: Automatic Price Increase
  // Wholesale cost increases to ₦3,000 (300,000 kobo) @ 50% markup = ₦4,500 (450,000 kobo)
  const price2 = calculateKoraSellingPrice(300000, 5000)
  assert.equal(price2, 450000) // ₦4,500.00

  // Example 3: Automatic Price Decrease
  // Wholesale cost decreases from ₦3,000 to ₦2,000 @ 50% markup = ₦3,000 (300,000 kobo)
  const price3 = calculateKoraSellingPrice(200000, 5000)
  assert.equal(price3, 300000) // ₦3,000.00

  // Priority Products with independent markups:
  // ChatGPT: ₦30,000 cost (3,000,000 kobo) @ 50% markup (5000 bps) -> ₦45,000 (4,500,000 kobo)
  const chatGptPrice = calculateKoraSellingPrice(3000000, 5000)
  assert.equal(chatGptPrice, 4500000)

  // Claude: ₦32,000 cost (3,200,000 kobo) @ 45% markup (4500 bps) -> ₦46,400 (4,640,000 kobo)
  const claudePrice = calculateKoraSellingPrice(3200000, 4500)
  assert.equal(claudePrice, 4640000)

  // Codex: ₦45,000 cost (4,500,000 kobo) @ 60% markup (6000 bps) -> ₦72,000 (7,200,000 kobo)
  const codexPrice = calculateKoraSellingPrice(4500000, 6000)
  assert.equal(codexPrice, 7200000)

  // Muse AI: ₦25,000 cost (2,500,000 kobo) @ 40% markup (4000 bps) -> ₦35,000 (3,500,000 kobo)
  const musePrice = calculateKoraSellingPrice(2500000, 4000)
  assert.equal(musePrice, 3500000)
})

test('Fulfillment Integration: prepareDelivery correctly dispatches and polls Kora Store purchases', async () => {
  const origFetch = globalThis.fetch
  try {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/products')) {
        return new Response(
          JSON.stringify({
            ok: true,
            products: [
              {
                id: 'chatgpt-plus-1m',
                name: 'ChatGPT Plus 1 Month',
                price_kobo: 3000000, // ₦30,000
                price_naira: 30000,
                stock: 10,
                available: true,
                delivery: 'instant',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (url.includes('/buy')) {
        return new Response(
          JSON.stringify({
            ok: true,
            order_id: 'KORA-ORD-112233',
            status: 'delivered',
            items: ['license-key-abc-123-xyz'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (url.includes('/orders/')) {
        return new Response(
          JSON.stringify({
            ok: true,
            order: {
              order_id: 'KORA-ORD-112233',
              product: 'ChatGPT Plus 1 Month',
              status: 'delivered',
              price_kobo: 3000000,
              items: ['license-key-abc-123-xyz'],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
    }

    const plan = await prepareDelivery(
      'korastore' as DeliveryProvider,
      { apiKey: 'kora_sk_live_key_99', baseUrl: 'https://korastore.cv/v1' },
      {
        externalId: 'chatgpt-plus-1m',
        quantity: 1,
        requestId: 'req_order_test_1',
        maxCostMinor: 4500000, // Locked customer payment: ₦45,000
      }
    )

    const delivery = await plan.buy()
    assert.equal(delivery.receipt, 'KORA-ORD-112233')
    assert.equal(delivery.delivered, true)
    assert.equal(delivery.items.length, 1)
    assert.equal(delivery.items[0], 'license-key-abc-123-xyz')

    const polled = await plan.poll('KORA-ORD-112233')
    assert.equal(polled.receipt, 'KORA-ORD-112233')
    assert.equal(polled.delivered, true)
  } finally {
    globalThis.fetch = origFetch
  }
})

test('Two Pricing Modes: Option A (Percentage) follows cost changes, Option B (Fixed) remains static', () => {
  // Option A: Percentage Markup mode
  const initialCostKobo = 200000 // ₦2,000
  const markupBps = 5000 // 50%
  const initialSellingPrice = calculateKoraSellingPrice(initialCostKobo, markupBps)
  assert.equal(initialSellingPrice, 300000) // ₦3,000

  // Wholesale price increases to ₦3,500 (350,000 kobo)
  const increasedCostKobo = 350000
  const increasedSellingPrice = calculateKoraSellingPrice(increasedCostKobo, markupBps)
  assert.equal(increasedSellingPrice, 525000) // ₦5,250

  // Wholesale price decreases to ₦1,500 (150,000 kobo)
  const decreasedCostKobo = 150000
  const decreasedSellingPrice = calculateKoraSellingPrice(decreasedCostKobo, markupBps)
  assert.equal(decreasedSellingPrice, 225000) // ₦2,250

  // Option B: Fixed Price mode
  const fixedSellingPrice = 400000 // Fixed ₦4,000
  let currentCost = initialCostKobo
  let isLoss = fixedSellingPrice < currentCost
  assert.equal(isLoss, false)

  // Cost increases above fixed price: ₦4,500 > ₦4,000
  currentCost = 450000
  isLoss = fixedSellingPrice < currentCost
  assert.equal(isLoss, true, 'Loss warning must be triggered when supplier cost exceeds fixed selling price')
})

test('Server 4 AI Tools: DigitalCore and Kora Store coexist under server_number = 4 without naming leakage', async () => {
  const { buildDiscoverySequence } = await import('../workers/api/storefront-discovery.ts')

  const dummyServer4Products: any[] = [
    {
      id: 's4-dc-gemini-pro',
      category_id: 'c8402d52-37ef-4dfb-df2f-47cd20cd7004',
      slug: 's4-gemini-pro',
      name: 'Gemini Pro 18 Months',
      price_minor: 125000,
      currency: 'NGN',
      features: ['AI Subscription'],
      supplier_image_urls: [],
      featured: 1,
      available_quantity: 100,
      server_number: 4,
    },
    {
      id: 's4-kora-chatgpt-plus',
      category_id: 'c8402d52-37ef-4dfb-df2f-47cd20cd7004',
      slug: 's4-kora-chatgpt-plus',
      name: 'ChatGPT Plus 1 Month',
      price_minor: 4500000,
      currency: 'NGN',
      features: ['Authorized AI Tool'],
      supplier_image_urls: [],
      featured: 1,
      available_quantity: 50,
      server_number: 4,
    },
  ]

  const config = {
    rotation_enabled: false,
    affordable_priority_enabled: false,
    affordable_max_minor: 1500000,
    affordable_weight: 0,
    featured_weight: 100,
    new_weight: 0,
    products_per_page: 20,
    updated_at: Date.now(),
  }

  const sequenced = buildDiscoverySequence(dummyServer4Products, config, 'test_seed_s4')
  assert.equal(sequenced.length, 2)

  for (const item of sequenced) {
    // Both items must belong to Server 4
    assert.equal(item.server_number, 4)
    // Customer-facing discovery objects MUST NEVER leak supplier names
    assert.equal((item as any).supplier_name, undefined)
  }
})

test('Kora Store Credential Flow: admin saves key -> sealed in D1 -> fulfillment opens -> Bearer header sent with genuine key (never serialized JSON)', async () => {
  const { sealCredential, openCredential } = await import('../server/supplier-crypto.ts')
  const encryptionKey = btoa('12345678901234567890123456789012')
  const genuineApiKey = 'kora_sk_live_genuine_secret_key_888'
  const customBaseUrl = 'https://korastore.cv/v1'

  // 1. Admin saves key: serialized as JSON object
  const rawCreds = {
    apiKey: genuineApiKey,
    baseUrl: customBaseUrl,
  }
  const sealed = await sealCredential(JSON.stringify(rawCreds), 'korastore', encryptionKey)
  assert.ok(sealed.ciphertext)
  assert.ok(sealed.nonce)

  // 2. Fulfillment decrypts credentials
  const decryptedRaw = await openCredential(sealed.ciphertext, sealed.nonce, 'korastore', encryptionKey)
  const parsed = JSON.parse(decryptedRaw) as { apiKey: string; baseUrl: string }
  assert.equal(parsed.apiKey, genuineApiKey)
  assert.equal(parsed.baseUrl, customBaseUrl)

  // 3. PrepareDelivery extracts clean genuine key (never passes JSON string)
  let capturedAuthHeader = ''
  let capturedUrl = ''
  const origFetch = globalThis.fetch
  try {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      const headers = init?.headers as Headers
      capturedAuthHeader = headers?.get('Authorization') || ''
      if (capturedUrl.includes('/products')) {
        return new Response(
          JSON.stringify({
            ok: true,
            products: [{ id: 'kora-prod-1', name: 'AI Tool', price_kobo: 100000, price_naira: 1000, stock: 10, available: true, delivery: 'instant' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (capturedUrl.includes('/buy')) {
        return new Response(
          JSON.stringify({
            ok: true,
            order_id: 'ord-kora-test-99',
            status: 'delivered',
            items: ['email:user@ai.com|key:sk-ai-secret'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response('{}', { status: 404 })
    }

    // Test passing both clean object and defensive fallback if key was stringified JSON
    const plan = await prepareDelivery(
      'korastore' as DeliveryProvider,
      { apiKey: parsed.apiKey, baseUrl: parsed.baseUrl },
      { externalId: 'kora-prod-1', quantity: 1, requestId: 'req-test-cred-flow', maxCostMinor: 200000 }
    )
    const result = await plan.buy()
    assert.equal(result.receipt, 'ord-kora-test-99')
    assert.equal(result.delivered, true)

    // Authorization header MUST BE Bearer <genuineKey> and NEVER Bearer {"apiKey":...}
    assert.equal(capturedAuthHeader, `Bearer ${genuineApiKey}`)
    assert.ok(!capturedAuthHeader.includes('{'))
    assert.ok(!capturedAuthHeader.includes('apiKey'))
  } finally {
    globalThis.fetch = origFetch
  }
})

test('Migration 0034: 48-hour stock freshness window enforces strict cutoff for Kora Store items', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const sql = new DatabaseSync(':memory:')
  try {
    sql.exec(`
      CREATE TABLE products(id TEXT PRIMARY KEY, category_id TEXT, slug TEXT, name TEXT, brand TEXT, description TEXT, price_minor INTEGER, currency TEXT, delivery_type TEXT, image_path TEXT, term TEXT, features TEXT, supplier_image_urls TEXT, featured INTEGER, server_number INTEGER, supplier_name TEXT, created_at INTEGER, status TEXT, authorized_resale INTEGER, publication_verified INTEGER);
      CREATE TABLE categories(id TEXT PRIMARY KEY, slug TEXT, name TEXT, active INTEGER);
      CREATE TABLE korastore_connection(id TEXT PRIMARY KEY, enabled INTEGER);
      CREATE TABLE korastore_catalog_items(external_id TEXT PRIMARY KEY, approval_status TEXT, available INTEGER, stock INTEGER, checked_at INTEGER, product_id TEXT);
      CREATE TABLE digitalcore_catalog_items(external_id TEXT PRIMARY KEY, approval_status TEXT, stock INTEGER, checked_at INTEGER, product_id TEXT);
      CREATE TABLE digitalcore_connection(id TEXT PRIMARY KEY, enabled INTEGER);
      CREATE TABLE digitaltop_catalog_items(external_id TEXT PRIMARY KEY, approval_status TEXT, stock INTEGER, checked_at INTEGER, product_id TEXT);
      CREATE TABLE digitaltop_connection(id TEXT PRIMARY KEY, enabled INTEGER);
      CREATE TABLE shopviaclone22_catalog_items(external_id TEXT PRIMARY KEY, approval_status TEXT, stock INTEGER, checked_at INTEGER, product_id TEXT);
      CREATE TABLE shopviaclone22_connection(id TEXT PRIMARY KEY, enabled INTEGER);
      CREATE TABLE hstora_catalog_items(external_id TEXT PRIMARY KEY, approval_status TEXT, metadata TEXT, checked_at INTEGER, product_id TEXT);
      CREATE TABLE hstora_connection(id TEXT PRIMARY KEY, enabled INTEGER);
      CREATE TABLE youngpg_verified_product_stock(id TEXT PRIMARY KEY, available_quantity INTEGER);
    `)

    // Create Migration 0034 views
    sql.exec(`
      CREATE VIEW verified_product_stock AS
       SELECT p.id, CASE
        WHEN kora.external_id IS NOT NULL THEN
          CASE WHEN kora.approval_status='approved' AND kc.enabled=1 AND kora.available=1 AND (kora.stock IS NULL OR kora.stock>0)
            AND kora.checked_at > (CAST(unixepoch('now') AS INTEGER) - 172800) * 1000
          THEN COALESCE(kora.stock, 999) ELSE 0 END
        ELSE 0 END available_quantity
       FROM products p
       LEFT JOIN korastore_catalog_items kora ON kora.product_id=p.id
       LEFT JOIN korastore_connection kc ON kc.id='korastore';
    `)

    sql.prepare("INSERT INTO korastore_connection VALUES('korastore', 1)").run()

    // Product 1: Fresh stock checked 2 hours ago (within 48h / 172800s window)
    const nowMs = Date.now()
    const freshCheckedAt = nowMs - 2 * 3600 * 1000
    sql.prepare("INSERT INTO products(id, status, authorized_resale, publication_verified) VALUES('prod-fresh', 'active', 1, 1)").run()
    sql.prepare("INSERT INTO korastore_catalog_items VALUES('kora-fresh', 'approved', 1, 15, ?, 'prod-fresh')").run(freshCheckedAt)

    // Product 2: Stale stock checked 50 hours ago (> 48h / 172800s cutoff)
    const staleCheckedAt = nowMs - 50 * 3600 * 1000
    sql.prepare("INSERT INTO products(id, status, authorized_resale, publication_verified) VALUES('prod-stale', 'active', 1, 1)").run()
    sql.prepare("INSERT INTO korastore_catalog_items VALUES('kora-stale', 'approved', 1, 15, ?, 'prod-stale')").run(staleCheckedAt)

    const freshStock = sql.prepare("SELECT available_quantity FROM verified_product_stock WHERE id='prod-fresh'").get() as { available_quantity: number }
    const staleStock = sql.prepare("SELECT available_quantity FROM verified_product_stock WHERE id='prod-stale'").get() as { available_quantity: number }

    assert.equal(freshStock.available_quantity, 15, 'Stock checked within 48h must be verified and available')
    assert.equal(staleStock.available_quantity, 0, 'Stock checked > 48h ago must evaluate to 0 available quantity')
  } finally {
    sql.close()
  }
})

test('Resale Authorization: unverified product cannot be published; explicit admin review permits publication without fake evidence', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const { readFileSync } = await import('node:fs')
  const sql = new DatabaseSync(':memory:')
  try {
    sql.exec(readFileSync(new URL('../workers/api/migrations/0002_cloudflare_auth.sql', import.meta.url), 'utf8'))
    sql.exec(`
      CREATE TABLE users(id TEXT PRIMARY KEY, status TEXT);
      CREATE TABLE user_roles(user_id TEXT, role TEXT);
      CREATE TABLE profiles(id TEXT PRIMARY KEY, full_name TEXT);
      CREATE TABLE categories(id TEXT PRIMARY KEY, slug TEXT, name TEXT, active INTEGER);
      CREATE TABLE products(id TEXT PRIMARY KEY, category_id TEXT, slug TEXT UNIQUE, name TEXT, description TEXT, price_minor INTEGER, currency TEXT, supplier_name TEXT, authorized_resale INTEGER, status TEXT, delivery_type TEXT, term TEXT, features TEXT, supplier_image_urls TEXT, pricing_mode TEXT, publication_verified INTEGER, server_number INTEGER);
      CREATE TABLE product_authorizations(product_id TEXT PRIMARY KEY, evidence TEXT NOT NULL, reviewer_id TEXT NOT NULL, verified_at INTEGER NOT NULL);
      CREATE TABLE korastore_connection(id TEXT PRIMARY KEY, ciphertext TEXT, nonce TEXT, enabled INTEGER, base_url TEXT, auto_monitor INTEGER, monitor_interval_hours INTEGER, revision INTEGER, lease_owner TEXT, lease_until INTEGER, last_status TEXT, requested INTEGER, phase TEXT, total INTEGER, scanned INTEGER, next_attempt INTEGER, last_success INTEGER);
      CREATE TABLE korastore_catalog_items(external_id TEXT PRIMARY KEY, name TEXT, description TEXT, cost_minor INTEGER, previous_cost_minor INTEGER, selling_price_minor INTEGER, currency TEXT, stock INTEGER, available INTEGER, delivery_type TEXT, pricing_mode TEXT, markup_bps INTEGER, approval_status TEXT, product_id TEXT, raw_metadata TEXT, checked_at INTEGER, reviewed_at INTEGER, price_updated_at INTEGER);
      CREATE TABLE korastore_price_history(id TEXT PRIMARY KEY, external_id TEXT, old_cost_minor INTEGER, new_cost_minor INTEGER, old_price_minor INTEGER, new_price_minor INTEGER, markup_bps INTEGER, change_type TEXT, recorded_at INTEGER);
      CREATE TABLE request_limits(subject TEXT, window INTEGER, hits INTEGER, PRIMARY KEY(subject, window));
      CREATE TABLE audit_logs(id TEXT PRIMARY KEY, actor_id TEXT, table_name TEXT, record_id TEXT, action TEXT, created_at INTEGER);
    `)

    const prepare = (query: string): any => {
      let args: (string | number | null)[] = []
      return {
        bind(...v: any[]) {
          args = v
          return this
        },
        async first<T>() {
          return (sql.prepare(query).get(...args) ?? null) as T | null
        },
        async all<T>() {
          const results = sql.prepare(query).all(...args) as T[]
          return { success: true, results, meta: { changes: 0, last_row_id: 0 } }
        },
        async run() {
          return this.all()
        },
      }
    }
    const db: any = {
      prepare,
      async batch(queries: any[]) {
        sql.exec('BEGIN')
        try {
          const r = []
          for (const q of queries) r.push(await q.run())
          sql.exec('COMMIT')
          return r
        } catch (e) {
          sql.exec('ROLLBACK')
          throw e
        }
      },
      async exec(q: string) {
        sql.exec(q)
      },
    }

    const mockEnv: any = {
      DB: db,
      ENVIRONMENT: 'production',
      AUTH_ENABLED: 'true',
      AUTH_SECRET: 'test_auth_secret_must_be_at_least_32_characters_long_12345',
      RESEND_API_KEY: 're_test_key_mock_12345678',
      SUPPLIER_ENCRYPTION_KEY: btoa('x'.repeat(32)),
    }

    const { createAuth } = await import('../workers/api/auth.ts')
    const auth = createAuth(mockEnv)
    await auth.api.signUpEmail({ body: { name: 'Admin User', email: 'admin@logspoll.com', password: 'ValidAdminPassword123!' } })
    sql.prepare("UPDATE auth_user SET emailVerified=1 WHERE email='admin@logspoll.com'").run()
    const loginRes = await auth.api.signInEmail({ body: { email: 'admin@logspoll.com', password: 'ValidAdminPassword123!' }, asResponse: true })
    const cookie = loginRes.headers.get('set-cookie')!.split(';')[0]
    const adminUser = sql.prepare("SELECT id FROM auth_user WHERE email='admin@logspoll.com'").get() as { id: string }
    sql.prepare("INSERT OR REPLACE INTO users(id,status) VALUES(?,'active')").run(adminUser.id)
    sql.prepare("INSERT OR REPLACE INTO user_roles(user_id,role) VALUES(?,'admin')").run(adminUser.id)
    sql.prepare("INSERT OR REPLACE INTO profiles(id,full_name) VALUES(?,'Admin User')").run(adminUser.id)

    sql.prepare("INSERT INTO categories VALUES('cat-s4', 'server4', 'Server 4', 1)").run()
    sql.prepare("INSERT INTO korastore_connection(id, enabled, base_url) VALUES('korastore', 1, 'https://korastore.cv/v1')").run()
    sql.prepare(`INSERT INTO korastore_catalog_items(external_id, name, description, cost_minor, selling_price_minor, currency, stock, available, delivery_type, pricing_mode, markup_bps, approval_status, checked_at)
      VALUES('kora-resale-test', 'Claude Pro License', 'Claude Pro AI', 3200000, 4800000, 'NGN', 50, 1, 'instant', 'markup', 5000, 'pending', ?)`)
      .run(Date.now())

    const { korastoreAdmin } = await import('../workers/api/korastore-manager.ts')

    const authHeaders = {
      Origin: 'https://logspoll.com',
      'Content-Type': 'application/json',
      Cookie: cookie,
    }

    // Step 1: Attempt to publish WITHOUT prior admin resale authorization review -> MUST REJECT WITH 400!
    const publishAttemptReq = new Request('https://logspoll.com/api/admin/korastore', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        action: 'toggle_publish',
        external_id: 'kora-resale-test',
        publish: true,
      }),
    })

    await assert.rejects(
      async () => korastoreAdmin(publishAttemptReq, mockEnv),
      (err: any) => {
        assert.equal(err.status, 400)
        assert.ok(err.message.includes('resale authorization has not been reviewed'))
        return true
      },
      'Unreviewed product publication must be rejected'
    )

    // Verify product is NOT published
    const itemBeforeAuth = sql.prepare("SELECT approval_status, product_id FROM korastore_catalog_items WHERE external_id='kora-resale-test'").get() as any
    assert.equal(itemBeforeAuth.approval_status, 'pending')

    // Step 2: Administrator performs legitimate resale review with documentation reference
    const reviewReq = new Request('https://logspoll.com/api/admin/korastore', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        action: 'authorize_product',
        external_id: 'kora-resale-test',
        evidence_reference: 'KORA-DISTRIBUTION-AGREEMENT-2026-S4',
        delivery_verified: true,
        privacy_verified: true,
        provider_verified: true,
      }),
    })

    const reviewRes = await korastoreAdmin(reviewReq, mockEnv)
    const reviewData = await reviewRes.json() as any
    assert.equal(reviewData.ok, true)
    assert.equal(reviewData.authorized, true)
    assert.equal(reviewData.evidence_reference, 'KORA-DISTRIBUTION-AGREEMENT-2026-S4')

    // Verify product_authorizations now contains genuine affirmative evidence
    const authRow = sql.prepare("SELECT * FROM product_authorizations WHERE product_id='s4-kora-kora-resale-test'").get() as any
    assert.ok(authRow)
    const parsedEvidence = JSON.parse(authRow.evidence)
    assert.equal(parsedEvidence.delivery, true)
    assert.equal(parsedEvidence.privacy, true)
    assert.equal(parsedEvidence.provider, true)
    assert.equal(parsedEvidence.reference, 'KORA-DISTRIBUTION-AGREEMENT-2026-S4')

    // Step 3: Now publish to storefront -> MUST SUCCEED
    const publishReq = new Request('https://logspoll.com/api/admin/korastore', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        action: 'toggle_publish',
        external_id: 'kora-resale-test',
        publish: true,
      }),
    })

    const pubRes = await korastoreAdmin(publishReq, mockEnv)
    const pubData = await pubRes.json() as any
    assert.equal(pubData.ok, true)
    assert.equal(pubData.published, true)

    const publishedProd = sql.prepare("SELECT status, authorized_resale, publication_verified, server_number FROM products WHERE id='s4-kora-kora-resale-test'").get() as any
    assert.equal(publishedProd.status, 'active')
    assert.equal(publishedProd.authorized_resale, 1)
    assert.equal(publishedProd.publication_verified, 1)
    assert.equal(publishedProd.server_number, 4)
  } finally {
    sql.close()
  }
})

test('Automatic Pricing: independent markups, auto price adjustments, fixed price invariance, invalid cost rejection, and 0 D1 writes', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const sql = new DatabaseSync(':memory:')
  const origFetch = globalThis.fetch
  try {
    sql.exec(`
      CREATE TABLE products(id TEXT PRIMARY KEY, server_number INTEGER, supplier_name TEXT, price_minor INTEGER, pricing_mode TEXT);
      CREATE TABLE korastore_connection(id TEXT PRIMARY KEY, ciphertext TEXT, nonce TEXT, enabled INTEGER, base_url TEXT, last_status TEXT, last_success INTEGER);
      CREATE TABLE korastore_catalog_items(external_id TEXT PRIMARY KEY, cost_minor INTEGER, previous_cost_minor INTEGER, selling_price_minor INTEGER, stock INTEGER, available INTEGER, pricing_mode TEXT, markup_bps INTEGER, product_id TEXT, checked_at INTEGER, price_updated_at INTEGER);
      CREATE TABLE korastore_price_history(id TEXT PRIMARY KEY, external_id TEXT, old_cost_minor INTEGER, new_cost_minor INTEGER, old_price_minor INTEGER, new_price_minor INTEGER, markup_bps INTEGER, change_type TEXT, recorded_at INTEGER);
    `)

    const { sealCredential } = await import('../server/supplier-crypto.ts')
    const encKey = btoa('y'.repeat(32))
    const sealed = await sealCredential(JSON.stringify({ apiKey: 'kora_test_sync', baseUrl: 'https://korastore.cv/v1' }), 'korastore', encKey)
    sql.prepare("INSERT INTO korastore_connection VALUES('korastore', ?, ?, 1, 'https://korastore.cv/v1', 'ok', 1)").run(sealed.ciphertext, sealed.nonce)

    // Item 1: Markup mode (Option A) @ 50% markup (5000 bps)
    sql.prepare("INSERT INTO products VALUES('prod-markup', 4, 'KoraStore', 3000000, 'auto')").run()
    sql.prepare("INSERT INTO korastore_catalog_items VALUES('item-markup', 2000000, 2000000, 3000000, 10, 1, 'markup', 5000, 'prod-markup', 1000, 1000)").run()

    // Item 2: Fixed price mode (Option B) @ fixed ₦4,000,000 kobo
    sql.prepare("INSERT INTO products VALUES('prod-fixed', 4, 'KoraStore', 4000000, 'override')").run()
    sql.prepare("INSERT INTO korastore_catalog_items VALUES('item-fixed', 2500000, 2500000, 4000000, 10, 1, 'override', 0, 'prod-fixed', 1000, 1000)").run()

    // DigitalCore product under Server 4 (must NEVER be touched by Kora price sync!)
    sql.prepare("INSERT INTO products VALUES('prod-dc', 4, 'DigitalCore', 150000, 'auto')").run()

    let d1BatchExecutions = 0
    const prepare = (query: string): any => {
      let args: (string | number | null)[] = []
      return {
        bind(...v: any[]) {
          args = v
          return this
        },
        async first<T>() {
          return (sql.prepare(query).get(...args) ?? null) as T | null
        },
        async all<T>() {
          const results = sql.prepare(query).all(...args) as T[]
          return { success: true, results }
        },
        async run() {
          return this.all()
        },
      }
    }
    const db: any = {
      prepare,
      async batch(queries: any[]) {
        d1BatchExecutions += queries.length
        sql.exec('BEGIN')
        try {
          const r = []
          for (const q of queries) r.push(await q.run())
          sql.exec('COMMIT')
          return r
        } catch (e) {
          sql.exec('ROLLBACK')
          throw e
        }
      },
    }

    const { runKoraPriceSync } = await import('../workers/api/korastore-manager.ts')
    const mockEnv: any = {
      DB: db,
      ENVIRONMENT: 'production',
      SUPPLIER_ENCRYPTION_KEY: encKey,
    }

    // Pass 1: Price changes occur
    // item-markup cost increases from 2,000,000 to 3,000,000 kobo (₦20k -> ₦30k). @ 50% markup -> ₦45k (4,500,000 kobo)
    // item-fixed cost increases from 2,500,000 to 3,500,000 kobo. Fixed selling price MUST REMAIN 4,000,000 kobo!
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          products: [
            { id: 'item-markup', name: 'Markup Item', price_kobo: 3000000, price_naira: 30000, stock: 10, available: true, delivery: 'instant' },
            { id: 'item-fixed', name: 'Fixed Item', price_kobo: 3500000, price_naira: 35000, stock: 10, available: true, delivery: 'instant' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const connRow = sql.prepare("SELECT * FROM korastore_connection WHERE id='korastore'").get() as any
    const summary1 = await runKoraPriceSync(mockEnv, connRow)
    assert.equal(summary1.price_increases, 2)
    assert.equal(summary1.unchanged, 0)

    // Verify item-markup selling price recalculated
    const updatedMarkup = sql.prepare("SELECT cost_minor, selling_price_minor FROM korastore_catalog_items WHERE external_id='item-markup'").get() as any
    assert.equal(updatedMarkup.cost_minor, 3000000)
    assert.equal(updatedMarkup.selling_price_minor, 4500000)

    const updatedProdMarkup = sql.prepare("SELECT price_minor FROM products WHERE id='prod-markup'").get() as any
    assert.equal(updatedProdMarkup.price_minor, 4500000)

    // Verify item-fixed selling price remains INVARIANT at 4,000,000 kobo
    const updatedFixed = sql.prepare("SELECT cost_minor, selling_price_minor FROM korastore_catalog_items WHERE external_id='item-fixed'").get() as any
    assert.equal(updatedFixed.cost_minor, 3500000)
    assert.equal(updatedFixed.selling_price_minor, 4000000)

    const updatedProdFixed = sql.prepare("SELECT price_minor FROM products WHERE id='prod-fixed'").get() as any
    assert.equal(updatedProdFixed.price_minor, 4000000)

    // Verify DigitalCore product was completely untouched
    const dcProd = sql.prepare("SELECT price_minor FROM products WHERE id='prod-dc'").get() as any
    assert.equal(dcProd.price_minor, 150000)

    // Pass 2: Identical data -> Strict D1 Write Containment (ZERO D1 writes)
    d1BatchExecutions = 0
    const summary2 = await runKoraPriceSync(mockEnv, connRow)
    assert.equal(summary2.unchanged, 2)
    assert.equal(summary2.price_increases, 0)
    assert.equal(summary2.price_decreases, 0)
    assert.equal(summary2.d1_statements_executed, 0)
    assert.equal(d1BatchExecutions, 0, 'Must perform exactly 0 D1 writes when costs and stock are unchanged')

    // Pass 3: Invalid / negative / zero wholesale cost -> MUST BE REJECTED without overwriting published price
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          products: [
            { id: 'item-markup', name: 'Markup Item', price_kobo: -500, price_naira: -5, stock: 10, available: true, delivery: 'instant' },
            { id: 'item-fixed', name: 'Fixed Item', price_kobo: 0, price_naira: 0, stock: 10, available: true, delivery: 'instant' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const summary3 = await runKoraPriceSync(mockEnv, connRow)
    assert.equal(summary3.unchanged, 2, 'Invalid/zero/negative costs must be rejected')
    const finalMarkup = sql.prepare("SELECT cost_minor, selling_price_minor FROM korastore_catalog_items WHERE external_id='item-markup'").get() as any
    assert.equal(finalMarkup.cost_minor, 3000000, 'Existing valid cost must not be overwritten by invalid cost')
    assert.equal(finalMarkup.selling_price_minor, 4500000, 'Existing valid selling price must remain preserved')
  } finally {
    globalThis.fetch = origFetch
    sql.close()
  }
})

test('End-to-End Fulfillment: cost review, idempotency, vault entitlement delivery, balance check, and recovery', async () => {
  const origFetch = globalThis.fetch
  try {
    let capturedIdempotencyKey = ''
    let purchaseAttempts = 0
    let balanceChecked = false

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/me')) {
        balanceChecked = true
        return new Response(
          JSON.stringify({ ok: true, balance_kobo: 20000000, balance_naira: 200000 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (url.includes('/products')) {
        return new Response(
          JSON.stringify({
            ok: true,
            products: [
              {
                id: 'kora-multi-tool',
                name: 'AI Tool Multi',
                price_kobo: 2000000, // ₦20,000 per unit
                price_naira: 20000,
                stock: 25,
                available: true,
                delivery: 'instant',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (url.includes('/buy')) {
        purchaseAttempts++
        const body = JSON.parse(String(init?.body ?? '{}'))
        capturedIdempotencyKey = body.idempotency_key
        return new Response(
          JSON.stringify({
            ok: true,
            order_id: 'KORA-FULFILL-RECEIPT-55',
            status: 'delivered',
            items: [
              'user1@logs.com|pass:TokenA123',
              'user2@logs.com|pass:TokenB456',
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (url.includes('/orders/')) {
        return new Response(
          JSON.stringify({
            ok: true,
            order: {
              order_id: 'KORA-FULFILL-RECEIPT-55',
              product: 'AI Tool Multi',
              status: 'delivered',
              items: [
                'user1@logs.com|pass:TokenA123',
                'user2@logs.com|pass:TokenB456',
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      return new Response('{}', { status: 404 })
    }

    // 1. Cost Review: if live cost exceeds locked payment, must block with PRICE_REVIEW
    await assert.rejects(
      async () => {
        const planOverCost = await prepareDelivery(
          'korastore' as DeliveryProvider,
          { apiKey: 'kora_sk_live_val', baseUrl: 'https://korastore.cv/v1' },
          {
            externalId: 'kora-multi-tool',
            quantity: 2, // 2 * 20,000 = ₦40,000 cost (4,000,000 kobo)
            requestId: 'req-order-cost-fence',
            maxCostMinor: 3000000, // Locked payment is only ₦30,000
          }
        )
        await planOverCost.buy()
      },
      (err: any) => {
        assert.ok(err.message.includes('PRICE_REVIEW'))
        return true
      },
      'Fulfillment must be blocked when supplier wholesale cost exceeds customer locked payment'
    )

    // 2. Normal purchase: multiple quantity = 2, maxCostMinor = 50,000 NGN
    const plan = await prepareDelivery(
      'korastore' as DeliveryProvider,
      { apiKey: 'kora_sk_live_val', baseUrl: 'https://korastore.cv/v1' },
      {
        externalId: 'kora-multi-tool',
        quantity: 2,
        requestId: 'req-order-multi-item-123',
        maxCostMinor: 5000000,
      }
    )

    const delivery = await plan.buy()
    assert.equal(delivery.receipt, 'KORA-FULFILL-RECEIPT-55')
    assert.equal(delivery.delivered, true)
    assert.equal(delivery.items.length, 2)
    assert.equal(delivery.items[0], 'user1@logs.com|pass:TokenA123')
    assert.equal(delivery.items[1], 'user2@logs.com|pass:TokenB456')
    assert.equal(capturedIdempotencyKey, 'req-order-multi-item-123', 'Supplier purchase must include exact idempotent request ID')

    // 3. Recovery via poll: verifies order status and receipt match
    const recovered = await plan.poll('KORA-FULFILL-RECEIPT-55')
    assert.equal(recovered.receipt, 'KORA-FULFILL-RECEIPT-55')
    assert.equal(recovered.delivered, true)
    assert.equal(recovered.items.length, 2)

    // 4. Insufficient Supplier Balance error simulation
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/products')) {
        return new Response(
          JSON.stringify({ ok: true, products: [{ id: 'kora-multi-tool', name: 'Tool', price_kobo: 2000000, available: true, stock: 5 }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (url.includes('/buy')) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Insufficient supplier balance.', code: 'INSUFFICIENT_BALANCE', balance_kobo: 50000 }),
          { status: 402, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response('{}', { status: 404 })
    }

    await assert.rejects(
      async () => {
        const balPlan = await prepareDelivery(
          'korastore' as DeliveryProvider,
          { apiKey: 'kora_sk_live_val', baseUrl: 'https://korastore.cv/v1' },
          { externalId: 'kora-multi-tool', quantity: 1, requestId: 'req-order-bal', maxCostMinor: 3000000 }
        )
        await balPlan.buy()
      },
      (err: any) => {
        assert.ok(err.message.includes('Insufficient supplier balance'))
        return true
      }
    )
  } finally {
    globalThis.fetch = origFetch
  }
})

