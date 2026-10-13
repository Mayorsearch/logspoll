import { HttpError } from './auth.ts'
import { productImages } from '../src/lib/product-images.ts'
import { categoriesFrom, collection, DESCRIPTION_REQUIRED, identifier, listingsFrom, pageIsComplete, record, SupplierReadError, youngpgGet } from './youngpg.ts'
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
