import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import {
  getOrCreateWallet,
  getWalletOverview,
  initiateWalletFunding,
  reconcileWalletFundingAttempt,
  payOrderWithWallet,
  adminGetWallets,
  adminFreezeWallet,
  adminAdjustWallet,
  MIN_WALLET_FUND_MINOR,
  MAX_WALLET_FUND_MINOR,
} from '../workers/api/wallet.ts'
import { extractBachsBankTransferDetails } from '../server/bachs.ts'
import { bachsWebhook } from '../workers/api/bachs-webhook.ts'
import { apiFetch } from '../workers/api/index.ts'
import type { ApiEnv, Database, Statement } from '../workers/api/types.ts'

const customer = '11111111-1111-4111-8111-111111111111'
const customer2 = '22222222-2222-4222-8222-222222222222'
const admin = '99999999-9999-4999-8999-999999999999'
const product = '33333333-3333-4333-8333-333333333333'
const category = '44444444-4444-4444-8444-444444444444'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')

  const migrations = [
    '0001_staging_foundation.sql',
    '0002_cloudflare_auth.sql',
    '0009_auth_email_otp.sql',
    '0010_bachs_payment_foundation.sql',
    '0024_automatic_fulfillment.sql',
    '0025_structured_product_delivery.sql',
    '0026_customer_wallet_system.sql',
    '0027_wallet_admin_audit.sql',
    '0028_wallet_temporary_accounts.sql',
  ]
  for (const name of migrations) {
    sql.exec(readFileSync(new URL('../workers/api/migrations/' + name, import.meta.url), 'utf8'))
  }

  // Supporting tables and views for tests
  sql.exec(`
    CREATE TABLE IF NOT EXISTS business_mail_events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      queued_at INTEGER
    ) STRICT;
    CREATE TABLE IF NOT EXISTS product_authorizations (
      product_id TEXT PRIMARY KEY REFERENCES products(id),
      evidence TEXT
    ) STRICT;
    CREATE VIEW IF NOT EXISTS storefront_products AS
      SELECT id, category_id, slug, name, brand, description, price_minor, currency, delivery_type,
             image_path, term, features, supplier_image_urls, featured, available_quantity
      FROM staging_storefront_products;
  `)

  // Seed customer 1
  sql.prepare('INSERT INTO users(id) VALUES(?)').run(customer)
  sql.prepare('INSERT INTO profiles(id, full_name) VALUES(?, ?)').run(customer, 'Test Customer')
  sql.prepare("INSERT INTO user_roles(user_id, role) VALUES(?, 'customer')").run(customer)
  sql.prepare("INSERT INTO auth_user(id, name, email, emailVerified, createdAt, updatedAt) VALUES(?, 'Test Customer', 'customer@example.com', 1, '2026-01-01', '2026-01-01')").run(customer)

  // Seed customer 2
  sql.prepare('INSERT INTO users(id) VALUES(?)').run(customer2)
  sql.prepare('INSERT INTO profiles(id, full_name) VALUES(?, ?)').run(customer2, 'Second Customer')
  sql.prepare("INSERT INTO user_roles(user_id, role) VALUES(?, 'customer')").run(customer2)
  sql.prepare("INSERT INTO auth_user(id, name, email, emailVerified, createdAt, updatedAt) VALUES(?, 'Second Customer', 'customer2@example.com', 1, '2026-01-01', '2026-01-01')").run(customer2)

  // Seed admin
  sql.prepare('INSERT INTO users(id) VALUES(?)').run(admin)
  sql.prepare('INSERT INTO profiles(id, full_name) VALUES(?, ?)').run(admin, 'Admin User')
  sql.prepare("INSERT INTO user_roles(user_id, role) VALUES(?, 'admin')").run(admin)
  sql.prepare("INSERT INTO auth_user(id, name, email, emailVerified, createdAt, updatedAt) VALUES(?, 'Admin User', 'admin@logspoll.com', 1, '2026-01-01', '2026-01-01')").run(admin)

  // Seed catalog product
  sql.prepare('INSERT INTO categories(id, slug, name, short_name) VALUES(?, ?, ?, ?)').run(category, 'vpn', 'VPN Accounts', 'VPN')
  sql.prepare(`
    INSERT INTO products(id, category_id, slug, name, description, price_minor, currency, supplier_name, authorized_resale, status, publication_verified, delivery_type)
    VALUES(?, ?, 'pia-vpn', 'PIA VPN 1 Year Dedicated Account', 'High-speed verified VPN subscription.', 500000, 'NGN', 'YoungPG', 1, 'active', 1, 'Subscription activation')
  `).run(product, category)
  sql.prepare("INSERT INTO inventory(product_id, available_quantity, source_mode, verified_at) VALUES(?, 10, 'manual', strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run(product)

  const prepare = (query: string): Statement => {
    let args: (string | number | null)[] = []
    return {
      bind(...v) {
        args = v
        return this
      },
      async all<T>() {
        let results: T[] = []
        try {
          results = sql.prepare(query).all(...args) as T[]
        } catch {
          sql.prepare(query).run(...args)
        }
        const changes = Number((sql.prepare('SELECT changes() AS n').get() as { n: number })?.n ?? 0)
        return { success: true, results, meta: { changes, last_row_id: 0 } }
      },
      async first<T>() {
        return ((await this.all<T>()).results[0] ?? null) as T | null
      },
      async run() {
        return this.all()
      },
    }
  }

  const db: Database = {
    prepare,
    async batch(queries) {
      sql.exec('BEGIN')
      try {
        const results = []
        for (const q of queries) results.push(await q.run())
        sql.exec('COMMIT')
        return results
      } catch (e) {
        sql.exec('ROLLBACK')
        throw e
      }
    },
    async exec(q) {
      sql.exec(q)
    },
  }

  const env: ApiEnv = {
    ENVIRONMENT: 'staging',
    DB: db,
    BACHS_API_KEY: 'sk_sandbox_wallet_test_key_12345',
    BACHS_WEBHOOK_SECRET: 'test-wallet-webhook-secret-xyz',
    BACHS_SANDBOX_ENABLED: 'true',
    WALLET_LIVE_FUNDING_ENABLED: 'false',
    AUTO_FULFILLMENT_ENABLED: 'true',
    AUTH_SECRET: 'synthetic-secret-for-d1-wallet-test-only-minimum-32',
    AUTH_ORIGIN: 'https://test.example',
    AUTH_ENABLED: 'true',
    RESEND_API_KEY: 're_synthetic_key',
  }

  return { sql, env }
}

async function loginAdmin(sql: DatabaseSync, env: ApiEnv, email = 'admin-bot@logspoll.com') {
  const password = 'SyntheticAdminPass2026!'
  const signupReq = new Request('https://test.example/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://test.example', 'cf-connecting-ip': '192.0.2.1' },
    body: JSON.stringify({ name: 'Admin Bot', email, password }),
  })
  const signupRes = await apiFetch(signupReq, env)
  assert.equal(signupRes.status, 200, await signupRes.clone().text())
  sql.prepare('UPDATE auth_user SET "emailVerified"=1 WHERE email=?').run(email)
  const loginReq = new Request('https://test.example/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://test.example', 'cf-connecting-ip': '192.0.2.1' },
    body: JSON.stringify({ email, password }),
  })
  const loginRes = await apiFetch(loginReq, env)
  assert.equal(loginRes.status, 200, await loginRes.clone().text())
  const cookie = loginRes.headers.get('set-cookie')!.split(';')[0]
  const user = sql.prepare('SELECT id FROM auth_user WHERE email=?').get(email) as { id: string }
  sql.prepare('INSERT OR IGNORE INTO users(id) VALUES(?)').run(user.id)
  sql.prepare("INSERT INTO user_roles(user_id, role) VALUES(?, 'admin') ON CONFLICT(user_id) DO UPDATE SET role='admin'").run(user.id)
  return { cookie, adminId: user.id }
}

async function signedWebhookRequest(env: ApiEnv, rawPayload: string) {
  const stamp = Math.floor(Date.now() / 1000)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.BACHS_WEBHOOK_SECRET!),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = Buffer.from(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${stamp}.${rawPayload}`))
  ).toString('hex')

  return new Request('https://test.example/api/webhooks/bachs', {
    method: 'POST',
    body: rawPayload,
    headers: {
      'Content-Type': 'application/json',
      'X-Bachs-Signature-V2': `t=${stamp},v1=${signature}`,
    },
  })
}

// ============================================================================
// 1. AUTOMATIC CUSTOMER WALLET PROVISIONING & OVERVIEW
// ============================================================================

test('getOrCreateWallet provisions an active NGN wallet with 0.00 balance and prevents duplicates', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  // Provisions wallet for customer
  const wallet1 = await getOrCreateWallet(env.DB!, customer)
  assert.equal(wallet1.customer_id, customer)
  assert.equal(wallet1.currency, 'NGN')
  assert.equal(wallet1.balance_minor, 0)
  assert.equal(wallet1.status, 'active')

  // Calling again returns the exact same record without creating duplicates
  const wallet2 = await getOrCreateWallet(env.DB!, customer)
  assert.equal(wallet1.id, wallet2.id)

  const count = sql.prepare('SELECT count(*) AS n FROM wallets WHERE customer_id = ?').get(customer) as { n: number }
  assert.equal(count.n, 1)
})

test('getWalletOverview returns full financial status, transactions, limits, and unavailable virtual account status', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  const res = await getWalletOverview(env.DB!, customer)
  assert.equal(res.status, 200)
  const body = await res.json() as any

  assert.equal(body.wallet.balance_minor, 0)
  assert.equal(body.wallet.balance, 0)
  assert.equal(body.wallet.currency, 'NGN')
  assert.equal(body.wallet.status, 'active')
  assert.deepEqual(body.transactions, [])
  assert.deepEqual(body.pending_deposits, [])
  assert.equal(body.virtual_account.status, 'UNVERIFIED')
  assert.match(body.virtual_account.reason, /not been verified/i)
  assert.equal(body.deposit_limits.min_ngn, 100)
  assert.equal(body.deposit_limits.max_ngn, 1000000)
})

// ============================================================================
// 2. WALLET FUNDING INITIATION & SAFETY GUARDS
// ============================================================================

test('initiateWalletFunding validates deposit bounds (min NGN 100, max NGN 1,000,000)', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  const user = { id: customer, email: 'customer@example.com' }

  // Below minimum (< ₦100)
  const reqBelow = new Request('https://test.example/api/wallet/fund', {
    method: 'POST',
    body: JSON.stringify({ amount: 50 }),
  })
  await assert.rejects(initiateWalletFunding(reqBelow, env, user), /Minimum wallet deposit is ₦100\.00/)

  // Above maximum (> ₦1,000,000)
  const reqAbove = new Request('https://test.example/api/wallet/fund', {
    method: 'POST',
    body: JSON.stringify({ amount: 2000000 }),
  })
  await assert.rejects(initiateWalletFunding(reqAbove, env, user), /Maximum wallet deposit is ₦1,000,000\.00/)

  // Negative / Invalid amount
  const reqNeg = new Request('https://test.example/api/wallet/fund', {
    method: 'POST',
    body: JSON.stringify({ amount: -500 }),
  })
  await assert.rejects(initiateWalletFunding(reqNeg, env, user), /at most two decimal places/)
})

test('live wallet deposits remain gated behind WALLET_LIVE_FUNDING_ENABLED safeguard', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  // Configure live key with live deposits disabled (default safeguard)
  env.ENVIRONMENT = 'production'
  env.BACHS_API_KEY = 'sk_live_merchant_production_key_12345'
  env.WALLET_LIVE_FUNDING_ENABLED = 'false'

  const user = { id: customer, email: 'customer@example.com' }
  const req = new Request('https://test.example/api/wallet/fund', {
    method: 'POST',
    body: JSON.stringify({ amount: 5000 }),
  })

  await assert.rejects(
    initiateWalletFunding(req, env, user),
    /Live wallet deposits are temporarily disabled while merchant account approval/
  )
})

test('initiateWalletFunding creates a valid standalone funding attempt in sandbox mode', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      checkout_id: 'chk_wf_sandbox_12345',
      checkout_url: 'https://sandbox-checkout.bachs.io/c/wf_test',
    })
  )

  const user = { id: customer, email: 'customer@example.com' }
  const req = new Request('https://test.example/api/wallet/fund', {
    method: 'POST',
    body: JSON.stringify({ amount: 10000 }),
  })

  const res = await initiateWalletFunding(req, env, user)
  assert.equal(res.status, 200)
  const body = await res.json() as any

  assert.equal(body.ok, true)
  assert.equal(body.amountMinor, 1000000) // ₦10,000.00
  assert.equal(body.creditedMinor, 1000000)
  assert.equal(body.checkoutId, 'chk_wf_sandbox_12345')
  assert.equal(body.checkoutUrl, 'https://sandbox-checkout.bachs.io/c/wf_test')
  assert.match(body.reference, /^WF-/)

  const attempt = sql.prepare('SELECT * FROM wallet_funding_attempts WHERE id = ?').get(body.attemptId) as any
  assert.equal(attempt.status, 'open')
  assert.equal(attempt.checkout_id, 'chk_wf_sandbox_12345')
  assert.equal(attempt.amount_minor, 1000000)
})

// ============================================================================
// 3. BACHS WEBHOOK & RECONCILIATION IDEMPOTENCY
// ============================================================================

test('signed Bachs webhook reconciles wallet funding attempt, credits balance, and is strictly idempotent', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  const wallet = await getOrCreateWallet(env.DB!, customer)
  const attemptId = '44444444-4444-4444-8444-444444444444'
  const checkoutId = 'chk_wf_webhook_12345'
  const reference = 'WF-TEST-DEPOSIT-01'

  sql.prepare(`
    INSERT INTO wallet_funding_attempts (id, customer_id, wallet_id, reference, checkout_id, provider_mode, amount_minor, fee_minor, credited_minor, idempotency_key, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'sandbox', 250000, 0, 250000, 'idemp_wf_1', 'open', 1, 1)
  `).run(attemptId, customer, wallet.id, reference, checkoutId)

  const bachsPaidSession = {
    checkout_id: checkoutId,
    reference: attemptId,
    amount: '2500.00',
    currency: 'NGN',
    status: 'completed',
    payment_status: 'succeeded',
    charge: { status: 'succeeded' },
    session_mode: null,
    products: null,
    recurring: null,
    source_type: 'API',
    metadata: { order_id: attemptId },
  }

  t.mock.method(globalThis, 'fetch', async () => Response.json(bachsPaidSession))

  const rawEvent = JSON.stringify({
    id: 'evt_wf_12345678',
    type: 'checkout.completed',
    data: { checkout_id: checkoutId },
  })

  // 1. First webhook delivery
  const req1 = await signedWebhookRequest(env, rawEvent)
  const res1 = await bachsWebhook(req1, env)
  assert.equal(res1.status, 200)

  // Verify wallet credited
  const updatedWallet = sql.prepare('SELECT balance_minor FROM wallets WHERE id = ?').get(wallet.id) as any
  assert.equal(updatedWallet.balance_minor, 250000) // ₦2,500.00

  // Verify funding attempt marked paid
  const updatedAttempt = sql.prepare('SELECT status FROM wallet_funding_attempts WHERE id = ?').get(attemptId) as any
  assert.equal(updatedAttempt.status, 'paid')

  // Verify append-only ledger transaction created
  const tx = sql.prepare('SELECT * FROM wallet_transactions WHERE funding_attempt_id = ?').get(attemptId) as any
  assert.ok(tx)
  assert.equal(tx.type, 'funding')
  assert.equal(tx.direction, 'credit')
  assert.equal(tx.amount_minor, 250000)
  assert.equal(tx.balance_before_minor, 0)
  assert.equal(tx.balance_after_minor, 250000)
  assert.equal(tx.status, 'completed')

  // 2. Duplicate webhook delivery — IDEMPOTENCY TEST
  const req2 = await signedWebhookRequest(env, rawEvent)
  const res2 = await bachsWebhook(req2, env)
  assert.equal(res2.status, 200)
  const body2 = await res2.json() as any
  assert.equal(body2.duplicate, true)

  // Wallet balance must NOT be double-credited!
  const walletAfterDuplicate = sql.prepare('SELECT balance_minor FROM wallets WHERE id = ?').get(wallet.id) as any
  assert.equal(walletAfterDuplicate.balance_minor, 250000)

  // Only 1 ledger record must exist
  const txCount = sql.prepare('SELECT count(*) AS n FROM wallet_transactions WHERE funding_attempt_id = ?').get(attemptId) as any
  assert.equal(txCount.n, 1)
})

// ============================================================================
// 4. PAY WITH WALLET ORDER CHECKOUT & CONCURRENT OVERSPEND GUARDS
// ============================================================================

test('payOrderWithWallet rejects insufficient balance with 400 and preserves wallet balance', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  // Customer has ₦1,000.00 balance
  const wallet = await getOrCreateWallet(env.DB!, customer)
  sql.prepare('UPDATE wallets SET balance_minor = 100000 WHERE id = ?').run(wallet.id)

  const user = { id: customer, email: 'customer@example.com' }
  // Product price is ₦5,000.00 (500,000 kobo)
  const req = new Request('https://test.example/api/wallet/pay-order', {
    method: 'POST',
    body: JSON.stringify({
      requestId: crypto.randomUUID(),
      items: [{ id: product, quantity: 1 }],
    }),
  })

  await assert.rejects(
    payOrderWithWallet(req, env, user),
    /Insufficient wallet balance/
  )

  // Balance remains untouched
  const walletAfter = sql.prepare('SELECT balance_minor FROM wallets WHERE id = ?').get(wallet.id) as any
  assert.equal(walletAfter.balance_minor, 100000)

  // No order created
  const orderCount = sql.prepare('SELECT count(*) AS n FROM orders WHERE customer_id = ?').get(customer) as any
  assert.equal(orderCount.n, 0)
})

test('payOrderWithWallet executes atomic balance debit, creates paid order, and queues fulfillment', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  // Credit customer with ₦15,000.00 (1,500,000 kobo)
  const wallet = await getOrCreateWallet(env.DB!, customer)
  sql.prepare('UPDATE wallets SET balance_minor = 1500000 WHERE id = ?').run(wallet.id)

  const user = { id: customer, email: 'customer@example.com' }
  const reqId = crypto.randomUUID()

  // Buy 2 PIA VPNs (2 * ₦5,000 = ₦10,000)
  const req = new Request('https://test.example/api/wallet/pay-order', {
    method: 'POST',
    body: JSON.stringify({
      requestId: reqId,
      items: [{ id: product, quantity: 2 }],
    }),
  })

  const res = await payOrderWithWallet(req, env, user)
  assert.equal(res.status, 201)
  const body = await res.json() as any

  assert.equal(body.ok, true)
  assert.equal(body.totalMinor, 1000000) // ₦10,000.00
  assert.equal(body.balanceAfterMinor, 500000) // ₦5,000.00 remaining
  assert.equal(body.paymentMethod, 'wallet')

  // Verify wallet balance in D1
  const walletRow = sql.prepare('SELECT balance_minor FROM wallets WHERE id = ?').get(wallet.id) as any
  assert.equal(walletRow.balance_minor, 500000)

  // Verify order in D1
  const orderRow = sql.prepare('SELECT * FROM orders WHERE id = ?').get(body.orderId) as any
  assert.equal(orderRow.payment_status, 'paid')
  assert.equal(orderRow.payment_method, 'wallet')
  assert.equal(orderRow.total_minor, 1000000)

  // Verify order items in D1
  const items = sql.prepare('SELECT * FROM order_items WHERE order_id = ?').all(body.orderId) as any[]
  assert.equal(items.length, 1)
  assert.equal(items[0].quantity, 2)

  // Verify wallet transaction ledger record
  const tx = sql.prepare('SELECT * FROM wallet_transactions WHERE order_id = ?').get(body.orderId) as any
  assert.ok(tx)
  assert.equal(tx.type, 'purchase')
  assert.equal(tx.direction, 'debit')
  assert.equal(tx.amount_minor, 1000000)
  assert.equal(tx.balance_before_minor, 1500000)
  assert.equal(tx.balance_after_minor, 500000)
  assert.equal(tx.status, 'completed')

  // Verify automated fulfillment jobs queued
  const jobs = sql.prepare('SELECT * FROM fulfillment_jobs WHERE order_id = ?').all(body.orderId) as any[]
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].order_item_id, items[0].id)
})

test('SQLite CHECK constraint strictly prevents negative balance under all conditions', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  const wallet = await getOrCreateWallet(env.DB!, customer)
  sql.prepare('UPDATE wallets SET balance_minor = 1000 WHERE id = ?').run(wallet.id)

  // Attempting direct SQL update that would produce negative balance fails with CHECK constraint violation
  assert.throws(
    () => sql.prepare('UPDATE wallets SET balance_minor = -50 WHERE id = ?').run(wallet.id),
    /CHECK constraint failed/
  )

  // Balance remains at 1000
  const check = sql.prepare('SELECT balance_minor FROM wallets WHERE id = ?').get(wallet.id) as any
  assert.equal(check.balance_minor, 1000)
})

test('frozen wallet cannot initiate funding or pay for orders', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  const wallet = await getOrCreateWallet(env.DB!, customer)
  sql.prepare("UPDATE wallets SET balance_minor = 1000000, status = 'frozen' WHERE id = ?").run(wallet.id)

  const user = { id: customer, email: 'customer@example.com' }

  // Funding rejected
  const fundReq = new Request('https://test.example/api/wallet/fund', {
    method: 'POST',
    body: JSON.stringify({ amount: 1000 }),
  })
  await assert.rejects(initiateWalletFunding(fundReq, env, user), /wallet is currently frozen/i)

  // Order checkout rejected
  const orderReq = new Request('https://test.example/api/wallet/pay-order', {
    method: 'POST',
    body: JSON.stringify({
      requestId: crypto.randomUUID(),
      items: [{ id: product, quantity: 1 }],
    }),
  })
  await assert.rejects(payOrderWithWallet(orderReq, env, user), /wallet is currently frozen/i)
})

// ============================================================================
// 5. ADMIN WALLET MANAGEMENT & AUDITED ADJUSTMENTS
// ============================================================================

test('adminGetWallets computes total system liabilities and searches customers', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  // Credit customer 1: ₦10,000
  const w1 = await getOrCreateWallet(env.DB!, customer)
  sql.prepare('UPDATE wallets SET balance_minor = 1000000 WHERE id = ?').run(w1.id)

  // Credit customer 2: ₦5,000
  const w2 = await getOrCreateWallet(env.DB!, customer2)
  sql.prepare('UPDATE wallets SET balance_minor = 500000 WHERE id = ?').run(w2.id)

  const { cookie } = await loginAdmin(sql, env, 'admin-wallets-test@logspoll.com')
  const adminHeaders = new Headers({
    Origin: 'https://test.example',
    Cookie: cookie,
    'cf-connecting-ip': '192.0.2.1',
  })

  const req = new Request('https://test.example/api/admin/wallets?q=customer2', { headers: adminHeaders })
  const res = await adminGetWallets(req, env)
  assert.equal(res.status, 200)
  const data = await res.json() as any

  // Total liabilities across system = ₦10,000 + ₦5,000 = ₦15,000.00 (1,500,000 kobo)
  assert.equal(data.stats.total_liabilities_minor, 1500000)
  assert.equal(data.stats.total_liabilities, 15000)
  assert.equal(data.stats.total_wallets, 2)

  // Search filtered by 'customer2'
  assert.equal(data.wallets.length, 1)
  assert.equal(data.wallets[0].customer_id, customer2)
  assert.equal(data.wallets[0].balance, 5000)
})

test('adminFreezeWallet freezes/unfreezes customer wallet with mandatory audit justification', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  const wallet = await getOrCreateWallet(env.DB!, customer)
  const { cookie } = await loginAdmin(sql, env, 'admin-freeze-test@logspoll.com')
  const headers = {
    Origin: 'https://test.example',
    Cookie: cookie,
    'Content-Type': 'application/json',
    'cf-connecting-ip': '192.0.2.1',
  }

  // Rejects freeze without justification
  const badReq = new Request('https://test.example/api/admin/wallets/freeze', {
    method: 'POST',
    headers,
    body: JSON.stringify({ customerId: customer, freeze: true, reason: 'bad' }), // < 5 chars
  })
  await assert.rejects(adminFreezeWallet(badReq, env), /detailed justification reason/i)

  // Successfully freeze wallet
  const freezeReq = new Request('https://test.example/api/admin/wallets/freeze', {
    method: 'POST',
    headers,
    body: JSON.stringify({ customerId: customer, freeze: true, reason: 'Security hold: chargeback review' }),
  })
  const freezeRes = await adminFreezeWallet(freezeReq, env)
  assert.equal(freezeRes.status, 200)

  const frozen = sql.prepare('SELECT status FROM wallets WHERE id = ?').get(wallet.id) as any
  assert.equal(frozen.status, 'frozen')

  // Verify audit log entry created
  const audit = sql.prepare("SELECT * FROM audit_logs WHERE table_name = 'wallets' ORDER BY created_at DESC LIMIT 1").get() as any
  assert.ok(audit)
  assert.equal(audit.action, 'UPDATE')

  // Unfreeze wallet
  const unfreezeReq = new Request('https://test.example/api/admin/wallets/freeze', {
    method: 'POST',
    headers,
    body: JSON.stringify({ customerId: customer, freeze: false, reason: 'Security check cleared by compliance' }),
  })
  const unfreezeRes = await adminFreezeWallet(unfreezeReq, env)
  assert.equal(unfreezeRes.status, 200)

  const active = sql.prepare('SELECT status FROM wallets WHERE id = ?').get(wallet.id) as any
  assert.equal(active.status, 'active')
})

test('adminAdjustWallet allows authorized manual credit and debit with ledger and audit trail', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  const wallet = await getOrCreateWallet(env.DB!, customer)
  const { cookie } = await loginAdmin(sql, env, 'admin-adjust-test@logspoll.com')
  const headers = {
    Origin: 'https://test.example',
    Cookie: cookie,
    'Content-Type': 'application/json',
    'cf-connecting-ip': '192.0.2.1',
  }

  // 1. Manual credit of ₦2,000 (200,000 kobo)
  const creditReq = new Request('https://test.example/api/admin/wallets/adjust', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      customerId: customer,
      direction: 'credit',
      amountMinor: 200000,
      reason: 'Promotional loyalty credit reward',
    }),
  })
  const creditRes = await adminAdjustWallet(creditReq, env)
  assert.equal(creditRes.status, 200)
  const creditBody = await creditRes.json() as any
  assert.equal(creditBody.balanceAfterMinor, 200000)

  // 2. Debit exceeding balance fails
  const overDebitReq = new Request('https://test.example/api/admin/wallets/adjust', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      customerId: customer,
      direction: 'debit',
      amountMinor: 500000, // Available is only 200,000
      reason: 'Penalty deduction attempt',
    }),
  })
  await assert.rejects(adminAdjustWallet(overDebitReq, env), /Cannot debit more than available balance/)

  // 3. Authorized debit of ₦500 (50,000 kobo)
  const debitReq = new Request('https://test.example/api/admin/wallets/adjust', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      customerId: customer,
      direction: 'debit',
      amountMinor: 50000,
      reason: 'Dispute correction deduction',
    }),
  })
  const debitRes = await adminAdjustWallet(debitReq, env)
  assert.equal(debitRes.status, 200)
  const debitBody = await debitRes.json() as any
  assert.equal(debitBody.balanceAfterMinor, 150000) // ₦1,500 remaining

  // Verify wallet transactions ledger has both adjustment entries
  const txs = sql.prepare("SELECT * FROM wallet_transactions WHERE type = 'admin_adjustment' ORDER BY created_at ASC").all() as any[]
  assert.equal(txs.length, 2)
  assert.equal(txs[0].direction, 'credit')
  assert.equal(txs[0].amount_minor, 200000)
  assert.equal(txs[1].direction, 'debit')
  assert.equal(txs[1].amount_minor, 50000)

  // Verify audit logs
  const auditLogs = sql.prepare("SELECT * FROM audit_logs WHERE table_name = 'wallets' ORDER BY created_at ASC").all() as any[]
  assert.equal(auditLogs.length, 2)
  assert.equal(auditLogs[0].action, 'UPDATE')
  assert.equal(auditLogs[1].action, 'UPDATE')
})

function fundingFixture(sql: DatabaseSync, walletId: string) {
  const id = crypto.randomUUID(), checkout = 'chk_wallet_integrity_test'
  sql.prepare(`INSERT INTO wallet_funding_attempts(id,customer_id,wallet_id,reference,checkout_id,provider_mode,amount_minor,fee_minor,credited_minor,idempotency_key,status,created_at,updated_at) VALUES(?,?,?,? ,?,'sandbox',10000,0,10000,?,'open',?,?)`).run(id,customer,walletId,'WF-'+id,checkout,'wf_'+id,Date.now(),Date.now())
  return {
    attempt: sql.prepare('SELECT * FROM wallet_funding_attempts WHERE id=?').get(id) as unknown as import('../workers/api/wallet.ts').FundingAttemptRecord,
    session: {checkout_id:checkout,reference:id,currency:'NGN',amount:'100.00',status:'completed',payment_status:'succeeded',source_type:'API',session_mode:null,products:null,recurring:null,metadata:{order_id:id},charge:{status:'succeeded'}},
  }
}

const walletRequest = (requestId = crypto.randomUUID(), quantity = 1) => new Request('https://test.example/api/wallet/pay-order', {method:'POST',body:JSON.stringify({requestId,items:[{id:product,quantity}]})})

test('production rejects sandbox funding credits without touching balances', async t => {
  const {sql,env}=fixture();t.after(()=>sql.close())
  const wallet=await getOrCreateWallet(env.DB!,customer), {attempt,session}=fundingFixture(sql,wallet.id)
  env.ENVIRONMENT='production'
  await assert.rejects(reconcileWalletFundingAttempt(env,attempt,'','',session),/environment/)
  assert.equal((sql.prepare('SELECT balance_minor FROM wallets WHERE id=?').get(wallet.id) as {balance_minor:number}).balance_minor,0)
  assert.equal((sql.prepare('SELECT status FROM wallet_funding_attempts WHERE id=?').get(attempt.id) as {status:string}).status,'open')
})

test('failed funding batch stays recoverable and retry credits exactly once', async t => {
  const {sql,env}=fixture();t.after(()=>sql.close())
  t.mock.method(globalThis,'fetch',async()=>Response.json({data:[]}))
  const wallet=await getOrCreateWallet(env.DB!,customer), {attempt,session}=fundingFixture(sql,wallet.id)
  sql.exec("CREATE TRIGGER fail_credit BEFORE INSERT ON wallet_transactions BEGIN SELECT RAISE(ABORT,'injected storage failure'); END;")
  await assert.rejects(reconcileWalletFundingAttempt(env,attempt,'','',session),/recoverable/)
  assert.equal((sql.prepare('SELECT status FROM wallet_funding_attempts WHERE id=?').get(attempt.id) as {status:string}).status,'open')
  assert.equal((sql.prepare('SELECT balance_minor FROM wallets WHERE id=?').get(wallet.id) as {balance_minor:number}).balance_minor,0)
  sql.exec('DROP TRIGGER fail_credit')
  await reconcileWalletFundingAttempt(env,attempt,'','',session)
  await reconcileWalletFundingAttempt(env,attempt,'','',session)
  assert.equal((sql.prepare('SELECT balance_minor FROM wallets WHERE id=?').get(wallet.id) as {balance_minor:number}).balance_minor,10000)
  assert.equal((sql.prepare('SELECT count(*) n FROM wallet_transactions').get() as {n:number}).n,1)
})

test('wallet order retry returns original paid order and rejects changed cart',async t=>{
  const {sql,env}=fixture();t.after(()=>sql.close());env.AUTO_FULFILLMENT_ENABLED='false'
  const wallet=await getOrCreateWallet(env.DB!,customer)
  sql.prepare('UPDATE wallets SET balance_minor=500000 WHERE id=?').run(wallet.id)
  const requestId=crypto.randomUUID()
  const first=await (await payOrderWithWallet(walletRequest(requestId),env,{id:customer,email:'customer@example.com'})).json() as {orderId:string}
  const second=await (await payOrderWithWallet(walletRequest(requestId),env,{id:customer,email:'customer@example.com'})).json() as {orderId:string}
  assert.equal(first.orderId,second.orderId)
  await assert.rejects(payOrderWithWallet(walletRequest(requestId,2),env,{id:customer,email:'customer@example.com'}),/does not match/)
  assert.equal((sql.prepare('SELECT count(*) n FROM orders').get() as {n:number}).n,1)
})

test('concurrent balance change cannot create a paid wallet order or ledger entry',async t=>{
  const {sql,env}=fixture();t.after(()=>sql.close());env.AUTO_FULFILLMENT_ENABLED='false'
  const wallet=await getOrCreateWallet(env.DB!,customer)
  sql.prepare('UPDATE wallets SET balance_minor=1000000 WHERE id=?').run(wallet.id)
  const batch=env.DB!.batch.bind(env.DB!)
  env.DB!.batch=async statements=>{sql.prepare('UPDATE wallets SET balance_minor=400000 WHERE id=?').run(wallet.id);return batch(statements)}
  await assert.rejects(payOrderWithWallet(walletRequest(),env,{id:customer,email:'customer@example.com'}),/concurrent/)
  assert.equal((sql.prepare('SELECT count(*) n FROM orders').get() as {n:number}).n,0)
  assert.equal((sql.prepare('SELECT count(*) n FROM wallet_transactions').get() as {n:number}).n,0)
  assert.equal((sql.prepare('SELECT balance_minor FROM wallets WHERE id=?').get(wallet.id) as {balance_minor:number}).balance_minor,400000)
})

test('wallet checkout reserves stock against later wallet orders without touching supplier quantities',async t=>{
  const {sql,env}=fixture();t.after(()=>sql.close());env.AUTO_FULFILLMENT_ENABLED='false'
  const wallet=await getOrCreateWallet(env.DB!,customer)
  sql.prepare('UPDATE wallets SET balance_minor=1000000 WHERE id=?').run(wallet.id)
  sql.prepare('UPDATE inventory SET available_quantity=1 WHERE product_id=?').run(product)
  await payOrderWithWallet(walletRequest(),env,{id:customer,email:'customer@example.com'})
  await assert.rejects(payOrderWithWallet(walletRequest(),env,{id:customer,email:'customer@example.com'}),/stock movement/)
  assert.equal((sql.prepare('SELECT available_quantity q FROM inventory WHERE product_id=?').get(product) as {q:number}).q,1)
  assert.equal((sql.prepare('SELECT count(*) n FROM orders').get() as {n:number}).n,1)
})

test('unconfirmed charge and refund never create wallet credit',async t=>{
  const {sql,env}=fixture();t.after(()=>sql.close())
  const wallet=await getOrCreateWallet(env.DB!,customer),{attempt,session}=fundingFixture(sql,wallet.id)
  await reconcileWalletFundingAttempt(env,attempt,'','',{...session,charge:{status:'pending'}})
  assert.equal((sql.prepare('SELECT count(*) n FROM wallet_transactions').get() as {n:number}).n,0)
  const result=await reconcileWalletFundingAttempt(env,attempt,'','refund.paid',session)
  assert.equal(result.status,'needs_review')
  assert.equal((sql.prepare('SELECT status FROM wallets WHERE id=?').get(wallet.id) as {status:string}).status,'frozen')
  assert.equal((sql.prepare('SELECT count(*) n FROM wallet_transactions').get() as {n:number}).n,0)
})

// ============================================================================
// 8. TEMPORARY BANK ACCOUNTS, EXPIRY CLEARING & LIVE FUNDING LIFECYCLE
// ============================================================================

test('initiateWalletFunding saves temporary bank details and getWalletOverview exposes them for open attempts', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  const wallet = await getOrCreateWallet(env.DB!, customer)
  const attemptId = crypto.randomUUID()
  const reference = 'WF-TEST-TEMP-001'
  const bankDetails = JSON.stringify({
    bankName: 'Providus Bank',
    accountNumber: '9928374650',
    accountName: 'LogsPoll - John Doe',
    expiresAt: Date.now() + 1800000,
  })

  // Insert an open funding attempt with temporary bank details
  sql.prepare(`
    INSERT INTO wallet_funding_attempts (
      id, customer_id, wallet_id, reference, checkout_id, provider_mode,
      amount_minor, fee_minor, credited_minor, idempotency_key, status, bank_details, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'chk_temp_bank_01', 'sandbox', 200000, 0, 200000, 'wf_temp_01', 'open', ?, ?, ?)
  `).run(attemptId, customer, wallet.id, reference, bankDetails, Date.now(), Date.now())

  // Verify getWalletOverview parses and returns the bank details
  const overviewRes = await getWalletOverview(env.DB!, customer, env)
  assert.equal(overviewRes.status, 200)
  const body = await overviewRes.json() as any
  assert.equal(body.pending_deposits.length, 1)
  assert.equal(body.pending_deposits[0].reference, reference)
  assert.equal(body.pending_deposits[0].amount, 2000)
  assert.ok(body.pending_deposits[0].bankTransfer)
  assert.equal(body.pending_deposits[0].bankTransfer.bankName, 'Providus Bank')
  assert.equal(body.pending_deposits[0].bankTransfer.accountNumber, '9928374650')
  assert.equal(body.pending_deposits[0].bankTransfer.accountName, 'LogsPoll - John Doe')
})

test('reconcileWalletFundingAttempt clears bank_details on payment completion', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  const wallet = await getOrCreateWallet(env.DB!, customer)
  const attemptId = crypto.randomUUID()
  const checkoutId = 'chk_temp_reconcile_paid'
  const bankDetails = JSON.stringify({
    bankName: 'Providus Bank',
    accountNumber: '9928374650',
    accountName: 'LogsPoll - John Doe',
  })

  sql.prepare(`
    INSERT INTO wallet_funding_attempts (
      id, customer_id, wallet_id, reference, checkout_id, provider_mode,
      amount_minor, fee_minor, credited_minor, idempotency_key, status, bank_details, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'sandbox', 100000, 0, 100000, 'wf_rec_01', 'open', ?, ?, ?)
  `).run(attemptId, customer, wallet.id, 'WF-REC-01', checkoutId, bankDetails, Date.now(), Date.now())

  const attempt = sql.prepare('SELECT * FROM wallet_funding_attempts WHERE id=?').get(attemptId) as any

  const session = {
    checkout_id: checkoutId,
    reference: attemptId,
    currency: 'NGN',
    amount: '1000.00',
    status: 'completed',
    payment_status: 'succeeded',
    source_type: 'API',
    session_mode: null,
    products: null,
    recurring: null,
    metadata: { order_id: attemptId },
    charge: { status: 'succeeded' },
  }

  // Reconcile as paid
  const res = await reconcileWalletFundingAttempt(env, attempt, '', '', session)
  assert.equal(res.status, 'paid')

  // Verify bank_details is cleared (NULL) upon successful payment
  const updated = sql.prepare('SELECT status, bank_details FROM wallet_funding_attempts WHERE id=?').get(attemptId) as any
  assert.equal(updated.status, 'paid')
  assert.equal(updated.bank_details, null)

  // Verify wallet is credited
  const updatedWallet = sql.prepare('SELECT balance_minor FROM wallets WHERE id=?').get(wallet.id) as any
  assert.equal(updatedWallet.balance_minor, 100000)

  // Verify getWalletOverview has 0 pending deposits now
  const overview = await (await getWalletOverview(env.DB!, customer, env)).json() as any
  assert.equal(overview.pending_deposits.length, 0)
  assert.equal(overview.wallet.balance_minor, 100000)
})

test('reconcileWalletFundingAttempt clears bank_details on session expiry or cancellation', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  const wallet = await getOrCreateWallet(env.DB!, customer)
  const attemptId = crypto.randomUUID()
  const checkoutId = 'chk_temp_expired'
  const bankDetails = JSON.stringify({
    bankName: 'Providus Bank',
    accountNumber: '9928374650',
    accountName: 'LogsPoll - John Doe',
  })

  sql.prepare(`
    INSERT INTO wallet_funding_attempts (
      id, customer_id, wallet_id, reference, checkout_id, provider_mode,
      amount_minor, fee_minor, credited_minor, idempotency_key, status, bank_details, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'sandbox', 50000, 0, 50000, 'wf_exp_01', 'open', ?, ?, ?)
  `).run(attemptId, customer, wallet.id, 'WF-EXP-01', checkoutId, bankDetails, Date.now(), Date.now())

  const attempt = sql.prepare('SELECT * FROM wallet_funding_attempts WHERE id=?').get(attemptId) as any

  const session = {
    checkout_id: checkoutId,
    reference: attemptId,
    currency: 'NGN',
    amount: '500.00',
    status: 'expired',
    payment_status: 'failed',
    source_type: 'API',
    session_mode: null,
    products: null,
    recurring: null,
    metadata: { order_id: attemptId },
  }

  // Reconcile terminal expired session
  const res = await reconcileWalletFundingAttempt(env, attempt, '', '', session)
  assert.equal(res.status, 'failed')

  // Verify bank_details is cleared (NULL)
  const updated = sql.prepare('SELECT status, bank_details FROM wallet_funding_attempts WHERE id=?').get(attemptId) as any
  assert.equal(updated.status, 'failed')
  assert.equal(updated.bank_details, null)

  // Wallet balance remains 0
  const updatedWallet = sql.prepare('SELECT balance_minor FROM wallets WHERE id=?').get(wallet.id) as any
  assert.equal(updatedWallet.balance_minor, 0)
})

test('customer funds wallet and then purchases digital product with atomic debit', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())
  env.AUTO_FULFILLMENT_ENABLED = 'false'

  // 1. Initial wallet state: ₦0.00
  const wallet = await getOrCreateWallet(env.DB!, customer)
  assert.equal(wallet.balance_minor, 0)

  // 2. Fund wallet with ₦5,000 (500,000 kobo)
  const attemptId = crypto.randomUUID()
  const checkoutId = 'chk_deposit_then_buy'
  sql.prepare(`
    INSERT INTO wallet_funding_attempts (
      id, customer_id, wallet_id, reference, checkout_id, provider_mode,
      amount_minor, fee_minor, credited_minor, idempotency_key, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'sandbox', 500000, 0, 500000, 'wf_dtb_01', 'open', ?, ?)
  `).run(attemptId, customer, wallet.id, 'WF-DTB-01', checkoutId, Date.now(), Date.now())

  const attempt = sql.prepare('SELECT * FROM wallet_funding_attempts WHERE id=?').get(attemptId) as any
  const session = {
    checkout_id: checkoutId,
    reference: attemptId,
    currency: 'NGN',
    amount: '5000.00',
    status: 'completed',
    payment_status: 'succeeded',
    source_type: 'API',
    session_mode: null,
    products: null,
    recurring: null,
    metadata: { order_id: attemptId },
    charge: { status: 'succeeded' },
  }
  await reconcileWalletFundingAttempt(env, attempt, '', '', session)

  // Balance is now ₦5,000
  const fundedWallet = sql.prepare('SELECT balance_minor FROM wallets WHERE id=?').get(wallet.id) as any
  assert.equal(fundedWallet.balance_minor, 500000)

  // 3. Purchase PIA VPN product priced at ₦5,000 (500,000 kobo)
  const orderReq = new Request('https://test.example/api/wallet/pay-order', {
    method: 'POST',
    body: JSON.stringify({
      requestId: crypto.randomUUID(),
      items: [{ id: product, quantity: 1 }],
    }),
  })

  const orderRes = await payOrderWithWallet(orderReq, env, { id: customer, email: 'customer@example.com' })
  assert.equal(orderRes.status, 201)
  const orderData = await orderRes.json() as any
  assert.equal(orderData.totalMinor, 500000)
  assert.equal(orderData.balanceAfterMinor, 0)
  assert.equal(orderData.paymentMethod, 'wallet')

  // Verify wallet balance is now ₦0.00
  const afterWallet = sql.prepare('SELECT balance_minor FROM wallets WHERE id=?').get(wallet.id) as any
  assert.equal(afterWallet.balance_minor, 0)

  // Verify order in database is marked paid
  const savedOrder = sql.prepare('SELECT payment_status, payment_method, total_minor FROM orders WHERE id=?').get(orderData.orderId) as any
  assert.equal(savedOrder.payment_status, 'paid')
  assert.equal(savedOrder.payment_method, 'wallet')
  assert.equal(savedOrder.total_minor, 500000)

  // Verify both funding and purchase transactions exist in ledger
  const txs = sql.prepare('SELECT type, direction, amount_minor, balance_after_minor FROM wallet_transactions WHERE wallet_id=? ORDER BY created_at ASC').all(wallet.id) as any[]
  assert.equal(txs.length, 2)
  assert.equal(txs[0].type, 'funding')
  assert.equal(txs[0].direction, 'credit')
  assert.equal(txs[0].amount_minor, 500000)
  assert.equal(txs[0].balance_after_minor, 500000)
  assert.equal(txs[1].type, 'purchase')
  assert.equal(txs[1].direction, 'debit')
  assert.equal(txs[1].amount_minor, 500000)
  assert.equal(txs[1].balance_after_minor, 0)
})

test('live wallet funding is enabled when WALLET_LIVE_FUNDING_ENABLED is true and live key configured', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  env.ENVIRONMENT = 'production'
  env.BACHS_API_KEY = 'sk_live_fintech_production_key_abcdef123456'
  env.BACHS_SANDBOX_ENABLED = 'false'
  env.WALLET_LIVE_FUNDING_ENABLED = 'true'

  const overview = await (await getWalletOverview(env.DB!, customer, env)).json() as any
  assert.equal(overview.funding.enabled, true)
  assert.equal(overview.funding.mode, 'live')
  assert.match(overview.funding.reason, /live online checkout/i)
})

test('extractBachsBankTransferDetails strictly avoids fabricating bank or account names', () => {
  // Missing bank name -> returns null (never fabricates "Bachs Settlement Bank")
  const missingBank = extractBachsBankTransferDetails({
    bank_transfer: { account_number: '1234567890' }
  })
  assert.equal(missingBank, null)

  // Missing account number -> returns null
  const missingAccount = extractBachsBankTransferDetails({
    bank_transfer: { bank_name: 'Guaranty Trust Bank' }
  })
  assert.equal(missingAccount, null)

  // Bank name and account number present, no account name -> returns verified fields, no fabricated account name
  const validNoName = extractBachsBankTransferDetails({
    bank_transfer: {
      account_number: '0123456789',
      bank_name: 'Wema Bank'
    }
  })
  assert.ok(validNoName)
  assert.equal(validNoName.bankName, 'Wema Bank')
  assert.equal(validNoName.accountNumber, '0123456789')
  assert.equal(validNoName.accountName, undefined)
  assert.equal(validNoName.expiresAt, undefined)

  // Full verified payload with genuine account name and expiration
  const full = extractBachsBankTransferDetails({
    bank_transfer: {
      account_number: '9876543210',
      bank_name: 'Providus Bank',
      account_name: 'LogsPoll - John Doe',
      expires_at: '2026-10-19T14:00:00Z'
    }
  })
  assert.ok(full)
  assert.equal(full.bankName, 'Providus Bank')
  assert.equal(full.accountNumber, '9876543210')
  assert.equal(full.accountName, 'LogsPoll - John Doe')
  assert.equal(full.expiresAt, '2026-10-19T14:00:00Z')
})

test('late payment reconciliation credits expired or failed attempt when Bachs confirms payment', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  const wallet = await getOrCreateWallet(env.DB!, customer)
  const attemptId = crypto.randomUUID()
  const checkoutId = 'chk_late_payment_001'
  const reference = 'WF-LATE-TEST-001'

  // Attempt was locally marked 'expired' before customer transferred funds
  sql.prepare(`
    INSERT INTO wallet_funding_attempts (
      id, customer_id, wallet_id, reference, checkout_id, provider_mode,
      amount_minor, fee_minor, credited_minor, idempotency_key, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 250000, 0, 250000, 'wf_late_key_001', 'expired', ?, ?)
  `).run(attemptId, customer, wallet.id, reference, checkoutId, 'sandbox', Date.now() - 3600000, Date.now() - 3600000)

  // Bachs verified session confirms funds arrived and session is 'paid'
  const session = {
    checkout_id: checkoutId,
    reference: attemptId,
    currency: 'NGN',
    amount: '2500.00',
    status: 'completed',
    payment_status: 'succeeded',
    source_type: 'API',
    session_mode: null,
    products: null,
    recurring: null,
    metadata: { order_id: attemptId },
    charge: { status: 'succeeded' },
  }

  const attempt = sql.prepare('SELECT * FROM wallet_funding_attempts WHERE id=?').get(attemptId) as any
  assert.equal(attempt.status, 'expired')

  // Reconcile: should transition from 'expired' -> 'paid' and credit wallet exactly once
  const res = await reconcileWalletFundingAttempt(env, attempt, '', '', session)
  assert.equal(res.status, 'paid')

  // Verify wallet is credited
  const updatedWallet = sql.prepare('SELECT balance_minor FROM wallets WHERE id=?').get(wallet.id) as any
  assert.equal(updatedWallet.balance_minor, 250000)

  // Verify attempt status in DB is now 'paid'
  const updatedAttempt = sql.prepare('SELECT * FROM wallet_funding_attempts WHERE id=?').get(attemptId) as any
  assert.equal(updatedAttempt.status, 'paid')

  // Reconciling again does not double-credit (strictly idempotent)
  const res2 = await reconcileWalletFundingAttempt(env, updatedAttempt, '', '', session)
  assert.equal(res2.status, 'paid')
  const walletCheck = sql.prepare('SELECT balance_minor FROM wallets WHERE id=?').get(wallet.id) as any
  assert.equal(walletCheck.balance_minor, 250000)
})

test('repeated deposit requests for the same amount with fresh request IDs create distinct attempts', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  await getOrCreateWallet(env.DB!, customer)
  let sessionCounter = 1

  t.mock.method(globalThis, 'fetch', async (url: string | URL) => {
    const urlStr = String(url)
    if (urlStr.includes('/v1/checkout-sessions')) {
      const chkId = `chk_session_${sessionCounter++}`
      return Response.json({
        checkout_id: chkId,
        checkout_url: `https://checkout.bachs.finance/${chkId}`,
        bank_transfer: {
          account_number: '0123456789',
          bank_name: 'Wema Bank',
        }
      })
    }
    return new Response(null, { status: 404 })
  })

  // First deposit of ₦2,000
  const req1 = new Request('https://test.example/api/wallet/fund', {
    method: 'POST',
    body: JSON.stringify({ amount: '2000.00', requestId: '11111111-aaaa-4111-8111-111111111111' })
  })
  const res1 = await initiateWalletFunding(req1, env, { id: customer, email: 'user@example.com' })
  assert.equal(res1.status, 200)
  const data1 = await res1.json() as any
  assert.equal(data1.ok, true)
  assert.equal(data1.checkoutId, 'chk_session_1')

  // Second deposit of the exact same amount (₦2,000) with fresh requestId
  const req2 = new Request('https://test.example/api/wallet/fund', {
    method: 'POST',
    body: JSON.stringify({ amount: '2000.00', requestId: '22222222-bbbb-4222-8222-222222222222' })
  })
  const res2 = await initiateWalletFunding(req2, env, { id: customer, email: 'user@example.com' })
  assert.equal(res2.status, 200)
  const data2 = await res2.json() as any
  assert.equal(data2.ok, true)
  assert.equal(data2.checkoutId, 'chk_session_2')

  // Two distinct attempts exist in database
  assert.notEqual(data1.attemptId, data2.attemptId)
  assert.notEqual(data1.reference, data2.reference)

  // Complete attempt 1
  sql.prepare("UPDATE wallet_funding_attempts SET status='paid' WHERE id=?").run(data1.attemptId)

  // Re-submitting with the completed attempt's requestId throws 409
  const retryReq = new Request('https://test.example/api/wallet/fund', {
    method: 'POST',
    body: JSON.stringify({ amount: '2000.00', requestId: '11111111-aaaa-4111-8111-111111111111' })
  })
  await assert.rejects(
    initiateWalletFunding(retryReq, env, { id: customer, email: 'user@example.com' }),
    /already finished/
  )
})

test('Deposit idempotency: retrying with unified requestId/request_id reuses pending session and does not duplicate', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  env.ENVIRONMENT = 'production'
  env.WALLET_LIVE_FUNDING_ENABLED = 'true'
  env.BACHS_API_KEY = 'sk_live_merchant_production_key_12345'
  env.BACHS_WEBHOOK_SECRET = 'whsec_test_secret_12345'

  let sessionCalls = 0
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const urlStr = String(url)
    if (urlStr.includes('/v1/checkout-sessions')) {
      sessionCalls++
      return new Response(JSON.stringify({
        checkout_id: 'chk_unified_session_1',
        checkout_url: 'https://checkout.bachs.io/c/chk_unified_session_1',
        bank_transfer: {
          account_number: '0123456789',
          bank_name: 'Wema Bank',
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(null, { status: 404 })
  })

  const stableAttemptUuid = '33333333-cccc-4333-8333-333333333333'
  const req1 = new Request('https://test.example/api/wallet/fund', {
    method: 'POST',
    body: JSON.stringify({
      amount: '5000.00',
      requestId: stableAttemptUuid,
      request_id: stableAttemptUuid,
    })
  })

  const res1 = await initiateWalletFunding(req1, env, { id: customer, email: 'user@example.com' })
  assert.equal(res1.status, 200)
  const data1 = await res1.json() as any
  assert.equal(data1.ok, true)
  assert.equal(data1.checkoutId, 'chk_unified_session_1')

  // Network retry with the SAME unified attempt UUID
  const req2 = new Request('https://test.example/api/wallet/fund', {
    method: 'POST',
    body: JSON.stringify({
      amount: '5000.00',
      requestId: stableAttemptUuid,
      request_id: stableAttemptUuid,
    })
  })

  const res2 = await initiateWalletFunding(req2, env, { id: customer, email: 'user@example.com' })
  assert.equal(res2.status, 200)
  const data2 = await res2.json() as any
  assert.equal(data2.ok, true)
  // Both responses point to the exact same attempt and reference
  assert.equal(data2.attemptId, data1.attemptId)
  assert.equal(data2.reference, data1.reference)

  // Verify only 1 attempt row exists in DB
  const attempts = sql.prepare("SELECT count(*) as count FROM wallet_funding_attempts WHERE customer_id=?").get(customer) as { count: number }
  assert.equal(attempts.count, 1)
})

test('Disabled live wallet funding safely returns explanatory status and rejects initiation with 403', async t => {
  const { sql, env } = fixture()
  t.after(() => sql.close())

  env.ENVIRONMENT = 'production'
  env.WALLET_LIVE_FUNDING_ENABLED = 'false'
  env.BACHS_API_KEY = '' // unconfigured live key
  env.BACHS_WEBHOOK_SECRET = ''

  // Overview explains funding requirement and marks funding disabled
  const overview = await (await getWalletOverview(env.DB!, customer, env)).json() as any
  assert.equal(overview.funding.enabled, false)
  assert.equal(overview.funding.mode, 'disabled')
  assert.match(overview.funding.reason, /verified provider configuration and prepaid-wallet approval/)

  // Direct deposit attempt rejected with 403 compliance error
  const req = new Request('https://test.example/api/wallet/fund', {
    method: 'POST',
    body: JSON.stringify({ amount: '5000.00', requestId: crypto.randomUUID() })
  })
  await assert.rejects(
    initiateWalletFunding(req, env, { id: customer, email: 'user@example.com' }),
    /Live wallet deposits are temporarily disabled while merchant account approval and stored-value compliance checks are finalized/
  )
})



