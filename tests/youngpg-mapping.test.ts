import assert from 'node:assert/strict'
import test from 'node:test'
import { categoriesFrom, listingsFrom, DESCRIPTION_REQUIRED, resaleAllowlist } from '../server/youngpg.ts'

const payload = { success: true, data: [
  { id: 1, slug: 'vpn-premium', title: 'Premium VPN' },
  { id: 2, slug: 'apps', title: 'Software' },
  { id: 3, slug: 'duplicate-a', title: 'Ambiguous' },
  { id: 4, slug: 'duplicate-b', title: 'Ambiguous' },
] }
const sample = (id: number, slug: string, title: string, options: Record<string, unknown> = {}) => ({
  id, title: `Licensed Product ${id}`, price_ngn: '2500.55', available_stock: 3,
  category: { slug, title }, ...options,
})

test('parses supplier title and slug, not obsolete category name', () => {
  const cats = categoriesFrom(payload)
  assert.deepEqual(cats[0], { id: '1', slug: 'vpn-premium', name: 'Premium VPN' })
})

test('matches exact slug, falls back to unique title, stages unmatched category', () => {
  const cats = categoriesFrom(payload)
  const data = listingsFrom([
    sample(15, 'vpn-premium', 'Premium VPN'),
    sample(16, 'old-apps-slug', 'Software'),
    sample(17, 'unknown-product-type', 'Unlisted supplier type'),
    sample(18, 'ambiguous-supplier', 'Ambiguous'),
  ], cats, { 15: 'resale-agreement-15', 16: 'resale-agreement-16', 17: 'resale-agreement-17', 18: 'resale-agreement-18' })
  assert.deepEqual(data.products.map(x => x.category_id), ['1', '2', 'unmatched-unknown-product-type', 'unmatched-ambiguous-supplier'])
  assert.equal(data.categories.length, 6)
  assert.equal(data.products[0].description, DESCRIPTION_REQUIRED)
  assert.equal(data.products[0].cost_minor, 250055)
})

test('does not stage login credentials or unapproved supplier listings', () => {
  const cats = categoriesFrom(payload)
  const data = listingsFrom([
    sample(100, 'apps', 'Software', { title: 'Facebook session cookies' }),
    sample(101, 'apps', 'Software', { title: 'Licensed Software', description: 'An eligible fully described licensed product' }),
  ], cats, { 100: 'agreement-100' })
  assert.equal(data.products.length, 0)
})

test('does not accept invalid listing costs or stock', () => {
  const cats = categoriesFrom(payload)
  assert.throws(() => listingsFrom([sample(1, 'apps', 'Software', { price_ngn: '-500' })], cats, {1:'agreement-ref'}))
  assert.throws(() => listingsFrom([sample(1, 'apps', 'Software', { available_stock: -1 })], cats, {1:'agreement-ref'}))
})

test('blank descriptions remain review-required and ordinary multiline product text is preserved', () => {
  const cats = categoriesFrom(payload)
  for (const description of ['', '   ', null]) {
    assert.equal(listingsFrom([sample(1, 'apps', 'Software', { description })], cats, { 1: 'agreement-ref' }).products[0].description, DESCRIPTION_REQUIRED)
  }
  const description = 'Licensed software.\nInstall with the official installer.'
  assert.equal(listingsFrom([sample(1, 'apps', 'Software', { description })], cats, { 1: 'agreement-ref' }).products[0].description, description)
})

test('supplier-wide resale evidence covers eligible goods but not account credentials', () => {
  const categories = categoriesFrom(payload)
  const approved = resaleAllowlist({ '*': 'YoungPG-supplier-wide-authorization-reference' })
  const result = listingsFrom([
    sample(300, 'apps', 'Software', { title: 'Licensed software package' }),
    sample(301, 'apps', 'Software', { title: 'Facebook accounts and session cookies' }),
  ], categories, approved)
  assert.deepEqual(result.products.map(product => product.id), ['300'])
  assert.equal(result.products[0].authorization_ref, approved['*'])
  assert.throws(() => resaleAllowlist({ '*': 'bad' }))
  const specific = listingsFrom([
    sample(300, 'apps', 'Software', { title: 'Licensed software package' }),
  ], categories, resaleAllowlist({ '*': 'supplier-wide-reference', '300': 'product-specific-reference' }))
  assert.equal(specific.products[0].authorization_ref, 'product-specific-reference')
})
