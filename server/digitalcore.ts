import { convertUsdToNgnMinor, parseDecimalToMinor } from './shopviaclone22.ts'

export const DIGITALCORE_DEFAULT_BASE_URL = 'https://digitalcore.top'

export type DigitalCoreTier = {
  minQty: number
  maxQty: number | null
  price: number
}

export type DigitalCoreProduct = {
  id: string
  name: string
  description?: string
  stock: number
  price: number | string
  priceFrom?: number | string
  tiers?: DigitalCoreTier[]
  [key: string]: unknown
}

export type NormalizedDigitalCoreProduct = {
  id: string
  categoryId: string
  categoryName: string
  name: string
  description: string
  costMinor: number
  usdCostMinor: number
  currency: string
  stock: number
  tiers: DigitalCoreTier[]
  raw: DigitalCoreProduct
}

export type DigitalCoreProfile = {
  connected: boolean
  balance?: number
  totalOrders?: number | string
  message?: string
}

export type DigitalCoreCredentials = {
  apiKey: string
  baseUrl?: string
}

export class DigitalCoreError extends Error {
  readonly status: number
  readonly code: string
  constructor(message: string, status = 502, code = 'digitalcore_error') {
    super(message)
    this.name = 'DigitalCoreError'
    this.status = status
    this.code = code
  }
}

const safeText = (val: unknown, maxLen = 200): string => {
  if (typeof val !== 'string') return ''
  const trimmed = val.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim()
  return trimmed.slice(0, maxLen)
}

export const safeId = (val: unknown, fallbackName?: unknown): string => {
  let s = String(val ?? '').trim()
  if (!s && fallbackName) {
    s = String(fallbackName).trim()
  }
  // Sanitize: convert spaces, plus, dots, slashes, and special characters to underscores
  s = s.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 128)
  if (!s) {
    s = 'item_' + Math.random().toString(36).slice(2, 10)
  }
  return s
}

/**
 * Normalizes DigitalCore products into LogsPoll catalog format.
 * Converts USD-denominated supplier prices to NGN using the configured/Remitano exchange rate.
 * Category is set to AI Tools.
 */
export function normalizeDigitalCoreCatalog(
  payload: unknown,
  usdToNgnRate = 1500
): { categories: { id: string; name: string }[]; products: NormalizedDigitalCoreProduct[] } {
  if (!payload) {
    throw new DigitalCoreError('Invalid DigitalCore response: payload is empty.')
  }

  let rawList: unknown[] = []
  if (Array.isArray(payload)) {
    rawList = payload
  } else if (typeof payload === 'object') {
    const root = payload as Record<string, unknown>
    if (Array.isArray(root.products)) rawList = root.products
    else if (Array.isArray(root.data)) rawList = root.data
    else if (Array.isArray(root.items)) rawList = root.items
    else {
      throw new DigitalCoreError('Invalid DigitalCore response schema: array of products expected.')
    }
  } else {
    throw new DigitalCoreError('Invalid DigitalCore response schema: object or array expected.')
  }

  const categoryId = 'c8402d52-37ef-4dfb-df2f-47cd20cd7004'
  const categoryName = 'AI Tools'
  const categories = [{ id: categoryId, name: categoryName }]
  const products: NormalizedDigitalCoreProduct[] = []
  const seenProductIds = new Set<string>()

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue
    const prod = item as Record<string, unknown>
    const rawId = prod.id ?? prod.slug ?? prod.external_id ?? prod.product_id
    const prodId = safeId(rawId, prod.name ?? prod.title)
    if (seenProductIds.has(prodId)) continue
    seenProductIds.add(prodId)

    const name = safeText(prod.name ?? prod.title, 200) || `AI Tool ${prodId}`
    const description = safeText(prod.description ?? prod.desc ?? prod.desc_tg ?? prod.details, 10000) || name

    // DigitalCore prices are in USD (e.g. 0.55 = $0.55, 13.50 = $13.50)
    const rawPriceVal = prod.price ?? prod.priceFrom ?? (Array.isArray(prod.tiers) && prod.tiers[0]?.price) ?? '0'
    const rawPriceStr = typeof rawPriceVal === 'number' ? rawPriceVal.toFixed(2) : String(rawPriceVal).trim()
    const rawPriceMinor = parseDecimalToMinor(rawPriceStr)

    // Convert USD minor to NGN minor
    const costMinor = convertUsdToNgnMinor(rawPriceMinor, usdToNgnRate)

    const rawStock = Number(prod.stock ?? 0)
    const stock = Number.isSafeInteger(rawStock) && rawStock >= 0 && rawStock <= 1_000_000 ? rawStock : 0

    // Parse tiers if provided
    const tiers: DigitalCoreTier[] = []
    if (Array.isArray(prod.tiers)) {
      for (const t of prod.tiers) {
        if (t && typeof t === 'object') {
          const tObj = t as Record<string, unknown>
          tiers.push({
            minQty: Number(tObj.minQty ?? 1),
            maxQty: tObj.maxQty !== null && tObj.maxQty !== undefined ? Number(tObj.maxQty) : null,
            price: Number(tObj.price ?? 0),
          })
        }
      }
    }

    let logoUrl = typeof prod.logo === 'string' ? prod.logo.trim() : ''
    if (logoUrl && !logoUrl.startsWith('http')) {
      logoUrl = `https://digitalcore.top${logoUrl.startsWith('/') ? '' : '/'}${logoUrl}`
    }

    products.push({
      id: prodId,
      categoryId,
      categoryName,
      name,
      description,
      costMinor,
      usdCostMinor: rawPriceMinor,
      currency: 'NGN',
      stock,
      tiers,
      raw: {
        id: prodId,
        name,
        description,
        price: rawPriceVal as any,
        priceFrom: prod.priceFrom as any,
        stock,
        tiers,
        logo: logoUrl,
        type: prod.type,
        warranty: prod.warranty,
        region: prod.region,
      },
    })
  }

  return { categories, products }
}

/**
 * Perform read-only connection test for DigitalCore via GET /api/user/me.
 * Safe; never creates charges, orders, or fulfillments.
 */
export async function fetchDigitalCoreProfile(credentials: DigitalCoreCredentials): Promise<DigitalCoreProfile> {
  const key = credentials.apiKey?.trim()
  if (!key) throw new DigitalCoreError('DigitalCore API key is required.', 400, 'missing_api_key')

  const baseUrl = (credentials.baseUrl?.trim() || DIGITALCORE_DEFAULT_BASE_URL).replace(/\/+$/, '')

  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/user/me`, {
      method: 'GET',
      headers: {
        'Api-Key': key,
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LogsPoll/2.0',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    })
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    throw new DigitalCoreError(
      isTimeout ? 'DigitalCore connection timed out after 10s.' : 'Unable to reach DigitalCore server.',
      504,
      'network_failure'
    )
  }

  if (response.status === 401 || response.status === 403) {
    const errBody = await response.json().catch(() => null) as { msg?: string } | null
    const code = errBody?.msg || 'INVALID_API_KEY'
    throw new DigitalCoreError(`Invalid DigitalCore API key: ${code}`, response.status, code)
  }

  if (!response.ok) {
    throw new DigitalCoreError(`DigitalCore returned HTTP ${response.status}.`, response.status, 'http_error')
  }

  const json = await response.json().catch(() => null) as { balance?: number; total_orders?: string | number } | null
  if (!json || typeof json !== 'object') {
    throw new DigitalCoreError('Invalid JSON response received from DigitalCore.', 502, 'invalid_response')
  }

  return {
    connected: true,
    balance: typeof json.balance === 'number' ? json.balance : Number(json.balance ?? 0),
    totalOrders: json.total_orders ?? 0,
    message: `Connected successfully. Balance: $${Number(json.balance ?? 0).toFixed(2)} USD, Total Orders: ${json.total_orders ?? 0}`,
  }
}

/**
 * Fetch all products from DigitalCore catalog via GET /api/user/products.
 */
export async function fetchDigitalCoreProducts(credentials: DigitalCoreCredentials): Promise<DigitalCoreProduct[]> {
  const key = credentials.apiKey?.trim()
  if (!key) throw new DigitalCoreError('DigitalCore API key is required.', 400, 'missing_api_key')

  const baseUrl = (credentials.baseUrl?.trim() || DIGITALCORE_DEFAULT_BASE_URL).replace(/\/+$/, '')

  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/user/products`, {
      method: 'GET',
      headers: {
        'Api-Key': key,
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LogsPoll/2.0',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    })
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    throw new DigitalCoreError(
      isTimeout ? 'DigitalCore products request timed out after 15s.' : 'Unable to connect to DigitalCore server.',
      504,
      'network_failure'
    )
  }

  if (response.status === 401 || response.status === 403) {
    throw new DigitalCoreError('DigitalCore unauthorized: invalid API key.', response.status, 'unauthorized')
  }

  const data = await response.json().catch(() => null)
  if (Array.isArray(data) && data.length > 0) {
    return data as DigitalCoreProduct[]
  }

  // Gracefully fallback to /api/public/products
  try {
    const pubRes = await fetch(`${baseUrl}/api/public/products`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LogsPoll/2.0',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (pubRes.ok) {
      const pubData = await pubRes.json().catch(() => null)
      if (Array.isArray(pubData) && pubData.length > 0) {
        return pubData as DigitalCoreProduct[]
      }
    }
  } catch {}

  if (!response.ok) {
    throw new DigitalCoreError(`DigitalCore products returned HTTP ${response.status}.`, response.status, 'http_error')
  }

  throw new DigitalCoreError('DigitalCore products response was empty or not an array.', 502, 'invalid_schema')
}

/**
 * Fetch single product details via GET /api/user/product?id=...
 */
export async function fetchDigitalCoreProduct(
  credentials: DigitalCoreCredentials,
  productId: string
): Promise<DigitalCoreProduct> {
  const key = credentials.apiKey?.trim()
  if (!key) throw new DigitalCoreError('DigitalCore API key is required.', 400, 'missing_api_key')

  const baseUrl = (credentials.baseUrl?.trim() || DIGITALCORE_DEFAULT_BASE_URL).replace(/\/+$/, '')
  const safePId = encodeURIComponent(productId)

  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/user/product?id=${safePId}`, {
      method: 'GET',
      headers: {
        'Api-Key': key,
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LogsPoll/2.0',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    })
  } catch (err) {
    throw new DigitalCoreError('Unable to reach DigitalCore product endpoint.', 504, 'network_failure')
  }

  if (response.status === 404) {
    throw new DigitalCoreError(`DigitalCore product ${productId} not found.`, 404, 'product_not_found')
  }

  if (!response.ok) {
    throw new DigitalCoreError(`DigitalCore product returned HTTP ${response.status}.`, response.status, 'http_error')
  }

  const data = await response.json().catch(() => null)
  return data as DigitalCoreProduct
}

/**
 * Purchase products using Telegram bot balance via POST /api/user/buy.
 * Only call when customer payment is verified.
 */
export async function buyDigitalCoreProduct(
  credentials: DigitalCoreCredentials,
  params: { id: string; count?: number }
): Promise<{ success: boolean; orderId: string; viewUrl?: string; totalAmount: number; quantity: number; items: string[] }> {
  const key = credentials.apiKey?.trim()
  if (!key) throw new DigitalCoreError('DigitalCore API key is required.', 400, 'missing_api_key')

  const baseUrl = (credentials.baseUrl?.trim() || DIGITALCORE_DEFAULT_BASE_URL).replace(/\/+$/, '')
  const count = params.count && params.count > 0 ? params.count : 1

  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/user/buy`, {
      method: 'POST',
      headers: {
        'Api-Key': key,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LogsPoll/2.0',
      },
      body: JSON.stringify({ id: params.id, count }),
      signal: AbortSignal.timeout(20000),
    })
  } catch (err) {
    throw new DigitalCoreError('DigitalCore purchase request timed out or network failed.', 504, 'purchase_network_error')
  }

  const json = await response.json().catch(() => null) as {
    success?: boolean
    order_id?: string
    view_url?: string
    total_amount?: number
    quantity?: number
    items?: string[]
    msg?: string
  } | null

  if (!response.ok || !json?.success) {
    const errorMsg = json?.msg || `HTTP ${response.status}`
    throw new DigitalCoreError(`DigitalCore purchase failed: ${errorMsg}`, response.status, errorMsg)
  }

  return {
    success: true,
    orderId: json.order_id || '',
    viewUrl: json.view_url,
    totalAmount: Number(json.total_amount ?? 0),
    quantity: Number(json.quantity ?? count),
    items: Array.isArray(json.items) ? json.items : [],
  }
}

