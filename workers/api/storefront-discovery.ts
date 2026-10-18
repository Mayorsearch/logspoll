import { adminActor, bodyJSON } from './admin.ts'
import { HttpError, json } from './http.ts'
import type { ApiEnv, Database } from './types.ts'

export type StorefrontDiscoveryConfig = {
  rotation_enabled: boolean
  affordable_priority_enabled: boolean
  affordable_max_minor: number
  affordable_weight: number
  featured_weight: number
  new_weight: number
  products_per_page: number
  updated_at: number
}

export type StorefrontProduct = {
  id: string
  category_id: string
  slug: string
  name: string
  brand?: string | null
  description: string
  price_minor: number
  currency: string
  delivery_type?: string | null
  image_path?: string | null
  term?: string | null
  features: string[]
  supplier_image_urls: string[]
  featured: number
  available_quantity: number
  server_number?: number | null
  created_at?: string | null
  category_name?: string | null
  category_slug?: string | null
}

/**
 * Deterministic pseudo-random number generator (Mulberry32)
 */
export function createPRNG(seedStr: string): () => number {
  let h = 0x811c9dc5
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  let s = h >>> 0
  return function () {
    let t = (s += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Deterministic Fisher-Yates shuffle using PRNG
 */
export function seededShuffle<T>(array: T[], prng: () => number): T[] {
  const result = [...array]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1))
    const temp = result[i]
    result[i] = result[j]
    result[j] = temp
  }
  return result
}

/**
 * Loads discovery configuration from D1 with safe defaults
 */
export async function getDiscoveryConfig(db: Database): Promise<StorefrontDiscoveryConfig> {
  const row = await db
    .prepare(
      `SELECT rotation_enabled, affordable_priority_enabled, affordable_max_minor,
              affordable_weight, featured_weight, new_weight, products_per_page, updated_at
       FROM storefront_discovery_config WHERE id='global'`
    )
    .first<{
      rotation_enabled: number
      affordable_priority_enabled: number
      affordable_max_minor: number
      affordable_weight: number
      featured_weight: number
      new_weight: number
      products_per_page: number
      updated_at: number
    }>()
    .catch(() => null)

  return {
    rotation_enabled: row ? row.rotation_enabled === 1 : true,
    affordable_priority_enabled: row ? row.affordable_priority_enabled === 1 : true,
    affordable_max_minor: row?.affordable_max_minor ?? 1500000, // ₦15,000.00
    affordable_weight: row?.affordable_weight ?? 65,
    featured_weight: row?.featured_weight ?? 20,
    new_weight: row?.new_weight ?? 15,
    products_per_page: row?.products_per_page ?? 20,
    updated_at: row?.updated_at ?? 0,
  }
}

function parseProductRow(row: Record<string, unknown>): StorefrontProduct {
  let features: string[] = []
  let supplier_image_urls: string[] = []
  try {
    features = JSON.parse(String(row.features ?? '[]'))
  } catch {}
  try {
    supplier_image_urls = JSON.parse(String(row.supplier_image_urls ?? '[]'))
  } catch {}

  return {
    id: String(row.id),
    category_id: String(row.category_id),
    slug: String(row.slug),
    name: String(row.name),
    brand: row.brand ? String(row.brand) : null,
    description: String(row.description ?? ''),
    price_minor: Number(row.price_minor ?? 0),
    currency: String(row.currency ?? 'NGN'),
    delivery_type: row.delivery_type ? String(row.delivery_type) : null,
    image_path: row.image_path ? String(row.image_path) : null,
    term: row.term ? String(row.term) : null,
    features,
    supplier_image_urls,
    featured: Number(row.featured ?? 0),
    available_quantity: Number(row.available_quantity ?? 0),
    server_number: row.server_number !== undefined && row.server_number !== null ? Number(row.server_number) : null,
    created_at: row.created_at ? String(row.created_at) : null,
    category_name: row.category_name ? String(row.category_name) : null,
    category_slug: row.category_slug ? String(row.category_slug) : null,
  }
}

/**
 * Builds weighted interleaved discovery sequence preserving:
 * - Budget-friendly items priority (~65%)
 * - Featured / popular items (~20%)
 * - New / recently added items (~15%)
 * - Multi-supplier diversity (mixes Server 1, Server 2, Server 3, Server 4)
 * - Deterministic sequence given seed
 */
export function buildDiscoverySequence(
  products: StorefrontProduct[],
  config: StorefrontDiscoveryConfig,
  seed: string
): StorefrontProduct[] {
  if (!config.rotation_enabled || products.length <= 1) {
    return products
  }

  const prng = createPRNG(seed)
  const affordableMax = config.affordable_max_minor

  // 1. Partition products
  const budgetPool: StorefrontProduct[] = []
  const featuredPool: StorefrontProduct[] = []
  const newPool: StorefrontProduct[] = []
  const otherPool: StorefrontProduct[] = []

  // Sort by created_at descending for recency reference
  const sortedByNew = [...products].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0
    return tb - ta
  })
  const recentThresholdCount = Math.min(30, Math.ceil(products.length * 0.25))
  const recentIds = new Set(sortedByNew.slice(0, recentThresholdCount).map((p) => p.id))

  for (const p of products) {
    if (config.affordable_priority_enabled && p.price_minor <= affordableMax) {
      budgetPool.push(p)
    } else if (p.featured === 1) {
      featuredPool.push(p)
    } else if (recentIds.has(p.id)) {
      newPool.push(p)
    } else {
      otherPool.push(p)
    }
  }

  // Shuffle pools deterministically
  const shuffledBudget = seededShuffle(budgetPool, prng)
  const shuffledFeatured = seededShuffle(featuredPool, prng)
  const shuffledNew = seededShuffle(newPool, prng)
  const shuffledOther = seededShuffle(otherPool, prng)

  // Track used product IDs to avoid any duplicate
  const pickedIds = new Set<string>()
  const sequence: StorefrontProduct[] = []

  // Ensure diverse server distribution
  const serverRoundRobin: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }

  function pickBestFrom(list: StorefrontProduct[]): StorefrontProduct | null {
    if (list.length === 0) return null
    for (let i = 0; i < list.length; i++) {
      const candidate = list[i]
      if (!pickedIds.has(candidate.id)) {
        list.splice(i, 1)
        pickedIds.add(candidate.id)
        if (candidate.server_number) {
          serverRoundRobin[candidate.server_number] = (serverRoundRobin[candidate.server_number] || 0) + 1
        }
        return candidate
      }
    }
    return null
  }

  const totalTarget = products.length
  const totalWeight = config.affordable_weight + config.featured_weight + config.new_weight
  const budgetRatio = config.affordable_weight / totalWeight
  const featuredRatio = (config.affordable_weight + config.featured_weight) / totalWeight

  while (sequence.length < totalTarget) {
    const roll = prng()
    let picked: StorefrontProduct | null = null

    if (roll < budgetRatio && shuffledBudget.length > 0) {
      picked = pickBestFrom(shuffledBudget)
    } else if (roll < featuredRatio && shuffledFeatured.length > 0) {
      picked = pickBestFrom(shuffledFeatured)
    } else if (shuffledNew.length > 0) {
      picked = pickBestFrom(shuffledNew)
    }

    // Fallbacks if designated pool was exhausted
    if (!picked && shuffledBudget.length > 0) picked = pickBestFrom(shuffledBudget)
    if (!picked && shuffledFeatured.length > 0) picked = pickBestFrom(shuffledFeatured)
    if (!picked && shuffledNew.length > 0) picked = pickBestFrom(shuffledNew)
    if (!picked && shuffledOther.length > 0) picked = pickBestFrom(shuffledOther)

    if (picked) {
      sequence.push(picked)
    } else {
      break
    }
  }

  // Append any remaining items that weren't picked
  for (const p of products) {
    if (!pickedIds.has(p.id)) {
      sequence.push(p)
      pickedIds.add(p.id)
    }
  }

  return sequence
}

/**
 * Main public endpoint: GET /api/storefront/discovery
 */
export async function handleStorefrontDiscovery(request: Request, env: ApiEnv): Promise<Response> {
  const url = new URL(request.url)
  const db = env.DB!

  const config = await getDiscoveryConfig(db)

  // Seed for deterministic rotation (default to timestamp-based string if not provided)
  const seed = (url.searchParams.get('seed') || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`).slice(0, 64)
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1))
  const limit = Math.min(50, Math.max(1, Math.floor(Number(url.searchParams.get('limit')) || config.products_per_page)))
  const section = url.searchParams.get('section') || 'all'
  const category = url.searchParams.get('category')?.trim()
  const server = url.searchParams.get('server')?.trim()
  const q = url.searchParams.get('q')?.trim()

  const predicates = ['1=1']
  const values: (string | number)[] = []

  if (category) {
    predicates.push('c.slug = ?')
    values.push(category)
  }
  if (server && ['1', '2', '3', '4'].includes(server)) {
    predicates.push('p.server_number = ?')
    values.push(Number(server))
  }
  if (q) {
    predicates.push('(instr(lower(p.name), lower(?)) > 0 OR instr(lower(p.description), lower(?)) > 0)')
    values.push(q, q)
  }

  const querySql = `
    SELECT p.id, p.category_id, p.slug, p.name, p.brand, p.description, p.price_minor,
           p.currency, p.delivery_type, p.image_path, p.term, p.features, p.supplier_image_urls,
           p.featured, p.available_quantity, p.server_number, p.created_at,
           c.name AS category_name, c.slug AS category_slug
    FROM storefront_products p
    JOIN categories c ON c.id = p.category_id
    WHERE ${predicates.join(' AND ')}
  `

  const rows = await db.prepare(querySql).bind(...values).all<Record<string, unknown>>()
  const allProducts = (rows.results || []).map(parseProductRow)

  // Top categories for quick visual category navigation
  const categoryStats = await db
    .prepare(
      `SELECT c.id, c.slug, c.name, c.short_name, count(p.id) AS product_count
       FROM categories c
       JOIN storefront_products p ON p.category_id = c.id
       WHERE c.active = 1
       GROUP BY c.id
       HAVING product_count > 0
       ORDER BY c.sort_order, product_count DESC
       LIMIT 12`
    )
    .all<{ id: string; slug: string; name: string; short_name: string; product_count: number }>()
    .catch(() => ({ results: [] }))

  // Build the deterministic sequence
  const discoverySequence = buildDiscoverySequence(allProducts, config, seed)

  // Subsections
  const budgetPrng = createPRNG(`${seed}_budget`)
  const budgetProducts = seededShuffle(
    allProducts.filter((p) => p.price_minor <= config.affordable_max_minor),
    budgetPrng
  ).slice(0, 10)

  const recentProducts = [...allProducts]
    .sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      return tb - ta
    })
    .slice(0, 10)

  const morePrng = createPRNG(`${seed}_more`)
  const moreToExplore = seededShuffle(
    allProducts.filter((p) => !budgetProducts.some((b) => b.id === p.id) && !recentProducts.some((r) => r.id === p.id)),
    morePrng
  ).slice(0, 12)

  // Slice paginated discovery items
  const offset = (page - 1) * limit
  const paginatedDiscovery = discoverySequence.slice(offset, offset + limit)
  const total = discoverySequence.length
  const totalPages = Math.max(1, Math.ceil(total / limit))

  const payload: Record<string, unknown> = {
    seed,
    page,
    limit,
    total,
    pages: totalPages,
    config: {
      rotation_enabled: config.rotation_enabled,
      affordable_priority_enabled: config.affordable_priority_enabled,
      affordable_max_minor: config.affordable_max_minor,
      affordable_weight: config.affordable_weight,
    },
    discover: paginatedDiscovery,
  }

  if (section === 'all') {
    payload.budget_friendly = budgetProducts
    payload.recently_added = recentProducts
    payload.more_to_explore = moreToExplore.length > 0 ? moreToExplore : discoverySequence.slice(10, 20)
    payload.categories = categoryStats.results || []
  } else if (section === 'budget') {
    const budgetAll = allProducts.filter((p) => p.price_minor <= config.affordable_max_minor)
    const budgetPaged = seededShuffle(budgetAll, budgetPrng)
    payload.records = budgetPaged.slice(offset, offset + limit)
    payload.total = budgetAll.length
    payload.pages = Math.max(1, Math.ceil(budgetAll.length / limit))
  } else if (section === 'recent') {
    payload.records = recentProducts.slice(offset, offset + limit)
    payload.total = recentProducts.length
    payload.pages = Math.max(1, Math.ceil(recentProducts.length / limit))
  }

  const response = json(payload)
  // Ensure Cloudflare edge never caches dynamic randomized discovery sequences
  response.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate')
  response.headers.set('Pragma', 'no-cache')
  return response
}

/**
 * Admin controls endpoint: GET & POST /api/admin/storefront-discovery
 */
export async function handleAdminStorefrontDiscovery(request: Request, env: ApiEnv): Promise<Response> {
  await adminActor(request, env)
  const db = env.DB!

  if (request.method === 'GET') {
    const config = await getDiscoveryConfig(db)

    // Calculate live catalog stats for admin preview
    const stats = await db
      .prepare(
        `SELECT
           count(*) AS total_products,
           sum(CASE WHEN price_minor <= ? THEN 1 ELSE 0 END) AS affordable_count,
           sum(CASE WHEN featured = 1 THEN 1 ELSE 0 END) AS featured_count,
           sum(CASE WHEN server_number = 1 THEN 1 ELSE 0 END) AS server1_count,
           sum(CASE WHEN server_number = 2 THEN 1 ELSE 0 END) AS server2_count,
           sum(CASE WHEN server_number = 3 THEN 1 ELSE 0 END) AS server3_count,
           sum(CASE WHEN server_number = 4 THEN 1 ELSE 0 END) AS server4_count,
           min(price_minor) AS min_price_minor,
           max(price_minor) AS max_price_minor
         FROM storefront_products`
      )
      .bind(config.affordable_max_minor)
      .first<{
        total_products: number
        affordable_count: number
        featured_count: number
        server1_count: number
        server2_count: number
        server3_count: number
        server4_count: number
        min_price_minor: number
        max_price_minor: number
      }>()
      .catch(() => null)

    return json({
      config,
      catalog_stats: stats || {
        total_products: 0,
        affordable_count: 0,
        featured_count: 0,
        server1_count: 0,
        server2_count: 0,
        server3_count: 0,
        server4_count: 0,
        min_price_minor: 0,
        max_price_minor: 0,
      },
    })
  }

  if (request.method !== 'POST') {
    throw new HttpError(405, 'POST required.')
  }

  const body = await bodyJSON(request, 4096)

  const rotationEnabled = body.rotation_enabled === true || body.rotation_enabled === 1 ? 1 : 0
  const affordablePriorityEnabled = body.affordable_priority_enabled === true || body.affordable_priority_enabled === 1 ? 1 : 0
  const affordableMaxMinor = Math.max(10000, Math.floor(Number(body.affordable_max_minor) || 1500000))
  const affordableWeight = Math.min(100, Math.max(0, Math.floor(Number(body.affordable_weight) || 65)))
  const featuredWeight = Math.min(100, Math.max(0, Math.floor(Number(body.featured_weight) || 20)))
  const newWeight = Math.min(100, Math.max(0, Math.floor(Number(body.new_weight) || 15)))
  const productsPerPage = Math.min(50, Math.max(10, Math.floor(Number(body.products_per_page) || 20)))

  const now = Date.now()

  await db
    .prepare(
      `INSERT INTO storefront_discovery_config(
         id, rotation_enabled, affordable_priority_enabled, affordable_max_minor,
         affordable_weight, featured_weight, new_weight, products_per_page, updated_at
       ) VALUES('global', ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         rotation_enabled = excluded.rotation_enabled,
         affordable_priority_enabled = excluded.affordable_priority_enabled,
         affordable_max_minor = excluded.affordable_max_minor,
         affordable_weight = excluded.affordable_weight,
         featured_weight = excluded.featured_weight,
         new_weight = excluded.new_weight,
         products_per_page = excluded.products_per_page,
         updated_at = excluded.updated_at`
    )
    .bind(
      rotationEnabled,
      affordablePriorityEnabled,
      affordableMaxMinor,
      affordableWeight,
      featuredWeight,
      newWeight,
      productsPerPage,
      now
    )
    .run()

  return json({
    saved: true,
    message: 'Storefront discovery configuration saved successfully.',
    config: {
      rotation_enabled: rotationEnabled === 1,
      affordable_priority_enabled: affordablePriorityEnabled === 1,
      affordable_max_minor: affordableMaxMinor,
      affordable_weight: affordableWeight,
      featured_weight: featuredWeight,
      new_weight: newWeight,
      products_per_page: productsPerPage,
      updated_at: now,
    },
  })
}

