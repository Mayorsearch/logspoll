import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync, readdirSync} from 'node:fs'
import {apiFetch} from '../workers/api/index.ts'
import {supplierAutomation, runSupplierAutomation} from '../workers/api/supplier-automation.ts'
import type {ApiEnv, Database, Statement} from '../workers/api/types.ts'

function createScaleFixture() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys=OFF')

  const directory = new URL('../workers/api/migrations/', import.meta.url)
  // Run foundation migrations + fixtures
  sqlite.exec(readFileSync(new URL('../workers/api/migrations/0001_staging_foundation.sql', import.meta.url), 'utf8'))
  sqlite.exec(readFileSync(new URL('../workers/api/fixtures.sql', import.meta.url), 'utf8'))

  const otherMigrations = readdirSync(directory)
    .filter(name => /^00\d{2}_.*\.sql$/.test(name) && name !== '0001_staging_foundation.sql')
    .sort()

  for (const name of otherMigrations) {
    sqlite.exec(readFileSync(new URL(name, directory), 'utf8'))
  }

  let batchStatementCount = 0
  const db = {
    prepare(sql: string) {
      let values: unknown[] = []
      const statement = {
        bind(...input: unknown[]) { values = input; return statement },
        async all() {
          const results = sqlite.prepare(sql).all(...values as never[])
          return { results, success: true, meta: { changes: 0, last_row_id: 0 } }
        },
        async first() { return (await statement.all()).results[0] ?? null },
        async run() { return statement.all() },
      }
      return statement
    },
    async batch(statements: Statement[]) {
      batchStatementCount = statements.length
      if (statements.length > 100) {
        throw new Error(`D1_ERROR: Batch limit exceeded. Attempted to execute ${statements.length} statements in a single batch (D1 limit is 100).`)
      }
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const s of statements) {
          results.push(await s.run())
        }
        sqlite.exec('COMMIT')
        return results
      } catch (err) {
        sqlite.exec('ROLLBACK')
        throw err
      }
    },
    async exec(sql: string) { sqlite.exec(sql) },
  } as Database

  sqlite.prepare("INSERT OR REPLACE INTO migration_metadata(key, value) VALUES('dataset', 'production')").run()

  const env: ApiEnv = {
    ENVIRONMENT: 'production',
    PRODUCTION_CUTOVER_ENABLED: 'true',
    DB: db,
    AUTOMATION_ENABLED: 'true',
    CATALOG_SYNC_ENABLED: 'true',
    BACHS_LIVE_CHECKOUT_ENABLED: 'false',
    AUTH_ENABLED: 'true',
    AUTH_ORIGIN: 'https://staging.test',
    AUTH_SECRET: 'synthetic-secret-for-scale-test-production-ready',
    RESEND_API_KEY: 're_synthetic_key',
    SUPPLIER_ENCRYPTION_KEY: btoa('s'.repeat(32))
  } as ApiEnv

  const request = (path: string, data?: unknown, cookie?: string, origin = 'https://staging.test') => new Request('https://staging.test' + path, {
    ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }),
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'cf-connecting-ip': '192.0.2.10',
      ...(cookie ? { Cookie: cookie } : {})
    },
  })

  return {
    sqlite,
    env,
    request,
    getBatchCount: () => batchStatementCount
  }
}

async function createAdminUser(ctx: ReturnType<typeof createScaleFixture>) {
  const email = 'admin-scale@logspoll.test'
  const password = 'SyntheticAdminPassword2026!'
  const signup = await apiFetch(ctx.request('/api/auth/sign-up/email', { name: 'Admin Scale', email, password }), ctx.env)
  assert.equal(signup.status, 200, await signup.clone().text())

  ctx.sqlite.prepare('UPDATE auth_user SET "emailVerified"=1 WHERE email=?').run(email)
  const login = await apiFetch(ctx.request('/api/auth/sign-in/email', { email, password }), ctx.env)
  assert.equal(login.status, 200, await login.clone().text())
  const cookie = login.headers.get('set-cookie')!.split(';')[0]

  const userResponse = await apiFetch(ctx.request('/api/account/session', undefined, cookie), ctx.env)
  assert.equal(userResponse.status, 200, await userResponse.clone().text())
  const body = await userResponse.json() as { user: { id: string } }

  ctx.sqlite.prepare("UPDATE user_roles SET role='admin' WHERE user_id=?").run(body.user.id)
  return { id: body.user.id, cookie }
}

test('Scale verification: 1,500 products set-based bulk publication, preview, idempotency, and overrides', async () => {
  const ctx = createScaleFixture()
  const admin = await createAdminUser(ctx)

  const connectionId = crypto.randomUUID()
  const snapshotId = crypto.randomUUID()
  const catVpn = crypto.randomUUID()
  const catSocial = crypto.randomUUID()

  ctx.sqlite.prepare("INSERT INTO categories(id, slug, name, short_name, active) VALUES(?, 'vpn', 'VPN', 'VPN', 1)").run(catVpn)
  ctx.sqlite.prepare("INSERT INTO categories(id, slug, name, short_name, active) VALUES(?, 'social', 'Social Media', 'Social', 1)").run(catSocial)

  ctx.sqlite.prepare("INSERT INTO staging_supplier_connections(id, provider, name, enabled, authorized_products) VALUES(?, 'youngpg', 'YoungPG Main', 1, ?)").run(connectionId, JSON.stringify({'*': 'YoungPG authorized reseller permission'}))
  ctx.sqlite.prepare('INSERT INTO supplier_snapshots(id, connection_id, revision, started_at, completed_at) VALUES(?,?,1,?,?)').run(snapshotId, connectionId, Date.now() - 1000, Date.now())

  // Ensure clean isolation for synthetic scale test
  ctx.sqlite.exec('DELETE FROM products; DELETE FROM inventory; DELETE FROM staging_supplier_feed_items; DELETE FROM supplier_products;')

  // Insert 1,500 synthetic items:
  // - 1,400 standard valid items
  // - 50 items with manual price overrides pre-existing in products table
  // - 25 items with invalid cost (cost <= 0)
  // - 25 items with zero stock
  const insertFeed = ctx.sqlite.prepare(`
    INSERT INTO staging_supplier_feed_items(
      connection_id, external_id, name, source_category, supplier_cost_minor,
      stock_quantity, authorization_verified, evidence_reference, source_checked_at,
      approval, category_id, supplier_description, snapshot_id
    ) VALUES(?, ?, ?, 'permitted_digital_good', ?, ?, 1, 'YoungPG authorized reseller permission', ?, 'pending', ?, ?, ?)
  `)

  const now = Date.now()
  for (let i = 1; i <= 1400; i++) {
    const extId = `item-valid-${i}`
    const cost = 1000 + (i * 10)
    const cat = i % 2 === 0 ? catVpn : catSocial
    insertFeed.run(connectionId, extId, `Product Valid ${i}`, cost, 25, now, cat, `Verified digital product description ${i} with long description text`, snapshotId)
  }

  // 50 manual price override items
  for (let i = 1; i <= 50; i++) {
    const extId = `item-override-${i}`
    const cost = 2000
    insertFeed.run(connectionId, extId, `Product Override ${i}`, cost, 15, now, catVpn, `Verified digital product override ${i} with long description text`, snapshotId)

    const prodId = crypto.randomUUID()
    const slug = `ypg-${connectionId}-${extId}`
    ctx.sqlite.prepare(`
      INSERT INTO products(id, category_id, slug, name, description, price_minor, supplier_name, authorized_resale, status, delivery_type, pricing_mode, publication_verified, server_number)
      VALUES(?, ?, ?, ?, 'Pre-existing override description', 99999, 'YoungPG Media', 1, 'active', 'Subscription activation', 'override', 1, 2)
    `).run(prodId, catVpn, slug, `Product Override ${i}`)

    ctx.sqlite.prepare('INSERT INTO supplier_products(connection_id, external_id, product_id) VALUES(?, ?, ?)').run(connectionId, extId, prodId)
  }

  // 25 invalid cost items (cost = 0)
  for (let i = 1; i <= 25; i++) {
    const extId = `item-invalid-cost-${i}`
    insertFeed.run(connectionId, extId, `Product Zero Cost ${i}`, 0, 10, now, catVpn, `Verified digital product zero cost ${i} with long description text`, snapshotId)
  }

  // 25 zero stock items (stock = 0)
  for (let i = 1; i <= 25; i++) {
    const extId = `item-zero-stock-${i}`
    insertFeed.run(connectionId, extId, `Product Zero Stock ${i}`, 3000, 0, now, catVpn, `Verified digital product zero stock ${i} with long description text`, snapshotId)
  }

  // 1. Verify initial state: exactly 1,500 feed items and 50 override products
  const totalFeed = ctx.sqlite.prepare('SELECT count(*) n FROM staging_supplier_feed_items').get() as { n: number }
  assert.equal(totalFeed.n, 1500, 'Expected 1,500 synthetic feed items')
  const totalProd = ctx.sqlite.prepare('SELECT count(*) n FROM products WHERE server_number=2').get() as { n: number }
  assert.equal(totalProd.n, 50, 'Expected 50 initial override products')

  // 2. Price Preview Verification
  const previewReq = ctx.request('/api/admin/supplier-automation', { provider: 'youngpg', action: 'preview', markup_bps: 5000 }, admin.cookie)
  const previewRes = await supplierAutomation(previewReq, ctx.env)
  assert.equal(previewRes.status, 200)
  const previewData = await previewRes.json() as { items: unknown[]; total: number; eligible_count: number }
  assert.ok(previewData.items.length > 0, 'Preview must return items')
  assert.equal(previewData.total, 1475, 'Expected 1,475 positive-cost items')
  assert.equal(previewData.eligible_count, 1475)

  // 3. Apply Markup Verification (50% markup = 5000 bps)
  const applyReq = ctx.request('/api/admin/supplier-automation', { provider: 'youngpg', action: 'apply_markup', markup_bps: 5000 }, admin.cookie)
  const applyRes = await supplierAutomation(applyReq, ctx.env)
  assert.equal(applyRes.status, 200)
  const applyData = await applyRes.json() as { saved: boolean; updated: number }
  assert.equal(applyData.saved, true)
  assert.equal(applyData.updated, 1475, 'Expected 1,475 items updated')
  assert.ok(ctx.getBatchCount() <= 5, `Expected batch count <= 5 statements, was ${ctx.getBatchCount()}`)

  // Confirm manual price overrides were NOT overwritten by apply_markup
  const overridesAfterMarkup = ctx.sqlite.prepare("SELECT price_minor FROM products WHERE pricing_mode='override'").all() as { price_minor: number }[]
  for (const row of overridesAfterMarkup) {
    assert.equal(row.price_minor, 99999, 'Manual overrides must remain untouched at 99999')
  }

  // 4. Approve & Publish All Verification (Speed, D1 batch limit, accurate counts)
  const startTime = Date.now()
  const approveReq = ctx.request('/api/admin/supplier-automation', { provider: 'youngpg', action: 'approve_all' }, admin.cookie)
  const approveRes = await supplierAutomation(approveReq, ctx.env)
  const durationMs = Date.now() - startTime

  assert.equal(approveRes.status, 200)
  const approveData = await approveRes.json() as { success: boolean; approved_count: number; published_count: number; remaining_count: number }
  assert.equal(approveData.success, true)
  assert.equal(approveData.approved_count, 1500, 'Expected 1,500 approved feed items')
  assert.equal(approveData.published_count, 1500, 'Expected 1,500 active published products')
  assert.equal(approveData.remaining_count, 0)
  assert.ok(ctx.getBatchCount() <= 5, `Approve all must execute in <= 5 statements, was ${ctx.getBatchCount()}`)
  assert.ok(durationMs < 1000, `Execution should be sub-second (< 1000ms), took ${durationMs}ms`)

  // Confirm manual price overrides were NOT overwritten during publication
  const overridesAfterApprove = ctx.sqlite.prepare("SELECT price_minor FROM products WHERE pricing_mode='override'").all() as { price_minor: number }[]
  for (const row of overridesAfterApprove) {
    assert.equal(row.price_minor, 99999, 'Manual overrides must remain untouched at 99999 after publication')
  }

  // 5. Repeated Bulk Publication (Idempotency & Zero Duplication)
  const repeatReq = ctx.request('/api/admin/supplier-automation', { provider: 'youngpg', action: 'approve_all' }, admin.cookie)
  const repeatRes = await supplierAutomation(repeatReq, ctx.env)
  assert.equal(repeatRes.status, 200)

  const finalProductsCount = ctx.sqlite.prepare('SELECT count(*) n FROM products WHERE server_number=2').get() as { n: number }
  assert.equal(finalProductsCount.n, 1500, 'Products count must remain exactly 1,500 on repeat execution (no duplicates)')

  // 6. View & Stock Projection Verification
  // Storefront products view joins categories and verified_product_stock.
  // The 25 zero-stock items have stock_quantity = 0, so available_quantity = 0 and they must have available_quantity=0 while in-stock items have available_quantity > 0!
  const inStockProducts = ctx.sqlite.prepare("SELECT count(*) n FROM storefront_products WHERE server_number=2 AND available_quantity>0").get() as { n: number }
  assert.equal(inStockProducts.n, 1475, 'Storefront products must project 1,475 in-stock items (excluding 25 zero-stock items)')

  const outOfStockProducts = ctx.sqlite.prepare("SELECT count(*) n FROM storefront_products WHERE server_number=2 AND available_quantity=0").get() as { n: number }
  assert.equal(outOfStockProducts.n, 25, 'Storefront products must project exactly 25 zero-stock items with available_quantity=0')

  ctx.sqlite.close()
})

test('Multi-supplier scale verification: 1,500 products across Server 1, 2, 3 with permanent 50% markup, auto-recalculation, 24/7 background sync, and override controls', async () => {
  const ctx = createScaleFixture()
  const admin = await createAdminUser(ctx)

  // Ensure default categories exist
  const catVpn = crypto.randomUUID()
  const catSocial = crypto.randomUUID()
  ctx.sqlite.prepare("INSERT OR IGNORE INTO categories(id, slug, name, short_name, active) VALUES(?, 'vpn', 'VPN', 'VPN', 1)").run(catVpn)
  ctx.sqlite.prepare("INSERT OR IGNORE INTO categories(id, slug, name, short_name, active) VALUES(?, 'social', 'Social Media', 'Social', 1)").run(catSocial)
  const server3Cat = (ctx.sqlite.prepare("SELECT id FROM categories WHERE slug='server3'").get() as { id: string })?.id

  // Connections
  const ypgConn = crypto.randomUUID()
  const ypgSnap = crypto.randomUUID()
  ctx.sqlite.prepare("INSERT INTO staging_supplier_connections(id, provider, name, enabled, authorized_products) VALUES(?, 'youngpg', 'YoungPG', 1, '{}')").run(ypgConn)
  ctx.sqlite.prepare('INSERT INTO supplier_snapshots(id, connection_id, revision, started_at, completed_at) VALUES(?,?,1,?,?)').run(ypgSnap, ypgConn, Date.now() - 1000, Date.now())

  ctx.sqlite.prepare("INSERT OR REPLACE INTO hstora_connection(id, enabled, ciphertext, nonce) VALUES('hstora', 1, 'dummy', 'dummy')").run()
  ctx.sqlite.prepare("INSERT OR REPLACE INTO shopviaclone22_connection(id, enabled, ciphertext, nonce) VALUES('shopviaclone22', 1, 'dummy', 'dummy')").run()

  // Clean products & feeds
  ctx.sqlite.exec('DELETE FROM products; DELETE FROM inventory; DELETE FROM staging_supplier_feed_items; DELETE FROM supplier_products; DELETE FROM hstora_catalog_items; DELETE FROM shopviaclone22_catalog_items;')

  const now = Date.now()

  // 1. Populate 500 items for Server 1 (HStora)
  // Costs: ₦1,000 (10.00), ₦5,000 (50.00), ₦10,000 (100.00)
  const insertHstora = ctx.sqlite.prepare(`
    INSERT INTO hstora_catalog_items(external_id, supplier, storefront_category, metadata, snapshot_id, checked_at, approval_status)
    VALUES(?, 'hstora', 'server1', ?, 'snap-1', ?, 'pending')
  `)
  for (let i = 1; i <= 500; i++) {
    const cost = i % 3 === 0 ? '100.00' : i % 2 === 0 ? '50.00' : '10.00'
    const meta = JSON.stringify({ name: `HStora Product ${i}`, price: cost, currency: 'NGN', stock: 10, supplier_available: true })
    insertHstora.run(`hs-${i}`, meta, now)
  }

  // 2. Populate 500 items for Server 2 (YoungPG)
  // 480 standard items (costs: 100000 kobo, 500000 kobo, 1000000 kobo)
  // 20 items with manual price overrides
  const insertYpg = ctx.sqlite.prepare(`
    INSERT INTO staging_supplier_feed_items(
      connection_id, external_id, name, source_category, supplier_cost_minor,
      stock_quantity, authorization_verified, evidence_reference, source_checked_at,
      approval, category_id, supplier_description, snapshot_id
    ) VALUES(?, ?, ?, 'permitted_digital_good', ?, 20, 1, 'YoungPG authorized reseller permission', ?, 'pending', ?, 'Verified digital product description text here', ?)
  `)
  for (let i = 1; i <= 480; i++) {
    const costMinor = i % 3 === 0 ? 1000000 : i % 2 === 0 ? 500000 : 100000 // ₦10,000, ₦5,000, ₦1,000
    insertYpg.run(ypgConn, `ypg-item-${i}`, `YoungPG Product ${i}`, costMinor, now, catVpn, ypgSnap)
  }

  // 20 override items pre-existing in products
  for (let i = 1; i <= 20; i++) {
    const extId = `ypg-override-${i}`
    const costMinor = 100000 // ₦1,000 cost
    insertYpg.run(ypgConn, extId, `YoungPG Override ${i}`, costMinor, now, catVpn, ypgSnap)

    const prodId = crypto.randomUUID()
    const slug = `ypg-${ypgConn}-${extId}`
    ctx.sqlite.prepare(`
      INSERT INTO products(id, category_id, slug, name, description, price_minor, supplier_name, authorized_resale, status, delivery_type, pricing_mode, publication_verified, server_number)
      VALUES(?, ?, ?, ?, 'Manual override description', 77777, 'YoungPG Media', 1, 'active', 'Subscription activation', 'override', 1, 2)
    `).run(prodId, catVpn, slug, `YoungPG Override ${i}`)
    ctx.sqlite.prepare('INSERT INTO supplier_products(connection_id, external_id, product_id) VALUES(?, ?, ?)').run(ypgConn, extId, prodId)
  }

  // 3. Populate 500 items for Server 3 (ShopViaClone22)
  // Costs: 100000 kobo (₦1,000), 500000 kobo (₦5,000), 1000000 kobo (₦10,000)
  const insertS3 = ctx.sqlite.prepare(`
    INSERT INTO shopviaclone22_catalog_items(external_id, supplier, category_id, name, description, cost_minor, stock, raw_metadata, snapshot_id, checked_at, approval_status)
    VALUES(?, 'shopviaclone22', ?, ?, 'ShopViaClone22 product description text', ?, 15, '{}', 'snap-3', ?, 'pending')
  `)
  for (let i = 1; i <= 500; i++) {
    const costMinor = i % 3 === 0 ? 1000000 : i % 2 === 0 ? 500000 : 100000
    insertS3.run(`s3-${i}`, server3Cat, `ShopVia Product ${i}`, costMinor, now)
  }

  // Total should be exactly 1,500 supplier items
  const countHstora = ctx.sqlite.prepare('SELECT count(*) n FROM hstora_catalog_items').get() as { n: number }
  const countYpg = ctx.sqlite.prepare('SELECT count(*) n FROM staging_supplier_feed_items').get() as { n: number }
  const countS3 = ctx.sqlite.prepare('SELECT count(*) n FROM shopviaclone22_catalog_items').get() as { n: number }
  assert.equal(countHstora.n + countYpg.n + countS3.n, 1500, 'Expected exactly 1,500 total supplier items across all 3 servers')

  // A. Check Global Pricing Config Defaults
  const getReq = ctx.request('/api/admin/supplier-automation', undefined, admin.cookie)
  const getRes = await supplierAutomation(getReq, ctx.env)
  assert.equal(getRes.status, 200)
  const getData = await getRes.json() as { global_pricing: { markup_bps: number; auto_publish: number; automatic_pricing: number } }
  assert.equal(getData.global_pricing.auto_publish, 0, 'Default auto_publish must be 0 until explicitly enabled by admin')

  // B. Test Global Price Preview with 50% Markup
  const prevReq = ctx.request('/api/admin/supplier-automation', { action: 'global_preview', markup_bps: 5000, restore_overrides: false }, admin.cookie)
  const prevRes = await supplierAutomation(prevReq, ctx.env)
  assert.equal(prevRes.status, 200)
  const prevData = await prevRes.json() as {
    total: number
    overrides_count: number
    items: { id: string; cost_minor: number; price: number; profit_minor: number; is_override: boolean }[]
  }
  assert.equal(prevData.total, 1500, 'Global preview must cover all 1,500 items')
  assert.equal(prevData.overrides_count, 20, 'Global preview must identify the 20 manual price overrides')

  // Verify exact 50% formula on sample items:
  // Selling Price = Cost * 1.50
  for (const item of prevData.items) {
    if (!item.is_override) {
      const expectedPrice = Math.round(item.cost_minor * 1.50)
      assert.equal(item.price, expectedPrice, `Item ${item.id} price ${item.price} must equal cost ${item.cost_minor} * 1.50 = ${expectedPrice}`)
      assert.equal(item.profit_minor, expectedPrice - item.cost_minor, 'Gross profit must equal Selling Price - Cost')

      // Specific examples from user requirement:
      if (item.cost_minor === 100000) { // ₦1,000
        assert.equal(item.price, 150000, '₦1,000 cost must yield ₦1,500 selling price')
        assert.equal(item.profit_minor, 50000, '₦1,000 cost must yield ₦500 gross profit')
      } else if (item.cost_minor === 500000) { // ₦5,000
        assert.equal(item.price, 750000, '₦5,000 cost must yield ₦7,500 selling price')
        assert.equal(item.profit_minor, 250000, '₦5,000 cost must yield ₦2,500 gross profit')
      } else if (item.cost_minor === 1000000) { // ₦10,000
        assert.equal(item.price, 1500000, '₦10,000 cost must yield ₦15,000 selling price')
        assert.equal(item.profit_minor, 500000, '₦10,000 cost must yield ₦5,000 gross profit')
      }
    } else {
      assert.equal(item.price, 77777, 'Manual overrides must retain their manual price in preview when restore_overrides=false')
    }
  }

  // C. Execute "Apply 50% Markup & Publish All Products" (preserving manual overrides)
  const startTime = Date.now()
  const pubReq = ctx.request('/api/admin/supplier-automation', {
    action: 'global_apply_and_publish',
    markup_bps: 5000,
    restore_overrides: false
  }, admin.cookie)
  const pubRes = await supplierAutomation(pubReq, ctx.env)
  const duration = Date.now() - startTime

  assert.equal(pubRes.status, 200)
  const pubData = await pubRes.json() as { success: boolean; approved_count: number; published_count: number; overrides_count: number }
  assert.equal(pubData.success, true)
  assert.equal(pubData.approved_count, 1500, 'Expected 1,500 approved listings across all 3 servers')
  assert.equal(pubData.published_count, 1500, 'Expected 1,500 published active products')
  assert.equal(pubData.overrides_count, 20, 'Manual overrides must remain at 20')
  assert.ok(duration < 2500, `Execution of 1,500 bulk items should complete rapidly, took ${duration}ms`)

  // Confirm that the 20 manual overrides were preserved at 77777
  const overridesAfter = ctx.sqlite.prepare("SELECT price_minor FROM products WHERE pricing_mode='override'").all() as { price_minor: number }[]
  assert.equal(overridesAfter.length, 20)
  for (const row of overridesAfter) {
    assert.equal(row.price_minor, 77777, 'Manual override prices must be preserved at 77777')
  }

  // Confirm Server 1 (HStora), Server 2 (YoungPG), and Server 3 (ShopViaClone22) all published
  const pS1 = ctx.sqlite.prepare("SELECT count(*) n FROM products WHERE server_number=1 AND status='active'").get() as { n: number }
  const pS2 = ctx.sqlite.prepare("SELECT count(*) n FROM products WHERE server_number=2 AND status='active'").get() as { n: number }
  const pS3 = ctx.sqlite.prepare("SELECT count(*) n FROM products WHERE server_number=3 AND status='active'").get() as { n: number }
  assert.equal(pS1.n, 500, 'Server 1 must have 500 active products')
  assert.equal(pS2.n, 500, 'Server 2 must have 500 active products')
  assert.equal(pS3.n, 500, 'Server 3 must have 500 active products')

  // D. Idempotency test (repeating publish does not duplicate or alter state)
  const repeatRes = await supplierAutomation(ctx.request('/api/admin/supplier-automation', {
    action: 'global_apply_and_publish',
    markup_bps: 5000,
    restore_overrides: false
  }, admin.cookie), ctx.env)
  assert.equal(repeatRes.status, 200)
  const totalAfterRepeat = ctx.sqlite.prepare('SELECT count(*) n FROM products').get() as { n: number }
  assert.equal(totalAfterRepeat.n, 1500, 'Products count must remain exactly 1,500 (no duplicate products)')

  // E. Replace manual price overrides with 50% rule when restore_overrides = true
  const replaceRes = await supplierAutomation(ctx.request('/api/admin/supplier-automation', {
    action: 'global_apply_and_publish',
    markup_bps: 5000,
    restore_overrides: true
  }, admin.cookie), ctx.env)
  assert.equal(replaceRes.status, 200)
  const replaceData = await replaceRes.json() as { overrides_count: number }
  assert.equal(replaceData.overrides_count, 0, 'All overrides should be replaced with the 50% rule')
  const overridesRemaining = ctx.sqlite.prepare("SELECT count(*) n FROM products WHERE pricing_mode='override'").get() as { n: number }
  assert.equal(overridesRemaining.n, 0, 'Zero manual overrides remain')

  // Check the previously overridden items now have 50% markup (100000 cost * 1.50 = 150000)
  const formerOverride = ctx.sqlite.prepare("SELECT price_minor, pricing_mode FROM products WHERE slug LIKE '%ypg-override-1%'").get() as { price_minor: number; pricing_mode: string }
  assert.equal(formerOverride.price_minor, 150000, 'Former override item now uses 50% markup (150,000 kobo)')
  assert.equal(formerOverride.pricing_mode, 'auto')

  // Activate Global Auto-Publishing via admin save_global_pricing
  const saveReq = ctx.request('/api/admin/supplier-automation', {
    action: 'save_global_pricing',
    markup_bps: 5000,
    auto_publish: 1,
    automatic_pricing: 1,
    auto_approve: 1,
    usd_to_ngn_rate: 1500.0,
    delivery_type: 'Subscription activation'
  }, admin.cookie)
  const saveRes = await supplierAutomation(saveReq, ctx.env)
  assert.equal(saveRes.status, 200)

  // F. Automatic price recalculation when supplier cost changes
  // YoungPG trigger test:
  // Item with cost 100,000 (₦1,000) was price 150,000 (₦1,500).
  // Cost increases to 200,000 (₦2,000). Selling price should automatically become 300,000 (₦3,000).
  ctx.sqlite.prepare("UPDATE staging_supplier_feed_items SET supplier_cost_minor=200000 WHERE external_id='ypg-item-1'").run()
  await runSupplierAutomation(ctx.env)
  const ypgUpdatedProd = ctx.sqlite.prepare("SELECT price_minor FROM products WHERE slug LIKE '%ypg-item-1'").get() as { price_minor: number }
  assert.equal(ypgUpdatedProd.price_minor, 300000, 'YoungPG price must automatically recalculate to 300,000 kobo (200,000 * 1.50)')

  // ShopViaClone22 trigger test:
  // Item with cost 100,000 increases to 400,000. Price should automatically become 600,000.
  ctx.sqlite.prepare("UPDATE shopviaclone22_catalog_items SET cost_minor=400000 WHERE external_id='s3-1'").run()
  await runSupplierAutomation(ctx.env)
  const s3UpdatedProd = ctx.sqlite.prepare("SELECT price_minor FROM products WHERE slug='s3-s3-1'").get() as { price_minor: number }
  assert.equal(s3UpdatedProd.price_minor, 600000, 'ShopViaClone22 price must automatically recalculate to 600,000 kobo (400,000 * 1.50)')

  // G. 24/7 Background Cron Auto-Publishing Verification
  // Add 10 new pending items to YoungPG, 10 to HStora, 10 to ShopViaClone22
  for (let i = 1001; i <= 1010; i++) {
    insertYpg.run(ypgConn, `new-ypg-${i}`, `New Background YPG ${i}`, 100000, now, catVpn, ypgSnap)
    insertHstora.run(`new-hs-${i}`, JSON.stringify({ name: `New Background HS ${i}`, price: '10.00', currency: 'NGN', stock: 5, supplier_available: true }), now)
    insertS3.run(`new-s3-${i}`, server3Cat, `New Background S3 ${i}`, 100000, now)
  }

  // Before background run: 30 new pending items exist, not yet in products
  const countBeforeCron = ctx.sqlite.prepare('SELECT count(*) n FROM products').get() as { n: number }
  assert.equal(countBeforeCron.n, 1500)

  // Trigger 24/7 Cloudflare background automation
  await runSupplierAutomation(ctx.env)

  // After background run: all 30 new items must be automatically approved and published with 50% markup!
  const countAfterCron = ctx.sqlite.prepare('SELECT count(*) n FROM products WHERE status=\'active\'').get() as { n: number }
  assert.equal(countAfterCron.n, 1530, 'Background automation must auto-publish all 30 new items without manual clicks')

  const sampleNewProd = ctx.sqlite.prepare("SELECT price_minor, status, publication_verified FROM products WHERE slug LIKE '%new-ypg-1001%'").get() as { price_minor: number; status: string; publication_verified: number }
  assert.equal(sampleNewProd.status, 'active')
  assert.equal(sampleNewProd.publication_verified, 1)
  assert.equal(sampleNewProd.price_minor, 150000, 'Newly auto-published item must have 50% markup applied')

  ctx.sqlite.close()
})

