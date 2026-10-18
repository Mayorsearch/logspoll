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
  currency: string
  stock: number
  raw: ShopViaProduct
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

export function normalizeShopViaCatalog(
  payload: unknown,
  currency = 'NGN'
): { categories: { id: string; name: string }[]; products: NormalizedProduct[] } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ShopViaError('Invalid supplier response schema: object expected.')
  }
  const root = payload as Record<string, unknown>
  const rawCategories = Array.isArray(root.categories) ? root.categories : []
  if (rawCategories.length > 500) {
    throw new ShopViaError('Category collection exceeds maximum supported limit (500).')
  }

  const categories: { id: string; name: string }[] = []
  const products: NormalizedProduct[] = []
  const seenProductIds = new Set<string>()

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
      const costMinor = parseDecimalToMinor(prod.price as string | number)
      const rawStock = Number(prod.amount)
      const stock = Number.isSafeInteger(rawStock) && rawStock >= 0 && rawStock <= 1_000_000 ? rawStock : 0

      products.push({
        id: prodId,
        categoryId: catId,
        categoryName: catName,
        name,
        description,
        costMinor,
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

  return { categories, products }
}

export async function fetchShopViaCatalog(
  apiKey: string,
  baseUrl = 'https://shopviaclone22.com/api'
): Promise<unknown> {
  const key = apiKey.trim()
  if (!key || key.length > 256 || /[^\x21-\x7e]/.test(key)) {
    throw new ShopViaError('Invalid ShopViaClone22 API key format.', 400)
  }

  let cleanBase = baseUrl.trim().replace(/\/+$/, '')
  if (!cleanBase.startsWith('https://') && !cleanBase.startsWith('http://localhost')) {
    throw new ShopViaError('ShopViaClone22 base URL must use HTTPS.', 400)
  }

  const endpoint = `${cleanBase}/products.php?api_key=${encodeURIComponent(key)}`
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
      headers: { Accept: 'application/json' },
    })
  } catch (error) {
    const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new ShopViaError(
      isTimeout
        ? 'ShopViaClone22 connection timed out after 12 seconds.'
        : 'Unable to reach ShopViaClone22 server. Check network or server status.',
      504
    )
  }

  if (!response.ok) {
    throw new ShopViaError(
      response.status === 401 || response.status === 403
        ? 'ShopViaClone22 authentication rejected: verify your API key.'
        : response.status === 429
          ? 'ShopViaClone22 rate limit reached; retry later.'
          : `ShopViaClone22 returned HTTP ${response.status}.`,
      response.status >= 400 && response.status < 500 ? response.status : 502
    )
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new ShopViaError('ShopViaClone22 returned non-JSON content.', 502)
  }

  try {
    return await response.json()
  } catch {
    throw new ShopViaError('ShopViaClone22 returned malformed JSON.', 502)
  }
}

export async function fetchShopViaProduct(
  apiKey: string,
  externalId: string,
  baseUrl = 'https://shopviaclone22.com/api'
): Promise<unknown> {
  const key = apiKey.trim()
  if (!key) throw new ShopViaError('API key is required.', 400)
  const id = safeId(externalId)
  const cleanBase = baseUrl.trim().replace(/\/+$/, '')

  const endpoint = `${cleanBase}/product.php?api_key=${encodeURIComponent(key)}&id=${encodeURIComponent(id)}`
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/json' },
    })
  } catch {
    throw new ShopViaError('Failed to fetch product details from ShopViaClone22.', 504)
  }

  if (!response.ok) {
    throw new ShopViaError(`ShopViaClone22 returned HTTP ${response.status} for product ${id}.`, response.status)
  }

  try {
    return await response.json()
  } catch {
    throw new ShopViaError('Malformed product response from ShopViaClone22.', 502)
  }
}

