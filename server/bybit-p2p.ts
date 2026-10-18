/**
 * Bybit P2P Market Reference Module
 * Retrieves and validates current USDT/NGN advertisements as the P2P reference rate for USD/NGN pricing.
 */

export const BYBIT_P2P_MAINNET_URL = 'https://api.bybit.com'
export const DEFAULT_RECV_WINDOW = '5000'
export const DEFAULT_FRESHNESS_LIMIT_MS = 60 * 60 * 1000 // 60 minutes
export const REASONABLE_MIN_RATE = 500.0 // NGN per USD minimum sanity bound
export const REASONABLE_MAX_RATE = 5000.0 // NGN per USD maximum sanity bound
export const MAX_ALLOWED_RATE_JUMP_PERCENT = 15.0 // Flags rate changes > 15% in a single jump

export type BybitAd = {
  id?: string
  userId?: string
  userName?: string
  price?: string | number
  lastQuantity?: string | number
  quantity?: string | number
  minAmount?: string | number
  maxAmount?: string | number
  orderNum?: number | string
  finishRate?: string | number
  isOnline?: boolean | number
  [key: string]: unknown
}

export type RateValidationResult = {
  valid: boolean
  rate: number
  sampleSize: number
  rawMedian: number
  validCount: number
  source: 'bybit_p2p' | 'manual_override'
  details?: string
}

export class BybitP2PError extends Error {
  readonly status: number
  readonly code: string
  constructor(message: string, status = 502, code = 'bybit_error') {
    super(message)
    this.name = 'BybitP2PError'
    this.status = status
    this.code = code
  }
}

/**
 * Generate official Bybit V5 HMAC-SHA256 signature
 */
export async function generateBybitV5Signature(
  timestamp: string,
  apiKey: string,
  recvWindow: string,
  body: string,
  apiSecret: string
): Promise<string> {
  const keySecret = apiSecret.trim()
  if (!keySecret) throw new BybitP2PError('Bybit API secret is required for signing.', 400, 'missing_secret')
  const message = `${timestamp}${apiKey.trim()}${recvWindow}${body}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(keySecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signatureBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(signatureBytes), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Filters suspicious, low-liquidity, and outlier ads, then computes a robust representative rate.
 * Uses trimmed median / median of valid merchant sell ads (where taker buys USDT with NGN).
 */
export function calculateRepresentativeRate(ads: unknown[]): RateValidationResult {
  if (!Array.isArray(ads) || ads.length === 0) {
    return {
      valid: false,
      rate: 0,
      sampleSize: 0,
      rawMedian: 0,
      validCount: 0,
      source: 'bybit_p2p',
      details: 'No P2P advertisements returned by provider.',
    }
  }

  const validPrices: number[] = []

  for (const item of ads) {
    if (!item || typeof item !== 'object') continue
    const ad = item as BybitAd

    // 1. Price validation
    const numPrice = Number(ad.price)
    if (!Number.isFinite(numPrice) || numPrice < REASONABLE_MIN_RATE || numPrice > REASONABLE_MAX_RATE) {
      continue
    }

    // 2. Liquidity check: must have at least 10 USDT available
    const rawQty = Number(ad.lastQuantity ?? ad.quantity ?? 0)
    if (Number.isFinite(rawQty) && rawQty > 0 && rawQty < 10) {
      continue
    }

    // 3. Completion rate check: ignore accounts with very poor completion (< 70%) if recorded
    if (ad.finishRate !== undefined && ad.finishRate !== null) {
      const rawRate = String(ad.finishRate).replace('%', '').trim()
      const finishPercent = Number(rawRate)
      if (Number.isFinite(finishPercent) && finishPercent > 0 && finishPercent < 70) {
        continue
      }
    }

    validPrices.push(numPrice)
  }

  if (validPrices.length === 0) {
    return {
      valid: false,
      rate: 0,
      sampleSize: ads.length,
      rawMedian: 0,
      validCount: 0,
      source: 'bybit_p2p',
      details: 'No advertisements satisfied liquidity, rate, and completion thresholds.',
    }
  }

  // Sort prices ascending
  validPrices.sort((a, b) => a - b)

  // Calculate median
  const mid = Math.floor(validPrices.length / 2)
  const median =
    validPrices.length % 2 === 0 ? (validPrices[mid - 1] + validPrices[mid]) / 2 : validPrices[mid]

  // Trim outliers (interquartile range or 10% trim if sample size >= 6)
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
    sampleSize: ads.length,
    rawMedian: Math.round(median * 100) / 100,
    validCount: workingList.length,
    source: 'bybit_p2p',
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
 * Fetch online USDT/NGN P2P ads using official Bybit V5 endpoint:
 * POST /v5/p2p/item/online
 *
 * Side 1 represents taker buying USDT with NGN (maker sell ads), which represents
 * the market cost in NGN to purchase 1 USD equivalent (USDT).
 */
export async function fetchBybitP2PAds(options?: {
  apiKey?: string
  apiSecret?: string
  baseUrl?: string
}): Promise<{ ads: BybitAd[]; total: number }> {
  const baseUrl = (options?.baseUrl?.trim() || BYBIT_P2P_MAINNET_URL).replace(/\/+$/, '')
  const endpoint = `${baseUrl}/v5/p2p/item/online`

  const payload = {
    tokenId: 'USDT',
    currencyId: 'NGN',
    side: '1', // Payer spends NGN to purchase USDT
    page: '1',
    size: '30',
  }

  const bodyStr = JSON.stringify(payload)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LogsPoll/2.0',
  }

  // If credentials are provided, generate standard Bybit V5 authentication headers
  if (options?.apiKey?.trim() && options?.apiSecret?.trim()) {
    const timestamp = String(Date.now())
    const signature = await generateBybitV5Signature(
      timestamp,
      options.apiKey.trim(),
      DEFAULT_RECV_WINDOW,
      bodyStr,
      options.apiSecret.trim()
    )
    headers['X-BAPI-API-KEY'] = options.apiKey.trim()
    headers['X-BAPI-TIMESTAMP'] = timestamp
    headers['X-BAPI-RECV-WINDOW'] = DEFAULT_RECV_WINDOW
    headers['X-BAPI-SIGN'] = signature
  }

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: bodyStr,
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    })
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    throw new BybitP2PError(
      isTimeout ? 'Bybit P2P connection timed out after 12s.' : 'Unable to connect to Bybit P2P API service.',
      504,
      'network_failure'
    )
  }

  if (response.status === 401 || response.status === 403) {
    throw new BybitP2PError(
      'Bybit P2P API access requires an active Bybit merchant/advertiser account and valid V5 API credentials.',
      403,
      'merchant_access_required'
    )
  }

  if (!response.ok) {
    throw new BybitP2PError(`Bybit P2P returned HTTP ${response.status}.`, response.status, 'http_error')
  }

  let jsonResult: unknown
  try {
    jsonResult = await response.json()
  } catch {
    throw new BybitP2PError('Malformed response from Bybit P2P endpoint.', 502, 'malformed_json')
  }

  if (!jsonResult || typeof jsonResult !== 'object') {
    throw new BybitP2PError('Invalid JSON structure from Bybit P2P.', 502, 'invalid_schema')
  }

  const data = jsonResult as Record<string, unknown>
  if (data.retCode !== 0 && data.retCode !== '0' && data.retCode !== undefined) {
    const msg = String(data.retMsg || 'Unknown Bybit error')
    if (/merchant|advertiser|permission|auth/i.test(msg)) {
      throw new BybitP2PError(
        `Bybit P2P permission required: ${msg}. Account must have Verified Advertiser status.`,
        403,
        'advertiser_permission_required'
      )
    }
    throw new BybitP2PError(`Bybit P2P API rejected request: ${msg}`, 400, 'bybit_rejection')
  }

  const resultObj = (data.result ?? data.data ?? data) as Record<string, unknown>
  const items = Array.isArray(resultObj.items)
    ? resultObj.items
    : Array.isArray(resultObj.list)
      ? resultObj.list
      : Array.isArray(data.items)
        ? data.items
        : []

  const total = Number(resultObj.total ?? items.length)

  return { ads: items as BybitAd[], total: Number.isSafeInteger(total) ? total : items.length }
}

