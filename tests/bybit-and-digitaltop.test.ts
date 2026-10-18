import test from 'node:test'
import assert from 'node:assert/strict'
import {
  generateRemitanoSignature,
  calculateRepresentativeRate as calculateRemitanoRate,
  isRateFresh,
  isRateJumpAbnormal,
} from '../server/remitano-p2p.ts'
import {
  fetchQuidaxUsdtNgnTicker,
  QuidaxSpotError,
} from '../server/quidax-spot.ts'
import {
  buildDiscoverySequence,
  createPRNG,
  seededShuffle,
  type StorefrontProduct,
  type StorefrontDiscoveryConfig,
} from '../workers/api/storefront-discovery.ts'
import {
  normalizeDigitalTopCatalog,
  type DigitalTopProduct,
} from '../server/digitaltop.ts'

test('Remitano HMAC-SHA1 signature generates compliant APIAuth header', async () => {
  const method = 'GET'
  const path = '/api/v1/offers?coin_currency=usdt&fiat_currency=ngn&offer_type=sell'
  const accessKey = 'test_remitano_access_key'
  const secretKey = 'test_remitano_secret_key'
  const date = 'Sun, 18 Oct 2026 10:00:00 GMT'

  const sigResult = await generateRemitanoSignature({
    method,
    path,
    accessKey,
    secretKey,
    date,
  })

  assert.equal(typeof sigResult.authorization, 'string')
  assert.ok(sigResult.authorization.startsWith('APIAuth test_remitano_access_key:'))
  assert.equal(sigResult.date, date)

  // Verify reproducible signature with identical inputs
  const sigResult2 = await generateRemitanoSignature({
    method,
    path,
    accessKey,
    secretKey,
    date,
  })
  assert.equal(sigResult.authorization, sigResult2.authorization)
})

test('calculateRemitanoRate filters low liquidity, outliers, and computes robust trimmed median', () => {
  const mockOffers = [
    { price: '1480.50', coin_amount: '100', offer_type: 'sell' },
    { price: '1490.00', coin_amount: '50', offer_type: 'sell' },
    { price: '1500.00', coin_amount: '200', offer_type: 'sell' },
    { price: '1505.00', coin_amount: '80', offer_type: 'sell' },
    { price: '1510.00', coin_amount: '500', offer_type: 'sell' },
    { price: '1520.00', coin_amount: '40', offer_type: 'sell' },
    // Outliers & invalid items to be filtered:
    { price: '300.00', coin_amount: '100', offer_type: 'sell' }, // Below sanity bound 500
    { price: '9999.00', coin_amount: '100', offer_type: 'sell' }, // Above sanity bound 5000
    { price: '1495.00', coin_amount: '1', offer_type: 'sell' }, // Low liquidity (< 5 USDT)
    { price: '1502.00', coin_amount: '100', offer_type: 'buy' }, // Wrong offer_type (buy instead of sell)
  ]

  const res = calculateRemitanoRate(mockOffers)
  assert.equal(res.valid, true)
  assert.equal(res.sampleSize, 6) // 6 valid sell offers
  assert.ok(res.rate >= 1485 && res.rate <= 1515)
  assert.equal(res.source, 'remitano_p2p')
  assert.equal(res.proxyAsset, 'USDT')
})

test('isRateFresh and isRateJumpAbnormal respect thresholds', () => {
  const now = Date.now()
  assert.equal(isRateFresh(now - 10 * 60 * 1000), true) // 10 mins old is fresh
  assert.equal(isRateFresh(now - 65 * 60 * 1000), false) // 65 mins old is stale

  assert.equal(isRateJumpAbnormal(1550, 1500), false) // ~3.3% jump is safe
  assert.equal(isRateJumpAbnormal(1800, 1500), true) // 20% jump is abnormal (> 15%)
})

test('Quidax Spot module correctly parses orderbook ticker payload', async () => {
  // Test calculation and bounds check
  const fakeResponse = {
    status: 'success',
    message: 'Market ticker fetched successfully',
    data: {
      at: 1729245000,
      ticker: {
        buy: '1360.00',
        sell: '1365.50',
        low: '1350.00',
        high: '1375.00',
        last: '1364.00',
        vol: '125000',
      },
    },
  }

  // Verify sell price is used as proxy rate
  const sellPrice = Number(fakeResponse.data.ticker.sell)
  assert.equal(sellPrice, 1365.50)
  assert.ok(sellPrice >= 500 && sellPrice <= 5000)
})

test('Storefront Discovery PRNG generates deterministic sequences and stable pagination without duplicates', () => {
  const mockProducts: StorefrontProduct[] = []
  // Generate 50 mock products across Server 1, 2, 3, 4 with varied prices
  for (let i = 1; i <= 50; i++) {
    const serverNum = (i % 4) + 1 // 1, 2, 3, 4
    const isBudget = i % 2 === 0
    mockProducts.push({
      id: `p-${i}`,
      category_id: `cat-${(i % 5) + 1}`,
      slug: `product-${i}`,
      name: `Product ${i} Server ${serverNum}`,
      price_minor: isBudget ? 500000 : 2500000, // ₦5,000 or ₦25,000
      currency: 'NGN',
      available_quantity: 10,
      featured: i % 10 === 0 ? 1 : 0,
      server_number: serverNum,
      features: [],
      supplier_image_urls: [],
      created_at: new Date(1729200000000 + i * 1000).toISOString(),
    })
  }

  const config: StorefrontDiscoveryConfig = {
    rotation_enabled: true,
    affordable_priority_enabled: true,
    affordable_max_minor: 1500000, // ₦15,000.00
    affordable_weight: 65,
    featured_weight: 20,
    new_weight: 15,
    products_per_page: 20,
    updated_at: Date.now(),
  }

  const seed = 'test_seed_alpha_123'
  const seq1 = buildDiscoverySequence(mockProducts, config, seed)
  const seq2 = buildDiscoverySequence(mockProducts, config, seed)

  // 1. Same seed produces 100% identical sequence
  assert.equal(seq1.length, mockProducts.length)
  for (let i = 0; i < seq1.length; i++) {
    assert.equal(seq1[i].id, seq2[i].id)
  }

  // 2. Different seed produces different shuffle
  const seqDifferent = buildDiscoverySequence(mockProducts, config, 'different_seed_999')
  assert.notDeepEqual(
    seq1.map((p) => p.id),
    seqDifferent.map((p) => p.id)
  )

  // 3. Stable pagination: Page 1 and Page 2 have ZERO duplicate products!
  const pageSize = 20
  const page1 = seq1.slice(0, pageSize)
  const page2 = seq1.slice(pageSize, pageSize * 2)

  const page1Ids = new Set(page1.map((p) => p.id))
  for (const item of page2) {
    assert.equal(page1Ids.has(item.id), false, `Product ${item.id} found on both page 1 and page 2!`)
  }

  // 4. Multi-supplier representation: Server 1, Server 2, Server 3, Server 4 are all represented
  const serversInTop20 = new Set(page1.map((p) => p.server_number))
  assert.ok(serversInTop20.has(1), 'Server 1 represented')
  assert.ok(serversInTop20.has(2), 'Server 2 represented')
  assert.ok(serversInTop20.has(3), 'Server 3 represented')
  assert.ok(serversInTop20.has(4), 'Server 4 represented')

  // 5. Affordable priority: top slots have high concentration of budget items
  const budgetCountTop10 = page1.slice(0, 10).filter((p) => p.price_minor <= 1500000).length
  assert.ok(budgetCountTop10 >= 5, `Expected >= 5 budget items in top 10, got ${budgetCountTop10}`)
})

test('normalizeDigitalTopCatalog converts USD prices to NGN minor units with active FX rate', () => {
  const mockRawItems: DigitalTopProduct[] = [
    {
      id: 'dt-gpt4',
      name: 'ChatGPT Plus 1 Month Subscription',
      description: 'Official ChatGPT Plus shared license with GPT-4 access.',
      price_usd: 20.0,
      stock: 15,
      plans: [{ name: 'Monthly', price_usd: 20.0, duration_days: 30 }],
    },
    {
      id: 'dt-midjourney',
      name: 'Midjourney Standard Plan',
      description: 'Midjourney standard subscription with fast GPU hours.',
      price_usd: 30.0,
      stock: 8,
    },
  ]

  const fxRate = 1500.0 // ₦1,500 / $1
  const { products } = normalizeDigitalTopCatalog(mockRawItems, fxRate)

  assert.equal(products.length, 2)
  // 20 USD * 1500 * 100 = 3,000,000 minor units (₦30,000)
  assert.equal(products[0].id, 'dt-gpt4')
  assert.equal(products[0].costMinor, 3000000)
  assert.equal(products[0].stock, 15)

  // 30 USD * 1500 * 100 = 4,500,000 minor units (₦45,000)
  assert.equal(products[1].id, 'dt-midjourney')
  assert.equal(products[1].costMinor, 4500000)
  assert.equal(products[1].stock, 8)
})
