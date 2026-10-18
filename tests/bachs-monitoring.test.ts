import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { paymentReadiness } from '../workers/api/payment-readiness.ts'
import { adminOperations } from '../workers/api/admin.ts'
import type { ApiEnv, Database, Statement } from '../workers/api/types.ts'

function createSqliteD1() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  const dir = new URL('../workers/api/migrations/', import.meta.url)
  for (const name of readdirSync(dir).filter(n => /^00\d{2}_.*\.sql$/.test(n)).sort()) {
    sql.exec(readFileSync(new URL(name, dir), 'utf8'))
  }

  const db = {
    prepare(query: string) {
      let args: unknown[] = []
      const stmt = {
        bind(...values: unknown[]) {
          args = values
          return stmt
        },
        async first<T = Record<string, unknown>>() {
          return (await stmt.all()).results[0] as T ?? null
        },
        async all<T = Record<string, unknown>>() {
          const results = sql.prepare(query).all(...(args as never[])) as T[]
          const changes = (sql.prepare('SELECT changes() AS n').get() as { n: number }).n
          return { success: true, results, meta: { changes, last_row_id: 0 } }
        },
        async run() {
          return stmt.all()
        },
      }
      return stmt
    },
    async batch(statements: Statement[]) {
      sql.exec('BEGIN')
      try {
        const results = await Promise.all(statements.map(s => (s as { all: () => Promise<unknown> }).all()))
        sql.exec('COMMIT')
        return results
      } catch (err) {
        sql.exec('ROLLBACK')
        throw err
      }
    },
    async exec(query: string) {
      sql.exec(query)
    },
  } as unknown as Database

  return { sql, db }
}

test('paymentReadiness computes diagnostics and payment metrics accurately from D1 tables', async () => {
  const { sql, db } = createSqliteD1()
  try {
    const adminId = crypto.randomUUID()
    const customerId = crypto.randomUUID()
    const order1 = crypto.randomUUID()
    const order2 = crypto.randomUUID()
    const order3 = crypto.randomUUID()
    const attempt1 = crypto.randomUUID()
    const attempt2 = crypto.randomUUID()
    const attempt3 = crypto.randomUUID()
    const now = Date.now()

    sql.prepare('INSERT INTO users(id) VALUES(?)').run(adminId)
    sql.prepare('INSERT INTO users(id) VALUES(?)').run(customerId)
    sql.prepare("INSERT INTO user_roles(user_id,role) VALUES(?,'admin')").run(adminId)
    sql.prepare("INSERT INTO user_roles(user_id,role) VALUES(?,'customer')").run(customerId)
    sql.prepare("INSERT INTO auth_user(id,email,emailVerified,name,createdAt,updatedAt) VALUES(?,?,'1',?,datetime('now'),datetime('now'))").run(customerId, 'test@example.com', 'Buyer One')

    // Order 1: Paid (5000 NGN)
    sql.prepare("INSERT INTO orders(id,customer_id,reference,total_minor,currency,payment_status,fulfillment_status,created_at) VALUES(?,?,?,?,'NGN','paid','pending',?)").run(order1, customerId, 'LP-001', 500000, now - 3000)
    sql.prepare("INSERT INTO bachs_payment_attempts(id,order_id,customer_id,client_request_id,idempotency_key,provider_mode,amount_minor,currency,status,created_at,updated_at) VALUES(?,?,?,?,?,'sandbox',?,'NGN','paid',?,?)").run(attempt1, order1, customerId, crypto.randomUUID(), 'bachs_idempotency_key_1', 500000, now - 3000, now - 2000)

    // Order 2: In-Flight Open (2500 NGN)
    sql.prepare("INSERT INTO orders(id,customer_id,reference,total_minor,currency,payment_status,fulfillment_status,created_at) VALUES(?,?,?,?,'NGN','pending','pending',?)").run(order2, customerId, 'LP-002', 250000, now - 1000)
    sql.prepare("INSERT INTO bachs_payment_attempts(id,order_id,customer_id,client_request_id,idempotency_key,provider_mode,amount_minor,currency,status,created_at,updated_at) VALUES(?,?,?,?,?,'sandbox',?,'NGN','open',?,?)").run(attempt2, order2, customerId, crypto.randomUUID(), 'bachs_idempotency_key_2', 250000, now - 1000, now - 1000)

    // Order 3: Failed (1000 NGN)
    sql.prepare("INSERT INTO orders(id,customer_id,reference,total_minor,currency,payment_status,fulfillment_status,created_at) VALUES(?,?,?,?,'NGN','pending','pending',?)").run(order3, customerId, 'LP-003', 100000, now - 500)
    sql.prepare("INSERT INTO bachs_payment_attempts(id,order_id,customer_id,client_request_id,idempotency_key,provider_mode,amount_minor,currency,status,created_at,updated_at) VALUES(?,?,?,?,?,'sandbox',?,'NGN','failed',?,?)").run(attempt3, order3, customerId, crypto.randomUUID(), 'bachs_idempotency_key_3', 100000, now - 500, now - 500)

    // Webhook event
    sql.prepare("INSERT INTO bachs_webhook_events(event_id,event_type,attempt_id,processing_status,received_at,processed_at) VALUES('evt_123456789','checkout.session.completed',?,'processed',?,?)").run(attempt1, now - 2000, now - 2000)

    const env: ApiEnv = {
      ENVIRONMENT: 'staging',
      DB: db,
      BACHS_API_KEY: 'sk_sandbox_mock_test_key_123',
      BACHS_WEBHOOK_SECRET: 'whsec_mock_secret_456',
      BACHS_SANDBOX_ENABLED: 'true',
      AUTH_ORIGIN: 'https://logspoll.com',
    }

    const readiness = await paymentReadiness(env, 'https://logspoll.com', false)

    assert.equal(readiness.mode, 'sandbox')
    assert.equal(readiness.apiKeyConfigured, true)
    assert.equal(readiness.webhookSecretConfigured, true)
    assert.equal(readiness.webhookHandlerEnabled, true)
    assert.equal(readiness.checkoutEnabled, false)
    assert.equal(readiness.automaticFulfillment, false)

    // Metrics validation
    assert.equal(readiness.metrics.total_attempts, 3)
    assert.equal(readiness.metrics.total_paid, 1)
    assert.equal(readiness.metrics.total_volume_minor, 500000)
    assert.equal(readiness.metrics.total_open, 1)
    assert.equal(readiness.metrics.total_failed, 1)
    assert.equal(readiness.metrics.total_refunded, 0)
    assert.equal(readiness.metrics.webhook_count, 1)
    assert.equal(readiness.metrics.webhook_processed, 1)

    // Verify history rows
    assert.equal(readiness.history.length, 3)
    const paidRow = readiness.history.find(h => h.id === attempt1)
    assert.ok(paidRow)
    assert.equal(paidRow.customer_email, 'test@example.com')
    assert.equal(paidRow.payment_status, 'paid')
    assert.equal(paidRow.fulfillment_status, 'pending')
  } finally {
    sql.close()
  }
})

test('admin order fulfillment enforces paid status, updates status to delivered and creates product_entitlements', async () => {
  const { sql, db } = createSqliteD1()
  try {
    const env: ApiEnv = {
      ENVIRONMENT: 'production',
      DB: db,
      AUTH_ENABLED: 'true',
      AUTH_ORIGIN: 'https://logspoll.com',
      AUTH_SECRET: 'test_auth_secret_must_be_at_least_32_characters_long_12345',
      RESEND_API_KEY: 're_test_key_mock_12345678',
    }

    const { createAuth } = await import('../workers/api/auth.ts')
    const auth = createAuth(env)
    await auth.api.signUpEmail({ body: { name: 'Admin User', email: 'admin@logspoll.com', password: 'ValidAdminPassword123!' } })
    sql.prepare("UPDATE auth_user SET emailVerified=1 WHERE email='admin@logspoll.com'").run()
    const loginRes = await auth.api.signInEmail({ body: { email: 'admin@logspoll.com', password: 'ValidAdminPassword123!' }, asResponse: true })
    const cookie = loginRes.headers.get('set-cookie')!.split(';')[0]
    const adminUser = sql.prepare("SELECT id FROM auth_user WHERE email='admin@logspoll.com'").get() as { id: string }
    sql.prepare("INSERT OR REPLACE INTO users(id,status) VALUES(?,'active')").run(adminUser.id)
    sql.prepare("INSERT OR REPLACE INTO user_roles(user_id,role) VALUES(?,'admin')").run(adminUser.id)
    sql.prepare("INSERT OR REPLACE INTO profiles(id,full_name) VALUES(?,'Admin User')").run(adminUser.id)

    const customerId = crypto.randomUUID()
    const unpaidOrderId = crypto.randomUUID()
    const paidOrderId = crypto.randomUUID()
    const categoryId = crypto.randomUUID()
    const productId = crypto.randomUUID()
    const orderItemId = crypto.randomUUID()

    sql.prepare('INSERT INTO users(id) VALUES(?)').run(customerId)
    sql.prepare("INSERT INTO user_roles(user_id,role) VALUES(?,'customer')").run(customerId)
    sql.prepare("INSERT INTO profiles(id,full_name) VALUES(?,'Customer User')").run(customerId)

    sql.prepare("INSERT INTO categories(id,slug,name,short_name) VALUES(?,'vpn','VPN','VPN')").run(categoryId)
    sql.prepare("INSERT INTO products(id,category_id,slug,name,description,price_minor,supplier_name,delivery_type,authorized_resale,status,publication_verified) VALUES(?,?,'vpn-pro','VPN Pro','A verified high-speed VPN account service',250000,'Manual','Manual fulfillment',1,'active',1)").run(productId, categoryId)

    // Unpaid order
    sql.prepare("INSERT INTO orders(id,customer_id,reference,total_minor,currency,payment_status,fulfillment_status) VALUES(?,?,?,?,'NGN','pending','pending')").run(unpaidOrderId, customerId, 'LP-UNPAID', 250000)
    sql.prepare("INSERT INTO order_items(id,order_id,product_id,product_name,category_name,quantity,unit_price_minor) VALUES(?,?,?,?,?,1,250000)").run(crypto.randomUUID(), unpaidOrderId, productId, 'VPN Pro', 'VPN')

    // Paid order
    sql.prepare("INSERT INTO orders(id,customer_id,reference,total_minor,currency,payment_status,fulfillment_status) VALUES(?,?,?,?,'NGN','paid','pending')").run(paidOrderId, customerId, 'LP-PAID', 250000)
    sql.prepare("INSERT INTO order_items(id,order_id,product_id,product_name,category_name,quantity,unit_price_minor) VALUES(?,?,?,?,?,1,250000)").run(orderItemId, paidOrderId, productId, 'VPN Pro', 'VPN')

    const authHeaders = {
      Origin: 'https://logspoll.com',
      'Content-Type': 'application/json',
      Cookie: cookie,
    }

    // 1. Attempt delivery on unpaid order -> must fail (409 Undelivered paid order required)
    const deliverUnpaidReq = new Request('https://logspoll.com/api/admin', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        action: 'deliver',
        id: unpaidOrderId,
        instructions: 'Credentials: user:pass',
      }),
    })

    await assert.rejects(() => adminOperations(deliverUnpaidReq, env), (err: { status: number }) => err.status === 409)

    // 2. Deliver paid order -> must succeed
    const deliverPaidReq = new Request('https://logspoll.com/api/admin', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        action: 'deliver',
        id: paidOrderId,
        instructions: 'Delivery: Server 3 License Key: ABC-123-XYZ',
      }),
    })

    const resPaid = await adminOperations(deliverPaidReq, env)
    assert.equal(resPaid.status, 200)
    const data = await resPaid.json() as { saved: boolean; id: string }
    assert.equal(data.saved, true)
    assert.equal(data.id, paidOrderId)

    // 3. Verify order status in D1
    const updatedOrder = sql.prepare('SELECT payment_status, fulfillment_status FROM orders WHERE id=?').get(paidOrderId) as { payment_status: string; fulfillment_status: string }
    assert.equal(updatedOrder.payment_status, 'paid')
    assert.equal(updatedOrder.fulfillment_status, 'delivered')

    // 4. Verify product entitlement was recorded
    const entitlement = sql.prepare('SELECT instructions FROM product_entitlements WHERE order_item_id=?').get(orderItemId) as { instructions: string }
    assert.ok(entitlement)
    assert.equal(entitlement.instructions, 'Delivery: Server 3 License Key: ABC-123-XYZ')

    // 5. Verify business mail event was recorded
    const mailEvent = sql.prepare("SELECT kind, user_id FROM business_mail_events WHERE kind='order_delivered' AND user_id=?").get(customerId) as { kind: string; user_id: string }
    assert.ok(mailEvent)
    assert.equal(mailEvent.kind, 'order_delivered')

    // 6. Attempt second delivery on already delivered order -> must fail (409 Undelivered paid order required)
    const redeliverReq = new Request('https://logspoll.com/api/admin', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        action: 'deliver',
        id: paidOrderId,
        instructions: 'Duplicate delivery attempt',
      }),
    })
    await assert.rejects(() => adminOperations(redeliverReq, env), (err: { status: number }) => err.status === 409)
  } finally {
    sql.close()
  }
})
