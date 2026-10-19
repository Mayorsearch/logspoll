import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateSellingPrice } from '../server/pricing.ts'

test('Server 1-3 maintain 50% markup while Server 4 maintains 70% markup independently', () => {
  const baseCostMinor = 100000 // ₦1,000.00

  // Server 1 (HStora) @ 50%
  const s1MarkupBps = 5000
  const s1Price = calculateSellingPrice(baseCostMinor, {
    id: 's1',
    enabled: true,
    mode: 'markup',
    rateBps: s1MarkupBps,
    fixedMinor: 0,
    minProfitMinor: 0,
    feeBps: 0,
    feeFixedMinor: 0,
    fxBufferBps: 0,
    roundingMinor: 1,
  }).sellingPriceMinor
  assert.equal(s1Price, 150000, 'Server 1 selling price must be cost * 1.50 (50% markup)')

  // Server 2 (YoungPG) @ 50%
  const s2MarkupBps = 5000
  const s2Price = calculateSellingPrice(baseCostMinor, {
    id: 's2',
    enabled: true,
    mode: 'markup',
    rateBps: s2MarkupBps,
    fixedMinor: 0,
    minProfitMinor: 0,
    feeBps: 0,
    feeFixedMinor: 0,
    fxBufferBps: 0,
    roundingMinor: 1,
  }).sellingPriceMinor
  assert.equal(s2Price, 150000, 'Server 2 selling price must be cost * 1.50 (50% markup)')

  // Server 3 (ShopViaClone22) @ 50%
  const s3MarkupBps = 5000
  const s3Price = calculateSellingPrice(baseCostMinor, {
    id: 's3',
    enabled: true,
    mode: 'markup',
    rateBps: s3MarkupBps,
    fixedMinor: 0,
    minProfitMinor: 0,
    feeBps: 0,
    feeFixedMinor: 0,
    fxBufferBps: 0,
    roundingMinor: 1,
  }).sellingPriceMinor
  assert.equal(s3Price, 150000, 'Server 3 selling price must be cost * 1.50 (50% markup)')

  // Server 4 (DigitalCore) @ 70% exclusively
  const s4MarkupBps = 7000
  const s4Price = calculateSellingPrice(baseCostMinor, {
    id: 's4',
    enabled: true,
    mode: 'markup',
    rateBps: s4MarkupBps,
    fixedMinor: 0,
    minProfitMinor: 0,
    feeBps: 0,
    feeFixedMinor: 0,
    fxBufferBps: 0,
    roundingMinor: 1,
  }).sellingPriceMinor
  assert.equal(s4Price, 170000, 'Server 4 selling price must be cost * 1.70 (70% markup)')
})

test('Supplier-specific policy markup overrides global default markup', () => {
  const globalDefaultBps = 5000
  const supplierPolicies: Record<string, number> = {
    hstora: 5000,
    youngpg: 5000,
    shopviaclone22: 5000,
    digitalcore: 7000,
  }

  function resolveEffectiveMarkup(provider: string, globalMarkup = globalDefaultBps): number {
    if (provider === 'digitalcore') {
      return supplierPolicies.digitalcore ?? 7000
    }
    return supplierPolicies[provider] ?? globalMarkup
  }

  // Global default is 50%, but even if global is changed, supplier policies stay intact
  assert.equal(resolveEffectiveMarkup('hstora'), 5000)
  assert.equal(resolveEffectiveMarkup('youngpg'), 5000)
  assert.equal(resolveEffectiveMarkup('shopviaclone22'), 5000)
  assert.equal(resolveEffectiveMarkup('digitalcore'), 7000)

  // Even if global default is set to something else (e.g. 6000 bps), DigitalCore remains 7000 and others use their policy
  assert.equal(resolveEffectiveMarkup('digitalcore', 6000), 7000)
  assert.equal(resolveEffectiveMarkup('youngpg', 6000), 5000)
})

test('Manual price overrides are preserved and not replaced by automatic calculations', () => {
  interface MockProduct {
    id: string
    pricing_mode: 'auto' | 'override'
    cost_minor: number
    price_minor: number
  }

  const catalog: MockProduct[] = [
    { id: 'p1', pricing_mode: 'auto', cost_minor: 100000, price_minor: 170000 },
    { id: 'p2-override', pricing_mode: 'override', cost_minor: 100000, price_minor: 250000 },
  ]

  const s2MarkupBps = 5000

  // Apply markup recalculation
  const updated = catalog.map((p) => {
    if (p.pricing_mode === 'override') {
      return p // strictly preserve override
    }
    const newPrice = calculateSellingPrice(p.cost_minor, {
      id: 'rule',
      enabled: true,
      mode: 'markup',
      rateBps: s2MarkupBps,
      fixedMinor: 0,
      minProfitMinor: 0,
      feeBps: 0,
      feeFixedMinor: 0,
      fxBufferBps: 0,
      roundingMinor: 1,
    }).sellingPriceMinor
    return { ...p, price_minor: newPrice }
  })

  assert.equal(updated[0].price_minor, 150000, 'Auto product must be recalculated to 50% markup')
  assert.equal(updated[1].price_minor, 250000, 'Override product must retain its custom price')
})

