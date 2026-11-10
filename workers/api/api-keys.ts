import { HttpError, json } from './http.ts'
import type { ApiEnv } from './types.ts'

export interface ApiKeyRecord {
  id: string
  user_id: string
  key_prefix: string
  name: string
  scopes: string
  status: 'active' | 'revoked'
  last_used_at: number | null
  created_at: number
  updated_at: number
}

export interface ApiKeyPublicView {
  id: string
  key_prefix: string
  name: string
  scopes: string[]
  status: 'active' | 'revoked'
  last_used_at: number | null
  created_at: number
}

/**
 * Computes deterministic SHA-256 hex digest of an API key.
 * Only this hash is stored in the database.
 */
export async function hashApiKey(rawKey: string): Promise<string> {
  const clean = rawKey.trim()
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clean))
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Generates a cryptographically secure random API key.
 * Format: lp_live_<48 hex chars>
 */
export function generateRawApiKey(): { rawKey: string; keyPrefix: string } {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  const rawKey = `lp_live_${hex}`
  const keyPrefix = `lp_live_${hex.slice(0, 8)}...`
  return { rawKey, keyPrefix }
}

/**
 * Parses scopes string into array safely.
 */
export function parseScopes(scopesJson: string | null | undefined): string[] {
  if (!scopesJson) return ['read:catalog', 'orders:create', 'orders:read']
  try {
    const parsed = JSON.parse(scopesJson)
    return Array.isArray(parsed) ? parsed.map(String) : ['read:catalog', 'orders:create', 'orders:read']
  } catch {
    return ['read:catalog', 'orders:create', 'orders:read']
  }
}

/**
 * Get all API keys for a customer (active and revoked).
 */
export async function listUserApiKeys(env: ApiEnv, userId: string): Promise<ApiKeyPublicView[]> {
  const db = env.DB!
  const rows = await db
    .prepare(
      `SELECT id, key_prefix, name, scopes, status, last_used_at, created_at
       FROM api_keys
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 50`
    )
    .bind(userId)
    .all<ApiKeyRecord>()

  return rows.results.map((r) => ({
    id: r.id,
    key_prefix: r.key_prefix,
    name: r.name,
    scopes: parseScopes(r.scopes),
    status: r.status,
    last_used_at: r.last_used_at,
    created_at: r.created_at,
  }))
}

/**
 * Create a new API key for a customer.
 * Limits active keys to 5 per customer.
 */
export async function createApiKey(
  env: ApiEnv,
  userId: string,
  keyName = 'Reseller API Key',
  scopes = ['read:catalog', 'orders:create', 'orders:read']
): Promise<{ key: string; apiKey: ApiKeyPublicView }> {
  const db = env.DB!
  const now = Date.now()

  // Limit active keys
  const activeCount = await db
    .prepare("SELECT count(*) as count FROM api_keys WHERE user_id = ? AND status = 'active'")
    .bind(userId)
    .first<{ count: number }>()

  if ((activeCount?.count ?? 0) >= 5) {
    throw new HttpError(400, 'Maximum of 5 active API keys reached. Please revoke an unused key before generating a new one.')
  }

  const { rawKey, keyPrefix } = generateRawApiKey()
  const keyHash = await hashApiKey(rawKey)
  const id = crypto.randomUUID()
  const cleanName = keyName.trim().slice(0, 60) || 'Reseller API Key'
  const scopesJson = JSON.stringify(scopes)

  await db
    .prepare(
      `INSERT INTO api_keys(id, user_id, key_hash, key_prefix, name, scopes, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    )
    .bind(id, userId, keyHash, keyPrefix, cleanName, scopesJson, now, now)
    .run()

  return {
    key: rawKey,
    apiKey: {
      id,
      key_prefix: keyPrefix,
      name: cleanName,
      scopes,
      status: 'active',
      last_used_at: null,
      created_at: now,
    },
  }
}

/**
 * Revoke an API key.
 */
export async function revokeApiKey(env: ApiEnv, userId: string, keyId: string): Promise<boolean> {
  const db = env.DB!
  const now = Date.now()
  const res = (await db
    .prepare("UPDATE api_keys SET status = 'revoked', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'active'")
    .bind(now, keyId, userId)
    .run()) as { meta?: { changes?: number } } | null | undefined

  return Boolean(res?.meta?.changes && res.meta.changes > 0)
}

/**
 * Rotate an existing active API key: revokes the old one and generates a fresh replacement.
 */
export async function rotateApiKey(
  env: ApiEnv,
  userId: string,
  keyId?: string
): Promise<{ key: string; apiKey: ApiKeyPublicView }> {
  const db = env.DB!
  const now = Date.now()

  // Find target key to rotate
  let targetId = keyId
  if (!targetId) {
    const latest = await db
      .prepare("SELECT id FROM api_keys WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1")
      .bind(userId)
      .first<{ id: string }>()
    targetId = latest?.id
  }

  if (targetId) {
    await db
      .prepare("UPDATE api_keys SET status = 'revoked', updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(now, targetId, userId)
      .run()
  }

  return await createApiKey(env, userId, 'Rotated Reseller API Key')
}

/**
 * Look up user identity by raw API key.
 * Updates last_used_at timestamp.
 */
export async function authenticateByApiKey(
  env: ApiEnv,
  rawKey: string
): Promise<{ id: string; role: string; email: string; name: string; keyId: string; scopes: string[] } | null> {
  const db = env.DB!
  const keyHash = await hashApiKey(rawKey)

  const row = await db
    .prepare(
      `SELECT a.id AS key_id, a.user_id, a.name, a.scopes, a.status AS key_status,
              u.id, u.status AS user_status, r.role, p.full_name, au.email
       FROM api_keys a
       JOIN users u ON u.id = a.user_id
       JOIN user_roles r ON r.user_id = u.id
       LEFT JOIN profiles p ON p.id = u.id
       LEFT JOIN auth_user au ON au.id = u.id
       WHERE a.key_hash = ? AND a.status = 'active' AND u.status = 'active'`
    )
    .bind(keyHash)
    .first<{
      key_id: string
      user_id: string
      name: string
      scopes: string
      id: string
      user_status: string
      role: string
      full_name?: string | null
      email?: string | null
    }>()

  if (!row) return null

  // Touch last_used_at
  const now = Date.now()
  await db
    .prepare('UPDATE api_keys SET last_used_at = ?, updated_at = ? WHERE id = ?')
    .bind(now, now, row.key_id)
    .run()
    .catch(() => {})

  return {
    id: row.id,
    role: row.role,
    email: row.email ?? '',
    name: row.full_name ?? row.name ?? 'Reseller',
    keyId: row.key_id,
    scopes: parseScopes(row.scopes),
  }
}

/**
 * HTTP handler for GET /api/account/api-keys
 */
export async function handleGetApiKeys(request: Request, env: ApiEnv, user: { id: string }) {
  if (request.method !== 'GET') throw new HttpError(405, 'GET required.')
  const keys = await listUserApiKeys(env, user.id)
  return json({ keys })
}

/**
 * HTTP handler for POST /api/account/api-keys
 */
export async function handleCreateApiKey(request: Request, env: ApiEnv, user: { id: string }) {
  if (request.method !== 'POST') throw new HttpError(405, 'POST required.')
  let body: { name?: string; scopes?: string[] } = {}
  try {
    body = await request.json()
  } catch {
    // Body optional, defaults applied
  }

  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : 'Reseller API Key'
  const scopes = Array.isArray(body?.scopes) ? body.scopes.map(String) : ['read:catalog', 'orders:create', 'orders:read']

  const result = await createApiKey(env, user.id, name, scopes)
  return json({
    success: true,
    key: result.key,
    apiKey: result.apiKey,
    message: 'Make sure to copy your API key now. For your security, it will not be displayed again.',
  })
}

/**
 * HTTP handler for POST /api/account/api-keys/revoke or DELETE /api/account/api-keys
 */
export async function handleRevokeApiKey(request: Request, env: ApiEnv, user: { id: string }) {
  if (!['POST', 'DELETE'].includes(request.method)) throw new HttpError(405, 'POST or DELETE required.')
  const url = new URL(request.url)
  let keyId = url.searchParams.get('id')

  if (!keyId && request.method === 'POST') {
    try {
      const body = (await request.json()) as { id?: string }
      if (body?.id) keyId = String(body.id)
    } catch {}
  }

  if (!keyId) throw new HttpError(400, 'API key ID required.')
  const revoked = await revokeApiKey(env, user.id, keyId)
  if (!revoked) throw new HttpError(404, 'API key not found or already revoked.')

  return json({ success: true, message: 'API key revoked successfully.' })
}

/**
 * HTTP handler for POST /api/account/api-keys/rotate
 */
export async function handleRotateApiKey(request: Request, env: ApiEnv, user: { id: string }) {
  if (request.method !== 'POST') throw new HttpError(405, 'POST required.')
  let keyId: string | undefined
  try {
    const body = (await request.json()) as { id?: string }
    if (body?.id) keyId = String(body.id)
  } catch {}

  const result = await rotateApiKey(env, user.id, keyId)
  return json({
    success: true,
    key: result.key,
    apiKey: result.apiKey,
    message: 'Previous API key revoked. Make sure to copy your new API key now.',
  })
}
