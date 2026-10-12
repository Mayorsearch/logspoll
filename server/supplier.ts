import { HttpError } from './auth.ts'
import type { Env } from './auth.ts'
type Obj = Record<string, unknown>
const object = (value: unknown): Obj => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(502, 'Supplier response schema is invalid.'); return value as Obj }
const text = (value: unknown, max: number): string => { if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new HttpError(502, 'Supplier metadata is invalid.'); return value.trim() }
const id = (value: unknown) => { const result = String(value ?? ''); if (!/^[0-9]{1,20}$/.test(result)) throw new HttpError(502, 'Supplier identifier is invalid.'); return result }
const forbidden = /\b(accounts?|logs?|cookies?|sessions?|passwords?|credentials?|compromised|stolen|hacked|facebook|instagram|twitter|tiktok|inboxes|inbox|tokens?)\b/i
export function authorizedProducts(value: string | undefined): Record<string, string> {
  try {
    const parsed = object(JSON.parse(value ?? '{}'))
    const entries = Object.entries(parsed)
    if (!entries.length || entries.length > 500) throw new Error()
    if (entries.some(([, evidence]) => typeof evidence !== 'string' || evidence.trim().length < 5)) throw new Error()
    return Object.fromEntries(entries.map(([key, evidence]) => [id(key), text(evidence, 1000)]))
  } catch { throw new HttpError(503, 'A verified resale authorization allowlist is required.') }
}
// Adapter contract is deliberately explicit. Do not enable until verified against official response examples.
// Expected: { categories: [{ id, name, products: [{id,name,description,price,amount}] }] }.
export function normalizeCatalog(payload: unknown, approved: Record<string, string>, currency: string) {
  if (!['NGN', 'USD'].includes(currency)) throw new HttpError(503, 'Verified supplier cost currency is required.')
  const source = object(payload)
  if (!Array.isArray(source.categories) || source.categories.length > 500) throw new HttpError(502, 'Supplier category response schema is invalid.')
  const categories: { id: string; name: string }[] = []
  const products: { id: string; category_id: string; name: string; description: string; cost_minor: number; currency: string; stock: number; authorization_ref: string }[] = []
  const seen = new Set<string>()
  const categoryIds = new Set<string>()
  for (const input of source.categories) {
    const category = object(input)
    const categoryId = id(category.id)
    if (!Array.isArray(category.products) || category.products.length > 10000 || categoryIds.has(categoryId)) throw new HttpError(502, 'Supplier category contents are invalid.')
    categoryIds.add(categoryId)
    let eligible = false
    for (const inputProduct of category.products) {
      const product = object(inputProduct)
      const externalId = id(product.id)
      if (!Object.hasOwn(approved, externalId)) continue
      if (seen.has(externalId)) throw new HttpError(502, 'Supplier response contains duplicate product IDs.')
      seen.add(externalId)
      const name = text(product.name, 200)
      const description = text(product.description, 10000)
      if (forbidden.test(name + ' ' + description)) continue
      const price = String(product.price ?? '')
      const stock = Number(product.amount)
      if (!/^\d{1,9}(\.\d{1,2})?$/.test(price) || product.amount === null || product.amount === undefined || !/^\d+$/.test(String(product.amount)) || !Number.isSafeInteger(stock) || stock < 0 || stock > 1000000) throw new HttpError(502, 'Supplier pricing or inventory is invalid.')
      const [whole, cents = ''] = price.split('.')
      const cost = Number(whole) * 100 + Number(cents.padEnd(2, '0'))
      if (cost > 99999999900) throw new HttpError(502, 'Supplier price exceeds supported limits.')
      products.push({ id: externalId, category_id: categoryId, name, description, cost_minor: cost, currency, stock, authorization_ref: text(approved[externalId], 1000) })
      eligible = true
    }
    if (eligible) categories.push({ id: categoryId, name: text(category.name, 120) })
  }
  if (products.length > 500) throw new HttpError(502, 'Eligible catalog exceeds supported import size.')
  return { categories, products }
}
export async function supplierGet(env: Env, operation: 'products' | 'product', externalId?: string) {
  if (!env.SUPPLIER_API_KEY || env.SUPPLIER_SCHEMA_VERIFIED !== 'shopviaclone22-v1') throw new HttpError(503, 'Replacement supplier secret and verified response documentation are required.')
  const url = new URL(`https://shopviaclone22.com/api/${operation}.php`)
  url.searchParams.set('api_key', env.SUPPLIER_API_KEY)
  if (operation === 'product') url.searchParams.set('id', id(externalId))
  let response: Response
  try { response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } }) }
  catch { throw new HttpError(502, 'Supplier request failed. No credentials or upstream details are logged.') }
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new HttpError(502, 'Supplier returned an unavailable or unsupported response.')
  const reader = response.body?.getReader()
  if (!reader) throw new HttpError(502, 'Supplier response was empty.')
  const chunks: Uint8Array[] = []; let length = 0
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.length; if (length > 2_000_000) { await reader.cancel(); throw new Error() }; chunks.push(chunk.value) }
    const bytes = new Uint8Array(length); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch { throw new HttpError(502, 'Supplier response could not be validated.') }
}
