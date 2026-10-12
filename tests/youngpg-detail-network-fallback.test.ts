import test from 'node:test'
import assert from 'node:assert/strict'
import { readCatalog } from '../server/catalog-sync.ts'

const key = 'ypg_' + 'a'.repeat(48)
const base = 'https://youngpgmedia.com.ng'
const category = { id: 1, slug: 'licensed-tools', title: 'Licensed Tools' }
const item = (id: number, slug: string) => ({ id, slug, title: 'Licensed utility', category: { slug: 'licensed-tools', title: 'Licensed Tools' }, price_ngn: '45.50', available_stock: 3, status: 'active' })
const clock = () => { let t = 0; return { now: () => t, sleep: async (ms: number) => { t += ms } } }

test('detail network failures fall back to validated listings after retries without losing stock or prices', async t => {
  let detailAttempts = 0
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/v1/categories') return Response.json({ success: true, data: [category] })
    if (url.pathname === '/api/v1/listings') return Response.json({ success: true, data: [item(1, 'licensed-1'), item(2, 'licensed-2')], meta: { current_page: 1, last_page: 1 } })
    if (url.pathname === '/api/v1/listings/licensed-1') { detailAttempts++; throw new TypeError('untrusted upstream error') }
    assert.fail('A subsequent detail read should be skipped after network failure')
  })
  const snapshot = await readCatalog(base, key, { '1': 'license-evidence-1', '2': 'license-evidence-2' }, clock())
  assert.equal(snapshot.detail_enrichment_skipped, 2)
  assert.equal(detailAttempts, 3, 'network failure should be retried only within existing limits')
  assert.equal(snapshot.products.length, 2)
  assert.deepEqual(snapshot.products.map(row => row.stock), [3, 3])
  assert.deepEqual(snapshot.products.map(row => row.cost_minor), [4550, 4550])
  assert.ok(snapshot.products.every(row => /administrator review required/.test(row.description)))
  assert.equal(snapshot.subcategories_complete, false)
  assert.ok(!JSON.stringify(snapshot).includes('untrusted upstream error'))
})

test('detail authentication failures still abort rather than bypass authorization', async t => {
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/v1/categories') return Response.json({ success: true, data: [category] })
    if (url.pathname === '/api/v1/listings') return Response.json({ success: true, data: [item(1, 'licensed-1')], meta: { current_page: 1, last_page: 1 } })
    return Response.json({ success: false }, { status: 403 })
  })
  await assert.rejects(readCatalog(base, key, { '1': 'license-evidence-1' }, clock()), /rejected the key/)
})
