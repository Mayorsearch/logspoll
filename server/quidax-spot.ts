/**
 * Quidax Spot Orderbook Market Ticker Proxy Module
 * Strictly configured secondary spot proxy (NOT P2P).
 * Provides live USDT/NGN spot market orderbook ticker reference as configured backup.
 */

export const QUIDAX_TICKER_URL = 'https://openapi.quidax.io/exchange-open-api/api/v1/markets/tickers/usdtngn'
export const REASONABLE_MIN_RATE = 500.0
export const REASONABLE_MAX_RATE = 5000.0

export type QuidaxTickerResponse = {
  status: string
  message: string
  data: {
    at: number
    ticker: {
      buy: string | number
      sell: string | number
      low: string | number
      high: string | number
      last: string | number
      vol: string | number
    }
  }
}

export type QuidaxValidationResult = {
  valid: boolean
  rate: number
  buy: number
  sell: number
  high: number
  low: number
  at: number
  source: 'quidax_spot_proxy'
  proxyAsset: 'USDT'
  details?: string
  label: string
}

export class QuidaxSpotError extends Error {
  readonly status: number
  readonly code: string
  constructor(message: string, status = 502, code = 'quidax_error') {
    super(message)
    this.name = 'QuidaxSpotError'
    this.status = status
    this.code = code
  }
}

/**
 * Fetches the live USDT/NGN ticker from Quidax open API.
 * Uses ticker.sell (ask price) as the market rate representing the NGN cost to purchase USDT.
 */
export async function fetchQuidaxUsdtNgnTicker(customUrl?: string): Promise<QuidaxValidationResult> {
  const url = customUrl || QUIDAX_TICKER_URL

  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LogsPoll/2.0',
      },
      signal: AbortSignal.timeout(8000),
    })
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    throw new QuidaxSpotError(
      isTimeout ? 'Quidax Spot connection timed out after 8s.' : 'Unable to reach Quidax Spot ticker service.',
      504,
      'network_failure'
    )
  }

  if (!response.ok) {
    throw new QuidaxSpotError(`Quidax Spot API returned HTTP ${response.status}.`, response.status, 'http_error')
  }

  let json: QuidaxTickerResponse
  try {
    json = (await response.json()) as QuidaxTickerResponse
  } catch {
    throw new QuidaxSpotError('Invalid JSON received from Quidax Spot API.', 502, 'invalid_json')
  }

  const data = (json as any)?.data
  const ticker = data?.usdtngn?.ticker || data?.ticker
  if (!ticker) {
    throw new QuidaxSpotError('Quidax Spot API did not return successful ticker data.', 502, 'invalid_payload')
  }

  const sellPrice = Number(ticker.sell || ticker.last || ticker.buy)
  const buyPrice = Number(ticker.buy || ticker.last || ticker.sell)
  const highPrice = Number(ticker.high || sellPrice)
  const lowPrice = Number(ticker.low || sellPrice)

  if (!Number.isFinite(sellPrice) || sellPrice < REASONABLE_MIN_RATE || sellPrice > REASONABLE_MAX_RATE) {
    throw new QuidaxSpotError(`Quidax Spot rate ₦${sellPrice} is outside reasonable bounds (₦500–₦5,000).`, 502, 'out_of_bounds')
  }

  const roundedRate = Math.round(sellPrice * 100) / 100

  return {
    valid: true,
    rate: roundedRate,
    buy: Math.round(buyPrice * 100) / 100,
    sell: roundedRate,
    high: Math.round(highPrice * 100) / 100,
    low: Math.round(lowPrice * 100) / 100,
    at: data?.at || data?.usdtngn?.at || Date.now(),
    source: 'quidax_spot_proxy',
    proxyAsset: 'USDT',
    label: 'Quidax Spot Orderbook Ticker (Ask: ₦' + roundedRate.toFixed(2) + '/USDT) — Verified Nigerian Market Proxy',
  }
}

export type FxMarketResult = {
  valid: boolean
  rate: number
  source: 'quidax_spot_proxy' | 'open_er_api'
  details: string
  timestamp: number
}

/**
 * Secondary verifiable interbank FX reference using Open Exchange Rates API.
 */
export async function fetchOpenExchangeRateUsd(): Promise<FxMarketResult> {
  const url = 'https://open.er-api.com/v6/latest/USD'
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LogsPoll/2.0',
      },
      signal: AbortSignal.timeout(8000),
    })
  } catch (err) {
    throw new QuidaxSpotError('Open Exchange Rates connection timed out or unreachable.', 504, 'network_failure')
  }

  if (!response.ok) {
    throw new QuidaxSpotError(`Open Exchange Rates API returned HTTP ${response.status}.`, response.status, 'http_error')
  }

  let json: { result?: string; rates?: Record<string, number>; time_last_update_unix?: number }
  try {
    json = (await response.json()) as any
  } catch {
    throw new QuidaxSpotError('Invalid JSON received from Open Exchange Rates API.', 502, 'invalid_json')
  }

  const ngnRate = Number(json?.rates?.NGN)
  if (!Number.isFinite(ngnRate) || ngnRate < REASONABLE_MIN_RATE || ngnRate > REASONABLE_MAX_RATE) {
    throw new QuidaxSpotError(`Open Exchange Rates NGN rate ₦${ngnRate} is outside reasonable bounds (₦500–₦5,000).`, 502, 'out_of_bounds')
  }

  const rounded = Math.round(ngnRate * 100) / 100
  const timestamp = (json.time_last_update_unix ? json.time_last_update_unix * 1000 : Date.now())

  return {
    valid: true,
    rate: rounded,
    source: 'open_er_api',
    details: `Open Exchange Rates Interbank FX (₦${rounded.toFixed(2)}/USD)`,
    timestamp,
  }
}

/**
 * Multi-tier verifiable FX resolver.
 * 1. Quidax Spot Orderbook (USDT/NGN Nigerian exchange ask rate)
 * 2. Open Exchange Rates Interbank (USD/NGN global official rate)
 */
export async function fetchLiveMarketFxRate(): Promise<FxMarketResult> {
  let firstError: string | null = null
  try {
    const q = await fetchQuidaxUsdtNgnTicker()
    if (q.valid) {
      return {
        valid: true,
        rate: q.rate,
        source: 'quidax_spot_proxy',
        details: q.label,
        timestamp: q.at || Date.now(),
      }
    }
  } catch (err) {
    firstError = err instanceof Error ? err.message : String(err)
  }

  try {
    const o = await fetchOpenExchangeRateUsd()
    if (o.valid) {
      return o
    }
  } catch (err) {
    const secondError = err instanceof Error ? err.message : String(err)
    throw new QuidaxSpotError(`Exchange rate synchronization failed: ${firstError || 'Quidax error'}; ${secondError}`, 502, 'all_sources_failed')
  }

  throw new QuidaxSpotError('No valid exchange rate available from verified FX providers.', 502, 'no_valid_rate')
}

