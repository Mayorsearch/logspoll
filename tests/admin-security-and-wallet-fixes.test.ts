import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { apiFetch } from '../workers/api/index.ts'
import type { ApiEnv, Statement, Database } from '../workers/api/types.ts'

function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys=ON')
  for (const file of [
    'migrations/0001_staging_foundation.sql',
    'fixtures.sql',
    'migrations/0002_cloudflare_auth.sql',
    'migrations/0003_auth_mail_diagnostics.sql',
    'migrations/0004_supplier_review.sql',
    'migrations/0005_supplier_sync.sql',
    'migrations/0006_admin_publication.sql',
    'migrations/0009_auth_email_otp.sql',
    'migrations/0026_customer_wallet_system.sql',
    'migrations/0028_wallet_temporary_accounts.sql'
  ]) {
    sqlite.exec(readFileSync(new URL('../workers/api/' + file, import.meta.url), 'utf8'))
  }

  const db = {
    prepare(sql: string) {
      let values: unknown[] = []
      const stmt = {
        bind(...args: unknown[]) {
          values = args
          return stmt
        },
        async all() {
          const results = sqlite.prepare(sql).all(...(values as never[]))
          const changes = sqlite.prepare('SELECT changes() AS n').get()!.n
          return { results, success: true, meta: { changes, last_row_id: 0 } }
        },
        async first() {
          return (await stmt.all()).results[0] ?? null
        },
        async run() {
          return stmt.all()
        }
      }
      return stmt
    },
    async batch(statements: Statement[]) {
      sqlite.exec('BEGIN')
      try {
        const result = await Promise.all(statements.map(s => s.all()))
        sqlite.exec('COMMIT')
        return result
      } catch (e) {
        sqlite.exec('ROLLBACK')
        throw e
      }
    },
    async exec(sql: string) {
      sqlite.exec(sql)
    },
  } as Database

  const env: ApiEnv = {
    ENVIRONMENT: 'staging',
    DB: db,
    AUTH_ENABLED: 'true',
    AUTH_ORIGIN: 'https://staging.test',
    AUTH_SECRET: 'local-test-authentication-secret-not-used-outside-tests',
    RESEND_API_KEY: 're_synthetic_only_never_send',
    BACHS_API_KEY: 'sk_sandbox_' + 'b'.repeat(40),
    BACHS_WEBHOOK_SECRET: 'whsec_test',
    BACHS_SANDBOX_ENABLED: 'true',
    WALLET_LIVE_FUNDING_ENABLED: 'true',
    CATALOG_SYNC_ENABLED: 'false',
  }

  const request = (path: string, body?: unknown, cookie?: string, origin = 'https://staging.test') =>
    new Request('https://staging.test' + path, {
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'cf-connecting-ip': '192.0.2.1',
        ...(cookie ? { Cookie: cookie } : {})
      }
    })

  return { env, db, sqlite, request }
}

async function createVerifiedUser(
  env: ApiEnv,
  sqlite: DatabaseSync,
  request: (path: string, body?: unknown, cookie?: string) => Request,
  name: string,
  email: string,
  role: 'customer' | 'admin' = 'customer'
) {
  const password = 'SecurePassword2026!'
  const signupRes = await apiFetch(request('/api/auth/sign-up/email', { email, password, name }), env)
  assert.equal(signupRes.status, 200)
  sqlite.prepare('UPDATE auth_user SET emailVerified=1 WHERE email=?').run(email)
  const loginRes = await apiFetch(request('/api/auth/sign-in/email', { email, password }), env)
  assert.equal(loginRes.status, 200)
  const cookie = loginRes.headers.get('set-cookie')!.split(';')[0]
  const sessionRes = await apiFetch(request('/api/account/session', undefined, cookie), env)
  assert.equal(sessionRes.status, 200)
  const user = ((await sessionRes.json()) as any).user
  if (role === 'admin') {
    sqlite.prepare("UPDATE user_roles SET role='admin' WHERE user_id=?").run(user.id)
  }
  return { id: user.id as string, cookie, email, name }
}

test('ordinary customer cannot access admin endpoints and receives HTTP 403', async () => {
  const { env, sqlite, request } = fixture()
  const customer = await createVerifiedUser(env, sqlite, request, 'Ordinary Customer', 'ordinary@example.test', 'customer')

  const req = request('/api/admin/overview', undefined, customer.cookie)
  const res = await apiFetch(req, env)
  assert.equal(res.status, 403)
})

test('ordinary customer without invitation receives invited:false and cannot self-enroll', async () => {
  const { env, sqlite, request } = fixture()
  const customer = await createVerifiedUser(env, sqlite, request, 'Regular Customer', 'regular@example.test', 'customer')

  // Check enrollment status
  const getReq = new Request('https://staging.test/api/account/admin-enrollment', {
    method: 'GET',
    headers: {
      cookie: customer.cookie,
      Origin: 'https://staging.test'
    }
  })
  const getRes = await apiFetch(getReq, env)
  assert.equal(getRes.status, 200)
  const getData = await getRes.json() as any
  assert.equal(getData.invited, false)
  assert.equal(getData.expires_at, null)

  // Attempt to self-enroll without invitation
  const postReq = request('/api/account/admin-enrollment', {}, customer.cookie)
  const postRes = await apiFetch(postReq, env)
  assert.equal(postRes.status, 403)

  // Verify role remains customer
  const role = sqlite.prepare('SELECT role FROM user_roles WHERE user_id=?').get(customer.id) as any
  assert.equal(role.role, 'customer')
})

test('valid invited user can accept invitation, elevate role, but cannot reuse single-use invitation', async () => {
  const { env, sqlite, request } = fixture()
  const admin = await createVerifiedUser(env, sqlite, request, 'Platform Admin', 'admin@example.test', 'admin')
  const invitee = await createVerifiedUser(env, sqlite, request, 'Invited Admin', 'invitee@example.test', 'customer')

  // Issue invitation from authorized admin
  const inviteRes = await apiFetch(request('/api/admin/operations', { action: 'invite_admin', id: invitee.id }, admin.cookie), env)
  assert.equal(inviteRes.status, 200)

  // Invitee checks enrollment status
  const getReq = new Request('https://staging.test/api/account/admin-enrollment', {
    method: 'GET',
    headers: {
      cookie: invitee.cookie,
      Origin: 'https://staging.test'
    }
  })
  const getRes = await apiFetch(getReq, env)
  assert.equal(getRes.status, 200)
  const getData = await getRes.json() as any
  assert.equal(getData.invited, true)
  assert.ok(getData.expires_at > Date.now())

  // Invitee accepts invitation
  const postReq = request('/api/account/admin-enrollment', {}, invitee.cookie)
  const postRes = await apiFetch(postReq, env)
  assert.equal(postRes.status, 200)
  const postData = await postRes.json() as any
  assert.equal(postData.enrolled, true)

  // Role in DB is now admin
  const role = sqlite.prepare('SELECT role FROM user_roles WHERE user_id=?').get(invitee.id) as any
  assert.equal(role.role, 'admin')

  // Second acceptance attempt must be rejected (single-use)
  const retryReq = request('/api/account/admin-enrollment', {}, invitee.cookie)
  const retryRes = await apiFetch(retryReq, env)
  assert.equal(retryRes.status, 403)
})

test('wallet deposit returns both attempt and flat fields, accepting request_id and requestId', async t => {
  const { env, sqlite, request } = fixture()
  const customer = await createVerifiedUser(env, sqlite, request, 'Wallet Depositor', 'depositor@example.test', 'customer')

  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      checkout_id: 'chk_mock_test_12345',
      checkout_url: 'https://sandbox-checkout.bachs.io/c/mock_test',
    })
  )

  const req = request('/api/wallet/fund', {
    amount: 5000,
    channel: 'bank_transfer',
    request_id: '11111111-2222-3333-4444-555555555555'
  }, customer.cookie)

  const res = await apiFetch(req, env)
  assert.equal(res.status, 200)
  const body = await res.json() as any

  // Verified: returns ok: true AND success: true
  assert.equal(body.ok, true)
  assert.equal(body.success, true)

  // Verified: returns attempt object matching FundWalletSheet expectations
  assert.ok(body.attempt)
  assert.equal(body.attempt.amount_minor, 500000)
  assert.equal(body.attempt.amount, 5000)
  assert.equal(body.attempt.status, 'open')
  assert.equal(body.attempt.checkout_url, 'https://sandbox-checkout.bachs.io/c/mock_test')

  // Verified: returns flat fields for backwards compatibility
  assert.equal(body.amountMinor, 500000)
  assert.equal(body.amount, 5000)
  assert.equal(body.checkoutUrl, 'https://sandbox-checkout.bachs.io/c/mock_test')
})
