/** Bachs test-only hosted checkout. No real transactions, supplier purchases,
 * order delivery or production payment routes are enabled by this handler. */
import { HttpError, json } from '../../server/auth.ts'
import { createSandboxSession } from '../../server/bachs.ts'
import { sandboxEnabled, verifiedBuyer, serviceDatabase, safeBachsError } from '../../server/bachs-auth.ts'
import type { BachsEnv } from '../../server/bachs-auth.ts'
const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
export function onRequestPost(context?: {request: Request, env: BachsEnv}): Response | Promise<Response> {
  // Keep the original fail-closed contract for test callers without a Functions context.
  if (!context) return json({error:'Sandbox checkout disabled.'},503)
  return initiateSandboxCheckout(context)
}
async function initiateSandboxCheckout({request,env}: {request: Request, env: BachsEnv}) {
  try {
    if (!sandboxEnabled(env)) throw new HttpError(503, 'Bachs sandbox checkout is disabled.')
    const buyer = await verifiedBuyer(request,env)
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'Use JSON.')
    const raw = await request.text()
    if (raw.length > 4096) throw new HttpError(413, 'Invalid cart size.')
    let value: unknown
    try { value = JSON.parse(raw) } catch { throw new HttpError(400, 'Invalid request.') }
    const body = value as Record<string,unknown>
    if (!body || typeof body !== 'object' || Array.isArray(body) || !uuid(body.product_id) || !uuid(body.request_id) || body.quantity !== 1) throw new HttpError(400, 'One eligible product per sandbox checkout.')
    const db = serviceDatabase(env)
    const created = await db.rpc('prepare_bachs_sandbox_checkout', { buyer_uuid: buyer.id, product_uuid: body.product_id, attempt_uuid: body.request_id })
    if (created.error || !created.data || typeof created.data.id !== 'string') throw new HttpError(409, 'Product is not available for sandbox testing.')
    const order = created.data as {id: string, total_minor: number, state: string, checkout_id?: string | null}
    if (order.state === 'paid_awaiting_supplier' || order.state === 'held') throw new HttpError(409, 'Order already processed.')
    // Re-use the immutable order UUID as the Bachs idempotency key; no duplicate charges on retry.
    const checkout = await createSandboxSession({ key: env.BACHS_API_KEY!, amountMinor: order.total_minor, buyerEmail: buyer.email, orderId: order.id,
      idempotencyKey: 'sandbox_' + order.id.replace(/-/g,'') })
    const attached = await db.rpc('attach_bachs_sandbox_checkout', { order_uuid: order.id, checkout_ref: checkout.checkoutId })
    if (attached.error) throw new HttpError(503, 'Checkout created but confirmation is pending; retry using the same request ID.')
    return json({ sandbox: true, order_id: order.id, checkout_url: checkout.checkoutUrl })
  } catch(problem) { return safeBachsError(problem) }
}
