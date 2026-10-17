import { createClient } from '@supabase/supabase-js'
export interface Env {
  SUPABASE_URL: string
  SUPABASE_PUBLISHABLE_KEY: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  SUPPLIER_ENCRYPTION_KEY?: string
  SUPPLIER_API_KEY?: string
  SUPPLIER_AUTHORIZED_PRODUCTS?: string
  SUPPLIER_SCHEMA_VERIFIED?: string
  SUPPLIER_COST_CURRENCY?: string
  SUPPLIER_SYNC_ENABLED?: string
  SCHEDULER_SHARED_SECRET?: string
}
export class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } })
export async function requireAdmin(request: Request, env: Env) {
  if (request.headers.get('Origin') && request.headers.get('Origin') !== new URL(request.url).origin) throw new HttpError(403, 'Origin not permitted.')
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw new HttpError(503, 'Server authentication configuration is missing.')
  const bearer = request.headers.get('Authorization') ?? ''
  if (!/^Bearer [A-Za-z0-9._-]{20,8000}$/.test(bearer)) throw new HttpError(401, 'Sign in is required.')
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: bearer } } })
  const user = await client.auth.getUser(bearer.slice(7))
  if (user.error || !user.data.user?.email_confirmed_at) throw new HttpError(401, 'Verified sign in is required.')
  const role = await client.from('user_roles').select('role').eq('user_id', user.data.user.id).maybeSingle()
  if (role.error || role.data?.role !== 'admin') throw new HttpError(403, 'Administrator access required.')
  return client
}
