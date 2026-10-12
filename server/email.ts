import { HttpError } from './auth.ts'
import { isEmailKind, sampleEmail } from '../src/lib/email-templates.ts'
export interface EmailEnv {
  RESEND_API_KEY?: string
  EMAIL_TEST_ENABLED?: string
  EMAIL_FROM?: string
  EMAIL_TEST_TO?: string
}
const mailbox = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/
export function emailTestReady(env: EmailEnv) {
  return env.EMAIL_TEST_ENABLED === 'true' && Boolean(env.RESEND_API_KEY) && /^no-reply@logspoll\.com$/.test(env.EMAIL_FROM ?? '') && mailbox.test(env.EMAIL_TEST_TO ?? '') && (env.EMAIL_TEST_TO?.length ?? 0) <= 254
}
// TEST ONLY: fixed approved recipient, synthetic content. No business-event caller.
// Provider acceptance is not proof of inbox delivery. No provider body is logged/returned.
export async function sendTestEmail(env: EmailEnv, input: { template?: unknown; requestId?: unknown; startedAt?: unknown }, now = Date.now()) {
  if (!emailTestReady(env)) throw new HttpError(503, 'Test delivery disabled. Verify the sending domain and configure the server-only email settings and approved test recipient.')
  if (!isEmailKind(input.template)) throw new HttpError(400, 'Unknown email template.')
  if (typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId) || !Number.isSafeInteger(input.startedAt)) throw new HttpError(400, 'Invalid test request.')
  const startedAt = input.startedAt as number
  // Refuse retry past 23h: Resend retains idempotency keys for 24h.
  if (startedAt > now + 60000 || now - startedAt >= 23 * 60 * 60 * 1000) throw new HttpError(409, 'Test retry window expired. Check provider logs before starting a new test.')
  const email = sampleEmail(input.template, new Date(startedAt).getUTCFullYear())
  const payload = JSON.stringify({ from: `LOGSPOLL <${env.EMAIL_FROM}>`, to: [env.EMAIL_TEST_TO], subject: `[TEST] ${email.subject}`, html: email.html, text: email.text })
  // Same key on every retry. A changed template/recipient produces provider conflict,
  // rather than silently sending a second message after a configuration change.
  const key = `logspoll-test/${input.requestId}`
  let response: Response
  try {
    response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: payload, signal: AbortSignal.timeout(15000), redirect: 'error' })
  } catch { throw new HttpError(503, 'Provider timeout or network failure. Acceptance is unknown; retry this same test request.') }
  if (!response.ok) throw new HttpError(response.status === 429 || response.status >= 500 ? 503 : 502, `Email provider rejected the test (HTTP ${response.status}). Check provider configuration and logs; credentials were not returned.`)
  const result = await response.json().catch(() => null) as { id?: unknown } | null
  if (typeof result?.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(result.id)) throw new HttpError(503, 'Provider acceptance could not be confirmed. Retry the same test request.')
  return { status: 'accepted' as const, id: result.id }
}
