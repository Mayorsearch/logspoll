import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {prepareDelivery,deliveryCostMinor,DeliveryError} from '../server/supplier-delivery.ts'
import {runFulfillment,fulfillPaidOrder} from '../workers/api/fulfillment.ts'
import {adminOperations} from '../workers/api/admin.ts'
import {createAuth} from '../workers/api/auth.ts'
import {sealCredential} from '../server/supplier-crypto.ts'
import type {ApiEnv,Database,Statement} from '../workers/api/types.ts'

const user = '11111111-1111-4111-8111-111111111111'
const order = '22222222-2222-4222-8222-222222222222'
const product = '33333333-3333-4333-8333-333333333333'
const item = '44444444-4444-4444-8444-444444444444'
const attempt = '55555555-5555-4555-8555-555555555555'
const category = '66666666-6666-4666-8666-666666666666'
const walletId = '77777777-7777-4777-8777-777777777777'
const txId = '88888888-8888-4888-8888-888888888888'
const ypgKey = 'ypg_' + 'b'.repeat(48)

async function testFixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  for (const f of [
    '0001_staging_foundation.sql',
    '0002_cloudflare_auth.sql',
    '0009_auth_email_otp.sql',
    '0010_bachs_payment_foundation.sql',
    '0024_automatic_fulfillment.sql',
    '0026_customer_wallet_system.sql'
  ]) {
    sql.exec(readFileSync(new URL('../workers/api/migrations/' + f, import.meta.url), 'utf8'))
  }

  sql.exec(`
    CREATE TABLE product_authorizations(product_id TEXT PRIMARY KEY,evidence TEXT,reviewer_id TEXT,verified_at INTEGER);
    CREATE TABLE business_mail_events(id TEXT PRIMARY KEY,kind TEXT,user_id TEXT,created_at INTEGER);
    CREATE TABLE supplier_products(product_id TEXT,connection_id TEXT,external_id TEXT);
    CREATE TABLE staging_supplier_connections(id TEXT,provider TEXT,enabled INTEGER,encrypted_key TEXT,key_nonce TEXT,authorized_products TEXT);
    CREATE TABLE staging_supplier_feed_items(connection_id TEXT,external_id TEXT,approval TEXT,authorization_verified INTEGER,evidence_reference TEXT,snapshot_id TEXT);
    CREATE TABLE supplier_sync_items(job_id TEXT,external_id TEXT,metadata TEXT);
    CREATE TABLE hstora_catalog_items(product_id TEXT,external_id TEXT,approval_status TEXT);
    CREATE TABLE hstora_connection(id TEXT,enabled INTEGER,ciphertext TEXT,nonce TEXT);
    CREATE TABLE digitalcore_catalog_items(product_id TEXT,external_id TEXT,approval_status TEXT);
    CREATE TABLE digitalcore_connection(id TEXT,enabled INTEGER,ciphertext TEXT,nonce TEXT);
    CREATE TABLE shopviaclone22_catalog_items(product_id TEXT,external_id TEXT,approval_status TEXT);
    CREATE TABLE shopviaclone22_connection(id TEXT,enabled INTEGER,ciphertext TEXT,nonce TEXT);
    CREATE TABLE global_pricing_config(id TEXT PRIMARY KEY,usd_to_ngn_rate REAL,fx_updated_at INTEGER,fx_status TEXT);
    CREATE TABLE admin_write_fences(id TEXT PRIMARY KEY,valid INTEGER);
  `)

  sql.prepare("INSERT INTO users(id,status) VALUES(?,'active')").run(user)
  sql.prepare("INSERT INTO user_roles(user_id,role) VALUES(?,'customer')").run(user)
  sql.prepare("INSERT INTO auth_user(id,email,emailVerified,name,createdAt,updatedAt) VALUES(?,?,'1',?,datetime('now'),datetime('now'))").run(user,'customer@test.com','Test Customer')
  sql.prepare("INSERT INTO profiles(id,full_name) VALUES(?,'Test Customer')").run(user)
  sql.prepare("INSERT INTO categories(id,slug,name,short_name) VALUES(?,'test','Test','Test')").run(category)
  sql.prepare("INSERT INTO products(id,category_id,slug,name,description,price_minor,supplier_name,authorized_resale,status,publication_verified,delivery_type) VALUES(?,?,'test','Test','Verified subscription product',45000,'YoungPG',1,'active',1,'Subscription activation')").run(product,category)
  sql.prepare("INSERT INTO product_authorizations VALUES(?,?,?,?)").run(product,JSON.stringify({reference:'verified',delivery:true,privacy:true,provider:true}),user,Date.now())
  sql.prepare("INSERT INTO orders(id,customer_id,reference,total_minor,currency,payment_status,payment_method) VALUES(?,?,?,45000,'NGN','paid','wallet')").run(order,user,'LP-test')
  sql.prepare("INSERT INTO order_items(id,order_id,product_id,product_name,category_name,quantity,unit_price_minor) VALUES(?,?,?,'Test','Test',1,45000)").run(item,order,product)
  sql.prepare("INSERT INTO wallets(id,customer_id,balance_minor,currency,status,created_at,updated_at) VALUES(?,?,100000,'NGN','active',1,1)").run(walletId,user)
  sql.prepare(`INSERT INTO wallet_transactions(id,wallet_id,customer_id,reference,type,direction,amount_minor,balance_before_minor,balance_after_minor,status,order_id,reason,created_at)
    VALUES(?,?,?,'TX-TEST','purchase','debit',45000,100000,55000,'completed',?,'Purchase',1)`).run(txId,walletId,user,order)

  // FX config: active by default with 1500 NGN/USD
  sql.prepare("INSERT INTO global_pricing_config(id,usd_to_ngn_rate,fx_updated_at,fx_status) VALUES('global',1500,?, 'active')").run(Date.now())

  const env: ApiEnv = {
    ENVIRONMENT: 'production',
    AUTO_FULFILLMENT_ENABLED: 'true',
    SUPPLIER_ENCRYPTION_KEY: btoa('k'.repeat(32)),
    AUTH_SECRET: 'test-auth-secret-for-price-protection-tests',
    AUTH_ORIGIN: 'https://staging.test',
    AUTH_ENABLED: 'true',
    RESEND_API_KEY: 're_synthetic_key'
  }

  const prepare = (query: string): Statement => {
    let args: (string | number | null)[] = []
    return {
      bind(...v) { args = v; return this },
      async first<T>() { return (sql.prepare(query).get(...args) ?? null) as T | null },
      async all<T>() {
        const results = sql.prepare(query).all(...args) as T[]
        const changes = Number((sql.prepare('SELECT changes() AS n').get() as {n:number})?.n ?? 0)
        return { success: true, results, meta: { changes, last_row_id: 0 } }
      },
      async run() { return this.all() }
    }
  }

  const db: Database = {
    prepare,
    async batch(queries) {
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
    async exec(q) { sql.exec(q) }
  }
  env.DB = db

  const sealed = await sealCredential(ypgKey, 'connection', env.SUPPLIER_ENCRYPTION_KEY)
  sql.prepare("INSERT INTO staging_supplier_connections VALUES('connection','youngpg',1,?,?,?)").run(sealed.ciphertext, sealed.nonce, JSON.stringify({'*':'verified'}))
  sql.prepare("INSERT INTO supplier_products VALUES(?,'connection','12')").run(product)
  sql.exec(`INSERT INTO staging_supplier_feed_items VALUES('connection','12','approved',1,'verified','snapshot');INSERT INTO supplier_sync_items VALUES('snapshot','12','{"slug":"subscription-test"}')`)
  sql.prepare("INSERT INTO fulfillment_jobs(order_item_id,order_id,request_id,state,created_at,updated_at) VALUES(?,?,'delivery_'||?,'queued',?,?)").run(item,order,item,Date.now(),Date.now())

  // Setup admin user & cookie
  const auth = createAuth(env)
  await auth.api.signUpEmail({ body: { name: 'Test Admin', email: 'admin@staging.test', password: 'ValidAdminPassword123!' } })
  sql.prepare("UPDATE auth_user SET emailVerified=1 WHERE email='admin@staging.test'").run()
  const loginRes = await auth.api.signInEmail({ body: { email: 'admin@staging.test', password: 'ValidAdminPassword123!' }, asResponse: true })
  const adminCookie = loginRes.headers.get('set-cookie')!.split(';')[0]
  const adminRecord = sql.prepare("SELECT id FROM auth_user WHERE email='admin@staging.test'").get() as { id: string }
  sql.prepare("INSERT OR REPLACE INTO users(id,status) VALUES(?,'active')").run(adminRecord.id)
  sql.prepare("INSERT OR REPLACE INTO user_roles(user_id,role) VALUES(?,'admin')").run(adminRecord.id)
  sql.prepare("INSERT OR REPLACE INTO profiles(id,full_name) VALUES(?,'Test Admin')").run(adminRecord.id)

  return { sql, env, adminCookie, adminId: adminRecord.id }
}

test('1. YoungPG: live cost checked; price increase blocks fulfillment with PRICE_REVIEW notification', async t => {
  const { sql, env, adminId } = await testFixture()
  t.after(() => sql.close())

  let purchases = 0
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (init?.method === 'POST') purchases++
    // Live supplier price returned is 500 NGN (50000 kobo), which exceeds order's locked unit price 450 NGN (45000 kobo)
    return Response.json({ success: true, data: { id: 12, slug: 'subscription-test', price_ngn: '500.00', available_stock: 5 } })
  })

  await runFulfillment(env)

  assert.equal(purchases, 0, 'No purchase should occur when live supplier cost exceeds locked customer payment')
  const job = sql.prepare('SELECT state, last_error FROM fulfillment_jobs WHERE order_item_id=?').get(item) as { state: string; last_error: string }
  assert.equal(job.state, 'blocked')
  assert.match(job.last_error, /^PRICE_REVIEW:live_cost=50000:/)

  // Verify customer received purchase_failed mail event and admin received security_alert
  const events = sql.prepare('SELECT kind, user_id FROM business_mail_events ORDER BY created_at ASC').all() as { kind: string; user_id: string }[]
  assert.equal(events.some(e => e.kind === 'purchase_failed' && e.user_id === user), true)
  assert.equal(events.some(e => e.kind === 'security_alert' && e.user_id === adminId), true)
})

test('2. HStora (Server 1): live cost check blocks purchase when supplier price increases', async t => {
  const creds = { key: 'hs_pk_test', secret: 'hs_sk_test' }
  const ref = 'ref_hstora_check'

  t.mock.method(globalThis, 'fetch', async () => {
    // HStora returns product detail with price $0.50 USD; locked customer max cost is 50000 kobo (₦500)
    // At FX 1500 NGN/USD, $0.50 = ₦750 = 75000 kobo > 50000 kobo
    return Response.json({ success: true, data: { id: 12, price: '0.50', currency: 'USD', stock_available: 10 } })
  })

  await assert.rejects(
    async () => {
      await prepareDelivery('hstora', creds, {
        externalId: '12',
        quantity: 1,
        requestId: ref,
        maxCostMinor: 50000,
        fxRate: '1500'
      })
    },
    (err: unknown) => {
      assert.ok(err instanceof DeliveryError)
      assert.equal(err.state, 'blocked')
      assert.match(err.message, /^PRICE_REVIEW:live_cost=75000:/)
      return true
    }
  )
})

test('3. ShopViaClone22 (Server 3): live cost check blocks purchase when price increases', async t => {
  const creds = { apiKey: 'shopvia_key', baseUrl: 'https://shopviaclone22.com/api' }
  const ref = 'ref_shopvia_check'

  t.mock.method(globalThis, 'fetch', async () => {
    // Product price $2.00 USD at FX 1500 = ₦3000 = 300000 kobo > maxCostMinor 200000 kobo
    return Response.json({ product: { id: 's3_prod_1', price: '2.00', currency: 'USD', amount: 5 } })
  })

  await assert.rejects(
    async () => {
      await prepareDelivery('shopviaclone22', creds, {
        externalId: 's3_prod_1',
        quantity: 1,
        requestId: ref,
        maxCostMinor: 200000,
        fxRate: '1500'
      })
    },
    (err: unknown) => {
      assert.ok(err instanceof DeliveryError)
      assert.equal(err.state, 'blocked')
      assert.match(err.message, /^PRICE_REVIEW:live_cost=300000:/)
      return true
    }
  )
})

test('4. DigitalCore (Server 4): live cost check blocks purchase when price increases', async t => {
  const creds = { apiKey: 'dc_key', baseUrl: 'https://digitalcore.top' }
  const ref = 'ref_dc_check'

  t.mock.method(globalThis, 'fetch', async () => {
    // Price $3.00 USD at FX 1500 = ₦4500 = 450000 kobo > maxCostMinor 300000 kobo
    return Response.json({ id: 'dc_prod_1', price: '3.00', stock: 10 })
  })

  await assert.rejects(
    async () => {
      await prepareDelivery('digitalcore', creds, {
        externalId: 'dc_prod_1',
        quantity: 1,
        requestId: ref,
        maxCostMinor: 300000,
        fxRate: '1500'
      })
    },
    (err: unknown) => {
      assert.ok(err instanceof DeliveryError)
      assert.equal(err.state, 'blocked')
      assert.match(err.message, /^PRICE_REVIEW:live_cost=450000:/)
      return true
    }
  )
})

test('5. Stale USD FX rate blocks USD fulfillment with PRICE_REVIEW instead of silent fallback', async t => {
  const { sql, env } = await testFixture()
  t.after(() => sql.close())

  // Configure DigitalCore mapping
  const dcKey = 'dc_secret_api_key'
  const sealed = await sealCredential(JSON.stringify({ apiKey: dcKey }), 'digitalcore', env.SUPPLIER_ENCRYPTION_KEY)
  sql.prepare("INSERT INTO digitalcore_connection VALUES('digitalcore',1,?,?)").run(sealed.ciphertext, sealed.nonce)
  sql.prepare("INSERT INTO digitalcore_catalog_items VALUES(?,'dc_item_1','approved')").run(product)

  // Switch product mapping to DigitalCore
  sql.prepare("DELETE FROM staging_supplier_feed_items").run()
  sql.prepare("DELETE FROM supplier_products").run()

  // Set FX to stale
  sql.prepare("UPDATE global_pricing_config SET fx_status='stale' WHERE id='global'").run()

  let supplierCalls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    supplierCalls++
    return Response.json({ id: 'dc_item_1', price: '1.00', stock: 10 })
  })

  await runFulfillment(env)

  assert.equal(supplierCalls, 0, 'Should not proceed to buy when FX rate is stale')
  const job = sql.prepare('SELECT state, last_error FROM fulfillment_jobs WHERE order_item_id=?').get(item) as { state: string; last_error: string }
  assert.equal(job.state, 'blocked')
  assert.match(job.last_error, /^PRICE_REVIEW:/)
  assert.match(job.last_error, /USD exchange rate is stale/)
})

test('6. Admin operations: price_review section and orders view return price_changed_review delivery_status', async t => {
  const { sql, env, adminCookie } = await testFixture()
  t.after(() => sql.close())

  // Set job to blocked with PRICE_REVIEW
  sql.prepare("UPDATE fulfillment_jobs SET state='blocked', last_error='PRICE_REVIEW:live_cost=50000:Supplier cost (50000) exceeds locked payment (45000); administrator review required.' WHERE order_item_id=?").run(item)

  // Create admin request for price_review section
  const reqPR = new Request('https://staging.test/api/admin/operations?section=price_review', {
    headers: { Origin: 'https://staging.test', Cookie: adminCookie }
  })
  const resPR = await adminOperations(reqPR, env)
  assert.equal(resPR.status, 200)
  const bodyPR = await resPR.json() as { records: Array<{ id: string; delivery_status: string; last_error: string }> }
  assert.equal(bodyPR.records.length, 1)
  assert.equal(bodyPR.records[0].delivery_status, 'price_changed_review')
  assert.match(bodyPR.records[0].last_error, /^PRICE_REVIEW:/)

  // Orders section also reflects price_changed_review
  const reqOrd = new Request('https://staging.test/api/admin/operations?section=orders', {
    headers: { Origin: 'https://staging.test', Cookie: adminCookie }
  })
  const resOrd = await adminOperations(reqOrd, env)
  assert.equal(resOrd.status, 200)
  const bodyOrd = await resOrd.json() as { records: Array<{ id: string; delivery_status: string }> }
  const matched = bodyOrd.records.find(r => r.id === order)
  assert.ok(matched)
  assert.equal(matched.delivery_status, 'price_changed_review')
})

test('7. Admin refund on price-blocked order credits customer wallet atomically', async t => {
  const { sql, env, adminCookie } = await testFixture()
  t.after(() => sql.close())

  // Set job to blocked with PRICE_REVIEW
  sql.prepare("UPDATE fulfillment_jobs SET state='blocked', last_error='PRICE_REVIEW:live_cost=50000:cost exceeded' WHERE order_item_id=?").run(item)

  const walletBefore = sql.prepare('SELECT balance_minor FROM wallets WHERE customer_id=?').get(user) as { balance_minor: number }
  assert.equal(walletBefore.balance_minor, 100000)

  const refundReq = new Request('https://staging.test/api/admin/operations', {
    method: 'POST',
    headers: {
      Origin: 'https://staging.test',
      'Content-Type': 'application/json',
      Cookie: adminCookie
    },
    body: JSON.stringify({ action: 'refund_order', id: order })
  })

  const refundRes = await adminOperations(refundReq, env)
  assert.equal(refundRes.status, 200)

  // Wallet credited by order total 45000
  const walletAfter = sql.prepare('SELECT balance_minor FROM wallets WHERE customer_id=?').get(user) as { balance_minor: number }
  assert.equal(walletAfter.balance_minor, 145000)

  // Order payment status marked refunded
  const orderRecord = sql.prepare('SELECT payment_status FROM orders WHERE id=?').get(order) as { payment_status: string }
  assert.equal(orderRecord.payment_status, 'refunded')

  // Job cancelled
  const jobRecord = sql.prepare('SELECT state, last_error FROM fulfillment_jobs WHERE order_item_id=?').get(item) as { state: string; last_error: string }
  assert.equal(jobRecord.state, 'blocked')
  assert.equal(jobRecord.last_error, 'Order refunded by administrator.')
})

test('8. Admin override fulfills order despite supplier price increase', async t => {
  const { sql, env } = await testFixture()
  t.after(() => sql.close())

  let buys = 0
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (init?.method === 'POST' && String(url).includes('purchase')) {
      buys++
      return Response.json({ success: true, data: { order_id: 999, accounts: ['vault:delivery:override'] } })
    }
    // Price is 500 NGN (higher than customer's 450 NGN)
    return Response.json({ success: true, data: { id: 12, slug: 'subscription-test', price_ngn: '500.00', available_stock: 5 } })
  })

  // Set job blocked first
  sql.prepare("UPDATE fulfillment_jobs SET state='blocked', last_error='PRICE_REVIEW:live_cost=50000:cost exceeded' WHERE order_item_id=?").run(item)

  const res = await fulfillPaidOrder(env, order, { adminOverride: true })
  assert.equal(res.success, true)
  assert.equal(res.delivered, true)
  assert.equal(buys, 1)

  const deliveredJob = sql.prepare('SELECT state FROM fulfillment_jobs WHERE order_item_id=?').get(item) as { state: string }
  assert.equal(deliveredJob.state, 'delivered')
  const ent = sql.prepare('SELECT instructions FROM product_entitlements WHERE order_item_id=?').get(item) as { instructions: string }
  assert.equal(ent.instructions, 'vault:delivery:override')
})
