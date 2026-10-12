import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { emailTemplates, renderEmail, sampleEmail, isEmailKind } from '../src/lib/email-templates.ts'
import type { EmailKind } from '../src/lib/email-templates.ts'
import { emailTestReady, sendTestEmail } from '../server/email.ts'
import { onRequestGet, onRequestPost } from '../functions/api/admin/email.ts'

const now = Date.parse('2026-10-12T12:00:00Z')
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic', RESEND_API_KEY: 're_synthetic_only', EMAIL_FROM: 'no-reply@logspoll.com', EMAIL_TEST_TO: 'approved@example.test', EMAIL_TEST_ENABLED: 'true' }
const input = { template: 'verification', requestId: '11111111-1111-4111-8111-111111111111', startedAt: now }
test('all 22 templates have HTML, text, synthetic labels and safe account links', () => {
  assert.equal(Object.keys(emailTemplates).length, 22)
  for (const kind of Object.keys(emailTemplates) as EmailKind[]) {
    const email = sampleEmail(kind)
    assert.match(email.html, /Nunito Sans/)
    assert.match(email.html, /SAMPLE EMAIL/)
    assert.match(email.html, /max-width:600px/)
    assert.match(email.text, /SAMPLE EMAIL/)
    assert.match(email.text, /Support: https:\/\/logspoll.com\/support/)
    assert.doesNotMatch(email.text, /<html|<table/)
    assert.doesNotMatch(email.html, /<script|<form|@import|url\(/)
  }
  assert.equal(isEmailKind('toString'), false)
  assert.equal(isEmailKind('__proto__'), false)
})
test('customer fields are escaped; invalid financial facts and auth origins are rejected', () => {
  const email = renderEmail('payment_receipt', { firstName: '<img src=x onerror="steal()">', reference: '<b>private</b>', amountMinor: 125000 })
  assert.doesNotMatch(email.html, /<img|<b>private/)
  assert.match(email.html, /&lt;img/)
  assert.match(email.text, /1,250\.00/)
  assert.throws(() => renderEmail('payment_receipt', { amountMinor: -1 }))
  assert.throws(() => renderEmail('payment_receipt', { amountMinor: 1.1 }))
  assert.throws(() => renderEmail('security_alert', { occurredAt: 'not-a-date' }))
  assert.throws(() => renderEmail('verification'))
  for (const confirmationUrl of ['javascript:alert(1)', 'https://evil.test/auth/v1/verify', 'https://project.supabase.co/wrong-path', 'https://user:pass@project.supabase.co/auth/v1/verify']) assert.throws(() => renderEmail('password_reset', { confirmationUrl, confirmationOrigin: env.SUPABASE_URL }))
  assert.match(renderEmail('verification', { confirmationUrl: `${env.SUPABASE_URL}/auth/v1/verify?token=synthetic&type=signup`, confirmationOrigin: env.SUPABASE_URL }).html, /token=synthetic&amp;type=signup/)
})
test('failure notifications distinguish payment from fulfillment and do not promise refunds', () => {
  const email = renderEmail('transaction_failed', { failureStage: 'fulfillment', refundStatus: 'not_confirmed' })
  assert.match(email.text, /Supplier fulfillment \(payment may have succeeded\)/)
  assert.match(email.text, /Refund status: not confirmed/)
  assert.match(renderEmail('order_cancelled').text, /does not confirm a refund/)
  assert.match(renderEmail('order_delivered').text, /Sensitive access details are never included/)
})
test('Supabase export retains native links and contains no invented tokens or preview data', async () => {
  for (const kind of ['verification', 'password_reset', 'password_changed', 'email_changed']) {
    const html = await readFile(new URL(`../emails/supabase/${kind}.html`, import.meta.url), 'utf8')
    assert.doesNotMatch(html, /template\.invalid|SAMPLE EMAIL|SAMPLE-0001/)
    if (['verification', 'password_reset'].includes(kind)) assert.match(html, /\{\{ \.ConfirmationURL \}\}/)
  }
})
test('sending fails closed without approved server settings and rejects invalid/expired retries', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network request') })
  for (const patch of [{ EMAIL_TEST_ENABLED: 'false' }, { RESEND_API_KEY: '' }, { EMAIL_TEST_TO: '' }, { EMAIL_TEST_TO: 'one@example.test,two@example.test' }, { EMAIL_FROM: 'attacker@example.test' }]) {
    assert.equal(emailTestReady({ ...env, ...patch }), false)
    await assert.rejects(sendTestEmail({ ...env, ...patch }, input, now), /disabled/)
  }
  await assert.rejects(sendTestEmail(env, { ...input, template: '__proto__' }, now), /Unknown/)
  await assert.rejects(sendTestEmail(env, { ...input, requestId: 'wrong' }, now), /Invalid/)
  await assert.rejects(sendTestEmail(env, { ...input, startedAt: now - 23 * 3600000 }, now), /window expired/)
  await assert.rejects(sendTestEmail(env, { ...input, startedAt: now + 120000 }, now), /window expired/)
})
test('retries reuse provider idempotency key and immutable synthetic body, including year rollover', async t => {
  const calls: RequestInit[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => { assert.equal(url, 'https://api.resend.com/emails'); calls.push(options); return Response.json({ id: 'provider-test-id' }) })
  const startedAt = Date.parse('2026-12-31T23:55:00Z')
  await sendTestEmail(env, { ...input, startedAt }, startedAt)
  await sendTestEmail(env, { ...input, startedAt }, startedAt + 600000)
  assert.equal(new Headers(calls[0].headers).get('Idempotency-Key'), new Headers(calls[1].headers).get('Idempotency-Key'))
  assert.equal(calls[0].body, calls[1].body)
  const payload = JSON.parse(String(calls[0].body))
  assert.deepEqual(payload.to, ['approved@example.test'])
  assert.match(payload.subject, /^\[TEST\]/)
  assert.match(payload.text, /SAMPLE EMAIL/)
  assert.doesNotMatch(String(calls[0].body), /re_synthetic_only/)
})
test('provider errors and network failures remain redacted, with no success assumed', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ message: 'secret-service-role-token' }, { status: 429 }))
  await assert.rejects(sendTestEmail(env, input, now), error => error instanceof Error && /HTTP 429/.test(error.message) && !error.message.includes('secret-service'))
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('token=private') })
  await assert.rejects(sendTestEmail(env, input, now), /Acceptance is unknown/)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ unexpected: 'private' }))
  await assert.rejects(sendTestEmail(env, input, now), /could not be confirmed/)
})
test('admin endpoint verifies identity/role and strips client recipients/content', async t => {
  let role = 'customer'; let verified = true; let sent = 0
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    const path = new URL(String(url)).pathname
    if (path === '/auth/v1/user') return Response.json({ id: '11111111-1111-4111-8111-111111111111', email_confirmed_at: verified ? '2026-10-12T00:00:00Z' : null })
    if (path === '/rest/v1/user_roles') return Response.json({ role })
    if (String(url) === 'https://api.resend.com/emails') { sent++; assert.deepEqual(JSON.parse(String(options?.body)).to, ['approved@example.test']); assert.doesNotMatch(String(options?.body), /evil|injected/); return Response.json({ id: 'provider-test-id' }) }
    throw new Error('Unexpected network request')
  })
  const make = (authorized = true, origin = 'https://preview.test') => new Request('https://preview.test/api/admin/email', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(authorized ? { Authorization: `Bearer ${'a'.repeat(40)}` } : {}) }, body: JSON.stringify({ ...input, startedAt: Date.now(), to: 'evil@example.test', html: 'injected', role: 'admin' }) })
  assert.equal((await onRequestPost({ request: make(false), env })).status, 401)
  assert.equal((await onRequestPost({ request: make(true, 'https://evil.test'), env })).status, 403)
  assert.equal((await onRequestPost({ request: make(), env })).status, 403)
  role = 'admin'; verified = false
  assert.equal((await onRequestPost({ request: make(), env })).status, 401)
  assert.equal(sent, 0)
  verified = true
  assert.equal((await onRequestPost({ request: make(), env })).status, 200)
  const status = await onRequestGet({ request: make(), env })
  assert.deepEqual(await status.json(), { testReady: true, automaticDelivery: false, provider: 'Resend' })
  assert.equal(sent, 1)
})
