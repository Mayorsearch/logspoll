import { createClient } from '@supabase/supabase-js'
import { HttpError } from './auth.ts'
import type { Env } from './auth.ts'
export interface BachsEnv extends Env {
  BACHS_API_KEY?: string
  BACHS_WEBHOOK_SECRET?: string
  BACHS_SANDBOX_ENABLED?: string
}
export function sandboxEnabled(env: BachsEnv) {
  return env.BACHS_SANDBOX_ENABLED === 'true' && Boolean(env.BACHS_API_KEY?.startsWith('sk_sandbox_')) && Boolean(env.BACHS_WEBHOOK_SECRET)
}
export function serviceDatabase(env: BachsEnv) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_URL) throw new HttpError(503, 'Sandbox database configuration missing.')
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
}
export async function verifiedBuyer(request: Request, env: BachsEnv) {
  const origin = request.headers.get('Origin')
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'Origin not permitted.')
  const bearer = request.headers.get('Authorization') ?? ''
  if (!/^Bearer [A-Za-z0-9._-]{20,8000}$/.test(bearer)) throw new HttpError(401, 'Sign in required.')
  if (!env.SUPABASE_PUBLISHABLE_KEY || !env.SUPABASE_URL) throw new HttpError(503, 'Auth configuration missing.')
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
  const user = await client.auth.getUser(bearer.slice(7))
  if (user.error || !user.data.user?.email_confirmed_at || !user.data.user.email) throw new HttpError(401, 'Verified sign in required.')
  return { id: user.data.user.id, email: user.data.user.email }
}
export function safeBachsError(problem: unknown) {
  const status = problem instanceof HttpError ? problem.status : 503
  const message = problem instanceof HttpError ? problem.message : 'Sandbox checkout unavailable. Please retry later.'
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
}
