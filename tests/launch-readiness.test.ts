import test from 'node:test'
import assert from 'node:assert/strict'
import { launchReadiness } from '../server/launch-readiness.ts'
import { onRequestGet, onRequestPost } from '../functions/api/admin/readiness.ts'
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', BACHS_API_KEY: 'sk_live_private', BACHS_WEBHOOK_SECRET: 'private-webhook', BACHS_SANDBOX_ENABLED: 'true', RESEND_API_KEY: 're_private', EMAIL_FROM: 'no-reply@logspoll.com', EMAIL_TEST_TO: 'approved@example.test', EMAIL_TEST_ENABLED: 'true' }
test('missing migration blocks sync without exposing secrets or upstream errors', async t => {
  t.mock.method(globalThis, 'fetch', async (input, init: RequestInit) => {
    assert.ok(!init.method || init.method === 'GET')
    const url = new URL(String(input))
    if (url.pathname.endsWith('supplier_catalog_jobs')) return Response.json({ code: 'PGRST205', message: 'private detail' }, { status: 404 })
    if (url.searchParams.get('select') === 'publication_enabled') return Response.json({ code: '42703', message: 'private detail' }, { status: 400 })
    return Response.json([], { headers: { 'Content-Range': '*/29' } })
  })
  const r = await launchReadiness(env)
  assert.equal(r.supplier.ready, false); assert.equal(r.supplier.pricingReady, false)
  assert.equal(r.supplier.pending, 29); assert.equal(r.supplier.blockers.length, 2)
  assert.equal(r.payments.keyConfigured, false); assert.equal(r.payments.enabled, false)
  assert.equal(r.payments.liveEnabled, false); assert.equal(r.payments.automaticFulfillment, false)
  assert.equal(r.email.testReady, true); assert.equal(r.email.automaticDelivery, false)
  assert.doesNotMatch(JSON.stringify(r), /private|approved@example|re_private/)
})
test('checkpoint progress and sandbox readiness remain read-only configuration checks', async t => {
  t.mock.method(globalThis, 'fetch', async (input, init: RequestInit) => {
    assert.ok(!init.method || init.method === 'GET')
    return new URL(String(input)).pathname.endsWith('supplier_catalog_jobs') ? Response.json([{ phase: 'listings', scanned: 960, next_page: 11 }]) : Response.json([], { headers: { 'Content-Range': '*/0' } })
  })
  const r = await launchReadiness({ ...env, BACHS_API_KEY: 'sk_sandbox_synthetic' })
  assert.equal(r.supplier.ready, true); assert.equal(r.supplier.progress?.[0].scanned, 960)
  assert.equal(r.payments.enabled, true); assert.equal(r.payments.liveEnabled, false)
})
test('readiness requires a verified administrator; mutations are disabled', async t => {
  const request = new Request('https://app.test/api/admin/readiness')
  assert.equal((await onRequestGet({ request, env })).status, 401)
  assert.equal(onRequestPost().status, 405)
  t.mock.method(globalThis, 'fetch', async input => new URL(String(input)).pathname === '/auth/v1/user' ? Response.json({ id: 'customer', email_confirmed_at: '2026-10-12T00:00:00Z' }) : Response.json({ role: 'customer' }))
  assert.equal((await onRequestGet({ request: new Request(request, { headers: { Authorization: 'Bearer synthetic-long-customer-token' } }), env })).status, 403)
})
