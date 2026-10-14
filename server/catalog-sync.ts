import { HttpError } from './auth.ts'
import { productImages } from '../src/lib/product-images.ts'
import { categoriesFrom, collection, identifier, listingSlug, listingsFrom, missingDescription, pageIsComplete, record, subcategoriesFrom, SupplierReadError, youngpgGet, youngpgRequestTimeout } from './youngpg.ts'
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
            const detail = record((await get(`listings/${listingSlug(item.slug)}`)).data)
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
