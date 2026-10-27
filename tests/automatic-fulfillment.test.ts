import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {apiFetch} from '../workers/api/index.ts'
import {runFulfillment,fulfillPaidOrder} from '../workers/api/fulfillment.ts'
import {prepareDelivery,deliveryCostMinor} from '../server/supplier-delivery.ts'
import {sealCredential} from '../server/supplier-crypto.ts'
import {renderEmail} from '../src/lib/email-templates.ts'
import type {ApiEnv,Database,Statement} from '../workers/api/types.ts'
const user='11111111-1111-4111-8111-111111111111',order='22222222-2222-4222-8222-222222222222',product='33333333-3333-4333-8333-333333333333',item='44444444-4444-4444-8444-444444444444',attempt='55555555-5555-4555-8555-555555555555',category='66666666-6666-4666-8666-666666666666',key='ypg_'+'a'.repeat(48)
async function fixture(paid=true){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON')
 for(const f of ['0001_staging_foundation.sql','0002_cloudflare_auth.sql','0009_auth_email_otp.sql','0010_bachs_payment_foundation.sql'])sql.exec(readFileSync(new URL('../workers/api/migrations/'+f,import.meta.url),'utf8'))
 sql.exec(`CREATE TABLE product_authorizations(product_id TEXT PRIMARY KEY,evidence TEXT);CREATE TABLE business_mail_events(id TEXT PRIMARY KEY,kind TEXT,user_id TEXT,created_at INTEGER);
 CREATE TABLE supplier_products(product_id TEXT,connection_id TEXT,external_id TEXT);CREATE TABLE staging_supplier_connections(id TEXT,provider TEXT,enabled INTEGER,encrypted_key TEXT,key_nonce TEXT,authorized_products TEXT);
 CREATE TABLE staging_supplier_feed_items(connection_id TEXT,external_id TEXT,approval TEXT,authorization_verified INTEGER,evidence_reference TEXT,snapshot_id TEXT);
 CREATE TABLE supplier_sync_items(job_id TEXT,external_id TEXT,metadata TEXT);
 CREATE TABLE hstora_catalog_items(product_id TEXT,external_id TEXT,approval_status TEXT);CREATE TABLE hstora_connection(id TEXT,enabled INTEGER,ciphertext TEXT,nonce TEXT);
 CREATE TABLE digitalcore_catalog_items(product_id TEXT,external_id TEXT,approval_status TEXT);CREATE TABLE digitalcore_connection(id TEXT,enabled INTEGER,ciphertext TEXT,nonce TEXT,base_url TEXT DEFAULT 'https://digitalcore.top');
 CREATE TABLE shopviaclone22_catalog_items(product_id TEXT,external_id TEXT,approval_status TEXT);CREATE TABLE shopviaclone22_connection(id TEXT,enabled INTEGER,ciphertext TEXT,nonce TEXT,base_url TEXT DEFAULT 'https://shopviaclone22.com/api');`)
 sql.prepare('INSERT INTO users(id) VALUES(?)').run(user)
 sql.prepare("INSERT INTO categories(id,slug,name,short_name) VALUES(?,'test','Test','Test')").run(category)
 sql.prepare("INSERT INTO products(id,category_id,slug,name,description,price_minor,supplier_name,authorized_resale,status,publication_verified,delivery_type) VALUES(?,?,'test','Test','Verified subscription product',45000,'YoungPG',1,'active',1,'Subscription activation')").run(product,category)
 sql.prepare("INSERT INTO product_authorizations VALUES(?,?)").run(product,JSON.stringify({reference:'verified',delivery:true,privacy:true,provider:true}))
 sql.prepare('INSERT INTO orders(id,customer_id,reference,total_minor) VALUES(?,?,?,45000)').run(order,user,'LP-test')
 sql.prepare("INSERT INTO order_items(id,order_id,product_id,product_name,category_name,quantity,unit_price_minor) VALUES(?,?,?,'Test','Test',1,45000)").run(item,order,product)
 sql.prepare("INSERT INTO bachs_payment_attempts(id,order_id,customer_id,client_request_id,idempotency_key,provider_mode,amount_minor,status,created_at,updated_at) VALUES(?,?,?,?,?,'sandbox',45000,?,1,1)").run(attempt,order,user,crypto.randomUUID(),'attempt_test_unique',paid?'paid':'open')
 const env:ApiEnv={ENVIRONMENT:'staging',AUTO_FULFILLMENT_ENABLED:'true',SUPPLIER_ENCRYPTION_KEY:btoa('x'.repeat(32)),AUTH_SECRET:'synthetic-secret-for-d1-staging-review-test-only',AUTH_ORIGIN:'https://staging.test',AUTH_ENABLED:'true',RESEND_API_KEY:'re_synthetic_key'}
 const sealed=await sealCredential(key,'connection',env.SUPPLIER_ENCRYPTION_KEY)
 sql.prepare("INSERT INTO staging_supplier_connections VALUES('connection','youngpg',1,?,?,?)").run(sealed.ciphertext,sealed.nonce,JSON.stringify({'*':'verified'}))
 sql.prepare("INSERT INTO supplier_products VALUES(?,'connection','12')").run(product)
 sql.exec(`INSERT INTO staging_supplier_feed_items VALUES('connection','12','approved',1,'verified','snapshot');INSERT INTO supplier_sync_items VALUES('snapshot','12','{"slug":"subscription-test"}')`)
 sql.exec(readFileSync(new URL('../workers/api/migrations/0024_automatic_fulfillment.sql',import.meta.url),'utf8'))
 if(paid)sql.prepare("UPDATE orders SET payment_status='paid' WHERE id=?").run(order)
 const prepare=(query:string):Statement=>{let args:(string|number|null)[]=[];return{bind(...v){args=v;return this},async first<T>(){return(sql.prepare(query).get(...args)??null)as T|null},async all<T>(){const results=sql.prepare(query).all(...args)as T[];const changes=Number((sql.prepare('SELECT changes() AS n').get() as {n:number})?.n??0);return{success:true,results,meta:{changes,last_row_id:0}}},async run(){return this.all()}}}
 const db:Database={prepare,async batch(queries){sql.exec('BEGIN');try{const r=[];for(const q of queries)r.push(await q.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}},async exec(q){sql.exec(q)}};env.DB=db
 return{sql,env}
}
function happy(url:unknown,init?:RequestInit){if(init?.method==='POST')return Response.json({success:true,data:{order_id:123,accounts:['licensed-activation-token'],amount_ngn:250}});assert.match(String(url),/\/listings\/subscription-test$/);return Response.json({success:true,data:{id:12,slug:'subscription-test',price_ngn:'250.00',available_stock:4}})}
test('verified payment automatically purchases once, delivers to dashboard and queues one email',async t=>{
 const{sql,env}=await fixture();t.after(()=>sql.close());let buys=0
 t.mock.method(globalThis,'fetch',async(url,init)=>{if(init?.method==='POST'){buys++;assert.equal(new Headers(init.headers).get('X-API-Key'),key);assert.deepEqual(JSON.parse(String(init.body)),{slug:'subscription-test',quantity:1})}return happy(url,init)})
 await Promise.all([runFulfillment(env),runFulfillment(env)])
 await runFulfillment(env)
 assert.equal(buys,1);assert.equal(sql.prepare('SELECT fulfillment_status FROM orders').get()!.fulfillment_status,'delivered')
 assert.equal(sql.prepare('SELECT instructions FROM product_entitlements').get()!.instructions,'licensed-activation-token')
 assert.equal(sql.prepare("SELECT count(*) n FROM business_mail_events WHERE kind='order_delivered'").get()!.n,1)
 assert.equal(sql.prepare('SELECT price_minor FROM products').get()!.price_minor,45000)
})
test('verified payment with integer evidence flags (delivery: 1, privacy: 1, provider: 1) fulfills seamlessly',async t=>{
 const{sql,env}=await fixture();t.after(()=>sql.close());let buys=0
 sql.prepare("UPDATE product_authorizations SET evidence=? WHERE product_id=?").run(JSON.stringify({delivery:1,privacy:1,provider:1,reference:'YoungPG authorized reseller permission'}),product)
 t.mock.method(globalThis,'fetch',async(url,init)=>{if(init?.method==='POST'){buys++;assert.equal(new Headers(init.headers).get('X-API-Key'),key);assert.deepEqual(JSON.parse(String(init.body)),{slug:'subscription-test',quantity:1})}return happy(url,init)})
 await runFulfillment(env)
 assert.equal(buys,1);assert.equal(sql.prepare('SELECT fulfillment_status FROM orders').get()!.fulfillment_status,'delivered')
 assert.equal(sql.prepare('SELECT instructions FROM product_entitlements').get()!.instructions,'licensed-activation-token')
 assert.equal(sql.prepare("SELECT count(*) n FROM business_mail_events WHERE kind='order_delivered'").get()!.n,1)
})
test('unpaid orders, disabled suppliers and revoked rights never purchase',async t=>{
 for(const reason of ['unpaid','disabled','rights']){const{sql,env}=await fixture(reason!=='unpaid');try{
  if(reason==='disabled')sql.exec('UPDATE staging_supplier_connections SET enabled=0')
  if(reason==='rights')sql.exec('UPDATE products SET authorized_resale=0,status=\'inactive\'')
  const f=t.mock.method(globalThis,'fetch',async()=>{throw Error('must not call')});await runFulfillment(env);assert.equal(f.mock.callCount(),0)
  assert.equal(sql.prepare('SELECT count(*) n FROM product_entitlements').get()!.n,0)
  f.mock.restore()
 }finally{sql.close()}}
})
test('non-idempotent supplier timeout never repeats a purchase, including admin retries',async t=>{
 const{sql,env}=await fixture();t.after(()=>sql.close());let buys=0
 t.mock.method(globalThis,'fetch',async(url,init)=>{if(init?.method==='POST'){buys++;throw Error('ambiguous timeout')}return happy(url,init)})
 await runFulfillment(env);await runFulfillment(env);await fulfillPaidOrder(env,order)
 assert.equal(buys,1);assert.equal(sql.prepare('SELECT state FROM fulfillment_jobs').get()!.state,'uncertain')
 assert.equal(sql.prepare('SELECT count(*) n FROM product_entitlements').get()!.n,0)
})
test('supplier cost increases block purchase without altering customer payment',async t=>{
 const{sql,env}=await fixture();t.after(()=>sql.close());let buys=0
 t.mock.method(globalThis,'fetch',async(_url,init)=>{if(init?.method==='POST')buys++;return Response.json({success:true,data:{id:12,slug:'subscription-test',price_ngn:'500.00',available_stock:1}})})
 await runFulfillment(env);assert.equal(buys,0);assert.equal(sql.prepare('SELECT state FROM fulfillment_jobs').get()!.state,'blocked')
 assert.equal(sql.prepare('SELECT total_minor FROM orders').get()!.total_minor,45000)
})
test('currency conversion is decimal-safe and refuses missing rates',()=>{
 assert.equal(deliveryCostMinor('0.29',3,'NGN'),87);assert.equal(deliveryCostMinor('0.20',1,'USD','1500'),30000)
 assert.equal(deliveryCostMinor('0.001',1,'NGN'),1)
 assert.throws(()=>deliveryCostMinor('1',1,'USD'),/fresh verified/)
})
test('delivered-content emails escape HTML, retain plaintext and reject unpaid delivery claims',()=>{
 const data={paymentStatus:'paid',fulfillmentStatus:'delivered',deliveryInstructions:'activation <script>alert(1)</script>\nsecond line'}
 const mail=renderEmail('order_delivered',data);assert.match(mail.html,/&lt;script&gt;/);assert.doesNotMatch(mail.html,/<script>/);assert.match(mail.text,/second line/)
 assert.throws(()=>renderEmail('order_delivered',{...data,paymentStatus:'pending'}),/Verified delivered/)
 assert.doesNotMatch(renderEmail('purchase_success',data).text,/activation/)
})
test('HStora purchases sign the exact POST body and use a stable idempotency key',async t=>{
 const creds={key:'hs_pk_testkey',secret:'hs_sk_testsecret'},ref='delivery_test_123',calls:string[]=[]
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push(String(url));if(init?.method!=='POST')return Response.json({success:true,data:{id:12,price:'250',currency:'NGN',stock_available:2}})
  const h=new Headers(init.headers);assert.equal(h.get('Idempotency-Key'),ref)
  const raw=String(init.body);assert.deepEqual(JSON.parse(raw),{product_id:12,quantity:1,external_order_id:ref})
  const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))).toString('hex')
  const canonical=['POST','/api/v1/orders','',h.get('X-Timestamp'),h.get('X-Nonce'),digest].join('\n')
  const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(creds.secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  assert.equal(h.get('X-Signature'),Buffer.from(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(canonical))).toString('hex'))
  return Response.json({success:true,data:{id:123,external_order_id:ref,quantity:1,status:'delivered',delivery:{available:true,items:['licensed-code']}}})
 })
 const plan=await prepareDelivery('hstora',creds,{externalId:'12',quantity:1,requestId:ref,maxCostMinor:45000})
 assert.equal((await plan.buy()).delivered,true);assert.equal(calls.length,2)
})
test('ShopViaClone22 purchases and polling deliver credentials to vault',async t=>{
 const creds={apiKey:'shopvia_test_key',baseUrl:'https://shopviaclone22.com/api'}
 const ref='req_shopvia_123'
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  const u=new URL(String(url))
  if(init?.method==='POST'){
   assert.equal(u.pathname,'/api/buy_product')
   const body=new URLSearchParams(String(init.body))
   assert.equal(body.get('api_key'),'shopvia_test_key')
   assert.equal(body.get('product'),'s3_prod_99')
   assert.equal(body.get('amount'),'1')
   assert.equal(body.get('custom_order_id'),ref)
   return Response.json({status:'success',order_id:'ord_s3_55',code:'PROMO-CRED-789'})
  }
  assert.equal(u.pathname,'/api/product.php')
  return Response.json({product:{id:'s3_prod_99',price:'1.50',currency:'USD',amount:10}})
 })
 const plan=await prepareDelivery('shopviaclone22',creds,{externalId:'s3_prod_99',quantity:1,requestId:ref,maxCostMinor:450000,fxRate:'1500'})
 const delivery=await plan.buy()
 assert.equal(delivery.receipt,'ord_s3_55')
 assert.equal(delivery.delivered,true)
 assert.deepEqual(delivery.items,['PROMO-CRED-789'])
})
test('DigitalCore purchases and polling deliver credentials to vault',async t=>{
 const creds={apiKey:'dc_test_key',baseUrl:'https://digitalcore.top'}
 const ref='req_dc_123'
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  const u=new URL(String(url))
  if(init?.method==='POST'){
   assert.equal(u.pathname,'/api/user/buy')
   assert.equal(new Headers(init.headers).get('Api-Key'),'dc_test_key')
   const body=JSON.parse(String(init.body))
   assert.deepEqual(body,{id:'dc_prod_44',count:1})
   return Response.json({success:true,order_id:'ord_dc_77',quantity:1,items:['digitalcore:access:credential']})
  }
  assert.equal(u.pathname,'/api/user/product')
  return Response.json({id:'dc_prod_44',price:'2.00',stock:5})
 })
 const plan=await prepareDelivery('digitalcore',creds,{externalId:'dc_prod_44',quantity:1,requestId:ref,maxCostMinor:450000,fxRate:'1500'})
 const delivery=await plan.buy()
 assert.equal(delivery.receipt,'ord_dc_77')
 assert.equal(delivery.delivered,true)
 assert.deepEqual(delivery.items,['digitalcore:access:credential'])
})
test('internal fulfillment endpoint rejects unauthenticated access and non-POST methods',async t=>{
 const{sql,env}=await fixture();t.after(()=>sql.close())
 const getReq=new Request('https://staging.test/api/internal/fulfillment',{method:'GET'})
 const getRes=await apiFetch(getReq,env)
 assert.equal(getRes.status,405)

 const anonReq=new Request('https://staging.test/api/internal/fulfillment',{method:'POST'})
 const anonRes=await apiFetch(anonReq,env)
 assert.equal(anonRes.status,401)

 const badReq=new Request('https://staging.test/api/internal/fulfillment',{method:'POST',headers:{Authorization:'Bearer invalid-secret'}})
 const badRes=await apiFetch(badReq,env)
 assert.equal(badRes.status,401)
})
test('internal fulfillment endpoint with valid auth rejects unpaid orders and fulfills paid orders',async t=>{
 const{sql,env}=await fixture(false);t.after(()=>sql.close());let buys=0
 t.mock.method(globalThis,'fetch',async(url,init)=>{if(init?.method==='POST')buys++;return happy(url,init)})

 const unpaidReq=new Request(`https://staging.test/api/internal/fulfillment?order_id=${order}`,{method:'POST',headers:{Authorization:`Bearer ${env.AUTH_SECRET}`}})
 const unpaidRes=await apiFetch(unpaidReq,env)
 assert.equal(unpaidRes.status,200)
 const unpaidBody=await unpaidRes.json()
 assert.equal(unpaidBody.success,false)
 assert.equal(unpaidBody.delivered,false)
 assert.match(unpaidBody.errors[0],/Order payment not confirmed/)
 assert.equal(buys,0)
 assert.equal(sql.prepare('SELECT count(*) n FROM product_entitlements').get()!.n,0)

 sql.prepare("UPDATE orders SET payment_status='paid' WHERE id=?").run(order)
 sql.prepare("UPDATE bachs_payment_attempts SET status='paid' WHERE id=?").run(attempt)

 const paidReq=new Request(`https://staging.test/api/internal/fulfillment?order_id=${order}`,{method:'POST',headers:{Authorization:`Bearer ${env.AUTH_SECRET}`}})
 const paidRes=await apiFetch(paidReq,env)
 assert.equal(paidRes.status,200)
 const paidBody=await paidRes.json()
 assert.equal(paidBody.success,true)
 assert.equal(paidBody.delivered,true)
 assert.equal(buys,1)
 assert.equal(sql.prepare('SELECT fulfillment_status FROM orders').get()!.fulfillment_status,'delivered')
 assert.equal(sql.prepare('SELECT instructions FROM product_entitlements').get()!.instructions,'licensed-activation-token')
})


test('only a matching completed wallet debit authorizes fulfillment, with no Bachs payment attempt',async t=>{
 const {sql,env}=await fixture(false);t.after(()=>sql.close());let buys=0
 t.mock.method(globalThis,'fetch',async(url,init)=>{if(init?.method==='POST')buys++;return happy(url,init)})
 sql.exec(readFileSync(new URL('../workers/api/migrations/0026_customer_wallet_system.sql',import.meta.url),'utf8'))
 sql.prepare('DELETE FROM bachs_payment_attempts WHERE id=?').run(attempt)
 sql.prepare("UPDATE orders SET payment_method='wallet',payment_status='paid' WHERE id=?").run(order)
 sql.prepare("INSERT OR IGNORE INTO fulfillment_jobs(order_item_id,order_id,request_id,created_at,updated_at) VALUES(?,?,?,1,1)").run(item,order,'delivery_'+item)
 await runFulfillment(env);assert.equal(buys,0)
 const wallet=sql.prepare('SELECT id FROM wallets WHERE customer_id=?').get(user)!
 sql.prepare(`INSERT INTO wallet_transactions(id,wallet_id,customer_id,reference,type,direction,amount_minor,balance_before_minor,balance_after_minor,status,order_id,created_at) VALUES(?,?,?,'TX-ORD-wallet-test','purchase','debit',45000,45000,0,'completed',?,1)`).run(crypto.randomUUID(),wallet.id,user,order)
 await runFulfillment(env);await runFulfillment(env)
 assert.equal(buys,1);assert.equal(sql.prepare('SELECT fulfillment_status FROM orders WHERE id=?').get(order)!.fulfillment_status,'delivered')
})

test('admin override fulfills order when supplier price increased',async t=>{
 const{sql,env}=await fixture();t.after(()=>sql.close());let buys=0
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(init?.method==='POST'){buys++;return happy(url,init)}
  return Response.json({success:true,data:{id:12,slug:'subscription-test',price_ngn:'500.00',available_stock:5}})
 })
 await runFulfillment(env)
 assert.equal(buys,0)
 assert.equal(sql.prepare('SELECT state FROM fulfillment_jobs').get()!.state,'blocked')

 const res=await fulfillPaidOrder(env,order,{adminOverride:true})
 assert.equal(res.success,true)
 assert.equal(buys,1)
 assert.equal(sql.prepare('SELECT fulfillment_status FROM orders').get()!.fulfillment_status,'delivered')
 assert.equal(sql.prepare('SELECT instructions FROM product_entitlements').get()!.instructions,'licensed-activation-token')
})

test('stale FX rate falls back to configured usd_to_ngn_rate without blocking USD fulfillment',async t=>{
 const creds={apiKey:'dc_test_key',baseUrl:'https://digitalcore.top'}
 const ref='req_dc_stale_fx'
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  const u=new URL(String(url))
  if(init?.method==='POST'){
   return Response.json({success:true,order_id:'ord_dc_88',quantity:1,items:['dc:credential:fallback']})
  }
  return Response.json({id:'dc_prod_44',price:'2.00',stock:5})
 })
 // When fxRate is passed with fallback '1400.0'
 const plan=await prepareDelivery('digitalcore',creds,{externalId:'dc_prod_44',quantity:1,requestId:ref,maxCostMinor:450000,fxRate:'1400.0'})
 const delivery=await plan.buy()
 assert.equal(delivery.receipt,'ord_dc_88')
 assert.equal(delivery.delivered,true)
})

test('DigitalCore JSON-serialized credentials are parsed safely and send genuine Api-Key header', async t => {
 const jsonCreds = { apiKey: JSON.stringify({ apiKey: 'dc_genuine_key_999', baseUrl: 'https://digitalcore.top' }), baseUrl: 'https://digitalcore.top' }
 const ref = 'req_dc_json_test'
 let capturedKey = ''
 let preflightKey = ''
 t.mock.method(globalThis, 'fetch', async (url, init) => {
  const u = new URL(String(url))
  const key = new Headers(init?.headers).get('Api-Key')
  if (init?.method === 'POST') {
   capturedKey = key ?? ''
   return Response.json({ success: true, order_id: 'ord_dc_json_1', quantity: 1, items: ['dc:access:token'] })
  }
  preflightKey = key ?? ''
  return Response.json({ id: 'dc_prod_json', price: '1.00', stock: 10 })
 })
 const plan = await prepareDelivery('digitalcore', jsonCreds, { externalId: 'dc_prod_json', quantity: 1, requestId: ref, maxCostMinor: 450000, fxRate: '1500' })
 const delivery = await plan.buy()
 assert.equal(delivery.receipt, 'ord_dc_json_1')
 assert.equal(delivery.delivered, true)
 assert.equal(preflightKey, 'dc_genuine_key_999')
 assert.equal(capturedKey, 'dc_genuine_key_999')
 assert.doesNotMatch(preflightKey, /^\{/)
 assert.doesNotMatch(capturedKey, /^\{/)
})

test('DigitalCore rejects unverified baseUrl host origins', async t => {
 const badCreds = { apiKey: 'dc_key', baseUrl: 'https://evil-phishing-host.com' }
 await assert.rejects(
  () => prepareDelivery('digitalcore', badCreds, { externalId: 'dc_prod', quantity: 1, requestId: 'test', maxCostMinor: 100000 }),
  /DigitalCore purchase host is not verified/
 )
})

test('DigitalCore strictly blocks Gemini Pro 18 Months if price exceeds $0.90 USD', async t => {
 const creds = { apiKey: 'dc_key', baseUrl: 'https://digitalcore.top' }
 t.mock.method(globalThis, 'fetch', async () => {
  return Response.json({ id: 'gemini_pro_18_months', price: '1.20', stock: 10 })
 })
 await assert.rejects(
  () => prepareDelivery('digitalcore', creds, { externalId: 'gemini_pro_18_months', quantity: 1, requestId: 'req_gp_test', maxCostMinor: 500000, fxRate: '1400' }),
  /Supplier wholesale price \(\$1.20 USD\) exceeds authorized limit of \$0.90 USD/
 )
})

test('DigitalCore permits Gemini Pro 18 Months when price is $0.90 USD', async t => {
 const creds = { apiKey: 'dc_key', baseUrl: 'https://digitalcore.top' }
 t.mock.method(globalThis, 'fetch', async (url, init) => {
  if (init?.method === 'POST') {
   return Response.json({ success: true, order_id: 'ord_gp_pass', quantity: 1, items: ['gemini:pro:license'] })
  }
  return Response.json({ id: 'gemini_pro_18_months', price: '0.90', stock: 10 })
 })
 const plan = await prepareDelivery('digitalcore', creds, { externalId: 'gemini_pro_18_months', quantity: 1, requestId: 'req_gp_test', maxCostMinor: 250000, fxRate: '1400' })
 const delivery = await plan.buy()
 assert.equal(delivery.receipt, 'ord_gp_pass')
 assert.equal(delivery.delivered, true)
 assert.deepEqual(delivery.items, ['gemini:pro:license'])
})
