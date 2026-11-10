import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { apiFetch } from '../workers/api/index.ts'
import {
  hashApiKey,
  generateRawApiKey,
  createApiKey,
  listUserApiKeys,
  revokeApiKey,
  rotateApiKey,
  authenticateByApiKey
} from '../workers/api/api-keys.ts'
import type { ApiEnv, Database, Statement } from '../workers/api/types.ts'

const customer = '11111111-1111-4111-8111-111111111111'
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
    '0036_customer_reseller_api_keys.sql',
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

  // Seed customer
  sql.prepare('INSERT INTO users(id) VALUES(?)').run(customer)
  sql.prepare('INSERT INTO profiles(id, full_name) VALUES(?, ?)').run(customer, 'Reseller Customer')
  sql.prepare("INSERT INTO user_roles(user_id, role) VALUES(?, 'customer')").run(customer)
  sql.prepare("INSERT INTO auth_user(id, name, email, emailVerified, createdAt, updatedAt) VALUES(?, 'Reseller Customer', 'reseller@example.com', 1, '2026-01-01', '2026-01-01')").run(customer)

  // Seed customer wallet with ₦15,000.00
  const walletId = crypto.randomUUID()
  sql.prepare(`
    INSERT INTO wallets (id, customer_id, currency, balance_minor, status, created_at, updated_at)
    VALUES (?, ?, 'NGN', 1500000, 'active', 1700000000000, 1700000000000)
  `).run(walletId, customer)

  // Create active session
  const sessionId = 'session_test_token_12345'
  sql.prepare(`
    INSERT INTO auth_session (id, "userId", token, "expiresAt", "createdAt", "updatedAt")
    VALUES ('sess_1', ?, ?, datetime('now', '+1 day'), datetime('now'), datetime('now'))
  `).run(customer, sessionId)

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
          const stmt = sql.prepare(query)
          results = stmt.all(...(args as never[])) as T[]
        } catch {
          results = []
        }
        return {
          results,
          success: true,
          meta: { changes: 1, last_row_id: 1, duration: 0, rows_read: results.length, rows_written: 1 },
        }
      },
      async first<T>() {
        const res = await this.all<T>()
        return (res.results[0] as T) ?? null
      },
      async run() {
        try {
          const stmt = sql.prepare(query)
          const info = stmt.run(...(args as never[]))
          return {
            results: [],
            success: true,
            meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid), duration: 0, rows_read: 0, rows_written: Number(info.changes) },
          }
        } catch (e) {
          throw e
        }
      },
    }
  }

  const db = {
    prepare,
    async batch(statements: Statement[]) {
      sql.exec('BEGIN')
      try {
        const results = await Promise.all(statements.map(s => s.all()))
        sql.exec('COMMIT')
        return results
      } catch (e) {
        sql.exec('ROLLBACK')
        throw e
      }
    },
    async exec(rawSql: string) {
      sql.exec(rawSql)
    },
  } as unknown as Database

  const env: ApiEnv = {
    ENVIRONMENT: 'staging',
    DB: db,
    AUTH_ENABLED: 'true',
    AUTH_ORIGIN: 'https://staging.test',
    AUTH_SECRET: 'local-test-authentication-secret-not-used-outside-tests',
    RESEND_API_KEY: 're_synthetic_only_never_send',
    AUTO_FULFILLMENT_ENABLED: 'false',
  }

  return { sql, env, db, customer, sessionId, walletId }
}

test('hashApiKey produces deterministic SHA-256 hex string and generateRawApiKey matches format', async () => {
  const { rawKey, keyPrefix } = generateRawApiKey()
  assert.match(rawKey, /^lp_live_[0-9a-f]{48}$/)
  assert.equal(keyPrefix, rawKey.slice(0, 16) + '...')

  const hash1 = await hashApiKey(rawKey)
  const hash2 = await hashApiKey(rawKey)
  assert.equal(hash1, hash2)
  assert.match(hash1, /^[0-9a-f]{64}$/)
})

test('createApiKey limits active keys to 5 and only stores SHA-256 hash in D1', async (t) => {
  const { env, sql, customer } = fixture()
  t.after(() => sql.close())

  // Create 5 active keys
  const keys: string[] = []
  for (let i = 1; i <= 5; i++) {
    const created = await createApiKey(env, customer, `Key ${i}`)
    keys.push(created.key)
    assert.match(created.key, /^lp_live_/)
    assert.equal(created.apiKey.status, 'active')
  }

  // Check database: raw keys must NEVER appear in DB
  const rows = sql.prepare('SELECT key_hash, key_prefix FROM api_keys WHERE user_id = ?').all(customer) as {
    key_hash: string
    key_prefix: string
  }[]
  assert.equal(rows.length, 5)

  for (const raw of keys) {
    const match = rows.find((r) => r.key_hash === raw || r.key_prefix === raw)
    assert.equal(match, undefined, 'Plaintext API key must never be stored in database!')
  }

  // 6th key creation must throw 400
  await assert.rejects(
    async () => {
      await createApiKey(env, customer, 'Key 6')
    },
    { message: /Maximum of 5 active API keys reached/ }
  )

  // Revoke one key and verify another can be created
  const firstKeyRecord = (await listUserApiKeys(env, customer))[4]
  const revoked = await revokeApiKey(env, customer, firstKeyRecord.id)
  assert.equal(revoked, true)

  const key6 = await createApiKey(env, customer, 'Replacement Key')
  assert.match(key6.key, /^lp_live_/)
})

test('authenticateByApiKey resolves active user identity and updates last_used_at', async (t) => {
  const { env, sql, customer } = fixture()
  t.after(() => sql.close())

  const { key, apiKey } = await createApiKey(env, customer, 'Bot Key')

  const user = await authenticateByApiKey(env, key)
  assert.ok(user)
  assert.equal(user.id, customer)
  assert.equal(user.email, 'reseller@example.com')
  assert.equal(user.name, 'Reseller Customer')
  assert.equal(user.keyId, apiKey.id)

  // Verify last_used_at updated
  const keys = await listUserApiKeys(env, customer)
  const current = keys.find((k) => k.id === apiKey.id)
  assert.ok(current?.last_used_at && current.last_used_at > 0)

  // Invalid key returns null
  assert.equal(await authenticateByApiKey(env, 'lp_live_invalidkey1234567890'), null)

  // Revoked key returns null
  await revokeApiKey(env, customer, apiKey.id)
  assert.equal(await authenticateByApiKey(env, key), null)
})

test('rotateApiKey revokes previous key and issues fresh key', async (t) => {
  const { env, sql, customer } = fixture()
  t.after(() => sql.close())

  const initial = await createApiKey(env, customer, 'Original Key')

  const rotated = await rotateApiKey(env, customer, initial.apiKey.id)
  assert.notEqual(rotated.key, initial.key)

  // Old key fails auth
  assert.equal(await authenticateByApiKey(env, initial.key), null)

  // New key succeeds auth
  const user = await authenticateByApiKey(env, rotated.key)
  assert.ok(user)
  assert.equal(user.id, customer)
})

test('API endpoints: /api/account/api-keys handles GET, POST, DELETE', async (t) => {
  const { env, sql, customer } = fixture()
  t.after(() => sql.close())

  // Generate an initial API key
  const { key: masterKey } = await createApiKey(env, customer, 'Master Key')

  // 1. GET initial keys list
  const getReq = new Request('https://staging.test/api/account/api-keys', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${masterKey}`,
    },
  })
  const getRes = await apiFetch(getReq, env)
  assert.equal(getRes.status, 200)
  const getData = (await getRes.json()) as { keys: unknown[] }
  assert.equal(getData.keys.length, 1)

  // 2. POST create a new key via API
  const postReq = new Request('https://staging.test/api/account/api-keys', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${masterKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'Integration Bot' }),
  })
  const postRes = await apiFetch(postReq, env)
  assert.equal(postRes.status, 200)
  const postData = (await postRes.json()) as {
    success: boolean
    key: string
    apiKey: { id: string; key_prefix: string; name: string }
  }
  assert.equal(postData.success, true)
  assert.match(postData.key, /^lp_live_/)
  assert.equal(postData.apiKey.name, 'Integration Bot')

  // 3. DELETE revoke key
  const delReq = new Request(`https://staging.test/api/account/api-keys?id=${postData.apiKey.id}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${masterKey}`,
    },
  })
  const delRes = await apiFetch(delReq, env)
  assert.equal(delRes.status, 200)
  const delData = (await delRes.json()) as { success: boolean }
  assert.equal(delData.success, true)
})

test('Reseller requests with Authorization: Bearer bypass origin checks and access wallet & orders', async (t) => {
  const { env, sql, customer } = fixture()
  t.after(() => sql.close())
  const { key } = await createApiKey(env, customer, 'Reseller Live Key')

  // External origin (e.g. reseller's own system or backend bot without same-origin)
  const walletReq = new Request('https://staging.test/api/v1/wallet', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      Origin: 'https://external-reseller-store.com',
    },
  })
  const walletRes = await apiFetch(walletReq, env)
  assert.equal(walletRes.status, 200, await walletRes.clone().text())
  const walletData = (await walletRes.json()) as { wallet: { balance_minor: number; currency: string } }
  assert.equal(walletData.wallet.balance_minor, 1500000)
  assert.equal(walletData.wallet.currency, 'NGN')

  // Reseller queries /api/v1/orders
  const ordersReq = new Request('https://staging.test/api/v1/orders', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
    },
  })
  const ordersRes = await apiFetch(ordersReq, env)
  assert.equal(ordersRes.status, 200)
  const ordersData = (await ordersRes.json()) as { records: unknown[] }
  assert.ok(Array.isArray(ordersData.records))
})

test('Reseller wallet purchasing via Bearer token creates paid order without browser origin check', async (t) => {
  const { env, sql, customer } = fixture()
  t.after(() => sql.close())
  const { key } = await createApiKey(env, customer, 'Purchasing Key')

  // Reseller places order via POST /api/v1/orders
  const orderReq = new Request('https://staging.test/api/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Origin: 'https://reseller-bot.xyz',
    },
    body: JSON.stringify({
      items: [{ product_id: product, quantity: 1 }],
    }),
  })

  const orderRes = await apiFetch(orderReq, env)
  assert.equal(orderRes.status, 201, await orderRes.clone().text())
  const orderData = (await orderRes.json()) as {
    ok: boolean
    orderId: string
    paymentMethod: string
    totalMinor: number
    balanceAfterMinor: number
  }
  assert.equal(orderData.ok, true)
  assert.equal(orderData.paymentMethod, 'wallet')
  assert.equal(orderData.totalMinor, 500000)
  assert.equal(orderData.balanceAfterMinor, 1000000)

  // Check customer wallet was debited
  const wallet = sql.prepare('SELECT balance_minor FROM wallets WHERE customer_id = ?').get(customer) as {
    balance_minor: number
  }
  assert.equal(wallet.balance_minor, 1000000)

  // Verify order row in D1
  const order = sql.prepare('SELECT payment_status, payment_method, total_minor FROM orders WHERE id = ?').get(orderData.orderId) as {
    payment_status: string
    payment_method: string
    total_minor: number
  }
  assert.equal(order.payment_status, 'paid')
  assert.equal(order.payment_method, 'wallet')
  assert.equal(order.total_minor, 500000)
})
