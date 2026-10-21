import type {ApiEnv} from './types.ts'
import {openCredential} from '../../server/supplier-crypto.ts'
import {prepareDelivery,DeliveryError,type DeliveryProvider} from '../../server/supplier-delivery.ts'
import {drainBusinessMail,drainMail} from './mail.ts'
import {parseDeliveryCredentials} from '../../src/lib/delivery-parser.ts'

export interface FulfillmentResult{success:boolean;delivered:boolean;fulfilledItems:number;totalItems:number;errors:string[]}
type Job={order_item_id:string;order_id:string;request_id:string;provider:string|null;external_id:string|null;receipt:string|null;state:string;attempts:number;last_error:string|null}
type Item={product_id:string;product_name:string;quantity:number;unit_price_minor:number;customer_id:string;authorized_resale:number;evidence:string|null}
type Target={provider:string;external_id:string;enabled:number;approval:string;ciphertext:string;nonce:string;scope:string;slug:string|null;query:string}
const active=(env:ApiEnv)=>env.AUTO_FULFILLMENT_ENABLED==='true'&&['production','staging'].includes(env.ENVIRONMENT)
const paidSQL=`EXISTS(SELECT 1 FROM orders o JOIN bachs_payment_attempts a ON a.order_id=o.id
 WHERE o.id=fulfillment_jobs.order_id AND o.payment_status='paid' AND a.status='paid'
 AND a.amount_minor=o.total_minor AND a.currency=o.currency AND a.provider_mode=?)`

async function target(env:ApiEnv,productId:string):Promise<Target>{
 const db=env.DB!,all:Target[]=[]
 const queries=[
  `SELECT 'youngpg' provider,sp.external_id,c.enabled,f.approval,c.encrypted_key ciphertext,c.key_nonce nonce,c.id scope,COALESCE(json_extract(i.metadata,'$.slug'),(SELECT json_extract(metadata,'$.slug') FROM supplier_sync_items WHERE external_id=f.external_id ORDER BY rowid DESC LIMIT 1)) slug FROM supplier_products sp JOIN staging_supplier_connections c ON c.id=sp.connection_id JOIN staging_supplier_feed_items f ON f.connection_id=sp.connection_id AND f.external_id=sp.external_id LEFT JOIN supplier_sync_items i ON i.job_id=f.snapshot_id AND i.external_id=f.external_id WHERE sp.product_id=? AND c.provider='youngpg' AND f.authorization_verified=1 AND EXISTS(SELECT 1 FROM json_each(c.authorized_products) r WHERE r.value=f.evidence_reference AND (r.key=f.external_id OR r.key='*' AND NOT EXISTS(SELECT 1 FROM json_each(c.authorized_products) explicit WHERE explicit.key=f.external_id)))`,
  `SELECT 'hstora' provider,h.external_id,c.enabled,h.approval_status approval,c.ciphertext,c.nonce,'hstora' scope,NULL slug FROM hstora_catalog_items h JOIN hstora_connection c ON c.id='hstora' WHERE h.product_id=?`,
  `SELECT 'digitalcore' provider,h.external_id,c.enabled,h.approval_status approval,c.ciphertext,c.nonce,'digitalcore' scope,NULL slug FROM digitalcore_catalog_items h JOIN digitalcore_connection c ON c.id='digitalcore' WHERE h.product_id=?`,
  `SELECT 'shopviaclone22' provider,h.external_id,c.enabled,h.approval_status approval,c.ciphertext,c.nonce,'shopviaclone22' scope,NULL slug FROM shopviaclone22_catalog_items h JOIN shopviaclone22_connection c ON c.id='shopviaclone22' WHERE h.product_id=?`
 ]
 for(const sql of queries){const result=await db.prepare(sql).bind(productId).all<Target>();all.push(...result.results.map(row=>({...row,query:sql})))}
 if(all.length!==1)throw new DeliveryError('Exactly one approved supplier mapping is required.')
 const found=all[0]
 if(found.enabled!==1||found.approval!=='approved')throw new DeliveryError('Supplier is disabled or product approval changed.')
 return found
}

/** One bounded, durable job. Non-idempotent requests are never blindly retried. */
export async function runFulfillment(env:ApiEnv,orderId?:string,adminOverride=false):Promise<void>{
 if(!active(env)||!env.DB)return
 const db=env.DB,now=Date.now(),owner=crypto.randomUUID(),mode=env.ENVIRONMENT==='production'?'live':'sandbox'
 const walletProof=Boolean(await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='wallet_transactions'").first())
 const paymentProof=walletProof?`(${paidSQL} OR EXISTS(SELECT 1 FROM orders o JOIN wallet_transactions t ON t.order_id=o.id JOIN wallets w ON w.id=t.wallet_id WHERE o.id=fulfillment_jobs.order_id AND o.payment_method='wallet' AND o.payment_status='paid' AND t.customer_id=o.customer_id AND w.customer_id=o.customer_id AND t.type='purchase' AND t.direction='debit' AND t.status='completed' AND t.amount_minor=o.total_minor AND o.currency='NGN'))`:paidSQL
 const completed=await db.prepare("SELECT o.id FROM orders o WHERE o.payment_status='paid' AND o.fulfillment_status<>'delivered' AND EXISTS(SELECT 1 FROM order_items i WHERE i.order_id=o.id) AND NOT EXISTS(SELECT 1 FROM order_items i WHERE i.order_id=o.id AND NOT EXISTS(SELECT 1 FROM product_entitlements e WHERE e.order_item_id=i.id)) LIMIT 1").first<{id:string}>()
 if(completed)await finish(env,completed.id)
 await db.prepare("UPDATE fulfillment_jobs SET state=CASE WHEN provider='hstora' THEN 'waiting' ELSE 'uncertain' END,last_error='Interrupted purchase; reconcile supplier order before retrying.',next_attempt=?,updated_at=? WHERE state='dispatched' AND lease_until<=?").bind(now+60000,now,now).run()
 const job=await db.prepare(`UPDATE fulfillment_jobs SET lease_owner=?,lease_until=?,updated_at=?,
 state=CASE WHEN state='waiting' THEN 'waiting' ELSE 'preparing' END,attempts=attempts+1
 WHERE order_item_id=(SELECT order_item_id FROM fulfillment_jobs WHERE ${paymentProof}
 AND ((state IN ('queued','retry','waiting','retry_approved') AND next_attempt<=? AND (lease_until IS NULL OR lease_until<=?)) OR (state='preparing' AND lease_until<=?))
 ${orderId?'AND order_id=?':''} ORDER BY created_at,order_item_id LIMIT 1) RETURNING *`).bind(owner,now+180000,now,mode,now,now,now,...(orderId?[orderId]:[])).first<Job>()
 if(!job)return
 let dispatched=false
 try{
  if(await db.prepare('SELECT 1 FROM product_entitlements WHERE order_item_id=?').bind(job.order_item_id).first()){
   await db.prepare("UPDATE fulfillment_jobs SET state='delivered',lease_owner=NULL,lease_until=NULL,last_error=NULL WHERE order_item_id=? AND lease_owner=?").bind(job.order_item_id,owner).run();await finish(env,job.order_id);return
  }
  const item=await db.prepare('SELECT i.product_id,i.product_name,i.quantity,i.unit_price_minor,o.customer_id,p.authorized_resale,a.evidence FROM order_items i JOIN orders o ON o.id=i.order_id JOIN products p ON p.id=i.product_id LEFT JOIN product_authorizations a ON a.product_id=p.id WHERE i.id=?').bind(job.order_item_id).first<Item>()
  if(!item||item.authorized_resale!==1)throw new DeliveryError('Product resale authorization is not verified.')
  let rights:Record<string,unknown>;try{rights=JSON.parse(item.evidence??'null')}catch{throw new DeliveryError('Product delivery evidence is invalid.')}
  const isOk=(v:unknown)=>v===true||v===1||v==='1'||v==='true'
  if(!rights||!isOk(rights.delivery)||!isOk(rights.privacy)||!isOk(rights.provider))throw new DeliveryError('Product delivery, privacy and payment-provider evidence must remain verified.')
  const mapping=await target(env,item.product_id)
  if(job.provider&&(job.provider!==mapping.provider||job.external_id!==mapping.external_id))throw new DeliveryError('Supplier mapping changed after purchase dispatch.','uncertain')
  if(!env.SUPPLIER_ENCRYPTION_KEY)throw new DeliveryError('Worker SUPPLIER_ENCRYPTION_KEY binding is missing.')
  const raw=await openCredential(mapping.ciphertext,mapping.nonce,mapping.scope,env.SUPPLIER_ENCRYPTION_KEY)
  const credentials=(mapping.provider==='youngpg'||mapping.provider==='shopviaclone22')?{key:raw,apiKey:raw}:JSON.parse(raw) as {apiKey?:string;key?:string;secret?:string;allowedOrigin?:string;baseUrl?:string}
  const fx=await db.prepare("SELECT usd_to_ngn_rate,fx_updated_at,fx_status FROM global_pricing_config WHERE id='global'").first<{usd_to_ngn_rate:number;fx_updated_at:number;fx_status:string}>().catch(()=>null)
  const recovering=job.state==='waiting'||Boolean(job.receipt)
  const resolvedFxRate=(fx&&Number(fx.usd_to_ngn_rate)>0)?String(fx.usd_to_ngn_rate):'1500.0'
  const isOverride=Boolean(adminOverride||job.last_error==='admin_override'||job.state==='retry_approved')
  const plan=await prepareDelivery(mapping.provider as DeliveryProvider,credentials,{externalId:mapping.external_id,slug:mapping.slug??undefined,quantity:item.quantity,requestId:job.request_id,maxCostMinor:isOverride?Math.max(item.quantity*item.unit_price_minor,100000000):item.quantity*item.unit_price_minor,recovering,adminOverride:isOverride,fxRate:resolvedFxRate})
  if(!recovering){
   const fence=await db.prepare(`UPDATE fulfillment_jobs SET state='dispatched',provider=?,external_id=?,updated_at=? WHERE order_item_id=? AND lease_owner=? AND state='preparing' AND lease_until>? AND ${paymentProof}
    AND EXISTS(SELECT 1 FROM products p JOIN product_authorizations a ON a.product_id=p.id WHERE p.id=? AND p.authorized_resale=1 AND a.evidence=?)
    AND EXISTS(SELECT 1 FROM (${mapping.query}) m WHERE m.provider=? AND m.external_id=? AND m.enabled=1 AND m.approval='approved' AND m.ciphertext=? AND m.nonce=?)
    AND NOT EXISTS(SELECT 1 FROM product_entitlements e WHERE e.order_item_id=fulfillment_jobs.order_item_id) RETURNING order_item_id`).bind(mapping.provider,mapping.external_id,Date.now(),job.order_item_id,owner,Date.now(),mode,item.product_id,item.evidence,item.product_id,mapping.provider,mapping.external_id,mapping.ciphertext,mapping.nonce).first()
   if(!fence)return
   job.provider=mapping.provider;job.external_id=mapping.external_id
   dispatched=true
  }
  const delivery=recovering?await plan.poll(job.receipt??''):await plan.buy()
  await db.prepare("UPDATE fulfillment_jobs SET receipt=?,state='waiting',provider=?,external_id=?,next_attempt=?,updated_at=? WHERE order_item_id=? AND lease_owner=?").bind(delivery.receipt,mapping.provider,mapping.external_id,Date.now()+60000,Date.now(),job.order_item_id,owner).run()
  if(delivery.delivered){
   // The payment fence and unique entitlement make repeats safe; supplier metadata is never customer content.
   const rawContent=delivery.items.join('\n')
   const structured=parseDeliveryCredentials(rawContent,item.product_name)
   const structuredJson=JSON.stringify(structured)
   const hasStructured=Boolean(await db.prepare("SELECT 1 FROM pragma_table_info('product_entitlements') WHERE name='structured_data'").first().catch(()=>null))
   const insertSql=hasStructured
    ? `INSERT INTO product_entitlements(id,order_item_id,instructions,structured_data) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM fulfillment_jobs WHERE order_item_id=? AND lease_owner=? AND ${paymentProof}) ON CONFLICT(order_item_id) DO NOTHING`
    : `INSERT INTO product_entitlements(id,order_item_id,instructions) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM fulfillment_jobs WHERE order_item_id=? AND lease_owner=? AND ${paymentProof}) ON CONFLICT(order_item_id) DO NOTHING`
   const insertArgs=hasStructured
    ? [crypto.randomUUID(),job.order_item_id,rawContent,structuredJson,job.order_item_id,owner,mode]
    : [crypto.randomUUID(),job.order_item_id,rawContent,job.order_item_id,owner,mode]
   await db.batch([
    db.prepare(insertSql).bind(...insertArgs),
    db.prepare("UPDATE fulfillment_jobs SET state='delivered',last_error=NULL,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE order_item_id=? AND lease_owner=? AND EXISTS(SELECT 1 FROM product_entitlements e WHERE e.order_item_id=fulfillment_jobs.order_item_id)").bind(Date.now(),job.order_item_id,owner)
   ])
   await finish(env,job.order_id)
  }else await db.prepare("UPDATE fulfillment_jobs SET lease_owner=NULL,lease_until=NULL,last_error='Supplier order is processing; awaiting genuine delivery content.' WHERE order_item_id=? AND lease_owner=?").bind(job.order_item_id,owner).run()
 }catch(error){
  let state:string=error instanceof DeliveryError?error.state:dispatched?'uncertain':'blocked'
  if(job.state==='waiting'||job.receipt)state='waiting'
  if(dispatched&&job.provider==='hstora'&&state==='uncertain')state='waiting'
  const message=error instanceof DeliveryError?error.message:'Credential/configuration or storage failure; no blind purchase retry.'
  await db.prepare('UPDATE fulfillment_jobs SET state=?,last_error=?,next_attempt=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE order_item_id=? AND lease_owner=?').bind(state,message,Date.now()+Math.min(1800000,60000*2**Math.min(job.attempts,5)),Date.now(),job.order_item_id,owner).run()
 }
}
async function finish(env:ApiEnv,orderId:string){
 const db=env.DB!
 await db.batch([
  db.prepare("UPDATE orders SET fulfillment_status='delivered',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND payment_status='paid' AND EXISTS(SELECT 1 FROM order_items WHERE order_id=orders.id) AND NOT EXISTS(SELECT 1 FROM order_items i WHERE i.order_id=orders.id AND NOT EXISTS(SELECT 1 FROM product_entitlements e WHERE e.order_item_id=i.id))").bind(orderId),
  db.prepare("INSERT INTO business_mail_events(id,kind,user_id,created_at) SELECT id||':order_delivered','order_delivered',customer_id,? FROM orders WHERE id=? AND payment_status='paid' AND fulfillment_status='delivered' ON CONFLICT(id) DO NOTHING").bind(Date.now(),orderId)
 ])
 await drainBusinessMail(env).catch(()=>undefined)
 await drainMail(env).catch(()=>undefined)
}
/** Existing admin action reuses the same queue and purchase fences. */
export async function fulfillPaidOrder(env:ApiEnv,orderId:string,options?:{adminOverride?:boolean}):Promise<FulfillmentResult>{
 if(!env.DB)return{success:false,delivered:false,fulfilledItems:0,totalItems:0,errors:['Database unavailable.']}
 const db=env.DB
 const order=await db.prepare('SELECT id, customer_id, reference, payment_status, fulfillment_status FROM orders WHERE id=?').bind(orderId).first<{id:string;customer_id:string;reference:string;payment_status:string;fulfillment_status:string}>()
 if(!order)return{success:false,delivered:false,fulfilledItems:0,totalItems:0,errors:['Order not found.']}
 if(order.payment_status!=='paid')return{success:false,delivered:false,fulfilledItems:0,totalItems:0,errors:[`Order payment not confirmed (current status: ${order.payment_status}). Supplier fulfillment blocked.`]}
 if(order.fulfillment_status==='delivered')return{success:true,delivered:true,fulfilledItems:0,totalItems:0,errors:[]}
 if(!active(env))return{success:false,delivered:false,fulfilledItems:0,totalItems:0,errors:['Automatic fulfillment is disabled.']}
 await db.prepare(`INSERT OR IGNORE INTO fulfillment_jobs(order_item_id,order_id,request_id,created_at,updated_at)
  SELECT i.id,i.order_id,'delivery_'||i.id,?,?
  FROM order_items i WHERE i.order_id=? AND NOT EXISTS(SELECT 1 FROM product_entitlements e WHERE e.order_item_id=i.id)`).bind(Date.now(),Date.now(),orderId).run().catch(()=>undefined)
 await db.prepare("UPDATE fulfillment_jobs SET state='queued',next_attempt=0,last_error=NULL WHERE order_id=? AND state='blocked'").bind(orderId).run().catch(()=>undefined)
 await runFulfillment(env,orderId,options?.adminOverride)
 await drainBusinessMail(env).catch(()=>undefined)
 await drainMail(env).catch(()=>undefined)
 const updated=await db.prepare('SELECT fulfillment_status FROM orders WHERE id=?').bind(orderId).first<{fulfillment_status:string}>()
 const counts=await db.prepare('SELECT count(*) total_items,sum(EXISTS(SELECT 1 FROM product_entitlements e WHERE e.order_item_id=i.id)) fulfilled FROM order_items i WHERE order_id=?').bind(orderId).first<{total_items:number;fulfilled:number}>()
 const errors=await db.prepare("SELECT DISTINCT last_error FROM fulfillment_jobs WHERE order_id=? AND last_error IS NOT NULL AND state<>'delivered'").bind(orderId).all<{last_error:string}>()
 return{success:updated?.fulfillment_status==='delivered',delivered:updated?.fulfillment_status==='delivered',fulfilledItems:counts?.fulfilled??0,totalItems:counts?.total_items??0,errors:errors.results.map(e=>e.last_error)}
}
