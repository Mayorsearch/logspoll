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
  for (const file of ['migrations/0001_staging_foundation.sql','fixtures.sql','migrations/0002_cloudflare_auth.sql']) sqlite.exec(readFileSync(new URL('../workers/api/'+file,import.meta.url),'utf8'))
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
  const env: ApiEnv = { ENVIRONMENT:'staging', DB:db, AUTH_ENABLED:'true', AUTH_ORIGIN:'https://staging.test', AUTH_SECRET:'local-test-authentication-secret-not-used-outside-tests', RESEND_API_KEY:'synthetic-only-never-send' }
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
  assert.equal(verification.from,'LOGSPOLL <no-reply@logspoll.com>'); assert.deepEqual(verification.to,[email]); assert.doesNotMatch(verification.text,/SAMPLE EMAIL/)
  const verificationUrl=verification.text.match(/https:\/\/staging\.test\/api\/auth\/verify-email\?[^\s]+/)![0]
  assert.equal((await apiFetch(new Request(verificationUrl),env)).status,302)
  assert.equal((await apiFetch(new Request(verificationUrl),env)).status,400)
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
  await apiFetch(request('/api/auth/request-password-reset',{email,redirectTo:'/reset-password'}),env)
  const reset=await lastMail(env,db); assert.match(reset.subject,/Reset/)
  const token=reset.text.match(/\/reset-password\/([A-Za-z0-9_-]+)\?/)![1]
  const resetResponse=await apiFetch(request('/api/auth/reset-password',{token,newPassword:'Changed synthetic password 2026!'}),env)
  assert.equal(resetResponse.status,200,await resetResponse.clone().text())
  assert.equal((await apiFetch(request('/api/auth/reset-password',{token,newPassword:password}),env)).status,400)
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
  for(let i=0;i<3;i++) await apiFetch(request('/api/auth/request-password-reset',{email:'absent@example.test',redirectTo:'/reset-password'}),env)
  assert.equal((await apiFetch(request('/api/auth/request-password-reset',{email:'absent@example.test'}),env)).status,429)
  await apiFetch(request('/api/auth/sign-up/email',{email:'queued@example.test',password:'Synthetic password 2026!',name:'Queue'}),env)
  const row=await db.prepare('SELECT * FROM auth_mail_outbox').first<{id:string;payload:string}>()
  assert.ok(row); assert.doesNotMatch(row.payload,/queued@example|verify-email|token=/)
  let idempotency=''
  t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{ idempotency=(init.headers as Record<string,string>)['Idempotency-Key']; return Response.json({error:'synthetic failure'},{status:503}) })
  await drainMail(env)
  assert.equal((await db.prepare('SELECT attempts FROM auth_mail_outbox').first<{attempts:number}>())!.attempts,1)
  await db.prepare('UPDATE auth_mail_outbox SET next_attempt=0').run()
  let retryKey=''
  t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{ retryKey=(init.headers as Record<string,string>)['Idempotency-Key']; return Response.json({id:'synthetic-accepted'}) })
  await drainMail(env); assert.equal(retryKey,idempotency)
  assert.equal((await db.prepare('SELECT payload FROM auth_mail_outbox').first<{payload:string}>())!.payload,'')
  assert.equal((await createAuth(env).api.getSession({headers:new Headers()})),null)
})
