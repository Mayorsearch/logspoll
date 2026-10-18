import { convertUsdToNgnMinor, parseDecimalToMinor } from './shopviaclone22.ts'

export const DIGITALTOP_DEFAULT_BASE_URL = 'https://api.digitaltop.core'

export type DigitalTopPlan = {
  id: string
  name: string
  durationDays?: number
  costMinor: number
  currency: string
}

export type DigitalTopProduct = {
  id: string
  name: string
  description?: string
  category?: string
  categoryId?: string
  plans?: DigitalTopPlan[]
  price?: string | number
  currency?: string
  stock?: number | string
  [key: string]: unknown
}

export type NormalizedDigitalTopProduct = {
  id: string
  categoryId: string
  categoryName: string
  name: string
  description: string
  plans: DigitalTopPlan[]
  costMinor: number
  usdCostMinor?: number
  currency: string
  stock: number
  raw: DigitalTopProduct
}

export type DigitalTopProfile = {
  username?: string
  balance?: string | number
  currency?: string
  email?: string
  connected?: boolean
  message?: string
}

export type DigitalTopCredentials = {
  apiKey: string
  apiSecret?: string
  baseUrl?: string
}

export class DigitalTopError extends Error {
  readonly status: number
  readonly code: string
  constructor(message: string, status = 502, code = 'digitaltop_error') {
    super(message)
    this.name = 'DigitalTopError'
    this.status = status
    this.code = code
  }
}

const safeText = (val: unknown, maxLen = 200): string => {
  if (typeof val !== 'string') return ''
  const trimmed = val.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim()
  return trimmed.slice(0, maxLen)
}

const safeId = (val: unknown): string => {
  const s = String(val ?? '').trim()
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(s)) throw new DigitalTopError('Invalid identifier in DigitalTop supplier data.')
  return s
}

/**
 * Normalizes DigitalTop products into LogsPoll catalog format.
 * Converts USD-denominated products to NGN using the validated Bybit P2P rate.
 * Products already denominated in NGN are preserved without re-conversion.
 */
export function normalizeDigitalTopCatalog(
  payload: unknown,
  usdToNgnRate = 1500
): { categories: { id: string; name: string }[]; products: NormalizedDigitalTopProduct[] } {
  if (!payload || typeof payload !== 'object') {
    throw new DigitalTopError('Invalid DigitalTop response schema: object expected.')
  }

  const categories: { id: string; name: string }[] = []
  const products: NormalizedDigitalTopProduct[] = []
  const categoryMap = new Map<string, string>()
  const seenProductIds = new Set<string>()

  let rawList: unknown[] = []
  if (Array.isArray(payload)) {
    rawList = payload
  } else {
    const root = payload as Record<string, unknown>
    if (Array.isArray(root.products)) rawList = root.products
    else if (Array.isArray(root.items)) rawList = root.items
    else if (Array.isArray(root.data)) rawList = root.data
    else if (root.data && typeof root.data === 'object' && Array.isArray((root.data as any).products)) {
      rawList = (root.data as any).products
    }
  }

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue
    const prod = item as Record<string, unknown>
    const prodId = safeId(prod.id ?? '')
    if (seenProductIds.has(prodId)) continue
    seenProductIds.add(prodId)

    const catId = safeId(prod.category_id || prod.categoryId || 'server4_ai_tools')
    const catName = safeText(prod.category_name || prod.categoryName || 'AI Tools & Subscriptions', 120)
    if (!categoryMap.has(catId)) {
      categoryMap.set(catId, catName)
      categories.push({ id: catId, name: catName })
    }

    const name = safeText(prod.name, 200) || `AI Tool ${prodId}`
    const description = safeText(prod.description, 10000) || name
    const rawCurrency = String(prod.currency ?? 'USD').toUpperCase().trim()
    const rawPriceVal = prod.price ?? prod.price_usd ?? prod.cost ?? '0'
    const rawPriceStr = typeof rawPriceVal === 'number' ? rawPriceVal.toFixed(2) : String(rawPriceVal).trim()
    const rawPriceMinor = parseDecimalToMinor(rawPriceStr)

    let costMinor: number
    let usdCostMinor: number | undefined

    if (rawCurrency === 'USD') {
      usdCostMinor = rawPriceMinor
      costMinor = convertUsdToNgnMinor(rawPriceMinor, usdToNgnRate)
    } else {
      costMinor = rawPriceMinor
    }

    const rawStock = Number(prod.amount ?? prod.stock ?? 10)
    const stock = Number.isSafeInteger(rawStock) && rawStock >= 0 && rawStock <= 1_000_000 ? rawStock : 0

    // Parse plans if provided
    const rawPlans = Array.isArray(prod.plans) ? prod.plans : []
    const plans: DigitalTopPlan[] = []
    for (const p of rawPlans) {
      if (p && typeof p === 'object') {
        const pObj = p as Record<string, unknown>
        const planId = safeId(pObj.id ?? `${prodId}-plan-${plans.length}`)
        const planName = safeText(pObj.name, 100) || 'Standard Plan'
        const planPriceVal = pObj.price ?? pObj.price_usd ?? pObj.cost ?? '0'
        const planPriceStr = typeof planPriceVal === 'number' ? planPriceVal.toFixed(2) : String(planPriceVal).trim()
        const planPrice = parseDecimalToMinor(planPriceStr)
        const planCost = rawCurrency === 'USD' ? convertUsdToNgnMinor(planPrice, usdToNgnRate) : planPrice
        plans.push({
          id: planId,
          name: planName,
          durationDays: Number(pObj.durationDays ?? pObj.duration_days ?? 30),
          costMinor: planCost,
          currency: 'NGN',
        })
      }
    }

    products.push({
      id: prodId,
      categoryId: catId,
      categoryName: catName,
      name,
      description,
      plans,
      costMinor,
      usdCostMinor,
      currency: 'NGN',
      stock,
      raw: {
        id: prodId,
        name,
        description,
        price: String(prod.price ?? ''),
        currency: rawCurrency,
        stock,
      },
    })
  }

  return { categories, products }
}

/**
 * Perform read-only connection test for DigitalTop.
 * Safe; never creates charges, orders, or fulfillments.
 */
export async function fetchDigitalTopProfile(credentials: DigitalTopCredentials): Promise<DigitalTopProfile> {
  const key = credentials.apiKey?.trim()
  if (!key) throw new DigitalTopError('DigitalTop API key is required.', 400, 'missing_api_key')

  const baseUrl = (credentials.baseUrl?.trim() || DIGITALTOP_DEFAULT_BASE_URL).replace(/\/+$/, '')

  // If using placeholder or unconfirmed domain, return structured onboarding guidance
  if (baseUrl.includes('.core') || baseUrl.includes('placeholder')) {
    return {
      connected: false,
      message: 'DigitalTop API Base URL and official endpoint documentation must be provided by the supplier.',
    }
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl}/profile`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LogsPoll/2.0',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    })
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    throw new DigitalTopError(
      isTimeout ? 'DigitalTop connection timed out after 10s.' : 'Unable to connect to DigitalTop server.',
      504,
      'network_failure'
    )
  }

  if (response.status === 401 || response.status === 403) {
    throw new DigitalTopError('Invalid DigitalTop API credentials or unauthorized access.', response.status, 'unauthorized')
  }

  if (!response.ok) {
    throw new DigitalTopError(`DigitalTop returned HTTP ${response.status}.`, response.status, 'http_error')
  }

  const json = await response.json().catch(() => null)
  return json as DigitalTopProfile
}

