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
    'migrations/0003_auth_mail_diagnostics.sql','migrations/0004_supplier_review.sql','migrations/0005_supplier_sync.sql']) {
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
  const previous=sqlite.prepare('SELECT authorized_products FROM staging_supplier_connections WHERE id=?').get(connect)!
  sqlite.prepare('UPDATE staging_supplier_connections SET enabled=1,authorized_products=? WHERE id=?')
    .run(JSON.stringify({...JSON.parse(String(previous.authorized_products)),[externalId]:'DOCUMENTED-LICENSE-REF'}),connect)
  sqlite.prepare(`INSERT INTO staging_supplier_feed_items(connection_id,external_id,name,source_category,supplier_cost_minor,
    stock_quantity,authorization_verified,evidence_reference,source_checked_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(connect,externalId,'Synthetic licensed item',kind,500,4,authorized,'DOCUMENTED-LICENSE-REF',Date.now())
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
  assert.equal(response.publicationEnabled,false)
  assert.equal(response.legacyApprovalsImported,false)
  assert.equal((await apiFetch(request('/api/admin/supplier-review',{action:'reject',connection_id:connect,external_id:'approved-source'},cookie,'https://evil.test'),env)).status,403)
  assert.equal(sqlite.prepare('SELECT approval FROM staging_supplier_feed_items').get()!.approval,'pending')
  assert.equal((await apiFetch(request('/api/admin/supplier-review',{action:'reject',connection_id:connect,external_id:'approved-source'},cookie),env)).status,200)
  assert.equal(sqlite.prepare('SELECT approval FROM staging_supplier_feed_items').get()!.approval,'rejected')
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM staging_supplier_review_events').get()!.n,1)
})
test('D1 approval requires vetted rights and fresh supplier data but cannot publish, alter stock or bypass safeguards',async () => {
  const ctx=setup();const {sqlite,env,request}=ctx
  sqlite.prepare('INSERT INTO staging_supplier_connections(id,provider,name) VALUES(?,?,?)').run(connect,'youngpg','Synthetic YoungPG')
  for (const [id,kind,verified] of [['license', 'permitted_digital_good',1],['accounts','account_access',1],['unverified','permitted_digital_good',0]] as const) stage(sqlite,id,kind,verified)
  stage(sqlite,'stale')
  sqlite.prepare('UPDATE staging_supplier_feed_items SET source_checked_at=0 WHERE external_id=?').run('stale')
  const before=sqlite.prepare('SELECT * FROM products ORDER BY id').all()
  const inventory=sqlite.prepare('SELECT * FROM inventory ORDER BY product_id').all()
  const {cookie,id}=await member(ctx)
  sqlite.prepare("UPDATE user_roles SET role='admin' WHERE user_id=?").run(id)
  const action=(external_id:string,more:Record<string,unknown>={})=>request('/api/admin/supplier-review', {
    action:'approve',connection_id:connect,external_id,category_id:category,price_minor:1800,
    delivery_type:'Redemption code',description:'Synthetic reviewed licensed digital product.',...more,
  },cookie)
  assert.equal((await apiFetch(action('license',{price_minor:2.5}),env)).status,400)
  assert.equal((await apiFetch(action('license',{category_id:'60000000-0000-4000-8000-000000000001'}),env)).status,409)
  assert.equal((await apiFetch(action('accounts'),env)).status,409)
  assert.equal((await apiFetch(action('unverified'),env)).status,409)
  assert.equal((await apiFetch(action('stale'),env)).status,409)
  const approved=await apiFetch(action('license'),env)
  assert.equal(approved.status,200,await approved.clone().text())
  assert.equal((await approved.json()).published,false)
  assert.equal((await apiFetch(action('license'),env)).status,409)
  assert.equal(sqlite.prepare('SELECT approval FROM staging_supplier_feed_items WHERE external_id=?').get('license')!.approval,'approved')
  assert.deepEqual(sqlite.prepare('SELECT * FROM products ORDER BY id').all(),before)
  assert.deepEqual(sqlite.prepare('SELECT * FROM inventory ORDER BY product_id').all(),inventory)
  assert.equal(sqlite.prepare('SELECT available_quantity FROM staging_storefront_products').get()!.available_quantity,0)
  assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length,0)
})
