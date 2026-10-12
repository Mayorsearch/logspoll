import { createClient } from '@supabase/supabase-js'
import { HttpError, json } from '../../server/auth.ts'
import type { ApiEnv, Database } from './types.ts'
async function identity(request: Request, env: ApiEnv, db: Database) {
  const bearer = request.headers.get('Authorization') ?? ''
  if (!/^Bearer [A-Za-z0-9._-]{20,8000}$/.test(bearer)) throw new HttpError(401, 'Verified sign-in required.')
  const issuer = env.STAGING_SUPABASE_URL
  if (!issuer || !env.STAGING_SUPABASE_PUBLISHABLE_KEY) throw new HttpError(503, 'Isolated staging authentication is not configured; existing authentication is unchanged.')
  const url = new URL(issuer)
  if (url.protocol !== 'https:' || url.origin === env.LEGACY_SUPABASE_ORIGIN || url.href !== `${url.origin}/` || url.username || url.password) throw new HttpError(503, 'Use a separate staging authentication project.')
  const client = createClient(url.origin, env.STAGING_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000), redirect: 'error' }) } })
  const result = await client.auth.getUser(bearer.slice(7))
  if (result.error || !result.data.user?.email_confirmed_at) throw new HttpError(401, 'Verified sign-in required.')
  // Browser-supplied user IDs/roles are never trusted. No auto-provisioning/admin signup.
  const user = await db.prepare('SELECT u.id,r.role FROM external_identities e JOIN users u ON u.id=e.user_id LEFT JOIN user_roles r ON r.user_id=u.id WHERE e.issuer=? AND e.subject=? AND u.status=\'active\'').bind(url.origin, result.data.user.id).first<{ id: string; role: string | null }>()
  if (!user) throw new HttpError(403, 'Staging account mapping is required.')
  const window = Math.floor(Date.now() / 60000)
  const limit = await db.prepare('INSERT INTO request_limits(subject,window,hits) VALUES(?,?,1) ON CONFLICT(subject,window) DO UPDATE SET hits=hits+1 RETURNING hits').bind(user.id, window).first<{ hits: number }>()
  if (!limit || limit.hits > 60) throw new HttpError(429, 'Request limit reached. Retry later.')
  await db.prepare('DELETE FROM request_limits WHERE window < ?').bind(window - 15).run()
  return user
}
export async function apiFetch(request: Request, env: ApiEnv) {
  try {
    if (env.ENVIRONMENT !== 'staging') throw new HttpError(503, 'Production migration is locked.')
    const url = new URL(request.url)
    const origin = request.headers.get('Origin')
    if (origin && origin !== url.origin) throw new HttpError(403, 'Origin not permitted.')
    if (request.method !== 'GET') throw new HttpError(405, 'This staging milestone supports read-only routes only.')
    if (!env.DB) throw new HttpError(503, 'Staging database is not configured.')
    if (url.pathname === '/api/health') {
      const marker = await env.DB.prepare('SELECT value FROM migration_metadata WHERE key=\'dataset\'').first<{ value: string }>()
      if (marker?.value !== 'synthetic-staging') throw new HttpError(503, 'Staging dataset validation failed.')
      return json({ status: 'ok', environment: 'staging', database: 'D1', dataset: 'synthetic-only', authReplacement: false, supplierSync: false, livePayments: false })
    }
    const user = await identity(request, env, env.DB)
    let sql: string; let values: (string | number)[] = []
    switch (url.pathname) {
      case '/api/products': sql = 'SELECT * FROM staging_storefront_products ORDER BY id LIMIT 100'; break
      case '/api/categories': sql = 'SELECT c.id,c.slug,c.name,c.short_name,c.description FROM categories c WHERE c.active=1 AND EXISTS(SELECT 1 FROM staging_storefront_products p WHERE p.category_id=c.id) ORDER BY c.sort_order,c.id LIMIT 100'; break
      case '/api/account': sql = 'SELECT id,full_name,created_at FROM profiles WHERE id=?'; values = [user.id]; break
      case '/api/orders': sql = 'SELECT id,reference,payment_status,fulfillment_status,total_minor,currency,created_at FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 100'; values = [user.id]; break
      case '/api/support': sql = 'SELECT id,subject,message,status,reply,created_at FROM support_tickets WHERE user_id=? ORDER BY created_at DESC LIMIT 100'; values = [user.id]; break
      case '/api/notifications': sql = 'SELECT id,title,message,order_id,read_at,created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100'; values = [user.id]; break
      case '/api/admin/overview':
        if (user.role !== 'admin') throw new HttpError(403, 'Administrator access required.')
        sql = 'SELECT (SELECT count(*) FROM users) AS customers,(SELECT count(*) FROM products) AS products,(SELECT count(*) FROM orders) AS orders'; break
      default: throw new HttpError(404, 'Route not implemented in this migration milestone.')
    }
    const result = await env.DB.prepare(sql).bind(...values).all()
    if (!result.success) throw new HttpError(503, 'Staging query unavailable.')
    return json({ dataset: 'synthetic-staging', records: result.results })
  } catch (error) { return json({ error: error instanceof HttpError ? error.message : 'Staging API unavailable. No write or success was assumed.' }, error instanceof HttpError ? error.status : 503) }
}
export default { fetch: apiFetch }
