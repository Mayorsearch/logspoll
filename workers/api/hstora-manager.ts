import {adminActor,bodyJSON} from './admin.ts'
import {HttpError,json} from './http.ts'
import {HttpError as CredentialError} from '../../server/auth.ts'
import {openCredential,sealCredential} from '../../server/supplier-crypto.ts'
import {HstoraError,hstoraHeaders,readHstoraPage,readHstoraDetail} from '../../server/hstora.ts'
import type {HstoraCredentials} from '../../server/hstora.ts'
import type {ApiEnv,Statement} from './types.ts'
type Connection={enabled:number;ciphertext:string;nonce:string;revision:number;requested:number;job_id:string|null;page:number;phase:string;total:number|null;next_attempt:number;last_success:number|null}
export async function hstoraAdmin(request:Request,env:ApiEnv){
 await adminActor(request,env);const db=env.DB!
 if(request.method==='GET'){
  const conn = await db.prepare("SELECT enabled,revision,requested,page,phase,total,scanned,next_attempt,last_success,last_status,lease_until,fx_rate_minor,(SELECT count(*) FROM hstora_catalog_items) AS imported,(SELECT count(*) FROM hstora_catalog_items WHERE json_array_length(json_extract(metadata,'$.images'))>0) AS with_images,(SELECT count(*) FROM hstora_catalog_items WHERE length(json_extract(metadata,'$.description'))>0) AS with_descriptions FROM hstora_connection WHERE id='hstora'").first<Record<string,unknown>>()
  let baseUrl = 'https://hstora.com'
  const row = await db.prepare("SELECT ciphertext, nonce FROM hstora_connection WHERE id='hstora'").first<{ciphertext:string;nonce:string}>()
  if (row?.ciphertext && row?.nonce && env.SUPPLIER_ENCRYPTION_KEY) {
    try {
      const creds = JSON.parse(await openCredential(row.ciphertext, row.nonce, 'hstora', env.SUPPLIER_ENCRYPTION_KEY)) as {baseUrl?:string}
      if (creds.baseUrl) baseUrl = creds.baseUrl
    } catch {}
  }
  return json({provider:'hstora',connection:conn ? {...conn, base_url: baseUrl} : null})
 }
 if(request.method!=='POST')throw new HttpError(405,'Method not permitted.')
 const body=await bodyJSON(request,4096),row=await db.prepare("SELECT * FROM hstora_connection WHERE id='hstora'").first<Connection>()
 if(body.action==='save'){
  let baseUrl = typeof body.base_url === 'string' && body.base_url.trim() ? body.base_url.trim().replace(/\/+$/, '') : 'https://hstora.com'
  if (!baseUrl.startsWith('https://') && !baseUrl.startsWith('http://localhost')) throw new HttpError(400, 'Base URL must use HTTPS.')
  if(body.fx_rate_minor!==undefined&&(!Number.isSafeInteger(body.fx_rate_minor)||Number(body.fx_rate_minor)<=0||Number(body.fx_rate_minor)>1000000000))throw new HttpError(400,'Invalid NGN exchange rate.')
  if(body.api_key!==undefined||body.api_secret!==undefined||body.base_url!==undefined){
   let key = typeof body.api_key === 'string' ? body.api_key.trim() : ''
   let secret = typeof body.api_secret === 'string' ? body.api_secret.trim() : ''
   if ((!key || !secret) && row?.ciphertext && row?.nonce && env.SUPPLIER_ENCRYPTION_KEY) {
    try {
      const old = JSON.parse(await openCredential(row.ciphertext, row.nonce, 'hstora', env.SUPPLIER_ENCRYPTION_KEY)) as HstoraCredentials
      if (!key) key = old.key
      if (!secret) secret = old.secret
      if (!body.base_url && old.baseUrl) baseUrl = old.baseUrl
    } catch {}
   }
   if (key && secret) {
    const credentials: HstoraCredentials = {key, secret, allowedOrigin:'https://logspoll.com', baseUrl}
    let sealed:Awaited<ReturnType<typeof sealCredential>>
    try{await hstoraHeaders(credentials,'/api/v1/catalog','page=1&limit=1');sealed=await sealCredential(JSON.stringify(credentials),'hstora',env.SUPPLIER_ENCRYPTION_KEY)}
    catch(error){if(error instanceof HstoraError)throw new HttpError(400,'Invalid HStora credential format. Enter the API key (hs_pk_) and API signing secret (hs_sk_), not the webhook secret.');if(error instanceof CredentialError)throw new HttpError(error.status,error.message);throw error}
    const nextEnabled = typeof body.enabled === 'boolean' ? (body.enabled ? 1 : 0) : (row?.enabled ?? 0)
    await db.prepare("INSERT INTO hstora_connection(id,ciphertext,nonce,enabled,fx_rate_minor) VALUES('hstora',?,?,?,?) ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext,nonce=excluded.nonce,enabled=excluded.enabled,fx_rate_minor=COALESCE(excluded.fx_rate_minor,hstora_connection.fx_rate_minor),revision=revision+1,lease_owner=NULL,lease_until=NULL,requested=0,phase='idle',job_id=NULL,page=1,total=NULL,scanned=0,last_status='Credentials saved; test connection'").bind(sealed.ciphertext,sealed.nonce,nextEnabled,body.fx_rate_minor===undefined?null:Number(body.fx_rate_minor)).run()
    return json({saved:true})
   } else if (!row) throw new HttpError(400, 'Enter API key and signing secret first.')
  }
  if(!row)throw new HttpError(400,'Configure HStora credentials first.')
  if(typeof body.enabled==='boolean')await db.prepare("UPDATE hstora_connection SET enabled=?,lease_owner=NULL,lease_until=NULL WHERE id='hstora'").bind(body.enabled?1:0).run()
  if(body.fx_rate_minor!==undefined)await db.prepare("UPDATE hstora_connection SET fx_rate_minor=? WHERE id='hstora'").bind(Number(body.fx_rate_minor)).run()
  return json({saved:true})
 }
 if(body.action==='toggle'){
  if(!row)throw new HttpError(400,'Configure HStora credentials first.')
  const nextEnabled = row.enabled ? 0 : 1
  await db.prepare("UPDATE hstora_connection SET enabled=?,lease_owner=NULL,lease_until=NULL WHERE id='hstora'").bind(nextEnabled).run()
  return json({saved:true, enabled:Boolean(nextEnabled)})
 }
 if(!row)throw new HttpError(409,'Configure HStora credentials first.')
 if(body.action==='test'){
  try{const credentials=JSON.parse(await openCredential(row.ciphertext,row.nonce,'hstora',env.SUPPLIER_ENCRYPTION_KEY)) as HstoraCredentials;const page=await readHstoraPage(credentials,1,1);return json({connected:true,total:page.total})}
  catch(error){if(error instanceof HstoraError){console.warn('hstora_test_failure',JSON.stringify({layer:'supplier',provider_status:error.status,error:error.message}));return json({error:error.message,layer:'supplier',provider_status:error.status,connected:false},424);}if(error instanceof CredentialError)throw new HttpError(error.status,error.message);throw error}
 }
 if(body.action==='sync'){
  if(!row.enabled)throw new HttpError(409,'Enable HStora first.')
  await db.prepare("UPDATE hstora_connection SET requested=1 WHERE id='hstora'").run();return json({queued:true,phase:row.phase,next_attempt:row.next_attempt,message:row.next_attempt>Date.now()?'Job queued; provider cooldown remains active. Progress is retained.':'Background job queued; awaiting the scheduler.'},202)
 }
 throw new HttpError(400,'Unknown supplier action.')
}
// Each cron invocation persists one bounded batch; browser lifetime is irrelevant.
export async function syncHstoraBatch(env:ApiEnv){
 if(env.CATALOG_SYNC_ENABLED!=='true'||!env.DB)return
 const db=env.DB,now=Date.now(),owner=crypto.randomUUID()
 const row=await db.prepare("UPDATE hstora_connection SET lease_owner=?,lease_until=? WHERE id='hstora' AND enabled=1 AND next_attempt<=? AND (EXISTS(SELECT 1 FROM hstora_catalog_items WHERE approval_status='approved' AND COALESCE(json_extract(metadata,'$.supplier_available'),1)<>0 AND checked_at<?) OR requested=1 OR phase IN('listings','details','finalize') OR last_success IS NOT NULL AND last_success<=?) AND (lease_until IS NULL OR lease_until<=?) RETURNING *").bind(owner,now+60000,now,now-1800000,now-43200000,now).first<Connection>()
 if(!row)return
 const fence=()=>db.prepare("INSERT INTO hstora_sync_fences(owner,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM hstora_connection WHERE id='hstora' AND enabled=1 AND revision=? AND lease_owner=? AND lease_until>?) THEN 1 ELSE 0 END").bind(owner,row.revision,owner,Date.now())
 async function commit(statements:Statement[]){await db.batch([fence(),...statements,db.prepare('DELETE FROM hstora_sync_fences WHERE owner=?').bind(owner),db.prepare("UPDATE hstora_connection SET lease_owner=NULL,lease_until=NULL WHERE id='hstora' AND lease_owner=?").bind(owner)])}
 try{
  const credentials=JSON.parse(await openCredential(row.ciphertext,row.nonce,'hstora',env.SUPPLIER_ENCRYPTION_KEY)) as HstoraCredentials
  const due=await db.prepare("SELECT external_id FROM hstora_catalog_items WHERE approval_status='approved' AND COALESCE(json_extract(metadata,'$.supplier_available'),1)<>0 AND checked_at<? ORDER BY checked_at LIMIT 5").bind(now-1800000).all<{external_id:string}>()
  if(due.results.length){const refreshed=await Promise.all(due.results.map(async item=>({...await readHstoraDetail(credentials,item.external_id),stock_checked_at:Date.now()})));await commit(refreshed.map(detail=>db.prepare('UPDATE hstora_catalog_items SET metadata=?,checked_at=? WHERE external_id=?').bind(JSON.stringify(detail),detail.stock_checked_at,detail.id)));return}
  const fresh=!row.job_id||['idle','complete'].includes(row.phase),job=fresh?crypto.randomUUID():row.job_id!,page=fresh?1:row.page
  if(fresh||row.phase==='listings'){
   const batch=await readHstoraPage(credentials,page,25)
   if(!fresh&&row.total!==batch.total){await commit([db.prepare("UPDATE hstora_connection SET phase='idle',job_id=NULL,page=1,total=NULL,scanned=0,requested=1,last_status='Supplier total changed; restarting private snapshot' WHERE id='hstora'")]);return}
   const writes=batch.items.map(item=>db.prepare('INSERT INTO hstora_snapshot_items(job_id,external_id,metadata) VALUES(?,?,?)').bind(job,item.id,JSON.stringify({...item,stock_checked_at:Date.now()})))
   writes.push(db.prepare("UPDATE hstora_connection SET job_id=?,page=?,total=?,scanned=?,phase=?,requested=0,last_status='Catalog batch saved' WHERE id='hstora'").bind(job,page+1,batch.total,Math.min(page*25,batch.total),batch.next_page===null?'details':'listings'))
   await commit(writes);return
  }
  if(row.phase==='details'){
   const items=await db.prepare('SELECT external_id,metadata FROM hstora_snapshot_items WHERE job_id=? AND detail_done=0 LIMIT 5').bind(job).all<{external_id:string;metadata:string}>()
   if(items.results.length){const details=await Promise.all(items.results.map(async item=>{const old=JSON.parse(item.metadata),detail=await readHstoraDetail(credentials,item.external_id);return {...old,...detail,description:detail.description||old.description,images:detail.images.length?detail.images:old.images,category:detail.category??old.category,stock_checked_at:Date.now()}}));await commit(details.map(detail=>db.prepare('UPDATE hstora_snapshot_items SET metadata=?,detail_done=1 WHERE job_id=? AND external_id=?').bind(JSON.stringify(detail),job,detail.id)));return}
   await commit([db.prepare("UPDATE hstora_connection SET phase='finalize' WHERE id='hstora'")]);return
  }
  if(row.phase==='finalize'){
   const count=await db.prepare('SELECT count(*) AS n FROM hstora_snapshot_items WHERE job_id=? AND detail_done=1').bind(job).first<{n:number}>()
   if(count?.n!==row.total)throw new HstoraError('Incomplete snapshot; publication blocked.')
   await commit([
    db.prepare("INSERT INTO hstora_catalog_items(external_id,metadata,snapshot_id,checked_at) SELECT external_id,metadata,?,CAST(json_extract(metadata,'$.stock_checked_at') AS INTEGER) FROM hstora_snapshot_items WHERE job_id=? ON CONFLICT(external_id) DO UPDATE SET metadata=excluded.metadata,snapshot_id=excluded.snapshot_id,checked_at=excluded.checked_at WHERE excluded.checked_at>=COALESCE(json_extract(hstora_catalog_items.metadata,'$.webhook_checked_at'),hstora_catalog_items.checked_at)").bind(job,job),
    db.prepare("UPDATE hstora_connection SET phase='complete',last_success=?,last_status='Complete private snapshot; review required',requested=0 WHERE id='hstora'").bind(now),
   ])
  }
 }catch(error){const message=error instanceof HstoraError?error.message:'HStora storage or credential operation failed.';await db.prepare("UPDATE hstora_connection SET last_status=?,next_attempt=?,lease_owner=NULL,lease_until=NULL WHERE id='hstora' AND revision=? AND lease_owner=?").bind(message,Date.now()+(error instanceof HstoraError?([401,403].includes(error.status)?3600000:error.retryAfterMs):60000),row.revision,owner).run()}
}
