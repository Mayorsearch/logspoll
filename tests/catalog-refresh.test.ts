import test from 'node:test'
import assert from 'node:assert/strict'
import { readCatalog } from '../server/catalog-sync.ts'
import { listingMetadata } from '../server/youngpg.ts'
import { scheduledSync } from '../workers/catalog-scheduler/index.ts'
import { productImages } from '../src/lib/product-images.ts'

const key = 'ypg_' + 'a'.repeat(48)
const base = 'https://youngpgmedia.com.ng'
const category = { id: 1, slug: 'software', title: 'Software' }
const item = (id: number, extra = {}) => ({ id, title: 'Licensed software', category: { slug: 'software', title: 'Software' }, price_ngn: '20.05', available_stock: 4, ...extra })
function clock() { let time = 0; return { now: () => time, sleep: async (ms: number) => { time += ms } } }

test('catalog traverses categories/subcategories and all pages, enriches descriptions and drops private detail fields', async t => {
  const visited: string[] = []; const progress: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: unknown, options: RequestInit) => {
    const url = new URL(String(input)); visited.push(url.pathname)
    assert.equal(new Headers(options.headers).get('X-API-Key'), key)
    assert.ok(!url.href.includes(key)); assert.ok(!options.method || options.method === 'GET')
    if (url.pathname === '/api/v1/categories') return Response.json({ success: true, data: [category] })
    if (url.pathname.endsWith('/subcategories')) return Response.json({ success: true, data: { category, subcategories: [{ id: 2, slug: 'utilities', title: 'Utilities' }] } })
    if (url.pathname === '/api/v1/listings/licensed-resource') return Response.json({ success: true, data: { id: 3, description: 'A licensed resource with permitted resale.', accounts: ['private-fulfillment'], password: 'private-value', session: 'private-session' } })
    const page = Number(url.searchParams.get('page'))
    return Response.json({ success: true, data: page === 1 ? [item(3, { slug: 'licensed-resource' })] : [item(4, { description: 'Supplier description', status: 'discontinued' }), item(5)], meta: { current_page: page, last_page: 2 } })
  })
  const result = await readCatalog(base, key, { 3: 'license-3', 4: 'license-4', 5: 'license-5' }, { ...clock(), progress: async status => { progress.push(status) } })
  assert.equal(result.pages, 2); assert.equal(result.scanned, 3)
  assert.deepEqual(result.subcategories, [])
  assert.equal(result.subcategories_complete, false)
  const taxonomy = await readCatalog(base, key, {}, { ...clock(), categoriesOnly: true })
  assert.deepEqual(taxonomy.subcategories[0], { id: '2', slug: 'utilities', name: 'Utilities', parent_id: '1' })
  assert.equal(taxonomy.subcategories_complete, true)
  assert.equal(result.products[0].description, 'A licensed resource with permitted resale.')
  assert.equal(result.products[0].cost_minor, 2005)
  assert.equal(result.products[1].stock, 0)
  assert.match(result.products[2].description, /administrator review required/)
  assert.ok(visited.includes('/api/v1/listings/licensed-resource'))
  assert.ok(progress.some(status => status.includes('page 2')))
  assert.ok(!JSON.stringify(result).includes('private-'))
  assert.ok(!JSON.stringify(result).includes(key))
})

test('429 respects Retry-After and safe reads retry; partial snapshots and duplicate IDs fail closed', async t => {
  let calls = 0; let elapsed = 0; let duplicate = false
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    const url = new URL(String(input))
    if (++calls === 1) return Response.json({}, { status: 429, headers: { 'Retry-After': '3' } })
    if (url.pathname === '/api/v1/categories') return Response.json({ success: true, data: [category] })
    if (url.pathname.endsWith('/subcategories')) return Response.json({ success: true, data: { category, subcategories: [] } })
    const page = Number(url.searchParams.get('page'))
    if (!duplicate && page === 2) return Response.json({}, { status: 403 })
    return Response.json({ success: true, data: [item(3, { description: 'Licensed public metadata' })], meta: { current_page: page, last_page: 2 } })
  })
  await assert.rejects(readCatalog(base, key, { 3: 'license-3' }, { now: () => elapsed, sleep: async ms => { elapsed += ms } }), /rejected the key/)
  assert.ok(elapsed >= 3000)
  duplicate = true
  await assert.rejects(readCatalog(base, key, { 3: 'license-3' }, clock()), /Duplicate supplier listing IDs across pages/)
})

test('detail identifiers must match and unsupported metadata never persists', async t => {
  assert.deepEqual(listingMetadata({ image_url: 'https://cdn.test/image.png?key=secret', password: 'secret', status: 'invented' }), {})
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/v1/categories') return Response.json({ success: true, data: [category] })
    if (url.pathname.endsWith('/subcategories')) return Response.json({ success: true, data: { category, subcategories: [] } })
    if (url.pathname.endsWith('/resource')) return Response.json({ success: true, data: { id: 99, description: 'Wrong listing' } })
    return Response.json({ success: true, data: [item(3, { slug: 'resource' })], meta: { current_page: 1, last_page: 1 } })
  })
  await assert.rejects(readCatalog(base, key, { 3: 'license-3' }, clock()), /identifier mismatch/)
})

test('cron worker refuses production and credential-bearing targets', async t => {
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('Invalid targets cannot receive scheduler credentials') })
  for (const url of ['https://logspoll.pages.dev/api/internal/catalog-sync', 'https://evil.test/api/internal/catalog-sync', 'https://mobile-preview.logspoll.pages.dev/api/internal/catalog-sync?secret=test']) {
    await assert.rejects(scheduledSync({ CATALOG_SYNC_URL: url, SCHEDULER_SHARED_SECRET: 's'.repeat(48) }), /configuration required/)
  }
})

test('collects all safe public API images, deduplicates URLs and excludes credentials or local addresses', () => {
  assert.deepEqual(productImages({ image_url: 'https://cdn.test/first.png', images: ['https://cdn.test/second.webp', { url: 'https://cdn.test/third.jpg?w=600' }, 'https://cdn.test/first.png', 'https://cdn.test/private.png?token=secret', 'https://user:password@cdn.test/private.png', 'http://127.0.0.1/private.png', 'data:image/svg+xml,secret'], password: 'private' }), ['https://cdn.test/first.png', 'https://cdn.test/second.webp', 'https://cdn.test/third.jpg?w=600'])
})

test('reads detail images even when listing descriptions are already present', async t => {
  let detailRead = false
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/v1/categories') return Response.json({ success: true, data: [category] })
    if (url.pathname.endsWith('/subcategories')) return Response.json({ success: true, data: { category, subcategories: [] } })
    if (url.pathname.endsWith('/licensed-resource')) { detailRead = true; return Response.json({ success: true, data: { id: 3, image_url: 'https://cdn.test/first.png', images: ['https://cdn.test/second.png'], password: 'private-value' } }) }
    return Response.json({ success: true, data: [item(3, { slug: 'licensed-resource', description: 'Original public description' })], meta: { current_page: 1, last_page: 1 } })
  })
  const result = await readCatalog(base, key, { 3: 'license-3' }, clock())
  assert.equal(detailRead, true)
  assert.equal(result.products[0].description, 'Original public description')
  assert.deepEqual(result.products[0].image_urls, ['https://cdn.test/first.png', 'https://cdn.test/second.png'])
  assert.ok(!JSON.stringify(result).includes('private-value'))
})
