/** Bachs sandbox-only primitives. Used only by a sandbox-gated test checkout; not enabled for real orders,
 * inventory reservation, supplier purchases, or live fulfillment.
 * No secret should ever be returned to the frontend or written to logs.
 */
export const BACHS_SANDBOX_API = 'https://sandbox-api.bachs.io'
export const BACHS_MINIMUM_NGN_MINOR = 10_000
export const BACHS_MINIMUM_MESSAGE = 'Bachs requires an order total of at least ₦100.00. Add products or increase quantity before checkout.'

export class BachsCheckoutError extends Error {
  readonly providerStatus: number | null
  readonly providerCode: string | null
  constructor(message: string, providerStatus: number | null = null, providerCode: string | null = null) {
    super(message)
    this.name = 'BachsCheckoutError'
    this.providerStatus = providerStatus
    this.providerCode = providerCode
  }
}

function isDecimalMinor(value: number) {
  return Number.isSafeInteger(value) && value > 0 && value <= 99_999_999_900
}

export function formatNGN(minor: number): string {
  if (!isDecimalMinor(minor)) throw new Error('Invalid checkout amount.')
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`
}

export type CheckoutSessionInput = {
  key: string
  amountMinor: number // trusted server/database value, NEVER a cart total supplied by browser
  buyerEmail: string
  successUrl?: string
  cancelUrl?: string
  orderId?: string
  idempotencyKey: string // unique durable order-attempt identifier
}

export async function createSandboxSession(input: CheckoutSessionInput): Promise<{ checkoutId: string; checkoutUrl: string }> {
  if (!input.key.startsWith('sk_sandbox_') || input.key.length > 256) throw new Error('Bachs sandbox key is not configured.')
  return createBachsSession(input, 'sandbox')
}

export async function createBachsSession(input: CheckoutSessionInput, mode: 'sandbox' | 'live'): Promise<{checkoutId:string;checkoutUrl:string}> {
  if (input.amountMinor < BACHS_MINIMUM_NGN_MINOR) throw new BachsCheckoutError(BACHS_MINIMUM_MESSAGE)
  const key=input.key.trim()
  if (!key.startsWith(mode==='live'?'sk_live_':'sk_sandbox_') || key.length>256 || /[^\x21-\x7e]/.test(key)) throw new Error('Bachs credential environment mismatch.')
  const base=mode==='live'?'https://api.bachs.io':BACHS_SANDBOX_API
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.buyerEmail) || input.buyerEmail.length > 320) throw new Error('Invalid buyer email.')
  if (!/^[a-zA-Z0-9_-]{12,100}$/.test(input.idempotencyKey)) throw new Error('Invalid checkout idempotency key.')
  if (!!input.successUrl !== !!input.cancelUrl) throw new Error('Both return URLs must be supplied together.')
  const body: Record<string, unknown> = {
    pricing: { currency: 'NGN', amount: formatNGN(input.amountMinor) },
    customer: { email: input.buyerEmail }
  }
  if (input.successUrl && input.cancelUrl) {
    const success = new URL(input.successUrl)
    const cancel = new URL(input.cancelUrl)
    if (success.protocol !== 'https:' || cancel.protocol !== 'https:' || success.origin !== cancel.origin || success.username || success.password || cancel.username || cancel.password) throw new Error('Trusted HTTPS return URLs required.')
    body.success_url = success.toString()
    body.cancel_url = cancel.toString()
  }
  // Localhost is rejected even in sandbox: omit return URLs while developing locally.
  if (input.orderId !== undefined) {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(input.orderId)) throw new Error('Invalid order reference.')
    body.reference = input.orderId
    body.metadata = { order_id: input.orderId }
  }
  let response: Response
  try {
    response = await fetch(`${base}/v1/checkout-sessions`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(12000),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${key}`, 'Idempotency-Key': input.idempotencyKey },
      body: JSON.stringify(body)
    })
  } catch (error) {
    const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
    throw new BachsCheckoutError(timeout ? 'Bachs checkout timed out. Retry with the same request ID.' : 'Bachs checkout connection failed. Retry with the same request ID.')
  }
  if (response.status < 200 || response.status >= 300) {
    // Never forward provider bodies: they may echo customer information or credentials.
    const codes = ['VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'TOO_MANY_REQUESTS', 'INTERNAL_SERVER_ERROR', 'BAD_GATEWAY', 'SERVICE_UNAVAILABLE']
    let code: string | null = null
    const reader = response.body?.getReader()
    try {
      let text = '', size = 0
      const decoder = new TextDecoder()
      if (reader) while (true) {
        const next = await reader.read()
        if (next.done) break
        size += next.value.byteLength
        if (size > 8192) throw new Error('Diagnostic body too large')
        text += decoder.decode(next.value, {stream: true})
      }
      const value = JSON.parse(text + decoder.decode())
      if (codes.includes(value?.error_code)) code = value.error_code
    } catch { /* HTTP status remains authoritative for diagnostics. */ }
    finally { await reader?.cancel().catch(() => undefined) }
    throw new BachsCheckoutError(`Bachs checkout rejected (HTTP ${response.status}${code ? `, ${code}` : ''}). Retry with the same request ID.`, response.status, code)
  }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Unexpected Bachs checkout response.')
  let parsed: unknown
  try { parsed = await response.json() } catch { throw new Error('Unexpected Bachs checkout response.') }
  if (typeof parsed !== 'object' || !parsed || Array.isArray(parsed)) throw new Error('Unexpected Bachs checkout response.')
  const value = parsed as Record<string, unknown>
  if (typeof value.checkout_id !== 'string' || !/^chk_[a-zA-Z0-9_-]{6,100}$/.test(value.checkout_id) || typeof value.checkout_url !== 'string') throw new Error('Unexpected Bachs checkout response.')
  let destination: URL
  try { destination = new URL(value.checkout_url) } catch { throw new Error('Unexpected Bachs checkout URL.') }
  // Accept only documented Bachs-hosted checkout hosts. Never redirect a shopper
  // to a URL supplied by an arbitrary upstream response.
  if (destination.protocol !== 'https:' || !['sandbox-checkout.bachs.io', 'checkout.bachs.io'].includes(destination.hostname) || destination.port || destination.username || destination.password) throw new Error('Unexpected Bachs checkout URL.')
  return { checkoutId: value.checkout_id, checkoutUrl: destination.toString() }
}

function validTimestamp(text: string | null, nowSeconds: number) {
  if (!text || !/^\d{10}$/.test(text)) return null
  const value = Number(text)
  return Math.abs(nowSeconds - value) <= 300 ? value : null
}
function fromHex(hex: string): Uint8Array | null {
  if (!/^[a-fA-F0-9]{64}$/.test(hex)) return null
  return Uint8Array.from(hex.match(/../g)!, part => parseInt(part, 16))
}

/** Verify the raw request body, never a JSON-parsed/reserialized equivalent.
 * Signature-V2 supports multiple v1 values during signing-secret rotation.
 */
export async function verifyBachsWebhook(rawBody: string, headers: Headers, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!secret || secret.length > 1024 || rawBody.length > 200_000) return false
  const v2 = headers.get('X-Bachs-Signature-V2')
  let stamp: number | null
  let signatures: string[]
  if (v2) {
    const parts = v2.split(',').map(x => x.trim())
    const stamps = parts.filter(part => part.startsWith('t='))
    if (stamps.length !== 1) return false
    stamp = validTimestamp(stamps[0].slice(2), nowSeconds)
    signatures = parts.filter(part => part.startsWith('v1=')).map(part => part.slice(3))
  } else {
    stamp = validTimestamp(headers.get('X-Bachs-Timestamp'), nowSeconds)
    const v1 = headers.get('X-Bachs-Signature')
    signatures = v1 ? [v1] : []
  }
  if (stamp === null || signatures.length < 1 || signatures.length > 8) return false
  try {
    const imported = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    const signedBytes = new TextEncoder().encode(`${stamp}.${rawBody}`)
    for (const candidate of signatures) {
      const bytes = fromHex(candidate)
      if (bytes && await crypto.subtle.verify('HMAC', imported, new Uint8Array(bytes), signedBytes)) return true
    }
  } catch { return false }
  return false
}

/** Get the authoritative checkout state after a signed webhook. Do not rely on
 * webhook data, or a browser redirect, as proof of paid status. */
export async function getSandboxSession(key: string, checkoutId: string): Promise<Record<string, unknown>> {
  if (!key.startsWith('sk_sandbox_') || key.length > 256) throw new Error('Bachs sandbox key is not configured.')
  return getBachsSession(key, checkoutId)
}

/** Read-only verification; never initiates a payment. */
export async function getBachsSession(configuredKey: string, checkoutId: string): Promise<Record<string, unknown>> {
  const key = configuredKey.trim()
  if (!/^sk_(live|sandbox)_[\x21-\x7e]+$/.test(key) || key.length > 256) throw new Error('Bachs API key is not configured.')
  const base = key.startsWith('sk_live_') ? 'https://api.bachs.io' : BACHS_SANDBOX_API
  if (!/^chk_[A-Za-z0-9_-]{6,100}$/.test(checkoutId)) throw new Error('Invalid checkout reference.')
  let response: Response
  try {
    response = await fetch(`${base}/v1/checkout-sessions/${checkoutId}`, {
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(12000),
      headers: { Accept: 'application/json', Authorization: `Bearer ${key}` }
    })
  } catch { throw new Error('Unable to verify Bachs checkout.') }
  console.info('Bachs checkout verification', {checkoutId, httpStatus:response.status, json:response.headers.get('content-type')?.includes('application/json')===true})
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Unable to verify Bachs checkout.')
  const data: unknown = await response.json().catch(() => null)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Bachs verification response.')
  return data as Record<string, unknown>
}
