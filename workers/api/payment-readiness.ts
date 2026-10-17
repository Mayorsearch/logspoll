import type {ApiEnv} from './types.ts'

/** Read-only diagnostics. Credential presence and a readable webhook list do
 * not prove checkout, signing-secret ownership, fulfillment or merchant approval. */
export async function paymentReadiness(env:ApiEnv,origin:string,verify=false) {
 const key=(env.BACHS_API_KEY??'').trim()
 const mode=key.startsWith('sk_live_')?'live':key.startsWith('sk_sandbox_')?'sandbox':'missing_or_invalid'
 const tables=await env.DB!.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('bachs_payment_attempts','bachs_webhook_events','bachs_reservations')").all<{name:string}>()
 const result:{mode:string;apiKeyConfigured:boolean;webhookSecretConfigured:boolean;ledgerTables:string[];webhookHandlerEnabled:boolean;history:Record<string,unknown>[];paymentReadPermission:string;checkoutEnabled:false;automaticFulfillment:false;providerCheck:string;providerHttpStatus:number|null;providerEndpoint?:string;providerFailureStage?:string;providerErrorCode?:string;webhookDestinationConfigured:boolean|null;blockers:string[]}={
  mode,apiKeyConfigured:Boolean(key),webhookSecretConfigured:Boolean(env.BACHS_WEBHOOK_SECRET),ledgerTables:tables.results.map(t=>t.name),webhookHandlerEnabled:tables.results.length===3&&mode!=='missing_or_invalid'&&Boolean(env.BACHS_WEBHOOK_SECRET),history:[],paymentReadPermission:'Not tested',checkoutEnabled:false,automaticFulfillment:false,
  providerCheck:'Not tested',providerHttpStatus:null,webhookDestinationConfigured:null,
  blockers:[...(tables.results.length===3?[]:['D1 Bachs ledger migration 0010_bachs_payment_foundation.sql is missing or incomplete.']),'Live checkout remains disabled until provider and fulfillment verification pass.','Provider-supported end-to-end payment tests and fulfillment readiness have not passed.','Bachs merchant permission for the intended catalog requires separate confirmation.'],
 }
 if(tables.results.length===3)result.history=(await env.DB!.prepare('SELECT a.id,o.reference,a.provider_mode,a.amount_minor,a.currency,a.status,o.payment_status,o.fulfillment_status,a.updated_at FROM bachs_payment_attempts a JOIN orders o ON o.id=a.order_id ORDER BY a.created_at DESC LIMIT 50').all<Record<string,unknown>>()).results
 if(!key||mode==='missing_or_invalid')result.blockers.push('A correctly scoped Bachs API key is missing or invalid.')
 if(!env.BACHS_WEBHOOK_SECRET)result.blockers.push('Bachs webhook signing secret is missing.')
 if(!verify||mode==='missing_or_invalid'||key.length>256)return result
 if(/[^\x21-\x7e]/.test(key)){result.providerCheck='API key contains invalid whitespace or control characters';return result}
 const base=mode==='live'?'https://api.bachs.io':'https://sandbox-api.bachs.io'
 result.providerEndpoint=base+'/v1/webhooks/endpoints?limit=100'
 let stage='request'
 try{
  const response=await fetch(result.providerEndpoint,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{Authorization:'Bearer '+key,Accept:'application/json'}})
  result.providerHttpStatus=response.status
  if(response.status>=300&&response.status<400){result.providerCheck='Provider redirect rejected; credentials were not forwarded';return result}
  if(!response.ok){result.providerCheck=response.status===401?'API authentication rejected':response.status===403?'webhooks:read permission denied':response.status===429?'Provider rate limit':'Provider request failed';return result}
  if(!response.headers.get('Content-Type')?.includes('application/json')){result.providerCheck='Invalid provider response';return result}
  stage='response body'
  const reader=response.body?.getReader();let text='',size=0
  if(!reader){result.providerCheck='Invalid provider response';return result}
  const decoder=new TextDecoder()
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>200000){await reader.cancel();result.providerCheck='Provider response too large';return result}text+=decoder.decode(part.value,{stream:true})}
  stage='response JSON'
  const data=JSON.parse(text)
  if(!Array.isArray(data?.items)||data.items.length>100){result.providerCheck='Invalid provider response';return result}
  const found=data.items.some((x:Record<string,unknown>)=>{const events=x?.event_types;return x?.url===origin+'/api/webhooks/bachs'&&x.enabled===true&&Array.isArray(events)&&['checkout.completed','collection.succeeded','collection.failed','checkout.expired'].every(type=>events.includes(type))})
  result.webhookDestinationConfigured=found?true:data.pagination?.has_more?null:false
  result.providerCheck='Authenticated webhook read succeeded; payment permissions and signature delivery remain unverified'
  try{
   const permission=await fetch(base+'/v1/payments?limit=1',{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{Authorization:'Bearer '+key,Accept:'application/json'}})
   result.paymentReadPermission=permission.status===200&&permission.headers.get('Content-Type')?.includes('application/json')?'payments:read confirmed (HTTP 200); write permission unverified':`payments:read unverified (HTTP ${permission.status})`
   await permission.body?.cancel()
  }catch{result.paymentReadPermission='payments:read verification failed; webhook authentication passed'}
 }catch(error){
  const kind=error instanceof Error?error.name:''
  const detail=error as {code?:unknown;cause?:{code?:unknown}}
  const code=detail?.cause?.code??detail?.code
  const allowed=['ENOTFOUND','EAI_AGAIN','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE']
  result.providerFailureStage=stage
  result.providerErrorCode=typeof code==='string'&&allowed.includes(code)?code:'unavailable'
  const safeKind=['TypeError','Error','TimeoutError','AbortError','SyntaxError'].includes(kind)?kind:'UnknownError'
  result.providerCheck=['TimeoutError','AbortError'].includes(kind)?'Provider request timed out after 12 seconds':kind==='SyntaxError'?'Provider returned invalid JSON':`Provider ${stage} failed (${safeKind}; ${result.providerErrorCode})`
 }
 return result
}
