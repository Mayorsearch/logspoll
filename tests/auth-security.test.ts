import test from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { publicConfigError, safeReturnTo } from '../src/lib/auth-policy.ts'
import { loadOrders } from '../src/lib/customer-data.ts'

test('return routes cannot redirect to an external site or unknown path', () => {
  for (const path of ['https://evil.example', '//evil.example', '/dashboard/../../admin', '/admin/users', '/dashboard?next=https://evil.example']) assert.equal(safeReturnTo(path), '/dashboard')
  assert.equal(safeReturnTo('/dashboard/orders'), '/dashboard/orders')
  assert.equal(safeReturnTo('/admin'), '/admin')
})
test('configuration rejects privileged and malformed keys', () => {
  const jwt = (role: string) => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`
  assert.equal(publicConfigError('https://project.supabase.co', jwt('anon')), null)
  assert.equal(publicConfigError('https://project.supabase.co', 'sb_publishable_test'), null)
  for (const key of [jwt('service_role'), 'sb_secret_test', 'malformed', '']) assert.ok(publicConfigError('https://project.supabase.co', key))
  assert.ok(publicConfigError('http://untrusted.example', 'sb_publishable_test'))
})
test('customer requests always scope records to the authenticated customer', async () => {
  const requests: URL[] = []
  const client = createClient('https://project.supabase.co', 'sb_publishable_test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async input => { requests.push(new URL(String(input))); return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }) } },
  })
  assert.deepEqual(await loadOrders(client, 'customer-a'), [])
  assert.deepEqual(await loadOrders(client, 'customer-b', true), [])
  assert.equal(requests[0].searchParams.get('customer_id'), 'eq.customer-a')
  assert.ok(!requests[0].searchParams.get('select')?.includes('instructions'))
  assert.equal(requests[1].searchParams.get('customer_id'), 'eq.customer-b')
  assert.equal(requests[1].searchParams.get('payment_status'), 'eq.paid')
  assert.equal(requests[1].searchParams.get('fulfillment_status'), 'eq.delivered')
})
test('database errors are never represented as empty successful records', async () => {
  const client = createClient('https://project.supabase.co', 'sb_publishable_test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async () => new Response(JSON.stringify({ code: '42501', message: 'permission denied' }), { status: 403, headers: { 'Content-Type': 'application/json' } }) },
  })
  await assert.rejects(loadOrders(client, 'customer-a'), /could not be loaded/)
})
