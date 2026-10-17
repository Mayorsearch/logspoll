import test from 'node:test'
import assert from 'node:assert/strict'
import {apiFetch} from '../workers/api/index.ts'
import {onRequest} from '../functions/api/webhooks/bachs.ts'
import type {ApiEnv,Database} from '../workers/api/types.ts'
test('production Bachs webhook reaches live HMAC receiver, never sandbox-only gate',async()=>{
 const db={prepare(){throw Error('Unsigned request must not access database')}} as unknown as Database
 const request=new Request('https://logspoll.com/api/webhooks/bachs',{method:'POST',body:'{}'})
 const result=await apiFetch(request,{ENVIRONMENT:'production',DB:db,BACHS_API_KEY:'sk_live_test_only',BACHS_WEBHOOK_SECRET:'test-only-secret'} satisfies ApiEnv)
 assert.equal((await onRequest({request:new Request(request.url,{method:'POST',body:'{}'}),env:{ENVIRONMENT:'production',DB:db,BACHS_API_KEY:'sk_live_test_only',BACHS_WEBHOOK_SECRET:'test-only-secret'}})).status,401);assert.equal(result.status,401);assert.equal((await result.json()).error,'Invalid webhook signature.')
})
test('staging route rejects a live key before accessing any database',async()=>{
 const response=await apiFetch(new Request('https://staging.example/api/webhooks/bachs',{method:'POST',body:'{}'}),{ENVIRONMENT:'staging',BACHS_API_KEY:'sk_live_test_only'})
 assert.equal(response.status,503)
})
