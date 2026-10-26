import { HttpError } from './auth.ts'

export type ShopViaProduct = {
  id: string
  name: string
  description: string
  price: string | number
  amount: number | string
  category_id?: string
}

export type ShopViaCategory = {
  id: string
  name: string
  products?: ShopViaProduct[]
}

export type NormalizedProduct = {
  id: string
  categoryId: string
  categoryName: string
  name: string
  description: string
  costMinor: number
  usdCostMinor?: number
  currency: string
  stock: number
  raw: ShopViaProduct
}

export type ShopViaProfile = {
  status?: string | number
  msg?: string
  username?: string
  balance?: string | number
  currency?: string
  email?: string
  [key: string]: unknown
}

export type PurchaseOrderParams = {
  productId: string
  amount: number
  customOrderId?: string
}

export class ShopViaError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.name = 'ShopViaError'
    this.status = status
  }
}

const safeText = (val: unknown, maxLen = 200): string => {
  if (typeof val !== 'string') return ''
  const trimmed = val.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim()
  return trimmed.slice(0, maxLen)
}

const safeId = (val: unknown): string => {
  const s = String(val ?? '').trim()
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(s)) throw new ShopViaError('Invalid identifier in supplier data.')
  return s
}

export function parseDecimalToMinor(priceStr: string | number): number {
  const str = String(priceStr ?? '').trim()
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(str)) {
    throw new ShopViaError('Invalid pricing format in supplier response.')
  }
  const [whole, cents = ''] = str.split('.')
  const cost = Number(whole) * 100 + Number(cents.padEnd(2, '0'))
  if (!Number.isSafeInteger(cost) || cost < 0 || cost > 99_999_999_900) {
    throw new ShopViaError('Supplier price is outside supported bounds.')
  }
  return cost
}

export function convertUsdToNgnMinor(usdMinor: number, usdToNgnRate: number): number {
  if (!Number.isFinite(usdMinor) || usdMinor < 0) {
    throw new ShopViaError('Invalid USD minor amount for conversion.')
  }
  if (!Number.isFinite(usdToNgnRate) || usdToNgnRate <= 0) {
    throw new ShopViaError('Invalid USD to NGN exchange rate.')
  }
  const ngnMinor = Math.round(usdMinor * usdToNgnRate)
  if (!Number.isSafeInteger(ngnMinor)) {
    throw new ShopViaError('Converted NGN minor amount exceeds safe integer range.')
  }
  return ngnMinor
}

export function normalizeShopViaCatalog(
  payload: unknown,
  usdToNgnRateOrCurrency: number | string = 1500,
  currencyParam = 'NGN'
): { categories: { id: string; name: string }[]; products: NormalizedProduct[] } {
  if (!payload || typeof payload !== 'object') {
    throw new ShopViaError('Invalid supplier response schema: object expected.')
  }

  let rate = 1500
  let currency = 'NGN'

  if (typeof usdToNgnRateOrCurrency === 'number') {
    rate = usdToNgnRateOrCurrency > 0 ? usdToNgnRateOrCurrency : 1500
    currency = currencyParam || 'NGN'
  } else if (typeof usdToNgnRateOrCurrency === 'string') {
    currency = usdToNgnRateOrCurrency
    if (usdToNgnRateOrCurrency === 'NGN') {
      rate = 1
    }
  }

  const categories: { id: string; name: string }[] = []
  const products: NormalizedProduct[] = []
  const seenProductIds = new Set<string>()

  let rawCategories: any[] = []
  let flatProducts: any[] = []

  if (Array.isArray(payload)) {
    flatProducts = payload
  } else {
    const root = payload as Record<string, unknown>
    if (Array.isArray(root.categories)) {
      rawCategories = root.categories
    } else if (root.data && typeof root.data === 'object') {
      const dataObj = root.data as Record<string, unknown>
      if (Array.isArray(dataObj.categories)) {
        rawCategories = dataObj.categories
      } else if (Array.isArray(root.data)) {
        flatProducts = root.data
      }
    } else if (Array.isArray(root.products)) {
      flatProducts = root.products
    }
  }

  // Handle categorized tree structure
  if (rawCategories.length > 0) {
    if (rawCategories.length > 500) {
      throw new ShopViaError('Category collection exceeds maximum supported limit (500).')
    }
    for (const catItem of rawCategories) {
      if (!catItem || typeof catItem !== 'object' || Array.isArray(catItem)) continue
      const cat = catItem as Record<string, unknown>
      const catId = safeId(cat.id ?? '')
      const catName = safeText(cat.name, 120) || `Category ${catId}`
      categories.push({ id: catId, name: catName })

      const rawProducts = Array.isArray(cat.products) ? cat.products : []
      if (rawProducts.length > 10000) {
        throw new ShopViaError(`Category ${catId} product count exceeds maximum supported limit.`)
      }

      for (const prodItem of rawProducts) {
        if (!prodItem || typeof prodItem !== 'object' || Array.isArray(prodItem)) continue
        const prod = prodItem as Record<string, unknown>
        const prodId = safeId(prod.id ?? '')
        if (seenProductIds.has(prodId)) continue
        seenProductIds.add(prodId)

        const name = safeText(prod.name, 200) || `Product ${prodId}`
        const description = safeText(prod.description, 10000) || name
        const usdCostMinor = parseDecimalToMinor(prod.price as string | number)
        const costMinor = convertUsdToNgnMinor(usdCostMinor, rate)
        const rawStock = Number(prod.amount)
        const stock = Number.isSafeInteger(rawStock) && rawStock >= 0 && rawStock <= 1_000_000 ? rawStock : 0

        products.push({
          id: prodId,
          categoryId: catId,
          categoryName: catName,
          name,
          description,
          costMinor,
          usdCostMinor,
          currency,
          stock,
          raw: {
            id: prodId,
            name,
            description,
            price: String(prod.price ?? ''),
            amount: stock,
            category_id: catId,
          },
        })
      }
    }
  } else if (flatProducts.length > 0) {
    // Handle flat product list
    const categoryMap = new Map<string, string>()
    for (const prodItem of flatProducts) {
      if (!prodItem || typeof prodItem !== 'object' || Array.isArray(prodItem)) continue
      const prod = prodItem as Record<string, unknown>
      const prodId = safeId(prod.id ?? '')
      if (seenProductIds.has(prodId)) continue
      seenProductIds.add(prodId)

      const catId = safeId(prod.category_id || prod.categoryId || 's3_general')
      const catName = safeText(prod.category_name || prod.categoryName || `Category ${catId}`, 120)
      if (!categoryMap.has(catId)) {
        categoryMap.set(catId, catName)
        categories.push({ id: catId, name: catName })
      }

      const name = safeText(prod.name, 200) || `Product ${prodId}`
      const description = safeText(prod.description, 10000) || name
      const usdCostMinor = parseDecimalToMinor(prod.price as string | number)
      const costMinor = convertUsdToNgnMinor(usdCostMinor, rate)
      const rawStock = Number(prod.amount)
      const stock = Number.isSafeInteger(rawStock) && rawStock >= 0 && rawStock <= 1_000_000 ? rawStock : 0

      products.push({
        id: prodId,
        categoryId: catId,
        categoryName: catName,
        name,
        description,
        costMinor,
        usdCostMinor,
        currency,
        stock,
        raw: {
          id: prodId,
          name,
          description,
          price: String(prod.price ?? ''),
          amount: stock,
          category_id: catId,
        },
      })
    }
  } else {
    throw new ShopViaError('Invalid supplier response schema: no categories or products found.')
  }

  return { categories, products }
}

const DEFAULT_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LogsPoll/2.0',
}

/**
 * Perform initial read-only connection test using GET /profile.php?api_key=KEY.
 * Never creates wallet charges, reservations, or purchases.
 */
export async function fetchShopViaProfile(
  apiKey: string,
  baseUrl = 'https://shopviaclone22.com/api'
): Promise<ShopViaProfile> {
  const key = apiKey.trim()
  if (!key || key.length > 256 || /[^\x21-\x7e]/.test(key)) {
    throw new ShopViaError('Invalid ShopViaClone22 API key format.', 400)
  }

  const cleanBase = baseUrl.trim().replace(/\/+$/, '')
  if (!cleanBase.startsWith('https://') && !cleanBase.startsWith('http://localhost')) {
    throw new ShopViaError('ShopViaClone22 base URL must use HTTPS.', 400)
  }

  const endpoint = `${cleanBase}/profile.php?api_key=${encodeURIComponent(key)}`
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: DEFAULT_HEADERS,
    })
  } catch (error) {
    const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new ShopViaError(
      isTimeout
        ? 'ShopViaClone22 connection timed out after 15 seconds.'
        : 'Unable to reach ShopViaClone22 server. Check network or server status.',
      504
    )
  }

  if (response.status === 401) {
    throw new ShopViaError('Invalid API Key: verify your ShopViaClone22 API key in API Manager.', 401)
  }
  if (response.status === 403) {
    throw new ShopViaError('Access restricted: verify IP whitelist settings in ShopViaClone22.', 403)
  }
  if (response.status === 404) {
    throw new ShopViaError('ShopViaClone22 endpoint not found (HTTP 404). Check API Base URL.', 404)
  }
  if (response.status === 429) {
    throw new ShopViaError('ShopViaClone22 rate limit reached; retry later.', 429)
  }
  if (response.status >= 500) {
    throw new ShopViaError(`ShopViaClone22 server error (HTTP ${response.status}). Supplier outage.`, 502)
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new ShopViaError('ShopViaClone22 returned non-JSON content.', 502)
  }

  let data: Record<string, unknown>
  try {
    data = (await response.json()) as Record<string, unknown>
  } catch {
    throw new ShopViaError('ShopViaClone22 returned malformed JSON.', 502)
  }

  if (data && typeof data === 'object') {
    if (data.status === 'error' || data.error) {
      const msg = String(data.msg || data.error || 'Unknown supplier error')
      if (/invalid api key/i.test(msg)) {
        throw new ShopViaError('Invalid API Key: verify your ShopViaClone22 API key in API Manager.', 401)
      }
      if (/ip|whitelist|access denied|forbidden/i.test(msg)) {
        throw new ShopViaError(`Access restricted: ${msg}`, 403)
      }
      throw new ShopViaError(`ShopViaClone22 API error: ${msg}`, response.status || 400)
    }
  }

  return data as ShopViaProfile
}

/**
 * Fetch catalog products and categories using GET /products.php?api_key=KEY.
 */
export async function fetchShopViaCatalog(
  apiKey: string,
  baseUrl = 'https://shopviaclone22.com/api'
): Promise<unknown> {
  const key = apiKey.trim()
  if (!key || key.length > 256 || /[^\x21-\x7e]/.test(key)) {
    throw new ShopViaError('Invalid ShopViaClone22 API key format.', 400)
  }

  const cleanBase = baseUrl.trim().replace(/\/+$/, '')
  if (!cleanBase.startsWith('https://') && !cleanBase.startsWith('http://localhost')) {
    throw new ShopViaError('ShopViaClone22 base URL must use HTTPS.', 400)
  }

  const endpoint = `${cleanBase}/products.php?api_key=${encodeURIComponent(key)}`
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
      headers: DEFAULT_HEADERS,
    })
  } catch (error) {
    const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new ShopViaError(
      isTimeout
        ? 'ShopViaClone22 connection timed out after 25 seconds.'
        : 'Unable to reach ShopViaClone22 server. Check network or server status.',
      504
    )
  }

  if (response.status === 401) {
    throw new ShopViaError('Invalid API Key: verify your ShopViaClone22 API key in API Manager.', 401)
  }
  if (response.status === 403) {
    throw new ShopViaError('Access restricted: verify IP whitelist settings in ShopViaClone22.', 403)
  }
  if (response.status === 404) {
    throw new ShopViaError('ShopViaClone22 products endpoint not found (HTTP 404). Check API Base URL.', 404)
  }
  if (response.status === 429) {
    throw new ShopViaError('ShopViaClone22 rate limit reached; retry later.', 429)
  }
  if (response.status >= 500) {
    throw new ShopViaError(`ShopViaClone22 server error (HTTP ${response.status}). Supplier outage.`, 502)
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new ShopViaError('ShopViaClone22 returned non-JSON content.', 502)
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new ShopViaError('ShopViaClone22 returned malformed JSON.', 502)
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>
    if (obj.status === 'error' || obj.error) {
      const msg = String(obj.msg || obj.error || 'Unknown supplier error')
      if (/invalid api key/i.test(msg)) {
        throw new ShopViaError('Invalid API Key: verify your ShopViaClone22 API key in API Manager.', 401)
      }
      if (/ip|whitelist|access denied|forbidden/i.test(msg)) {
        throw new ShopViaError(`Access restricted: ${msg}`, 403)
      }
      throw new ShopViaError(`ShopViaClone22 API error: ${msg}`, response.status || 400)
    }
  }

  return data
}

/**
 * Fetch product details using GET /product.php?api_key=KEY&product=PRODUCT_ID.
 */
export async function fetchShopViaProduct(
  apiKey: string,
  externalId: string,
  baseUrl = 'https://shopviaclone22.com/api'
): Promise<unknown> {
  const key = apiKey.trim()
  if (!key) throw new ShopViaError('API key is required.', 400)
  const id = safeId(externalId)
  const cleanBase = baseUrl.trim().replace(/\/+$/, '')

  // Documented parameter is 'product'; also provide 'id' for compatibility
  const endpoint = `${cleanBase}/product.php?api_key=${encodeURIComponent(key)}&product=${encodeURIComponent(id)}&id=${encodeURIComponent(id)}`
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
      headers: DEFAULT_HEADERS,
    })
  } catch (error) {
    const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new ShopViaError(
      isTimeout
        ? 'ShopViaClone22 connection timed out after 10 seconds.'
        : 'Failed to fetch product details from ShopViaClone22.',
      504
    )
  }

  if (response.status === 401) {
    throw new ShopViaError('Invalid API Key: verify your ShopViaClone22 API key in API Manager.', 401)
  }
  if (response.status === 403) {
    throw new ShopViaError('Access restricted: verify IP whitelist settings in ShopViaClone22.', 403)
  }
  if (response.status === 404) {
    throw new ShopViaError(`Product ${id} not found on ShopViaClone22 (HTTP 404).`, 404)
  }
  if (!response.ok) {
    throw new ShopViaError(`ShopViaClone22 returned HTTP ${response.status} for product ${id}.`, response.status)
  }

  try {
    const json = await response.json()
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      const obj = json as Record<string, unknown>
      if (obj.status === 'error' || obj.error) {
        throw new ShopViaError(`ShopViaClone22: ${obj.msg || obj.error}`, 400)
      }
    }
    return json
  } catch (err) {
    if (err instanceof ShopViaError) throw err
    throw new ShopViaError('Malformed product response from ShopViaClone22.', 502)
  }
}

/**
 * Fetch order details using GET /order.php?api_key=KEY&order=ORDER_ID.
 */
export async function fetchShopViaOrder(
  apiKey: string,
  externalOrderId: string,
  baseUrl = 'https://shopviaclone22.com/api'
): Promise<unknown> {
  const key = apiKey.trim()
  if (!key) throw new ShopViaError('API key is required.', 400)
  const id = safeId(externalOrderId)
  const cleanBase = baseUrl.trim().replace(/\/+$/, '')

  // Documented parameter is 'order'; also provide 'order_id' for compatibility
  const endpoint = `${cleanBase}/order.php?api_key=${encodeURIComponent(key)}&order=${encodeURIComponent(id)}&order_id=${encodeURIComponent(id)}`
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
      headers: DEFAULT_HEADERS,
    })
  } catch (error) {
    const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new ShopViaError(
      isTimeout
        ? 'ShopViaClone22 order check timed out.'
        : 'Failed to fetch order status from ShopViaClone22.',
      504
    )
  }

  if (response.status === 401) {
    throw new ShopViaError('Invalid API Key: verify your ShopViaClone22 API key in API Manager.', 401)
  }
  if (response.status === 403) {
    throw new ShopViaError('Access restricted: verify IP whitelist settings in ShopViaClone22.', 403)
  }
  if (!response.ok) {
    throw new ShopViaError(`ShopViaClone22 returned HTTP ${response.status} for order ${id}.`, response.status)
  }

  try {
    return await response.json()
  } catch {
    throw new ShopViaError('Malformed order response from ShopViaClone22.', 502)
  }
}

/**
 * Safe order placement adapter for verified purchases.
 * NEVER invoked during connection testing or catalog sync.
 */
export async function purchaseShopViaProduct(
  apiKey: string,
  params: PurchaseOrderParams,
  baseUrl = 'https://shopviaclone22.com/api'
): Promise<unknown> {
  const key = apiKey.trim()
  if (!key) throw new ShopViaError('API key is required for purchase.', 400)
  const prodId = safeId(params.productId)
  if (!Number.isSafeInteger(params.amount) || params.amount <= 0 || params.amount > 1000) {
    throw new ShopViaError('Invalid purchase amount.', 400)
  }

  const cleanBase = baseUrl.trim().replace(/\/+$/, '')
  const endpoint = `${cleanBase}/buy_product`
  const body = new URLSearchParams({
    action: 'buyProduct',
    api_key: key,
    id: prodId,
    product: prodId,
    amount: String(params.amount),
    ...(params.customOrderId ? { custom_order_id: params.customOrderId, client_order_id: params.customOrderId } : {}),
  })

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-API-Key': key,
        ...DEFAULT_HEADERS,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(30000),
    })
  } catch (error) {
    throw new ShopViaError('Purchase request failed or timed out. Do not re-submit without checking order status.', 504)
  }

  const result = await response.json().catch(() => null)
  if (!response.ok || (result && typeof result === 'object' && ((result as any).status === 'error' || (result as any).success === false))) {
    const msg = (result && typeof result === 'object' && ((result as any).msg || (result as any).message || (result as any).error)) || `HTTP ${response.status}`
    throw new ShopViaError(`ShopViaClone22 purchase rejected: ${msg}`, response.status || 400)
  }

  return result
}
