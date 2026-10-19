import type { CartItem } from './cart-state.ts'

type CheckoutStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const legacyKey = 'logspoll-checkout-req-id'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function key(userId: string, items: CartItem[]) {
  return 'logspoll-checkout:' + JSON.stringify([userId, [...items].sort((a, b) => a.id.localeCompare(b.id)).map(item => [item.id, item.quantity])])
}

/** Same customer and cart reuse one request ID, including after navigation or reload. */
export function checkoutRequestId(storage: CheckoutStorage, userId: string, items: CartItem[], renew = false): string {
  const cartKey = key(userId, items)
  const previous = storage.getItem(cartKey)
  if (!renew && previous && uuid.test(previous)) return previous
  // Preserve an unknown legacy attempt until the server explicitly rejects its cart identity.
  const legacy = storage.getItem(legacyKey)
  const id = !renew && legacy && uuid.test(legacy) ? legacy : crypto.randomUUID()
  storage.setItem(cartKey, id)
  storage.removeItem(legacyKey)
  return id
}

export function clearCheckoutRequest(storage: CheckoutStorage, userId: string, items: CartItem[]) {
  storage.removeItem(key(userId, items))
  storage.removeItem(legacyKey)
}
