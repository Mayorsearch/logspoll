/** Signed, server-confirmed Bachs sandbox webhook. Stores only payment metadata.
 * It NEVER purchases or delivers credentials. */
import { getSandboxSession, verifyBachsWebhook } from '../../../server/bachs.ts'
import { checkedPaidSandboxSession, parseBachsEvent } from '../../../server/bachs-flow.ts'
import { sandboxEnabled, serviceDatabase } from '../../../server/bachs-auth.ts'
import type { BachsEnv } from '../../../server/bachs-auth.ts'
export async function onRequestPost({request,env}: {request: Request, env: BachsEnv}) {
  if (!sandboxEnabled(env)) return new Response('Sandbox disabled', { status: 503 })
  let raw: string
  try { raw = await request.text() } catch { return new Response('Invalid body',{status:400}) }
  if (raw.length > 128_000 || !await verifyBachsWebhook(raw,request.headers,env.BACHS_WEBHOOK_SECRET!)) return new Response('Invalid signature',{status:400})
  let parsed: unknown
  try {parsed=JSON.parse(raw)} catch { return new Response('Invalid JSON',{status:400}) }
  const event = parseBachsEvent(parsed)
  if (!event) return new Response('Ignored',{status:200})
  try {
    // Authoritative provider lookup, not webhook body, establishes payment status/amount.
    const remote = await getSandboxSession(env.BACHS_API_KEY!,event.checkoutId)
    const paid = checkedPaidSandboxSession(remote,event.checkoutId)
    if (!paid) return new Response('Awaiting verified completed checkout',{status:503})
    const db = serviceDatabase(env)
    const result = await db.rpc('confirm_bachs_sandbox_checkout', {
      order_uuid: paid.orderId, checkout_ref: paid.checkoutId, event_ref: event.eventId,
      event_kind: event.eventType, confirmed_minor: paid.totalMinor, confirmed_currency: paid.currency
    })
    if (result.error) return new Response('Unable to record verified checkout',{status:503})
    // paid_awaiting_supplier = payment verified but automatic supplier purchase still blocked.
    return new Response('OK',{status:200})
  } catch { return new Response('Verification unavailable',{status:503}) }
}
