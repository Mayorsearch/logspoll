import test from 'node:test'
import assert from 'node:assert/strict'
import {
  generateBybitV5Signature,
  calculateRepresentativeRate,
  isRateFresh,
  isRateJumpAbnormal,
} from '../server/bybit-p2p.ts'
import {
  normalizeDigitalTopCatalog,
  type DigitalTopProduct,
} from '../server/digitaltop.ts'

test('Bybit V5 HMAC signature generates reproducible hex digest', async () => {
  const timestamp = '1792000000000'
  const apiKey = 'test_api_key'
  const recvWindow = '5000'
  const body = '{"tokenId":"USDT","currencyId":"NGN","side":"1","page":"1","size":"30"}'
  const secret = 'test_api_secret'

  const sig = await generateBybitV5Signature(timestamp, apiKey, recvWindow, body, secret)
  assert.equal(typeof sig, 'string')
  assert.equal(sig.length, 64)
  assert.match(sig, /^[0-9a-f]{64}$/)

  // Same inputs produce identical signature
  const sig2 = await generateBybitV5Signature(timestamp, apiKey, recvWindow, body, secret)
  assert.equal(sig, sig2)
})

test('calculateRepresentativeRate filters low liquidity, outliers, and computes robust trimmed median', () => {
  const mockAds = [
    { price: '1480.50', quantity: '100', finishRate: '95%' },
    { price: '1490.00', quantity: '50', finishRate: '92%' },
    { price: '1500.00', quantity: '200', finishRate: '98%' },
    { price: '1505.00', quantity: '80', finishRate: '90%' },
    { price: '1510.00', quantity: '500', finishRate: '99%' },
    { price: '1520.00', quantity: '40', finishRate: '88%' },
    // Outliers & low liquidity to be filtered:
    { price: '300.00', quantity: '100' }, // Below sanity bound 500
    { price: '9999.00', quantity: '100' }, // Above sanity bound 5000
    { price: '1495.00', quantity: '2' }, // Low liquidity (< 10 USDT)
    { price: '1502.00', quantity: '100', finishRate: '50%' }, // Low completion (< 70%)
  ]

  const res = calculateRepresentativeRate(mockAds)
  assert.equal(res.valid, true)
  assert.equal(res.sampleSize, mockAds.length)
  assert.ok(res.rate >= 1485 && res.rate <= 1515)
  assert.equal(res.source, 'bybit_p2p')
})

test('isRateFresh and isRateJumpAbnormal respect thresholds', () => {
  const now = Date.now()
  assert.equal(isRateFresh(now - 10 * 60 * 1000), true) // 10 mins old is fresh
  assert.equal(isRateFresh(now - 65 * 60 * 1000), false) // 65 mins old is stale

  assert.equal(isRateJumpAbnormal(1550, 1500), false) // ~3.3% jump is safe
  assert.equal(isRateJumpAbnormal(1800, 1500), true) // 20% jump is abnormal (> 15%)
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

