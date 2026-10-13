import { identity } from './auth.ts'
import { HttpError, json } from './http.ts'
import type { ApiEnv } from './types.ts'

const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const methods = new Set(['Licensed digital download', 'Redemption code', 'Subscription activation', 'Manual fulfillment'])
const externalId = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value)

// Cloudflare D1 staging review only. This does not import supplier items,
// change products/inventory, enable live checkout or migrate legacy approvals.
export async function supplierReview(request: Request, env: ApiEnv) {
  if (!env.DB) throw new HttpError(503, 'Staging database is unavailable.')
  const actor = await identity(request, env)
  if (actor.role !== 'admin') throw new HttpError(403, 'Administrator access required.')
  const url = new URL(request.url)

  if (request.method === 'GET') {
    const [summary, rows, categories] = await Promise.all([
      env.DB.prepare("SELECT approval, count(*) AS total FROM staging_supplier_feed_items GROUP BY approval ORDER BY approval").all<{ approval: string; total: number }>(),
      env.DB.prepare(`SELECT connection_id,external_id,name,source_category,supplier_cost_minor,stock_quantity,
        authorization_verified,source_checked_at,approval,category_id,selling_price_minor,delivery_type,reviewed_at,
        supplier_description,supplier_image_urls,supplier_category_id,supplier_subcategory_id
        FROM staging_supplier_feed_items ORDER BY source_checked_at DESC,external_id LIMIT 500`).all(),
      env.DB.prepare('SELECT id,name FROM categories WHERE active=1 ORDER BY name LIMIT 100').all<{ id: string; name: string }>(),
    ])
    if (!summary.success || !rows.success || !categories.success) throw new HttpError(503, 'Staging review tables unavailable.')
    return json({ environment: 'staging', supplierSyncEnabled: env.CATALOG_SYNC_ENABLED==='true', publicationEnabled: false,
      legacyApprovalsImported: false, counts: summary.results, items: rows.results, categories: categories.results })
  }

  if (request.method !== 'POST') throw new HttpError(405, 'Unsupported review method.')
  if (request.headers.get('Origin') !== url.origin) throw new HttpError(403, 'Same-origin review required.')
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'JSON required.')
  const reader = request.body?.getReader()
  if (!reader) throw new HttpError(400, 'Review body required.')
  const chunks: Uint8Array[] = []; let size = 0
  while (true) {
    const part = await reader.read(); if (part.done) break
    size += part.value.length
    if (size > 4096) { await reader.cancel(); throw new HttpError(413, 'Review body too large.') }
    chunks.push(part.value)
  }
  const bodyBytes = new Uint8Array(size); let index = 0
  for (const chunk of chunks) { bodyBytes.set(chunk,index); index += chunk.length }
  let input: Record<string, unknown>
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bodyBytes))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JSON')
    input = value as Record<string, unknown>
  } catch { throw new HttpError(400, 'Invalid review body.') }
  if (!uuid(input.connection_id) || !externalId(input.external_id)) throw new HttpError(400, 'Invalid supplier item.')
  if (!['approve','reject'].includes(String(input.action))) throw new HttpError(400, 'Invalid review action.')
  const now = Date.now()
  const connection = input.connection_id as string
  const listing = input.external_id as string
  if (input.action === 'reject') {
    const row = await env.DB.prepare(`UPDATE staging_supplier_feed_items
      SET approval='rejected',reviewed_by=?,reviewed_at=?
      WHERE connection_id=? AND external_id=? AND approval='pending' RETURNING external_id`)
      .bind(actor.id,now,connection,listing).first()
    if (!row) throw new HttpError(409, 'Review unavailable or already decided.')
    return json({ success: true, review: 'rejected', published: false })
  }

  if (!uuid(input.category_id) || !Number.isSafeInteger(input.price_minor) || (input.price_minor as number) < 0 || (input.price_minor as number) > 99999999900 || !methods.has(String(input.delivery_type))) {
    throw new HttpError(400, 'Valid category, integer NGN kobo price and permitted delivery type required.')
  }
  if (typeof input.description !== 'string' || input.description.trim().length < 20 || input.description==='Description not supplied by supplier; administrator review required.' || input.description.length > 10000 ||
      [...input.description].some(c => c.charCodeAt(0) < 32 && ![9,10].includes(c.charCodeAt(0))) ||
      /ypg_[0-9a-f]{48}/i.test(input.description)) throw new HttpError(400, 'Verified non-sensitive product description required.')
  const row = await env.DB.prepare(`UPDATE staging_supplier_feed_items
    SET approval='approved',category_id=?,selling_price_minor=?,delivery_type=?,reviewed_description=?,reviewed_by=?,reviewed_at=?
    WHERE connection_id=? AND external_id=? AND approval='pending'
      AND authorization_verified=1 AND source_category='permitted_digital_good'
      AND length(trim(evidence_reference))>=5
      AND source_checked_at>? AND source_checked_at<=?
      AND EXISTS(SELECT 1 FROM staging_supplier_connections c,json_each(c.authorized_products) a
        WHERE c.id=staging_supplier_feed_items.connection_id AND c.enabled=1
        AND a.key=staging_supplier_feed_items.external_id AND a.value=staging_supplier_feed_items.evidence_reference)
      AND EXISTS(SELECT 1 FROM categories WHERE id=? AND active=1)
    RETURNING external_id`)
    .bind(input.category_id as string,input.price_minor as number,input.delivery_type as string,
      input.description.trim(),actor.id,now,connection,listing,now-24*60*60*1000,now,input.category_id as string).first()
  if (!row) throw new HttpError(409, 'Review blocked: confirm current product-specific authorization, enabled supplier, fresh scan, active category and pending status.')
  // Approval is an internal review decision, NOT storefront publication.
  return json({ success: true, review: 'approved', published: false })
}
