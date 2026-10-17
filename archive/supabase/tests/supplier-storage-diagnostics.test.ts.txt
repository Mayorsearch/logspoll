import test from 'node:test'
import assert from 'node:assert/strict'
import { supplierStorageError, syncSupplier } from '../server/catalog-sync.ts'
import { onRequestGet } from '../functions/api/admin/suppliers.ts'
import { sealCredential } from '../server/supplier-crypto.ts'

const id = '11111111-1111-4111-8111-111111111111'
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key', SUPPLIER_ENCRYPTION_KEY: btoa('k'.repeat(32)) }

test('database diagnostics expose only operation and allowlisted categories', () => {
  for (const [code, category] of Object.entries({ '42703': 'missing column', PGRST202: 'missing RPC', '42501': 'permission denied', '23503': 'foreign-key constraint', '23514': 'validation constraint', '57014': 'database timeout' })) {
    const error = supplierStorageError('finalize snapshot', { code, message: 'private record and credential' })
    assert.match(error.message, /finalize snapshot/)
    assert.ok(error.message.includes(category))
    assert.ok(!error.message.includes('private record'))
  }
  for (const code of ['secret-token', 'constructor', '__proto__']) {
    const error = supplierStorageError('claim lease', { code, message: 'secret-token' })
    assert.match(error.message, /unclassified/)
    assert.ok(!error.message.includes('secret-token'))
  }
  assert.equal(supplierStorageError('record failure', { code: 'P0001', message: 'Supplier lease expired' }).status, 409)
})

test('expired progress is reported without exposing lease internals or mutating records', async t => {
  t.mock.method(globalThis, 'fetch', async (input, options: RequestInit) => {
    assert.ok(!options.method || options.method === 'GET')
    const url = new URL(String(input))
    if (url.pathname === '/auth/v1/user') return Response.json({ id, email_confirmed_at: '2026-10-11T00:00:00Z' })
    if (url.pathname === '/rest/v1/user_roles') return Response.json({ role: 'admin' })
    if (url.pathname === '/rest/v1/supplier_catalog_jobs') return Response.json({ code: 'PGRST205' }, { status: 404 })
    if (url.pathname === '/rest/v1/supplier_feed_items') return Response.json([], { headers: { 'Content-Range': '*/0' } })
    assert.equal(url.pathname, '/rest/v1/supplier_connections')
    return Response.json([
      { id, lease_until: '2020-01-01T00:00:00Z', running_operation: 'sync', last_status: 'Reading catalog: page 10', imported_count: 2 },
      { id: 'current', lease_until: '2099-01-01T00:00:00Z', running_operation: 'sync', last_status: 'Reading catalog: page 1' },
    ])
  })
  const response = await onRequestGet({ request: new Request('https://app.test/api/admin/suppliers', { headers: { Authorization: 'Bearer synthetic-token-over-twenty-characters' } }), env })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.match(body.suppliers[0].last_status, /lease expired.*page 10/)
  assert.equal(body.suppliers[0].imported_count, 2)
  assert.equal(body.sync.ready, false)
  assert.match(body.sync.blockers[0], /202610120002/)
  assert.equal(body.suppliers[1].last_status, 'Reading catalog: page 1')
  assert.ok(!JSON.stringify(body).includes('lease_until'))
  assert.ok(!JSON.stringify(body).includes('running_operation'))
})

test('RPC finalization and cleanup failures retain both redacted diagnostic contexts', async t => {
  const sealed = await sealCredential('ypg_' + 'a'.repeat(48), id, env.SUPPLIER_ENCRYPTION_KEY)
  let finishes = 0
  t.mock.method(globalThis, 'fetch', async (input, options: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === '/rest/v1/supplier_connections') return Response.json({ id, revision: 1, enabled: true, provider: 'youngpg', auth_method: 'X-API-Key', base_url: 'https://youngpgmedia.com.ng', encrypted_key: sealed.ciphertext, key_nonce: sealed.nonce, authorized_products: {} })
    if (url.pathname === '/rest/v1/rpc/claim_supplier_connection') return Response.json(id)
    if (url.pathname === '/api/v1/categories') return Response.json({ success: true, data: [{ id: 1, title: 'Software', slug: 'software' }] })
    assert.equal(url.pathname, '/rest/v1/rpc/finish_supplier_connection')
    finishes++
    const body = JSON.parse(String(options.body))
    if (finishes === 1) {
      assert.equal(body.failure, null)
      return Response.json({ code: '23503', message: 'private constraint and credential' }, { status: 400 })
    }
    assert.ok(!body.failure.includes('private constraint'))
    return Response.json({ code: 'P0001', message: 'Supplier lease expired' }, { status: 400 })
  })
  await assert.rejects(syncSupplier(env, id, 'test'), error => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /finalize snapshot: foreign-key constraint/)
    assert.match(error.message, /record failure: lease expired/)
    assert.ok(!error.message.includes('private constraint'))
    return true
  })
  assert.equal(finishes, 2)
})
