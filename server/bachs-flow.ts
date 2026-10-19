/** Pure sandbox validation helpers. Never authorize fulfillment from browser state or
 * a webhook body alone; retrieve the checkout from Bachs first. */
export function parseNGNMinor(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{1,9}(?:\.\d{1,2})?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(result) && result > 0 && result <= 99_999_999_900 ? result : null
}
export type PaidCheckout = { orderId: string; checkoutId: string; totalMinor: number; currency: 'NGN' }
export function checkedPaidSandboxSession(session: Record<string, unknown>, expectedId: string): PaidCheckout | null {
  const checkoutId = typeof session.checkout_id === 'string' ? session.checkout_id : session.id
  const orderId = session.reference
  const amount = parseNGNMinor(session.amount)
  if (checkoutId !== expectedId || !/^chk_[A-Za-z0-9_-]{6,100}$/.test(expectedId)) return null
  if (typeof orderId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(orderId)) return null
  // Bachs GET checkout session documents payment_status='succeeded', whereas
  // checkout.completed webhook examples use 'paid'. We use GET as the source of truth.
  const charge = session.charge
  if (session.status !== 'completed' || session.payment_status !== 'succeeded') return null
  const cart=session.session_mode==='CART'&&session.source_type==='CHECKOUT_SESSION'
  const metadata = session.metadata as Record<string, unknown> | null
  const pure = (session.session_mode === null || session.session_mode === undefined) && (session.products === null || session.products === undefined) && session.source_type === 'API' && metadata?.order_id === orderId
  if ((!cart && !pure) || session.recurring !== null) return null
  if (!charge || typeof charge !== 'object' || Array.isArray(charge) || (charge as Record<string,unknown>).status !== 'succeeded') return null
  if (session.currency !== 'NGN' || amount === null) return null
  return { orderId, checkoutId: expectedId, totalMinor: amount, currency: 'NGN' }
}
export function parseBachsEvent(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const event = value as Record<string, unknown>
  if (typeof event.id !== 'string' || !/^evt_[A-Za-z0-9_-]{5,140}$/.test(event.id) || typeof event.type !== 'string') return null
  if (event.type !== 'checkout.completed' && event.type !== 'collection.succeeded') return null
  if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return null
  const data = event.data as Record<string, unknown>
  if (typeof data.checkout_id !== 'string' || !/^chk_[A-Za-z0-9_-]{6,100}$/.test(data.checkout_id)) return null
  return { eventId: event.id, eventType: event.type, checkoutId: data.checkout_id }
}
