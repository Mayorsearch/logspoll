import test from 'node:test'
import assert from 'node:assert/strict'
import { readCatalog } from '../server/catalog-sync.ts'

const origin = 'https://youngpgmedia.com.ng'
const key = 'ypg_' + 'a'.repeat(48) // synthetic test credential, never production
const category = { id: 1, slug: 'software', title: 'Software' }
const clock = () => { let now = 0; return { now: () => now, sleep: async (ms: number) => { now += ms } } }

test('normal product sync skips 1-per-category subcategory traversal', async t => {
  const paths: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    const url = new URL(String(input))
    paths.push(url.pathname)
    if (url.pathname === '/api/v1/categories') return Response.json({ success: true, data: [category] })
    if (url.pathname === '/api/v1/listings') return Response.json({
      success: true,
      data: [{ id: 3, title: 'Licensed software', category: { slug: 'software', title: 'Software' }, price_ngn: '150.00', available_stock: 2 }],
      meta: { current_page: 1, last_page: 1 },
    })
    throw Error(`Unexpected supplier request: ${url.pathname}`)
  })
  const result = await readCatalog(origin, key, { '3': 'licensed-product-3' }, clock())
  assert.equal(result.scanned, 1)
  assert.equal(result.products.length, 1)
  assert.equal(result.subcategories_complete, false)
  assert.deepEqual(result.subcategories, [])
  assert.equal(paths.filter(path => path.endsWith('/subcategories')).length, 0)
})

test('Fetch Categories still reads all subcategories as a complete snapshot', async t => {
  const paths: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    const url = new URL(String(input))
    paths.push(url.pathname)
    if (url.pathname === '/api/v1/categories') return Response.json({ success: true, data: [category] })
    if (url.pathname === '/api/v1/categories/1/subcategories') return Response.json({ success: true, data: { category, subcategories: [{ id: 2, slug: 'utilities', title: 'Utilities' }] } })
    throw Error(`Unexpected supplier request: ${url.pathname}`)
  })
  const result = await readCatalog(origin, key, {}, { ...clock(), categoriesOnly: true })
  assert.equal(result.subcategories_complete, true)
  assert.equal(result.subcategories.length, 1)
  assert.equal(result.subcategories[0].name, 'Utilities')
  assert.equal(paths.filter(path => path.endsWith('/subcategories')).length, 1)
  assert.equal(paths.filter(path => path === '/api/v1/listings').length, 0)
})
