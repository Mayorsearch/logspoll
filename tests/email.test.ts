import test from 'node:test'
import assert from 'node:assert/strict'
import { emailTemplates, renderEmail, sampleEmail, isEmailKind } from '../src/lib/email-templates.ts'
import type { EmailKind } from '../src/lib/email-templates.ts'
import { emailTestReady, sendTestEmail } from '../server/email.ts'

const now = Date.parse('2026-10-12T12:00:00Z')
const env = { AUTH_ORIGIN: 'https://staging.test', RESEND_API_KEY: 're_synthetic_only', EMAIL_FROM: 'no-reply@logspoll.com', EMAIL_TEST_TO: 'approved@example.test', EMAIL_TEST_ENABLED: 'true' }
const input = { template: 'verification', requestId: '11111111-1111-4111-8111-111111111111', startedAt: now }
test('all 22 templates have HTML, text, synthetic labels and safe account links', () => {
  assert.equal(Object.keys(emailTemplates).length, 22)
  for (const kind of Object.keys(emailTemplates) as EmailKind[]) {
    const email = sampleEmail(kind)
    assert.match(email.html, /Nunito Sans|Arial/)
    assert.match(email.html, /SAMPLE EMAIL/)
    assert.match(email.html, /max-width:6[02]0px/)
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
  assert.doesNotMatch(email.html, /<img src=x|<b>private/)
  assert.match(email.html, /&lt;img/)
  assert.match(email.text, /1,250\.00/)
  assert.throws(() => renderEmail('payment_receipt', { amountMinor: -1 }))
  assert.throws(() => renderEmail('payment_receipt', { amountMinor: 1.1 }))
  assert.throws(() => renderEmail('security_alert', { occurredAt: 'not-a-date' }))
  assert.throws(() => renderEmail('verification'))
  for (const confirmationUrl of ['javascript:alert(1)', 'https://evil.test/auth/v1/verify', 'https://staging.test/wrong-path', 'https://user:pass@staging.test/auth/v1/verify']) assert.throws(() => renderEmail('password_reset', { confirmationUrl, confirmationOrigin: env.AUTH_ORIGIN }))
  assert.match(renderEmail('verification', { verificationCode:'123456' }).html, /123456/)
})
test('failure notifications distinguish payment from fulfillment and do not promise refunds', () => {
  const email = renderEmail('transaction_failed', { failureStage: 'fulfillment', refundStatus: 'not_confirmed' })
  assert.match(email.text, /Supplier fulfillment \(payment may have succeeded\)/)
  assert.match(email.text, /Refund status: not confirmed/)
  assert.match(renderEmail('order_cancelled').text, /does not confirm a refund/)
  assert.match(renderEmail('order_delivered').text, /Sensitive access details are never included/)
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

test('premium OTP and security templates reuse supplied design and inline logo without authentication links',()=>{
 for(const kind of ['verification','password_reset','welcome','password_changed'] as const){
  const email=renderEmail(kind,{verificationCode:'123456',firstName:'<script>alert(1)</script>'})
  assert.match(email.html,/cid:logspoll-premium-logo/);assert.match(email.html,/#FFF9F6|#F3F3FB/)
  assert.match(email.text,/LogsPoll/);assert.doesNotMatch(email.html,/<script>/)
  assert.doesNotMatch(email.html,/LOGSPOLL|token=|\{\{|reset_url|verification_code/)
  assert.ok('attachments' in email&&email.attachments[0].content.length>10000)
  if(kind==='verification'||kind==='password_reset'){assert.match(email.text,/123456/);assert.match(email.text,/10 minutes/);assert.doesNotMatch(email.html,/href="[^"]*(verify-email|reset-password)/)}
 }
 for(const code of ['12345','abcdef','<img src=x>'])assert.throws(()=>renderEmail('verification',{verificationCode:code}))
})
