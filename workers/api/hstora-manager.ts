import {adminActor,bodyJSON} from './admin.ts'
import {HttpError,json} from './http.ts'
import {HttpError as CredentialError} from '../../server/auth.ts'
import {openCredential,sealCredential} from '../../server/supplier-crypto.ts'
import {HstoraError,hstoraHeaders,readHstoraPage,readHstoraDetail,readHstoraBalance,normalizeHstoraBaseUrl} from '../../server/hstora.ts'
import type {HstoraCredentials} from '../../server/hstora.ts'
import type {ApiEnv,Statement} from './types.ts'
type Connection={enabled:number;ciphertext:string;nonce:string;revision:number;requested:number;job_id:string|null;page:number;phase:string;total:number|null;next_attempt:number;last_success:number|null}
export async function hstoraAdmin(request:Request,env:ApiEnv){
 await adminActor(request,env);const db=env.DB!
 if(request.method==='GET'){
  const conn = await db.prepare("SELECT enabled,revision,requested,page,phase,total,scanned,next_attempt,last_success,last_status,lease_until,fx_rate_minor,(SELECT count(*) FROM hstora_catalog_items) AS imported,(SELECT count(*) FROM hstora_catalog_items WHERE json_valid(metadata) AND CAST(json_extract(metadata,'$.stock') AS INTEGER)>0) AS in_stock,(SELECT count(*) FROM hstora_catalog_items WHERE published=1) AS published,(SELECT count(*) FROM hstora_catalog_items WHERE approval_status='rejected' OR (json_valid(metadata) AND CAST(json_extract(metadata,'$.stock') AS INTEGER)<=0)) AS rejected,(SELECT count(*) FROM hstora_catalog_items WHERE json_array_length(json_extract(metadata,'$.images'))>0) AS with_images,(SELECT count(*) FROM hstora_catalog_items WHERE length(json_extract(metadata,'$.description'))>0) AS with_descriptions FROM hstora_connection WHERE id='hstora'").first<Record<string,unknown>>()
  let baseUrl = 'https://hstora.com'
  let allowedOrigin = ''
  let keyConfigured = false
  let keyPrefix = ''
  let keyLen = 0
  let secretConfigured = false
  let secretLen = 0
  const row = await db.prepare("SELECT ciphertext, nonce FROM hstora_connection WHERE id='hstora'").first<{ciphertext:string;nonce:string}>()
  if (row?.ciphertext && row?.nonce && env.SUPPLIER_ENCRYPTION_KEY) {
    try {
      const creds = JSON.parse(await openCredential(row.ciphertext, row.nonce, 'hstora', env.SUPPLIER_ENCRYPTION_KEY)) as HstoraCredentials
      if (creds.baseUrl) baseUrl = normalizeHstoraBaseUrl(creds.baseUrl)
      if (creds.allowedOrigin) allowedOrigin = creds.allowedOrigin
      if (creds.key) {
        keyConfigured = true
        keyPrefix = creds.key.slice(0, 10) + '...'
        keyLen = creds.key.length
      }
      if (creds.secret) {
        secretConfigured = true
        secretLen = creds.secret.length
      }
    } catch {
      // Ignore credential decryption error
    }
  }
  return json({
    provider:'hstora',
    connection:conn ? {
      ...conn,
      base_url: baseUrl,
      allowed_origin: allowedOrigin,
      key_configured: keyConfigured,
      key_prefix: keyPrefix,
      key_len: keyLen,
      secret_configured: secretConfigured,
      secret_len: secretLen
    } : null
  })
 }
 if(request.method!=='POST')throw new HttpError(405,'Method not permitted.')
 const body=await bodyJSON(request,4096),row=await db.prepare("SELECT * FROM hstora_connection WHERE id='hstora'").first<Connection>()
 if(body.action==='save'){
  let baseUrl = normalizeHstoraBaseUrl(typeof body.base_url === 'string' && body.base_url.trim() ? body.base_url : 'https://hstora.com')
  if (!baseUrl.startsWith('https://') && !baseUrl.startsWith('http://localhost')) throw new HttpError(400, 'Base URL must use HTTPS.')
  if(body.fx_rate_minor!==undefined&&(!Number.isSafeInteger(body.fx_rate_minor)||Number(body.fx_rate_minor)<=0||Number(body.fx_rate_minor)>1000000000))throw new HttpError(400,'Invalid NGN exchange rate.')
  if(body.api_key!==undefined||body.api_secret!==undefined||body.base_url!==undefined||body.allowed_origin!==undefined){
   let key = typeof body.api_key === 'string' ? body.api_key.trim() : ''
   let secret = typeof body.api_secret === 'string' ? body.api_secret.trim() : ''
   let allowedOrigin = typeof body.allowed_origin === 'string' && body.allowed_origin.trim() ? body.allowed_origin.trim() : undefined
   if ((key && !secret) || (!key && secret)) {
     throw new HttpError(400, 'Both API key (hs_pk_) and API signing secret (hs_sk_) must be entered together to avoid mismatched keys.')
   }
   if (!key && !secret && row?.ciphertext && row?.nonce && env.SUPPLIER_ENCRYPTION_KEY) {
    try {
      const old = JSON.parse(await openCredential(row.ciphertext, row.nonce, 'hstora', env.SUPPLIER_ENCRYPTION_KEY)) as HstoraCredentials
      key = old.key
      secret = old.secret
      if (!body.base_url && old.baseUrl) baseUrl = normalizeHstoraBaseUrl(old.baseUrl)
      if (body.allowed_origin === undefined && old.allowedOrigin) allowedOrigin = old.allowedOrigin
    } catch {
      // Ignore old credential decryption error
    }
   }
   if (!allowedOrigin) allowedOrigin = 'https://logspoll.com'
   if (key && secret) {
    const credentials: HstoraCredentials = {key, secret, baseUrl, allowedOrigin}
    let sealed:Awaited<ReturnType<typeof sealCredential>>
    try{
      await hstoraHeaders(credentials,'/api/v1/balance','')
      sealed=await sealCredential(JSON.stringify(credentials),'hstora',env.SUPPLIER_ENCRYPTION_KEY)
    }
    catch(error){
      if(error instanceof HstoraError)throw new HttpError(400,'Invalid HStora credential format. Enter the API key (hs_pk_) and API signing secret (hs_sk_), not the webhook secret.')
      if(error instanceof CredentialError)throw new HttpError(error.status,error.message)
      throw error
    }
    const nextEnabled = typeof body.enabled === 'boolean' ? (body.enabled ? 1 : 0) : (row?.enabled ?? 0)
    await db.prepare("INSERT INTO hstora_connection(id,ciphertext,nonce,enabled,fx_rate_minor) VALUES('hstora',?,?,?,?) ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext,nonce=excluded.nonce,enabled=excluded.enabled,fx_rate_minor=COALESCE(excluded.fx_rate_minor,hstora_connection.fx_rate_minor),revision=revision+1,lease_owner=NULL,lease_until=NULL,requested=0,next_attempt=0,phase='idle',job_id=NULL,page=1,total=NULL,scanned=0,last_status='Credentials saved; test connection'").bind(sealed.ciphertext,sealed.nonce,nextEnabled,body.fx_rate_minor===undefined?null:Number(body.fx_rate_minor)).run()
    return json({saved:true})
   } else if (!row) throw new HttpError(400, 'Enter API key and signing secret first.')
  }
  if(!row)throw new HttpError(400,'Configure HStora credentials first.')
  if(typeof body.enabled==='boolean')await db.prepare("UPDATE hstora_connection SET enabled=?,lease_owner=NULL,lease_until=NULL,next_attempt=CASE WHEN ?=1 THEN 0 ELSE next_attempt END WHERE id='hstora'").bind(body.enabled?1:0,body.enabled?1:0).run()
  if(body.fx_rate_minor!==undefined)await db.prepare("UPDATE hstora_connection SET fx_rate_minor=? WHERE id='hstora'").bind(Number(body.fx_rate_minor)).run()
  return json({saved:true})
 }
  if(body.action==='toggle'){
  if(!row)throw new HttpError(400,'Configure HStora credentials first.')
  const nextEnabled = row.enabled ? 0 : 1
  await db.prepare("UPDATE hstora_connection SET enabled=?,lease_owner=NULL,lease_until=NULL,next_attempt=CASE WHEN ?=1 THEN 0 ELSE next_attempt END WHERE id='hstora'").bind(nextEnabled,nextEnabled).run()
  return json({saved:true, enabled:Boolean(nextEnabled)})
 }
 if(body.action==='test'){
  let credentials: HstoraCredentials
  let testingUnsaved = false
  const passedKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
  const passedSecret = typeof body.api_secret === 'string' ? body.api_secret.trim() : ''
  if (passedKey || passedSecret) {
    if (!passedKey || !passedSecret) {
      throw new HttpError(400, 'Enter both API key (hs_pk_) and signing secret (hs_sk_) to test new credentials.')
    }
    const baseUrl = normalizeHstoraBaseUrl(typeof body.base_url === 'string' && body.base_url.trim() ? body.base_url : 'https://hstora.com')
    const allowedOrigin = typeof body.allowed_origin === 'string' && body.allowed_origin.trim() ? body.allowed_origin.trim() : 'https://logspoll.com'
    credentials = { key: passedKey, secret: passedSecret, baseUrl, allowedOrigin }
    testingUnsaved = true
  } else {
    if(!row)throw new HttpError(409,'Configure HStora credentials first.')
    try {
      credentials = JSON.parse(await openCredential(row.ciphertext,row.nonce,'hstora',env.SUPPLIER_ENCRYPTION_KEY)) as HstoraCredentials
      if (credentials.baseUrl) credentials.baseUrl = normalizeHstoraBaseUrl(credentials.baseUrl)
      if (!credentials.allowedOrigin) credentials.allowedOrigin = 'https://logspoll.com'
    } catch (error) {
      if (error instanceof CredentialError) throw new HttpError(error.status, error.message)
      throw error
    }
  }
  try{
    const bal = await readHstoraBalance(credentials)
    const page = await readHstoraPage(credentials,1,1)
    const statusMsg = `Connected successfully · Balance: ${bal.currency} ${bal.balance.toFixed(2)} · ${page.total} products available`
    if (!testingUnsaved) {
      await db.prepare("UPDATE hstora_connection SET last_status=?,next_attempt=0 WHERE id='hstora'").bind(statusMsg).run()
    }
    return json({
      connected: true,
      balance: bal.balance,
      currency: bal.currency,
      pending_balance: bal.pending_balance,
      total: page.total,
      testing_unsaved: testingUnsaved,
      message: `HStora verified successfully: ${bal.currency} ${bal.balance.toFixed(2)} balance, ${page.total} products accessible.`
    })
  }
  catch(error){
    if(error instanceof HstoraError){
      console.warn('hstora_test_failure',JSON.stringify({layer:'supplier',provider_status:error.status,error:error.message}))
      let diag = error.message
      const keySummary = `API Key: ${credentials.key.slice(0, 10)}... (length ${credentials.key.length}), Secret length: ${credentials.secret.length}`
      if (error.status === 401 && error.message.includes('invalid_signature')) {
        diag = `HStora HTTP 401: invalid_signature (${keySummary}). The signing secret does not match this API key in HStora. Check that the secret was generated with this exact API key in the HStora dashboard.`
      } else if (error.status === 401 && error.message.includes('invalid_key')) {
        diag = `HStora HTTP 401: invalid_key (${keySummary}). This API key does not exist or has been deleted in HStora.`
      } else if (error.status === 403 && error.message.includes('origin_not_allowed')) {
        diag = `HStora HTTP 403: origin_not_allowed. Request Origin did not match the allowed domains configured for this key on HStora.`
      }
      if (!testingUnsaved) {
        await db.prepare("UPDATE hstora_connection SET last_status=? WHERE id='hstora'").bind(`Test failed: ${diag.slice(0, 300)}`).run().catch(()=>{})
      }
      return json({error: diag, layer:'supplier', provider_status:error.status, connected:false}, 424)
    }
    if(error instanceof CredentialError)throw new HttpError(error.status,error.message)
    throw error
  }
 }
 if(!row)throw new HttpError(409,'Configure HStora credentials first.')
 if(body.action==='sync'){
  if(!row.enabled)throw new HttpError(409,'Enable HStora first.')
  await db.prepare("UPDATE hstora_connection SET requested=1,next_attempt=0 WHERE id='hstora'").run();
  if(['finalize','listings','details'].includes(row.phase)){
    await syncHstoraBatch(env).catch(()=>{})
  }
  const updated = await db.prepare("SELECT phase, scanned, total, (SELECT count(*) FROM hstora_catalog_items) AS imported, last_status FROM hstora_connection WHERE id='hstora'").first<Record<string,unknown>>()
  return json({queued:true,phase:updated?.phase ?? row.phase,scanned:updated?.scanned,total:updated?.total,imported:updated?.imported,message:'Catalog synchronization executed successfully.'},200)
 }
 throw new HttpError(400,'Unknown supplier action.')
}
// Each cron invocation persists one bounded batch; browser lifetime is irrelevant.
export async function syncHstoraBatch(env:ApiEnv){
 if(env.CATALOG_SYNC_ENABLED!=='true'||!env.DB)return
 const db=env.DB,now=Date.now(),owner=crypto.randomUUID()
 const row=await db.prepare("UPDATE hstora_connection SET lease_owner=?,lease_until=? WHERE id='hstora' AND enabled=1 AND next_attempt<=? AND (EXISTS(SELECT 1 FROM hstora_catalog_items WHERE approval_status='approved' AND COALESCE(json_extract(metadata,'$.supplier_available'),1)<>0 AND checked_at<?) OR requested=1 OR phase IN('listings','details','finalize') OR last_success IS NOT NULL AND last_success<=?) AND (lease_until IS NULL OR lease_until<=?) RETURNING *").bind(owner,now+180000,now,now-1800000,now-43200000,now).first<Connection>()
 if(!row)return
 const fence=()=>db.prepare("INSERT INTO hstora_sync_fences(owner,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM hstora_connection WHERE id='hstora' AND enabled=1 AND revision=? AND lease_owner=? AND lease_until>?) THEN 1 ELSE 0 END").bind(owner,row.revision,owner,Date.now())
 async function commit(statements:Statement[], releaseLease = true){await db.batch([fence(),...statements,db.prepare('DELETE FROM hstora_sync_fences WHERE owner=?').bind(owner),...(releaseLease?[db.prepare("UPDATE hstora_connection SET lease_owner=NULL,lease_until=NULL WHERE id='hstora' AND lease_owner=?").bind(owner)]:[] )])}
 try{
  const credentials=JSON.parse(await openCredential(row.ciphertext,row.nonce,'hstora',env.SUPPLIER_ENCRYPTION_KEY)) as HstoraCredentials
  const due=await db.prepare("SELECT external_id,metadata,checked_at FROM hstora_catalog_items WHERE approval_status='approved' AND COALESCE(json_extract(metadata,'$.supplier_available'),1)<>0 AND checked_at<? ORDER BY checked_at LIMIT 5").bind(now-1800000).all<{external_id:string;metadata:string;checked_at:number}>()
  const catalogDue=row.requested===1||['listings','details','finalize'].includes(row.phase)||row.last_success!==null&&row.last_success<=now-43200000
  // Share cron turns with catalog reconciliation instead of starving it forever.
  if(due.results.length&&(!catalogDue||Math.floor(now/60000)%2===0)){
   const results=await Promise.allSettled(due.results.map(item=>readHstoraDetail(credentials,item.external_id)))
   const writes:Statement[]=[];let failure:unknown,verified=0,unavailable=0
   for(const [index,result] of results.entries()){
    const item=due.results[index],checked=Date.now()
    if(result.status==='fulfilled'){
     const previous=JSON.parse(item.metadata),detail=result.value
     const metadata={...previous,...detail,description:detail.description||previous.description,images:detail.images.length?detail.images:previous.images,supplier_available:true,stock_checked_at:checked}
     writes.push(db.prepare('UPDATE hstora_catalog_items SET metadata=?,checked_at=? WHERE external_id=? AND checked_at=?').bind(JSON.stringify(metadata),checked,item.external_id,item.checked_at));verified++
    }else if(result.reason instanceof HstoraError&&result.reason.status===404&&/\bproduct_unavailable\b/.test(result.reason.message)){
     // Only the supplier's explicit application rejection certifies removal.
     writes.push(db.prepare("UPDATE hstora_catalog_items SET metadata=json_set(metadata,'$.stock',0,'$.supplier_available',json('false'),'$.stock_checked_at',?),checked_at=? WHERE external_id=? AND checked_at=?").bind(checked,checked,item.external_id,item.checked_at));unavailable++
    }else failure??=result.reason
   }
   if(writes.length){
    writes.push(db.prepare("UPDATE hstora_connection SET last_status=? WHERE id='hstora'").bind(`Stock refresh: ${verified} verified, ${unavailable} supplier-unavailable.`))
    await commit(writes,failure===undefined)
   }
   // Retain provider backoff and lease protection after committing valid peers.
   if(failure!==undefined)throw failure
   return
  }
  const fresh=!row.job_id||['idle','complete'].includes(row.phase),job=fresh?crypto.randomUUID():row.job_id!,page=fresh?1:row.page
  if(fresh||row.phase==='listings'){
   let currentPage = Math.max(1,page-(fresh?0:1))
   let pagesRead=0
   let nextPhase = 'listings'
   const deadline = Date.now() + 25000
   while (Date.now() < deadline && nextPhase === 'listings' && pagesRead++<8) {
     const batch = await readHstoraPage(credentials, currentPage, 25)
     // Offset totals are observations, not snapshot identities. Keep the job and
     // deduplicated records; overlap one page when resuming to reduce boundary gaps.
     const writes = batch.items.map(item => db.prepare('INSERT INTO hstora_snapshot_items(job_id,external_id,metadata,detail_done) VALUES(?,?,?,?) ON CONFLICT(job_id,external_id) DO UPDATE SET metadata=excluded.metadata,detail_done=excluded.detail_done').bind(job, item.id, JSON.stringify({...item, stock_checked_at: Date.now()}), item.requires_details ? 0 : 1))
     if (batch.next_page === null) {
       const pendingDetails = await db.prepare("SELECT count(*) n FROM hstora_snapshot_items WHERE job_id=? AND detail_done=0").bind(job).first<{n:number}>()
       nextPhase = (pendingDetails?.n ?? 0) > 0 || batch.items.some(item=>item.requires_details) ? 'details' : 'finalize'
     }
     const isLast = batch.next_page === null || Date.now() >= deadline - 2000
     writes.push(db.prepare("UPDATE hstora_connection SET job_id=?,page=?,total=?,scanned=(SELECT count(*) FROM hstora_snapshot_items WHERE job_id=?),phase=?,requested=0,last_status='Catalog batch saved' WHERE id='hstora'").bind(job, currentPage + 1, batch.total, job, nextPhase))
     await commit(writes, isLast)
     if (isLast) break
     currentPage++
   }
   if (nextPhase === 'listings') {
     await db.prepare("UPDATE hstora_connection SET lease_owner=NULL,lease_until=NULL WHERE id='hstora' AND lease_owner=?").bind(owner).run().catch(()=>{})
   }
   return
  }
  if(row.phase==='details'){
   const discoveryKey='hstora_catalog_discovered:'+job
   if(!await db.prepare('SELECT 1 FROM migration_metadata WHERE key=?').bind(discoveryKey).first()){
    // Import authenticated catalog metadata privately before slow enrichment.
    // Existing reviewed stock/cost can refresh; new rows retain pending approval.
    await commit([
     db.prepare(`INSERT INTO hstora_catalog_items(external_id,metadata,snapshot_id,checked_at)
       SELECT external_id,metadata,?,CAST(json_extract(metadata,'$.stock_checked_at') AS INTEGER) FROM hstora_snapshot_items WHERE job_id=? AND detail_done IN (0,1)
       ON CONFLICT(external_id) DO UPDATE SET metadata=json_set(json_patch(hstora_catalog_items.metadata,excluded.metadata),
        '$.description',COALESCE(NULLIF(json_extract(excluded.metadata,'$.description'),''),json_extract(hstora_catalog_items.metadata,'$.description'),''),
        '$.images',json(CASE WHEN json_array_length(json_extract(excluded.metadata,'$.images'))>0 THEN json_extract(excluded.metadata,'$.images') ELSE COALESCE(json_extract(hstora_catalog_items.metadata,'$.images'),'[]') END),
        '$.supplier_available',json('true')),snapshot_id=excluded.snapshot_id,checked_at=excluded.checked_at
       WHERE excluded.checked_at>=MAX(COALESCE(json_extract(hstora_catalog_items.metadata,'$.webhook_checked_at'),0),hstora_catalog_items.checked_at)`).bind(job,job),
     db.prepare('INSERT INTO migration_metadata(key,value) VALUES(?,?)').bind(discoveryKey,String(Date.now()))
    ],false)
   }
   const items=await db.prepare("SELECT external_id,metadata FROM hstora_snapshot_items WHERE job_id=? AND detail_done=0 AND COALESCE(json_extract(metadata,'$.sync_retry_at'),0)<=? ORDER BY external_id LIMIT 25").bind(job,now).all<{external_id:string;metadata:string}>()
   if(items.results.length){
    const results=await Promise.allSettled(items.results.map(item=>readHstoraDetail(credentials,item.external_id)))
    const writes:Statement[]=[];let providerFailure:unknown
    for(const [index,result] of results.entries()){
     const item=items.results[index],old=JSON.parse(item.metadata),checked=Date.now()
     if(result.status==='fulfilled'){
      const detail=result.value,metadata={...old,...detail,description:detail.description||old.description,images:detail.images.length?detail.images:old.images,category:detail.category??old.category,stock_checked_at:checked,sync_error:null,sync_retry_at:0}
      writes.push(db.prepare('UPDATE hstora_snapshot_items SET metadata=?,detail_done=1 WHERE job_id=? AND external_id=?').bind(JSON.stringify(metadata),job,item.external_id))
     }else if(result.reason instanceof HstoraError&&result.reason.status===404&&/\bproduct_unavailable\b/.test(result.reason.message)){
      writes.push(db.prepare("UPDATE hstora_snapshot_items SET metadata=json_set(metadata,'$.stock',0,'$.supplier_available',json('false'),'$.sync_error','Supplier product unavailable'),detail_done=3 WHERE job_id=? AND external_id=?").bind(job,item.external_id),
       db.prepare("UPDATE hstora_catalog_items SET metadata=json_set(metadata,'$.stock',0,'$.supplier_available',json('false'),'$.stock_checked_at',?),checked_at=? WHERE external_id=? AND checked_at<=?").bind(checked,checked,item.external_id,now))
     }else if(result.reason instanceof HstoraError&&[401,403,429].includes(result.reason.status))providerFailure??=result.reason
     else{
      const attempts=Number(old.sync_attempts??0)+1,delay=Math.max(result.reason instanceof HstoraError?result.reason.retryAfterMs:30000,Math.min(3600000,30000*2**(attempts-1)))
      const message=result.reason instanceof HstoraError?result.reason.message.slice(0,300):'Supplier detail request failed.'
      writes.push(db.prepare("UPDATE hstora_snapshot_items SET metadata=json_set(metadata,'$.sync_attempts',?,'$.sync_retry_at',?,'$.sync_error',?),detail_done=? WHERE job_id=? AND external_id=?").bind(attempts,checked+delay,message,attempts>=3?2:0,job,item.external_id))
     }
    }
    if(writes.length)await commit([...writes,db.prepare("UPDATE hstora_connection SET last_status='Detail batch saved; failed items retain retry/review state' WHERE id='hstora'")],providerFailure===undefined)
    if(providerFailure!==undefined)throw providerFailure
    return
   }
   const waiting=await db.prepare('SELECT count(*) n FROM hstora_snapshot_items WHERE job_id=? AND detail_done=0').bind(job).first<{n:number}>()
   await commit([db.prepare("UPDATE hstora_connection SET phase=?,last_status=? WHERE id='hstora'").bind(waiting?.n?'details':'finalize',waiting?.n?'Waiting for bounded detail retry':'Catalog traversal ready to finalize')]);return
  }
  if(row.phase==='finalize'){
   const count=await db.prepare('SELECT count(*) AS n FROM hstora_snapshot_items WHERE job_id=? AND detail_done=1').bind(job).first<{n:number}>()
   const pending=await db.prepare('SELECT count(*) AS n FROM hstora_snapshot_items WHERE job_id=? AND detail_done=0').bind(job).first<{n:number}>()
   const skipped=await db.prepare('SELECT count(*) n FROM hstora_snapshot_items WHERE job_id=? AND detail_done IN (2,3)').bind(job).first<{n:number}>()
   if((pending?.n??0)>0||((count?.n??0)+(skipped?.n??0)===0&&row.total!==0))throw new HstoraError('Unfinished catalog traversal; checkpoints retained.')
   const finalCount=count?.n??0
   const statusText=`Catalog traversal complete; ${finalCount} products imported; ${skipped?.n??0} failed/skipped; supplier estimate ${row.total??'unknown'}`
   await commit([
    db.prepare("INSERT INTO hstora_catalog_items(external_id,metadata,snapshot_id,checked_at) SELECT external_id,metadata,?,CAST(json_extract(metadata,'$.stock_checked_at') AS INTEGER) FROM hstora_snapshot_items WHERE job_id=? AND detail_done=1 ON CONFLICT(external_id) DO UPDATE SET metadata=excluded.metadata,snapshot_id=excluded.snapshot_id,checked_at=excluded.checked_at WHERE excluded.checked_at>=MAX(COALESCE(json_extract(hstora_catalog_items.metadata,'$.webhook_checked_at'),0),hstora_catalog_items.checked_at)").bind(job,job),
    db.prepare("UPDATE hstora_connection SET phase='complete',last_success=?,last_status=?,requested=0,scanned=? WHERE id='hstora'").bind(now, statusText, finalCount),
   ])
  }
 }catch(error){const message=error instanceof HstoraError?error.message:(error instanceof Error?error.message:'HStora storage or credential operation failed.');await db.prepare("UPDATE hstora_connection SET last_status=?,next_attempt=?,lease_owner=NULL,lease_until=NULL WHERE id='hstora' AND revision=? AND lease_owner=?").bind(message,Date.now()+(error instanceof HstoraError?([401,403].includes(error.status)?600000:error.retryAfterMs):60000),row.revision,owner).run()}
}

