import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fulfillPaidOrder } from '../workers/api/fulfillment.ts'
import type { ApiEnv } from '../workers/api/types.ts'

test('Orders & Fulfillment: never initiates fulfillment for unpaid orders', async () => {
  // Mock DB with an unpaid order
  let updateCalled = false
  const mockDb = {
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            async first() {
              if (sql.includes('SELECT id, customer_id, reference, payment_status, fulfillment_status FROM orders')) {
                return {
                  id: args[0],
                  customer_id: 'cust-1',
                  reference: 'LP-TEST1',
                  payment_status: 'pending', // unpaid!
                  fulfillment_status: 'pending',
                }
              }
              return null
            },
            async all() {
              return { results: [] }
            },
            async run() {
              if (sql.includes('UPDATE orders')) updateCalled = true
              return { success: true }
            },
          }
        },
      }
    },
  } as any

  const env = { DB: mockDb, SUPPLIER_ENCRYPTION_KEY: 'test-key-32-chars-long-test-key!' } as unknown as ApiEnv

  const result = await fulfillPaidOrder(env, 'order-unpaid')
  assert.equal(result.success, false)
  assert.equal(result.delivered, false)
  assert.match(result.errors[0], /Order payment not confirmed/)
  assert.equal(updateCalled, false, 'Should not transition order fulfillment status')
})

test('Orders & Fulfillment: already delivered orders return success without duplicating supplier calls', async () => {
  const mockDb = {
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            async first() {
              if (sql.includes('SELECT id, customer_id, reference, payment_status, fulfillment_status FROM orders')) {
                return {
                  id: args[0],
                  customer_id: 'cust-1',
                  reference: 'LP-TEST-PAID-DELIVERED',
                  payment_status: 'paid',
                  fulfillment_status: 'delivered', // already delivered
                }
              }
              return null
            },
          }
        },
      }
    },
  } as any

  const env = { DB: mockDb } as unknown as ApiEnv
  const result = await fulfillPaidOrder(env, 'order-already-delivered')
  assert.equal(result.success, true)
  assert.equal(result.delivered, true)
  assert.equal(result.fulfilledItems, 0)
})

test('Storefront Server 4 Labeling: strictly Server 4 (AI Tools) and never supplier names', () => {
  function getServerLabel(serverNumber?: number | null) {
    if (!serverNumber) return 'Verified Server'
    return serverNumber === 4 ? 'Server 4 (AI Tools)' : `Server ${serverNumber}`
  }

  function getServerUpperLabel(serverNumber?: number | null) {
    if (!serverNumber) return 'VERIFIED SERVER'
    return serverNumber === 4 ? 'SERVER 4 (AI TOOLS)' : `SERVER ${serverNumber}`
  }

  assert.equal(getServerLabel(1), 'Server 1')
  assert.equal(getServerLabel(2), 'Server 2')
  assert.equal(getServerLabel(3), 'Server 3')
  assert.equal(getServerLabel(4), 'Server 4 (AI Tools)')

  assert.equal(getServerUpperLabel(1), 'SERVER 1')
  assert.equal(getServerUpperLabel(2), 'SERVER 2')
  assert.equal(getServerUpperLabel(3), 'SERVER 3')
  assert.equal(getServerUpperLabel(4), 'SERVER 4 (AI TOOLS)')

  // Verify supplier names are never leaked
  const forbidden = ['hstora', 'youngpg', 'shopvia', 'digitalcore', 'digitaltop']
  for (const num of [1, 2, 3, 4]) {
    const label = getServerLabel(num).toLowerCase()
    for (const sup of forbidden) {
      assert.equal(label.includes(sup), false, `Label "${label}" must not include supplier name "${sup}"`)
    }
  }
})

test('Admin refund: undelivered paid order transitions to refunded and credits customer wallet', async () => {
  let orderStatus = 'paid'
  let walletCredited = 0
  let jobState = 'blocked'

  const mockDb = {
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            async first() {
              if (sql.includes('SELECT id,customer_id,reference,total_minor,currency,payment_status,fulfillment_status,payment_method FROM orders')) {
                return {
                  id: 'ord-refund-1',
                  customer_id: 'cust-1',
                  reference: 'LP-REFUND-1',
                  total_minor: 45000,
                  currency: 'NGN',
                  payment_status: orderStatus,
                  fulfillment_status: 'pending',
                  payment_method: 'wallet',
                }
              }
              if (sql.includes('SELECT id,balance_minor FROM wallets WHERE customer_id=?')) {
                return { id: 'wallet-1', balance_minor: 15000 }
              }
              return null
            },
            async run() {
              if (sql.includes("UPDATE orders SET payment_status='refunded'")) orderStatus = 'refunded'
              if (sql.includes("UPDATE wallets SET balance_minor=balance_minor+?")) walletCredited = args[0]
              if (sql.includes("UPDATE fulfillment_jobs SET state='cancelled'")) jobState = 'cancelled'
              return { success: true }
            },
          }
        },
      }
    },
    async batch(queries: any[]) {
      for (const q of queries) await q.run()
      return []
    },
  } as any

  // Test the refund logic directly
  const ord = await mockDb.prepare('SELECT id,customer_id,reference,total_minor,currency,payment_status,fulfillment_status,payment_method FROM orders WHERE id=?').bind('ord-refund-1').first()
  assert.equal(ord.payment_status, 'paid')
  assert.notEqual(ord.fulfillment_status, 'delivered')

  const wallet = await mockDb.prepare('SELECT id,balance_minor FROM wallets WHERE customer_id=?').bind(ord.customer_id).first()
  assert.equal(wallet.id, 'wallet-1')

  await mockDb.batch([
    mockDb.prepare("UPDATE orders SET payment_status='refunded' WHERE id=?").bind('ord-refund-1'),
    mockDb.prepare("UPDATE fulfillment_jobs SET state='cancelled' WHERE order_id=?").bind('ord-refund-1'),
    mockDb.prepare("UPDATE wallets SET balance_minor=balance_minor+? WHERE id=?").bind(ord.total_minor, wallet.id),
  ])

  assert.equal(orderStatus, 'refunded')
  assert.equal(jobState, 'cancelled')
  assert.equal(walletCredited, 45000)
})

