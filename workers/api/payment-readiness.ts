import type { ApiEnv } from './types.ts'

export type PaymentAttemptRow = {
  id: string
  order_id: string
  reference: string
  customer_id: string
  customer_email: string
  client_request_id: string
  checkout_id: string | null
  idempotency_key: string
  provider_mode: string
  amount_minor: number
  currency: string
  attempt_status: string
  payment_status: string
  fulfillment_status: string
  created_at: number
  updated_at: number
}

export type WebhookEventRow = {
  event_id: string
  event_type: string
  checkout_id: string | null
  attempt_id: string | null
  processing_status: string
  received_at: number
  processed_at: number | null
}

export type PaymentMetrics = {
  total_volume_minor: number
  total_paid: number
  total_attempts: number
  total_open: number
  total_failed: number
  total_refunded: number
  webhook_count: number
  webhook_processed: number
}

/** Read-only diagnostics. Credential presence and a readable webhook list do
 * not prove checkout, signing-secret ownership, fulfillment or merchant approval. */
export async function paymentReadiness(env: ApiEnv, origin: string, verify = false) {
  const key = (env.BACHS_API_KEY ?? '').trim()
  const mode = key.startsWith('sk_live_') ? 'live' : key.startsWith('sk_sandbox_') ? 'sandbox' : 'missing_or_invalid'
  const tables = await env
    .DB!.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('bachs_payment_attempts','bachs_webhook_events','bachs_reservations')"
    )
    .all<{ name: string }>()

  const result: {
    mode: string
    apiKeyConfigured: boolean
    webhookSecretConfigured: boolean
    ledgerTables: string[]
    webhookHandlerEnabled: boolean
    history: PaymentAttemptRow[]
    webhooks: WebhookEventRow[]
    metrics: PaymentMetrics
    paymentReadPermission: string
    checkoutEnabled: false
    automaticFulfillment: false
    providerCheck: string
    providerHttpStatus: number | null
    providerEndpoint?: string
    providerFailureStage?: string
    providerErrorCode?: string
    webhookDestinationConfigured: boolean | null
    blockers: string[]
  } = {
    mode,
    apiKeyConfigured: Boolean(key),
    webhookSecretConfigured: Boolean(env.BACHS_WEBHOOK_SECRET),
    ledgerTables: tables.results.map((t) => t.name),
    webhookHandlerEnabled: tables.results.length === 3 && mode !== 'missing_or_invalid' && Boolean(env.BACHS_WEBHOOK_SECRET),
    history: [],
    webhooks: [],
    metrics: {
      total_volume_minor: 0,
      total_paid: 0,
      total_attempts: 0,
      total_open: 0,
      total_failed: 0,
      total_refunded: 0,
      webhook_count: 0,
      webhook_processed: 0,
    },
    paymentReadPermission: 'Not tested',
    checkoutEnabled: false,
    automaticFulfillment: false,
    providerCheck: 'Not tested',
    providerHttpStatus: null,
    webhookDestinationConfigured: null,
    blockers: [
      ...(tables.results.length === 3 ? [] : ['D1 Bachs ledger migration 0010_bachs_payment_foundation.sql is missing or incomplete.']),
      'Live checkout remains disabled until explicit production merchant approval is granted.',
      'Provider-supported sandbox lifecycle testing must pass before live activation.',
      'Bachs merchant terms for digital and telecommunications products require verification.',
    ],
  }

  if (tables.results.length === 3) {
    const historyQuery = `
      SELECT a.id, a.order_id, o.reference, a.customer_id,
        COALESCE(u.email, p.full_name, 'Customer') AS customer_email,
        a.client_request_id, a.checkout_id, a.idempotency_key, a.provider_mode,
        a.amount_minor, a.currency, a.status AS attempt_status,
        o.payment_status, o.fulfillment_status, a.created_at, a.updated_at
      FROM bachs_payment_attempts a
      JOIN orders o ON o.id=a.order_id
      LEFT JOIN auth_user u ON u.id=a.customer_id
      LEFT JOIN profiles p ON p.id=a.customer_id
      ORDER BY a.created_at DESC LIMIT 100
    `
    const webhookQuery = `
      SELECT event_id, event_type, checkout_id, attempt_id, processing_status, received_at, processed_at
      FROM bachs_webhook_events
      ORDER BY received_at DESC LIMIT 50
    `
    const [historyRows, webhookRows] = await Promise.all([
      env.DB!.prepare(historyQuery).all<PaymentAttemptRow>().catch(() => ({ results: [] })),
      env.DB!.prepare(webhookQuery).all<WebhookEventRow>().catch(() => ({ results: [] })),
    ])

    result.history = historyRows.results
    result.webhooks = webhookRows.results

    // Compute metrics
    let volume = 0,
      paidCount = 0,
      openCount = 0,
      failedCount = 0,
      refundedCount = 0
    for (const h of result.history) {
      if (h.attempt_status === 'paid' || h.payment_status === 'paid') {
        volume += h.amount_minor
        paidCount++
      } else if (['initiating', 'open'].includes(h.attempt_status)) {
        openCount++
      } else if (['failed', 'expired'].includes(h.attempt_status)) {
        failedCount++
      } else if (h.attempt_status === 'needs_review' || h.payment_status === 'refunded') {
        refundedCount++
      }
    }

    result.metrics = {
      total_volume_minor: volume,
      total_paid: paidCount,
      total_attempts: result.history.length,
      total_open: openCount,
      total_failed: failedCount,
      total_refunded: refundedCount,
      webhook_count: result.webhooks.length,
      webhook_processed: result.webhooks.filter((w) => w.processing_status === 'processed').length,
    }
  }

  if (!key || mode === 'missing_or_invalid') result.blockers.push('A correctly scoped Bachs API key is missing or invalid.')
  if (!env.BACHS_WEBHOOK_SECRET) result.blockers.push('Bachs webhook signing secret is missing.')
  if (!verify || mode === 'missing_or_invalid' || key.length > 256) return result
  if (/[^\x21-\x7e]/.test(key)) {
    result.providerCheck = 'API key contains invalid whitespace or control characters'
    return result
  }

  const base = mode === 'live' ? 'https://api.bachs.io' : 'https://sandbox-api.bachs.io'
  result.providerEndpoint = base + '/v1/webhooks/endpoints?limit=100'
  let stage = 'request'
  try {
    const response = await fetch(result.providerEndpoint, {
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
      headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
    })
    result.providerHttpStatus = response.status
    if (response.status >= 300 && response.status < 400) {
      result.providerCheck = 'Provider redirect rejected; credentials were not forwarded'
      return result
    }
    if (!response.ok) {
      result.providerCheck =
        response.status === 401
          ? 'API authentication rejected'
          : response.status === 403
            ? 'webhooks:read permission denied'
            : response.status === 429
              ? 'Provider rate limit'
              : 'Provider request failed'
      return result
    }
    if (!response.headers.get('Content-Type')?.includes('application/json')) {
      result.providerCheck = 'Invalid provider response'
      return result
    }
    stage = 'response body'
    const reader = response.body?.getReader()
    let text = '',
      size = 0
    if (!reader) {
      result.providerCheck = 'Invalid provider response'
      return result
    }
    const decoder = new TextDecoder()
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.length
      if (size > 200000) {
        await reader.cancel()
        result.providerCheck = 'Provider response too large'
        return result
      }
      text += decoder.decode(part.value, { stream: true })
    }
    stage = 'response JSON'
    const data = JSON.parse(text)
    if (!Array.isArray(data?.items) || data.items.length > 100) {
      result.providerCheck = 'Invalid provider response'
      return result
    }
    const found = data.items.some((x: Record<string, unknown>) => {
      const events = x?.event_types
      return (
        x?.url === origin + '/api/webhooks/bachs' &&
        x.enabled === true &&
        Array.isArray(events) &&
        ['checkout.completed', 'collection.succeeded', 'collection.failed', 'checkout.expired'].every((type) =>
          events.includes(type)
        )
      )
    })
    result.webhookDestinationConfigured = found ? true : data.pagination?.has_more ? null : false
    result.providerCheck = 'Authenticated webhook read succeeded; payment permissions and signature delivery remain unverified'
    try {
      const permission = await fetch(base + '/v1/payments?limit=1', {
        redirect: 'manual',
        signal: AbortSignal.timeout(12000),
        headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
      })
      result.paymentReadPermission =
        permission.status === 200 && permission.headers.get('Content-Type')?.includes('application/json')
          ? 'payments:read confirmed (HTTP 200); write permission unverified'
          : `payments:read unverified (HTTP ${permission.status})`
      await permission.body?.cancel()
    } catch {
      result.paymentReadPermission = 'payments:read verification failed; webhook authentication passed'
    }
  } catch (error) {
    const kind = error instanceof Error ? error.name : ''
    const detail = error as { code?: unknown; cause?: { code?: unknown } }
    const code = detail?.cause?.code ?? detail?.code
    const allowed = [
      'ENOTFOUND',
      'EAI_AGAIN',
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'CERT_HAS_EXPIRED',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    ]
    result.providerFailureStage = stage
    result.providerErrorCode = typeof code === 'string' && allowed.includes(code) ? code : 'unavailable'
    const safeKind = ['TypeError', 'Error', 'TimeoutError', 'AbortError', 'SyntaxError'].includes(kind) ? kind : 'UnknownError'
    result.providerCheck = ['TimeoutError', 'AbortError'].includes(kind)
      ? 'Provider request timed out after 12 seconds'
      : kind === 'SyntaxError'
        ? 'Provider returned invalid JSON'
        : `Provider ${stage} failed (${safeKind}; ${result.providerErrorCode})`
  }
  return result
}
