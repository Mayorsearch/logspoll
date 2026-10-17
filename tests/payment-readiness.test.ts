import test from 'node:test'
import assert from 'node:assert/strict'
import {paymentReadiness} from '../workers/api/payment-readiness.ts'
import type {ApiEnv,Database} from '../workers/api/types.ts'
const env:ApiEnv={ENVIRONMENT:'staging',BACHS_API_KEY:'sk_sandbox_synthetic_only',BACHS_WEBHOOK_SECRET:'synthetic-secret',DB:{prepare(){return{all:async()=>({success:true,results:[]})}}} as unknown as Database}
test('readiness keeps checkout locked and discloses only safe diagnostic fields',async t=>{
 const calls=t.mock.method(globalThis,'fetch',async(_url,init)=>{assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+env.BACHS_API_KEY);return Response.json({items:[{url:'https://logspoll.com/api/webhooks/bachs',enabled:true,event_types:['checkout.completed','collection.succeeded','collection.failed','checkout.expired'],signing_secret:'NEVER-RETURN'}],pagination:{has_more:false}})})
 const untested=await paymentReadiness(env,'https://logspoll.com');assert.equal(calls.mock.callCount(),0);assert.equal(untested.checkoutEnabled,false)
 const tested=await paymentReadiness(env,'https://logspoll.com',true)
 assert.equal(tested.webhookDestinationConfigured,true);assert.equal(tested.providerHttpStatus,200)
 assert.equal(tested.checkoutEnabled,false);assert.equal(tested.automaticFulfillment,false)
 assert.doesNotMatch(JSON.stringify(tested),/synthetic|NEVER-RETURN/)
})
test('readiness distinguishes authentication and permission failures without returning upstream secrets',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({detail:'NEVER-RETURN'},{status:403}))
 const result=await paymentReadiness(env,'https://logspoll.com',true)
 assert.equal(result.providerHttpStatus,403);assert.match(result.providerCheck,/permission denied/)
 assert.doesNotMatch(JSON.stringify(result),/NEVER-RETURN/)
})

test('readiness normalizes outer credential whitespace without altering stored secrets',async t=>{
 const configured={...env,BACHS_API_KEY:env.BACHS_API_KEY+'\n'}
 t.mock.method(globalThis,'fetch',async(_url,init)=>{assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+env.BACHS_API_KEY);return Response.json({items:[]})})
 const result=await paymentReadiness(configured,'https://logspoll.com',true)
 assert.equal(result.providerHttpStatus,200);assert.equal(configured.BACHS_API_KEY,env.BACHS_API_KEY+'\n');assert.equal(result.checkoutEnabled,false)
})
test('readiness separates timeouts and malformed JSON without disclosing provider errors',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw new DOMException('NEVER-RETURN','TimeoutError')})
 const timeout=await paymentReadiness(env,'https://logspoll.com',true);assert.match(timeout.providerCheck,/timed out/);assert.equal(timeout.providerHttpStatus,null)
 t.mock.method(globalThis,'fetch',async()=>new Response('NEVER-RETURN',{headers:{'Content-Type':'application/json'}}))
 const invalid=await paymentReadiness(env,'https://logspoll.com',true);assert.equal(invalid.providerCheck,'Provider returned invalid JSON');assert.equal(invalid.providerHttpStatus,200);assert.doesNotMatch(JSON.stringify(invalid),/NEVER-RETURN/)
})

test('readiness rejects malformed credentials before contacting Bachs',async t=>{
 const request=t.mock.method(globalThis,'fetch',async()=>{throw new Error('must not fetch')})
 const result=await paymentReadiness({...env,BACHS_API_KEY:'sk_live_invalid\tcredential'},'https://logspoll.com',true)
 assert.equal(request.mock.callCount(),0);assert.match(result.providerCheck,/invalid whitespace/)
 assert.equal(result.checkoutEnabled,false);assert.doesNotMatch(JSON.stringify(result),/credential\t|sk_live_/)
})
test('readiness redacts network errors and preserves payment locks',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('NEVER-RETURN secret upstream details')})
 const result=await paymentReadiness(env,'https://logspoll.com',true)
 assert.equal(result.providerCheck,'Provider request failed (TypeError; unavailable)');assert.equal(result.providerHttpStatus,null)
 assert.equal(result.checkoutEnabled,false);assert.equal(result.automaticFulfillment,false)
 assert.doesNotMatch(JSON.stringify(result),/NEVER-RETURN|secret upstream/)
})
test('readiness uses Cloudflare-compatible manual redirects and reports 3xx without forwarding secrets',async t=>{
 const calls=t.mock.method(globalThis,'fetch',async(_url,init)=>{
  assert.equal(init?.redirect,'manual')
  return new Response(null,{status:302,headers:{Location:'https://untrusted.example/NEVER-RETURN'}})
 })
 const result=await paymentReadiness(env,'https://logspoll.com',true)
 assert.equal(calls.mock.callCount(),1);assert.equal(result.providerHttpStatus,302);assert.match(result.providerCheck,/redirect rejected/)
 assert.doesNotMatch(JSON.stringify(result),/NEVER-RETURN|synthetic/)
})
test('readiness exposes only allowlisted DNS/TLS codes and retains received HTTP status',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('NEVER-RETURN',{cause:{code:'ENOTFOUND',secret:'NEVER-RETURN'}})})
 const dns=await paymentReadiness(env,'https://logspoll.com',true)
 assert.equal(dns.providerErrorCode,'ENOTFOUND');assert.equal(dns.providerFailureStage,'request');assert.equal(dns.providerHttpStatus,null)
 assert.doesNotMatch(JSON.stringify(dns),/NEVER-RETURN/)
 t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('NEVER-RETURN',{cause:{code:'CERT_HAS_EXPIRED'}})})
 const tls=await paymentReadiness(env,'https://logspoll.com',true)
 assert.equal(tls.providerErrorCode,'CERT_HAS_EXPIRED');assert.equal(tls.providerHttpStatus,null)
 t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({start(controller){controller.error(new TypeError('NEVER-RETURN',{cause:{code:'ECONNRESET'}}))}}),{headers:{'Content-Type':'application/json'}}))
 const body=await paymentReadiness(env,'https://logspoll.com',true)
 assert.equal(body.providerHttpStatus,200);assert.equal(body.providerFailureStage,'response body');assert.equal(body.providerErrorCode,'ECONNRESET')
 assert.doesNotMatch(JSON.stringify(body),/NEVER-RETURN/)
})
test('existing ledger supplies history and active signature-gated handler status',async t=>{
 const configured={...env,DB:{prepare(sql:string){return{all:async()=>({success:true,results:sql.includes('sqlite_master')?['bachs_payment_attempts','bachs_webhook_events','bachs_reservations'].map(name=>({name})):[{id:'attempt',reference:'LP-order',amount_minor:200000,status:'paid',provider_mode:'sandbox'}]})}}} as unknown as Database}
 t.mock.method(globalThis,'fetch',async(url)=>Response.json(String(url).includes('/webhooks/')?{items:[]}:{items:[]}))
 const result=await paymentReadiness(configured,'https://logspoll.com',true)
 assert.equal(result.webhookHandlerEnabled,true);assert.equal(result.history[0].reference,'LP-order');assert.match(result.paymentReadPermission,/payments:read confirmed/)
 assert.equal(result.checkoutEnabled,false)
 assert.equal((await paymentReadiness({...configured,BACHS_WEBHOOK_SECRET:''},'https://logspoll.com')).webhookHandlerEnabled,false)
})
