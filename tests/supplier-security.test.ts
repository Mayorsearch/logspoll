import test from 'node:test'
import assert from 'node:assert/strict'
import { authorizedProducts, normalizeCatalog, supplierGet } from '../server/supplier.ts'
const allowed = { '3': 'license-evidence-2026' }
const product = { id: '3', name: 'Licensed design template', description: 'A permitted digital design resource.', price: '12.30', amount: '4' }
const catalog = (products = [product]) => ({ categories: [{ id: '1', name: 'Digital resources', products }] })
test('catalog import requires an explicit verified product allowlist', () => {
  assert.throws(() => authorizedProducts('{}'))
  const data = normalizeCatalog(catalog([product, { ...product, id: '4' }]), allowed, 'USD')
  assert.equal(data.products.length, 1)
  assert.equal(data.products[0].id, '3')
  assert.equal(data.products[0].cost_minor, 1230)
  assert.equal(data.products[0].currency, 'USD')
  assert.equal(data.products[0].stock, 4)
  assert.ok(!('price_minor' in data.products[0]), 'Supplier cost must not set the customer selling price')
})
test('unverified account-access inventory is excluded even when allowlisted', () => {
  for (const name of ['Facebook accounts', 'Session cookies', 'Stolen credentials', 'Compromised inbox', 'API token']) {
    const data = normalizeCatalog(catalog([{ ...product, name }]), allowed, 'USD')
    assert.equal(data.products.length, 0)
    assert.equal(data.categories.length, 0)
  }
})
test('response validation rejects unknown schema, duplicate IDs, invalid quantities and unsupported currency', () => {
  assert.throws(() => normalizeCatalog({ products: [product] }, allowed, 'USD'))
  assert.throws(() => normalizeCatalog(catalog([product, product]), allowed, 'USD'))
  for (const amount of ['-1', '1.5', 'Infinity', '1000001']) assert.throws(() => normalizeCatalog(catalog([{ ...product, amount }]), allowed, 'USD'))
  for (const price of ['-1', 'NaN', '1.001', '1000000000']) assert.throws(() => normalizeCatalog(catalog([{ ...product, price }]), allowed, 'USD'))
  assert.throws(() => normalizeCatalog(catalog(), allowed, ''))
})
test('missing verified response documentation prevents any supplier request', async () => {
  await assert.rejects(supplierGet({ SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', SUPPLIER_API_KEY: 'test-only-secret' }, 'products'), /verified response documentation/)
})
test('supplier network failures do not expose API key or raw upstream errors', async t => {
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    assert.equal(options.redirect, 'error')
    throw new Error('private-test-secret upstream information')
  })
  await assert.rejects(supplierGet({ SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', SUPPLIER_API_KEY: 'private-test-secret', SUPPLIER_SCHEMA_VERIFIED: 'shopviaclone22-v1' }, 'products'), error => error instanceof Error && !error.message.includes('private-test-secret') && !error.message.includes('api_key='))
})
