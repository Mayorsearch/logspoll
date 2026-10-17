import {adminActor,bodyJSON} from './admin.ts'
import {HttpError,json} from './http.ts'
import {requireRuntime} from './runtime.ts'
import {openCredential,sealCredential} from '../../server/supplier-crypto.ts'
import {readHstoraDetail,HstoraError} from '../../server/hstora.ts'
import type {ApiEnv,Statement} from './types.ts'
const supported=new Set(['product.created','product.updated','product.deleted','product.stock_changed','product.price_changed','product.tiers_changed'])
const terminal=new Set(['applied','unavailable','ignored_disabled','ignored_unsupported','ignored_test'])
const hex=(value:ArrayBuffer)=>Array.from(new Uint8Array(value),n=>n.toString(16).padStart(2,'0')).join('')
type Receipt={event_id:string;delivery_id:string;event_type:string;external_id:string|null;status:string}
async function signingSecret(env:ApiEnv){
 if(env.HSTORA_WEBHOOK_SECRET)return env.HSTORA_WEBHOOK_SECRET
 const row=await env.DB!.prepare("SELECT ciphertext,nonce FROM hstora_webhook_config WHERE id='hstora'").first<{ciphertext:string;nonce:string}>()
 if(!row)throw new HttpError(503,'HStora webhook signing secret is not configured.')
 return openCredential(row.ciphertext,row.nonce,'hstora:webhook',env.SUPPLIER_ENCRYPTION_KEY)
}
export async function verifyHstoraWebhook(request:Request,secret:string,now=Date.now()){
 const timestamp=request.headers.get('X-HStore-Webhook-Timestamp')??'',delivery=request.headers.get('X-HStore-Delivery-Id')??'',event=request.headers.get('X-HStore-Event-Id')??'',type=request.headers.get('X-HStore-Webhook-Event')??'',signature=request.headers.get('X-HStore-Webhook-Signature')??''
 if(request.headers.get('X-HStore-Signature-Version')!=='v1'||!/^\d{10}$/.test(timestamp)||Math.abs(now-Number(timestamp)*1000)>300000||!(/^[A-Za-z0-9_.:-]{1,190}$/).test(delivery)||!(/^[A-Za-z0-9_.:-]{1,190}$/).test(event)||!(/^[a-z][a-z0-9_.]{0,90}$/).test(type)||!(/^[a-f0-9]{64}$/).test(signature))throw new HttpError(401,'Invalid webhook authentication.')
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new HttpError(415,'JSON required.')
 const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Body required.')
 const chunks:Uint8Array[]=[];let size=0
 while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>131072){await reader.cancel();throw new HttpError(413,'Webhook too large.')}chunks.push(part.value)}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length}
 const hash=hex(await crypto.subtle.digest('SHA-256',bytes)),canonical=[timestamp,delivery,event,type,hash].join('\n')
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify'])
 const signatureBytes=Uint8Array.from(signature.match(/../g)!,value=>parseInt(value,16))
 if(!await crypto.subtle.verify('HMAC',key,signatureBytes,new TextEncoder().encode(canonical)))throw new HttpError(401,'Invalid webhook signature.')
 let body:Record<string,unknown>;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!body||typeof body!=='object'||Array.isArray(body))throw Error()}catch{throw new HttpError(400,'Invalid webhook JSON.')}
 if(body.id!==event||body.type!==type)throw new HttpError(400,'Webhook identity mismatch.')
 const product=(body.data as {product?:{id?:unknown}}|undefined)?.product,id=product?.id
 const external=id===undefined?null:String(id)
 if(supported.has(type)&&(!external||!(/^[1-9]\d{0,15}$/).test(external)||typeof id==='number'&&!Number.isSafeInteger(id)))throw new HttpError(400,'Invalid supplier product ID.')
 return {event,delivery,type,hash,external,livemode:body.livemode===true}
}
export async function hstoraWebhook(request:Request,env:ApiEnv){
 let retryAfter=30,acquired=false;let owner:string|undefined,verified:Awaited<ReturnType<typeof verifyHstoraWebhook>>|undefined
 try{
  if(request.method!=='POST')throw new HttpError(405,'POST required.')
  if(!request.headers.get('X-HStore-Webhook-Signature'))throw new HttpError(401,'Webhook signature required.')
  await requireRuntime(env);if(!env.DB)throw new HttpError(503,'Database binding unavailable.')
  const db=env.DB,now=Date.now();verified=await verifyHstoraWebhook(request,await signingSecret(env));const v=verified
  const previous=await db.prepare('SELECT event_id,delivery_id,event_type,external_id,status FROM hstora_webhook_events WHERE event_id=? OR delivery_id=?').bind(v.event,v.delivery).first<Receipt>()
  if(previous){if(previous.event_id!==v.event||previous.event_type!==v.type||previous.external_id!==v.external)throw new HttpError(409,'Webhook event identity conflict.');if(terminal.has(previous.status))return json({received:true,duplicate:true})}
  owner=crypto.randomUUID()
  const c=await db.prepare("UPDATE hstora_connection SET lease_owner=?,lease_until=? WHERE id='hstora' AND (lease_until IS NULL OR lease_until<=?) RETURNING enabled,revision,ciphertext,nonce,next_attempt").bind(owner,now+60000,now).first<{enabled:number;revision:number;ciphertext:string;nonce:string;next_attempt:number}>()
  if(!c)throw new HttpError(503,'Supplier configuration or synchronization lease unavailable; retry delivery.')
  acquired=true
  const duplicate=await db.prepare('SELECT status FROM hstora_webhook_events WHERE event_id=?').bind(v.event).first<{status:string}>()
  if(duplicate&&terminal.has(duplicate.status)){await db.prepare("UPDATE hstora_connection SET lease_owner=NULL,lease_until=NULL WHERE id='hstora' AND lease_owner=?").bind(owner).run();owner=undefined;return json({received:true,duplicate:true})}
  let status='applied',metadata:string|undefined
  if(!c.enabled)status='ignored_disabled'
  else if(!supported.has(v.type))status='ignored_unsupported'
  else if(env.ENVIRONMENT==='production'&&!v.livemode)status='ignored_test'
  else{
   if(c.next_attempt>Date.now()){retryAfter=Math.max(1,Math.ceil((c.next_attempt-Date.now())/1000));throw new HttpError(503,'Supplier cooldown active; retry delivery.')}
   const credentials=JSON.parse(await openCredential(c.ciphertext,c.nonce,'hstora',env.SUPPLIER_ENCRYPTION_KEY))
   try{const detail=await readHstoraDetail(credentials,v.external!);metadata=JSON.stringify({...detail,supplier_available:true,webhook_checked_at:Date.now()})}
   catch(error){if(error instanceof HstoraError&&[404,410].includes(error.status))status='unavailable';else throw error}
  }
  const checked=Date.now(),writes:Statement[]=[db.prepare("INSERT INTO hstora_sync_fences(owner,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM hstora_connection WHERE id='hstora' AND revision=? AND enabled=? AND lease_owner=? AND lease_until>?) THEN 1 ELSE 0 END").bind(owner,c.revision,c.enabled,owner,checked),db.prepare("INSERT INTO hstora_webhook_events(event_id,delivery_id,event_type,external_id,body_hash,received_at,processed_at,status) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET delivery_id=excluded.delivery_id,body_hash=excluded.body_hash,received_at=excluded.received_at,processed_at=excluded.processed_at,status=excluded.status,attempts=attempts+1,last_error=NULL WHERE hstora_webhook_events.status='retry'").bind(v.event,v.delivery,v.type,v.external,v.hash,checked,checked,status)]
  if(metadata){writes.push(db.prepare('INSERT INTO hstora_catalog_items(external_id,metadata,snapshot_id,checked_at) VALUES(?,?,?,?) ON CONFLICT(external_id) DO UPDATE SET metadata=excluded.metadata,snapshot_id=excluded.snapshot_id,checked_at=excluded.checked_at').bind(v.external!,metadata,'webhook:'+v.event,checked),db.prepare("UPDATE products SET supplier_image_urls=CASE WHEN json_array_length(json_extract(?,'$.images'))>0 THEN json_extract(?,'$.images') ELSE supplier_image_urls END WHERE id=(SELECT product_id FROM hstora_catalog_items WHERE external_id=?)").bind(metadata,metadata,v.external!))}
  if(status==='unavailable')writes.push(db.prepare("UPDATE hstora_catalog_items SET metadata=json_set(metadata,'$.supplier_available',json('false'),'$.webhook_checked_at',?),checked_at=0 WHERE external_id=?").bind(checked,v.external!),db.prepare("UPDATE products SET status='inactive',publication_verified=0 WHERE id=(SELECT product_id FROM hstora_catalog_items WHERE external_id=?)").bind(v.external!))
  writes.push(db.prepare('DELETE FROM hstora_sync_fences WHERE owner=?').bind(owner),db.prepare("UPDATE hstora_connection SET lease_owner=NULL,lease_until=NULL WHERE id='hstora' AND lease_owner=?").bind(owner))
  await db.batch(writes);owner=undefined;return json({received:true,status})
 }catch(error){
  const status=error instanceof HttpError?error.status:503,message=error instanceof HttpError||error instanceof HstoraError?error.message:'HStora webhook processing unavailable.'
  if(env.DB&&owner&&acquired){if(verified){const v=verified;await env.DB.prepare("INSERT INTO hstora_webhook_events(event_id,delivery_id,event_type,external_id,body_hash,received_at,status,last_error) VALUES(?,?,?,?,?,?,'retry',?) ON CONFLICT(event_id) DO UPDATE SET delivery_id=excluded.delivery_id,received_at=excluded.received_at,attempts=attempts+1,last_error=excluded.last_error WHERE hstora_webhook_events.status='retry'").bind(v.event,v.delivery,v.type,v.external,v.hash,Date.now(),message).run().catch(()=>{})}await env.DB.prepare("UPDATE hstora_connection SET lease_owner=NULL,lease_until=NULL,next_attempt=MAX(next_attempt,?) WHERE id='hstora' AND lease_owner=?").bind(error instanceof HstoraError?Date.now()+([401,403].includes(error.status)?3600000:error.retryAfterMs):0,owner).run().catch(()=>{})}
  const response=json({error:message},status);if(status===503)response.headers.set('Retry-After',String(error instanceof HstoraError?Math.ceil(error.retryAfterMs/1000):retryAfter));return response
 }
}
export async function hstoraWebhookAdmin(request:Request,env:ApiEnv){
 const actor=await adminActor(request,env);const db=env.DB!
 if(request.method==='GET'){
  const config=await db.prepare("SELECT updated_at FROM hstora_webhook_config WHERE id='hstora'").first(),events=await db.prepare('SELECT event_id,event_type,external_id,received_at,processed_at,status,attempts,last_error FROM hstora_webhook_events ORDER BY received_at DESC LIMIT 20').all()
  return json({configured:Boolean(env.HSTORA_WEBHOOK_SECRET||config),source:env.HSTORA_WEBHOOK_SECRET?'Cloudflare secret':'Encrypted D1',canRotate:!env.HSTORA_WEBHOOK_SECRET,endpoint:new URL('/api/webhooks/hstora',request.url).href,events:events.results})
 }
 if(request.method!=='POST')throw new HttpError(405,'Method not permitted.')
 if(env.HSTORA_WEBHOOK_SECRET)throw new HttpError(409,'Signing secret is managed in Cloudflare Pages Production bindings.')
 const body=await bodyJSON(request,2048);if(typeof body.webhook_secret!=='string'||!(/^[\x21-\x7e]{24,512}$/).test(body.webhook_secret)||/^hs_(?:pk|sk)_/.test(body.webhook_secret))throw new HttpError(400,'Enter the separate HStora webhook signing secret, at least 24 characters; not the API secret.')
 const sealed=await sealCredential(body.webhook_secret,'hstora:webhook',env.SUPPLIER_ENCRYPTION_KEY)
 await db.batch([db.prepare("INSERT INTO hstora_webhook_config(id,ciphertext,nonce,updated_at) VALUES('hstora',?,?,?) ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext,nonce=excluded.nonce,updated_at=excluded.updated_at").bind(sealed.ciphertext,sealed.nonce,Date.now()),db.prepare("INSERT INTO audit_logs(id,actor_id,table_name,record_id,action) VALUES(?,?,'hstora_webhook_config','hstora','UPDATE')").bind(crypto.randomUUID(),actor.id)])
 return json({saved:true})
}
