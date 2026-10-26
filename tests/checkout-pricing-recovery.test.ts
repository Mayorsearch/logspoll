import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { payOrderWithWallet } from '../workers/api/wallet.ts'
import { assertAutomationQuotes, revalidateProductPrices, runSupplierAutomationBatch } from '../workers/api/supplier-automation.ts'
import { apiFetch } from '../workers/api/index.ts'
import type { ApiEnv, Database, Statement } from '../workers/api/types.ts'

const customer = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const admin = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')

  const directory = new URL('../workers/api/migrations/', import.meta.url)
  // Pin the fixture to approved migrations; the pending 0031 migration is excluded.
  for (const name of readdirSync(directory).filter(name => /^00\d{2}_.*\.sql$/.test(name) && name < '0031_').sort()) {
    sql.exec(readFileSync(new URL(name, directory), 'utf8'))
  }

  // Seed customer and admin
  sql.prepare('INSERT INTO users(id) VALUES(?)').run(customer)
  sql.prepare('INSERT INTO profiles(id, full_name) VALUES(?, ?)').run(customer, 'Test Customer')
  sql.prepare("INSERT INTO user_roles(user_id, role) VALUES(?, 'customer')").run(customer)
  sql.prepare("INSERT INTO auth_user(id, name, email, emailVerified, createdAt, updatedAt) VALUES(?, 'Customer', 'c@test.com', 1, '2026-01-01', '2026-01-01')").run(customer)

  sql.prepare('INSERT INTO users(id) VALUES(?)').run(admin)
  sql.prepare("INSERT INTO user_roles(user_id, role) VALUES(?, 'admin')").run(admin)

  // Seed Server 2 category if missing
  const s2Id = crypto.randomUUID()
  sql.prepare("INSERT INTO categories(id, slug, name, short_name, active) VALUES(?, 'server2', 'Server 2', 'S2', 1) ON CONFLICT(slug) DO NOTHING").run(s2Id)

  // Fund customer wallet with ₦3,000.00 (300,000 kobo)
  const walletId = crypto.randomUUID()
  sql.prepare("INSERT INTO wallets(id, customer_id, balance_minor, currency, status, created_at, updated_at) VALUES(?, ?, 300000, 'NGN', 'active', 1, 1)").run(walletId, customer)

  // Configure USD FX rate in global_pricing_config
  sql.prepare(`INSERT INTO global_pricing_config(id, markup_bps, auto_publish, automatic_pricing, auto_approve, usd_to_ngn_rate, delivery_type, updated_at)
    VALUES('global', 4000, 1, 1, 1, 1500.0, 'Manual fulfillment', ?)
    ON CONFLICT(id) DO UPDATE SET usd_to_ngn_rate=1500.0, automatic_pricing=1, markup_bps=4000`).run(Date.now())
  sql.prepare("UPDATE global_pricing_config SET fx_status='active',fx_updated_at=? WHERE id='global'").run(Date.now())

  // Configure supplier automation policies with 40% markup (cost ₦1,000 -> price ₦1,400)
  sql.prepare(`INSERT INTO supplier_automation(provider, markup_bps, automatic_pricing, auto_publish, auto_approve, updated_by)
    VALUES('hstora', 4000, 1, 1, 1, ?) ON CONFLICT(provider) DO UPDATE SET automatic_pricing=1, markup_bps=4000`).run(admin)
  sql.prepare(`INSERT INTO supplier_automation(provider, markup_bps, automatic_pricing, auto_publish, auto_approve, updated_by)
    VALUES('youngpg', 4000, 1, 1, 1, ?) ON CONFLICT(provider) DO UPDATE SET automatic_pricing=1, markup_bps=4000`).run(admin)
  sql.prepare(`INSERT INTO supplier_automation(provider, markup_bps, automatic_pricing, auto_publish, auto_approve, updated_by)
    VALUES('shopviaclone22', 4000, 1, 1, 1, ?) ON CONFLICT(provider) DO UPDATE SET automatic_pricing=1, markup_bps=4000`).run(admin)

  // Connections
  sql.prepare("INSERT INTO hstora_connection(id, enabled, revision, ciphertext, nonce) VALUES('hstora', 1, 1, 'mock', 'mock') ON CONFLICT(id) DO UPDATE SET enabled=1").run()
  sql.prepare("INSERT INTO shopviaclone22_connection(id, enabled, ciphertext, nonce, next_attempt) VALUES('shopviaclone22', 1, 'mock', 'mock', 0) ON CONFLICT(id) DO UPDATE SET enabled=1").run()
  const ypgConn = crypto.randomUUID()
  sql.prepare("INSERT INTO staging_supplier_connections(id, provider, name, enabled, authorized_products) VALUES(?, 'youngpg', 'YoungPG', 1, ?)").run(ypgConn, JSON.stringify({ '*': 'verified-auth-ref', '2001': 'verified-auth-ref' }))

  const prepare = (query: string): Statement => {
    let args: (string | number | null)[] = []
    return {
      bind(...v) {
        args = v
        return this
      },
      async all<T>() {
        const rows = sql.prepare(query).all(...(args as never[]))
        return { success: true, results: rows as T[] }
      },
      async first<T>() {
        const row = sql.prepare(query).get(...(args as never[]))
        return (row as T) ?? null
      },
      async run() {
        const result = sql.prepare(query).run(...(args as never[]))
        return { success: true, meta: { changes: result.changes } }
      },
    }
  }

  const db: Database = {
    prepare,
    async batch(statements: Statement[]) {
      sql.exec('BEGIN')
      try {
        const results = []
        for (const s of statements) results.push(await s.run())
        sql.exec('COMMIT')
        return results
      } catch (err) {
        sql.exec('ROLLBACK')
        throw err
      }
    },
  }

  const env: ApiEnv = {
    ENVIRONMENT: 'production',
    DB: db,
    AUTOMATION_ENABLED: 'true',
    CATALOG_SYNC_ENABLED: 'true',
    AUTO_FULFILLMENT_ENABLED: 'true',
  }

  return { sql, db, env, ypgConn, walletId }
}

test('Supplier 1 (HStora) Twitter Account: price ₦1,400 with ₦3,000 wallet balance leaves ₦1,600', async t => {
  const { sql, env, walletId } = fixture()
  t.after(() => sql.close())

  const catId = String(sql.prepare("SELECT id FROM categories WHERE slug='server1'").get()!.id)
  const prodId = crypto.randomUUID()
  const extId = '1001'
  const now = Date.now()

  // Product price ₦1,400 (140,000 kobo).
  // USD cost rounds up to 100,000 kobo before the configured markup.
  // Markup: 40% (4000 bps) -> Price: 140,000 kobo (₦1,400)
  const meta = JSON.stringify({
    name: '1 Month Old High Quality Twitter Account',
    description: 'Verified high quality 1 month aged Twitter X account.',
    price: '0.666666666666',
    currency: 'USD',
    stock: 50,
    supplier_available: true,
  })

  sql.prepare(`INSERT INTO products(id, category_id, slug, name, description, price_minor, currency, supplier_name, authorized_resale, status, publication_verified, pricing_mode, server_number,delivery_type)
    VALUES(?, ?, 'hstora-1001', '1 Month Old High Quality Twitter Account', 'Verified high quality 1 month aged Twitter X account.', 140000, 'NGN', 'HStora', 1, 'active', 1, 'auto', 1,'Manual fulfillment')`).run(prodId, catId)

  sql.prepare('INSERT INTO product_authorizations(product_id, evidence, reviewer_id, verified_at) VALUES(?, ?, ?, ?)').run(prodId, JSON.stringify({ delivery: true, privacy: true, provider: true }), admin, now)

  sql.prepare(`INSERT INTO hstora_catalog_items(external_id, metadata, checked_at, approval_status, selling_price_minor, product_id, snapshot_id)
    VALUES(?, ?, ?, 'approved', 140000, ?, 'snap-1')`).run(extId, meta, now, prodId)

  // Verify assertAutomationQuotes passes without throwing
  await assert.doesNotReject(assertAutomationQuotes(env, [prodId]))

  // Pay order with wallet
  const user = { id: customer, email: 'c@test.com' }
  const req = new Request('https://test/api/wallet/pay-order', {
    method: 'POST',
    body: JSON.stringify({
      requestId: crypto.randomUUID(),
      items: [{ id: prodId, quantity: 1 }],
    }),
  })

  const res = await payOrderWithWallet(req, env, user)
  assert.equal(res.status, 201)
  const data = await res.json() as {ok:boolean;totalMinor:number;balanceAfterMinor:number;orderId:string}

  assert.equal(data.ok, true)
  assert.equal(data.totalMinor, 140000) // ₦1,400 deducted
  assert.equal(data.balanceAfterMinor, 160000) // ₦1,600 remaining balance

  // Verify wallet balance in DB
  const wallet = sql.prepare('SELECT balance_minor FROM wallets WHERE id=?').get(walletId) as {balance_minor:number}
  assert.equal(wallet.balance_minor, 160000)

  // Verify order in DB
  const order = sql.prepare('SELECT payment_status, total_minor, payment_method FROM orders WHERE id=?').get(data.orderId) as {payment_status:string;total_minor:number;payment_method:string}
  assert.equal(order.payment_status, 'paid')
  assert.equal(order.payment_method, 'wallet')
  assert.equal(order.total_minor, 140000)
})

test('Supplier 2 (YoungPG): price ₦1,400 with ₦3,000 wallet balance leaves ₦1,600', async t => {
  const { sql, env, ypgConn, walletId } = fixture()
  t.after(() => sql.close())

  const catId = String(sql.prepare("SELECT id FROM categories WHERE slug='server2'").get()!.id)
  const prodId = crypto.randomUUID()
  const extId = '2001'
  const now = Date.now()
  const snapId = crypto.randomUUID()

  sql.prepare('INSERT INTO supplier_snapshots(id, connection_id, revision, started_at, completed_at) VALUES(?, ?, 1, ?, ?)').run(snapId, ypgConn, now - 100, now)

  sql.prepare(`INSERT INTO products(id, category_id, slug, name, description, price_minor, currency, supplier_name, authorized_resale, status, publication_verified, pricing_mode, server_number,delivery_type)
    VALUES(?, ?, 'ypg-2001', 'YoungPG Verified Social Account', 'Clean 1 month aged social media account with verified details.', 140000, 'NGN', 'YoungPG', 1, 'active', 1, 'auto', 2,'Manual fulfillment')`).run(prodId, catId)

  sql.prepare('INSERT INTO product_authorizations(product_id, evidence, reviewer_id, verified_at) VALUES(?, ?, ?, ?)').run(prodId, JSON.stringify({ delivery: true, privacy: true, provider: true }), admin, now)

  // Cost: 100,000 kobo (₦1,000). 40% markup -> 140,000 kobo (₦1,400)
  sql.prepare(`INSERT INTO staging_supplier_feed_items(connection_id, external_id, name, source_category, supplier_cost_minor, stock_quantity, authorization_verified, evidence_reference, source_checked_at, approval, category_id, selling_price_minor, delivery_type, reviewed_description, reviewed_by, reviewed_at, snapshot_id)
    VALUES(?, ?, 'YoungPG Verified Social Account', 'permitted_digital_good', 100000, 20, 1, 'verified-auth-ref', ?, 'approved', ?, 140000, 'Redemption code', 'Verified social account description of over twenty characters.', ?, ?, ?)`).run(ypgConn, extId, now, catId, admin, now, snapId)

  sql.prepare('INSERT INTO supplier_products(product_id, connection_id, external_id) VALUES(?, ?, ?)').run(prodId, ypgConn, extId)

  // Verify assertAutomationQuotes passes
  await assert.doesNotReject(assertAutomationQuotes(env, [prodId]))

  const user = { id: customer, email: 'c@test.com' }
  const req = new Request('https://test/api/wallet/pay-order', {
    method: 'POST',
    body: JSON.stringify({
      requestId: crypto.randomUUID(),
      items: [{ id: prodId, quantity: 1 }],
    }),
  })

  const res = await payOrderWithWallet(req, env, user)
  assert.equal(res.status, 201)
  const data = await res.json() as {ok:boolean;totalMinor:number;balanceAfterMinor:number;orderId:string}

  assert.equal(data.totalMinor, 140000)
  assert.equal(data.balanceAfterMinor, 160000)

  const wallet = sql.prepare('SELECT balance_minor FROM wallets WHERE id=?').get(walletId) as {balance_minor:number}
  assert.equal(wallet.balance_minor, 160000)
})

test('Supplier 3 (ShopViaClone22): price ₦1,400 with ₦3,000 wallet balance leaves ₦1,600', async t => {
  const { sql, env, walletId } = fixture()
  t.after(() => sql.close())

  const catId = String(sql.prepare("SELECT id FROM categories WHERE slug='server3'").get()!.id)
  const prodId = crypto.randomUUID()
  const extId = '3001'
  const now = Date.now()

  sql.prepare(`INSERT INTO products(id, category_id, slug, name, description, price_minor, currency, supplier_name, authorized_resale, status, publication_verified, pricing_mode, server_number,delivery_type)
    VALUES(?, ?, 's3-3001', 'ShopViaClone Account', 'High quality Server 3 account description.', 140000, 'NGN', 'ShopViaClone22', 1, 'active', 1, 'auto', 3,'Manual fulfillment')`).run(prodId, catId)

  sql.prepare('INSERT INTO product_authorizations(product_id, evidence, reviewer_id, verified_at) VALUES(?, ?, ?, ?)').run(prodId, JSON.stringify({ delivery: true, privacy: true, provider: true }), admin, now)

  // Cost: 100,000 kobo (₦1,000). 40% markup -> 140,000 kobo (₦1,400)
  sql.prepare(`INSERT INTO shopviaclone22_catalog_items(external_id, name, description, cost_minor, stock, checked_at, approval_status, selling_price_minor, product_id, snapshot_id, raw_metadata)
    VALUES(?, 'ShopViaClone Account', 'High quality Server 3 account description.', 100000, 15, ?, 'approved', 140000, ?, 'snap-3', '{}')`).run(extId, now, prodId)

  // Verify assertAutomationQuotes passes
  await assert.doesNotReject(assertAutomationQuotes(env, [prodId]))

  const user = { id: customer, email: 'c@test.com' }
  const req = new Request('https://test/api/wallet/pay-order', {
    method: 'POST',
    body: JSON.stringify({
      requestId: crypto.randomUUID(),
      items: [{ id: prodId, quantity: 1 }],
    }),
  })

  const res = await payOrderWithWallet(req, env, user)
  assert.equal(res.status, 201)
  const data = await res.json() as {ok:boolean;totalMinor:number;balanceAfterMinor:number;orderId:string}

  assert.equal(data.totalMinor, 140000)
  assert.equal(data.balanceAfterMinor, 160000)

  const wallet = sql.prepare('SELECT balance_minor FROM wallets WHERE id=?').get(walletId) as {balance_minor:number}
  assert.equal(wallet.balance_minor, 160000)
})

test('Price increase sync: revalidates prices, updates database, and allows customer to purchase at updated price', async t => {
  const { sql, env, walletId } = fixture()
  t.after(() => sql.close())

  const catId = String(sql.prepare("SELECT id FROM categories WHERE slug='server1'").get()!.id)
  const prodId = crypto.randomUUID()
  const extId = '1002'
  const now = Date.now()

  // Original product price was ₦1,000 (100,000 kobo)
  // Supplier cost rounds up to 107,143 kobo, then 40% markup rounds up to 150,001.
  const meta = JSON.stringify({
    name: 'Twitter Aged Account',
    description: 'Verified aged Twitter account with verified email.',
    price: '0.714285714286',
    currency: 'USD',
    stock: 25,
    supplier_available: true,
  })

  sql.prepare(`INSERT INTO hstora_catalog_items(external_id, metadata, checked_at, approval_status, selling_price_minor, product_id, snapshot_id)
    VALUES(?, ?, ?, 'approved', 100000, NULL, 'snap-1')`).run(extId, meta, now)

  // Product table still has old price ₦1,000
  sql.prepare(`INSERT INTO products(id, category_id, slug, name, description, price_minor, currency, supplier_name, authorized_resale, status, publication_verified, pricing_mode, server_number,delivery_type)
    VALUES(?, ?, 'hstora-1002', 'Twitter Aged Account', 'Verified aged Twitter account with verified email.', 100000, 'NGN', 'HStora', 1, 'active', 1, 'auto', 1,'Manual fulfillment')`).run(prodId, catId)
  sql.prepare('UPDATE hstora_catalog_items SET product_id=? WHERE external_id=?').run(prodId,extId)

  sql.prepare('INSERT INTO product_authorizations(product_id, evidence, reviewer_id, verified_at) VALUES(?, ?, ?, ?)').run(prodId, JSON.stringify({ delivery: true, privacy: true, provider: true }), admin, now)

  // 1. Initial checkout with stale price is rejected and automatically syncs the price in D1
  await assert.rejects(assertAutomationQuotes(env, [prodId]), /Supplier pricing refresh completed/)

  // 2. D1 product price is now updated using the canonical integer calculation.
  const updatedProd = sql.prepare('SELECT price_minor FROM products WHERE id=?').get(prodId) as {price_minor:number}
  assert.equal(updatedProd.price_minor, 150001)

  // 3. RevalidateProductPrices also confirms the fresh quote and no additional sync needed
  const reval = await revalidateProductPrices(env, [prodId])
  assert.equal(reval.updatedCount, 0) // Already synchronized

  // 4. Customer now checks out at the confirmed updated price.
  const user = { id: customer, email: 'c@test.com' }
  const req = new Request('https://test/api/wallet/pay-order', {
    method: 'POST',
    body: JSON.stringify({
      requestId: crypto.randomUUID(),
      items: [{ id: prodId, quantity: 1 }],
    }),
  })

  const res = await payOrderWithWallet(req, env, user)
  assert.equal(res.status, 201)
  const data = await res.json() as {ok:boolean;totalMinor:number;balanceAfterMinor:number;orderId:string}

  assert.equal(data.totalMinor, 150001)
  assert.equal(data.balanceAfterMinor, 149999)

  const wallet = sql.prepare('SELECT balance_minor FROM wallets WHERE id=?').get(walletId) as {balance_minor:number}
  assert.equal(wallet.balance_minor, 149999)
})

test('Unavailable supplier produces clear product-specific message and does not deduct balance', async t => {
  const { sql, env, walletId } = fixture()
  t.after(() => sql.close())

  const catId = String(sql.prepare("SELECT id FROM categories WHERE slug='server1'").get()!.id)
  const prodId = crypto.randomUUID()
  const extId = '1003'
  const now = Date.now()

  // Supplier reported unavailable
  const meta = JSON.stringify({
    name: 'Discontinued Item',
    description: 'Item that supplier has removed from catalog.',
    price: '1.00',
    currency: 'USD',
    stock: 0,
    supplier_available: false,
  })

  sql.prepare(`INSERT INTO hstora_catalog_items(external_id, metadata, checked_at, approval_status, selling_price_minor, product_id, snapshot_id)
    VALUES(?, ?, ?, 'approved', 140000, NULL, 'snap-1')`).run(extId, meta, now)

  sql.prepare(`INSERT INTO products(id, category_id, slug, name, description, price_minor, currency, supplier_name, authorized_resale, status, publication_verified, pricing_mode, server_number,delivery_type)
    VALUES(?, ?, 'hstora-1003', 'Discontinued Item', 'Item that supplier has removed from catalog.', 140000, 'NGN', 'HStora', 1, 'active', 1, 'auto', 1,'Manual fulfillment')`).run(prodId, catId)
  sql.prepare('UPDATE hstora_catalog_items SET product_id=? WHERE external_id=?').run(prodId,extId)

  sql.prepare('INSERT INTO product_authorizations(product_id, evidence, reviewer_id, verified_at) VALUES(?, ?, ?, ?)').run(prodId, JSON.stringify({ delivery: true, privacy: true, provider: true }), admin, now)

  // Assert clear product-specific error
  await assert.rejects(
    assertAutomationQuotes(env, [prodId]),
    /currently unavailable from the supplier/
  )

  // Wallet balance remains completely untouched
  const wallet = sql.prepare('SELECT balance_minor FROM wallets WHERE id=?').get(walletId) as {balance_minor:number}
  assert.equal(wallet.balance_minor, 300000)
})

function hstoraProduct(sql:DatabaseSync,{nativePrice='0.12',currency='USD',price=100000,mode='auto'}={}) {
  const id=crypto.randomUUID(),externalId=crypto.randomUUID(),now=Date.now()
  const category=String(sql.prepare("SELECT id FROM categories WHERE slug='server1'").get()!.id)
  sql.prepare(`INSERT INTO products(id,category_id,slug,name,description,price_minor,currency,supplier_name,authorized_resale,status,publication_verified,pricing_mode,server_number,delivery_type)
    VALUES(?,?,?,'Licensed subscription','Verified licensed subscription description',?,'NGN','HStora',1,'active',1,?,1,'Manual fulfillment')`).run(id,category,'fixture-'+id,price,mode)
  sql.prepare('INSERT INTO product_authorizations(product_id,evidence,reviewer_id,verified_at) VALUES(?,?,?,?)').run(id,JSON.stringify({delivery:true,privacy:true,provider:true}),admin,now)
  sql.prepare(`INSERT INTO hstora_catalog_items(external_id,metadata,checked_at,approval_status,selling_price_minor,product_id,snapshot_id)
    VALUES(?,?,?,'approved',?,?,'verified-snapshot')`).run(externalId,JSON.stringify({id:externalId,name:'Licensed subscription',description:'Verified licensed subscription description',price:nativePrice,currency,stock:10,supplier_available:true}),now,price,id)
  return {id,externalId,category}
}

test('missing, stale, paused and future FX block USD quotes without guessing a rate',async t=>{
  const cases=[
    ['missing',"DELETE FROM global_pricing_config"],
    ['undated',"UPDATE global_pricing_config SET fx_updated_at=0"],
    ['stale status',"UPDATE global_pricing_config SET fx_status='stale'"],
    ['paused',"UPDATE global_pricing_config SET fx_status='paused'"],
    ['expired',`UPDATE global_pricing_config SET fx_updated_at=${Date.now()-3600001}`],
    ['future',`UPDATE global_pricing_config SET fx_updated_at=${Date.now()+60000}`],
  ]
  for(const [label,mutation] of cases)await t.test(label,async()=>{
    const {sql,env}=fixture()
    try{
      const {id}=hstoraProduct(sql)
      sql.exec(mutation)
      const result=await revalidateProductPrices(env,[id])
      assert.equal(result.updatedCount,0)
      assert.equal(result.blockedItems[0].id,id)
      assert.match(result.blockedItems[0].reason,/USD exchange rate is missing or stale/)
      await assert.rejects(assertAutomationQuotes(env,[id]),error=>error instanceof Error&&error.message===result.blockedItems[0].reason)
      assert.equal(sql.prepare('SELECT price_minor FROM products WHERE id=?').get(id)!.price_minor,100000)
    }finally{sql.close()}
  })
})

test('fresh verified USD uses configured provider markup and canonical integer conversion',async t=>{
  const {sql,env}=fixture();t.after(()=>sql.close())
  const {id}=hstoraProduct(sql)
  sql.exec("UPDATE global_pricing_config SET usd_to_ngn_rate=1400;UPDATE supplier_automation SET markup_bps=10000 WHERE provider='hstora'")
  const result=await revalidateProductPrices(env,[id])
  assert.deepEqual(result.blockedItems,[])
  assert.equal(result.updatedCount,1)
  assert.equal(result.changedItems[0].newPriceMinor,33600)
  assert.equal(sql.prepare('SELECT selling_price_minor FROM hstora_catalog_items WHERE product_id=?').get(id)!.selling_price_minor,33600)
  await assert.doesNotReject(assertAutomationQuotes(env,[id]))
  const tiny=hstoraProduct(sql,{nativePrice:'0.000000001'})
  const rounded=await revalidateProductPrices(env,[tiny.id])
  assert.equal(rounded.changedItems[0].newPriceMinor,2)
})

test('a dated active manual FX override is honored and an expired override is blocked',async t=>{
  const {sql,env}=fixture();t.after(()=>sql.close())
  const {id}=hstoraProduct(sql,{nativePrice:'1.00'})
  sql.exec("UPDATE global_pricing_config SET fx_override_active=1,fx_override_rate=1200,usd_to_ngn_rate=1500")
  assert.equal((await revalidateProductPrices(env,[id])).changedItems[0].newPriceMinor,168000)
  sql.exec('UPDATE global_pricing_config SET fx_updated_at=0')
  assert.match((await revalidateProductPrices(env,[id])).blockedItems[0].reason,/USD exchange rate is missing or stale/)
})

test('category markup including zero and manual product overrides keep their configured priority',async t=>{
  const {sql,env}=fixture();t.after(()=>sql.close())
  const {id,category}=hstoraProduct(sql,{nativePrice:'1.00'})
  sql.prepare(`INSERT INTO supplier_category_rules(id,provider,category_id,markup_bps,updated_by,updated_at)
    VALUES('configured-rule','hstora',?,2500,?,?)`).run(category,admin,Date.now())
  assert.equal((await revalidateProductPrices(env,[id])).changedItems[0].newPriceMinor,187500)
  sql.exec("UPDATE supplier_category_rules SET markup_bps=0 WHERE id='configured-rule'")
  assert.equal((await revalidateProductPrices(env,[id])).changedItems[0].newPriceMinor,150000)
  sql.prepare("UPDATE products SET pricing_mode='override',price_minor=12345 WHERE id=?").run(id)
  sql.exec("UPDATE global_pricing_config SET fx_status='stale',fx_updated_at=0")
  assert.deepEqual(await revalidateProductPrices(env,[id]),{updatedCount:0,changedItems:[],blockedItems:[]})
  await assert.doesNotReject(assertAutomationQuotes(env,[id]))
  assert.equal(sql.prepare('SELECT price_minor FROM products WHERE id=?').get(id)!.price_minor,12345)
})

test('missing or disabled automation policies do not invent replacement pricing',async t=>{
  const {sql,env}=fixture();t.after(()=>sql.close())
  const {id}=hstoraProduct(sql)
  sql.exec("UPDATE supplier_automation SET automatic_pricing=0 WHERE provider='hstora'")
  assert.equal((await revalidateProductPrices(env,[id])).updatedCount,0)
  sql.exec("DELETE FROM supplier_automation WHERE provider='hstora'")
  assert.equal((await revalidateProductPrices(env,[id])).updatedCount,0)
  assert.equal(sql.prepare('SELECT price_minor FROM products WHERE id=?').get(id)!.price_minor,100000)
})

test('NGN prices do not require FX and stale stock never receives a fabricated freshness update',async t=>{
  const {sql,env}=fixture();t.after(()=>sql.close())
  const {id}=hstoraProduct(sql,{nativePrice:'1000',currency:'NGN'})
  sql.exec('DELETE FROM global_pricing_config')
  assert.equal((await revalidateProductPrices(env,[id])).changedItems[0].newPriceMinor,140000)
  const checked=Date.now()-86460000
  sql.prepare('UPDATE hstora_catalog_items SET checked_at=? WHERE product_id=?').run(checked,id)
  const result=await revalidateProductPrices(env,[id])
  assert.equal(result.updatedCount,0)
  assert.match(result.blockedItems[0].reason,/supplier cost is unverified/)
  assert.equal(sql.prepare('SELECT checked_at FROM hstora_catalog_items WHERE product_id=?').get(id)!.checked_at,checked)
  assert.equal(sql.prepare('SELECT available_quantity FROM verified_product_stock WHERE id=?').get(id)!.available_quantity,0)
})

test('background automation uses the same verified USD quote as checkout',async t=>{
  const {sql,env}=fixture();t.after(()=>sql.close())
  const {id}=hstoraProduct(sql)
  const result=await runSupplierAutomationBatch(env,'hstora')
  assert.equal(result.changed,1)
  assert.equal(sql.prepare('SELECT price_minor FROM products WHERE id=?').get(id)!.price_minor,25200)
  await assert.doesNotReject(assertAutomationQuotes(env,[id]))
})

test('transactional pricing failures propagate and roll back every changed row',async t=>{
  const {sql,env}=fixture();t.after(()=>sql.close())
  const {id}=hstoraProduct(sql)
  sql.exec("CREATE TRIGGER reject_catalog_price BEFORE UPDATE OF selling_price_minor ON hstora_catalog_items BEGIN SELECT RAISE(ABORT,'simulated catalog write failure');END")
  await assert.rejects(revalidateProductPrices(env,[id]),/simulated catalog write failure/)
  await assert.rejects(assertAutomationQuotes(env,[id]),/simulated catalog write failure/)
  assert.equal(sql.prepare('SELECT price_minor FROM products WHERE id=?').get(id)!.price_minor,100000)
  assert.equal(sql.prepare('SELECT selling_price_minor FROM hstora_catalog_items WHERE product_id=?').get(id)!.selling_price_minor,100000)
  assert.equal(sql.prepare('SELECT count(*) n FROM admin_write_fences').get()!.n,0)
})

test('concurrent product, supplier, policy, category and FX changes abort stale repricing',async t=>{
  for(const mutation of ['override','source','policy','category','fx'])await t.test(mutation,async()=>{
    const {sql,db,env}=fixture()
    try{
      const {id,category}=hstoraProduct(sql)
      const originalBatch=db.batch.bind(db)
      db.batch=async statements=>{
        if(mutation==='override')sql.prepare("UPDATE products SET pricing_mode='override',price_minor=12345 WHERE id=?").run(id)
        if(mutation==='source')sql.prepare("UPDATE hstora_catalog_items SET metadata=json_set(metadata,'$.price','0.20') WHERE product_id=?").run(id)
        if(mutation==='policy')sql.exec("UPDATE supplier_automation SET markup_bps=7000,revision=revision+1 WHERE provider='hstora'")
        if(mutation==='category')sql.prepare("INSERT INTO supplier_category_rules(id,provider,category_id,markup_bps,updated_by,updated_at) VALUES('new-rule','hstora',?,2500,?,?)").run(category,admin,Date.now())
        if(mutation==='fx')sql.exec('UPDATE global_pricing_config SET usd_to_ngn_rate=1600')
        return originalBatch(statements)
      }
      await assert.rejects(revalidateProductPrices(env,[id]),/changed during verification/)
      assert.equal(sql.prepare('SELECT price_minor FROM products WHERE id=?').get(id)!.price_minor,mutation==='override'?12345:100000)
      assert.equal(sql.prepare('SELECT selling_price_minor FROM hstora_catalog_items WHERE product_id=?').get(id)!.selling_price_minor,100000)
      assert.equal(sql.prepare('SELECT count(*) n FROM admin_write_fences').get()!.n,0)
    }finally{sql.close()}
  })
})

test('guest cart refresh reports blocked FX without exposing supplier data or changing prices',async t=>{
  const {sql,env}=fixture();t.after(()=>sql.close())
  const {id}=hstoraProduct(sql)
  sql.exec("UPDATE global_pricing_config SET fx_status='stale',fx_updated_at=0")
  const response=await apiFetch(new Request('https://test/api/cart/refresh-prices',{method:'POST',headers:{Origin:'https://test','Content-Type':'application/json'},body:JSON.stringify({ids:[id]})}),{...env,ENVIRONMENT:'staging'})
  assert.equal(response.status,200)
  const body=await response.json() as {records:Record<string,unknown>[];priceChanged:boolean;blockedItems:Array<{id:string;reason:string}>}
  assert.equal(body.priceChanged,false)
  assert.equal(body.records.length,1)
  assert.equal(body.blockedItems[0].id,id)
  assert.match(body.blockedItems[0].reason,/USD exchange rate is missing or stale/)
  for(const field of ['metadata','native_price','supplier_cost_minor','cost_minor','supplier_name','evidence'])assert.equal(field in body.records[0],false)
})

test('cart refresh refuses cross-origin requests and does not reprice hidden products',async t=>{
  const {sql,env}=fixture();t.after(()=>sql.close())
  const {id}=hstoraProduct(sql)
  const request=(origin:string)=>new Request('https://test/api/cart/refresh-prices',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({ids:[id]})})
  assert.equal((await apiFetch(request('https://elsewhere.test'),{...env,ENVIRONMENT:'staging'})).status,403)
  sql.prepare("UPDATE products SET status='inactive',publication_verified=0 WHERE id=?").run(id)
  const response=await apiFetch(request('https://test'),{...env,ENVIRONMENT:'staging'})
  assert.equal(response.status,200)
  const body=await response.json() as {records:unknown[];priceChanged:boolean;blockedItems:unknown[]}
  assert.deepEqual(body.records,[])
  assert.equal(body.priceChanged,false)
  assert.deepEqual(body.blockedItems,[])
  assert.equal(sql.prepare('SELECT price_minor FROM products WHERE id=?').get(id)!.price_minor,100000)
})

test('Re-purchasing an item after refund creates a distinct transaction reference and succeeds', async t => {
  const {sql, env} = fixture(); t.after(() => sql.close())
  const {id} = hstoraProduct(sql, { mode: 'override' })
  const reqId = crypto.randomUUID()
  const user = { id: customer, email: 'c@test.com' }
  const req = (rId: string) => new Request('https://test/api/wallet/pay-order', {
    method: 'POST',
    body: JSON.stringify({
      requestId: rId,
      items: [{ id, quantity: 1 }],
    }),
  })

  // 1. First purchase
  const res1 = await payOrderWithWallet(req(reqId), env, user)
  assert.equal(res1.status, 201)
  const body1 = await res1.json() as { ok: boolean; orderId: string }
  assert.equal(body1.ok, true)

  // 2. Simulate order refund in database
  sql.prepare("UPDATE orders SET payment_status='refunded' WHERE id=?").run(body1.orderId)
  sql.prepare("INSERT INTO wallet_transactions(id, wallet_id, customer_id, order_id, type, direction, amount_minor, balance_before_minor, balance_after_minor, reference, status, created_at) SELECT ?, wallet_id, customer_id, order_id, 'refund', 'credit', amount_minor, balance_after_minor, balance_before_minor, ?, 'completed', 2 FROM wallet_transactions WHERE order_id=?").run(crypto.randomUUID(), 'TX-REF-' + body1.orderId, body1.orderId)
  sql.prepare("UPDATE wallets SET balance_minor=300000 WHERE customer_id=?").run(customer)

  // 3. Re-purchase with same requestId must not crash on UNIQUE(reference)
  const res2 = await payOrderWithWallet(req(reqId), env, user)
  assert.equal(res2.status, 201)
  const body2 = await res2.json() as { ok: boolean; orderId: string }
  assert.equal(body2.ok, true)
  assert.notEqual(body2.orderId, body1.orderId)
})
