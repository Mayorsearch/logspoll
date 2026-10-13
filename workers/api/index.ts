import { HttpError, json } from './http.ts'
import { supplierReview } from './supplier-review.ts'
import { catalogAdmin, syncCatalogBatch } from './catalog-sync.ts'
import { authReady, consumeVerification, createAuth, identity } from './auth.ts'
import { drainMail, enqueueMail } from './mail.ts'
import type { ApiEnv, Execution } from './types.ts'
export async function apiFetch(request: Request, env: ApiEnv, context?: Execution) {
  try {
    if (env.ENVIRONMENT !== 'staging') throw new HttpError(503, 'Production migration is locked.')
    const url = new URL(request.url)
    const origin = request.headers.get('Origin')
    if (origin && origin !== url.origin) throw new HttpError(403, 'Origin not permitted.')
    if (!env.DB) throw new HttpError(503, 'Staging database is not configured.')
    if (url.pathname.startsWith('/api/auth/')) {
      if (url.origin !== env.AUTH_ORIGIN) throw new HttpError(403, 'Use the configured authentication origin.')
      if (!['GET','POST'].includes(request.method)) throw new HttpError(405, 'Method not permitted.')
      if (request.method === 'POST' && origin !== url.origin) throw new HttpError(403, 'Same-origin authentication required.')
      if (request.method === 'POST') {
        if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'JSON required.')
        const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0
        if (!reader) throw new HttpError(400, 'Request body required.')
        while (true) {
          const part = await reader.read(); if (part.done) break
          size += part.value.length
          if (size > 8192) { await reader.cancel(); throw new HttpError(413, 'Authentication request too large.') }
          chunks.push(part.value)
        }
        const body = new Uint8Array(size); let offset = 0
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length }
        request = new Request(request.url, { method: request.method, headers: request.headers, body })
      }
      const auth = createAuth(env)
      const passwordUser = url.pathname === '/api/auth/change-password' ? await identity(request, env) : null
      await consumeVerification(request, env)
      const response = await auth.handler(request)
      if (passwordUser && response.ok) await enqueueMail(env, `password-change:${passwordUser.id}:${Date.now()}`, 'password_changed', passwordUser)
      if (context) context.waitUntil(drainMail(env))
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', 'no-store'); headers.set('Referrer-Policy', 'no-referrer'); headers.set('X-Content-Type-Options', 'nosniff')
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    }
    if (url.pathname === '/api/admin/supplier-review') return await supplierReview(request, env)
    if (url.pathname === '/api/admin/catalog') return await catalogAdmin(request, env)
    if (request.method !== 'GET') throw new HttpError(405, 'Application writes are not migrated yet.')
    if (url.pathname === '/api/health') {
      const marker = await env.DB.prepare('SELECT value FROM migration_metadata WHERE key=\'dataset\'').first<{ value: string }>()
      if (marker?.value !== 'synthetic-staging') throw new HttpError(503, 'Staging dataset validation failed.')
      return json({ status: 'ok', environment: 'staging', database: 'D1', dataset: 'staging', syntheticBusinessFixturesPresent: true, authReplacement: authReady(env), supplierSyncConfigured: env.CATALOG_SYNC_ENABLED==='true'&&Boolean(env.SUPPLIER_ENCRYPTION_KEY), livePayments: false })
    }
    const user = await identity(request, env)
    if (url.pathname === '/api/account/session') return json({ user })
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
export default { fetch: apiFetch, scheduled: (_event: unknown, env: ApiEnv, context: Execution) => {
  context.waitUntil(drainMail(env))
  if (env.CATALOG_SYNC_ENABLED==='true') context.waitUntil((async()=>{
    // Two resources per minute; bounded D1 queries/subrequests on the Free plan.
    for(let batch=0;batch<2;batch++) {
      try { const result=await syncCatalogBatch(env); if(result.skipped) break }
      catch { break /* Redacted failure/cooldown is persisted by the batch handler. */ }
      if(batch===0) await new Promise(resolve=>setTimeout(resolve,1600))
    }
  })())
} }
