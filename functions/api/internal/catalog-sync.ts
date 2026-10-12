import { HttpError, json } from '../../../server/auth.ts'
import type { Env } from '../../../server/auth.ts'
import { requireScheduler } from '../../../server/scheduler-auth.ts'
import { supplierBackend, syncSupplier } from '../../../server/catalog-sync.ts'

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  try {
    await requireScheduler(request, env)
    const body = request.body ? await request.json() as { job_id?: unknown; connection_id?: unknown } : {}
    for (const id of [body.job_id, body.connection_id]) if (id != null && (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) throw new HttpError(400, 'Invalid synchronization ID.')
    // One connection per invocation; oldest attempt first provides fair rotation.
    let query = supplierBackend(env).from('supplier_connections').select('id').eq('provider', 'youngpg').eq('enabled', true)
    if (body.connection_id) query = query.eq('id', body.connection_id)
    const result = await query.order('last_attempt_at', { ascending: true, nullsFirst: true }).limit(1)
    if (result.error) throw new HttpError(503, 'Supplier storage unavailable.')
    if (!result.data?.[0]) return json({ success: true, skipped: 'No enabled supplier configured.' })
    return json(await syncSupplier(env, result.data[0].id, 'sync', body.job_id as string | undefined))
  } catch (error) {
    return json({ error: error instanceof HttpError ? error.message : 'Scheduled sync failed.' }, error instanceof HttpError ? error.status : 503)
  }
}
