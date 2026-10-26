import type { CartItem } from './cart-state.ts'

type CheckoutStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const legacyKey = 'logspoll-checkout-req-id'
const legacyActiveOrderKey = 'logspoll-active-order-id'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function key(userId: string, items: CartItem[]) {
  return 'logspoll-checkout:' + JSON.stringify([userId, [...items].sort((a, b) => a.id.localeCompare(b.id)).map(item => [item.id, item.quantity])])
}

function activeOrderKey(userId: string, items: CartItem[]) {
  return 'logspoll-active-order:' + JSON.stringify([userId, [...items].sort((a, b) => a.id.localeCompare(b.id)).map(item => [item.id, item.quantity])])
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

/**
 * Returns an active order ID scoped strictly to the customer and current cart items.
 * An order from a previous or different cart is never returned.
 */
export function getCartActiveOrderId(storage: CheckoutStorage, userId?: string | null, items?: CartItem[]): string | null {
  if (!userId || !items || !items.length) return null
  const stored = storage.getItem(activeOrderKey(userId, items))
  return stored && uuid.test(stored) ? stored : null
}

export function setCartActiveOrderId(storage: CheckoutStorage, userId: string, items: CartItem[], orderId: string) {
  if (!userId || !items.length || !orderId) return
  storage.setItem(activeOrderKey(userId, items), orderId)
}

export function clearCartActiveOrderId(storage: CheckoutStorage, userId?: string | null, items?: CartItem[]) {
  if (userId && items && items.length) {
    storage.removeItem(activeOrderKey(userId, items))
  }
  try {
    storage.removeItem(legacyActiveOrderKey)
  } catch {
    // Storage access is best-effort
  }
}
