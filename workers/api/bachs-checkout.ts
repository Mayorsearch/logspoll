import {createBachsSession} from '../../server/bachs.ts'
import {HttpError,json} from './http.ts'
import {identity} from './auth.ts'
import {requireRuntime} from './runtime.ts'
import type {ApiEnv} from './types.ts'

type Item={id:string;quantity:number}
type Buyer={id:string;email:string}
type Attempt={id:string;order_id:string;provider_mode:'live'|'sandbox';amount_minor:number;idempotency_key:string;checkout_id:string|null;status:string}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function paymentMode(env:ApiEnv){
 const mode=env.ENVIRONMENT==='staging'?'sandbox':'live'
 if(mode==='sandbox'&&env.BACHS_SANDBOX_ENABLED!=='true')throw new HttpError(503,'Sandbox checkout is disabled.')
 if(mode==='live'&&(env.ENVIRONMENT!=='production'||env.BACHS_LIVE_CHECKOUT_ENABLED!=='true'||env.BACHS_LIVE_VERIFIED!=='true'||env.BACHS_FULFILLMENT_VERIFIED!=='true'))throw new HttpError(503,'Live checkout remains disabled pending verified payment and fulfillment checks.')
 if(!env.BACHS_API_KEY?.trim().startsWith(mode==='live'?'sk_live_':'sk_sandbox_')||!env.BACHS_WEBHOOK_SECRET)throw new HttpError(503,'Payment environment is not configured.')
 return mode
}

/** D1 batch rollback enforces all-or-nothing order creation and stock holds. */
export async function initiateCheckout(env:ApiEnv,buyer:Buyer,requestId:string,items:Item[],origin:string){
 const mode=paymentMode(env),db=env.DB!
 if(!uuid.test(requestId)||!items.length||items.length>20||items.some(i=>!i||!uuid.test(i.id)||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>1000)||new Set(items.map(i=>i.id)).size!==items.length)throw new HttpError(400,'Invalid checkout selection or request ID.')
 let attempt=await db.prepare('SELECT * FROM bachs_payment_attempts WHERE customer_id=? AND client_request_id=?').bind(buyer.id,requestId).first<Attempt>()
 if(attempt){
  const previous=await db.prepare('SELECT product_id AS id,quantity FROM order_items WHERE order_id=? ORDER BY product_id').bind(attempt.order_id).all<Item>()
  const sort=(list:Item[])=>JSON.stringify([...list].sort((a,b)=>a.id.localeCompare(b.id)).map(i=>[i.id,i.quantity]))
  if(sort(items)!==sort(previous.results)||attempt.provider_mode!==mode)throw new HttpError(409,'Idempotency request does not match the original checkout.')
 }else{
  const rows=await db.prepare(`SELECT p.id,p.name,p.price_minor,p.currency,c.name AS category_name FROM storefront_products p JOIN categories c ON c.id=p.category_id WHERE p.id IN (${items.map(()=>'?').join(',')})`).bind(...items.map(i=>i.id)).all<{id:string;name:string;price_minor:number;currency:string;category_name:string}>()
  if(rows.results.length!==items.length)throw new HttpError(409,'A product is unavailable.')
  const total=items.reduce((sum,i)=>sum+rows.results.find(p=>p.id===i.id)!.price_minor*i.quantity,0)
  if(!Number.isSafeInteger(total)||total<1||total>99999999900||rows.results.some(p=>p.currency!=='NGN'||p.price_minor<1))throw new HttpError(409,'Invalid product pricing.')
  const id=crypto.randomUUID(),order=crypto.randomUUID(),now=Date.now(),key='bachs_'+id
  const hasMail=Boolean(await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_mail_events'").first().catch(()=>null))
  const statements=[db.prepare('INSERT INTO orders(id,customer_id,reference,total_minor) VALUES(?,?,?,?)').bind(order,buyer.id,'LP-'+order,total),db.prepare('INSERT INTO bachs_payment_attempts(id,order_id,customer_id,client_request_id,idempotency_key,provider_mode,amount_minor,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,order,buyer.id,requestId,key,mode,total,now,now)]
  if(hasMail)statements.push(db.prepare("INSERT INTO business_mail_events(id,kind,user_id,created_at) VALUES(?,'order_placed',?,?) ON CONFLICT(id) DO NOTHING").bind(order+':order_placed',buyer.id,now))
  for(const item of items){const p=rows.results.find(p=>p.id===item.id)!
   statements.push(db.prepare('INSERT INTO order_items(id,order_id,product_id,product_name,category_name,quantity,unit_price_minor) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),order,p.id,p.name,p.category_name,item.quantity,p.price_minor))
   // Expiry alone never frees a hold: only verified terminal provider status does.
   statements.push(db.prepare(`INSERT INTO bachs_reservations(attempt_id,product_id,quantity,expires_at,created_at) VALUES(?,?,CASE WHEN EXISTS(SELECT 1 FROM storefront_products p WHERE p.id=? AND p.currency='NGN' AND p.price_minor=? AND p.available_quantity>=?+COALESCE((SELECT sum(r.quantity) FROM bachs_reservations r WHERE r.product_id=p.id AND r.state IN ('held','consumed')),0)) THEN ? ELSE 0 END,?,?)`).bind(id,p.id,p.id,p.price_minor,item.quantity,item.quantity,now+3600000,now))
  }
  try{await db.batch(statements)}catch{
   const concurrent=await db.prepare('SELECT id FROM bachs_payment_attempts WHERE customer_id=? AND client_request_id=?').bind(buyer.id,requestId).first()
   if(concurrent)return initiateCheckout(env,buyer,requestId,items,origin)
   throw new HttpError(409,'Stock or prices changed. No order or reservation was created.')
  }
  attempt={id,order_id:order,provider_mode:mode,amount_minor:total,idempotency_key:key,checkout_id:null,status:'initiating'}
 }
 if(!['initiating','open'].includes(attempt.status))return {orderId:attempt.order_id,status:attempt.status}
 // Every retry uses the same provider key. Ambiguous timeouts retain the hold.
 const session=await createBachsSession({key:env.BACHS_API_KEY!,amountMinor:attempt.amount_minor,buyerEmail:buyer.email,orderId:attempt.order_id,idempotencyKey:attempt.idempotency_key,successUrl:origin+'/dashboard?tab=orders',cancelUrl:origin+'/cart'},mode)
 if(attempt.checkout_id&&attempt.checkout_id!==session.checkoutId)throw new HttpError(503,'Provider checkout identity changed; manual reconciliation required.')
 await db.prepare("UPDATE bachs_payment_attempts SET checkout_id=?,status='open',updated_at=? WHERE id=? AND status IN ('initiating','open') AND (checkout_id IS NULL OR checkout_id=?)").bind(session.checkoutId,Date.now(),attempt.id,session.checkoutId).run()
 const saved=await db.prepare('SELECT checkout_id,status FROM bachs_payment_attempts WHERE id=?').bind(attempt.id).first<{checkout_id:string;status:string}>()
 if(saved?.checkout_id!==session.checkoutId||saved.status!=='open')return {orderId:attempt.order_id,status:saved?.status??'needs_review'}
 return {orderId:attempt.order_id,status:'open',checkoutId:session.checkoutId,checkoutUrl:session.checkoutUrl}
}

export async function bachsCheckout(request:Request,env:ApiEnv){
 try{
  if(request.method!=='POST')throw new HttpError(405,'POST required.')
  paymentMode(env)
  const origin=new URL(request.url).origin
  if(origin!==env.AUTH_ORIGIN)throw new HttpError(403,'Use the configured checkout origin.')
  if(request.headers.get('Origin')!==origin||!request.headers.get('Content-Type')?.startsWith('application/json'))throw new HttpError(403,'Same-origin JSON required.')
  await requireRuntime(env);const buyer=await identity(request,env)
  const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Body required.')
  let raw='',size=0;const decoder=new TextDecoder()
  while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>8192){await reader.cancel();throw new HttpError(413,'Checkout too large.')}raw+=decoder.decode(next.value,{stream:true})}raw+=decoder.decode()
  let body:{requestId:string;items:Item[]};try{body=JSON.parse(raw);if(!body||!Array.isArray(body.items))throw Error()}catch{throw new HttpError(400,'Invalid checkout JSON.')}
  return json(await initiateCheckout(env,buyer,body.requestId,body.items,origin))
 }catch(error){return json({error:error instanceof HttpError?error.message:'Checkout could not be confirmed. Retry with the same request ID.'},error instanceof HttpError?error.status:503)}
}
