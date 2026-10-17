import {nativeCostMinor} from '../workers/api/hstora-review.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { apiFetch } from '../workers/api/index.ts'
import type { ApiEnv, Database, Statement } from '../workers/api/types.ts'

function setup() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys=ON')
  for (const file of ['migrations/0001_staging_foundation.sql','fixtures.sql','migrations/0002_cloudflare_auth.sql',
    'migrations/0003_auth_mail_diagnostics.sql','migrations/0004_supplier_review.sql','migrations/0005_supplier_sync.sql','migrations/0006_admin_publication.sql','migrations/0007_supplier_wide_authorization.sql','migrations/0008_sync_snapshot_retry.sql','migrations/0009_auth_email_otp.sql','migrations/0011_hstora_catalog.sql','migrations/0012_hstora_webhooks.sql']) {
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


test('HStora authenticated review, pricing and publication preserve YoungPG and enforce fresh authorized stock',async()=>{
 const ctx=setup(),{sqlite,env,request}=ctx,{cookie,id}=await member(ctx)
 sqlite.prepare("UPDATE user_roles SET role='admin' WHERE user_id=?").run(id)
 sqlite.exec("INSERT INTO hstora_connection(id,ciphertext,nonce,enabled) VALUES('hstora','encrypted','nonce',1)")
 const metadata=JSON.stringify({id:'1',name:'Licensed VPN subscription',description:'Supplier subscription description',currency:'USD',price:'2.00',stock:9,images:[]})
 sqlite.prepare("INSERT INTO hstora_catalog_items(external_id,metadata,snapshot_id,checked_at) VALUES('1',?,'complete-snapshot',?)").run(metadata,Date.now())
 const invoke=(data:unknown)=>apiFetch(request('/api/admin/hstora-review',data,cookie),env)
 let response=await invoke({action:'publish',ids:['1']});assert.equal(response.status,409)
 response=await invoke({action:'price',ids:['1'],mode:'price',amount:200000});assert.equal(response.status,200,await response.clone().text())
 response=await invoke({action:'approve',ids:['1'],description:'Verified licensed subscription description.',reference:'LICENSE-REFERENCE-123',delivery_type:'Manual fulfillment',delivery_verified:true,privacy_verified:true,provider_verified:true});assert.equal(response.status,200,await response.clone().text())
 assert.equal(sqlite.prepare("SELECT count(*) n FROM storefront_products WHERE slug='hstora-1'").get()!.n,0)
 response=await invoke({action:'publish',ids:['1']});assert.equal(response.status,200,await response.clone().text())
 const product=sqlite.prepare("SELECT * FROM storefront_products WHERE slug='hstora-1'").get()!;assert.equal(product.available_quantity,9);assert.equal(product.price_minor,200000)
 assert.equal(sqlite.prepare('SELECT slug FROM categories WHERE id=?').get(product.category_id as string)!.slug,'server1')
 sqlite.exec('UPDATE hstora_connection SET enabled=0');assert.equal(sqlite.prepare("SELECT available_quantity FROM storefront_products WHERE slug='hstora-1'").get()!.available_quantity,0)
 sqlite.exec('UPDATE hstora_connection SET enabled=1');sqlite.prepare('UPDATE hstora_catalog_items SET checked_at=?').run(Date.now()-3600001)
 assert.equal(sqlite.prepare("SELECT available_quantity FROM storefront_products WHERE slug='hstora-1'").get()!.available_quantity,0)
 const manager=await apiFetch(request('/api/admin/hstora',undefined,cookie),env);assert.equal(manager.status,200);assert.doesNotMatch(await manager.text(),/ciphertext|nonce|encrypted/)
 assert.equal((await apiFetch(request('/api/admin/hstora'),env)).status,401)
 // Additive migration can safely retry, without duplicating the category or altering approved prices.
 sqlite.exec(readFileSync(new URL('../workers/api/migrations/0011_hstora_catalog.sql',import.meta.url),'utf8'))
 assert.equal(sqlite.prepare("SELECT count(*) n FROM categories WHERE slug='server1'").get()!.n,1)
 assert.equal(sqlite.prepare("SELECT price_minor FROM products WHERE slug='hstora-1'").get()!.price_minor,200000)
})

test('native supplier decimals convert exactly for NGN markup without guessing FX',()=>{assert.equal(nativeCostMinor('0.019',150000),2850);assert.equal(nativeCostMinor('0.00001',100),1);assert.throws(()=>nativeCostMinor('2.0',0));})

test('supplier manager server filtering and encrypted toggles keep providers independent',async()=>{
 const ctx=setup(),{sqlite,env,request}=ctx,{cookie,id}=await member(ctx)
 sqlite.prepare("UPDATE user_roles SET role='admin' WHERE user_id=?").run(id)
 const connection='50000000-0000-4000-8000-000000000009'
 sqlite.prepare("INSERT INTO staging_supplier_connections(id,provider,name,enabled) VALUES(?,'youngpg','YoungPG',1)").run(connection)
 sqlite.prepare("INSERT INTO supplier_sync_jobs(id,connection_id,revision,phase,started_at,total,scanned,completed_at) VALUES('yg-job',?,1,'complete',?,1,1,?)").run(connection,Date.now(),Date.now())
 sqlite.prepare("INSERT INTO supplier_sync_items(job_id,external_id,metadata) VALUES('yg-job','9',?)").run(JSON.stringify({name:'YoungPG licensed software',description:'Verified source metadata',cost_minor:1200,stock:7,image_urls:[]}))
 let r=await apiFetch(request('/api/admin/hstora',{action:'save',api_key:'hs_pk_synthetic',api_secret:'hs_sk_synthetic',enabled:false},cookie),env);assert.equal(r.status,200,await r.clone().text())
 const encrypted=sqlite.prepare('SELECT ciphertext FROM hstora_connection').get()!.ciphertext as string;assert.doesNotMatch(encrypted,/hs_pk|hs_sk|synthetic/)
 for(const enabled of [true,false]){r=await apiFetch(request('/api/admin/hstora',{action:'save',enabled},cookie),env);assert.equal(r.status,200);assert.equal(sqlite.prepare('SELECT enabled FROM hstora_connection').get()!.enabled,enabled?1:0);assert.equal(sqlite.prepare('SELECT enabled FROM staging_supplier_connections WHERE id=?').get(connection)!.enabled,1)}
 sqlite.prepare("INSERT INTO hstora_catalog_items(external_id,metadata,snapshot_id,checked_at) VALUES('7',?,'snapshot',?)").run(JSON.stringify({name:'HStora private VPN',description:'Original full description',price:'2',currency:'USD',stock:8,images:[]}),Date.now())
 r=await apiFetch(request('/api/admin/supplier-manager?provider=youngpg',undefined,cookie),env);assert.equal(r.status,200);let body=await r.json() as {items:{name:string}[];summary:{total:number}};assert.equal(body.summary.total,1);assert.equal(body.items.length,1);assert.match(body.items[0].name,/YoungPG/)
 r=await apiFetch(request('/api/admin/hstora-review?q=HStora&stock=in-stock',undefined,cookie),env);assert.equal(r.status,200);body=await r.json() as typeof body;assert.equal(body.items.length,1);assert.match(body.items[0].name,/HStora/)
 assert.equal((await apiFetch(request('/api/admin/supplier-manager?provider=shopviaclone22',undefined,cookie),env)).status,400)
 assert.equal((await apiFetch(request('/api/admin/supplier-manager?provider=youngpg'),env)).status,401)
})

test('admin webhook configuration encrypts the separate secret and returns only safe status',async()=>{const ctx=setup(),{sqlite,env,request}=ctx,{cookie,id}=await member(ctx);sqlite.prepare("UPDATE user_roles SET role='admin' WHERE user_id=?").run(id);const secret='whsec_synthetic_admin_webhook_only';const saved=await apiFetch(request('/api/admin/hstora-webhook',{webhook_secret:secret},cookie),env);assert.equal(saved.status,200,await saved.clone().text());assert.notEqual(sqlite.prepare('SELECT ciphertext FROM hstora_webhook_config').get()!.ciphertext,secret);const r=await apiFetch(request('/api/admin/hstora-webhook',undefined,cookie),env);assert.equal(r.status,200);const raw=await r.text();assert.doesNotMatch(raw,/whsec_|ciphertext|nonce/);assert.equal(JSON.parse(raw).configured,true);assert.equal((await apiFetch(request('/api/admin/hstora-webhook'),env)).status,401)})

 test('HStora save reports validation and encryption failures without network calls or partial writes',async()=>{
 const ctx=setup(),{sqlite,env,request}=ctx,{cookie,id}=await member(ctx)
 sqlite.prepare("UPDATE user_roles SET role='admin' WHERE user_id=?").run(id)
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Unexpected supplier request')}
 try{
 let r=await apiFetch(request('/api/admin/hstora',{action:'save',enabled:false,api_key:'invalid',api_secret:'whsec_wrong'},cookie),env)
 assert.equal(r.status,400);assert.match(await r.text(),/hs_pk_/);assert.equal(calls,0)
 env.SUPPLIER_ENCRYPTION_KEY=undefined
 r=await apiFetch(request('/api/admin/hstora',{action:'save',enabled:false,api_key:'hs_pk_test',api_secret:'hs_sk_test'},cookie),env)
 assert.equal(r.status,503);assert.match(await r.text(),/SUPPLIER_ENCRYPTION_KEY/);assert.equal(sqlite.prepare('SELECT count(*) n FROM hstora_connection').get()!.n,0)
 env.SUPPLIER_ENCRYPTION_KEY=btoa('s'.repeat(32))
 r=await apiFetch(request('/api/admin/hstora',{action:'save',enabled:false,api_key:' hs_pk_test ',api_secret:' hs_sk_test '},cookie),env)
 assert.equal(r.status,200,await r.clone().text());assert.equal(calls,0);assert.equal(sqlite.prepare('SELECT enabled FROM hstora_connection').get()!.enabled,0)
 }finally{globalThis.fetch=original}
 })

test('YoungPG activation-only saves preserve snapshot revision and stored inventory',async()=>{
 const ctx=setup(),{sqlite,env,request}=ctx,{cookie,id}=await member(ctx)
 sqlite.prepare("UPDATE user_roles SET role='admin' WHERE user_id=?").run(id)
 const connection='50000000-0000-4000-8000-000000000099'
 sqlite.prepare("INSERT INTO staging_supplier_connections(id,provider,name,enabled,revision,encrypted_key,key_nonce,authorized_products) VALUES(?,'youngpg','YoungPG',1,4,'cipher','nonce','{}')").run(connection)
 for(const enabled of [false,true]){const r=await apiFetch(request('/api/admin/catalog',{action:'save',id:connection,name:'YoungPG',revision:4,enabled},cookie),env);assert.equal(r.status,200,await r.clone().text());const row=sqlite.prepare('SELECT revision,enabled,encrypted_key,key_nonce FROM staging_supplier_connections WHERE id=?').get(connection)!;assert.equal(row.revision,4);assert.equal(row.enabled,enabled?1:0);assert.equal(row.encrypted_key,'cipher');assert.equal(row.key_nonce,'nonce')}
})

test('direct HStora Pages route validates production D1 and never uses staging fallback',async()=>{
 const {onRequest}=await import('../functions/api/admin/hstora.ts')
 const ctx=setup(),{sqlite,env,request}=ctx,{cookie,id}=await member(ctx)
 sqlite.prepare("UPDATE user_roles SET role='admin' WHERE user_id=?").run(id)
 env.ENVIRONMENT='production';env.PRODUCTION_CUTOVER_ENABLED='true'
 let r=await onRequest({request:request('/api/admin/hstora'),env});assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/Staging API unavailable/)
 sqlite.prepare("UPDATE migration_metadata SET value='production' WHERE key='dataset'").run()
 r=await onRequest({request:request('/api/admin/hstora',{action:'save',enabled:false,api_key:'hs_pk_test',api_secret:'hs_sk_test'},cookie),env})
 assert.equal(r.status,200,await r.clone().text());assert.equal(r.headers.get('X-LogsPoll-Handler'),'hstora-direct-v1');assert.equal(sqlite.prepare('SELECT enabled FROM hstora_connection').get()!.enabled,0)
 r=await onRequest({request:request('/api/admin/hstora'),env});assert.equal(r.status,401)
})

test('connection test distinguishes credential configuration from upstream rejection',async t=>{
 const ctx=setup(),{sqlite,env,request}=ctx,{cookie,id}=await member(ctx)
 sqlite.prepare("UPDATE user_roles SET role='admin' WHERE user_id=?").run(id)
 let r=await apiFetch(request('/api/admin/hstora',{action:'save',enabled:false,api_key:'hs_pk_test',api_secret:'hs_sk_test'},cookie),env);assert.equal(r.status,200)
 const key=env.SUPPLIER_ENCRYPTION_KEY;env.SUPPLIER_ENCRYPTION_KEY=undefined
 r=await apiFetch(request('/api/admin/hstora',{action:'test'},cookie),env);assert.equal(r.status,503);assert.match(await r.text(),/SUPPLIER_ENCRYPTION_KEY/)
 env.SUPPLIER_ENCRYPTION_KEY=key
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:{code:'origin_not_allowed',message:'private'}},{status:403}))
 r=await apiFetch(request('/api/admin/hstora',{action:'test'},cookie),env);assert.equal(r.status,424)
 const body=await r.json() as {provider_status:number;layer:string;error:string};assert.equal(body.provider_status,403);assert.equal(body.layer,'supplier');assert.doesNotMatch(body.error,/private|hs_sk_test/)
})
