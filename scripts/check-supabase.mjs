// Read-only probes: never print keys, tokens, rows, or upstream error messages.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
let local = ''
try { local = await readFile(`${root}.env.local`, 'utf8') } catch { /* Environment variables also supported. */ }
function setting(name) {
  const value = process.env[name] ?? local.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim() ?? ''
  return value.replace(/^(['"])(.*)\1$/, '$2')
}
const url = setting('VITE_SUPABASE_URL')
const key = setting('VITE_SUPABASE_PUBLISHABLE_KEY')
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !key.startsWith('sb_publishable_')) {
  console.error('Configure the existing hosted Supabase URL and public publishable key. No secrets are accepted.')
  process.exit(1)
}
const token = process.env.LOGSPOLL_VERIFY_TOKEN
const headers = { apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}) }
let failed = false
async function probe(path, label, privateResource = false) {
  try {
    const response = await fetch(`${url}${path}`, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) })
    const body = await response.json().catch(() => null)
    const code = typeof body?.code === 'string' && /^[A-Z0-9]{5,10}$/.test(body.code) ? body.code : ''
    const blocked = !token && privateResource && [401, 403].includes(response.status) && code === '42501'
    const unexpectedPublicAccess = !token && privateResource && response.ok
    if ((!response.ok && !blocked) || unexpectedPublicAccess) failed = true
    console.log(`${label}: HTTP ${response.status}${code ? ` / ${code}` : ''}${blocked ? ' (anonymous access denied as expected)' : ''}${unexpectedPublicAccess ? ' (FAIL: private resource publicly queryable)' : ''}`)
  } catch { failed = true; console.log(`${label}: unavailable (network or timeout; no authentication verified)`) }
}
await probe('/auth/v1/settings', 'Auth service')
if (token) await probe('/auth/v1/user', 'Authenticated identity')
// limit=0 validates API visibility/column references without retrieving customer records.
for (const [table, columns, privateResource] of [
  ['categories', 'id,slug,name', false],
  ['products', 'id,category_id,price_minor,currency,status', true],
  ['storefront_products', 'id,slug,price_minor,available_quantity', true],
  ['storefront_categories', 'slug,product_count', true],
  ['user_roles', 'user_id,role', true],
  ['profiles', 'id,full_name', true],
  ['orders', 'id,customer_id,payment_status,fulfillment_status', true],
  ['order_items', 'id,order_id', true],
  ['reviews', 'id,author_id,order_item_id,status', true],
]) await probe(`/rest/v1/${table}?select=${columns}&limit=0`, table, privateResource)
console.log('Read-only checks only. Signup, login, row isolation, writes and review eligibility are NOT verified.')
process.exitCode = failed ? 1 : 0
