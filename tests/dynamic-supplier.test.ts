import test from 'node:test'
import assert from 'node:assert/strict'
import { sealCredential, openCredential } from '../server/supplier-crypto.ts'
import { supplierOrigin, minorPrice, listingsFrom, pageIsComplete, youngpgGet } from '../server/youngpg.ts'
import { onRequestGet, onRequestPost } from '../functions/api/admin/suppliers.ts'
import { onRequestPost as checkout } from '../functions/api/checkout.ts'
const connectionId = '11111111-1111-4111-8111-111111111111'
const encryption = btoa('k'.repeat(32)) // Synthetic test secret, never application configuration.
const apiKey = 'ypg_' + 'a'.repeat(48)
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-backend-only-key', SUPPLIER_ENCRYPTION_KEY: encryption }
const request = (body: unknown) => new Request('https://app.test/api/admin/suppliers', { method: 'POST', headers: { Authorization: 'Bearer synthetic-token-over-twenty-characters', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
function authResponse(url: URL, role = 'admin') {
  if (url.pathname === '/auth/v1/user') return Response.json({ id: connectionId, email_confirmed_at: '2026-10-11T00:00:00Z' })
  if (url.pathname === '/rest/v1/user_roles') return Response.json([{ role }])
  return null
}
test('AES-GCM storage is randomized, tamper resistant and bound to the supplier ID', async () => {
  const first = await sealCredential(apiKey, connectionId, encryption)
  const second = await sealCredential(apiKey, connectionId, encryption)
  assert.notEqual(first.ciphertext, second.ciphertext)
  assert.ok(!first.ciphertext.includes(apiKey))
  assert.equal(await openCredential(first.ciphertext, first.nonce, connectionId, encryption), apiKey)
  await assert.rejects(openCredential(first.ciphertext, first.nonce, 'another-supplier', encryption))
  await assert.rejects(openCredential('invalid-ciphertext', first.nonce, connectionId, encryption))
  await assert.rejects(sealCredential(apiKey, connectionId, ''))
})
test('only the documented public HTTPS origin is accepted', () => {
  assert.equal(supplierOrigin('https://youngpgmedia.com.ng'), 'https://youngpgmedia.com.ng')
  for (const value of ['http://youngpgmedia.com.ng', 'https://127.0.0.1', 'https://[::1]', 'https://10.0.0.1', 'https://localhost', 'https://youngpgmedia.com.ng@evil.test', 'https://youngpgmedia.com.ng:444', 'https://youngpgmedia.com.ng/api', 'https://shopviaclone22.com']) assert.throws(() => supplierOrigin(value))
})
test('NGN mapping is exact and imports require individual authorization and valid stock', () => {
  assert.equal(minorPrice('12.30'), 1230)
  assert.equal(minorPrice(0.01), 1)
  for (const price of [-1, null, '', 'NaN', '1.001', '1e3', '1000000000']) assert.throws(() => minorPrice(price))
  const item = { id: 3, category: { slug: 'licensed-resources', title: 'Licensed resources' }, title: 'Licensed artwork', description: 'Authorized digital artwork for transfer.', price_ngn: '12.30', available_stock: 4 }
  const categories = [{ id: '1', slug: 'licensed-resources', name: 'Licensed resources' }]
  assert.equal(listingsFrom([item], categories, {}).products.length, 0)
  const [result] = listingsFrom([item], categories, { '3': 'license-evidence-reference' }).products
  assert.equal(result.cost_minor, 1230); assert.equal(result.currency, 'NGN'); assert.equal(result.stock, 4)
  assert.ok(!('price_minor' in result), 'Supplier cost cannot overwrite retail prices')
  assert.equal(listingsFrom([{ ...item, title: 'Session cookies' }], categories, { '3': 'license-evidence-reference' }).products.length, 0)
  for (const stock of [-1, null, '1.2', 1000001]) assert.throws(() => listingsFrom([{ ...item, available_stock: stock }], categories, { '3': 'license-evidence-reference' }))
  assert.throws(() => listingsFrom([item, item], categories, { '3': 'license-evidence-reference' }))
})
test('incomplete or unsupported pagination cannot be treated as a complete catalog', () => {
  assert.equal(pageIsComplete({ data: [], meta: { current_page: 1, last_page: 2 } }, 1, 100), false)
  assert.equal(pageIsComplete({ data: [], meta: { current_page: 2, last_page: 2 } }, 2, 1), true)
  assert.throws(() => pageIsComplete({ data: [] }, 1, 100))
  assert.throws(() => pageIsComplete({ data: [] }, 1, 1))
  assert.throws(() => pageIsComplete({ data: [], meta: { current_page: 1, last_page: 1001 } }, 1, 100))
})
test('YoungPG requests use a header, read-only routes, redirect refusal and redact upstream errors', async t => {
  t.mock.method(globalThis, 'fetch', async (input: unknown, options: RequestInit) => {
    const url = new URL(String(input))
    assert.equal(url.origin, 'https://youngpgmedia.com.ng')
    assert.equal(url.pathname, '/api/v1/listings')
    assert.ok(!url.href.includes(apiKey)); assert.equal(new Headers(options.headers).get('X-API-Key'), apiKey)
    assert.equal(options.redirect, 'manual'); assert.ok(!options.method || options.method === 'GET')
    throw new Error(apiKey)
  })
  await assert.rejects(youngpgGet('https://youngpgmedia.com.ng', apiKey, 'listings'), error => error instanceof Error && !error.message.includes(apiKey))
})
test('a customer cannot read or replace supplier credentials despite forged metadata', async t => {
  t.mock.method(globalThis, 'fetch', async input => {
    const response = authResponse(new URL(String(input)), 'customer')
    assert.ok(response, 'No credential storage or upstream access permitted')
    return response
  })
  assert.equal((await onRequestPost({ request: request({ action: 'save', api_key: apiKey }), env })).status, 403)
  assert.equal((await onRequestGet({ request: new Request('https://app.test/api/admin/suppliers', { headers: { Authorization: 'Bearer synthetic-token-over-twenty-characters' } }), env })).status, 403)
})
test('an upstream credential echo is rejected rather than returned as catalog metadata', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, data: [{ id: 1, name: apiKey }] }))
  await assert.rejects(youngpgGet('https://youngpgmedia.com.ng', apiKey, 'categories'), error => error instanceof Error && !error.message.includes(apiKey))
})
test('a dynamic supplier cooldown stops all external requests before categories or listings', async t => {
  const sealed = await sealCredential(apiKey, connectionId, encryption)
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(String(input)); const identity = authResponse(url)
    if (identity) return identity
    if (url.pathname === '/rest/v1/supplier_connections') return Response.json({ id: connectionId, revision: 1, enabled: true, provider: 'youngpg', auth_method: 'X-API-Key', base_url: 'https://youngpgmedia.com.ng', encrypted_key: sealed.ciphertext, key_nonce: sealed.nonce })
    if (url.pathname === '/rest/v1/rpc/claim_supplier_sync_batch') return Response.json(null)
    assert.fail('No supplier fetch or catalog write is permitted during cooldown')
  })
  assert.equal((await onRequestPost({ request: request({ action: 'sync', id: connectionId }), env })).status, 429)
})
test('key save/replacement sends ciphertext to backend storage and never returns credentials', async t => {
  const stored: { cipher: string; nonce: string; expected_revision: number }[] = []
  t.mock.method(globalThis, 'fetch', async (input, options: RequestInit) => {
    const url = new URL(String(input)); const identity = authResponse(url)
    if (identity) return identity
    assert.equal(url.pathname, '/rest/v1/rpc/save_supplier_connection')
    const body = JSON.parse(String(options.body))
    assert.ok(!String(options.body).includes(apiKey)); assert.ok(!('api_key' in body.settings))
    stored.push(body); return Response.json(null)
  })
  for (const revision of [1, 2]) {
    const response = await onRequestPost({ request: request({ action: 'save', id: connectionId, revision, provider: 'youngpg', name: 'YoungPG', base_url: 'https://youngpgmedia.com.ng', enabled: true, authorized_products: {}, api_key: apiKey }), env })
    assert.equal(response.status, 200)
    const text = await response.text(); assert.ok(!text.includes(apiKey)); assert.ok(!text.includes('cipher'))
  }
  assert.notEqual(stored[0].cipher, stored[1].cipher)
  assert.equal(stored[1].expected_revision, 2)
  assert.equal(await openCredential(stored[1].cipher, stored[1].nonce, connectionId, encryption), apiKey)
})
test('saved configuration responses explicitly project metadata without encrypted credentials', async t => {
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(String(input)); const identity = authResponse(url)
    if (identity) return identity
    assert.equal(url.pathname, '/rest/v1/supplier_connections')
    assert.ok(!url.searchParams.get('select')!.includes('key'))
    return Response.json([{ id: connectionId, name: 'YoungPG' }])
  })
  const response = await onRequestGet({ request: new Request('https://app.test/api/admin/suppliers', { headers: { Authorization: 'Bearer synthetic-token-over-twenty-characters' } }), env })
  assert.equal(response.status, 200); assert.ok(!(await response.text()).includes(apiKey))
})
test('sync authenticates then checkpoints only normalized authorized metadata and exact supplier cost', async t => {
  const sealed = await sealCredential(apiKey, connectionId, encryption)
  let committed = false
  t.mock.method(globalThis, 'fetch', async (input, options: RequestInit) => {
    const url = new URL(String(input)); const identity = authResponse(url)
    if (identity) return identity
    if (url.pathname === '/rest/v1/supplier_connections' && options?.method === 'PATCH') return Response.json([{ id: connectionId }])
    if (url.pathname === '/rest/v1/supplier_connections') return Response.json({ id: connectionId, revision: 1, enabled: true, provider: 'youngpg', auth_method: 'X-API-Key', base_url: 'https://youngpgmedia.com.ng', encrypted_key: sealed.ciphertext, key_nonce: sealed.nonce, authorized_products: { '3': 'license-evidence-reference' } })
    if (url.pathname === '/rest/v1/rpc/claim_supplier_sync_batch') return Response.json({ job_id: connectionId, token: connectionId, revision: 1, phase: 'listings', page: 1, categories: [{ id: '1', slug: 'licensed-resources', name: 'Licensed resources' }] })
    if (url.pathname === '/api/v1/categories/1/subcategories') return Response.json({ success: true, data: { category: { id: 1 }, subcategories: [] } })
    if (url.pathname === '/api/v1/categories') return Response.json({ success: true, data: [{ id: 1, slug: 'licensed-resources', title: 'Licensed resources' }] })
    if (url.pathname === '/api/v1/listings') return Response.json({ success: true, data: [{ id: 3, category: { slug: 'licensed-resources', title: 'Licensed resources' }, title: 'Licensed artwork', description: 'Permitted digital resource for resale.', price_ngn: '20.05', available_stock: 4 }, { id: 4, title: 'Unverified listing' }], meta: { current_page: 1, last_page: 1 } })
    assert.equal(url.pathname, '/rest/v1/rpc/commit_supplier_sync_batch')
    const body = JSON.parse(String(options.body)); assert.equal(body.batch.rows.filter((row: { product: unknown }) => row.product).length, 1); assert.equal(body.batch.rows[0].product.cost_minor, 2005)
    assert.ok(!JSON.stringify(body).includes(apiKey)); assert.equal(body.batch.rows[1].product, null)
    committed = true; return Response.json({ done: false, job_id: connectionId, scanned: 2 })
  })
  const response = await onRequestPost({ request: request({ action: 'sync', id: connectionId }), env })
  assert.equal(response.status, 200); assert.equal((await response.json() as { done: boolean }).done, false); assert.ok(committed)
})
test('checkout remains unavailable and cannot fabricate a charge or order', async () => {
  assert.equal(checkout().status, 503)
})
