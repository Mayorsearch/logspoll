import { createClient } from '@supabase/supabase-js'
import { HttpError } from './auth.ts'
import type { Env } from './auth.ts'
import { openCredential } from './supplier-crypto.ts'
import { productImages } from '../src/lib/product-images.ts'
import { categoriesFrom, collection, identifier, listingsFrom, missingDescription, pageIsComplete, record, resaleAllowlist, subcategoriesFrom, SupplierReadError, supplierOrigin, youngpgGet } from './youngpg.ts'

export function supplierBackend(env: Env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new HttpError(503, 'Configure the server-only SUPABASE_SERVICE_ROLE_KEY in Pages Functions secrets.')
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
}
const storageError = () => new HttpError(503, 'Supplier storage unavailable. Verify the reviewed supplier migrations and server configuration.')

export async function readCatalog(base: string, key: string, approved: Record<string, string>, options: {
  sleep?: (ms: number) => Promise<void>; now?: () => number; progress?: (status: string) => Promise<void>; categoriesOnly?: boolean
} = {}) {
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const now = options.now ?? Date.now
  const deadline = now() + 240000 // Complete within the existing five-minute DB lease.
  let lastRequest = -Infinity
  const get = async (resource: Parameters<typeof youngpgGet>[2], page = 1) => {
    for (let attempt = 0; ; attempt++) {
      const wait = Math.max(0, lastRequest + 1200 - now()) // <=50 reads/minute/key, leaving headroom.
      if (now() + wait + 10000 >= deadline) throw new HttpError(502, 'Catalog exceeded the safe sync window. No partial inventory was published; smaller resumable jobs are required.')
      if (wait) await sleep(wait)
      lastRequest = now()
      try { return await youngpgGet(base, key, resource, page) }
      catch (error) {
        if (!(error instanceof SupplierReadError) || attempt >= 2 || now() + error.retryAfterMs + 10000 >= deadline) throw error
        await sleep(Math.max(error.retryAfterMs, 1000 * 2 ** attempt))
      }
    }
  }
  const categories = categoriesFrom(await get('categories'))
  const subcategories: { id: string; slug: string; name: string; parent_id: string }[] = []
  // Subcategory reads take one API request per category. Keep that expensive
  // traversal in Fetch Categories; ordinary product sync fetches categories,
  // listings, and eligible detail metadata without deleting saved subcategories.
  if (options.categoriesOnly) {
    for (const category of categories) {
      await options.progress?.(`Reading subcategories: ${subcategories.length} loaded`)
      const response = await get(`categories/${identifier(category.id)}/subcategories`)
      subcategories.push(...subcategoriesFrom(response, category.id))
    }
    return { categories, subcategories, subcategories_complete: true, products: [], scanned: 0, pages: 0 }
  }
  const products: ReturnType<typeof listingsFrom>['products'] = []
  const seen = new Set<string>()
  let scanned = 0
  for (let page = 1; page <= 1000; page++) {
    const response = await get('listings', page)
    const rows = collection(response).rows
    for (const value of rows) {
      const item = record(value), id = identifier(item.id)
      if (seen.has(id)) throw new HttpError(502, 'Duplicate supplier listing IDs across pages; no partial snapshot was imported.')
      seen.add(id); scanned++
      // Read description details only for explicitly authorized, otherwise eligible metadata.
      if (!Object.hasOwn(approved, id)) continue
      if (!listingsFrom([item], categories, approved).products.length) continue
      let candidate = item
      if (item.slug != null) {
        const detail = record((await get(`listings/${identifier(item.slug)}`)).data)
        if (identifier(detail.id) !== id) throw new HttpError(502, 'Supplier detail identifier mismatch.')
        // Cost/stock come from the coherent listing page; private detail fields are discarded.
        candidate = { ...item, description: missingDescription(item.description) ? detail.description : item.description, image_urls: [...new Set([...productImages(item), ...productImages(detail)])], status: detail.status ?? item.status, subcategory: detail.subcategory ?? item.subcategory }
      }
      const mapped = listingsFrom([candidate], categories, approved)
      products.push(...mapped.products)
      for (const extra of mapped.categories) if (!categories.some(category => category.id === extra.id)) categories.push(extra)
    }
    await options.progress?.(`Reading catalog: page ${page}, ${scanned} scanned, ${products.length} eligible`)
    if (pageIsComplete(response, page, rows.length)) return { categories, subcategories, subcategories_complete: false, products, scanned, pages: page }
  }
  throw new HttpError(502, 'Catalog exceeds the safe pagination limit; no partial inventory was imported.')
}

export async function syncSupplier(env: Env, id: string, action: 'test' | 'categories' | 'sync') {
  const db = supplierBackend(env)
  let lease: string | undefined
  try {
    const config = await db.from('supplier_connections').select('*').eq('id', id).maybeSingle()
    if (config.error) throw storageError()
    if (!config.data) throw new HttpError(404, 'Save the supplier configuration first.')
    if (!config.data.enabled) throw new HttpError(409, 'Enable and save the supplier before connecting.')
    if (config.data.provider !== 'youngpg' || config.data.auth_method !== 'X-API-Key') throw new HttpError(400, 'Unsupported supplier adapter or authentication method.')
    supplierOrigin(config.data.base_url)
    const claim = await db.rpc('claim_supplier_connection', { connection_uuid: id, operation: action })
    if (claim.error) throw storageError()
    if (!claim.data) throw new HttpError(429, 'Supplier is busy or cooling down. Retry later.')
    lease = String(claim.data)
    const locked = await db.from('supplier_connections').select('revision').eq('id', id).single()
    if (locked.error || locked.data.revision !== config.data.revision) throw new HttpError(409, 'Supplier configuration changed. Retry with the current configuration.')
    const key = await openCredential(config.data.encrypted_key, config.data.key_nonce, id, env.SUPPLIER_ENCRYPTION_KEY)
    const approved = resaleAllowlist(config.data.authorized_products)
    if (action === 'sync' && !Object.keys(approved).length) throw new HttpError(409, 'Add verified product-ID resale evidence before importing. No inventory is automatically authorized.')
    const snapshot = action === 'test'
      ? { categories: categoriesFrom(await youngpgGet(config.data.base_url, key, 'categories')), products: [], subcategories: [], scanned: 0, pages: 0 }
      : await readCatalog(config.data.base_url, key, approved, { categoriesOnly: action === 'categories', progress: async status => {
        const updated = await db.from('supplier_connections').update({ last_status: status }).eq('id', id).eq('lease_token', lease!).select('id')
        if (updated.error) throw storageError()
        if (updated.data?.length !== 1) throw new HttpError(409, 'Supplier sync lease lost; no partial snapshot was committed.')
      } })
    const saved = await db.rpc('finish_supplier_connection', { connection_uuid: id, token: lease, snapshot, failure: null })
    if (saved.error) throw storageError()
    lease = undefined
    return { success: true, categories: snapshot.categories, subcategories: snapshot.subcategories, scanned: snapshot.scanned, pages: snapshot.pages, ...(action === 'sync' ? { imported: saved.data, approval_required: true } : {}) }
  } catch (problem) {
    if (lease) {
      try { await db.rpc('finish_supplier_connection', { connection_uuid: id, token: lease, snapshot: problem instanceof SupplierReadError ? { retry_after_ms: problem.retryAfterMs } : null, failure: problem instanceof HttpError ? problem.message.slice(0, 300) : 'Supplier operation failed. Check server configuration.' }) } catch { /* Never log credentials or upstream payloads. */ }
    }
    throw problem
  }
}
