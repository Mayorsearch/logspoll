import test from 'node:test'
import assert from 'node:assert/strict'
import{createHmac}from'node:crypto'
import{hstoraHeaders,hstoraCatalogPages,readHstoraPage,readHstoraDetail,readHstoraBalance,generateHstoraNonce,normalizeHstoraProduct,normalizeHstoraBaseUrl}from'../server/hstora.ts'
const credentials={key:'hs_pk_test_only',secret:'hs_sk_test_only'}
const product=(id:number)=>({id,name:'VPN subscription '+id,price:'0.02',currency:'USD',stock_available:5,description:'Supplier provided subscription description',price_tiers:[{min_quantity:100,unit_price:'0.019'}]})
test('HStora signs exact documented GET path and raw query; never signs purchase endpoints',async()=>{
 const path='/api/v1/catalog',query='page=2&limit=50',timestamp='1792000000',nonce='nonce'
 const headers=await hstoraHeaders(credentials,path,query,timestamp,nonce)
 assert.equal(headers.get('X-Signature'),createHmac('sha256',credentials.secret).update(['GET',path,query,timestamp,nonce,''].join('\n')).digest('hex'))
 assert.equal(headers.get('X-API-Key'),credentials.key)
 await assert.rejects(hstoraHeaders(credentials,'/api/v1/orders',''))
})
test('HStora signs /api/v1/balance with empty query and body hash, and parses balance envelope',async t=>{
 const path='/api/v1/balance',timestamp='1792000000',nonce='balance-nonce'
 const headers=await hstoraHeaders(credentials,path,'',timestamp,nonce)
 assert.equal(headers.get('X-Signature'),createHmac('sha256',credentials.secret).update(['GET',path,'',timestamp,nonce,''].join('\n')).digest('hex'))
 assert.equal(headers.get('Origin'),null)

 t.mock.method(globalThis,'fetch',async(url,init)=>{
  assert.equal(String(url),'https://hstora.com/api/v1/balance')
  assert.equal(init?.method,'GET')
  return Response.json({success:true,data:{balance:4.887,pending_balance:0,currency:'USD'}})
 })
 const res=await readHstoraBalance(credentials)
 assert.equal(res.balance,4.887)
 assert.equal(res.pending_balance,0)
 assert.equal(res.currency,'USD')
})
test('generateHstoraNonce produces unique 32-character lowercase hex strings',()=>{
 const n1=generateHstoraNonce(),n2=generateHstoraNonce()
 assert.match(n1,/^[0-9a-f]{32}$/)
 assert.match(n2,/^[0-9a-f]{32}$/)
 assert.notEqual(n1,n2)
})
test('complete pagination preserves supplier IDs, server1 mapping, native currency and fractional tiers',async t=>{
 const pages:number[]=[]
 t.mock.method(globalThis,'fetch',async(url,init)=>{assert.equal(init?.redirect,'manual');assert.equal(init?.method,'GET');const page=Number(new URL(String(url)).searchParams.get('page'));pages.push(page);return Response.json({success:true,data:{items:page===1?[product(1),product(2)]:[product(3)],pagination:{page,limit:2,total:3,pages:2}}})})
 const items=[];for await(const batch of hstoraCatalogPages(credentials,2))items.push(...batch.items)
 assert.deepEqual(pages,[1,2]);assert.equal(items.length,3)
 for(const item of items){assert.equal(item.supplier,'hstora');assert.equal(item.storefront_category,'server1');assert.equal(item.currency,'USD');assert.equal(item.price_tiers[0].unit_price,'0.019');assert.equal(item.review_required,true)}
})
test('missing descriptions and images remain missing; sensitive payload fields are excluded',()=>{
 const normalized=normalizeHstoraProduct({...product(1),description:undefined,password:'NEVER-STORE',delivery:{items:['NEVER-STORE']},image_url:'https://cdn.example/image.png?token=NEVER-STORE'})
 assert.equal(normalized.description,'');assert.equal(normalized.requires_details,true);assert.deepEqual(normalized.images,[])
 assert.doesNotMatch(JSON.stringify(normalized),/NEVER-STORE|password|delivery/)
})
test('rate limits retain safe retry information without leaking upstream credentials',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({secret:'NEVER-RETURN'},{status:429,headers:{'Retry-After':'60'}}))
 await assert.rejects(readHstoraPage(credentials),error=>{assert.equal((error as {retryAfterMs:number}).retryAfterMs,60000);assert.doesNotMatch(String(error),/NEVER-RETURN|hs_sk/);return true})
})
test('duplicates, pagination drift and wrong detail identity fail closed',async t=>{
 t.mock.method(globalThis,'fetch',async url=>{const page=Number(new URL(String(url)).searchParams.get('page'));return Response.json({success:true,data:{items:[product(1)],pagination:{page,limit:1,total:page===1?2:3,pages:page===1?2:3}}})})
 await assert.rejects(async()=>{for await(const batch of hstoraCatalogPages(credentials,1))void batch},/snapshot changed/)
 t.mock.method(globalThis,'fetch',async()=>Response.json({success:true,data:product(2)}))
 await assert.rejects(readHstoraDetail(credentials,'1'),/identity mismatch/)
})

test('provider rejection distinguishes HTTP status and gateway response without exposing response secrets',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('private upstream details',{status:403,headers:{'Content-Type':'text/html'}}))
 await assert.rejects(readHstoraPage(credentials,1,1),error=>error instanceof Error&&error.message.includes('HTTP 403: non-JSON gateway rejection')&&!error.message.includes('private upstream'))
})

test('documented HStora origin rejection is actionable and redacts arbitrary provider messages',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:{code:'origin_not_allowed',message:'SECRET-MUST-NOT-LEAK'}},{status:403}))
 await assert.rejects(readHstoraPage(credentials,1,1),e=>e instanceof Error&&e.message.includes('origin_not_allowed')&&e.message.includes('logspoll.com')&&!e.message.includes('SECRET'))
})

test('HStora gateway failure retains safe request identifier but never response body',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('private upstream HTML',{status:403,headers:{'Content-Type':'text/html','cf-ray':'a4b4dda409e10365-CDG'}}))
 await assert.rejects(readHstoraPage(credentials,1,1),e=>e instanceof Error&&e.message.includes('CF-Ray a4b4dda409e10365-CDG')&&!e.message.includes('private upstream'))
})

 test('gateway challenges preserve both safe identifiers and never reveal the body',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response('SECRET-PROVIDER-BODY',{status:403,headers:{'Content-Type':'text/html','cf-mitigated':'challenge','cf-ray':'a4b72d8baf5148a8-CDG','x-request-id':'request-12345678'}}))
  await assert.rejects(readHstoraPage(credentials,1,1),error=>error instanceof Error&&error.message.includes('Cloudflare challenge')&&error.message.includes('a4b72d8baf5148a8-CDG')&&error.message.includes('request-12345678')&&!error.message.includes('SECRET'))
 })
 test('allowed domain header and raw query follow the documented signature without adding Referer',async()=>{
  const headers=await hstoraHeaders({...credentials,allowedOrigin:'https://logspoll.com'},'/api/v1/catalog','page=1&limit=20','1792000000','fresh-nonce')
  assert.equal(headers.get('Origin'),'https://logspoll.com');assert.equal(headers.get('Referer'),null)
  assert.equal(headers.get('X-Signature'),createHmac('sha256',credentials.secret).update(['GET','/api/v1/catalog','page=1&limit=20','1792000000','fresh-nonce',''].join('\n')).digest('hex'))
 })
 test('normalizeHstoraBaseUrl strips trailing /api/v1 and slashes to prevent duplicate path concatenation', () => {
  assert.equal(normalizeHstoraBaseUrl('https://hstora.com/api/v1'), 'https://hstora.com')
  assert.equal(normalizeHstoraBaseUrl('https://hstora.com/api/v1/'), 'https://hstora.com')
  assert.equal(normalizeHstoraBaseUrl('https://hstora.com/api'), 'https://hstora.com')
  assert.equal(normalizeHstoraBaseUrl('https://hstora.com/'), 'https://hstora.com')
  assert.equal(normalizeHstoraBaseUrl('https://hstora.com'), 'https://hstora.com')
  assert.equal(normalizeHstoraBaseUrl(''), 'https://hstora.com')
  assert.equal(normalizeHstoraBaseUrl(undefined), 'https://hstora.com')
 })
