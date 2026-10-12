import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNGNMinor, checkedPaidSandboxSession, parseBachsEvent } from '../server/bachs-flow.ts'
import { createSandboxSession } from '../server/bachs.ts'

test('NGN payment amounts are parsed exactly; nonnumeric or zero values are refused', () => {
  assert.equal(parseNGNMinor('25.07'),2507)
  assert.equal(parseNGNMinor('1'),100)
  for (const value of [0,'0.00','0.001','NaN','-1','1e3','1000000000']) assert.equal(parseNGNMinor(value),null)
})
test('Bachs retrieved checkout requires completed succeeded one-time payment, currency and reference', () => {
  const id='chk_1234567890',orderId='11111111-1111-4111-8111-111111111111'
  const record={checkout_id:id,reference:orderId,status:'completed',payment_status:'succeeded',session_mode:'CART',recurring:null,source_type:'CHECKOUT_SESSION',charge:{status:'succeeded'},amount:'50.25',currency:'NGN'}
  assert.deepEqual(checkedPaidSandboxSession(record,id),{orderId,checkoutId:id,totalMinor:5025,currency:'NGN'})
  for (const changed of [{status:'open'},{payment_status:'no_payment_required'},{session_mode:'SUBSCRIPTION'},{charge:null},{charge:{status:'failed'}},{amount:'0.00'},{currency:'USD'},{reference:'another-order'},{checkout_id:'chk_wrong_2345'}]) {
    assert.equal(checkedPaidSandboxSession({...record,...changed},id),null)
  }
})
test('a malformed or unsupported Bachs webhook is never a fulfillment instruction', () => {
  assert.deepEqual(parseBachsEvent({id:'evt_123456789',type:'checkout.completed',data:{checkout_id:'chk_1234567890'}}),{
    eventId:'evt_123456789',eventType:'checkout.completed',checkoutId:'chk_1234567890'})
  for (const event of [{id:'evt_123456789',type:'collection.failed',data:{checkout_id:'chk_1234567890'}},
    {id:'evt_123456789',type:'collection.succeeded',data:{checkout_id:''}},
    {id:'invalid',type:'checkout.completed',data:{checkout_id:'chk_1234567890'}}]) assert.equal(parseBachsEvent(event),null)
})
test('sandbox checkout includes durable reference and allows omitted local return URLs', async t => {
  const orderId='11111111-1111-4111-8111-111111111111'
  t.mock.method(globalThis,'fetch',async (_: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    assert.equal(body.reference,orderId)
    assert.equal(body.metadata.order_id,orderId)
    assert.equal(body.pricing.amount,'14.50')
    assert.equal('success_url' in body,false)
    assert.equal(new Headers(init.headers).get('Idempotency-Key'),'sandbox_11111111111141118111111111111111')
    return Response.json({checkout_id:'chk_1234567890',checkout_url:'https://checkout.bachs.io/c/abc12345'})
  })
  await createSandboxSession({key:'sk_sandbox_'+'a'.repeat(30),amountMinor:1450,buyerEmail:'test@example.com',orderId,
    idempotencyKey:'sandbox_11111111111141118111111111111111'})
})
