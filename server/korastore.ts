/**
 * Kora Reseller API Client (Server 4 · AI Tools)
 *
 * Implements official OpenAPI 3.1 specification from https://korastore.cv/api-docs:
 * - Base URL: https://korastore.cv/v1
 * - Authentication: Authorization: Bearer kora_sk_...
 * - Monetary unit: Kobo (NGN minor unit). 100 kobo = ₦1.
 */

export const KORASTORE_DEFAULT_BASE_URL = 'https://korastore.cv/v1'

export interface KoraProduct {
  id: string
  name: string
  price_kobo: number
  price_naira: number
  stock: number | null
  available: boolean
  delivery: 'instant' | 'manual'
}

export interface KoraProfile {
  ok: boolean
  balance_kobo: number
  balance_naira: number
}

export interface KoraBuyResponse {
  ok: boolean
  order_id: string
  status: string
  items: string[]
  balance_kobo?: number
}

export interface KoraOrder {
  order_id: string
  product: string
  status: string
  price_kobo: number
  items: string[]
  created_at: string
}

export class KoraStoreError extends Error {
  readonly status: number
  readonly code?: string
  readonly balanceKobo?: number

  constructor(status: number, message: string, code?: string, balanceKobo?: number) {
    super(message)
    this.name = 'KoraStoreError'
    this.status = status
    this.code = code
    this.balanceKobo = balanceKobo
  }
}

function cleanBaseUrl(url?: string): string {
  if (!url || !url.trim()) return KORASTORE_DEFAULT_BASE_URL
  return url.trim().replace(/\/+$/, '')
}

function buildHeaders(apiKey: string): Headers {
  let cleanKey = apiKey.trim()
  if (cleanKey.startsWith('{')) {
    try {
      const parsed = JSON.parse(cleanKey)
      if (parsed?.apiKey) cleanKey = String(parsed.apiKey).trim()
    } catch {}
  }
  if (!cleanKey) {
    throw new KoraStoreError(401, 'Kora Store API key is missing.')
  }
  return new Headers({
    Authorization: `Bearer ${cleanKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'LogsPoll-KoraStore/1.0',
  })
}

/**
 * Fetch wallet balance from GET /v1/me
 */
export async function fetchKoraProfile(apiKey: string, baseUrl?: string): Promise<KoraProfile> {
  const url = `${cleanBaseUrl(baseUrl)}/me`
  const res = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(apiKey),
    signal: AbortSignal.timeout(12000),
  })

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok || !body || body.ok === false) {
    const errorMsg = typeof body?.error === 'string' ? body.error : `Kora API error (HTTP ${res.status})`
    const code = typeof body?.code === 'string' ? body.code : undefined
    const bal = typeof body?.balance_kobo === 'number' ? body.balance_kobo : undefined
    throw new KoraStoreError(res.status, errorMsg, code, bal)
  }

  return {
    ok: true,
    balance_kobo: Number(body.balance_kobo ?? 0),
    balance_naira: Number(body.balance_naira ?? 0),
  }
}

/**
 * Fetch live catalog from GET /v1/products
 */
export async function fetchKoraProducts(apiKey: string, baseUrl?: string): Promise<KoraProduct[]> {
  const url = `${cleanBaseUrl(baseUrl)}/products`
  const res = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(apiKey),
    signal: AbortSignal.timeout(15000),
  })

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok || !body || body.ok === false) {
    const errorMsg = typeof body?.error === 'string' ? body.error : `Kora API error (HTTP ${res.status})`
    const code = typeof body?.code === 'string' ? body.code : undefined
    throw new KoraStoreError(res.status, errorMsg, code)
  }

  const rawList = Array.isArray(body.products) ? body.products : []
  return rawList.map((item: any) => ({
    id: String(item.id ?? ''),
    name: String(item.name ?? ''),
    price_kobo: Number(item.price_kobo ?? 0),
    price_naira: Number(item.price_naira ?? 0),
    stock: item.stock === null ? null : Number(item.stock ?? 0),
    available: Boolean(item.available),
    delivery: item.delivery === 'manual' ? 'manual' : 'instant',
  }))
}

/**
 * Purchase a product from POST /v1/buy
 */
export async function buyKoraProduct(
  apiKey: string,
  productId: string,
  idempotencyKey: string,
  baseUrl?: string
): Promise<KoraBuyResponse> {
  const url = `${cleanBaseUrl(baseUrl)}/buy`
  const payload = {
    product_id: productId,
    idempotency_key: idempotencyKey,
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000),
  })

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok || !body || body.ok === false) {
    const errorMsg = typeof body?.error === 'string' ? body.error : `Kora purchase failed (HTTP ${res.status})`
    const code = typeof body?.code === 'string' ? body.code : undefined
    const bal = typeof body?.balance_kobo === 'number' ? body.balance_kobo : undefined
    throw new KoraStoreError(res.status, errorMsg, code, bal)
  }

  return {
    ok: true,
    order_id: String(body.order_id ?? ''),
    status: String(body.status ?? 'delivered'),
    items: Array.isArray(body.items) ? body.items.map(String) : [],
    balance_kobo: typeof body.balance_kobo === 'number' ? body.balance_kobo : undefined,
  }
}

/**
 * Get single order with delivered items from GET /v1/orders/{id}
 */
export async function getKoraOrder(apiKey: string, orderId: string, baseUrl?: string): Promise<KoraOrder> {
  const url = `${cleanBaseUrl(baseUrl)}/orders/${encodeURIComponent(orderId)}`
  const res = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(apiKey),
    signal: AbortSignal.timeout(15000),
  })

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok || !body || body.ok === false) {
    const errorMsg = typeof body?.error === 'string' ? body.error : `Order lookup failed (HTTP ${res.status})`
    throw new KoraStoreError(res.status, errorMsg)
  }

  const o = (body.order ?? body) as Record<string, unknown>
  return {
    order_id: String(o.order_id ?? orderId),
    product: String(o.product ?? ''),
    status: String(o.status ?? 'unknown'),
    price_kobo: Number(o.price_kobo ?? 0),
    items: Array.isArray(o.items) ? o.items.map(String) : [],
    created_at: String(o.created_at ?? ''),
  }
}

/**
 * Get recent orders from GET /v1/orders
 */
export async function getKoraOrders(apiKey: string, baseUrl?: string): Promise<KoraOrder[]> {
  const url = `${cleanBaseUrl(baseUrl)}/orders`
  const res = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(apiKey),
    signal: AbortSignal.timeout(15000),
  })

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok || !body || body.ok === false) {
    const errorMsg = typeof body?.error === 'string' ? body.error : `Orders list failed (HTTP ${res.status})`
    throw new KoraStoreError(res.status, errorMsg)
  }

  const list = Array.isArray(body.orders) ? body.orders : []
  return list.map((o: any) => ({
    order_id: String(o.order_id ?? ''),
    product: String(o.product ?? ''),
    status: String(o.status ?? 'unknown'),
    price_kobo: Number(o.price_kobo ?? 0),
    items: Array.isArray(o.items) ? o.items.map(String) : [],
    created_at: String(o.created_at ?? ''),
  }))
}

/**
 * Independent percentage-based pricing formula:
 * sellingPrice = verifiedSupplierCostNGN * (1 + markupPercentage / 100)
 *
 * All values in kobo (integer minor units).
 * Example: ₦2,000 cost (200,000 kobo), 50% markup (5000 bps) -> ₦3,000 selling price (300,000 kobo).
 */
export function calculateKoraSellingPrice(costKobo: number, markupBps: number): number {
  if (!Number.isSafeInteger(costKobo) || costKobo < 0) {
    throw new Error('Invalid supplier cost kobo.')
  }
  const bps = Math.max(0, Math.min(1000000, markupBps))
  const multiplier = 10000n + BigInt(bps)
  const result = (BigInt(costKobo) * multiplier + 9999n) / 10000n
  return Number(result)
}

