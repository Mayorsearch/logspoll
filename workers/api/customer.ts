import { HttpError, json } from './http.ts'
import type { ApiEnv } from './types.ts'

type Customer = { id: string; role: string }
const storefront = 'storefront_products'
const productFields = 'p.id,p.category_id,p.slug,p.name,p.brand,p.description,p.price_minor,p.currency,p.delivery_type,p.image_path,p.term,p.features,p.supplier_image_urls,p.featured,p.available_quantity,c.name AS category_name,c.slug AS category_slug'
function product(row: Record<string, unknown>) {
  const { supplier_name, supplier_cost_minor, supplier_cost, supplier_product_id, authorization_evidence, ...safe } = row
  void supplier_name; void supplier_cost_minor; void supplier_cost; void supplier_product_id; void authorization_evidence
  return { ...safe, features: JSON.parse(String(row.features ?? '[]')), supplier_image_urls: JSON.parse(String(row.supplier_image_urls ?? '[]')) }
}
export async function customerRead(request: Request, env: ApiEnv, user: Customer | null) {
  const url = new URL(request.url), db = env.DB!
  const isProducts = url.pathname === '/api/products' || url.pathname === '/api/v1/products'
  const productSlugMatch = url.pathname.match(/^\/api\/(?:v1\/)?products\/([^/]+)$/)
  if (isProducts || productSlugMatch) {
    const slug = productSlugMatch ? decodeURIComponent(productSlugMatch[1]) : url.searchParams.get('slug')
    const ids = url.searchParams.get('ids')
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200)
    const category = (url.searchParams.get('category') ?? '').slice(0, 200)
    const page = Math.min(10000, Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1)))
    const predicates = ['1=1'], values: (string | number)[] = []
    if (slug) { predicates.push('p.slug=?'); values.push(slug.slice(0, 200)) }
    if (ids) {
      const list = [...new Set(ids.split(','))]
      if (list.length > 100 || list.some(id => !/^[a-f\d-]{36}$/i.test(id))) throw new HttpError(400, 'Invalid product selection.')
      predicates.push(`p.id IN (${list.map(() => '?').join(',')})`); values.push(...list)
    }
    if (q) { predicates.push('(instr(lower(p.name),lower(?))>0 OR instr(lower(p.description),lower(?))>0)'); values.push(q, q) }
    if (category) { predicates.push('c.slug=?'); values.push(category) }
    const availability = url.searchParams.get('availability')
    if (availability === 'in-stock') predicates.push('p.available_quantity>0')
    if (availability === 'out-of-stock') predicates.push('p.available_quantity=0')
    const hasServer = Boolean(await db.prepare("SELECT 1 FROM pragma_table_info('storefront_products') WHERE name='server_number'").first().catch(() => null))
    const server = url.searchParams.get('server')
    if (server && ['1', '2', '3'].includes(server)) {
      if (hasServer) {
        predicates.push('p.server_number=?')
        values.push(Number(server))
      }
    }
    const from = ` FROM ${storefront} p JOIN categories c ON c.id=p.category_id WHERE ${predicates.join(' AND ')}`
    const order = ({ 'price-asc': 'p.price_minor ASC,p.id', 'price-desc': 'p.price_minor DESC,p.id', newest: 'p.id DESC' } as Record<string, string>)[url.searchParams.get('sort') ?? ''] ?? 'p.featured DESC,p.name,p.id'
    const total = (await db.prepare('SELECT count(*) AS n' + from).bind(...values).first<{ n: number }>())!.n
    if (productSlugMatch) {
      if (total === 0) throw new HttpError(404, 'Product not found.')
      const fields = hasServer ? `${productFields},p.server_number` : productFields
      const item = await db.prepare(`SELECT ${fields}${from} LIMIT 1`).bind(...values).first<Record<string, unknown>>()
      if (!item) throw new HttpError(404, 'Product not found.')
      return json({ product: product(item), record: product(item) })
    }
    const limit = ids ? 100 : 20
    const fields = hasServer ? `${productFields},p.server_number` : productFields
    const rows = await db.prepare(`SELECT ${fields}${from} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...values, limit, ids ? 0 : (page - 1) * limit).all()
    return json({ records: rows.results.map(product), products: rows.results.map(product), total, pages: Math.max(1, Math.ceil(total / limit)) })
  }
  if (url.pathname === '/api/categories' || url.pathname === '/api/v1/categories') {
    const rows = await db.prepare(`SELECT c.id,c.slug,c.name,c.short_name,c.description,count(p.id) AS product_count FROM categories c LEFT JOIN ${storefront} p ON p.category_id=c.id WHERE c.active=1 GROUP BY c.id ORDER BY c.sort_order,c.id LIMIT 100`).all()
    return json({ records: rows.results })
  }
  if (url.pathname === '/api/orders' || url.pathname === '/api/v1/orders') {
    if (!user) throw new HttpError(401, 'Verified sign-in required.')
    const rows = await db.prepare('SELECT id,reference,payment_status,fulfillment_status,total_minor,currency,created_at FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 50').bind(user.id).all<{ id: string; payment_status: string; fulfillment_status: string }>()
    if (url.searchParams.get('purchases') !== 'true') return json({ records: rows.results })
    const items = await db.prepare("SELECT i.id,i.order_id,i.product_name,i.quantity,e.instructions FROM order_items i JOIN orders o ON o.id=i.order_id LEFT JOIN product_entitlements e ON e.order_item_id=i.id WHERE o.customer_id=? AND o.payment_status='paid' AND o.fulfillment_status='delivered' AND o.id IN (SELECT id FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 50)").bind(user.id, user.id).all<{ id: string; order_id: string; product_name: string; quantity: number; instructions: string | null }>()
    return json({ records: rows.results.filter(o => o.payment_status === 'paid' && o.fulfillment_status === 'delivered').map(o => ({ ...o, order_items: items.results.filter(i => i.order_id === o.id).map(i => ({ id: i.id, product_name: i.product_name, quantity: i.quantity, product_entitlements: i.instructions ? { instructions: i.instructions } : null })) })) })
  }
  return null
}
export async function publicReviews(request: Request, env: ApiEnv) {
  const page = Math.min(10000, Math.max(1, Math.floor(Number(new URL(request.url).searchParams.get('page')) || 1)))
  const from = " FROM reviews r JOIN order_items i ON i.id=r.order_item_id JOIN orders o ON o.id=i.order_id WHERE r.status='approved' AND r.author_id=o.customer_id AND o.payment_status='paid' AND o.fulfillment_status='delivered'"
  const total = (await env.DB!.prepare('SELECT count(*) n' + from).first<{ n: number }>())!.n
  const rows = await env.DB!.prepare('SELECT r.id,r.display_name,r.location,r.rating,r.message,1 AS verified_purchase' + from + ' ORDER BY r.created_at DESC,r.id LIMIT 6 OFFSET ?').bind((page - 1) * 6).all()
  return json({ reviews: rows.results, pages: Math.max(1, Math.ceil(total / 6)) })
}
export async function customerWrite(request: Request, env: ApiEnv, user: Customer) {
  const url = new URL(request.url)
  if (!['/api/support', '/api/reviews'].includes(url.pathname)) return null
  if (request.method !== 'POST') throw new HttpError(405, 'Method not permitted.')
  if (request.headers.get('Origin') !== url.origin) throw new HttpError(403, 'Same-origin request required.')
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'JSON required.')
  const reader = request.body?.getReader(); if (!reader) throw new HttpError(400, 'Body required.')
  const chunks: Uint8Array[] = []; let size = 0
  while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 16384) { await reader.cancel(); throw new HttpError(413, 'Request too large.') }; chunks.push(next.value) }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  let body: Record<string, unknown>
  try { body = JSON.parse(new TextDecoder().decode(bytes)); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error() } catch { throw new HttpError(400, 'Invalid JSON.') }
  const text = (key: string, min: number, max: number) => { const value = body[key]; if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new HttpError(400, `Invalid ${key}.`); return value.trim() }
  const id = crypto.randomUUID()
  if (url.pathname === '/api/support') {
    await env.DB!.batch([env.DB!.prepare('INSERT INTO support_tickets(id,user_id,subject,message) VALUES(?,?,?,?)').bind(id, user.id, text('subject', 1, 200), text('message', 10, 2000)),env.DB!.prepare("INSERT INTO business_mail_events(id,kind,user_id,created_at) VALUES(?,'support_received',?,?)").bind(id,user.id,Date.now())])
  } else {
    const item = text('item_uuid', 36, 36), rating = body.stars
    if (!Number.isInteger(rating) || Number(rating) < 1 || Number(rating) > 5) throw new HttpError(400, 'Invalid rating.')
    const row = await env.DB!.prepare("INSERT INTO reviews(id,author_id,order_item_id,display_name,rating,message,location) SELECT ?,?,i.id,?,?,?,? FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.id=? AND o.customer_id=? AND o.payment_status='paid' AND o.fulfillment_status='delivered' ON CONFLICT(order_item_id) DO NOTHING RETURNING id").bind(id, user.id, text('customer_name', 2, 80), Number(rating), text('feedback', 20, 2000), text('customer_location', 0, 100), item, user.id).first()
    if (!row) throw new HttpError(409, 'Eligible delivered purchase required; each item can be reviewed once.')
  }
  return json({ id, saved: true }, 201)
}
