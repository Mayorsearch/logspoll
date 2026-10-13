import test from 'node:test'
import assert from 'node:assert/strict'
import { sealCredential, openCredential } from '../server/supplier-crypto.ts'
import { supplierOrigin, minorPrice, listingsFrom, pageIsComplete, youngpgGet } from '../server/youngpg.ts'
import { onRequestPost as checkout } from '../functions/api/checkout.ts'
const connectionId = '11111111-1111-4111-8111-111111111111'
const encryption = btoa('k'.repeat(32)) // Synthetic test secret, never application configuration.
const apiKey = 'ypg_' + 'a'.repeat(48)
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
test('an upstream credential echo is rejected rather than returned as catalog metadata', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, data: [{ id: 1, name: apiKey }] }))
  await assert.rejects(youngpgGet('https://youngpgmedia.com.ng', apiKey, 'categories'), error => error instanceof Error && !error.message.includes(apiKey))
})
test('checkout remains unavailable and cannot fabricate a charge or order', async () => {
  assert.equal(checkout().status, 503)
})
