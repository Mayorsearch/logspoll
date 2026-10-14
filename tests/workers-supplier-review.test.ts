import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { apiFetch } from '../workers/api/index.ts'
import type { ApiEnv, Database, Statement } from '../workers/api/types.ts'

const connect = '50000000-0000-4000-8000-000000000001'
const category = '20000000-0000-4000-8000-000000000001'
function setup() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys=ON')
  for (const file of ['migrations/0001_staging_foundation.sql','fixtures.sql','migrations/0002_cloudflare_auth.sql',
    'migrations/0003_auth_mail_diagnostics.sql','migrations/0004_supplier_review.sql','migrations/0005_supplier_sync.sql','migrations/0006_admin_publication.sql','migrations/0007_supplier_wide_authorization.sql','migrations/0008_sync_snapshot_retry.sql']) {
    sqlite.exec(readFileSync(new URL('../workers/api/'+file, import.meta.url), 'utf8'))
  }
  const db = {
    prepare(sql: string) {
      let values: unknown[] = []
      const statement = {
        bind(...input: unknown[]) { values = input; return statement },
        async all() {
          const results = sqlite.prepare(sql).all(...values as never[])
          const changes = sqlite.prepare('SELECT changes() AS n').get()!.n
          return { results, success: true, meta: { changes, last_row_id: 0 } }
        },
        async first() { return (await statement.all()).results[0] ?? null },
        async run() { return statement.all() },
      }
      return statement
    },
    async batch(statements: Statement[]) {
      sqlite.exec('BEGIN')
      try { const result = await Promise.all(statements.map(s => s.all())); sqlite.exec('COMMIT'); return result }
      catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
    async exec(sql: string) { sqlite.exec(sql) },
  } as Database
  const env: ApiEnv = { ENVIRONMENT: 'staging', DB: db, AUTH_ENABLED: 'true', AUTH_ORIGIN: 'https://staging.test',
    AUTH_SECRET: 'synthetic-secret-for-d1-staging-review-test-only', RESEND_API_KEY: 're_synthetic_key', SUPPLIER_ENCRYPTION_KEY:btoa('s'.repeat(32)) }
  const request = (path: string, data?: unknown, cookie?: string, origin = 'https://staging.test') => new Request('https://staging.test'+path, {
    ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }),
    headers: { Origin: origin, 'Content-Type': 'application/json', 'cf-connecting-ip': '192.0.2.10', ...(cookie ? { Cookie: cookie } : {}) },
  })
  return {sqlite,env,request}
}
async function member(ctx: ReturnType<typeof setup>) {
  const email = 'supplier-review@example.test'
  const password = 'Synthetic reviewed password 2026!'
  const signup = await apiFetch(ctx.request('/api/auth/sign-up/email', { name: 'Staging Reviewer',email,password }),ctx.env)
  assert.equal(signup.status,200,await signup.clone().text())
  // Test-only fixture setup. End-to-end email verification is covered separately.
  ctx.sqlite.prepare('UPDATE auth_user SET "emailVerified"=1 WHERE email=?').run(email)
  const login = await apiFetch(ctx.request('/api/auth/sign-in/email',{email,password}),ctx.env)
  assert.equal(login.status,200,await login.clone().text())
  const cookie = login.headers.get('set-cookie')!.split(';')[0]
  const userResponse = await apiFetch(ctx.request('/api/account/session',undefined,cookie),ctx.env)
  assert.equal(userResponse.status,200,await userResponse.clone().text())
  const body = await userResponse.json() as {user:{id:string}}
  return {cookie,id:body.user.id}
}
function stage(sqlite: DatabaseSync, externalId: string, kind = 'permitted_digital_good', authorized = 1) {
  sqlite.prepare('INSERT OR IGNORE INTO supplier_snapshots(id,connection_id,revision,started_at,completed_at) VALUES(?,?,1,?,?)').run('test-snapshot',connect,Date.now()-1000,Date.now()-500)
  const previous=sqlite.prepare('SELECT authorized_products FROM staging_supplier_connections WHERE id=?').get(connect)!
  sqlite.prepare('UPDATE staging_supplier_connections SET enabled=1,authorized_products=? WHERE id=?')
    .run(JSON.stringify({...JSON.parse(String(previous.authorized_products)),[externalId]:'DOCUMENTED-LICENSE-REF'}),connect)
  sqlite.prepare(`INSERT INTO staging_supplier_feed_items(connection_id,external_id,name,source_category,supplier_cost_minor,
    stock_quantity,authorization_verified,evidence_reference,source_checked_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(connect,externalId,'Synthetic licensed item',kind,500,4,authorized,'DOCUMENTED-LICENSE-REF',Date.now())
  sqlite.prepare("UPDATE staging_supplier_feed_items SET snapshot_id='test-snapshot' WHERE connection_id=?").run(connect)
}

test('catalog settings require server admin role; key rotation preserves evidence and never returns ciphertext',async()=>{
  const ctx=setup();const account=await member(ctx)
  const path='/api/admin/catalog'
  assert.equal((await apiFetch(ctx.request(path),ctx.env)).status,401)
  assert.equal((await apiFetch(ctx.request(path,undefined,account.cookie),ctx.env)).status,403)
  ctx.sqlite.prepare("UPDATE user_roles SET role='admin' WHERE user_id=?").run(account.id)
  const data={action:'save',id:connect,name:'Licensed supplier',revision:0,enabled:true,api_key:'ypg_'+'a'.repeat(48),authorized_products:{'1':'LICENSE-EVIDENCE-1'}}
  const saved=await apiFetch(ctx.request(path,data,account.cookie),ctx.env)
  assert.equal(saved.status,200,await saved.clone().text())
  const before=ctx.sqlite.prepare('SELECT encrypted_key FROM staging_supplier_connections').get()!.encrypted_key
  const rotated=await apiFetch(ctx.request(path,{action:'save',id:connect,name:'Licensed supplier',revision:1,enabled:true,api_key:'ypg_'+'b'.repeat(48)},account.cookie),ctx.env)
  assert.equal(rotated.status,200,await rotated.clone().text())
  assert.notEqual(ctx.sqlite.prepare('SELECT encrypted_key FROM staging_supplier_connections').get()!.encrypted_key,before)
  assert.equal(ctx.sqlite.prepare('SELECT authorized_products FROM staging_supplier_connections').get()!.authorized_products,JSON.stringify(data.authorized_products))
  const visible=await(await apiFetch(ctx.request(path,undefined,account.cookie),ctx.env)).text()
  assert.doesNotMatch(visible,/encrypted_key|key_nonce|ypg_|LICENSE-EVIDENCE/)
  assert.equal((await apiFetch(ctx.request(path,data,account.cookie),ctx.env)).status,409)
  assert.equal((await apiFetch(ctx.request(path,{...data,revision:2},account.cookie,'https://evil.test'),ctx.env)).status,403)
})
test('staging D1 supplier review requires verified administrator, same-origin POST, and separate migrations',async () => {
  const ctx=setup()
  const {sqlite,request,env}=ctx
  sqlite.prepare('INSERT INTO staging_supplier_connections(id,provider,name) VALUES(?,?,?)').run(connect,'youngpg','Synthetic YoungPG')
  stage(sqlite,'approved-source')
  assert.equal((await apiFetch(request('/api/admin/supplier-review'),env)).status,401)
  const {cookie,id}=await member(ctx)
  assert.equal((await apiFetch(request('/api/admin/supplier-review',undefined,cookie),env)).status,403)
  sqlite.prepare("UPDATE user_roles SET role='admin' WHERE user_id=?").run(id)
  const read=await apiFetch(request('/api/admin/supplier-review',undefined,cookie),env)
  assert.equal(read.status,200,await read.clone().text())
  const response=await read.json() as {items:unknown[];supplierSyncEnabled:boolean;publicationEnabled:boolean;legacyApprovalsImported:boolean}
  assert.equal(response.items.length,1)
  assert.equal(response.supplierSyncEnabled,false)
  assert.equal(response.publicationEnabled,true)
  assert.equal((await apiFetch(request('/api/admin/supplier-review',{action:'reject',connection_id:connect,external_id:'approved-source'},cookie,'https://evil.test'),env)).status,403)
  assert.equal(sqlite.prepare('SELECT approval FROM staging_supplier_feed_items').get()!.approval,'pending')
  assert.equal((await apiFetch(request('/api/admin/supplier-review',{action:'reject',connection_id:connect,external_id:'approved-source'},cookie),env)).status,200)
  assert.equal(sqlite.prepare('SELECT approval FROM staging_supplier_feed_items').get()!.approval,'rejected')
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM staging_supplier_review_events').get()!.n,1)
})
test('D1 approval, publication, stock revocation, price overrides and descriptions stay consistent',async()=>{
 const ctx=setup(),{sqlite,request,env}=ctx;sqlite.prepare('INSERT INTO staging_supplier_connections(id,provider,name) VALUES(?,?,?)').run(connect,'youngpg','Reviewed supplier')
 stage(sqlite,'license');stage(sqlite,'auto');stage(sqlite,'zero');stage(sqlite,'forbidden','account_access',1)
 sqlite.prepare("UPDATE staging_supplier_feed_items SET stock_quantity=0 WHERE external_id='zero'").run()
 const {cookie,id}=await member(ctx);sqlite.prepare("UPDATE user_roles SET role='admin' WHERE user_id=?").run(id)
 const review=(external_id:string,price_minor?:number)=>request('/api/admin/supplier-review',{action:'approve',connection_id:connect,external_id,category_id:category,delivery_type:'Redemption code',description:'Administrator reviewed licensed digital utility.',...(price_minor===undefined?{}:{price_minor})},cookie)
 assert.equal((await apiFetch(review('forbidden'),env)).status,409)
 assert.equal((await apiFetch(review('license',2.3),env)).status,400)
 const approved=await apiFetch(review('license',7777),env);assert.equal(approved.status,200,await approved.clone().text());const product=(await approved.json()).product_id
 assert.equal((await apiFetch(review('license',7777),env)).status,200) // Retry creates no duplicates.
 assert.equal(sqlite.prepare('SELECT count(*) n FROM supplier_products WHERE external_id=?').get('license')!.n,1)
 assert.equal(sqlite.prepare('SELECT status FROM products WHERE id=?').get(product)!.status,'draft')
 const action=(body:unknown)=>apiFetch(request('/api/admin/operations',body,cookie),env)
 assert.equal((await action({action:'publish',id:product})).status,200)
 let visible=await(await apiFetch(request('/api/products?category=synthetic-staging',undefined,cookie),env)).json()
 assert.ok(visible.records.some((p:{id:string;available_quantity:number})=>p.id===product&&p.available_quantity===4))
 const save={action:'save_product',id:product,category_id:category,name:'Reviewed utility',slug:'reviewed-utility',description:'Administrator edited description retained on future sync.',price_minor:9999,delivery_type:'Redemption code'}
 assert.equal((await action(save)).status,200)
 sqlite.prepare("UPDATE staging_supplier_feed_items SET supplier_cost_minor=600,supplier_description='Changed supplier description' WHERE external_id='license'").run()
 assert.equal(sqlite.prepare('SELECT price_minor FROM products WHERE id=?').get(product)!.price_minor,9999)
 assert.equal(sqlite.prepare('SELECT description FROM products WHERE id=?').get(product)!.description,save.description)
 const automatic=await apiFetch(review('auto'),env);assert.equal(automatic.status,200);const autoId=(await automatic.json()).product_id
 sqlite.prepare("UPDATE staging_supplier_feed_items SET supplier_cost_minor=800 WHERE external_id='auto'").run()
 assert.equal(sqlite.prepare('SELECT price_minor FROM products WHERE id=?').get(autoId)!.price_minor,800)
 const zero=await apiFetch(review('zero'),env);assert.equal(zero.status,200);assert.equal((await action({action:'publish',id:(await zero.json()).product_id})).status,409)
 sqlite.prepare('UPDATE staging_supplier_connections SET enabled=0 WHERE id=?').run(connect)
 assert.equal(sqlite.prepare('SELECT available_quantity FROM verified_product_stock WHERE id=?').get(product)!.available_quantity,0)
 sqlite.prepare('UPDATE staging_supplier_connections SET enabled=1 WHERE id=?').run(connect)
 assert.equal((await apiFetch(request('/api/admin/supplier-review',{action:'reject',connection_id:connect,external_id:'license'},cookie),env)).status,200)
 visible=await(await apiFetch(request('/api/products',undefined,cookie),env)).json();assert.ok(!visible.records.some((p:{id:string})=>p.id===product))
 assert.equal((await action({...save,available_quantity:100})).status,400)
 assert.equal((await apiFetch(request('/api/admin/readiness',undefined,cookie),env)).status,200)
 assert.equal((await apiFetch(request('/api/admin/operations',{action:'publish',id:product},cookie,'https://evil.test'),env)).status,403)
 assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length,0)
})

test('D1 admin CRUD, account restrictions, invitations, audit and durable notification events enforce roles',async()=>{
 const ctx=setup(),{sqlite,request,env}=ctx;const first=await member(ctx)
 assert.equal((await apiFetch(request('/api/admin/operations',undefined,first.cookie),env)).status,403)
 sqlite.prepare("UPDATE user_roles SET role='admin' WHERE user_id=?").run(first.id)
 const action=(body:unknown)=>apiFetch(request('/api/admin/operations',body,first.cookie),env)
 const cat='60000000-0000-4000-8000-000000000001'
 assert.equal((await action({action:'save_category',id:cat,name:'Utilities',short_name:'Tools',slug:'licensed-utilities',description:'Licensed digital utilities',active:true})).status,200)
 const manual={action:'save_product',category_id:cat,name:'Licensed manual product',slug:'licensed-manual',description:'Verified licensed resource, reviewed for resale.',price_minor:1234,delivery_type:'Licensed digital download',available_quantity:2,evidence:'TEST-REVIEWED-LICENSE'}
 const created=await action(manual);assert.equal(created.status,200,await created.clone().text());const product=(await created.json()).id
 assert.equal((await action({action:'publish',id:product})).status,200)
 assert.equal(sqlite.prepare('SELECT available_quantity FROM storefront_products WHERE id=?').get(product)!.available_quantity,2)
 assert.equal((await action({action:'settings',value:{support_email:'support@example.test'}})).status,200)
 assert.equal((await action({action:'account_status',id:first.id,status:'restricted'})).status,400)
 const email='invitee@example.test',password='Synthetic secure password 2026!'
 assert.equal((await apiFetch(request('/api/auth/sign-up/email',{email,password,name:'Invited Customer'}),env)).status,200)
 sqlite.prepare('UPDATE auth_user SET emailVerified=1 WHERE email=?').run(email)
 const login=await apiFetch(request('/api/auth/sign-in/email',{email,password}),env);assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0]
 const user=(await(await apiFetch(request('/api/account/session',undefined,cookie),env)).json()).user
 assert.equal((await apiFetch(request('/api/account/admin-enrollment',{},cookie),env)).status,403)
 assert.equal((await action({action:'invite_admin',id:user.id})).status,200)
 assert.equal((await apiFetch(request('/api/account/admin-enrollment',{},cookie),env)).status,200)
 assert.equal((await apiFetch(request('/api/account/admin-enrollment',{},cookie),env)).status,403)
 assert.equal((await apiFetch(request('/api/admin/overview',undefined,cookie),env)).status,200)
 assert.equal((await action({action:'account_status',id:user.id,status:'restricted'})).status,200)
 assert.equal((await apiFetch(request('/api/account/session',undefined,cookie),env)).status,401)
 assert.equal((await action({action:'account_status',id:user.id,status:'active'})).status,200)
 assert.ok(Number(sqlite.prepare('SELECT count(*) n FROM business_mail_events').get()!.n)>=3)
 assert.ok(Number(sqlite.prepare('SELECT count(*) n FROM audit_logs').get()!.n)>=5)
 assert.equal((await action({action:'deliver',id:'40000000-0000-4000-8000-000000000001',instructions:'Not paid; must not deliver.'})).status,409)
 assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length,0)
})

test('supplier-wide evidence authorizes review and verified stock; product-specific evidence overrides it',async()=>{
 const ctx=setup(),{sqlite,request,env}=ctx;const {cookie,id}=await member(ctx)
 sqlite.prepare("UPDATE user_roles SET role='admin' WHERE user_id=?").run(id)
 sqlite.prepare('INSERT INTO staging_supplier_connections(id,provider,name) VALUES(?,?,?)').run(connect,'youngpg','Licensed supplier')
 stage(sqlite,'wide-item')
 sqlite.prepare('UPDATE staging_supplier_connections SET authorized_products=? WHERE id=?').run(JSON.stringify({'*':'DOCUMENTED-LICENSE-REF'}),connect)
 const body={action:'approve',connection_id:connect,external_id:'wide-item',category_id:category,description:'Reviewed licensed digital resource for authorized resale.',delivery_type:'Redemption code'}
 const approved=await apiFetch(request('/api/admin/supplier-review',body,cookie),env)
 assert.equal(approved.status,200,await approved.clone().text());const product=(await approved.json()).product_id
 assert.equal(sqlite.prepare('SELECT available_quantity FROM verified_product_stock WHERE id=?').get(product)!.available_quantity,4)
 sqlite.prepare('UPDATE staging_supplier_connections SET authorized_products=? WHERE id=?').run(JSON.stringify({'*':'DOCUMENTED-LICENSE-REF','wide-item':'DIFFERENT-PRODUCT-EVIDENCE'}),connect)
 assert.equal(sqlite.prepare('SELECT available_quantity FROM verified_product_stock WHERE id=?').get(product)!.available_quantity,0)
 assert.equal((await apiFetch(request('/api/admin/supplier-review',body,cookie),env)).status,409)
 sqlite.prepare('UPDATE staging_supplier_connections SET authorized_products=? WHERE id=?').run(JSON.stringify({'*':'WRONG-WIDE','wide-item':'DOCUMENTED-LICENSE-REF'}),connect)
 assert.equal(sqlite.prepare('SELECT available_quantity FROM verified_product_stock WHERE id=?').get(product)!.available_quantity,4)
 const before=sqlite.prepare('SELECT * FROM products').all()
 const queuedBody={action:'sync',id:connect};env.CATALOG_SYNC_ENABLED='true'
 sqlite.prepare("INSERT INTO migration_metadata(key,value) VALUES('catalog_scheduler_heartbeat',?)").run(String(Date.now()))
 sqlite.prepare("INSERT INTO supplier_sync_jobs(id,connection_id,revision,phase,started_at,completed_at) VALUES('manual-refresh',?,1,'complete',?,?)").run(connect,Date.now(),Date.now())
 const queued=await apiFetch(request('/api/admin/catalog',queuedBody,cookie),env)
 assert.equal(queued.status,202);assert.equal((await queued.json()).queued,true)
 assert.equal(sqlite.prepare('SELECT restart_required FROM supplier_sync_jobs').get()!.restart_required,1)
 sqlite.prepare("UPDATE supplier_sync_jobs SET phase='listings',restart_required=0").run()
 assert.equal((await apiFetch(request('/api/admin/catalog',queuedBody,cookie),env)).status,202)
 assert.equal(sqlite.prepare('SELECT restart_required FROM supplier_sync_jobs').get()!.restart_required,0)
 assert.deepEqual(sqlite.prepare('SELECT * FROM products').all(),before)
 sqlite.prepare("UPDATE migration_metadata SET value=? WHERE key='catalog_scheduler_heartbeat'").run(String(Date.now()-180000))
 const status=await apiFetch(request('/api/admin/catalog',undefined,cookie),env)
 assert.equal((await status.json()).backgroundReady,false)
})
