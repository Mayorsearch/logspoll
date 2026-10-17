import {getBachsSession,verifyBachsWebhook} from '../../server/bachs.ts'
import {checkedPaidSandboxSession,parseNGNMinor} from '../../server/bachs-flow.ts'
import {HttpError,json} from './http.ts'
import {requireRuntime} from './runtime.ts'
import type {ApiEnv} from './types.ts'

type Attempt={id:string;order_id:string;customer_id?:string;checkout_id:string;provider_mode:string;amount_minor:number;status:string}
const supported=new Set(['checkout.completed','checkout.expired','collection.succeeded','collection.failed','collection.underpaid','refund.paid','refund.created','refund.failed'])

/** Signed events request reconciliation, never authorize fulfillment themselves. */
export async function bachsWebhook(request:Request,env:ApiEnv):Promise<Response>{
 try{
  if(request.method!=='POST')throw new HttpError(405,'POST required.')
  if(!env.BACHS_WEBHOOK_SECRET||!env.BACHS_API_KEY||!env.DB)throw new HttpError(503,'Payment verification is not configured.')
  const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Body required.')
  const parts:Uint8Array[]=[];let size=0
  while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>200000){await reader.cancel();throw new HttpError(413,'Webhook too large.')}parts.push(next.value)}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length}
  let raw:string;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{throw new HttpError(400,'Invalid webhook encoding.')}
  if(!await verifyBachsWebhook(raw,request.headers,env.BACHS_WEBHOOK_SECRET))throw new HttpError(401,'Invalid webhook signature.')
  let event:Record<string,unknown>;try{event=JSON.parse(raw)}catch{throw new HttpError(400,'Invalid webhook JSON.')}
  if(!event||Array.isArray(event)||typeof event.id!=='string'||!/^evt_[A-Za-z0-9_-]{5,140}$/.test(event.id)||typeof event.type!=='string')throw new HttpError(400,'Invalid webhook event.')
  if(!supported.has(event.type))return json({received:true,ignored:true})
  const data=event.data as Record<string,unknown>|null
  if(!data||typeof data!=='object'||Array.isArray(data))throw new HttpError(400,'Webhook data required.')
  const checkoutId=typeof data.checkout_id==='string'&&/^chk_[A-Za-z0-9_-]{6,100}$/.test(data.checkout_id)?data.checkout_id:null
  if(!checkoutId&&!event.type.startsWith('refund.'))throw new HttpError(400,'Checkout reference required.')
  await requireRuntime(env)
  const db=env.DB!,now=Date.now()
  if(!checkoutId){
   await db.prepare("INSERT INTO bachs_webhook_events(event_id,event_type,checkout_id,attempt_id,received_at,processing_status) VALUES(?,?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING").bind(event.id,event.type,null,null,now,'needs_review').run()
   return json({received:true,reviewRequired:true})
  }
  const existing=await db.prepare('SELECT checkout_id,event_type,processing_status FROM bachs_webhook_events WHERE event_id=?').bind(event.id).first<{checkout_id:string;event_type:string;processing_status:string}>()
  if(existing&&(existing.checkout_id!==checkoutId||existing.event_type!==event.type))throw new HttpError(409,'Event identity mismatch.')
  if(existing?.processing_status==='processed')return json({received:true,duplicate:true})
  let attempt=await db.prepare('SELECT id,order_id,customer_id,checkout_id,provider_mode,amount_minor,status FROM bachs_payment_attempts WHERE checkout_id=?').bind(checkoutId).first<Attempt>()
  const key=env.BACHS_API_KEY.trim(),mode=key.startsWith('sk_live_')?'live':key.startsWith('sk_sandbox_')?'sandbox':null
  if(!mode)throw new HttpError(503,'Payment verification is not configured.')
  if(attempt&&attempt.provider_mode!==mode)throw new HttpError(409,'Payment environment mismatch.')
  let verifiedSession:Record<string,unknown>|undefined
  if(!attempt){
   // Recover a created checkout whose response was interrupted before D1 saved its ID.
   // Only an authoritative, matching checkout can attach to an existing attempt.
   verifiedSession=await getBachsSession(key,checkoutId)
   const amount=parseNGNMinor(verifiedSession.amount)
   if((verifiedSession.checkout_id??verifiedSession.id)===data.checkout_id&&typeof verifiedSession.reference==='string'&&verifiedSession.currency==='NGN'&&amount!==null){
    const candidate=await db.prepare("SELECT id FROM bachs_payment_attempts WHERE order_id=? AND provider_mode=? AND amount_minor=? AND checkout_id IS NULL AND status='initiating'").bind(verifiedSession.reference,mode,amount).first<{id:string}>()
    if(candidate){
     await db.prepare("UPDATE bachs_payment_attempts SET checkout_id=?,status='open',updated_at=? WHERE id=? AND checkout_id IS NULL AND status='initiating'").bind(checkoutId,now,candidate.id).run()
     attempt=await db.prepare('SELECT id,order_id,customer_id,checkout_id,provider_mode,amount_minor,status FROM bachs_payment_attempts WHERE id=? AND checkout_id=?').bind(candidate.id,checkoutId).first<Attempt>()
    }
   }
  }
  await db.prepare("INSERT INTO bachs_webhook_events(event_id,event_type,checkout_id,attempt_id,received_at,processing_status) VALUES(?,?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET attempt_id=COALESCE(bachs_webhook_events.attempt_id,excluded.attempt_id),processing_status=excluded.processing_status").bind(event.id,event.type,checkoutId,attempt?.id??null,now,attempt?'received':'needs_review').run()
  // Never create orders from unsolicited signed events or acknowledge payment as verified.
  if(!attempt)return json({received:true,reviewRequired:true})
  await reconcileBachsAttempt(env,attempt,event.id,event.type,verifiedSession)
  return json({received:true})
 }catch(error){return json({error:error instanceof HttpError?error.message:'Payment verification unavailable; delivery must retry.'},error instanceof HttpError?error.status:503)}
}

/** Shared by signed callbacks and authenticated order-status recovery. */
export async function reconcileBachsAttempt(env:ApiEnv,attempt:Attempt,eventId='',eventType='',verifiedSession?:Record<string,unknown>){
 const db=env.DB!,now=Date.now(),key=env.BACHS_API_KEY?.trim()??''
 if(attempt.provider_mode!==(key.startsWith('sk_live_')?'live':key.startsWith('sk_sandbox_')?'sandbox':null))throw new HttpError(503,'Payment environment mismatch.')
  const session=verifiedSession??await getBachsSession(key,attempt.checkout_id)
  const sessionId=session.checkout_id??session.id
  const matches=sessionId===attempt.checkout_id&&session.reference===attempt.order_id&&session.currency==='NGN'&&parseNGNMinor(session.amount)===attempt.amount_minor
  const refunded=matches&&(eventType==='refund.paid'||session.payment_status==='refunded'||session.status==='refunded')
  const paid=matches&&!refunded&&checkedPaidSandboxSession(session,attempt.checkout_id)
  const terminal=matches&&['expired','cancelled'].includes(String(session.status))
  let customerId = attempt.customer_id
  if(!customerId){
   const ord=await db.prepare('SELECT customer_id FROM orders WHERE id=?').bind(attempt.order_id).first<{customer_id:string}>().catch(()=>null)
   if(ord) customerId = ord.customer_id
  }
  const hasMail=Boolean(await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_mail_events'").first().catch(()=>null))
  if(refunded){
   const writes=[
    db.prepare("UPDATE bachs_payment_attempts SET status='needs_review',updated_at=? WHERE id=?").bind(now,attempt.id),
    db.prepare("UPDATE orders SET payment_status='refunded',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND payment_status='paid'").bind(attempt.order_id),
    db.prepare("UPDATE bachs_webhook_events SET processing_status='processed',processed_at=? WHERE event_id=?").bind(now,eventId),
   ]
   if(hasMail&&customerId) writes.push(db.prepare("INSERT INTO business_mail_events(id,kind,user_id,created_at) VALUES(?,'refund_completed',?,?) ON CONFLICT(id) DO NOTHING").bind(attempt.order_id+':refund_completed',customerId,now))
   await db.batch(writes)
  }else if(paid){
   const writes=[
    db.prepare(`UPDATE bachs_payment_attempts SET status='paid',updated_at=? WHERE id=? AND status IN ('initiating','open')
     AND EXISTS(SELECT 1 FROM orders o WHERE o.id=order_id AND o.payment_status='pending' AND o.currency='NGN' AND o.total_minor=amount_minor)
     AND EXISTS(SELECT 1 FROM order_items i WHERE i.order_id=bachs_payment_attempts.order_id)
     AND (SELECT sum(i.quantity*i.unit_price_minor) FROM order_items i WHERE i.order_id=bachs_payment_attempts.order_id)=amount_minor
     AND NOT EXISTS(SELECT 1 FROM order_items i WHERE i.order_id=bachs_payment_attempts.order_id AND NOT EXISTS(SELECT 1 FROM bachs_reservations r WHERE r.attempt_id=bachs_payment_attempts.id AND r.product_id=i.product_id AND r.quantity=i.quantity AND r.state='held'))`).bind(now,attempt.id),
    db.prepare("UPDATE bachs_reservations SET state='consumed' WHERE attempt_id=? AND state='held' AND EXISTS(SELECT 1 FROM bachs_payment_attempts a WHERE a.id=attempt_id AND a.status='paid')").bind(attempt.id),
    db.prepare("UPDATE orders SET payment_status='paid',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND payment_status='pending' AND EXISTS(SELECT 1 FROM bachs_payment_attempts a WHERE a.id=? AND a.order_id=orders.id AND a.status='paid')").bind(attempt.order_id,attempt.id),
    db.prepare("UPDATE bachs_webhook_events SET processing_status=CASE WHEN EXISTS(SELECT 1 FROM bachs_payment_attempts WHERE id=? AND status='paid') THEN 'processed' ELSE 'needs_review' END,processed_at=? WHERE event_id=?").bind(attempt.id,now,eventId),
   ]
   if(hasMail&&customerId) writes.push(db.prepare("INSERT INTO business_mail_events(id,kind,user_id,created_at) VALUES(?,'purchase_success',?,?) ON CONFLICT(id) DO NOTHING").bind(attempt.order_id+':purchase_success',customerId,now))
   await db.batch(writes)
  }else if(terminal){
   const writes=[
    db.prepare("UPDATE bachs_payment_attempts SET status='expired',updated_at=? WHERE id=? AND status IN ('initiating','open')").bind(now,attempt.id),
    db.prepare("UPDATE bachs_reservations SET state='released' WHERE attempt_id=? AND state='held' AND EXISTS(SELECT 1 FROM bachs_payment_attempts a WHERE a.id=attempt_id AND a.status='expired')").bind(attempt.id),
    db.prepare("UPDATE orders SET payment_status='failed' WHERE id=? AND payment_status='pending' AND EXISTS(SELECT 1 FROM bachs_payment_attempts WHERE id=? AND status='expired')").bind(attempt.order_id,attempt.id),
    db.prepare("UPDATE bachs_webhook_events SET processing_status='processed',processed_at=? WHERE event_id=?").bind(now,eventId),
   ]
   if(hasMail&&customerId) writes.push(db.prepare("INSERT INTO business_mail_events(id,kind,user_id,created_at) VALUES(?,'purchase_failed',?,?) ON CONFLICT(id) DO NOTHING").bind(attempt.order_id+':purchase_failed',customerId,now))
   await db.batch(writes)
  }else{
   // An open checkout may retry a failed payment; retain its reservation.
   const pending=matches&&session.status==='open'&&session.payment_status!=='succeeded'
   if(pending&&eventId&&eventType!=='collection.failed'&&eventType!=='collection.underpaid')throw new HttpError(503,'Payment status is not final; delivery must retry.')
   await db.prepare('UPDATE bachs_webhook_events SET processing_status=?,processed_at=? WHERE event_id=?').bind(pending&&eventType!=='collection.underpaid'?'processed':'needs_review',now,eventId).run()
  }
 return db.prepare('SELECT status FROM bachs_payment_attempts WHERE id=?').bind(attempt.id).first<{status:string}>()
}
