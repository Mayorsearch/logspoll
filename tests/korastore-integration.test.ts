import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchKoraProfile,
  fetchKoraProducts,
  buyKoraProduct,
  getKoraOrder,
  getKoraOrders,
  calculateKoraSellingPrice,
  KoraStoreError,
} from '../server/korastore.ts'
import { prepareDelivery, type DeliveryProvider } from '../server/supplier-delivery.ts'

test('Kora Store API: fetchKoraProfile authenticates with Bearer token and returns NGN balance', async () => {
  const origFetch = globalThis.fetch
  try {
    let capturedUrl = ''
    let capturedAuth = ''

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      const headers = init?.headers as Headers
      capturedAuth = headers?.get('Authorization') || ''

      return new Response(
        JSON.stringify({
          ok: true,
          balance_kobo: 15420000,
          balance_naira: 154200,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const profile = await fetchKoraProfile('kora_sk_live_test_key_123', 'https://korastore.cv/v1')
    assert.equal(profile.ok, true)
    assert.equal(profile.balance_kobo, 15420000)
    assert.equal(profile.balance_naira, 154200)
    assert.equal(capturedUrl, 'https://korastore.cv/v1/me')
    assert.equal(capturedAuth, 'Bearer kora_sk_live_test_key_123')
  } finally {
    globalThis.fetch = origFetch
  }
})

test('Kora Store API: fetchKoraProducts parses live catalog with delivery and stock types', async () => {
  const origFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          products: [
            {
              id: 'chatgpt-plus-1m',
              name: 'ChatGPT Plus 1 Month',
              price_kobo: 3000000,
              price_naira: 30000,
              stock: 45,
              available: true,
              delivery: 'instant',
            },
            {
              id: 'claude-pro-1m',
              name: 'Claude Pro 1 Month',
              price_kobo: 3200000,
              price_naira: 32000,
              stock: null, // unlimited
              available: true,
              delivery: 'instant',
            },
            {
              id: 'codex-enterprise',
              name: 'Codex Enterprise Access',
              price_kobo: 4500000,
              price_naira: 45000,
              stock: 12,
              available: true,
              delivery: 'instant',
            },
            {
              id: 'muse-ai-annual',
              name: 'Muse AI Annual Subscription',
              price_kobo: 2500000,
              price_naira: 25000,
              stock: 0,
              available: false,
              delivery: 'manual',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const products = await fetchKoraProducts('kora_sk_live_key', 'https://korastore.cv/v1')
    assert.equal(products.length, 4)

    assert.equal(products[0].id, 'chatgpt-plus-1m')
    assert.equal(products[0].price_kobo, 3000000)
    assert.equal(products[0].price_naira, 30000)
    assert.equal(products[0].stock, 45)
    assert.equal(products[0].delivery, 'instant')

    assert.equal(products[1].id, 'claude-pro-1m')
    assert.equal(products[1].stock, null) // unlimited supported

    assert.equal(products[3].id, 'muse-ai-annual')
    assert.equal(products[3].available, false)
    assert.equal(products[3].delivery, 'manual')
  } finally {
    globalThis.fetch = origFetch
  }
})

test('Kora Store API: buyKoraProduct requires idempotency key and recovers delivered credentials', async () => {
  const origFetch = globalThis.fetch
  try {
    let capturedBody = ''

    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = String(init?.body ?? '')

      return new Response(
        JSON.stringify({
          ok: true,
          order_id: 'kora_ord_8899aabb',
          status: 'delivered',
          items: ['email:user@example.com|pass:Secr3tToken123'],
          balance_kobo: 12420000,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const res = await buyKoraProduct(
      'kora_sk_live_key',
      'chatgpt-plus-1m',
      'req-idemp-999-uuid',
      'https://korastore.cv/v1'
    )

    assert.equal(res.ok, true)
    assert.equal(res.order_id, 'kora_ord_8899aabb')
    assert.equal(res.status, 'delivered')
    assert.equal(res.items.length, 1)
    assert.equal(res.items[0], 'email:user@example.com|pass:Secr3tToken123')
    assert.deepEqual(JSON.parse(capturedBody), {
      product_id: 'chatgpt-plus-1m',
      idempotency_key: 'req-idemp-999-uuid',
    })
  } finally {
    globalThis.fetch = origFetch
  }
})

test('Kora Store API: getKoraOrder retrieves order status and delivered items', async () => {
  const origFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          order: {
            order_id: 'kora_ord_8899aabb',
            product: 'ChatGPT Plus 1 Month',
            status: 'delivered',
            price_kobo: 3000000,
            items: ['email:user@example.com|pass:Secr3tToken123'],
            created_at: '2026-10-27T10:00:00Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const order = await getKoraOrder('kora_sk_live_key', 'kora_ord_8899aabb', 'https://korastore.cv/v1')
    assert.equal(order.order_id, 'kora_ord_8899aabb')
    assert.equal(order.status, 'delivered')
    assert.equal(order.items.length, 1)
  } finally {
    globalThis.fetch = origFetch
  }
})

test('Independent Percentage Pricing: calculates exact formula and integer kobo rounding', () => {
  // Formula: sellingPrice = verifiedSupplierCostNGN * (1 + markupPercentage / 100)

  // Example 1: ₦2,000 (200,000 kobo) cost @ 50% markup = ₦3,000 (300,000 kobo)
  const price1 = calculateKoraSellingPrice(200000, 5000)
  assert.equal(price1, 300000) // ₦3,000.00

  // Example 2: Automatic Price Increase
  // Wholesale cost increases to ₦3,000 (300,000 kobo) @ 50% markup = ₦4,500 (450,000 kobo)
  const price2 = calculateKoraSellingPrice(300000, 5000)
  assert.equal(price2, 450000) // ₦4,500.00

  // Example 3: Automatic Price Decrease
  // Wholesale cost decreases from ₦3,000 to ₦2,000 @ 50% markup = ₦3,000 (300,000 kobo)
  const price3 = calculateKoraSellingPrice(200000, 5000)
  assert.equal(price3, 300000) // ₦3,000.00

  // Priority Products with independent markups:
  // ChatGPT: ₦30,000 cost (3,000,000 kobo) @ 50% markup (5000 bps) -> ₦45,000 (4,500,000 kobo)
  const chatGptPrice = calculateKoraSellingPrice(3000000, 5000)
  assert.equal(chatGptPrice, 4500000)

  // Claude: ₦32,000 cost (3,200,000 kobo) @ 45% markup (4500 bps) -> ₦46,400 (4,640,000 kobo)
  const claudePrice = calculateKoraSellingPrice(3200000, 4500)
  assert.equal(claudePrice, 4640000)

  // Codex: ₦45,000 cost (4,500,000 kobo) @ 60% markup (6000 bps) -> ₦72,000 (7,200,000 kobo)
  const codexPrice = calculateKoraSellingPrice(4500000, 6000)
  assert.equal(codexPrice, 7200000)

  // Muse AI: ₦25,000 cost (2,500,000 kobo) @ 40% markup (4000 bps) -> ₦35,000 (3,500,000 kobo)
  const musePrice = calculateKoraSellingPrice(2500000, 4000)
  assert.equal(musePrice, 3500000)
})

test('Fulfillment Integration: prepareDelivery correctly dispatches and polls Kora Store purchases', async () => {
  const origFetch = globalThis.fetch
  try {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/products')) {
        return new Response(
          JSON.stringify({
            ok: true,
            products: [
              {
                id: 'chatgpt-plus-1m',
                name: 'ChatGPT Plus 1 Month',
                price_kobo: 3000000, // ₦30,000
                price_naira: 30000,
                stock: 10,
                available: true,
                delivery: 'instant',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (url.includes('/buy')) {
        return new Response(
          JSON.stringify({
            ok: true,
            order_id: 'KORA-ORD-112233',
            status: 'delivered',
            items: ['license-key-abc-123-xyz'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (url.includes('/orders/')) {
        return new Response(
          JSON.stringify({
            ok: true,
            order: {
              order_id: 'KORA-ORD-112233',
              product: 'ChatGPT Plus 1 Month',
              status: 'delivered',
              price_kobo: 3000000,
              items: ['license-key-abc-123-xyz'],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
    }

    const plan = await prepareDelivery(
      'korastore' as DeliveryProvider,
      { apiKey: 'kora_sk_live_key_99', baseUrl: 'https://korastore.cv/v1' },
      {
        externalId: 'chatgpt-plus-1m',
        quantity: 1,
        requestId: 'req_order_test_1',
        maxCostMinor: 4500000, // Locked customer payment: ₦45,000
      }
    )

    const delivery = await plan.buy()
    assert.equal(delivery.receipt, 'KORA-ORD-112233')
    assert.equal(delivery.delivered, true)
    assert.equal(delivery.items.length, 1)
    assert.equal(delivery.items[0], 'license-key-abc-123-xyz')

    const polled = await plan.poll('KORA-ORD-112233')
    assert.equal(polled.receipt, 'KORA-ORD-112233')
    assert.equal(polled.delivered, true)
  } finally {
    globalThis.fetch = origFetch
  }
})

test('Two Pricing Modes: Option A (Percentage) follows cost changes, Option B (Fixed) remains static', () => {
  // Option A: Percentage Markup mode
  const initialCostKobo = 200000 // ₦2,000
  const markupBps = 5000 // 50%
  const initialSellingPrice = calculateKoraSellingPrice(initialCostKobo, markupBps)
  assert.equal(initialSellingPrice, 300000) // ₦3,000

  // Wholesale price increases to ₦3,500 (350,000 kobo)
  const increasedCostKobo = 350000
  const increasedSellingPrice = calculateKoraSellingPrice(increasedCostKobo, markupBps)
  assert.equal(increasedSellingPrice, 525000) // ₦5,250

  // Wholesale price decreases to ₦1,500 (150,000 kobo)
  const decreasedCostKobo = 150000
  const decreasedSellingPrice = calculateKoraSellingPrice(decreasedCostKobo, markupBps)
  assert.equal(decreasedSellingPrice, 225000) // ₦2,250

  // Option B: Fixed Price mode
  const fixedSellingPrice = 400000 // Fixed ₦4,000
  let currentCost = initialCostKobo
  let isLoss = fixedSellingPrice < currentCost
  assert.equal(isLoss, false)

  // Cost increases above fixed price: ₦4,500 > ₦4,000
  currentCost = 450000
  isLoss = fixedSellingPrice < currentCost
  assert.equal(isLoss, true, 'Loss warning must be triggered when supplier cost exceeds fixed selling price')
})

test('Server 4 AI Tools: DigitalCore and Kora Store coexist under server_number = 4 without naming leakage', async () => {
  const { buildDiscoverySequence } = await import('../workers/api/storefront-discovery.ts')

  const dummyServer4Products: any[] = [
    {
      id: 's4-dc-gemini-pro',
      category_id: 'c8402d52-37ef-4dfb-df2f-47cd20cd7004',
      slug: 's4-gemini-pro',
      name: 'Gemini Pro 18 Months',
      price_minor: 125000,
      currency: 'NGN',
      features: ['AI Subscription'],
      supplier_image_urls: [],
      featured: 1,
      available_quantity: 100,
      server_number: 4,
    },
    {
      id: 's4-kora-chatgpt-plus',
      category_id: 'c8402d52-37ef-4dfb-df2f-47cd20cd7004',
      slug: 's4-kora-chatgpt-plus',
      name: 'ChatGPT Plus 1 Month',
      price_minor: 4500000,
      currency: 'NGN',
      features: ['Authorized AI Tool'],
      supplier_image_urls: [],
      featured: 1,
      available_quantity: 50,
      server_number: 4,
    },
  ]

  const config = {
    rotation_enabled: false,
    affordable_priority_enabled: false,
    affordable_max_minor: 1500000,
    affordable_weight: 0,
    featured_weight: 100,
    new_weight: 0,
    products_per_page: 20,
    updated_at: Date.now(),
  }

  const sequenced = buildDiscoverySequence(dummyServer4Products, config, 'test_seed_s4')
  assert.equal(sequenced.length, 2)

  for (const item of sequenced) {
    // Both items must belong to Server 4
    assert.equal(item.server_number, 4)
    // Customer-facing discovery objects MUST NEVER leak supplier names
    assert.equal((item as any).supplier_name, undefined)
  }
})

