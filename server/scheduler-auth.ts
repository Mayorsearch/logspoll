import { HttpError } from './auth.ts'
import type { Env } from './auth.ts'

export async function requireScheduler(request: Request, env: Env) {
  if (env.SUPPLIER_SYNC_ENABLED !== 'true' || !env.SCHEDULER_SHARED_SECRET || env.SCHEDULER_SHARED_SECRET.length < 32) throw new HttpError(503, 'Scheduled catalog sync is not configured.')
  if (request.headers.has('Origin')) throw new HttpError(403, 'Scheduler requests only.')
  const supplied = request.headers.get('Authorization') ?? ''
  if (supplied.length > 1024) throw new HttpError(401, 'Scheduler authentication required.')
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  const [actual, expected] = await Promise.all([digest(supplied), digest(`Bearer ${env.SCHEDULER_SHARED_SECRET}`)])
  let mismatch = 0
  for (let i = 0; i < expected.length; i++) mismatch |= actual[i] ^ expected[i]
  if (mismatch) throw new HttpError(401, 'Scheduler authentication required.')
}
