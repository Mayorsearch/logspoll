import type { ApiEnv } from './types.ts'
import { openCredential } from '../../server/supplier-crypto.ts'
import { buyDigitalCoreProduct, DigitalCoreError } from '../../server/digitalcore.ts'

export interface FulfillmentResult {
  success: boolean
  delivered: boolean
  fulfilledItems: number
  totalItems: number
  errors: string[]
}

/**
 * Fulfills an independently verified paid order.
 * - Enforces payment_status === 'paid'
 * - Prevents duplicate supplier calls using D1 entitlement existence checks
 * - Dispatches 'order_delivered' email event upon complete fulfillment
 * - Handles shortages and supplier errors without falsely marking orders complete
 */
export async function fulfillPaidOrder(env: ApiEnv, orderId: string): Promise<FulfillmentResult> {
  const db = env.DB
  if (!db) {
    return { success: false, delivered: false, fulfilledItems: 0, totalItems: 0, errors: ['Database unavailable.'] }
  }

  // 1. Verify that order exists and payment is verified as paid
  const order = await db
    .prepare('SELECT id, customer_id, reference, payment_status, fulfillment_status FROM orders WHERE id=?')
    .bind(orderId)
    .first<{ id: string; customer_id: string; reference: string; payment_status: string; fulfillment_status: string }>()

  if (!order) {
    return { success: false, delivered: false, fulfilledItems: 0, totalItems: 0, errors: ['Order not found.'] }
  }

  if (order.payment_status !== 'paid') {
    return {
      success: false,
      delivered: false,
      fulfilledItems: 0,
      totalItems: 0,
      errors: [`Order payment not confirmed (current status: ${order.payment_status}). Supplier fulfillment blocked.`],
    }
  }

  if (order.fulfillment_status === 'delivered') {
    return { success: true, delivered: true, fulfilledItems: 0, totalItems: 0, errors: [] }
  }

  // Set fulfillment_status to 'processing' if currently 'pending'
  if (order.fulfillment_status === 'pending') {
    await db
      .prepare("UPDATE orders SET fulfillment_status='processing', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND fulfillment_status='pending'")
      .bind(order.id)
      .run()
      .catch(() => {})
  }

  // 2. Query items needing fulfillment
  const unfulfilled = await db
    .prepare(
      `SELECT i.id, i.order_id, i.product_id, i.product_name, i.category_name, i.quantity, i.unit_price_minor, p.server_number, p.slug
       FROM order_items i
       JOIN products p ON p.id = i.product_id
       WHERE i.order_id = ?
         AND NOT EXISTS (SELECT 1 FROM product_entitlements e WHERE e.order_item_id = i.id)`
    )
    .bind(order.id)
    .all<{
      id: string
      order_id: string
      product_id: string
      product_name: string
      category_name: string
      quantity: number
      unit_price_minor: number
      server_number: number | null
      slug: string
    }>()

  const errors: string[] = []
  let fulfilledCount = 0

  for (const item of unfulfilled.results) {
    // Check Server 4 (DigitalCore) fulfillment
    if (item.server_number === 4) {
      try {
        const dcItem = await db
          .prepare(
            `SELECT external_id, name, stock
             FROM digitalcore_catalog_items
             WHERE product_id=? OR ('s4-' || external_id)=?
             LIMIT 1`
          )
          .bind(item.product_id, item.slug)
          .first<{ external_id: string; name: string; stock: number }>()

        if (!dcItem) {
          errors.push(`DigitalCore catalog entry not found for product ${item.product_name} (${item.slug}).`)
          continue
        }

        const conn = await db
          .prepare("SELECT ciphertext, nonce, enabled, base_url FROM digitalcore_connection WHERE id='digitalcore'")
          .first<{ ciphertext: string; nonce: string; enabled: number; base_url: string }>()

        if (!conn || !conn.enabled || !env.SUPPLIER_ENCRYPTION_KEY) {
          errors.push(`DigitalCore connection is disabled or encryption key missing. Cannot purchase ${item.product_name}.`)
          continue
        }

        const rawCreds = await openCredential(conn.ciphertext, conn.nonce, 'digitalcore', env.SUPPLIER_ENCRYPTION_KEY)
        const creds = JSON.parse(rawCreds) as { apiKey?: string; baseUrl?: string }
        if (!creds?.apiKey) {
          errors.push('DigitalCore API credentials unconfigured.')
          continue
        }

        // Call DigitalCore purchase API
        const purchase = await buyDigitalCoreProduct(
          { apiKey: creds.apiKey, baseUrl: conn.base_url || creds.baseUrl },
          { id: dcItem.external_id, count: item.quantity }
        )

        if (purchase.success) {
          const credLines = purchase.items && purchase.items.length > 0 ? purchase.items : [`Access Order Reference: ${purchase.orderId}`]
          const instructions = [
            `Product: ${item.product_name}`,
            `Quantity: ${item.quantity}`,
            'Access Credentials & Details:',
            '----------------------------------------',
            ...credLines,
            '----------------------------------------',
            purchase.viewUrl ? `Management Link: ${purchase.viewUrl}` : '',
            'Delivered securely by LogsPoll Digital Delivery Vault.',
          ]
            .filter(Boolean)
            .join('\n')

          await db
            .prepare(
              `INSERT INTO product_entitlements(id, order_item_id, instructions, created_at)
               VALUES(?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
               ON CONFLICT(order_item_id) DO NOTHING`
            )
            .bind(crypto.randomUUID(), item.id, instructions)
            .run()

          fulfilledCount++
        }
      } catch (err) {
        const msg = err instanceof DigitalCoreError ? err.message : err instanceof Error ? err.message : 'Fulfillment failure'
        errors.push(`DigitalCore fulfillment error for ${item.product_name}: ${msg}`)
      }
    }
  }

  // 3. Check overall order fulfillment status
  const counts = await db
    .prepare(
      `SELECT
         (SELECT count(*) FROM order_items WHERE order_id=?) AS total_items,
         (SELECT count(*) FROM product_entitlements e JOIN order_items oi ON oi.id=e.order_item_id WHERE oi.order_id=?) AS entitled_items`
    )
    .bind(order.id, order.id)
    .first<{ total_items: number; entitled_items: number }>()

  const totalItems = counts?.total_items ?? 0
  const entitledItems = counts?.entitled_items ?? 0

  if (totalItems > 0 && totalItems === entitledItems) {
    const now = Date.now()
    await db.batch([
      db.prepare(
        "UPDATE orders SET fulfillment_status='delivered', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND payment_status='paid'"
      ).bind(order.id),
      db.prepare(
        "INSERT INTO business_mail_events(id, kind, user_id, created_at) VALUES(? || ':order_delivered', 'order_delivered', ?, ?) ON CONFLICT(id) DO NOTHING"
      ).bind(order.id, order.customer_id, now),
    ])

    return {
      success: true,
      delivered: true,
      fulfilledItems: entitledItems,
      totalItems,
      errors,
    }
  }

  return {
    success: errors.length === 0,
    delivered: false,
    fulfilledItems: entitledItems,
    totalItems,
    errors,
  }
}
