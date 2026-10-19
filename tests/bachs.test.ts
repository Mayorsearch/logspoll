import test from 'node:test'
import assert from 'node:assert/strict'
import { formatNGN, createSandboxSession, verifyBachsWebhook } from '../server/bachs.ts'

test('NGN amount formatting is exact and refuses invalid prices', () => {
  assert.equal(formatNGN(12345), '123.45')
  assert.equal(formatNGN(1), '0.01')
  for (const invalid of [0, -1, 1.1, Number.NaN, Infinity, 99999999999]) assert.throws(() => formatNGN(invalid))
})

test('sandbox checkout uses bearer auth, raw NGN amount, idempotency and a fixed host', async t => {
  const secret = 'sk_sandbox_' + 'a'.repeat(40)
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://sandbox-api.bachs.io/v1/checkout-sessions')
    assert.equal(init.redirect, 'manual')
    const headers = new Headers(init.headers)
    assert.equal(headers.get('Authorization'), `Bearer ${secret}`)
    assert.equal(headers.get('Idempotency-Key'), 'order_123456789012345')
    const body = JSON.parse(String(init.body))
    assert.deepEqual(body.pricing, { currency: 'NGN', amount: '123.45' })
    return Response.json({ checkout_id: 'chk_1234567890', checkout_url: 'https://sandbox-checkout.bachs.io/c/hello123' })
  })
  assert.deepEqual(await createSandboxSession({ key: secret, amountMinor: 12345, buyerEmail: 'customer@example.com', successUrl: 'https://example.com/checkout/success', cancelUrl: 'https://example.com/cart', idempotencyKey: 'order_123456789012345' }), { checkoutId: 'chk_1234567890', checkoutUrl: 'https://sandbox-checkout.bachs.io/c/hello123' })
})

test('checkout refuses untrusted URLs and malicious destination URL', async t => {
  const data = { key: 'sk_sandbox_' + 'a'.repeat(40), amountMinor: 100, buyerEmail: 'customer@example.com', successUrl: 'https://example.com/success', cancelUrl: 'https://example.com/cart', idempotencyKey: 'order_123456789012345' }
  await assert.rejects(createSandboxSession({ ...data, cancelUrl: 'http://example.com/' }))
  t.mock.method(globalThis, 'fetch', async () => Response.json({ checkout_id: 'chk_1234567890', checkout_url: 'https://attacker.example/c' }))
  await assert.rejects(createSandboxSession(data))
})

test('Bachs HMAC-SHA256 webhook checks timestamp and raw body; V2 accepts rotated signatures', async () => {
  const secret = 'whsec_local_secret_for_tests'
  const ts = 1791750000
  const raw = '{"id":"evt_demo","type":"collection.succeeded"}'
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${raw}`))
  const signature = Array.from(new Uint8Array(signed), x => x.toString(16).padStart(2, '0')).join('')
  const headers = new Headers({ 'X-Bachs-Signature-V2': `t=${ts},v1=${'0'.repeat(64)},v1=${signature}` })
  assert.equal(await verifyBachsWebhook(raw, headers, secret, ts), true)
  assert.equal(await verifyBachsWebhook(raw + ' ', headers, secret, ts), false)
  assert.equal(await verifyBachsWebhook(raw, headers, secret, ts + 301), false)
  assert.equal(await verifyBachsWebhook(raw, new Headers({ 'X-Bachs-Timestamp': String(ts), 'X-Bachs-Signature': signature }), secret, ts), true)
  assert.equal(await verifyBachsWebhook(raw, new Headers({ 'X-Bachs-Signature-V2': `t=${ts},v1=${signature}` }), 'incorrect', ts), false)
})

test('checkout rejects below the documented NGN minimum without contacting Bachs', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw Error('must not call') })
  await assert.rejects(createSandboxSession({key:'sk_sandbox_test',amountMinor:9999,buyerEmail:'test@example.com',idempotencyKey:'minimum_test_12345'}), /at least ₦100\.00/)
  assert.equal(fetch.mock.callCount(), 0)
})

test('checkout reports provider status and allowlisted code without leaking response content', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({error_code:'VALIDATION_ERROR',detail:'sk_live_private customer@example.com'}, {status:400}))
  await assert.rejects(createSandboxSession({key:'sk_sandbox_test',amountMinor:10000,buyerEmail:'test@example.com',idempotencyKey:'diagnostic_test_12345'}), error => {
    assert.match(String(error), /HTTP 400, VALIDATION_ERROR/)
    assert.doesNotMatch(String(error), /sk_live_private|customer@example.com/)
    return true
  })
})

test('checkout accepts exactly the NGN minimum without increasing its amount', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).pricing.amount, '100.00')
    return Response.json({checkout_id:'chk_minimum12345',checkout_url:'https://sandbox-checkout.bachs.io/c/minimum'})
  })
  assert.equal((await createSandboxSession({key:'sk_sandbox_test',amountMinor:10000,buyerEmail:'test@example.com',idempotencyKey:'minimum_boundary_12345'})).checkoutId, 'chk_minimum12345')
})
