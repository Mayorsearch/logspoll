import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getOrderDeliveryStatus } from '../src/lib/order-status.ts'
import {
  checkoutRequestId,
  clearCheckoutRequest,
  getCartActiveOrderId,
  setCartActiveOrderId,
  clearCartActiveOrderId,
} from '../src/lib/checkout-request.ts'

// In-memory mock of Storage (sessionStorage)
class MockSessionStorage {
  private store: Map<string, string> = new Map()
  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  clear(): void {
    this.store.clear()
  }
}

test('Scenario 1: Server 2 / ShopVia successful payment and delivery status', () => {
  const deliveredOrder = {
    payment_status: 'paid',
    fulfillment_status: 'delivered',
    delivery_status: 'delivered',
    has_entitlement: true,
  }
  const status = getOrderDeliveryStatus(deliveredOrder)
  assert.equal(status.status, 'delivered')
  assert.equal(status.label, 'Delivered')
  assert.equal(status.canDownload, true)
  assert.equal(status.needsSupport, false)
  assert.equal(status.badgeClass, 'status-delivered')
})

test('Scenario 2: Paid but undelivered order state prevents premature download access', () => {
  // Order where payment is confirmed, but fulfillment is blocked or failed
  const blockedOrder = {
    payment_status: 'paid',
    fulfillment_status: 'pending',
    delivery_status: 'blocked',
    delivery_error: 'Worker SUPPLIER_ENCRYPTION_KEY binding is missing.',
    has_entitlement: false,
  }
  const status = getOrderDeliveryStatus(blockedOrder)
  assert.equal(status.status, 'delivery_failed')
  assert.equal(status.label, 'Delivery Failed — Support Required')
  assert.equal(status.canDownload, false)
  assert.equal(status.needsSupport, true)
  assert.equal(status.badgeClass, 'status-delivery-failed')
})

test('Scenario 3: Supplier timeout and uncertain purchase state', () => {
  // Dispatched / waiting supplier order
  const waitingOrder = {
    payment_status: 'paid',
    fulfillment_status: 'pending',
    delivery_status: 'waiting',
    has_entitlement: false,
  }
  const waitingStatus = getOrderDeliveryStatus(waitingOrder)
  assert.equal(waitingStatus.status, 'awaiting_supplier')
  assert.equal(waitingStatus.label, 'Delivery Awaiting Supplier')
  assert.equal(waitingStatus.canDownload, false)
  assert.equal(waitingStatus.needsSupport, false)

  // Uncertain state (interrupted purchase)
  const uncertainOrder = {
    payment_status: 'paid',
    fulfillment_status: 'pending',
    delivery_status: 'uncertain',
    delivery_error: 'Interrupted purchase; reconcile supplier order before retrying.',
    has_entitlement: false,
  }
  const uncertainStatus = getOrderDeliveryStatus(uncertainOrder)
  assert.equal(uncertainStatus.status, 'delivery_failed')
  assert.equal(uncertainStatus.canDownload, false)
  assert.equal(uncertainStatus.needsSupport, true)
})

test('Scenario 4 & 5: Customer switching products & stale sessionStorage isolation', () => {
  const storage = new MockSessionStorage()
  const customerId = 'cust-user-123'

  const server2Cart = [{ id: 'prod-server2-item', quantity: 1 }]
  const server1Cart = [{ id: 'prod-server1-item', quantity: 1 }]
  const server2OrderId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

  // 1. Customer places order for Server 2 product
  setCartActiveOrderId(storage as unknown as Storage, customerId, server2Cart, server2OrderId)
  assert.equal(getCartActiveOrderId(storage as unknown as Storage, customerId, server2Cart), server2OrderId)

  // 2. Customer navigates to Server 1 product. The cart items are now Server 1.
  // Stale Server 2 order ID MUST NOT match the Server 1 cart.
  const activeForServer1 = getCartActiveOrderId(storage as unknown as Storage, customerId, server1Cart)
  assert.equal(activeForServer1, null, 'Server 1 cart must NOT return Server 2 order ID')

  // 3. Clear cart order ID for Server 2 after completion
  clearCartActiveOrderId(storage as unknown as Storage, customerId, server2Cart)
  assert.equal(getCartActiveOrderId(storage as unknown as Storage, customerId, server2Cart), null)
})

test('Scenario 6: Repeated checkout clicks and page refreshes (Idempotency)', () => {
  const storage = new MockSessionStorage()
  const customerId = 'cust-user-456'
  const items = [{ id: 'prod-alpha', quantity: 2 }, { id: 'prod-beta', quantity: 1 }]

  // Multiple calls to checkoutRequestId for same customer & items yield the exact same key
  const key1 = checkoutRequestId(storage as unknown as Storage, customerId, items)
  const key2 = checkoutRequestId(storage as unknown as Storage, customerId, items)
  assert.equal(key1, key2)
  assert.match(key1, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

  // Clearing the key resets it for subsequent distinct checkouts
  clearCheckoutRequest(storage as unknown as Storage, customerId, items)
  const key3 = checkoutRequestId(storage as unknown as Storage, customerId, items)
  assert.notEqual(key1, key3)
  assert.match(key3, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
})

test('Scenario 7: Protection against fake delivery without confirmed entitlement', () => {
  // If an order record says fulfillment_status='delivered' but has_entitlement is explicitly false
  const fakeDelivered = {
    payment_status: 'paid',
    fulfillment_status: 'delivered',
    delivery_status: 'delivered',
    has_entitlement: false, // NO entitlement credentials exist in DB!
  }
  const status = getOrderDeliveryStatus(fakeDelivered)
  assert.equal(status.canDownload, false, 'Can never download without confirmed entitlement')
  assert.notEqual(status.status, 'delivered', 'Must not be classified as delivered without entitlement')
})

test('Scenario 8: Customer order history visibility and filtering', () => {
  const orders = [
    {
      id: 'o-1',
      reference: 'LP-001',
      payment_status: 'paid',
      fulfillment_status: 'delivered',
      has_entitlement: true,
    },
    {
      id: 'o-2',
      reference: 'LP-002',
      payment_status: 'paid',
      fulfillment_status: 'pending',
      delivery_status: 'waiting',
      has_entitlement: false,
    },
    {
      id: 'o-3',
      reference: 'LP-003',
      payment_status: 'paid',
      fulfillment_status: 'pending',
      delivery_status: 'blocked',
      has_entitlement: false,
    },
    {
      id: 'o-4',
      reference: 'LP-004',
      payment_status: 'pending',
      fulfillment_status: 'pending',
      has_entitlement: false,
    },
  ]

  // Purchases vault tab: only genuinely delivered orders
  const vaultPurchases = orders.filter((o) => getOrderDeliveryStatus(o).status === 'delivered')
  assert.equal(vaultPurchases.length, 1)
  assert.equal(vaultPurchases[0].id, 'o-1')

  // Pending filter in orders tab: covers processing, awaiting supplier, and payment pending
  const pendingOrders = orders.filter((o) => {
    const s = getOrderDeliveryStatus(o).status
    return s === 'delivery_processing' || s === 'awaiting_supplier' || s === 'payment_pending'
  })
  assert.equal(pendingOrders.length, 2) // o-2 (awaiting_supplier) and o-4 (payment_pending)

  // Failed filter in orders tab: covers delivery_failed
  const failedOrders = orders.filter((o) => getOrderDeliveryStatus(o).status === 'delivery_failed')
  assert.equal(failedOrders.length, 1) // o-3 (blocked)
})
