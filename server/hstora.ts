import {safeProductImage} from '../src/lib/product-images.ts'
/** HStora's documented read-only API. Never invokes orders, wallet charges or delivery endpoints. */
export const HSTORA_ORIGIN='https://hstora.com'
export const HSTORA_STOREFRONT_CATEGORY='server1'
export type HstoraCredentials={key:string;secret:string;allowedOrigin?:string;baseUrl?:string}
export class HstoraError extends Error {
 readonly status:number
 readonly retryAfterMs:number
 constructor(message:string,status=502,retryAfterMs=30000){super(message);this.status=status;this.retryAfterMs=retryAfterMs}
}
const object=(value:unknown):Record<string,unknown>=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new HstoraError('Invalid HStora response.')
 return value as Record<string,unknown>
}
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('')
const externalId=(value:unknown)=>{const id=String(value??'');if(!/^[1-9]\d{0,15}$/.test(id))throw new HstoraError('Invalid HStora product ID.');return id}
const decimal=(value:unknown)=>{const text=String(value??'');if(!/^\d{1,12}(?:\.\d{1,12})?$/.test(text))throw new HstoraError('Invalid HStora price.');return text}
function text(value:unknown,max:number){if(typeof value!=='string')return '';if(value.length>max||Array.from(value).some(character=>{const code=character.charCodeAt(0);return code<32&&![9,10,13].includes(code)}))throw new HstoraError('Invalid HStora text metadata.');return value.trim()}

export async function hstoraHeaders(credentials:HstoraCredentials,path:string,query:string,timestamp=String(Math.floor(Date.now()/1000)),nonce=crypto.randomUUID().replaceAll('-','')){
 const key=credentials.key.trim(),secret=credentials.secret.trim()
 if(!/^hs_pk_[A-Za-z0-9_-]+$/.test(key)||!/^hs_sk_[A-Za-z0-9_-]+$/.test(secret)||key.length>256||secret.length>1024)throw new HstoraError('Invalid HStora credential format. Enter the API key (hs_pk_) and API signing secret (hs_sk_), not the webhook secret.',400)
 if(!/^\/api\/v1\/(?:catalog|products\/[1-9]\d{0,15})$/.test(path)||/[\r\n#]/.test(query))throw new HstoraError('Unsupported HStora resource.',400)
 const canonical=['GET',path,query,timestamp,nonce,''].join('\n')
 const imported=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 const headers=new Headers({
   'X-API-Key':key,
   'X-Timestamp':timestamp,
   'X-Nonce':nonce,
   'X-Signature':hex(await crypto.subtle.sign('HMAC',imported,new TextEncoder().encode(canonical))),
   Accept:'application/json',
   'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LogsPoll/2.0'
 })
 if(credentials.allowedOrigin){
   try {
     const url=new URL(credentials.allowedOrigin)
     if(url.protocol==='https:'||url.protocol==='http:') headers.set('Origin',url.origin)
   } catch {}
 }
 return headers
}
export async function hstoraRejection(response:Response){
 let reason=response.headers.get('cf-mitigated')==='challenge'?'Cloudflare challenge':response.headers.get('Content-Type')?.includes('application/json')?'API rejection':'non-JSON gateway rejection'
 if(response.headers.get('Content-Type')?.includes('application/json')){
  const reader=response.body?.getReader();let raw='',size=0
  try{if(reader){while(size<=8192){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>8192)break;raw+=new TextDecoder().decode(part.value)}
   if(size<=8192){const body=JSON.parse(raw),code=body?.error?.code
    if(['origin_not_allowed','invalid_signature','missing_auth','request_expired','rate_limited'].includes(code))reason=code
   }
  }}catch{/* Provider bodies are untrusted and never logged. */}finally{await reader?.cancel().catch(()=>{})}
 }
 const ray=response.headers.get('cf-ray'),requestId=response.headers.get('x-request-id')
 const identifier=(ray&&/^[a-fA-F0-9]{12,32}(?:-[A-Z]{3})?$/.test(ray)?` CF-Ray ${ray}.`:'')+(requestId&&/^[a-zA-Z0-9-]{8,80}$/.test(requestId)?` Request ID ${requestId}.`:'')
 let extra = ''
 if (reason === 'origin_not_allowed') {
  extra = ' Configure this key’s allowed domain as logspoll.com; requests use Origin https://logspoll.com.'
 } else if (reason === 'non-JSON gateway rejection' && response.status === 403) {
  extra = ' Cloudflare WAF/Bot protection at supplier host blocked request. Check API Base URL and IP/domain whitelist in HStora.'
 }
 return `HStora HTTP ${response.status}: ${reason}.${identifier}${extra}`
}
async function get(credentials:HstoraCredentials,path:string,query='',timeout=20000){
 const headers=await hstoraHeaders(credentials,path,query)
 const origin = (credentials.baseUrl?.trim().replace(/\/+$/, '') || HSTORA_ORIGIN)
 let response:Response
 try{response=await fetch(origin+path+(query?'?'+query:''),{method:'GET',headers,redirect:'manual',signal:AbortSignal.timeout(timeout)})}
 catch(error){throw new HstoraError(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'HStora request timed out.':'HStora connection failed.')}
 if(!response.ok){const retry=response.headers.get('Retry-After'),seconds=retry&&/^\d+$/.test(retry)?Number(retry):30;throw new HstoraError(await hstoraRejection(response),response.status,Math.min(3600000,Math.max(30000,seconds*1000)))}
 if(!response.headers.get('Content-Type')?.includes('application/json'))throw new HstoraError('HStora returned a non-JSON response.')
 const reader=response.body?.getReader();if(!reader)throw new HstoraError('Empty HStora response.')
 let raw='',size=0;const decoder=new TextDecoder()
 while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>2000000){await reader.cancel();throw new HstoraError('HStora response exceeds safe size.')}raw+=decoder.decode(next.value,{stream:true})}raw+=decoder.decode()
 let envelope:Record<string,unknown>;try{envelope=object(JSON.parse(raw))}catch{throw new HstoraError('Invalid HStora JSON response.')}
 if(envelope.success!==true)throw new HstoraError('HStora rejected the request.')
 return object(envelope.data)
}
export function normalizeHstoraProduct(value:unknown){
 const p=object(value),id=externalId(p.id),name=text(p.name,2000),currency=text(p.currency,3)
 if(!name||!/^[A-Z]{3}$/.test(currency)||!Number.isSafeInteger(p.stock_available)||Number(p.stock_available)<0||Number(p.stock_available)>1000000)throw new HstoraError('Invalid HStora product identity, currency or stock.')
 const description=text(p.description,100000),shortDescription=text(p.short_description,10000)
 const supplied=[p.image_url,p.image,...(Array.isArray(p.images)?p.images:[])]
 const images=[...new Set(supplied.map(v=>v&&typeof v==='object'?(v as Record<string,unknown>).url:v).filter((v):v is string=>typeof v==='string').filter(v=>{try{const url=new URL(v);return Boolean(safeProductImage(url.href))}catch{return false}}))]
 const tiers=(Array.isArray(p.price_tiers)?p.price_tiers:[]).map(value=>{const tier=object(value);if(!Number.isSafeInteger(tier.min_quantity)||Number(tier.min_quantity)<1)throw new HstoraError('Invalid HStora bulk pricing.');return {min_quantity:Number(tier.min_quantity),unit_price:decimal(tier.unit_price)}})
 const category=p.category&&typeof p.category==='object'&&!Array.isArray(p.category)?object(p.category):null
 return {supplier:'hstora' as const,id,name,description,short_description:shortDescription,price:decimal(p.price),currency,stock:Number(p.stock_available),images,price_tiers:tiers,variants:(Array.isArray(p.variants)?p.variants:[]).map(value=>{const v=object(value);return {id:externalId(v.id),name:text(v.name,2000),...(v.price!==undefined?{price:decimal(v.price)}:{}),...(Number.isSafeInteger(v.stock_available)&&Number(v.stock_available)>=0?{stock:Number(v.stock_available)}:{})}}),category:category?{id:String(category.id??''),name:text(category.name??category.title,2000)}:null,storefront_category:HSTORA_STOREFRONT_CATEGORY,requires_details:!description,review_required:true as const}
}
export async function readHstoraPage(credentials:HstoraCredentials,page=1,limit=50){
 if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new HstoraError('Invalid HStora page.',400)
 const data=await get(credentials,'/api/v1/catalog',`page=${page}&limit=${limit}`),pagination=object(data.pagination)
 if(!Array.isArray(data.items)||data.items.length>limit||pagination.page!==page||pagination.limit!==limit||!Number.isSafeInteger(pagination.total)||Number(pagination.total)<0||!Number.isSafeInteger(pagination.pages)||pagination.pages!==Math.ceil(Number(pagination.total)/limit))throw new HstoraError('Invalid HStora pagination.')
 const total=Number(pagination.total),pages=Number(pagination.pages),items=data.items.map(normalizeHstoraProduct)
 if(new Set(items.map(p=>p.id)).size!==items.length||items.length!==Math.max(0,Math.min(limit,total-(page-1)*limit)))throw new HstoraError('Incomplete or duplicate HStora catalog page.')
 return {items,page,total,pages,next_page:page<pages?page+1:null}
}
export async function readHstoraDetail(credentials:HstoraCredentials,id:string){
 const data=await get(credentials,'/api/v1/products/'+externalId(id),'',15000),product=normalizeHstoraProduct(data)
 if(product.id!==id)throw new HstoraError('HStora detail identity mismatch.')
 return product
}
/** Consumer must persist each completed batch privately; publication requires a validated complete snapshot. */
export async function* hstoraCatalogPages(credentials:HstoraCredentials,limit=50){
 const seen=new Set<string>();let page=1,total:number|undefined
 while(true){const batch=await readHstoraPage(credentials,page,limit);if(total!==undefined&&batch.total!==total)throw new HstoraError('HStora snapshot changed; retry from a consistent checkpoint.');total=batch.total
  for(const product of batch.items){if(seen.has(product.id))throw new HstoraError('Duplicate HStora product across pages.');seen.add(product.id)}
  yield batch
  if(batch.next_page===null){if(seen.size!==total)throw new HstoraError('Incomplete HStora snapshot.');break}page=batch.next_page
 }
}
