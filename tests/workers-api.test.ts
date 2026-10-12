import test from 'node:test'
import assert from 'node:assert/strict'
import { apiFetch } from '../workers/api/index.ts'
import type { ApiEnv, Database } from '../workers/api/types.ts'
const request = (path: string, init?: RequestInit) => new Request('https://staging.test'+path,init)
test('staging API locks production and refuses writes, cross-origin requests and missing authentication', async () => {
  const db = { prepare: () => { throw new Error('Database must not be accessed') } } as Database
  assert.equal((await apiFetch(request('/api/health'),{ ENVIRONMENT:'locked',DB:db })).status,503)
  const env: ApiEnv = { ENVIRONMENT:'staging',DB:db }
  assert.equal((await apiFetch(request('/api/products',{method:'POST'}),env)).status,405)
  assert.equal((await apiFetch(request('/api/products',{headers:{Origin:'https://evil.test'}}),env)).status,403)
  assert.equal((await apiFetch(request('/api/products?customer_id=someone-else'),env)).status,401)
  assert.equal((await apiFetch(request('/api/products',{headers:{Authorization:`Bearer ${'a'.repeat(40)}`}}),env)).status,503)
})
test('health requires the synthetic D1 marker and exposes no customer records', async () => {
  let value = 'synthetic-staging'
  const db = { prepare: () => ({first:async()=>({value})}) } as unknown as Database
  const env: ApiEnv = {ENVIRONMENT:'staging',DB:db}
  const response = await apiFetch(request('/api/health'),env)
  assert.equal(response.status,200)
  assert.deepEqual(await response.json(),{status:'ok',environment:'staging',database:'D1',dataset:'synthetic-only',authReplacement:false,supplierSync:false,livePayments:false})
  value='production'
  assert.equal((await apiFetch(request('/api/health'),env)).status,503)
})
test('verified identities are mapped server-side; customer records are scoped and customer admin access denied',async t=>{
  let role='customer';let hits=1;let confirmed=true;let sub='verified-subject'
  const queries:{sql:string;values:unknown[]}[]=[]
  const db={prepare:(sql:string)=>{
    let values:unknown[]=[]
    const stmt={bind:(...args:unknown[])=>{values=args;return stmt},first:async()=>{
      if(sql.includes('external_identities')){assert.deepEqual(values,['https://isolated.supabase.co','verified-subject']);return {id:'mapped-customer',role}}
      if(sql.includes('request_limits'))return {hits}
      return null
    },run:async()=>({success:true}),all:async()=>{queries.push({sql,values});return {success:true,results:[]}}}
    return stmt
  }} as Database
  t.mock.method(globalThis,'fetch',async()=>Response.json({id:sub,email_confirmed_at:confirmed?'2026-10-12T00:00:00Z':null}))
  const env:ApiEnv={ENVIRONMENT:'staging',DB:db,STAGING_SUPABASE_URL:'https://isolated.supabase.co',STAGING_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic',LEGACY_SUPABASE_ORIGIN:'https://production.supabase.co'}
  const make=(path:string)=>request(path,{headers:{Authorization:`Bearer ${'a'.repeat(40)}`}})
  assert.equal((await apiFetch(make('/api/orders?customer_id=someone-else&role=admin'),env)).status,200)
  assert.deepEqual(queries[0].values,['mapped-customer'])
  assert.match(queries[0].sql,/WHERE customer_id=\?/)
  assert.equal((await apiFetch(make('/api/admin/overview'),env)).status,403)
  role='admin'
  assert.equal((await apiFetch(make('/api/admin/overview'),env)).status,200)
  hits=61
  assert.equal((await apiFetch(make('/api/orders'),env)).status,429)
  confirmed=false;sub='forged'
  assert.equal((await apiFetch(make('/api/orders'),env)).status,401)
  assert.equal((await apiFetch(make('/api/orders'),{...env,STAGING_SUPABASE_URL:'https://production.supabase.co'})).status,503)
})
