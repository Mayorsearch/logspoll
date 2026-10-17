import test from 'node:test'
import assert from 'node:assert/strict'
import { detailBatch, listingBatch, readBatchResource, syncSupplierBatch } from '../server/catalog-batch.ts'
import { sealCredential } from '../server/supplier-crypto.ts'
import { scheduledSync } from '../workers/catalog-scheduler/index.ts'

const categories = [{ id: '1', slug: 'utilities', name: 'Utilities' }]
const approved = { '1': 'verified-license-1' }
const listing = { id: 1, slug: 'utility', title: 'Licensed utility', description: 'Verified utility for authorized resale.', price_ngn: '20.05', available_stock: 4, category: { slug: 'utilities', title: 'Utilities' } }
const response = (rows: unknown[], extra = {}) => ({ data: rows, meta: { current_page: 1, last_page: 2, total: 2, ...extra } })

test('batches require explicit pagination and exclude private/unapproved fields before persistence', () => {
  const batch = listingBatch(response([{ ...listing, password: 'private', fulfillment: 'private' }, { id: 2, password: 'private' }]), 1, categories, approved)
  assert.equal(batch.rows[0].product?.cost_minor, 2005)
  assert.equal(batch.rows[1].product, null)
  assert.ok(!JSON.stringify(batch).includes('private'))
  assert.throws(() => listingBatch(response([listing, listing]), 1, categories, approved), /Duplicate/)
  assert.throws(() => listingBatch({ data: [listing] }, 1, categories, approved), /pagination/)
  assert.throws(() => listingBatch(response([listing], { total: -1 }), 1, categories, approved), /total/)
})
test('detail batches preserve listing price/stock and require matching identity and authorization', () => {
  const product = listingBatch(response([listing]), 1, categories, approved).rows[0].product!
  const detail = detailBatch(product, { id: 1, price_ngn: '0.01', available_stock: 999, password: 'private', description: 'Supplier replacement', image_url: 'https://cdn.example.test/utility.png' }, categories, approved)
  assert.equal(detail.product?.cost_minor, 2005)
  assert.equal(detail.product?.stock, 4)
  assert.equal(detail.product?.description, listing.description)
  assert.ok(!JSON.stringify(detail).includes('private'))
  assert.equal(detailBatch(product, { id: 1, status: 'sold_out' }, categories, approved).product?.stock, 0)
  assert.throws(() => detailBatch(product, { id: 2 }, categories, approved), /identifier mismatch/)
  assert.equal(detailBatch(product, { id: 1 }, categories, {}).product, null)
})
test('batch transport retries are bounded and rate limits do not occupy the invocation', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new TypeError('secret upstream payload') })
  await assert.rejects(readBatchResource('https://youngpgmedia.com.ng', 'ypg_' + 'a'.repeat(48), 'listings', 10, async () => {}), /Listing page 10/)
  assert.equal(calls, 3)
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({}, { status: 429, headers: { 'Retry-After': '60' } }) })
  await assert.rejects(readBatchResource('https://youngpgmedia.com.ng', 'ypg_' + 'a'.repeat(48), 'listings', 10, async () => assert.fail('No long sleep')), /rate limit/)
  assert.equal(calls, 4)
})
test('missing batch migration fails closed before supplier reads or inventory writes', async t => {
  const id = '11111111-1111-4111-8111-111111111111'
  const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key', SUPPLIER_ENCRYPTION_KEY: btoa('k'.repeat(32)) }
  const sealed = await sealCredential('ypg_' + 'a'.repeat(48), id, env.SUPPLIER_ENCRYPTION_KEY)
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(String(input))
    if (url.pathname === '/rest/v1/supplier_connections') return Response.json({ id, enabled: true, revision: 1, provider: 'youngpg', auth_method: 'X-API-Key', base_url: 'https://youngpgmedia.com.ng', encrypted_key: sealed.ciphertext, key_nonce: sealed.nonce })
    assert.equal(url.pathname, '/rest/v1/rpc/claim_supplier_sync_batch')
    return Response.json({ code: 'PGRST202', message: 'private schema details' }, { status: 404 })
  })
  await assert.rejects(syncSupplierBatch(env, id), /202610120002 required.*missing RPC/)
})

test('scheduler keeps one connection/job and stays below 50 requests per invocation', async t => {
  let calls = 0
  const connection_id = '11111111-1111-4111-8111-111111111111'
  t.mock.method(globalThis, 'fetch', async (_input, options: RequestInit) => {
    assert.equal(options.redirect, 'manual')
    const body = JSON.parse(String(options.body))
    if (calls++) assert.deepEqual(body, { job_id: connection_id, connection_id })
    return Response.json({ done: false, job_id: connection_id, connection_id })
  })
  await scheduledSync({ CATALOG_SYNC_URL: 'https://mobile-preview.logspoll.pages.dev/api/internal/catalog-sync', SCHEDULER_SHARED_SECRET: 's'.repeat(48) }, { sleep: async () => {}, now: () => 0 })
  assert.equal(calls, 40)
})
test('scheduler refuses Access redirects without forwarding its secret or advancing a checkpoint', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (_input, options: RequestInit) => {
    calls++; assert.equal(options.redirect, 'manual')
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example.test' } })
  })
  await assert.rejects(scheduledSync({ CATALOG_SYNC_URL: 'https://mobile-preview.logspoll.pages.dev/api/internal/catalog-sync', SCHEDULER_SHARED_SECRET: 's'.repeat(48) }), /HTTP 302/)
  assert.equal(calls, 1)
})
