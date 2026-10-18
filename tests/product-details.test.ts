import test from 'node:test'
import assert from 'node:assert/strict'

// Server badge formatting helper
function formatServerBadge(serverNumber?: number): string {
  const num = serverNumber ?? 1
  return `SERVER ${num}`
}

// Ensure supplier names are strictly forbidden in public labels
function sanitizeServerLabel(label: string): string {
  const forbidden = ['hstora', 'youngpg', 'shopviaclone22', 'digitaltop', 'digitalcore']
  for (const f of forbidden) {
    if (label.toLowerCase().includes(f)) {
      throw new Error(`Forbidden supplier name detected: ${f}`)
    }
  }
  return label
}

// AI Tools Tier parser logic
interface ParsedTier {
  minQty: number
  maxQty: number | null
  usdPrice: number
  priceMinor: number
  savingsPercent: number
}

function parseTiers(features: string[], basePriceMinor: number): ParsedTier[] {
  const parsed: { minQty: number; maxQty: number | null; usdPrice: number }[] = []

  for (const f of features) {
    const match = f.match(/Tier\s*\(\s*(\d+)(?:[–-](\d+))?\+?\s*units?\s*\)\s*:\s*\$([0-9.]+)\s*USD/i)
    if (match) {
      parsed.push({
        minQty: parseInt(match[1], 10),
        maxQty: match[2] ? parseInt(match[2], 10) : null,
        usdPrice: parseFloat(match[3]),
      })
    }
  }

  if (parsed.length === 0) return []
  parsed.sort((a, b) => a.minQty - b.minQty)
  const baseUsd = parsed[0].usdPrice

  return parsed.map((t) => {
    const ratio = baseUsd > 0 ? t.usdPrice / baseUsd : 1
    const priceMinor = Math.round(basePriceMinor * ratio)
    const savingsPercent = Math.max(0, Math.round((1 - ratio) * 100))
    return {
      ...t,
      priceMinor,
      savingsPercent,
    }
  })
}

// Duration parser
function parseDuration(term?: string, name?: string): string {
  if (term && term.trim()) return term.trim()
  const match = (name ?? '').match(/\b(\d+\s*(?:Months?|Days?|Years?|Hours?|Weeks?))\b/i)
  return match ? match[1] : 'Standard Validity'
}

test('Server badge mapping renders strictly Server 1–4 and blocks supplier names', () => {
  for (const s of [1, 2, 3, 4]) {
    const badge = formatServerBadge(s)
    assert.equal(badge, `SERVER ${s}`)
    assert.doesNotThrow(() => sanitizeServerLabel(badge))
  }

  // Fallback defaults to Server 1
  assert.equal(formatServerBadge(undefined), 'SERVER 1')

  // Forbidden supplier names throw
  assert.throws(() => sanitizeServerLabel('Server 1 · HStora'))
  assert.throws(() => sanitizeServerLabel('Server 2 - YoungPG'))
  assert.throws(() => sanitizeServerLabel('Server 3 - ShopViaClone22'))
  assert.throws(() => sanitizeServerLabel('Server 4 - DigitalCore'))
  assert.throws(() => sanitizeServerLabel('DigitalTop AI Tools'))
})

test('AI Tools tier parsing correctly extracts volume tiers and calculates NGN minor prices and savings', () => {
  const geminiFeatures = [
    'Tier (1–24 units): $0.42 USD',
    'Tier (25–99 units): $0.40 USD',
    'Tier (100+ units): $0.37 USD',
  ]
  const basePriceMinor = 94500 // ₦945.00

  const tiers = parseTiers(geminiFeatures, basePriceMinor)
  assert.equal(tiers.length, 3)

  // Tier 1 (1–24 units)
  assert.equal(tiers[0].minQty, 1)
  assert.equal(tiers[0].maxQty, 24)
  assert.equal(tiers[0].usdPrice, 0.42)
  assert.equal(tiers[0].priceMinor, 94500)
  assert.equal(tiers[0].savingsPercent, 0)

  // Tier 2 (25–99 units)
  assert.equal(tiers[1].minQty, 25)
  assert.equal(tiers[1].maxQty, 99)
  assert.equal(tiers[1].usdPrice, 0.40)
  assert.equal(tiers[1].priceMinor, 90000) // (0.40 / 0.42) * 94500 = 90000
  assert.equal(tiers[1].savingsPercent, 5) // (1 - 0.40/0.42) = 4.76% -> 5%

  // Tier 3 (100+ units)
  assert.equal(tiers[2].minQty, 100)
  assert.equal(tiers[2].maxQty, null)
  assert.equal(tiers[2].usdPrice, 0.37)
  assert.equal(tiers[2].priceMinor, 83250) // (0.37 / 0.42) * 94500 = 83250
  assert.equal(tiers[2].savingsPercent, 12) // (1 - 0.37/0.42) = 11.9% -> 12%
})

test('Duration extraction correctly parses term or extracts from product title', () => {
  assert.equal(parseDuration('30 Days', 'Product Name'), '30 Days')
  assert.equal(parseDuration('', 'Gemini Pro 18 Months'), '18 Months')
  assert.equal(parseDuration('', 'Lovable Pro Lite 12 months + 300 credits'), '12 months')
  assert.equal(parseDuration('', 'YouTube Premium 3 Months'), '3 Months')
  assert.equal(parseDuration('', 'Adobe Express 4 Months Trial'), '4 Months')
  assert.equal(parseDuration('', 'Duolingo Super 12 Months'), '12 Months')
  assert.equal(parseDuration(undefined, 'Tool Without Duration'), 'Standard Validity')
})

test('Quantity stepper clamps within stock bounds and prevents invalid orders', () => {
  const availableStock = 34

  const clampQty = (input: number) => Math.max(1, Math.min(availableStock, Math.min(1000, input)))

  assert.equal(clampQty(0), 1)
  assert.equal(clampQty(-5), 1)
  assert.equal(clampQty(1), 1)
  assert.equal(clampQty(10), 10)
  assert.equal(clampQty(34), 34)
  assert.equal(clampQty(35), 34) // Clamped to available stock
  assert.equal(clampQty(1000), 34)
})

