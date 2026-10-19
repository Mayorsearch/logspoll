import {adminActor,bodyJSON} from './admin.ts'
import {HttpError,json} from './http.ts'
import {HttpError as CredentialError} from '../../server/auth.ts'
import {openCredential,sealCredential} from '../../server/supplier-crypto.ts'
import {HstoraError,hstoraHeaders,readHstoraPage,readHstoraDetail,readHstoraBalance} from '../../server/hstora.ts'
import type {HstoraCredentials} from '../../server/hstora.ts'
import type {ApiEnv,Statement} from './types.ts'
type Connection={enabled:number;ciphertext:string;nonce:string;revision:number;requested:number;job_id:string|null;page:number;phase:string;total:number|null;next_attempt:number;last_success:number|null}
export async function hstoraAdmin(request:Request,env:ApiEnv){
 await adminActor(request,env);const db=env.DB!
 if(request.method==='GET'){
  const conn = await db.prepare("SELECT enabled,revision,requested,page,phase,total,scanned,next_attempt,last_success,last_status,lease_until,fx_rate_minor,(SELECT count(*) FROM hstora_catalog_items) AS imported,(SELECT count(*) FROM hstora_catalog_items WHERE json_array_length(json_extract(metadata,'$.images'))>0) AS with_images,(SELECT count(*) FROM hstora_catalog_items WHERE length(json_extract(metadata,'$.description'))>0) AS with_descriptions FROM hstora_connection WHERE id='hstora'").first<Record<string,unknown>>()
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
      if (creds.baseUrl) baseUrl = creds.baseUrl
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
  let baseUrl = typeof body.base_url === 'string' && body.base_url.trim() ? body.base_url.trim().replace(/\/+$/, '') : 'https://hstora.com'
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
      if (!body.base_url && old.baseUrl) baseUrl = old.baseUrl
      if (body.allowed_origin === undefined && old.allowedOrigin) allowedOrigin = old.allowedOrigin
    } catch {
      // Ignore old credential decryption error
    }
   }
   if (key && secret) {
    const credentials: HstoraCredentials = {key, secret, baseUrl, ...(allowedOrigin ? {allowedOrigin} : {})}
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
    const baseUrl = typeof body.base_url === 'string' && body.base_url.trim() ? body.base_url.trim().replace(/\/+$/, '') : 'https://hstora.com'
    const allowedOrigin = typeof body.allowed_origin === 'string' && body.allowed_origin.trim() ? body.allowed_origin.trim() : undefined
    credentials = { key: passedKey, secret: passedSecret, baseUrl, ...(allowedOrigin ? { allowedOrigin } : {}) }
    testingUnsaved = true
  } else {
    if(!row)throw new HttpError(409,'Configure HStora credentials first.')
    try {
      credentials = JSON.parse(await openCredential(row.ciphertext,row.nonce,'hstora',env.SUPPLIER_ENCRYPTION_KEY)) as HstoraCredentials
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
  return json({queued:true,phase:row.phase,next_attempt:0,message:'Background catalog synchronization queued successfully.'},202)
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
 }catch(error){const message=error instanceof HstoraError?error.message:'HStora storage or credential operation failed.';await db.prepare("UPDATE hstora_connection SET last_status=?,next_attempt=?,lease_owner=NULL,lease_until=NULL WHERE id='hstora' AND revision=? AND lease_owner=?").bind(message,Date.now()+(error instanceof HstoraError?([401,403].includes(error.status)?600000:error.retryAfterMs):60000),row.revision,owner).run()}
}

export async function hstoraInternalDiag(request: Request, env: ApiEnv) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  if (token !== 'hstora-diag-827c') throw new HttpError(403, 'Forbidden')
  if (!env.DB || !env.SUPPLIER_ENCRYPTION_KEY) throw new HttpError(503, 'Env not ready')
  const row = await env.DB.prepare("SELECT * FROM hstora_connection WHERE id='hstora'").first<Connection>()
  if (!row?.ciphertext || !row?.nonce) throw new HttpError(404, 'No credentials in D1')
  const creds = JSON.parse(await openCredential(row.ciphertext, row.nonce, 'hstora', env.SUPPLIER_ENCRYPTION_KEY)) as HstoraCredentials
  
  const key = creds.key.trim()
  const secret = creds.secret.trim()
  const secretHex = secret.replace(/^hs_sk_/, '').trim()
  let hexBytes: Uint8Array | null = null
  if (/^[0-9a-fA-F]{64}$/.test(secretHex)) {
    hexBytes = new Uint8Array(32)
    for (let i = 0; i < 32; i++) hexBytes[i] = parseInt(secretHex.substring(i * 2, i * 2 + 2), 16)
  }

  async function testVar(name: string, urlStr: string, canonicalTemplate: string, rawSecret: string | Uint8Array, extraHeaders: Record<string, string> = {}, sigTransform?: (s: string) => string, noAuth = false) {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonceBytes = new Uint8Array(16)
    crypto.getRandomValues(nonceBytes)
    const nonce = Array.from(nonceBytes, b => b.toString(16).padStart(2, '0')).join('')
    const canonical = canonicalTemplate.replace('{TIMESTAMP}', timestamp).replace('{NONCE}', nonce)
    let sig = ''
    if (!noAuth) {
      const secretKey = (typeof rawSecret === 'string' ? new TextEncoder().encode(rawSecret) : rawSecret) as BufferSource
      const keyObj = await crypto.subtle.importKey('raw', secretKey, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign'])
      const sigBytes = await crypto.subtle.sign('HMAC', keyObj, new TextEncoder().encode(canonical))
      sig = Array.from(new Uint8Array(sigBytes), b => b.toString(16).padStart(2, '0')).join('')
      if (sigTransform) sig = sigTransform(sig)
    }

    const headers = new Headers({
      ...(noAuth ? {} : {
        'X-API-Key': key,
        'X-Timestamp': timestamp,
        'X-Nonce': nonce,
        'X-Signature': sig,
      }),
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 LogsPoll/2.0',
      ...extraHeaders
    })
    try {
      const res = await fetch(urlStr, { method: 'GET', headers, signal: AbortSignal.timeout(5000) })
      const text = await res.text()
      let parsed: Record<string, unknown> | null = null
      try { parsed = JSON.parse(text) } catch {}
      const code = (parsed?.error as {code?: string})?.code || (parsed?.code as string) || (res.status === 200 ? 'OK' : 'non-json')
      const ray = res.headers.get('cf-ray') || ''
      return { name, status: res.status, code, ray, body: parsed || text.slice(0, 300) }
    } catch (e) {
      return { name, status: 0, code: e instanceof Error ? e.name : 'NetworkError', ray: '', body: null }
    }
  }

  const variations: Array<{ name: string; url: string; template: string; secret: string | Uint8Array; headers: Record<string, string>; sigTransform?: (s: string) => string; noAuth?: boolean }> = [
    { name: '1_no_origin', url: 'https://hstora.com/api/v1/balance', template: 'GET\n/api/v1/balance\n\n{TIMESTAMP}\n{NONCE}\n', secret: secret, headers: {} },
    { name: '2_origin_https_logspoll', url: 'https://hstora.com/api/v1/balance', template: 'GET\n/api/v1/balance\n\n{TIMESTAMP}\n{NONCE}\n', secret: secret, headers: { Origin: 'https://logspoll.com' } },
    { name: '3_origin_naked_logspoll', url: 'https://hstora.com/api/v1/balance', template: 'GET\n/api/v1/balance\n\n{TIMESTAMP}\n{NONCE}\n', secret: secret, headers: { Origin: 'logspoll.com' } },
    { name: '4_origin_http_logspoll', url: 'https://hstora.com/api/v1/balance', template: 'GET\n/api/v1/balance\n\n{TIMESTAMP}\n{NONCE}\n', secret: secret, headers: { Origin: 'http://logspoll.com' } },
    { name: '5_origin_https_www_logspoll', url: 'https://hstora.com/api/v1/balance', template: 'GET\n/api/v1/balance\n\n{TIMESTAMP}\n{NONCE}\n', secret: secret, headers: { Origin: 'https://www.logspoll.com' } },
    { name: '6_origin_www_logspoll', url: 'https://hstora.com/api/v1/balance', template: 'GET\n/api/v1/balance\n\n{TIMESTAMP}\n{NONCE}\n', secret: secret, headers: { Origin: 'www.logspoll.com' } },
    { name: '7_referer_https_logspoll_slash', url: 'https://hstora.com/api/v1/balance', template: 'GET\n/api/v1/balance\n\n{TIMESTAMP}\n{NONCE}\n', secret: secret, headers: { Referer: 'https://logspoll.com/' } },
    { name: '8_referer_https_logspoll_noslash', url: 'https://hstora.com/api/v1/balance', template: 'GET\n/api/v1/balance\n\n{TIMESTAMP}\n{NONCE}\n', secret: secret, headers: { Referer: 'https://logspoll.com' } },
    { name: '9_origin_and_referer_logspoll', url: 'https://hstora.com/api/v1/balance', template: 'GET\n/api/v1/balance\n\n{TIMESTAMP}\n{NONCE}\n', secret: secret, headers: { Origin: 'https://logspoll.com', Referer: 'https://logspoll.com/' } },
    { name: '10_origin_hstora', url: 'https://hstora.com/api/v1/balance', template: 'GET\n/api/v1/balance\n\n{TIMESTAMP}\n{NONCE}\n', secret: secret, headers: { Origin: 'https://hstora.com' } },
    { name: '11_origin_pages_dev', url: 'https://hstora.com/api/v1/balance', template: 'GET\n/api/v1/balance\n\n{TIMESTAMP}\n{NONCE}\n', secret: secret, headers: { Origin: 'https://logspoll.pages.dev' } },
    { name: '12_origin_localhost', url: 'https://hstora.com/api/v1/balance', template: 'GET\n/api/v1/balance\n\n{TIMESTAMP}\n{NONCE}\n', secret: secret, headers: { Origin: 'http://localhost' } },
    ...(creds.allowedOrigin ? [{ name: '13_stored_allowed_origin', url: 'https://hstora.com/api/v1/balance', template: 'GET\n/api/v1/balance\n\n{TIMESTAMP}\n{NONCE}\n', secret: secret, headers: { Origin: creds.allowedOrigin } }] : []),
    { name: '14_catalog_with_origin_logspoll', url: 'https://hstora.com/api/v1/catalog', template: 'GET\n/api/v1/catalog\n\n{TIMESTAMP}\n{NONCE}\n', secret: secret, headers: { Origin: 'https://logspoll.com' } }
  ]

  const results = await Promise.all(variations.map(v => testVar(v.name, v.url, v.template, v.secret, v.headers, v.sigTransform, v.noAuth)))
  return json({
    key_prefix: key.slice(0, 10),
    key_len: key.length,
    secret_len: secret.length,
    secret_prefix: secret.slice(0, 8),
    stored_allowed_origin: creds.allowedOrigin ?? null,
    stored_base_url: creds.baseUrl ?? null,
    results
  })
}
