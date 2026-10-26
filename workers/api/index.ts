import {supplierAutomation,runSupplierAutomation,revalidateProductPrices} from './supplier-automation.ts'
import {runFulfillment} from './fulfillment.ts'
import {stagingBachsWebhook} from './bachs-staging.ts'
import {bachsCheckout} from './bachs-checkout.ts'
import {bachsWebhook,reconcileBachsAttempt} from './bachs-webhook.ts'
import {storefrontCategories} from './storefront-categories.ts'
import {hstoraWebhook,hstoraWebhookAdmin} from './hstora-webhook.ts'
import {supplierManager} from './supplier-manager.ts'
import {hstoraReview} from './hstora-review.ts'
import {hstoraAdmin,syncHstoraBatch} from './hstora-manager.ts'
import {shopviaclone22Admin,syncShopViaClone22Batch} from './shopviaclone22-manager.ts'
import {digitalcoreAdmin,syncDigitalCoreBatch} from './digitalcore-manager.ts'
import {syncDigitalTopBatch} from './digitaltop-manager.ts'
import {exchangeRateAdmin,refreshExchangeRateCron} from './exchange-rate.ts'
import {handleStorefrontDiscovery,handleAdminStorefrontDiscovery} from './storefront-discovery.ts'
import { requireRuntime } from './runtime.ts'
import { HttpError, json } from './http.ts'
import { supplierReview } from './supplier-review.ts'
import { catalogAdmin, catalogWritesReady, refreshPublishedStock, refreshSupplierTaxonomy, syncCatalogBatch } from './catalog-sync.ts'
import {paymentReadiness} from './payment-readiness.ts'
import { authReady, consumeVerification, createAuth, identity } from './auth.ts'
import { drainMail, enqueueMail, drainBusinessMail } from './mail.ts'
import { adminOperations, adminEnrollment, adminActor, bodyJSON } from './admin.ts'
import { customerRead, customerWrite, publicReviews } from './customer.ts'
import type { ApiEnv, Execution } from './types.ts'
export async function apiFetch(request: Request, env: ApiEnv, context?: Execution) {
  try {
    if(new URL(request.url).pathname==='/api/webhooks/bachs')return await (env.ENVIRONMENT==='staging'?stagingBachsWebhook(request,env):bachsWebhook(request,env))
    if(new URL(request.url).pathname==='/api/webhooks/hstora')return await hstoraWebhook(request,env)
    await requireRuntime(env)
    const url = new URL(request.url)
    if(url.pathname==='/api/admin/supplier-automation')return await supplierAutomation(request,env)
    if(url.pathname==='/api/internal/fulfillment'){
      if(request.method!=='POST')throw new HttpError(405,'POST required.')
      const authHeader = request.headers.get('Authorization')
      const isBearerSecret = Boolean(authHeader && env.AUTH_SECRET && authHeader === `Bearer ${env.AUTH_SECRET}`)
      if(!isBearerSecret){
        await adminActor(request,env)
      }
      const orderId=url.searchParams.get('order_id')??undefined
      const adminOverride=url.searchParams.get('admin_override')==='true'
      if(orderId){
        const {fulfillPaidOrder}=await import('./fulfillment.ts')
        const res=await fulfillPaidOrder(env,orderId,{adminOverride})
        return json(res)
      }
      await runFulfillment(env)
      await drainBusinessMail(env).catch(()=>undefined)
      await drainMail(env).catch(()=>undefined)
      return json({ok:true})
    }
    const origin = request.headers.get('Origin')
    if (origin && origin !== url.origin) throw new HttpError(403, 'Origin not permitted.')
    if (!env.DB) throw new HttpError(503, 'Staging database is not configured.')
    const groupedStorefront=await storefrontCategories(request,env);if(groupedStorefront)return groupedStorefront
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
      const accountUser = ['/api/auth/change-password', '/api/auth/update-user'].includes(url.pathname) ? await identity(request, env) : null
      await consumeVerification(request, env)
      const response = await auth.handler(request)
      if (accountUser && response.ok && url.pathname === '/api/auth/change-password') await enqueueMail(env, `password-change:${accountUser.id}:${Date.now()}`, 'password_changed', accountUser)
      if (accountUser && response.ok && url.pathname === '/api/auth/update-user') await env.DB.prepare("UPDATE profiles SET full_name=(SELECT name FROM auth_user WHERE id=?),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(accountUser.id, accountUser.id).run()
      if (context) context.waitUntil(drainMail(env))
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', 'no-store'); headers.set('Referrer-Policy', 'no-referrer'); headers.set('X-Content-Type-Options', 'nosniff')
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    }
    if (url.pathname === '/api/admin/email') { await adminActor(request,env);if(request.method!=='GET')throw new HttpError(405,'Read-only email diagnostics.');const rows=await env.DB.prepare('SELECT created_at,delivered_at,attempts,last_error FROM auth_mail_outbox ORDER BY created_at DESC LIMIT 100').all();return json({provider:'Resend',records:rows.results}) }
    if (url.pathname === '/api/admin/operations') { const result=await adminOperations(request,env);if(context)context.waitUntil(drainBusinessMail(env).then(()=>drainMail(env)));return result }
    if (url.pathname === '/api/account/admin-enrollment') {const result=await adminEnrollment(request,env);if(context)context.waitUntil(drainBusinessMail(env).then(()=>drainMail(env)));return result}
    if (url.pathname === '/api/admin/readiness') {
      await adminActor(request,env);if(request.method!=='GET')throw new HttpError(405,'Read-only endpoint.');
      const tables=await env.DB.prepare("SELECT name FROM sqlite_master WHERE name IN ('admin_invitations','supplier_products','storefront_products')").all();
      return json({environment:env.ENVIRONMENT,database:'D1',schemaReady:tables.results.length===3,authReady:authReady(env),emailConfigured:Boolean(env.RESEND_API_KEY),catalogConfigured:env.CATALOG_SYNC_ENABLED==='true'&&Boolean(env.SUPPLIER_ENCRYPTION_KEY),livePayments:false,automaticFulfillment:false,payments:await paymentReadiness(env,url.origin,url.searchParams.get('verify_bachs')==='1')})
    }
    if (url.pathname === '/api/admin/supplier-review') return await supplierReview(request, env)
    if (url.pathname === '/api/admin/hstora-webhook') return await hstoraWebhookAdmin(request,env)
    if (url.pathname === '/api/admin/supplier-manager') return await supplierManager(request,env)
    if (url.pathname === '/api/admin/hstora-review') return await hstoraReview(request,env)
    if (url.pathname === '/api/admin/hstora') return await hstoraAdmin(request,env)
    if (url.pathname === '/api/admin/shopviaclone22') return await shopviaclone22Admin(request, env)
    if (url.pathname === '/api/admin/digitalcore') return await digitalcoreAdmin(request, env)
    if (url.pathname === '/api/admin/digitaltop') return await digitalcoreAdmin(request, env)
    if (url.pathname === '/api/admin/exchange-rate') return await exchangeRateAdmin(request, env)
    if (url.pathname === '/api/admin/storefront-discovery') return await handleAdminStorefrontDiscovery(request, env)
    if (url.pathname === '/api/storefront/discovery') return await handleStorefrontDiscovery(request, env)
    if (url.pathname === '/api/admin/catalog') return await catalogAdmin(request, env)
    if (url.pathname === '/api/admin/wallets') return await (await import('./wallet.ts')).adminGetWallets(request, env)
    if (url.pathname === '/api/admin/wallets/freeze') return await (await import('./wallet.ts')).adminFreezeWallet(request, env)
    if (url.pathname === '/api/admin/wallets/adjust') return await (await import('./wallet.ts')).adminAdjustWallet(request, env)
    if (url.pathname === '/api/wallet') {
      if (request.method !== 'GET') throw new HttpError(405, 'GET required.')
      const user = await identity(request, env)
      const { getWalletOverview } = await import('./wallet.ts')
      return await getWalletOverview(env.DB!, user.id, env)
    }
    if (url.pathname === '/api/wallet/fund') {
      const user = await identity(request, env)
      const { initiateWalletFunding } = await import('./wallet.ts')
      return await initiateWalletFunding(request, env, user)
    }
    if (url.pathname === '/api/wallet/pay-order' || url.pathname === '/api/wallet/checkout') {
      const user = await identity(request, env)
      const { payOrderWithWallet } = await import('./wallet.ts')
      return await payOrderWithWallet(request, env, user)
    }
    if (url.pathname === '/api/wallet/reconcile') {
      const user = await identity(request, env)
      const attemptId = url.searchParams.get('attempt_id')
      if (!attemptId) throw new HttpError(400, 'Attempt ID required.')
      const attempt = await env.DB!.prepare('SELECT * FROM wallet_funding_attempts WHERE id=? AND customer_id=?').bind(attemptId, user.id).first<import('./wallet.ts').FundingAttemptRecord>()
      if (!attempt) throw new HttpError(404, 'Funding attempt not found.')
      const { reconcileWalletFundingAttempt } = await import('./wallet.ts')
      const res = await reconcileWalletFundingAttempt(env, attempt)
      return json(res)
    }
    if (url.pathname === '/api/cart/refresh-prices' || url.pathname === '/api/cart/refresh') {
      if (request.method !== 'POST') throw new HttpError(405, 'POST required.')
      if (origin !== url.origin || !request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(403, 'Same-origin JSON required.')
      const body = await bodyJSON(request, 8192)
      if (!body || !Array.isArray(body.ids) || body.ids.length > 25 || body.ids.some(id => typeof id !== 'string' || !/^[a-f\d-]{36}$/i.test(id))) throw new HttpError(400, 'Select between 1 and 25 valid products.')
      const ids = [...new Set(body.ids)] as string[]
      if (!ids.length) return json({ records: [], priceChanged: false, changedItems: [], blockedItems: [] })
      const visible = await env.DB.prepare(`SELECT id FROM storefront_products WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string }>()
      const reval = await revalidateProductPrices(env, visible.results.map(row => row.id))
      const readURL = new URL('/api/products', url.origin)
      readURL.searchParams.set('ids', ids.join(','))
      const response = await customerRead(new Request(readURL), env, null)
      if (!response) throw new HttpError(503, 'Cart products unavailable.')
      const products = await response.json() as { records: unknown[] }
      return json({ records: products.records, priceChanged: reval.updatedCount > 0, changedItems: reval.changedItems, blockedItems: reval.blockedItems })
    }
    if (url.pathname === '/api/checkout' || url.pathname === '/api/v1/checkout') return await bachsCheckout(request, env)
    if (url.pathname === '/api/bachs/order' || url.pathname === '/api/v1/order' || /^\/api\/(?:v1\/)?orders\/[^/]+\/status$/.test(url.pathname)) {
      if (request.method !== 'GET') throw new HttpError(405, 'GET required.')
      const user = await identity(request, env)
      const statusMatch = url.pathname.match(/^\/api\/(?:v1\/)?orders\/([^/]+)\/status$/)
      const id = statusMatch ? statusMatch[1] : url.searchParams.get('id')
      if (!id) throw new HttpError(400, 'Order ID required.')
      const attempt = await env.DB!.prepare('SELECT a.* FROM bachs_payment_attempts a WHERE a.order_id=? AND a.customer_id=? ORDER BY a.created_at DESC LIMIT 1').bind(id, user.id).first<{id:string;order_id:string;checkout_id:string;provider_mode:string;amount_minor:number;status:string}>()
      let order = await env.DB!.prepare('SELECT id,reference,payment_status,fulfillment_status,total_minor,currency,payment_method,created_at FROM orders WHERE id=? AND customer_id=?').bind(id, user.id).first<{id:string;reference:string;payment_status:string;fulfillment_status:string;total_minor:number;currency:string;payment_method:string;created_at:string}>()
      if (!order && !attempt) throw new HttpError(404, 'Order not found.')
      if (attempt?.checkout_id && ['initiating', 'open'].includes(attempt.status)) await reconcileBachsAttempt(env, attempt)
      if (order && order.payment_status === 'paid' && order.fulfillment_status !== 'delivered' && env.AUTO_FULFILLMENT_ENABLED === 'true' && Boolean(env.SUPPLIER_ENCRYPTION_KEY)) {
        await runFulfillment(env, id).catch(() => undefined)
        await drainBusinessMail(env).catch(() => undefined)
        await drainMail(env).catch(() => undefined)
        order = await env.DB!.prepare('SELECT id,reference,payment_status,fulfillment_status,total_minor,currency,payment_method,created_at FROM orders WHERE id=? AND customer_id=?').bind(id, user.id).first<NonNullable<typeof order>>()
      }
      if (order) {
        const hasJobs = Boolean(await env.DB!.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fulfillment_jobs'").first().catch(() => null))
        const job = hasJobs
          ? await env.DB!.prepare('SELECT state, last_error FROM fulfillment_jobs WHERE order_id=? ORDER BY updated_at DESC LIMIT 1').bind(id).first<{state: string; last_error: string | null}>().catch(() => null)
          : null
        const ent = await env.DB!.prepare('SELECT 1 FROM product_entitlements pe JOIN order_items oi ON oi.id=pe.order_item_id WHERE oi.order_id=? LIMIT 1').bind(id).first().catch(() => null)
        order = {
          ...order,
          delivery_status: job?.state ?? null,
          delivery_error: job?.last_error ?? null,
          has_entitlement: Boolean(ent),
        } as NonNullable<typeof order>
      }
      return json({ order })
    }
    if (request.method === 'POST' && ['/api/support', '/api/reviews'].includes(url.pathname)) return await customerWrite(request, env, await identity(request, env))
    if (request.method !== 'GET') throw new HttpError(405, 'Application writes are not migrated yet.')
    if (url.pathname === '/api/reviews') return await publicReviews(request, env)
    if (url.pathname === '/api/health') {
      const marker = await env.DB.prepare('SELECT value FROM migration_metadata WHERE key=\'dataset\'').first<{ value: string }>()
      if (marker?.value !== (env.ENVIRONMENT==='production'?'production':'synthetic-staging')) throw new HttpError(503, 'Staging dataset validation failed.')
      return json({ status: 'ok', environment: env.ENVIRONMENT, database: 'D1', dataset: 'staging', syntheticBusinessFixturesPresent: env.ENVIRONMENT==='staging', authReplacement: authReady(env), supplierSyncConfigured: env.CATALOG_SYNC_ENABLED==='true'&&Boolean(env.SUPPLIER_ENCRYPTION_KEY), livePayments: false })
    }
    // Public catalog uses verified D1 storefront data.
    if (request.method === 'GET' &&
        (['/api/products', '/api/categories', '/api/v1/products', '/api/v1/categories'].includes(url.pathname) ||
         /^\/api\/(?:v1\/)?products\/[^/]+$/.test(url.pathname))) {
      // Cache only this public projection. Stock responses and private routes
      // remain uncached so the one-hour inventory cutoff is never extended.
      const isCategories = url.pathname === '/api/categories' || url.pathname === '/api/v1/categories'
      const cache=isCategories?(globalThis.caches as CacheStorage&{default?:Cache}|undefined)?.default:undefined
      const cacheKey=new Request(url.origin+'/api/categories')
      const cached=cache&&await cache.match(cacheKey)
      if(cached)return cached
      const response = await customerRead(request, env, null)
      if (response) {
        if(cache&&context&&response.ok){response.headers.set('Cache-Control','public, max-age=30');context.waitUntil(cache.put(cacheKey,response.clone()))}
        return response
      }
    }

    if (request.method === 'GET' && (url.pathname === '/api/config' || url.pathname === '/api/storefront/settings')) {
      let settings = { whatsapp_number: '2348117472091', support_email: 'support@logspoll.com' }
      try {
        const row = await env.DB.prepare("SELECT value FROM website_settings WHERE key='general'").first<{ value: string }>()
        if (row?.value) {
          const parsed = JSON.parse(row.value)
          if (parsed && typeof parsed === 'object') {
            settings = { ...settings, ...parsed }
          }
        }
      } catch {}
      const res = json({ settings })
      res.headers.set('Cache-Control', 'public, max-age=60')
      return res
    }

    const user = await identity(request, env)
    if (url.pathname === '/api/account/session') return json({ user })
    const customerResponse = await customerRead(request, env, user)
    if (customerResponse) return customerResponse
    let sql: string; let values: (string | number)[] = []
    switch (url.pathname) {
      case '/api/products':
      case '/api/v1/products': sql = 'SELECT * FROM staging_storefront_products ORDER BY id LIMIT 100'; break
      case '/api/categories':
      case '/api/v1/categories': sql = 'SELECT c.id,c.slug,c.name,c.short_name,c.description FROM categories c WHERE c.active=1 AND EXISTS(SELECT 1 FROM staging_storefront_products p WHERE p.category_id=c.id) ORDER BY c.sort_order,c.id LIMIT 100'; break
      case '/api/account': sql = 'SELECT id,full_name,created_at FROM profiles WHERE id=?'; values = [user.id]; break
      case '/api/orders':
      case '/api/v1/orders': sql = 'SELECT id,reference,payment_status,fulfillment_status,total_minor,currency,created_at FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 100'; values = [user.id]; break
      case '/api/support': sql = 'SELECT id,subject,message,status,reply,created_at FROM support_tickets WHERE user_id=? ORDER BY created_at DESC LIMIT 100'; values = [user.id]; break
      case '/api/notifications': sql = 'SELECT id,title,message,order_id,read_at,created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100'; values = [user.id]; break
      case '/api/admin/overview':
        if (user.role !== 'admin') throw new HttpError(403, 'Administrator access required.')
        sql = "SELECT (SELECT count(*) FROM users) AS customers,(SELECT count(*) FROM products) AS products,(SELECT count(*) FROM orders) AS orders,(SELECT COALESCE(sum(total_minor),0) FROM orders WHERE payment_status='paid') AS revenue_minor,(SELECT count(*) FROM orders WHERE payment_status='paid') AS paid_orders"; break
      default: throw new HttpError(404, 'Route not implemented in this migration milestone.')
    }
    const result = await env.DB.prepare(sql).bind(...values).all()
    if (!result.success) throw new HttpError(503, 'Staging query unavailable.')
    return json({ environment: env.ENVIRONMENT, records: result.results })
  } catch (error) { return json({ error: error instanceof HttpError ? error.message : 'Staging API unavailable. No write or success was assumed.' }, error instanceof HttpError ? error.status : 503) }
}
export default { fetch: apiFetch, scheduled: (_event: unknown, env: ApiEnv, context: Execution) => {
  context.waitUntil(requireRuntime(env).then(()=>runFulfillment(env)).catch(()=>{}))
  context.waitUntil(requireRuntime(env).then(()=>drainBusinessMail(env)).then(()=>drainMail(env)).catch(()=>{}))
  context.waitUntil(requireRuntime(env).then(()=>refreshExchangeRateCron(env)).catch(()=>{}))
  context.waitUntil(requireRuntime(env).then(()=>runSupplierAutomation(env)).catch(()=>{}))
  if (catalogWritesReady(env)) context.waitUntil((async()=>{
    await requireRuntime(env)
    await syncHstoraBatch(env).catch(()=>{})
    await syncShopViaClone22Batch(env).catch(()=>{})
    await syncDigitalCoreBatch(env).catch(()=>{})
    await syncDigitalTopBatch(env).catch(()=>{})
    await env.DB!.prepare("INSERT INTO migration_metadata(key,value) VALUES('catalog_scheduler_heartbeat',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(Date.now())).run()
    for(let batch=0;batch<4;batch++) {
      try {
        const syncResult = await syncCatalogBatch(env);
        if (syncResult.skipped) {
          if ((await refreshPublishedStock(env)).skipped && (await refreshSupplierTaxonomy(env)).skipped) break;
        }
      }
      catch { break /* Redacted failure/cooldown is persisted by the batch handler. */ }
      if(batch<3) await new Promise(resolve=>setTimeout(resolve,5500))
    }
  })())
} }
