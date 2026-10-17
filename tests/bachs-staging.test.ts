import test from 'node:test'
import assert from 'node:assert/strict'
import {apiFetch} from '../workers/api/index.ts'
import {stagingBachsWebhook} from '../workers/api/bachs-staging.ts'
import type {ApiEnv,Database} from '../workers/api/types.ts'

const url='https://logspoll-api-staging.comedianmayorsearch.workers.dev/api/webhooks/bachs'
const request=(method='POST',body:string|null='{}',headers:Record<string,string>={})=>new Request(url,['GET','HEAD'].includes(method)?{method,headers}:{method,body:body??undefined,headers})
const env={ENVIRONMENT:'staging',BACHS_API_KEY:'sk_sandbox_test',BACHS_WEBHOOK_SECRET:'test-only-secret'} satisfies ApiEnv
function database(value:string){return {prepare(){return {bind(){return this},async first(){return {value}},async run(){throw Error('Unexpected database write')}}},async batch(){throw Error('Unexpected database write')}} as unknown as Database}

async function sign(secret:string,body:string,stamp=Math.floor(Date.now()/1000)){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${stamp}.${body}`))).toString('hex')
 return {stamp,sig}
}

test('sandbox receiver is POST-only and fails closed without credentials',async()=>{
 assert.equal((await stagingBachsWebhook(request('GET'),env)).status,405)
 assert.equal((await apiFetch(request('GET'),env)).status,405)
 assert.equal((await stagingBachsWebhook(request('POST'),{ENVIRONMENT:'staging'})).status,503)
 assert.equal((await apiFetch(request('POST'),{ENVIRONMENT:'staging'})).status,503)
})

test('sandbox receiver cannot use production environment, live keys or production data',async()=>{
 for(const settings of [{...env,ENVIRONMENT:'production'},{...env,BACHS_API_KEY:'sk_live_test'},{...env,DB:database('production')}]) {
  assert.equal((await stagingBachsWebhook(request('POST'),settings as ApiEnv)).status,503)
  assert.equal((await apiFetch(request('POST'),settings as ApiEnv)).status,503)
 }
 const throwingDb={prepare(){return {bind(){return this},async first(){throw Error('db error')}}}} as unknown as Database
 assert.equal((await stagingBachsWebhook(request('POST'),{...env,DB:throwingDb})).status,503)
})

test('verified staging dataset enforces HMAC signature checks',async()=>{
 const db=database('synthetic-staging')
 const stagingEnv={...env,DB:db}
 // Unsigned body fails with 401 without writes.
 assert.equal((await stagingBachsWebhook(request('POST','{}'),stagingEnv)).status,401)
 assert.equal((await apiFetch(request('POST','{}'),stagingEnv)).status,401)

 const body=JSON.stringify({id:'evt_test123456',type:'ping.ignored',data:{checkout_id:'chk_test123456'}})

 // Stale timestamp fails HMAC check.
 const stale=await sign(stagingEnv.BACHS_WEBHOOK_SECRET,body,Math.floor(Date.now()/1000)-305)
 assert.equal((await stagingBachsWebhook(request('POST',body,{'X-Bachs-Signature-V2':`t=${stale.stamp},v1=${stale.sig}`}),stagingEnv)).status,401)

 // Valid V2 signature passes HMAC verification.
 const valid=await sign(stagingEnv.BACHS_WEBHOOK_SECRET,body)
 const v2Res=await stagingBachsWebhook(request('POST',body,{'X-Bachs-Signature-V2':`t=${valid.stamp},v1=${valid.sig}`}),stagingEnv)
 assert.equal(v2Res.status,200)
 assert.deepEqual(await v2Res.json(),{received:true,ignored:true})

 // Rotated V2 signature with multiple candidate signatures passes HMAC verification.
 const dummy='0'.repeat(64)
 const rotatedRes=await apiFetch(request('POST',body,{'X-Bachs-Signature-V2':`t=${valid.stamp},v1=${dummy},v1=${valid.sig}`}),stagingEnv)
 assert.equal(rotatedRes.status,200)

 // Valid V1 signature and timestamp headers pass HMAC verification.
 const v1Res=await apiFetch(request('POST',body,{'X-Bachs-Signature':valid.sig,'X-Bachs-Timestamp':String(valid.stamp)}),stagingEnv)
 assert.equal(v1Res.status,200)
})
