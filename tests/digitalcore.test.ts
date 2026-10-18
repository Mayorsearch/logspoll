import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeDigitalCoreCatalog,
  fetchDigitalCoreProfile,
  buyDigitalCoreProduct,
  DigitalCoreError,
  DIGITALCORE_DEFAULT_BASE_URL,
} from '../server/digitalcore.ts'
import { parseDecimalToMinor, convertUsdToNgnMinor } from '../server/shopviaclone22.ts'
import { calculateSellingPrice } from '../server/pricing.ts'

test('DigitalCore: normalizes USD product catalog and converts to NGN with 50% markup formula', () => {
  const mockPayload = [
    {
      id: 'gemini_pro_18_months',
      name: 'Gemini Pro 18 Months',
      description: 'Full access to Gemini 1.5 Pro features. Valid for 18 months warranty.',
      stock: 1237,
      price: 0.55,
      priceFrom: 0.49,
      tiers: [
        { minQty: 1, maxQty: 49, price: 0.55 },
        { minQty: 50, maxQty: 99, price: 0.52 },
        { minQty: 100, maxQty: null, price: 0.49 },
      ],
    },
    {
      id: 'chatgpt_plus_1_month',
      name: 'ChatGPT Plus 1 Month',
      description: 'ChatGPT Plus subscription with GPT-4o and DALL-E access.',
      stock: 420,
      price: 13.50,
      priceFrom: 11.90,
      tiers: [
        { minQty: 1, maxQty: 9, price: 13.50 },
        { minQty: 10, maxQty: 49, price: 12.50 },
        { minQty: 50, maxQty: null, price: 11.90 },
      ],
    },
  ]

  const usdToNgnRate = 1500.0
  const result = normalizeDigitalCoreCatalog(mockPayload, usdToNgnRate)

  assert.equal(result.products.length, 2)
  assert.equal(result.categories.length, 1)
  assert.equal(result.categories[0].name, 'AI Tools')

  // Product 1: $0.55 USD * 1500 NGN = ₦825.00 => 82500 kobo
  const p1 = result.products[0]
  assert.equal(p1.id, 'gemini_pro_18_months')
  assert.equal(p1.usdCostMinor, 55)
  assert.equal(p1.costMinor, 82500)
  assert.equal(p1.currency, 'NGN')
  assert.equal(p1.stock, 1237)
  assert.equal(p1.tiers.length, 3)

  // Test 50% markup formula on p1: 82500 * 1.5 = 123750 kobo (₦1,237.50)
  const sellingPrice1 = calculateSellingPrice(p1.costMinor, {
    id: 'markup_50',
    enabled: true,
    mode: 'markup',
    rateBps: 5000,
    fixedMinor: 0,
    minProfitMinor: 0,
    feeBps: 0,
    feeFixedMinor: 0,
    fxBufferBps: 0,
    roundingMinor: 1,
  }).sellingPriceMinor
  assert.equal(sellingPrice1, 123750)

  // Product 2: $13.50 USD * 1500 NGN = ₦20,250.00 => 2025000 kobo
  const p2 = result.products[1]
  assert.equal(p2.id, 'chatgpt_plus_1_month')
  assert.equal(p2.usdCostMinor, 1350)
  assert.equal(p2.costMinor, 2025000)

  // 50% markup on p2: 2025000 * 1.5 = 3037500 kobo (₦30,375.00)
  const sellingPrice2 = calculateSellingPrice(p2.costMinor, {
    id: 'markup_50',
    enabled: true,
    mode: 'markup',
    rateBps: 5000,
    fixedMinor: 0,
    minProfitMinor: 0,
    feeBps: 0,
    feeFixedMinor: 0,
    fxBufferBps: 0,
    roundingMinor: 1,
  }).sellingPriceMinor
  assert.equal(sellingPrice2, 3037500)
})

test('DigitalCore: handles connection test via fetchDigitalCoreProfile with Api-Key header', async () => {
  const origFetch = globalThis.fetch
  try {
    let capturedHeader = ''
    let capturedUrl = ''

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      const headers = init?.headers as Record<string, string>
      capturedHeader = headers?.['Api-Key'] || ''

      return new Response(
        JSON.stringify({
          balance: 142.5,
          total_orders: '30',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const profile = await fetchDigitalCoreProfile({
      apiKey: 'test-digitalcore-key-12345',
      baseUrl: 'https://digitalcore.top',
    })

    assert.equal(profile.connected, true)
    assert.equal(profile.balance, 142.5)
    assert.equal(profile.totalOrders, '30')
    assert.equal(capturedHeader, 'test-digitalcore-key-12345')
    assert.equal(capturedUrl, 'https://digitalcore.top/api/user/me')
  } finally {
    globalThis.fetch = origFetch
  }
})

test('DigitalCore: purchase endpoint buyDigitalCoreProduct calls /api/user/buy with JSON body', async () => {
  const origFetch = globalThis.fetch
  try {
    let capturedBody = ''
    let capturedHeader = ''

    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = String(init?.body ?? '')
      const headers = init?.headers as Record<string, string>
      capturedHeader = headers?.['Api-Key'] || ''

      return new Response(
        JSON.stringify({
          success: true,
          order_id: 'ORD-999888',
          view_url: 'https://digitalcore.top/order?number=abc-123',
          total_amount: 0.55,
          quantity: 1,
          items: ['https://g.co/gemini/share/test_token'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const buyRes = await buyDigitalCoreProduct(
      { apiKey: 'dc-secret-key-abc', baseUrl: 'https://digitalcore.top' },
      { id: 'gemini_pro_18_months', count: 1 }
    )

    assert.equal(buyRes.success, true)
    assert.equal(buyRes.orderId, 'ORD-999888')
    assert.equal(buyRes.items.length, 1)
    assert.equal(capturedHeader, 'dc-secret-key-abc')
    assert.deepEqual(JSON.parse(capturedBody), { id: 'gemini_pro_18_months', count: 1 })
  } finally {
    globalThis.fetch = origFetch
  }
})

test('DigitalCore: purchase throws error on out of stock / insufficient balance', async () => {
  const origFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          success: false,
          msg: 'OUT_OF_STOCK',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    await assert.rejects(
      async () => {
        await buyDigitalCoreProduct(
          { apiKey: 'dc-key', baseUrl: 'https://digitalcore.top' },
          { id: 'gemini_pro_18_months', count: 10 }
        )
      },
      (err: any) => {
        return err instanceof DigitalCoreError && err.code === 'OUT_OF_STOCK'
      }
    )
  } finally {
    globalThis.fetch = origFetch
  }
})

test('Storefront Privacy: ensures supplier names never leak in public discovery objects', async () => {
  const { buildDiscoverySequence } = await import('../workers/api/storefront-discovery.ts')

  const dummyProducts: any[] = [
    {
      id: 'prod-1',
      category_id: 'cat-1',
      slug: 'item-1',
      name: 'Item 1',
      price_minor: 50000,
      currency: 'NGN',
      features: [],
      supplier_image_urls: [],
      featured: 1,
      available_quantity: 10,
      server_number: 1,
    },
    {
      id: 'prod-2',
      category_id: 'cat-2',
      slug: 'item-2',
      name: 'Item 2',
      price_minor: 250000,
      currency: 'NGN',
      features: [],
      supplier_image_urls: [],
      featured: 0,
      available_quantity: 5,
      server_number: 4,
    },
  ]

  const config = {
    rotation_enabled: true,
    affordable_priority_enabled: true,
    affordable_max_minor: 1500000,
    affordable_weight: 65,
    featured_weight: 20,
    new_weight: 15,
    products_per_page: 20,
    updated_at: Date.now(),
  }

  const sequenced = buildDiscoverySequence(dummyProducts, config, 'test_seed')
  assert.equal(sequenced.length, 2)
  for (const item of sequenced) {
    // Crucial requirement: supplier_name MUST NOT be present
    assert.equal((item as any).supplier_name, undefined)
    assert.ok(item.server_number === 1 || item.server_number === 4)
  }
})

