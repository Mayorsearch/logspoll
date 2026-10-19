import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {bachsWebhook} from '../workers/api/bachs-webhook.ts'
import type {ApiEnv,Database,Statement} from '../workers/api/types.ts'
import {initiateCheckout,paymentMode} from '../workers/api/bachs-checkout.ts'
import {reconcileBachsAttempt,reconcileCustomerPayment} from '../workers/api/bachs-webhook.ts'
import {customerRead} from '../workers/api/customer.ts'

const customer='11111111-1111-4111-8111-111111111111',order='22222222-2222-4222-8222-222222222222',attempt='33333333-3333-4333-8333-333333333333',product='44444444-4444-4444-8444-444444444444',category='55555555-5555-4555-8555-555555555555',checkout='chk_sandbox12345'
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON')
 for(const name of ['0001_staging_foundation.sql','0010_bachs_payment_foundation.sql'])sql.exec(readFileSync(new URL('../workers/api/migrations/'+name,import.meta.url),'utf8'))
 sql.prepare('INSERT INTO users(id) VALUES(?)').run(customer)
 sql.prepare('INSERT INTO categories(id,slug,name,short_name) VALUES(?,?,?,?)').run(category,'test','Test','Test')
 sql.prepare("INSERT INTO products(id,category_id,slug,name,description,price_minor,supplier_name,delivery_type) VALUES(?,?,'test','Test','Test',200000,'Test','Subscription activation')").run(product,category)
 sql.exec("UPDATE products SET status='active',authorized_resale=1,publication_verified=1;CREATE VIEW storefront_products AS SELECT * FROM staging_storefront_products")
 sql.prepare("INSERT INTO inventory(product_id,available_quantity,source_mode,verified_at) VALUES(?,2,'manual',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run(product)
 sql.prepare("INSERT INTO orders(id,customer_id,reference,total_minor) VALUES(?,?,'test-reference',200000)").run(order,customer)
 sql.prepare("INSERT INTO order_items(id,order_id,product_id,product_name,category_name,quantity,unit_price_minor) VALUES('item',?,?,'Test','Test',1,200000)").run(order,product)
 sql.prepare("INSERT INTO bachs_payment_attempts(id,order_id,customer_id,client_request_id,idempotency_key,checkout_id,provider_mode,amount_minor,status,created_at,updated_at) VALUES(?,?,?,?,?,?, 'sandbox',200000,'open',1,1)").run(attempt,order,customer,crypto.randomUUID(),'sandbox_attempt_12345',checkout)
 sql.prepare("INSERT INTO bachs_reservations(attempt_id,product_id,quantity,expires_at,created_at) VALUES(?,?,1,9999999999999,1)").run(attempt,product)
 const prepare=(query:string):Statement=>{let values:(string|number|null)[]=[];return{bind(...v){values=v;return this},async first<T>(){return (sql.prepare(query).get(...values)??null) as T|null},async all<T>(){return {success:true,results:sql.prepare(query).all(...values) as T[]}},async run(){return sql.prepare(query).run(...values)}}}
 const db:Database={prepare,async batch(statements){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results}catch(e){sql.exec('ROLLBACK');throw e}},async exec(q){sql.exec(q)}}
 const env:ApiEnv={ENVIRONMENT:'staging',DB:db,BACHS_API_KEY:'sk_sandbox_test_only',BACHS_WEBHOOK_SECRET:'test-only-secret',BACHS_SANDBOX_ENABLED:'true'}
 return {sql,env}
}
async function request(env:ApiEnv,id='evt_test123456',type='checkout.completed'){
 const raw=JSON.stringify({id,type,data:{checkout_id:checkout}}),stamp=Math.floor(Date.now()/1000)
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.BACHS_WEBHOOK_SECRET!),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${stamp}.${raw}`))).toString('hex')
 return new Request('https://test.example/api/webhooks/bachs',{method:'POST',body:raw,headers:{'X-Bachs-Signature-V2':`t=${stamp},v1=${signature}`}})
}
const paid={checkout_id:checkout,reference:order,amount:'2000.00',currency:'NGN',status:'completed',payment_status:'succeeded',session_mode:null,products:null,metadata:{order_id:order},recurring:null,source_type:'API',charge:{status:'succeeded'}}
test('signed payment reconciles D1 exactly once and never fulfills',async t=>{
 const {sql,env}=fixture();t.after(()=>sql.close());const fetch=t.mock.method(globalThis,'fetch',async()=>Response.json(paid))
 assert.equal((await bachsWebhook(await request(env),env)).status,200)
 assert.equal((await bachsWebhook(await request(env),env)).status,200)
 assert.equal(fetch.mock.callCount(),1)
 assert.equal(sql.prepare('SELECT payment_status FROM orders').get()!.payment_status,'paid')
 assert.equal(sql.prepare('SELECT fulfillment_status FROM orders').get()!.fulfillment_status,'pending')
 assert.equal(sql.prepare('SELECT state FROM bachs_reservations').get()!.state,'consumed')
 assert.equal(sql.prepare('SELECT count(*) n FROM bachs_webhook_events').get()!.n,1)
})

test('checkout computes NGN server totals, retries one attempt and refuses overselling',async t=>{
 const {sql,env}=fixture();t.after(()=>sql.close());const keys:string[]=[]
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  const body=JSON.parse(String(init?.body));assert.equal(body.pricing.amount,'2000.00');keys.push(new Headers(init?.headers).get('Idempotency-Key')!)
  return Response.json({checkout_id:'chk_newattempt12345',checkout_url:'https://sandbox-checkout.bachs.io/c/test'})
 })
 const id=crypto.randomUUID(),buyer={id:customer,email:'test@example.com'},items=[{id:product,quantity:1}]
 const first=await initiateCheckout(env,buyer,id,items,'https://test.example')
 assert.equal(first.status,'open');assert.equal((await initiateCheckout(env,buyer,id,items,'https://test.example')).orderId,first.orderId)
 assert.equal(keys[0],keys[1]);assert.equal(sql.prepare('SELECT count(*) n FROM orders').get()!.n,2)
 await assert.rejects(initiateCheckout(env,buyer,crypto.randomUUID(),items,'https://test.example'),/Stock or prices changed/)
 assert.equal(sql.prepare('SELECT count(*) n FROM orders').get()!.n,2)
 await assert.rejects(initiateCheckout(env,buyer,id,[{id:product,quantity:2}],'https://test.example'),/does not match/)
 assert.equal(keys.length,2)
})
test('insufficient multi-unit stock rolls back order, items, attempt and hold together',async t=>{
 const {sql,env}=fixture();t.after(()=>sql.close());const fetch=t.mock.method(globalThis,'fetch',async()=>{throw Error('must not call')})
 await assert.rejects(initiateCheckout(env,{id:customer,email:'test@example.com'},crypto.randomUUID(),[{id:product,quantity:2}],'https://test.example'),/Stock or prices changed/)
 for(const table of ['orders','order_items','bachs_payment_attempts','bachs_reservations'])assert.equal(sql.prepare('SELECT count(*) n FROM '+table).get()!.n,1)
 assert.equal(fetch.mock.callCount(),0)
})
test('ambiguous initiation retains its reservation and durable idempotency key',async t=>{
 const {sql,env}=fixture();t.after(()=>sql.close());const keys:string[]=[]
 t.mock.method(globalThis,'fetch',async(_url,init)=>{keys.push(new Headers(init?.headers).get('Idempotency-Key')!);if(keys.length===1)throw Error('timeout');return Response.json({checkout_id:'chk_retry12345',checkout_url:'https://sandbox-checkout.bachs.io/c/test'})})
 const id=crypto.randomUUID(),buyer={id:customer,email:'test@example.com'},items=[{id:product,quantity:1}]
 await assert.rejects(initiateCheckout(env,buyer,id,items,'https://test.example'))
 assert.equal(sql.prepare("SELECT count(*) n FROM bachs_reservations WHERE state='held'").get()!.n,2)
 await initiateCheckout(env,buyer,id,items,'https://test.example');assert.equal(keys[0],keys[1])
})
test('expiry recovery requires authoritative terminal status and live activation stays locked',async t=>{
 const {sql,env}=fixture();t.after(()=>sql.close())
 assert.throws(()=>paymentMode({...env,ENVIRONMENT:'production',BACHS_API_KEY:'sk_live_test_only'}),/disabled/)
 t.mock.method(globalThis,'fetch',async()=>Response.json({...paid,status:'expired',payment_status:'failed',charge:null}))
 await reconcileBachsAttempt(env,{id:attempt,order_id:order,checkout_id:checkout,provider_mode:'sandbox',amount_minor:200000,status:'open'})
 assert.equal(sql.prepare('SELECT state FROM bachs_reservations').get()!.state,'released')
 assert.equal(sql.prepare('SELECT payment_status FROM orders').get()!.payment_status,'failed')
})
test('incorrect amounts, missing holds and failed verification cannot mark paid',async t=>{
 for(const scenario of ['amount','hold','network']){
  const {sql,env}=fixture();try{
   if(scenario==='hold')sql.exec("UPDATE bachs_reservations SET state='released'")
   t.mock.method(globalThis,'fetch',async()=>{if(scenario==='network')throw Error('secret upstream details');return Response.json({...paid,...(scenario==='amount'?{amount:'1.00'}:{})})})
   const response=await bachsWebhook(await request(env),env)
   assert.equal(response.status,scenario==='network'?503:200)
   assert.equal(sql.prepare('SELECT payment_status FROM orders').get()!.payment_status,'pending')
   assert.doesNotMatch(await response.text(),/secret upstream/)
  }finally{sql.close()}
 }
})
test('only authoritative terminal cancellation releases stock; late paid events require review',async t=>{
 const {sql,env}=fixture();t.after(()=>sql.close())
 t.mock.method(globalThis,'fetch',async()=>Response.json({...paid,status:'cancelled',payment_status:'canceled',charge:null}))
 assert.equal((await bachsWebhook(await request(env,'evt_cancel12345','collection.failed'),env)).status,200)
 assert.equal(sql.prepare('SELECT state FROM bachs_reservations').get()!.state,'released')
 t.mock.method(globalThis,'fetch',async()=>Response.json(paid))
 await bachsWebhook(await request(env,'evt_latepaid12345'),env)
 assert.equal(sql.prepare('SELECT payment_status FROM orders').get()!.payment_status,'failed')
 assert.equal(sql.prepare("SELECT processing_status FROM bachs_webhook_events WHERE event_id='evt_latepaid12345'").get()!.processing_status,'needs_review')
})
test('bad signatures never touch D1; transient provider state remains retryable',async t=>{
 const {sql,env}=fixture();t.after(()=>sql.close())
 assert.equal((await bachsWebhook(new Request('https://test.example',{method:'POST',body:'{}'}),env)).status,401)
 assert.equal(sql.prepare('SELECT count(*) n FROM bachs_webhook_events').get()!.n,0)
 t.mock.method(globalThis,'fetch',async()=>Response.json({...paid,status:'open',payment_status:'processing'}))
 assert.equal((await bachsWebhook(await request(env),env)).status,503)
 assert.equal(sql.prepare('SELECT state FROM bachs_reservations').get()!.state,'held')
 t.mock.method(globalThis,'fetch',async()=>Response.json(paid))
 assert.equal((await bachsWebhook(await request(env),env)).status,200)
 assert.equal(sql.prepare('SELECT payment_status FROM orders').get()!.payment_status,'paid')
})
test('verified callback recovers a checkout ID lost after provider creation',async t=>{
 const {sql,env}=fixture();t.after(()=>sql.close())
 sql.exec("UPDATE bachs_payment_attempts SET checkout_id=NULL,status='initiating'")
 t.mock.method(globalThis,'fetch',async()=>Response.json(paid))
 assert.equal((await bachsWebhook(await request(env),env)).status,200)
 assert.equal(sql.prepare('SELECT checkout_id FROM bachs_payment_attempts').get()!.checkout_id,checkout)
 assert.equal(sql.prepare('SELECT payment_status FROM orders').get()!.payment_status,'paid')
 assert.equal(sql.prepare('SELECT count(*) n FROM orders').get()!.n,1)
})
test('D1 rejects manual fulfillment until authoritative reconciliation marks paid',async t=>{
 const {sql,env}=fixture();t.after(()=>sql.close())
 const deliver=()=>sql.prepare("UPDATE orders SET fulfillment_status='delivered' WHERE id=?").run(order)
 assert.throws(deliver,/CHECK/)
 t.mock.method(globalThis,'fetch',async()=>Response.json({...paid,amount:'1.00'}))
 await bachsWebhook(await request(env,'evt_wrongprice123'),env)
 assert.throws(deliver,/CHECK/)
 t.mock.method(globalThis,'fetch',async()=>Response.json(paid))
 await bachsWebhook(await request(env,'evt_verifiedpaid123'),env)
 deliver();assert.equal(sql.prepare('SELECT fulfillment_status FROM orders').get()!.fulfillment_status,'delivered')
})

test('signed underpayment is recorded for review, holds stock and cannot authorize fulfillment',async t=>{
 const {sql,env}=fixture();t.after(()=>sql.close())
 t.mock.method(globalThis,'fetch',async()=>Response.json({...paid,status:'open',payment_status:'pending',charge:null}))
 assert.equal((await bachsWebhook(await request(env,'evt_underpaid12345','collection.underpaid'),env)).status,200)
 assert.equal(sql.prepare("SELECT processing_status FROM bachs_webhook_events WHERE event_id='evt_underpaid12345'").get()!.processing_status,'needs_review')
 assert.equal(sql.prepare('SELECT state FROM bachs_reservations').get()!.state,'held')
 assert.equal(sql.prepare('SELECT payment_status FROM orders').get()!.payment_status,'pending')
 assert.equal(sql.prepare('SELECT fulfillment_status FROM orders').get()!.fulfillment_status,'pending')
 t.mock.method(globalThis,'fetch',async()=>Response.json(paid))
 assert.equal((await bachsWebhook(await request(env,'evt_fullpaid12345','collection.succeeded'),env)).status,200)
 assert.equal(sql.prepare('SELECT payment_status FROM orders').get()!.payment_status,'paid')
 assert.equal(sql.prepare('SELECT fulfillment_status FROM orders').get()!.fulfillment_status,'pending')
})

test('refund handling reconciles paid order to refunded without triggering or reversing fulfillment',async t=>{
 const {sql,env}=fixture();t.after(()=>sql.close())
 t.mock.method(globalThis,'fetch',async()=>Response.json(paid))
 assert.equal((await bachsWebhook(await request(env,'evt_payfirst123','checkout.completed'),env)).status,200)
 assert.equal(sql.prepare('SELECT payment_status FROM orders').get()!.payment_status,'paid')
 assert.equal(sql.prepare('SELECT fulfillment_status FROM orders').get()!.fulfillment_status,'pending')

 t.mock.method(globalThis,'fetch',async()=>Response.json({...paid,payment_status:'refunded',charge:{...paid.charge,status:'refunded',refunds:[{id:'ref_123',amount:'2000.00'}]}}))
 assert.equal((await bachsWebhook(await request(env,'evt_refund123','refund.paid'),env)).status,200)
 assert.equal(sql.prepare('SELECT payment_status FROM orders').get()!.payment_status,'refunded')
 assert.equal(sql.prepare('SELECT fulfillment_status FROM orders').get()!.fulfillment_status,'pending')
 assert.equal(sql.prepare('SELECT status FROM bachs_payment_attempts').get()!.status,'needs_review')
 assert.equal(sql.prepare("SELECT processing_status FROM bachs_webhook_events WHERE event_id='evt_refund123'").get()!.processing_status,'processed')

 const rawRefund=JSON.stringify({id:'evt_unlinkedref',type:'refund.paid',data:{id:'ref_orphan',amount:1000}})
 const stamp=Math.floor(Date.now()/1000)
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.BACHS_WEBHOOK_SECRET!),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${stamp}.${rawRefund}`))).toString('hex')
 const unlinkedReq=new Request('https://test.example/api/webhooks/bachs',{method:'POST',body:rawRefund,headers:{'X-Bachs-Signature-V2':`t=${stamp},v1=${sig}`}})
 const unlinkedRes=await bachsWebhook(unlinkedReq,env)
 assert.equal(unlinkedRes.status,200)
 assert.deepEqual(await unlinkedRes.json(),{received:true,reviewRequired:true})
})

test('below-minimum NGN checkout creates no order or hold and preserves existing attempts',async t=>{
 const {sql,env}=fixture();t.after(()=>sql.close())
 sql.prepare('UPDATE products SET price_minor=2250 WHERE id=?').run(product)
 const fetch=t.mock.method(globalThis,'fetch',async()=>{throw Error('must not call')})
 await assert.rejects(initiateCheckout(env,{id:customer,email:'test@example.com'},crypto.randomUUID(),[{id:product,quantity:1}],'https://test.example'),/at least ₦100\.00/)
 for(const table of ['orders','order_items','bachs_payment_attempts','bachs_reservations'])assert.equal(sql.prepare('SELECT count(*) n FROM '+table).get()!.n,1)
 sql.prepare('UPDATE bachs_payment_attempts SET amount_minor=2250').run()
 const requestId=String(sql.prepare('SELECT client_request_id FROM bachs_payment_attempts').get()!.client_request_id)
 await assert.rejects(initiateCheckout(env,{id:customer,email:'test@example.com'},requestId,[{id:product,quantity:1}],'https://test.example'),/at least ₦100\.00/)
 assert.equal(fetch.mock.callCount(),0)
 assert.equal(sql.prepare('SELECT state FROM bachs_reservations').get()!.state,'held')
})


test('dashboard order reads recover a missed webhook through authoritative verification',async t=>{
 const {sql,env}=fixture();t.after(()=>sql.close())
 const fetch=t.mock.method(globalThis,'fetch',async()=>Response.json(paid))
 const response=await customerRead(new Request('https://test.example/api/orders'),env,{id:customer,role:'customer'})
 assert.equal(response?.status,200)
 assert.equal((await response!.json()).records[0].payment_status,'paid')
 assert.equal(sql.prepare('SELECT state FROM bachs_reservations').get()!.state,'consumed')
 assert.equal(sql.prepare('SELECT fulfillment_status FROM orders').get()!.fulfillment_status,'pending')
 await reconcileCustomerPayment(env,customer)
 assert.equal(fetch.mock.callCount(),1)
})
test('dashboard recovery is customer-scoped and never trusts failed provider verification',async t=>{
 const {sql,env}=fixture();t.after(()=>sql.close())
 const fetch=t.mock.method(globalThis,'fetch',async()=>{throw Error('provider unavailable')})
 await reconcileCustomerPayment(env,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
 assert.equal(fetch.mock.callCount(),0)
 await assert.rejects(reconcileCustomerPayment(env,customer),/verification is temporarily unavailable/)
 assert.equal(sql.prepare('SELECT payment_status FROM orders').get()!.payment_status,'pending')
 assert.equal(sql.prepare('SELECT state FROM bachs_reservations').get()!.state,'held')
})
