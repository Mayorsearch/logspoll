import test from 'node:test'
import assert from 'node:assert/strict'
import {checkoutRequestId,clearCheckoutRequest} from '../src/lib/checkout-request.ts'
const a={id:'11111111-1111-4111-8111-111111111111',quantity:1},b={id:'22222222-2222-4222-8222-222222222222',quantity:2}
function storage(){const values=new Map<string,string>();return{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}}

test('unchanged checkout retries, reordered carts and returning to a cart retain their IDs',()=>{
 const s=storage(),first=checkoutRequestId(s,'customer',[a,b])
 assert.equal(checkoutRequestId(s,'customer',[b,a]),first)
 assert.notEqual(checkoutRequestId(s,'customer',[a]),first)
 assert.equal(checkoutRequestId(s,'customer',[a,b]),first)
})
test('cart quantities, products and customers have independent checkout IDs',()=>{
 const s=storage(),first=checkoutRequestId(s,'customer',[a])
 for(const next of [checkoutRequestId(s,'customer',[{...a,quantity:2}]),checkoutRequestId(s,'customer',[b]),checkoutRequestId(s,'other-customer',[a])])assert.notEqual(next,first)
})
test('legacy attempts survive migration and rotate only after explicit identity rejection',()=>{
 const s=storage(),legacy=crypto.randomUUID();s.setItem('logspoll-checkout-req-id',legacy)
 assert.equal(checkoutRequestId(s,'customer',[a]),legacy)
 const changed=checkoutRequestId(s,'customer',[{...a,quantity:2}]);assert.notEqual(changed,legacy)
 assert.equal(checkoutRequestId(s,'customer',[a]),legacy)
 const fresh=checkoutRequestId(s,'customer',[a],true);assert.notEqual(fresh,legacy)
 assert.equal(checkoutRequestId(s,'customer',[a]),fresh)
})
test('confirmed payment clears only its cart reference',()=>{
 const s=storage(),first=checkoutRequestId(s,'customer',[a]),other=checkoutRequestId(s,'customer',[b])
 clearCheckoutRequest(s,'customer',[a])
 assert.notEqual(checkoutRequestId(s,'customer',[a]),first)
 assert.equal(checkoutRequestId(s,'customer',[b]),other)
})
test('checkout never issues the old non-UUID fallback',()=>{
 const s=storage();s.setItem('logspoll-checkout-req-id','req-old-invalid')
 assert.match(checkoutRequestId(s,'customer',[a]),/^[a-f0-9]{8}-[a-f0-9-]{27}$/)
})
