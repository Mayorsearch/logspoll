import test from 'node:test'
import assert from 'node:assert/strict'
import {Miniflare,convertV4MiniflareOptions} from 'miniflare'

test('Cloudflare rejects redirect:error before network; manual is supported',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-10-10',script:`export default{fetch(request){const mode=new URL(request.url).pathname==='/old'?'error':'manual';try{const outbound=new Request('https://api.bachs.io/v1/webhooks/endpoints?limit=100',{redirect:mode});return Response.json({redirect:outbound.redirect})}catch(error){return Response.json({name:error.name,message:error.message})}}}`}))
 try{
  const old=await(await mf.dispatchFetch('http://localhost/old')).json()
  assert.equal(old.name,'TypeError');assert.match(old.message,/Invalid redirect value/)
  const fixed=await(await mf.dispatchFetch('http://localhost/fixed')).json()
  assert.equal(fixed.redirect,'manual')
 }finally{await mf.dispose()}
})
