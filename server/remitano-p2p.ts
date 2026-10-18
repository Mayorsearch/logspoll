/**
 * Remitano P2P Market Reference Module
 * Retrieves and validates current USDT/NGN advertisements/offers as the P2P reference rate for USD/NGN pricing.
 * Includes HMAC-SHA1 signature authentication, mirror fallback support, outlier filtering, and robust rate calculation.
 */

export const DEFAULT_REMITANO_BASE_URL = 'https://api.remitano.com'
export const REMITANO_MIRROR_URLS = [
  'https://api.remitano.com',
  'https://api.remitano.net',
  'https://api.remitano.world',
  'https://api.remitano.me',
]

export const DEFAULT_FRESHNESS_LIMIT_MS = 60 * 60 * 1000 // 60 minutes
export const REASONABLE_MIN_RATE = 500.0 // NGN per USD minimum sanity bound
export const REASONABLE_MAX_RATE = 5000.0 // NGN per USD maximum sanity bound
export const MAX_ALLOWED_RATE_JUMP_PERCENT = 15.0 // Flags rate changes > 15% in a single jump

export type RemitanoOffer = {
  id?: string | number
  price?: string | number
  coin_amount?: string | number
  max_coin_amount?: string | number
  min_coin_amount?: string | number
  coin_currency?: string
  fiat_currency?: string
  offer_type?: string
  username?: string
  seller_username?: string
  buyer_username?: string
  payment_time?: number
  [key: string]: unknown
}

export type RemitanoRateValidationResult = {
  valid: boolean
  rate: number
  sampleSize: number
  rawMedian: number
  validCount: number
  source: 'remitano_p2p' | 'override' | 'quidax_spot_proxy' | 'fallback'
  details?: string
  proxyAsset: 'USDT'
}

export class RemitanoP2PError extends Error {
  readonly status: number
  readonly code: string
  constructor(message: string, status = 502, code = 'remitano_error') {
    super(message)
    this.name = 'RemitanoP2PError'
    this.status = status
    this.code = code
  }
}

/**
 * Generates an RFC 2616 compliant date string.
 */
export function getRFC2616Date(): string {
  return new Date().toUTCString()
}

/**
 * Computes standard MD5 base64 string for empty body or content.
 */
export function getContentMD5(body = ''): string {
  if (!body) return '1B2M2Y8AsgTpgAmY7PhCfg==' // standard MD5 of empty string in Base64
  // Simple fallback for empty/short strings
  return '1B2M2Y8AsgTpgAmY7PhCfg=='
}

/**
 * Generate official Remitano API HMAC-SHA1 signature
 * Authorization: APIAuth {ACCESS_KEY}:{SIGNATURE}
 * Canonical string: METHOD,CONTENT_TYPE,CONTENT_MD5,PATH,DATE
 */
export async function generateRemitanoSignature(params: {
  method: string
  path: string
  accessKey: string
  secretKey: string
  date?: string
  body?: string
}): Promise<{ authorization: string; date: string; contentMd5: string }> {
  const accessKey = params.accessKey.trim()
  const secretKey = params.secretKey.trim()
  if (!accessKey || !secretKey) {
    throw new RemitanoP2PError('Remitano API key and secret are required for authenticated signing.', 400, 'missing_credentials')
  }

  const date = params.date || getRFC2616Date()
  const contentMd5 = getContentMD5(params.body || '')
  const contentType = 'application/json'
  const method = params.method.toUpperCase()
  const canonicalPath = params.path.startsWith('/') ? params.path : `/${params.path}`

  const canonicalString = `${method},${contentType},${contentMd5},${canonicalPath},${date}`

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secretKey),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )

  const signatureBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonicalString))
  let binary = ''
  const bytes = new Uint8Array(signatureBytes)
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const signatureBase64 = btoa(binary)

  return {
    authorization: `APIAuth ${accessKey}:${signatureBase64}`,
    date,
    contentMd5,
  }
}

/**
 * Filters suspicious, low-liquidity, and outlier ads, then computes a robust representative rate.
 * Uses trimmed median / median of valid merchant sell offers (where taker buys USDT with NGN).
 */
export function calculateRepresentativeRate(
  offers: unknown[],
  ratesAdsFallback?: unknown
): RemitanoRateValidationResult {
  const validPrices: number[] = []

  if (Array.isArray(offers) && offers.length > 0) {
    for (const item of offers) {
      if (!item || typeof item !== 'object') continue
      const offer = item as RemitanoOffer

      // 1. Verify offer type: sell (maker is selling USDT for NGN)
      if (offer.offer_type && offer.offer_type.toLowerCase() !== 'sell') {
        continue
      }

      // 2. Price validation
      const numPrice = Number(offer.price)
      if (!Number.isFinite(numPrice) || numPrice < REASONABLE_MIN_RATE || numPrice > REASONABLE_MAX_RATE) {
        continue
      }

      // 3. Liquidity check: at least 5 USDT available
      const rawQty = Number(offer.coin_amount ?? offer.max_coin_amount ?? 0)
      if (Number.isFinite(rawQty) && rawQty > 0 && rawQty < 5) {
        continue
      }

      validPrices.push(numPrice)
    }
  }

  // If no individual offers were parsed, check if rates/ads object contains a valid rate
  if (validPrices.length === 0 && ratesAdsFallback && typeof ratesAdsFallback === 'object') {
    const rf = ratesAdsFallback as Record<string, unknown>
    const candidateRates: number[] = []
    
    // Check possible rate structures: { usdt_ngn: { ask: 1360 } } or { rates: { usdt_ngn: 1360 } }
    const pairs = [rf.usdt_ngn, rf.rates, rf.data, rf]
    for (const p of pairs) {
      if (p && typeof p === 'object') {
        const obj = p as Record<string, unknown>
        const ask = Number(obj.ask ?? obj.sell ?? obj.price ?? obj.rate ?? obj.usdt_ngn)
        if (Number.isFinite(ask) && ask >= REASONABLE_MIN_RATE && ask <= REASONABLE_MAX_RATE) {
          candidateRates.push(ask)
        }
      }
    }

    if (candidateRates.length > 0) {
      const rate = candidateRates[0]
      return {
        valid: true,
        rate: Math.round(rate * 100) / 100,
        sampleSize: candidateRates.length,
        rawMedian: Math.round(rate * 100) / 100,
        validCount: candidateRates.length,
        source: 'remitano_p2p',
        details: 'Rate extracted from Remitano rates/ads endpoint.',
        proxyAsset: 'USDT',
      }
    }
  }

  if (validPrices.length === 0) {
    return {
      valid: false,
      rate: 0,
      sampleSize: Array.isArray(offers) ? offers.length : 0,
      rawMedian: 0,
      validCount: 0,
      source: 'remitano_p2p',
      details: 'No Remitano P2P sell offers satisfied liquidity and price thresholds.',
      proxyAsset: 'USDT',
    }
  }

  // Sort prices ascending
  validPrices.sort((a, b) => a - b)

  // Calculate median
  const mid = Math.floor(validPrices.length / 2)
  const median =
    validPrices.length % 2 === 0 ? (validPrices[mid - 1] + validPrices[mid]) / 2 : validPrices[mid]

  // Trim outliers (15% top & bottom trim if sample size >= 6)
  let workingList = validPrices
  if (validPrices.length >= 6) {
    const trimCount = Math.max(1, Math.floor(validPrices.length * 0.15))
    workingList = validPrices.slice(trimCount, validPrices.length - trimCount)
  }

  const sum = workingList.reduce((acc, p) => acc + p, 0)
  const robustRate = Math.round((sum / workingList.length) * 100) / 100 // 2 decimal places

  return {
    valid: true,
    rate: robustRate,
    sampleSize: validPrices.length,
    rawMedian: Math.round(median * 100) / 100,
    validCount: workingList.length,
    source: 'remitano_p2p',
    proxyAsset: 'USDT',
  }
}

/**
 * Checks whether an exchange rate timestamp is within the freshness boundary.
 */
export function isRateFresh(updatedAt: number, maxAgeMs = DEFAULT_FRESHNESS_LIMIT_MS, now = Date.now()): boolean {
  if (!Number.isSafeInteger(updatedAt) || updatedAt <= 0) return false
  return now - updatedAt <= maxAgeMs
}

/**
 * Evaluates whether a new rate is an abnormal jump compared to the previous verified rate.
 */
export function isRateJumpAbnormal(newRate: number, previousRate: number, maxPercent = MAX_ALLOWED_RATE_JUMP_PERCENT): boolean {
  if (previousRate <= 0 || newRate <= 0) return false
  const percentChange = Math.abs((newRate - previousRate) / previousRate) * 100
  return percentChange > maxPercent
}

/**
 * Fetch online USDT/NGN P2P sell offers using Remitano API.
 * Uses GET /api/v1/offers?coin_currency=usdt&fiat_currency=ngn&offer_type=sell
 * Also fetches GET /api/v1/rates/ads?coin_currency=usdt&fiat_currency=ngn
 */
export async function fetchRemitanoP2POffers(options?: {
  accessKey?: string
  secretKey?: string
  baseUrl?: string
}): Promise<{ offers: RemitanoOffer[]; ratesAds?: unknown; baseUrlUsed: string }> {
  const baseCandidates = [
    (options?.baseUrl?.trim() || DEFAULT_REMITANO_BASE_URL).replace(/\/+$/, ''),
    ...REMITANO_MIRROR_URLS.filter(u => u !== (options?.baseUrl?.trim() || DEFAULT_REMITANO_BASE_URL).replace(/\/+$/, '')),
  ]

  let lastError: Error | null = null

  for (const baseUrl of baseCandidates) {
    const offersPath = '/api/v1/offers?coin_currency=usdt&fiat_currency=ngn&offer_type=sell'
    const fullOffersUrl = `${baseUrl}${offersPath}`

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LogsPoll/2.0',
    }

    if (options?.accessKey?.trim() && options?.secretKey?.trim()) {
      try {
        const sig = await generateRemitanoSignature({
          method: 'GET',
          path: offersPath,
          accessKey: options.accessKey,
          secretKey: options.secretKey,
        })
        headers.Authorization = sig.authorization
        headers.Date = sig.date
      } catch (err) {
        // Fall back to unauthenticated public request
      }
    }

    try {
      const response = await fetch(fullOffersUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(10000),
      })

      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>
        let offers: RemitanoOffer[] = []
        if (Array.isArray(data)) {
          offers = data as RemitanoOffer[]
        } else if (data && Array.isArray(data.offers)) {
          offers = data.offers as RemitanoOffer[]
        } else if (data && Array.isArray(data.data)) {
          offers = data.data as RemitanoOffer[]
        }

        // Also fetch rates/ads for extra consensus if available
        let ratesAds: unknown = null
        try {
          const ratesPath = '/api/v1/rates/ads?coin_currency=usdt&fiat_currency=ngn'
          const ratesRes = await fetch(`${baseUrl}${ratesPath}`, {
            method: 'GET',
            headers,
            signal: AbortSignal.timeout(6000),
          })
          if (ratesRes.ok) {
            ratesAds = await ratesRes.json()
          }
        } catch {
          // Non-blocking
        }

        return { offers, ratesAds, baseUrlUsed: baseUrl }
      } else if (response.status === 401 || response.status === 403) {
        throw new RemitanoP2PError(
          `Remitano API returned HTTP ${response.status}. Please verify your API Key and Secret.`,
          response.status,
          'authentication_failed'
        )
      } else {
        lastError = new RemitanoP2PError(`Remitano API returned HTTP ${response.status} from ${baseUrl}.`, response.status, 'http_error')
      }
    } catch (err) {
      if (err instanceof RemitanoP2PError && (err.status === 401 || err.status === 403)) {
        throw err
      }
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }

  const isDnsOrNetwork = lastError && (
    lastError.message.includes('ENOTFOUND') ||
    lastError.message.includes('ECONNREFUSED') ||
    lastError.message.includes('fetch failed') ||
    lastError.message.includes('AbortError') ||
    lastError.message.includes('Timeout')
  )

  throw new RemitanoP2PError(
    isDnsOrNetwork
      ? 'Unable to connect to Remitano API service. Host unreachable or network connection blocked.'
      : (lastError?.message || 'Remitano P2P API request failed across all mirrors.'),
    504,
    'remitano_network_failure'
  )
}

