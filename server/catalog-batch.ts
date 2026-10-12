import { HttpError } from './auth.ts'
import type { Env } from './auth.ts'
import { supplierBackend, supplierStorageError } from './catalog-sync.ts'
import { openCredential } from './supplier-crypto.ts'
import { productImages } from '../src/lib/product-images.ts'
import { categoriesFrom, collection, DESCRIPTION_REQUIRED, identifier, listingsFrom, pageIsComplete, record, resaleAllowlist, SupplierReadError, supplierOrigin, youngpgGet } from './youngpg.ts'

type Category = ReturnType<typeof categoriesFrom>[number]
type Product = ReturnType<typeof listingsFrom>['products'][number]
export async function readBatchResource(base: string, key: string, resource: Parameters<typeof youngpgGet>[2], page = 1, sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))) {
  // One resource per invocation, at most three reads. Long rate-limit waits are
  // persisted by failure cleanup instead of occupying a Function invocation.
  for (let attempt = 0; ; attempt++) {
    try { return await youngpgGet(base, key, resource, page) }
    catch (error) {
      if (!(error instanceof SupplierReadError) || attempt >= 2 || error.status === 429 || error.retryAfterMs > 5000) throw error
      await sleep(Math.max(1200, error.retryAfterMs, 1000 * 2 ** attempt))
    }
  }
}

export function listingBatch(response: ReturnType<typeof record>, page: number, categories: Category[], approved: Record<string, string>) {
  const values = collection(response)
  pageIsComplete(response, page, values.rows.length)
  const meta = record(values.meta)
  const total = meta.total == null ? null : Number(meta.total)
  if (total !== null && (!Number.isSafeInteger(total) || total < 0 || total > 100000)) throw new HttpError(502, 'Invalid supplier pagination total.')
  const mapped = listingsFrom(values.rows, categories, approved)
  const products = new Map(mapped.products.map(product => [product.id, product]))
  const seen = new Set<string>()
  const rows = values.rows.map(value => {
    const id = identifier(record(value).id)
    if (seen.has(id)) throw new HttpError(502, 'Duplicate supplier listing IDs; snapshot rejected.')
    seen.add(id)
    return { id, product: products.get(id) ?? null }
  })
  return { phase: 'listings', page, last_page: Number(meta.last_page), total, categories: mapped.categories, rows }
}

export function detailBatch(product: Product, detail: ReturnType<typeof record>, categories: Category[], approved: Record<string, string>) {
  if (identifier(detail.id) !== product.id) throw new HttpError(502, 'Supplier detail identifier mismatch.')
  const category = categories.find(item => item.id === product.category_id)
  if (!category) throw new HttpError(502, 'Supplier detail category checkpoint mismatch.')
  // Reuse the same authorization, metadata, description and stock validation.
  // Only optional public metadata comes from detail; never detail price/stock.
  const candidate = {
    id: product.id, title: product.name, category: { slug: category.slug, title: category.name },
    description: product.description === DESCRIPTION_REQUIRED ? detail.description : product.description,
    price_ngn: `${Math.floor(product.cost_minor / 100)}.${String(product.cost_minor % 100).padStart(2, '0')}`,
    available_stock: product.stock, slug: product.slug, status: detail.status ?? product.supplier_status,
    image_urls: [...new Set([...productImages(product), ...productImages(detail)])],
    subcategory: detail.subcategory ?? (product.subcategory_id ? { id: product.subcategory_id } : undefined),
  }
  return { phase: 'details', id: product.id, product: listingsFrom([candidate], categories, approved).products[0] ?? null }
}

export async function syncSupplierBatch(env: Env, id: string, expectedJob?: string) {
  const db = supplierBackend(env)
  let token: string | undefined
  try {
    const config = await db.from('supplier_connections').select('*').eq('id', id).maybeSingle()
    if (config.error) throw supplierStorageError('read configuration', config.error)
    if (!config.data?.enabled) throw new HttpError(409, 'Save and enable the supplier first.')
    if (config.data.provider !== 'youngpg' || config.data.auth_method !== 'X-API-Key') throw new HttpError(400, 'Unsupported supplier adapter or authentication method.')
    supplierOrigin(config.data.base_url)
    const claimed = await db.rpc('claim_supplier_sync_batch', { connection_uuid: id, expected_job: expectedJob ?? null })
    if (claimed.error) throw supplierStorageError('claim checkpoint (202610120002 required)', claimed.error)
    if (!claimed.data) throw new HttpError(429, 'Supplier is busy or cooling down. Retry later; saved progress is retained.')
    const job = record(claimed.data)
    if (job.done === true) return { success: true, done: true, connection_id: id, job_id: job.job_id, imported: job.imported, scanned: job.scanned, detail_enrichment_skipped: job.detail_enrichment_skipped }
    token = String(job.token)
    if (job.revision !== config.data.revision) throw new HttpError(409, 'Supplier configuration changed; resume with current configuration.')
    const approved = resaleAllowlist(config.data.authorized_products)
    if (!Object.keys(approved).length) throw new HttpError(409, 'Add verified product-ID resale evidence before importing.')
    const key = await openCredential(config.data.encrypted_key, config.data.key_nonce, id, env.SUPPLIER_ENCRYPTION_KEY)
    const categories = job.categories as Category[]
    let batch: object
    if (job.phase === 'categories') batch = { phase: 'categories', categories: categoriesFrom(await readBatchResource(config.data.base_url, key, 'categories')) }
    else if (job.phase === 'listings') batch = listingBatch(await readBatchResource(config.data.base_url, key, 'listings', Number(job.page)), Number(job.page), categories, approved)
    else if (job.phase === 'details' && job.detail) {
      const product = record(job.detail) as Product
      try {
        batch = detailBatch(product, record((await readBatchResource(config.data.base_url, key, `listings/${identifier(product.slug)}`)).data), categories, approved)
      } catch (error) {
        if (!(error instanceof SupplierReadError) || error.failureKind !== 'network') throw error
        batch = { phase: 'details', skip_network: true }
      }
    } else if (job.phase === 'details' || job.phase === 'finalize') batch = { phase: job.phase }
    else throw new HttpError(409, 'Unsupported synchronization checkpoint.')
    const saved = await db.rpc('commit_supplier_sync_batch', { connection_uuid: id, token, job_uuid: job.job_id, batch })
    if (saved.error) throw supplierStorageError('commit checkpoint', saved.error)
    token = undefined
    const receipt = record(saved.data)
    return { success: true, done: receipt.done === true, connection_id: id, job_id: receipt.job_id, imported: receipt.imported, scanned: receipt.scanned, approval_required: true, detail_enrichment_skipped: receipt.detail_enrichment_skipped }
  } catch (problem) {
    if (token) {
      const failure = problem instanceof HttpError ? problem.message.slice(0, 300) : 'Supplier batch failed; saved checkpoint retained.'
      const cleanup = await db.rpc('finish_supplier_connection', { connection_uuid: id, token, snapshot: problem instanceof SupplierReadError ? { retry_after_ms: problem.retryAfterMs } : null, failure })
      if (cleanup.error) throw new HttpError(problem instanceof HttpError ? problem.status : 503, `${failure} ${supplierStorageError('record failure', cleanup.error).message}`)
    }
    throw problem
  }
}
