import {hstoraHeaders,type HstoraCredentials} from './hstora.ts'
import {youngpgGet,YOUNGPG_ORIGIN,listingSlug} from './youngpg.ts'

export type DeliveryProvider='youngpg'|'hstora'|'digitalcore'|'shopviaclone22'
export type Delivery={receipt:string;items:string[];delivered:boolean}
export class DeliveryError extends Error {
 readonly state:'retry'|'blocked'|'uncertain'
 constructor(message:string,state:'retry'|'blocked'|'uncertain'='blocked'){super(message);this.name='DeliveryError';this.state=state}
}
type Input={externalId:string;slug?:string;quantity:number;requestId:string;maxCostMinor:number;fxRate?:string;recovering?:boolean;adminOverride?:boolean}
type Credentials={key?:string;secret?:string;apiKey?:string;allowedOrigin?:string;baseUrl?:string}
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new DeliveryError('Supplier returned invalid order data.','uncertain');return v as Record<string,unknown>}
const decimal=(v:unknown)=>{const s=String(v);if(!/^\d{1,12}(?:\.\d{1,8})?$/.test(s))throw new DeliveryError('Supplier price or exchange rate is invalid.');const[w,f='']=s.split('.');return{n:BigInt(w+f),d:10n**BigInt(f.length)}}
export function deliveryCostMinor(price:unknown,quantity:number,currency:string,fx?:string){
 if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000)throw new DeliveryError('Invalid delivery quantity.')
 const p=decimal(price),rate=currency==='NGN'?{n:1n,d:1n}:currency==='USD'&&fx?decimal(fx):null
 if(!rate||rate.n<=0n)throw new DeliveryError('A fresh verified currency conversion is required.')
 const n=p.n*BigInt(quantity)*100n*rate.n,d=p.d*rate.d,result=(n+d-1n)/d
 if(result>BigInt(Number.MAX_SAFE_INTEGER))throw new DeliveryError('Supplier price is too large.')
 return Number(result)
}
async function request(url:string,headers:Headers,method='GET',body?:string){
 const parsed=new URL(url)
 if(parsed.protocol!=='https:'||!['youngpgmedia.com.ng','hstora.com','digitalcore.top','shopviaclone22.com'].includes(parsed.hostname)||parsed.port||parsed.username||parsed.password)throw new DeliveryError('Supplier purchase host is not verified.')
 let r:Response
 try{r=await fetch(url,{method,headers,body,redirect:'manual',signal:AbortSignal.timeout(12000)})}catch{throw new DeliveryError('Supplier connection failed; check order history before any purchase retry.',method==='POST'?'uncertain':'retry')}
 if([301,302,307,308].includes(r.status)&&r.headers.get('location')){
  const loc=new URL(r.headers.get('location')!,url)
  if(loc.protocol==='https:'&&['youngpgmedia.com.ng','hstora.com','digitalcore.top','shopviaclone22.com'].includes(loc.hostname)){
   try{r=await fetch(loc.toString(),{method:method==='POST'?'POST':'GET',headers,body,redirect:'manual',signal:AbortSignal.timeout(12000)})}catch{throw new DeliveryError('Supplier connection failed; check order history before any purchase retry.',method==='POST'?'uncertain':'retry')}
  }
 }
 const reader=r.body?.getReader();let raw='',size=0;const decoder=new TextDecoder()
 try{if(reader)while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>256000)throw Error();raw+=decoder.decode(next.value,{stream:true})}raw+=decoder.decode()}catch{throw new DeliveryError('Supplier response was interrupted.',method==='POST'?'uncertain':'retry')}finally{await reader?.cancel().catch(()=>undefined)}
 let data:Record<string,unknown>|null=null;try{data=object(JSON.parse(raw))}catch{/* Never expose provider bodies or credentials. */}
 if(!r.ok||data?.success===false){
  if(r.status===403)throw new DeliveryError('Supplier denied API permissions or access. YoungPG requires orders:write, orders:read and wallet:read scopes.')
  if(r.status===401)throw new DeliveryError('Supplier authentication failed. Update the stored API credentials.')
  if(r.status===429)throw new DeliveryError('Supplier rate limit; delivery will retry later.','retry')
  const knownFailure=String(data?.message??data?.msg??objectSafe(data?.error)?.code??'').toLowerCase()
  if(data&&[400,402,409].includes(r.status)&&/insufficient|out.of.stock|balance/.test(knownFailure))throw new DeliveryError('Supplier balance or stock is insufficient; delivery will retry later.','retry')
  if(method==='POST'&&(!data||r.status>=500||r.status<400))throw new DeliveryError('Supplier purchase result is uncertain; reconcile supplier order history.','uncertain')
  throw new DeliveryError(`Supplier HTTP ${r.status}; verify configuration.`,method==='GET'&&r.status>=500?'retry':'blocked')
 }
 if(!data)throw new DeliveryError('Supplier response was invalid.',method==='POST'?'uncertain':'retry')
 return data
}
function objectSafe(v:unknown){return v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null}
function items(v:unknown,quantity:number):string[]{
 if(Array.isArray(v)){
  const flat=v.filter(s=>typeof s==='string'&&s.trim()&&s.length<=20000) as string[]
  if(flat.length===quantity)return flat
 }
 if(typeof v==='string'&&v.trim()){
  const lines=v.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)
  if(lines.length===quantity)return lines
  if(quantity===1)return[v.trim()]
 }
 return[]
}
function receipt(v:unknown){const id=String(v??'');if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new DeliveryError('Supplier receipt is missing; reconcile order history.','uncertain');return id}
export async function prepareDelivery(provider:DeliveryProvider,credentials:Credentials,input:Input){
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(input.externalId)||!Number.isSafeInteger(input.maxCostMinor)||input.maxCostMinor<1)throw new DeliveryError('Invalid supplier mapping or order amount.')
 let price:unknown,currency:string,stock:unknown
 const headers=new Headers({Accept:'application/json','Content-Type':'application/json'})
 const hcreds=credentials as HstoraCredentials
 const hheaders=async(path:string,query='',body='')=>{
  const result=await hstoraHeaders(hcreds,path,query,undefined,undefined,{method:body?'POST':'GET',body})
  if(body){result.set('Content-Type','application/json');result.set('Idempotency-Key',input.requestId)}
  return result
 }
 if(provider==='youngpg'){
  const key=credentials.key?.trim()??'';if(!/^ypg_[a-fA-F0-9]{48}$/.test(key))throw new DeliveryError('YoungPG API key is invalid.')
  headers.set('X-API-Key',key)
  if(!input.recovering){const slug=listingSlug(input.slug),detail=object((await youngpgGet(YOUNGPG_ORIGIN,key,`listings/${slug}`)).data)
   if(String(detail.id)!==input.externalId||detail.slug!==slug)throw new DeliveryError('YoungPG product identity changed; review the mapping.')
   price=detail.price_ngn;currency='NGN';stock=detail.available_stock}
 }else if(provider==='hstora'){
  if(!/^[1-9]\d{0,15}$/.test(input.externalId))throw new DeliveryError('HStora product ID is invalid.')
  if(!input.recovering){const path='/api/v1/products/'+input.externalId,detail=object((await request('https://hstora.com'+path,await hheaders(path))).data)
   if(String(detail.id)!==input.externalId)throw new DeliveryError('HStora product identity changed.')
   price=detail.price;currency=String(detail.currency);stock=detail.stock_available}
 }else if(provider==='shopviaclone22'){
  const key=credentials.apiKey?.trim()||credentials.key?.trim()
  if(!key)throw new DeliveryError('ShopViaClone22 API key is missing.')
  const baseUrl=credentials.baseUrl?.trim()||'https://shopviaclone22.com/api'
  const parsedBase=new URL(baseUrl)
  if(parsedBase.protocol!=='https:'||parsedBase.hostname!=='shopviaclone22.com')throw new DeliveryError('ShopViaClone22 purchase host is not verified.')
  if(!input.recovering){
   const prodPath=`${baseUrl.replace(/\/+$/,'')}/product.php?api_key=${encodeURIComponent(key)}&product=${encodeURIComponent(input.externalId)}&id=${encodeURIComponent(input.externalId)}`
   const detail=await request(prodPath,new Headers({Accept:'application/json'}))
   const prod=objectSafe(detail.product)??objectSafe(detail.data)??detail
   if(prod.id&&String(prod.id)!==input.externalId)throw new DeliveryError('ShopViaClone22 product identity changed.')
   price=prod.price;currency=String(prod.currency??'USD').toUpperCase();stock=prod.amount??prod.stock
  }
 }else{
  const key=credentials.apiKey?.trim();if(!key)throw new DeliveryError('DigitalCore API key is missing.')
  if(credentials.baseUrl&&new URL(credentials.baseUrl).origin!=='https://digitalcore.top')throw new DeliveryError('DigitalCore purchase host is not verified.')
  headers.set('Api-Key',key)
  if(!input.recovering){const detail=await request('https://digitalcore.top/api/user/product?id='+encodeURIComponent(input.externalId),headers)
   if(String(detail.id)!==input.externalId)throw new DeliveryError('DigitalCore product identity changed.')
   price=detail.price;currency='USD';stock=detail.stock}
 }
 if(!input.recovering){
  if(!Number.isSafeInteger(Number(stock))||Number(stock)<input.quantity)throw new DeliveryError('Supplier stock is insufficient; delivery will retry later.','retry')
  if(!input.adminOverride&&deliveryCostMinor(price,input.quantity,currency!,input.fxRate)>input.maxCostMinor)throw new DeliveryError('Supplier cost exceeds the locked customer payment; administrator review required.')
 }
 const parse=(payload:Record<string,unknown>):Delivery=>{
  const d=provider==='digitalcore'?payload:provider==='shopviaclone22'?(objectSafe(payload.order)??objectSafe(payload.data)??payload):object(payload.data)
  const rawId=provider==='hstora'?d.id:provider==='shopviaclone22'?(d.order_id??d.id??payload.order_id??payload.id):d.order_id
  const id=receipt(rawId)
  if(provider==='hstora'&&d.external_order_id!==input.requestId)throw new DeliveryError('HStora order reference mismatch.','uncertain')
  const delivery=objectSafe(d.delivery)
  const rawItems=provider==='youngpg'?d.accounts:provider==='hstora'?delivery?.items:provider==='shopviaclone22'?(d.items??d.accounts??d.code??d.data??d.text??payload.items??payload.accounts??payload.code):d.items
  const deliveredItems=items(rawItems,input.quantity)
  const ready=provider==='hstora'?d.status==='delivered'&&delivery?.available===true:provider==='digitalcore'?Number(d.quantity)===input.quantity:provider==='shopviaclone22'?(d.status==='completed'||d.status==='delivered'||d.status==='success'||payload.status==='success'||deliveredItems.length===input.quantity):true
  return{receipt:id,items:deliveredItems,delivered:ready&&deliveredItems.length===input.quantity}
 }
 return{
  async buy(){
   if(input.recovering)throw new DeliveryError('A previous purchase must be reconciled, never purchased again.','uncertain')
   if(provider==='hstora'){const path='/api/v1/orders',body=JSON.stringify({product_id:Number(input.externalId),quantity:input.quantity,external_order_id:input.requestId});return parse(await request('https://hstora.com'+path,await hheaders(path,'',body),'POST',body))}
   if(provider==='shopviaclone22'){
    const baseUrl=credentials.baseUrl?.trim()||'https://shopviaclone22.com/api'
    const key=credentials.apiKey?.trim()||credentials.key?.trim()||''
    const url=`${baseUrl.replace(/\/+$/,'')}/buy_product`
    const body=new URLSearchParams({api_key:key,product:input.externalId,amount:String(input.quantity),custom_order_id:input.requestId}).toString()
    const shopHeaders=new Headers({Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'})
    return parse(await request(url,shopHeaders,'POST',body))
   }
   const url=provider==='youngpg'?YOUNGPG_ORIGIN+'/api/v1/purchase':'https://digitalcore.top/api/user/buy'
   const body=provider==='youngpg'?{slug:input.slug,quantity:input.quantity}:{id:input.externalId,count:input.quantity}
   return parse(await request(url,headers,'POST',JSON.stringify(body)))
  },
  async poll(id:string){
   if(provider==='hstora'){const path='/api/v1/orders/lookup',query='external_order_id='+encodeURIComponent(input.requestId);return parse(await request('https://hstora.com'+path+'?'+query,await hheaders(path,query)))}
   if(provider==='shopviaclone22'){
    const baseUrl=credentials.baseUrl?.trim()||'https://shopviaclone22.com/api'
    const key=credentials.apiKey?.trim()||credentials.key?.trim()||''
    const rId=encodeURIComponent(receipt(id))
    const url=`${baseUrl.replace(/\/+$/,'')}/order.php?api_key=${encodeURIComponent(key)}&order=${rId}&order_id=${rId}`
    const result=parse(await request(url,new Headers({Accept:'application/json'})))
    if(result.receipt!==id)throw new DeliveryError('Supplier receipt identity mismatch.','uncertain')
    return result
   }
   const url=provider==='youngpg'?YOUNGPG_ORIGIN+'/api/v1/orders/'+encodeURIComponent(receipt(id)):'https://digitalcore.top/api/user/order?id='+encodeURIComponent(receipt(id))
   const result=parse(await request(url,headers));if(result.receipt!==id)throw new DeliveryError('Supplier receipt identity mismatch.','uncertain');return result
  }
 }
}
