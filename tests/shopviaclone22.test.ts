import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseDecimalToMinor,
  normalizeShopViaCatalog,
  fetchShopViaCatalog,
  fetchShopViaProduct,
  ShopViaError,
} from '../server/shopviaclone22.ts'
import { calculateSellingPrice } from '../server/pricing.ts'

test('ShopViaClone22 decimal prices parse exactly to integer minor kobo', () => {
  assert.equal(parseDecimalToMinor('25.50'), 2550)
  assert.equal(parseDecimalToMinor('100'), 10000)
  assert.equal(parseDecimalToMinor('0.05'), 5)
  assert.equal(parseDecimalToMinor('0'), 0)
  assert.equal(parseDecimalToMinor(12.34), 1234)

  assert.throws(() => parseDecimalToMinor('-5.00'), ShopViaError)
  assert.throws(() => parseDecimalToMinor('abc'), ShopViaError)
  assert.throws(() => parseDecimalToMinor('1.005'), ShopViaError)
  assert.throws(() => parseDecimalToMinor('1000000000000'), ShopViaError)
})

test('normalizeShopViaCatalog extracts valid categories and products while rejecting invalid inputs', () => {
  const samplePayload = {
    categories: [
      {
        id: '1',
        name: 'Social Media Accounts',
        products: [
          {
            id: '101',
            name: 'Facebook Aged Account 2018',
            description: 'Verified account with clean activity history.',
            price: '3500.00',
            amount: 15,
          },
          {
            id: '102',
            name: 'Instagram High Karma Account',
            description: 'Organic followers, 2FA enabled.',
            price: '5000.50',
            amount: '8',
          },
        ],
      },
      {
        id: '2',
        name: 'VPN Subscriptions',
        products: [
          {
            id: '201',
            name: 'Astrill VPN 1 Month Key',
            description: 'Private VPN configuration code.',
            price: '12000.00',
            amount: 0,
          },
        ],
      },
    ],
  }

  const normalized = normalizeShopViaCatalog(samplePayload, 'NGN')
  assert.equal(normalized.categories.length, 2)
  assert.equal(normalized.products.length, 3)

  const fb = normalized.products.find((p) => p.id === '101')!
  assert.equal(fb.name, 'Facebook Aged Account 2018')
  assert.equal(fb.costMinor, 350000)
  assert.equal(fb.stock, 15)
  assert.equal(fb.categoryId, '1')

  const vpn = normalized.products.find((p) => p.id === '201')!
  assert.equal(vpn.stock, 0)
  assert.equal(vpn.costMinor, 1200000)

  // Duplicate product IDs are deduplicated
  const dupPayload = {
    categories: [
      {
        id: '1',
        name: 'Cat',
        products: [
          { id: '101', name: 'Item', price: '10.00', amount: 5 },
          { id: '101', name: 'Item Dup', price: '10.00', amount: 5 },
        ],
      },
    ],
  }
  const dupNorm = normalizeShopViaCatalog(dupPayload)
  assert.equal(dupNorm.products.length, 1)

  // Invalid payload structure throws
  assert.throws(() => normalizeShopViaCatalog(null), ShopViaError)
  assert.throws(() => normalizeShopViaCatalog([]), ShopViaError)
  assert.throws(() => normalizeShopViaCatalog('string'), ShopViaError)
})

test('ShopViaClone22 pricing markup calculates accurately without compounding', () => {
  const costMinor = 500000 // ₦5,000.00
  const markupBps = 2500 // 25%

  const result = calculateSellingPrice(costMinor, {
    id: 'markup',
    enabled: true,
    mode: 'markup',
    rateBps: markupBps,
    fixedMinor: 0,
    minProfitMinor: 0,
    feeBps: 0,
    feeFixedMinor: 0,
    fxBufferBps: 0,
    roundingMinor: 1,
  })

  // ₦5,000 * 1.25 = ₦6,250 = 625,000 kobo
  assert.equal(result.sellingPriceMinor, 625000)
})

test('fetchShopViaCatalog refuses non-HTTPS URLs and redacts API key on network errors', async (t) => {
  await assert.rejects(
    fetchShopViaCatalog('test-key', 'http://insecure-domain.com/api'),
    /must use HTTPS/
  )

  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    assert.equal(options.redirect, 'error')
    throw new Error('Secret upstream timeout with key=private_super_secret_12345')
  })

  try {
    await fetchShopViaCatalog('private_super_secret_12345', 'https://shopviaclone22.com/api')
    assert.fail('Should have thrown')
  } catch (error) {
    assert.ok(error instanceof ShopViaError)
    assert.doesNotMatch(error.message, /private_super_secret_12345/)
  }
})

test('fetchShopViaProduct queries product by ID with authentication', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    const u = new URL(String(url))
    assert.equal(u.searchParams.get('api_key'), 'valid-key')
    assert.equal(u.searchParams.get('id'), '42')
    return Response.json({
      product: { id: '42', name: 'Test Product', price: '1500.00', amount: 3 },
    })
  })

  const res = (await fetchShopViaProduct('valid-key', '42')) as { product: { name: string } }
  assert.equal(res.product.name, 'Test Product')
})

