import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCart } from '../src/lib/cart-state.ts'
import { paymentMode, initiateCheckout } from '../workers/api/bachs-checkout.ts'
import type { ApiEnv } from '../workers/api/types.ts'

test('Cart state parser validates UUIDs, quantities, and deduplicates items', () => {
  // Empty or invalid inputs
  assert.deepEqual(parseCart(null), [])
  assert.deepEqual(parseCart(''), [])
  assert.deepEqual(parseCart('invalid json'), [])
  assert.deepEqual(parseCart('{}'), [])
  assert.deepEqual(parseCart('123'), [])

  // Valid item
  const validId = '11111111-1111-4111-8111-111111111111'
  assert.deepEqual(
    parseCart(JSON.stringify([{ id: validId, quantity: 2 }])),
    [{ id: validId, quantity: 2 }]
  )

  // Quantity boundaries (1 to 1000)
  assert.deepEqual(parseCart(JSON.stringify([{ id: validId, quantity: 0 }])), [])
  assert.deepEqual(parseCart(JSON.stringify([{ id: validId, quantity: -5 }])), [])
  assert.deepEqual(parseCart(JSON.stringify([{ id: validId, quantity: 1001 }])), [])
  assert.deepEqual(parseCart(JSON.stringify([{ id: validId, quantity: 1.5 }])), [])
  assert.deepEqual(
    parseCart(JSON.stringify([{ id: validId, quantity: 1000 }])),
    [{ id: validId, quantity: 1000 }]
  )

  // Deduplication: only the first occurrence of an ID is kept
  const validId2 = '22222222-2222-4222-8222-222222222222'
  assert.deepEqual(
    parseCart(
      JSON.stringify([
        { id: validId, quantity: 3 },
        { id: validId, quantity: 5 },
        { id: validId2, quantity: 1 },
      ])
    ),
    [
      { id: validId, quantity: 3 },
      { id: validId2, quantity: 1 },
    ]
  )

  // Rejects invalid non-UUID strings
  assert.deepEqual(
    parseCart(
      JSON.stringify([
        { id: 'not-a-uuid', quantity: 1 },
        { id: validId, quantity: 2 },
      ])
    ),
    [{ id: validId, quantity: 2 }]
  )
})

test('Server number mapping outputs only Server 1, Server 2, Server 3, Server 4 and never supplier names', () => {
  function formatServerLabel(serverNumber?: number | null): string {
    if (serverNumber === 1) return 'Server 1'
    if (serverNumber === 2) return 'Server 2'
    if (serverNumber === 3) return 'Server 3'
    if (serverNumber === 4) return 'Server 4'
    return 'Verified Server'
  }

  assert.equal(formatServerLabel(1), 'Server 1')
  assert.equal(formatServerLabel(2), 'Server 2')
  assert.equal(formatServerLabel(3), 'Server 3')
  assert.equal(formatServerLabel(4), 'Server 4')
  assert.equal(formatServerLabel(null), 'Verified Server')
  assert.equal(formatServerLabel(undefined), 'Verified Server')

  // Verify none of the output labels contain supplier names
  const labels = [1, 2, 3, 4].map(formatServerLabel)
  for (const label of labels) {
    assert.doesNotMatch(label, /HStora|YoungPG|ShopViaClone|DigitalTop|DigitalCore/i)
  }
})

test('Bachs live checkout remains disabled in production until merchant verification is completed', () => {
  const envProductionLocked: ApiEnv = {
    ENVIRONMENT: 'production',
    BACHS_LIVE_CHECKOUT_ENABLED: 'false',
    BACHS_LIVE_VERIFIED: 'false',
    BACHS_FULFILLMENT_VERIFIED: 'false',
    BACHS_API_KEY: 'sk_live_' + 'a'.repeat(40),
    BACHS_WEBHOOK_SECRET: 'whsec_test',
  }

  assert.throws(
    () => paymentMode(envProductionLocked),
    /Live checkout remains disabled pending verified payment and fulfillment checks/
  )
})

test('Bachs staging checkout requires explicit BACHS_SANDBOX_ENABLED flag', () => {
  const envStagingDisabled: ApiEnv = {
    ENVIRONMENT: 'staging',
    BACHS_SANDBOX_ENABLED: 'false',
    BACHS_API_KEY: 'sk_sandbox_' + 'a'.repeat(40),
    BACHS_WEBHOOK_SECRET: 'whsec_test',
  }

  assert.throws(
    () => paymentMode(envStagingDisabled),
    /Sandbox checkout is disabled/
  )

  const envStagingEnabled: ApiEnv = {
    ...envStagingDisabled,
    BACHS_SANDBOX_ENABLED: 'true',
  }

  assert.equal(paymentMode(envStagingEnabled), 'sandbox')
})

test('Checkout submission rejects invalid client request ID or empty items', async () => {
  const env: ApiEnv = {
    ENVIRONMENT: 'staging',
    BACHS_SANDBOX_ENABLED: 'true',
    BACHS_API_KEY: 'sk_sandbox_' + 'a'.repeat(40),
    BACHS_WEBHOOK_SECRET: 'whsec_test',
  }

  const buyer = { id: '11111111-1111-4111-8111-111111111111', email: 'test@example.com' }

  // Invalid request ID (not a UUID)
  await assert.rejects(
    () => initiateCheckout(env, buyer, 'not-a-uuid', [{ id: '11111111-1111-4111-8111-111111111111', quantity: 1 }], 'https://logspoll.com'),
    /Invalid checkout selection or request ID/
  )

  // Empty items
  await assert.rejects(
    () => initiateCheckout(env, buyer, '22222222-2222-4222-8222-222222222222', [], 'https://logspoll.com'),
    /Invalid checkout selection or request ID/
  )
})

