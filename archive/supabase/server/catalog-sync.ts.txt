import { createClient } from '@supabase/supabase-js'
import { HttpError } from './auth.ts'
import type { Env } from './auth.ts'
import { openCredential } from './supplier-crypto.ts'
import { productImages } from '../src/lib/product-images.ts'
import { syncSupplierBatch } from './catalog-batch.ts'
import { categoriesFrom, collection, identifier, listingsFrom, missingDescription, pageIsComplete, record, resaleAllowlist, subcategoriesFrom, SupplierReadError, supplierOrigin, youngpgGet, youngpgRequestTimeout } from './youngpg.ts'

export function supplierBackend(env: Env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new HttpError(503, 'Configure the server-only SUPABASE_SERVICE_ROLE_KEY in Pages Functions secrets.')
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: {
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([AbortSignal.timeout(10000), ...(init?.signal ? [init.signal] : [])]) }),
  } })
}
type StorageOperation = 'read configuration' | 'claim lease' | 'verify revision' | 'save progress' | 'finalize snapshot' | 'record failure' | 'list connections' | 'save configuration' | 'claim checkpoint (202610120002 required)' | 'commit checkpoint'
export function supplierStorageError(operation: StorageOperation, error: { code?: string; message?: string } | null) {
  // Never return raw messages, details, hints, constraint names or arbitrary codes.
  const categories: Record<string, string> = {
    '42P01': 'missing table', PGRST205: 'missing table', '42703': 'missing column', PGRST204: 'missing column',
    '42883': 'missing RPC', PGRST202: 'missing RPC', '42501': 'permission denied',
    '23503': 'foreign-key constraint', '23514': 'validation constraint', '23505': 'duplicate constraint',
    '22023': 'invalid parameter', '22P02': 'invalid value', '57014': 'database timeout',
    '40001': 'concurrent update', '55P03': 'database lock', P0001: 'database guard rejected operation',
  }
  const expired = error?.code === 'P0001' && error.message === 'Supplier lease expired'
  const category = expired ? 'lease expired; retry after the current operation ends' : error?.code && Object.hasOwn(categories, error.code) ? categories[error.code] : 'transport or unclassified database failure'
  return new HttpError(expired ? 409 : 503, `Supplier storage: ${operation}: ${category}. Verify supplier migrations and server configuration.`)
}

export async function readCatalog(base: string, key: string, approved: Record<string, string>, options: {
  sleep?: (ms: number) => Promise<void>; now?: () => number; progress?: (status: string) => Promise<void>; categoriesOnly?: boolean
} = {}) {
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const now = options.now ?? Date.now
  const deadline = now() + 240000 // Complete within the existing five-minute DB lease.
  let lastRequest = -Infinity
  const get = async (resource: Parameters<typeof youngpgGet>[2], page = 1) => {
    const timeoutMs = youngpgRequestTimeout(resource)
    for (let attempt = 0; ; attempt++) {
      const wait = Math.max(0, lastRequest + 1200 - now()) // <=50 reads/minute/key, leaving headroom.
      if (now() + wait + timeoutMs >= deadline) throw new HttpError(502, 'Catalog exceeded the safe sync window. No partial inventory was published; smaller resumable jobs are required.')
      if (wait) await sleep(wait)
      lastRequest = now()
      try { return await youngpgGet(base, key, resource, page) }
      catch (error) {
        if (!(error instanceof SupplierReadError) || attempt >= 2 || now() + Math.max(error.retryAfterMs, 1000 * 2 ** attempt) + 1200 + timeoutMs >= deadline) throw error
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
  let detailEnrichmentSkipped = 0
  let detailNetworkUnavailable = false
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
        if (detailNetworkUnavailable) {
          detailEnrichmentSkipped++
        } else {
          try {
            const detail = record((await get(`listings/${identifier(item.slug)}`)).data)
            if (identifier(detail.id) !== id) throw new HttpError(502, 'Supplier detail identifier mismatch.')
            // Price/stock always come from the complete listing snapshot.
            // Never copy credentials or private detail fields.
            candidate = { ...item, description: missingDescription(item.description) ? detail.description : item.description, image_urls: [...new Set([...productImages(item), ...productImages(detail)])], status: detail.status ?? item.status, subcategory: detail.subcategory ?? item.subcategory }
          } catch (error) {
            // Only an exhausted, low-level network failure on OPTIONAL detail
            // enrichment may fall back to the independently validated listing.
            // A 401/403, 429, bad JSON, wrong ID, or failed listings page remains fatal.
            if (!(error instanceof SupplierReadError) || error.failureKind !== 'network') throw error
            detailNetworkUnavailable = true // avoid another slow failure per product
            detailEnrichmentSkipped++
          }
        }
      }
      const mapped = listingsFrom([candidate], categories, approved)
      products.push(...mapped.products)
      for (const extra of mapped.categories) if (!categories.some(category => category.id === extra.id)) categories.push(extra)
    }
    await options.progress?.(`Reading catalog: page ${page}, ${scanned} scanned, ${products.length} eligible${detailEnrichmentSkipped ? `; ${detailEnrichmentSkipped} details not enriched` : ''}`)
    if (pageIsComplete(response, page, rows.length)) return { categories, subcategories, subcategories_complete: false, products, scanned, pages: page, detail_enrichment_skipped: detailEnrichmentSkipped }
  }
  throw new HttpError(502, 'Catalog exceeds the safe pagination limit; no partial inventory was imported.')
}

export async function syncSupplier(env: Env, id: string, action: 'test' | 'categories' | 'sync', expectedJob?: string) {
  return action === 'sync' ? syncSupplierBatch(env, id, expectedJob) : syncSupplierOperation(env, id, action)
}
async function syncSupplierOperation(env: Env, id: string, action: 'test' | 'categories' | 'sync') {
  const db = supplierBackend(env)
  let lease: string | undefined
  try {
    const config = await db.from('supplier_connections').select('*').eq('id', id).maybeSingle()
    if (config.error) throw supplierStorageError('read configuration', config.error)
    if (!config.data) throw new HttpError(404, 'Save the supplier configuration first.')
    if (!config.data.enabled) throw new HttpError(409, 'Enable and save the supplier before connecting.')
    if (config.data.provider !== 'youngpg' || config.data.auth_method !== 'X-API-Key') throw new HttpError(400, 'Unsupported supplier adapter or authentication method.')
    supplierOrigin(config.data.base_url)
    const claim = await db.rpc('claim_supplier_connection', { connection_uuid: id, operation: action })
    if (claim.error) throw supplierStorageError('claim lease', claim.error)
    if (!claim.data) throw new HttpError(429, 'Supplier is busy or cooling down. Retry later.')
    lease = String(claim.data)
    const locked = await db.from('supplier_connections').select('revision').eq('id', id).single()
    if (locked.error) throw supplierStorageError('verify revision', locked.error)
    if (locked.data.revision !== config.data.revision) throw new HttpError(409, 'Supplier configuration changed. Retry with the current configuration.')
    const key = await openCredential(config.data.encrypted_key, config.data.key_nonce, id, env.SUPPLIER_ENCRYPTION_KEY)
    const approved = resaleAllowlist(config.data.authorized_products)
    if (action === 'sync' && !Object.keys(approved).length) throw new HttpError(409, 'Add verified product-ID resale evidence before importing. No inventory is automatically authorized.')
    const snapshot = action === 'test'
      ? { categories: categoriesFrom(await youngpgGet(config.data.base_url, key, 'categories')), products: [], subcategories: [], scanned: 0, pages: 0 }
      : await readCatalog(config.data.base_url, key, approved, { categoriesOnly: action === 'categories', progress: async status => {
        const updated = await db.from('supplier_connections').update({ last_status: status }).eq('id', id).eq('lease_token', lease!).select('id')
        if (updated.error) throw supplierStorageError('save progress', updated.error)
        if (updated.data?.length !== 1) throw new HttpError(409, 'Supplier sync lease lost; no partial snapshot was committed.')
      } })
    const saved = await db.rpc('finish_supplier_connection', { connection_uuid: id, token: lease, snapshot, failure: null })
    if (saved.error) throw supplierStorageError('finalize snapshot', saved.error)
    lease = undefined
    return { success: true, categories: snapshot.categories, subcategories: snapshot.subcategories, scanned: snapshot.scanned, pages: snapshot.pages, ...(action === 'sync' ? { imported: saved.data, approval_required: true, detail_enrichment_skipped: 'detail_enrichment_skipped' in snapshot ? snapshot.detail_enrichment_skipped : 0 } : {}) }
  } catch (problem) {
    if (lease) {
      let cleanupError: { code?: string; message?: string } | null
      try {
        const cleanup = await db.rpc('finish_supplier_connection', { connection_uuid: id, token: lease, snapshot: problem instanceof SupplierReadError ? { retry_after_ms: problem.retryAfterMs } : null, failure: problem instanceof HttpError ? problem.message.slice(0, 300) : 'Supplier operation failed. Check server configuration.' })
        cleanupError = cleanup.error
      } catch { cleanupError = {} /* Never log credentials or upstream payloads. */ }
      if (cleanupError) {
        const original = problem instanceof HttpError ? problem : new HttpError(503, 'Supplier operation failed.')
        throw new HttpError(original.status, `${original.message} ${supplierStorageError('record failure', cleanupError).message}`)
      }
    }
    throw problem
  }
}
