import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { apiFetch } from '../workers/api/index.ts'
import { createAuth } from '../workers/api/auth.ts'
import { drainMail } from '../workers/api/mail.ts'
import type { ApiEnv, Database, Statement } from '../workers/api/types.ts'

function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys=ON')
  for (const file of ['migrations/0001_staging_foundation.sql','fixtures.sql','migrations/0002_cloudflare_auth.sql','migrations/0003_auth_mail_diagnostics.sql','migrations/0004_supplier_review.sql','migrations/0005_supplier_sync.sql','migrations/0006_admin_publication.sql','migrations/0009_auth_email_otp.sql']) sqlite.exec(readFileSync(new URL('../workers/api/'+file,import.meta.url),'utf8'))
  const db = {
    prepare(sql: string) {
      let values: unknown[] = []
      const stmt = { bind(...args: unknown[]) { values = args; return stmt },
        async all() { const results = sqlite.prepare(sql).all(...values as never[]); const changes = sqlite.prepare('SELECT changes() AS n').get()!.n; return { results, success: true, meta: { changes, last_row_id: 0 } } },
        async first() { return (await stmt.all()).results[0] ?? null }, async run() { return stmt.all() } }
      return stmt
    },
    async batch(statements: Statement[]) { sqlite.exec('BEGIN'); try { const result = await Promise.all(statements.map(s => s.all())); sqlite.exec('COMMIT'); return result } catch (e) { sqlite.exec('ROLLBACK'); throw e } },
    async exec(sql: string) { sqlite.exec(sql) },
  } as Database
  const env: ApiEnv = { ENVIRONMENT:'staging', DB:db, AUTH_ENABLED:'true', AUTH_ORIGIN:'https://staging.test', AUTH_SECRET:'local-test-authentication-secret-not-used-outside-tests', RESEND_API_KEY:'re_synthetic_only_never_send' }
  const request = (path:string, body?:unknown, cookie?:string, origin='https://staging.test') => new Request('https://staging.test'+path, { ...(body ? { method:'POST', body:JSON.stringify(body) } : {}), headers:{Origin:origin,'Content-Type':'application/json','cf-connecting-ip':'192.0.2.1', ...(cookie ? {Cookie:cookie} : {})} })
  return { env, db, sqlite, request }
}
async function lastMail(env:ApiEnv, db:Database) {
  const rows = await db.prepare('SELECT payload,iv FROM auth_mail_outbox WHERE payload<>\'\' ORDER BY created_at DESC').all<{payload:string;iv:string}>()
  const row = rows.results[0]
  const key = await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.AUTH_SECRET)),'AES-GCM',false,['decrypt'])
  const clear = await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(row.iv,'base64')},key,Buffer.from(row.payload,'base64'))
  return JSON.parse(new TextDecoder().decode(clear)) as {text:string;subject:string;to:string[];from:string}
}

test('Cloudflare auth fails closed; application writes and cross-origin requests stay blocked',async()=>{
  const {env,request}=fixture()
  assert.equal((await apiFetch(request('/api/health'),{...env,ENVIRONMENT:'locked'})).status,503)
  assert.equal((await apiFetch(request('/api/products'),{...env,ENVIRONMENT:'production',PRODUCTION_CUTOVER_ENABLED:'true'})).status,503)
  assert.equal((await apiFetch(request('/api/orders',{}),env)).status,405)
  assert.equal((await apiFetch(request('/api/auth/sign-in/email',{},undefined,'https://evil.test'),env)).status,403)
  assert.equal((await apiFetch(request('/api/account/session'),{...env,AUTH_SECRET:''})).status,503)
  assert.equal((await apiFetch(request('/api/account/session'),env)).status,401)
  assert.equal((await apiFetch(request('/api/admin/overview'),env)).status,401)
  const health = await (await apiFetch(request('/api/health'),env)).json()
  assert.equal(health.authReplacement,true); assert.equal(health.livePayments,false)
})
test('real auth library: signup, single-use verification, HttpOnly session, ownership, reset, logout, admin denial and CSRF',async()=>{
  const {env,db,sqlite,request}=fixture()
  const original=sqlite.prepare('SELECT * FROM products').all()
  const email='customer@example.test'; const password='Synthetic password 2026!'
  const signup=await apiFetch(request('/api/auth/sign-up/email',{email,password,name:'Test Customer',callbackURL:'/login'}),env)
  assert.equal(signup.status,200,await signup.clone().text())
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM auth_session').get()!.n,0)
  assert.notEqual(sqlite.prepare('SELECT password FROM auth_account').get()!.password,password)
  const verification=await lastMail(env,db)
  assert.equal(verification.from,'LogsPoll <no-reply@logspoll.com>'); assert.deepEqual(verification.to,[email]); assert.doesNotMatch(verification.text,/SAMPLE EMAIL/)
  const code=verification.text.match(/Your code: (\d{6})/)![1]
  assert.equal((await apiFetch(request('/api/auth/email-otp/verify-email',{email,otp:code}),env)).status,200)
  assert.equal((await apiFetch(request('/api/auth/email-otp/verify-email',{email,otp:code}),env)).status,400)
  const login=await apiFetch(request('/api/auth/sign-in/email',{email,password}),env)
  assert.equal(login.status,200,await login.clone().text())
  const cookieHeader=login.headers.get('set-cookie')!
  assert.match(cookieHeader,/HttpOnly/i); assert.match(cookieHeader,/Secure/); assert.match(cookieHeader,/SameSite=Lax/i)
  const cookie=cookieHeader.split(';')[0]
  const me=await apiFetch(request('/api/account/session',undefined,cookie),env)
  assert.equal(me.status,200,await me.clone().text())
  const account=await me.json(); assert.equal(account.user.role,'customer')
  assert.equal((await apiFetch(request('/api/admin/overview',undefined,cookie),env)).status,403)
  sqlite.prepare("UPDATE user_roles SET role='admin' WHERE user_id=?").run(account.user.id)
  assert.equal((await apiFetch(request('/api/admin/overview',undefined,cookie),env)).status,200)
  sqlite.prepare("UPDATE users SET status='restricted' WHERE id=?").run(account.user.id)
  assert.equal((await apiFetch(request('/api/admin/overview',undefined,cookie),env)).status,403)
  sqlite.prepare("UPDATE users SET status='active' WHERE id=?").run(account.user.id)
  sqlite.prepare("UPDATE user_roles SET role='customer' WHERE user_id=?").run(account.user.id)
  const orders=await (await apiFetch(request('/api/orders?customer_id=10000000-0000-4000-8000-000000000001&role=admin',undefined,cookie),env)).json()
  assert.deepEqual(orders.records,[])
  assert.equal((await apiFetch(request('/api/auth/sign-out',{},cookie,'https://evil.test'),env)).status,403)
  await apiFetch(request('/api/auth/email-otp/request-password-reset',{email,redirectTo:'/reset-password'}),env)
  const reset=await lastMail(env,db); assert.match(reset.subject,/Reset/)
  const otp=reset.text.match(/Your code: (\d{6})/)![1]
  const resetResponse=await apiFetch(request('/api/auth/email-otp/reset-password',{email,otp,password:'Changed synthetic password 2026!'}),env)
  assert.equal(resetResponse.status,200,await resetResponse.clone().text())
  assert.equal((await apiFetch(request('/api/auth/email-otp/reset-password',{email,otp,password:password}),env)).status,400)
  assert.equal((await apiFetch(request('/api/account/session',undefined,cookie),env)).status,401)
  const newLogin=await apiFetch(request('/api/auth/sign-in/email',{email,password:'Changed synthetic password 2026!'}),env)
  assert.equal(newLogin.status,200)
  const nextCookie=newLogin.headers.get('set-cookie')!.split(';')[0]
  assert.equal((await apiFetch(request('/api/auth/sign-out',{},nextCookie),env)).status,200)
  assert.equal((await apiFetch(request('/api/account/session',undefined,nextCookie),env)).status,401)
  assert.deepEqual(sqlite.prepare('SELECT * FROM products').all(),original)
  assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length,0)
})
test('auth rate limits persist in D1; email failures retry without duplicate events',async t=>{
  const {env,db,request}=fixture()
  for(let i=0;i<3;i++) await apiFetch(request('/api/auth/email-otp/request-password-reset',{email:'absent@example.test',redirectTo:'/reset-password'}),env)
  assert.equal((await apiFetch(request('/api/auth/email-otp/request-password-reset',{email:'absent@example.test'}),env)).status,429)
  await apiFetch(request('/api/auth/sign-up/email',{email:'queued@example.test',password:'Synthetic password 2026!',name:'Queue'}),env)
  const row=await db.prepare('SELECT * FROM auth_mail_outbox').first<{id:string;payload:string}>()
  assert.ok(row); assert.doesNotMatch(row.payload,/queued@example|verify-email|token=/)
  let idempotency=''
  t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{ assert.equal(init.redirect,'manual'); idempotency=(init.headers as Record<string,string>)['Idempotency-Key']; return Response.json({error:'synthetic failure'},{status:503}) })
  await drainMail(env)
  assert.equal((await db.prepare('SELECT attempts FROM auth_mail_outbox').first<{attempts:number}>())!.attempts,1)
  assert.equal((await db.prepare('SELECT last_error FROM auth_mail_outbox').first<{last_error:string}>())!.last_error,'provider_http_503')
  await db.prepare('UPDATE auth_mail_outbox SET next_attempt=0').run()
  let retryKey=''
  t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{ retryKey=(init.headers as Record<string,string>)['Idempotency-Key']; return Response.json({id:'00000000-0000-4000-8000-000000000001'}) })
  await drainMail(env); assert.equal(retryKey,idempotency)
  assert.equal((await db.prepare('SELECT payload FROM auth_mail_outbox').first<{payload:string}>())!.payload,'')
  const receipt = await db.prepare('SELECT last_error,provider_message_id FROM auth_mail_outbox').first()
  assert.equal(receipt!.last_error,null); assert.equal(receipt!.provider_message_id,'00000000-0000-4000-8000-000000000001')
  assert.equal((await createAuth(env).api.getSession({headers:new Headers()})),null)
})
test('mail dispatcher bounds batches and cleans expired records even without deliverable mail',async t=>{
  const {env,db,sqlite}=fixture()
  const {enqueueMail}=await import('../workers/api/mail.ts')
  for(let i=0;i<3;i++) await enqueueMail(env,`batch-${i}`,'welcome',{name:'Test',email:'batch@example.test'})
  let calls=0
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({id:'00000000-0000-4000-8000-000000000001'})})
  await drainMail(env)
  assert.equal(calls,2); assert.equal(sqlite.prepare('SELECT count(*) n FROM auth_mail_outbox WHERE delivered_at IS NOT NULL').get()!.n,2)
  await db.prepare('UPDATE auth_mail_outbox SET created_at=0').run()
  await db.prepare("INSERT INTO auth_email_tokens(token_hash,expires_at) VALUES('expired',0)").run()
  await drainMail(env)
  assert.equal(calls,2);assert.equal(sqlite.prepare('SELECT count(*) n FROM auth_mail_outbox').get()!.n,0)
  assert.equal(sqlite.prepare('SELECT count(*) n FROM auth_email_tokens').get()!.n,0)
})
test('mail redirects are rejected without forwarding the API key or claiming delivery',async t=>{
  const {env,db}=fixture()
  const {enqueueMail}=await import('../workers/api/mail.ts')
  await enqueueMail(env,'redirect-test','welcome',{name:'Test',email:'redirect@example.test'})
  let calls=0
  t.mock.method(globalThis,'fetch',async(url:unknown,init:RequestInit)=>{
    calls++;assert.equal(url,'https://api.resend.com/emails');assert.equal(init.redirect,'manual')
    return new Response(null,{status:302,headers:{Location:'https://untrusted.example.test'}})
  })
  await drainMail(env)
  const row=await db.prepare('SELECT delivered_at,last_error,payload FROM auth_mail_outbox').first()
  assert.equal(calls,1);assert.equal(row!.delivered_at,null);assert.equal(row!.last_error,'provider_http_302')
  assert.ok(row!.payload)
})

test('D1 customer routes enforce ownership, publication, verified stock and paid delivery without supplier secrets', async () => {
  const { env, db, sqlite, request } = fixture()
  const email = 'routes@example.test', password = 'Synthetic password 2026!'
  await apiFetch(request('/api/auth/sign-up/email', { email, password, name: 'Route Customer' }), env)
  const mail=await lastMail(env,db),otp=mail.text.match(/Your code: (\d{6})/)![1]
  await apiFetch(request('/api/auth/email-otp/verify-email',{email,otp}),env)
  const login = await apiFetch(request('/api/auth/sign-in/email', { email, password }), env)
  const cookie = login.headers.get('set-cookie')!.split(';')[0]
  const me = await (await apiFetch(request('/api/account/session', undefined, cookie), env)).json()
  assert.equal((await apiFetch(request('/api/products'), env)).status, 200)
  assert.equal((await apiFetch(request('/api/categories'), env)).status, 200)
  assert.equal((await apiFetch(request('/api/v1/products'), env)).status, 200)
  assert.equal((await apiFetch(request('/api/v1/categories'), env)).status, 200)
  assert.equal((await apiFetch(request('/api/orders'), env)).status, 401)
  assert.equal((await apiFetch(request('/api/v1/orders'), env)).status, 401)
  const productBySlug = await (await apiFetch(request('/api/v1/products/synthetic-product'), env)).json()
  assert.equal(productBySlug.product.price_minor, 12345)
  const products = await (await apiFetch(request('/api/products?slug=synthetic-product', undefined, cookie), env)).json()
  assert.equal(products.records.length, 1); assert.equal(products.records[0].price_minor, 12345)
  assert.equal(products.records[0].available_quantity, 0)
  assert.equal(products.records[0].category_name, 'Synthetic staging category')
  assert.deepEqual(products.records[0].supplier_image_urls, [])
  for (const field of ['supplier_name', 'supplier_cost_minor', 'authorization_evidence']) assert.equal(field in products.records[0], false)
  assert.equal((await (await apiFetch(request('/api/products?availability=in-stock', undefined, cookie), env)).json()).total, 0)
  assert.equal((await apiFetch(request('/api/products?ids=malformed', undefined, cookie), env)).status, 400)
  assert.equal((await (await apiFetch(request('/api/categories', undefined, cookie), env)).json()).records[0].product_count, 1)
  sqlite.prepare('UPDATE products SET publication_verified=0').run()
  assert.equal((await (await apiFetch(request('/api/products', undefined, cookie), env)).json()).total, 0)
  sqlite.prepare('UPDATE products SET publication_verified=1').run()
  const order = '40000000-0000-4000-8000-000000000003', item = '50000000-0000-4000-8000-000000000003'
  sqlite.prepare("INSERT INTO orders(id,customer_id,reference,total_minor,payment_status,fulfillment_status) VALUES(?,?,'ROUTE-ORDER',12345,'paid','delivered')").run(order, me.user.id)
  sqlite.prepare("INSERT INTO order_items(id,order_id,product_id,product_name,category_name,quantity,unit_price_minor) VALUES(?,?,'30000000-0000-4000-8000-000000000001','Purchased product','Category',1,12345)").run(item, order)
  sqlite.prepare("INSERT INTO product_entitlements(id,order_item_id,instructions) VALUES('private-entitlement',?,'PRIVATE DELIVERY')").run(item)
  const purchases = await (await apiFetch(request('/api/orders?purchases=true', undefined, cookie), env)).json()
  assert.equal(purchases.records[0].order_items[0].product_entitlements.instructions, 'PRIVATE DELIVERY')
  assert.doesNotMatch(await (await apiFetch(request('/api/orders', undefined, cookie), env)).text(), /PRIVATE DELIVERY/)
  const feedback = { item_uuid: item, stars: 5, feedback: 'A verified customer review of this purchase.', customer_name: 'Buyer', customer_location: '' }
  assert.equal((await apiFetch(request('/api/reviews', feedback, cookie), env)).status, 201)
  assert.equal((await apiFetch(request('/api/reviews', feedback, cookie), env)).status, 409)
  assert.equal((await (await apiFetch(request('/api/reviews'), env)).json()).reviews.length, 0)
  sqlite.prepare("UPDATE reviews SET status='approved'").run()
  assert.equal((await (await apiFetch(request('/api/reviews'), env)).json()).reviews.length, 1)
  sqlite.prepare("UPDATE orders SET payment_status='refunded' WHERE id=?").run(order)
  assert.equal((await (await apiFetch(request('/api/orders?purchases=true', undefined, cookie), env)).json()).records.length, 0)
  assert.equal((await (await apiFetch(request('/api/reviews'), env)).json()).reviews.length, 0)
  assert.equal((await apiFetch(request('/api/support', { user_id: '10000000-0000-4000-8000-000000000001', subject: 'Test', message: 'Customer support request.' }, cookie), env)).status, 201)
  assert.equal(sqlite.prepare('SELECT user_id FROM support_tickets').get()!.user_id, me.user.id)
  assert.equal((await apiFetch(request('/api/support', { subject: 'Test', message: 'Customer support request.' }, cookie, 'https://evil.test'), env)).status, 403)
  assert.equal((await apiFetch(request('/api/support', { subject: 'Test', message: 'Customer support request.' }, cookie, ''), env)).status, 403)
  assert.equal((await apiFetch(request('/api/support', { subject: 'Test', message: 'X'.repeat(20000) }, cookie), env)).status, 413)
  assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length, 0)
})

test('OTP storage, five-attempt limit, purpose binding, expiration and replay fail closed',async()=>{
 const {env,db,sqlite,request}=fixture(),email='otp-security@example.test'
 const password='Synthetic secure password 2026!'
 assert.equal((await apiFetch(request('/api/auth/sign-up/email',{email,password,name:'OTP Customer'}),env)).status,200)
 const mail=await lastMail(env,db),code=mail.text.match(/Your code: (\d{6})/)![1]
 assert.doesNotMatch(mail.text,/token=|\/api\/auth\//)
 const stored=sqlite.prepare('SELECT value,expiresAt,createdAt FROM auth_verification').get()!
 assert.match(String(stored.value),/^[a-f0-9]{64}:0$/);assert.ok(!String(stored.value).includes(code))
 assert.ok(Date.parse(String(stored.expiresAt))-Date.parse(String(stored.createdAt))>=599000&&Date.parse(String(stored.expiresAt))-Date.parse(String(stored.createdAt))<=601000)
 assert.equal((await apiFetch(request('/api/auth/email-otp/reset-password',{email,otp:code,password}),env)).status,400)
 assert.equal((await apiFetch(request('/api/auth/email-otp/verify-email',{email:'other@example.test',otp:code}),env)).status,400)
 const wrong=code==='000000'?'111111':'000000'
 for(let i=0;i<5;i++)assert.equal((await apiFetch(request('/api/auth/email-otp/verify-email',{email,otp:wrong}),env)).status,400)
 assert.equal((await apiFetch(request('/api/auth/email-otp/verify-email',{email,otp:code}),env)).status,403)
 assert.equal(sqlite.prepare('SELECT emailVerified FROM auth_user').get()!.emailVerified,0)
 // A new issuance after cooldown invalidates the exhausted code.
 sqlite.prepare('UPDATE auth_otp_cooldowns SET next_send_at=0').run()
 assert.equal((await apiFetch(request('/api/auth/email-otp/send-verification-otp',{email,type:'email-verification'}),env)).status,200)
 const fresh=(await lastMail(env,db)).text.match(/Your code: (\d{6})/)![1]
 sqlite.prepare('UPDATE auth_verification SET expiresAt=?').run(new Date(Date.now()-1000).toISOString())
 assert.equal((await apiFetch(request('/api/auth/email-otp/verify-email',{email,otp:fresh}),env)).status,400)
 assert.equal(sqlite.prepare('SELECT emailVerified FROM auth_user').get()!.emailVerified,0)
})

test('resend cooldown is persistent, rotates codes, expires superseded mail and does not enumerate recovery accounts',async()=>{
 const {env,db,sqlite,request}=fixture(),email='otp-resend@example.test',password='Synthetic secure password 2026!'
 await apiFetch(request('/api/auth/sign-up/email',{email,password,name:'Resend Customer'}),env)
 const old=(await lastMail(env,db)).text.match(/Your code: (\d{6})/)![1]
 const oldMail=sqlite.prepare('SELECT id FROM auth_mail_outbox').get()!.id
 const resend=()=>apiFetch(request('/api/auth/email-otp/send-verification-otp',{email,type:'email-verification'}),env)
 assert.equal((await resend()).status,429)
 assert.equal(sqlite.prepare('SELECT count(*) n FROM auth_mail_outbox').get()!.n,1)
 sqlite.prepare('UPDATE auth_otp_cooldowns SET next_send_at=?').run(Date.now()-1)
 assert.equal((await resend()).status,200)
 assert.equal(sqlite.prepare('SELECT count(*) n FROM auth_verification').get()!.n,1)
 assert.ok(Number(sqlite.prepare('SELECT expires_at FROM auth_mail_outbox WHERE id=?').get(oldMail)!.expires_at)<=Date.now())
 const current=(await lastMail(env,db)).text.match(/Your code: (\d{6})/)![1]
 if(current!==old)assert.equal((await apiFetch(request('/api/auth/email-otp/verify-email',{email,otp:old}),env)).status,400)
 const results=await Promise.all([1,2].map(()=>apiFetch(request('/api/auth/email-otp/verify-email',{email,otp:current}),env)))
 assert.equal(results.filter(r=>r.status===200).length,1)
 const known=await apiFetch(request('/api/auth/email-otp/request-password-reset',{email}),env)
 const absent=await apiFetch(request('/api/auth/email-otp/request-password-reset',{email:'unknown@example.test'}),env)
 assert.equal(known.status,200);assert.equal(absent.status,200);assert.deepEqual(await known.json(),await absent.json())
 for(const target of [email,'unknown@example.test'])assert.equal((await apiFetch(request('/api/auth/email-otp/request-password-reset',{email:target}),env)).status,429)
 for(const path of ['/verify-email?token=old','/reset-password','/send-verification-email','/request-password-reset','/sign-in/email-otp','/email-otp/check-verification-otp','/email-otp/get-verification-otp'])assert.equal((await apiFetch(request('/api/auth'+path,{email,otp:current}),env)).status,400)
})

test('expired OTP emails are never handed to Resend',async t=>{
 const {env,db,sqlite,request}=fixture()
 await apiFetch(request('/api/auth/sign-up/email',{email:'expiry@example.test',password:'Synthetic secure password 2026!',name:'Expiry'}),env)
 sqlite.prepare('UPDATE auth_mail_outbox SET expires_at=?').run(Date.now()-1)
 t.mock.method(globalThis,'fetch',async()=>assert.fail('Expired OTP must not reach Resend'))
 await drainMail(env)
 assert.equal(sqlite.prepare('SELECT attempts FROM auth_mail_outbox').get()!.attempts,0)
 assert.equal((await db.prepare('SELECT count(*) n FROM auth_user').first())!.n,1)
})

test('OTP migration preserves existing users, passwords, roles, sessions and legacy verification records',()=>{
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON')
 for(const file of ['0001_staging_foundation.sql','0002_cloudflare_auth.sql','0003_auth_mail_diagnostics.sql'])sqlite.exec(readFileSync(new URL('../workers/api/migrations/'+file,import.meta.url),'utf8'))
 sqlite.exec(readFileSync(new URL('../workers/api/fixtures.sql',import.meta.url),'utf8'))
 sqlite.exec("INSERT INTO auth_user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('existing','Existing','existing@example.test',1,'2026-10-14','2026-10-14'); INSERT INTO auth_account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES('account','existing','credential','existing','synthetic-existing-hash','2026-10-14','2026-10-14'); INSERT INTO auth_session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES('session','2026-10-21','synthetic-session','2026-10-14','2026-10-14','existing'); INSERT INTO auth_verification(id,identifier,value,expiresAt,createdAt,updatedAt) VALUES('legacy','reset-password:legacy','existing','2026-10-15','2026-10-14','2026-10-14');")
 const tables=['users','profiles','user_roles','auth_user','auth_account','auth_session','auth_verification','products','inventory','orders']
 const before=new Map(tables.map(name=>[name,sqlite.prepare('SELECT * FROM '+name).all()]))
 sqlite.exec(readFileSync(new URL('../workers/api/migrations/0009_auth_email_otp.sql',import.meta.url),'utf8'))
 for(const name of tables)assert.deepEqual(sqlite.prepare('SELECT * FROM '+name).all(),before.get(name))
 assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length,0)
})

test('queued legacy authentication links are retired without sending; password-reset responses never expose codes',async t=>{
 const {env,sqlite,request}=fixture(),email='legacy-queue@example.test'
 await apiFetch(request('/api/auth/sign-up/email',{email,password:'Synthetic secure password 2026!',name:'Legacy'}),env)
 const iv=crypto.getRandomValues(new Uint8Array(12)),key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.AUTH_SECRET)),'AES-GCM',false,['encrypt'])
 const old=JSON.stringify({text:'Old link https://staging.test/api/auth/verify-email?token=synthetic-retired',html:'',from:'LogsPoll <no-reply@logspoll.com>',to:[email]})
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(old))
 sqlite.prepare("UPDATE auth_mail_outbox SET payload=?,iv=?,expires_at=NULL,otp_subject=NULL").run(Buffer.from(cipher).toString('base64'),Buffer.from(iv).toString('base64'))
 t.mock.method(globalThis,'fetch',async()=>assert.fail('Legacy links must not be sent'))
 await drainMail(env)
 assert.equal(sqlite.prepare('SELECT last_error FROM auth_mail_outbox').get()!.last_error,'legacy_auth_link_retired')
 assert.equal((await apiFetch(request('/api/auth/%76erify-email?token=synthetic',{}),env)).status,400)
 assert.equal((await apiFetch(request('/api/auth/email-otp/request-password-reset',{email},undefined,'https://evil.test'),env)).status,403)
})
