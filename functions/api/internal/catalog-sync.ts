import { HttpError, json } from '../../../server/auth.ts'
import type { Env } from '../../../server/auth.ts'
import { requireScheduler } from '../../../server/scheduler-auth.ts'
import { supplierBackend, syncSupplier } from '../../../server/catalog-sync.ts'

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  try {
    await requireScheduler(request, env)
    // One connection per invocation; oldest attempt first provides fair rotation.
    const result = await supplierBackend(env).from('supplier_connections').select('id').eq('provider', 'youngpg').eq('enabled', true).order('last_attempt_at', { ascending: true, nullsFirst: true }).limit(1)
    if (result.error) throw new HttpError(503, 'Supplier storage unavailable.')
    if (!result.data?.[0]) return json({ success: true, skipped: 'No enabled supplier configured.' })
    return json(await syncSupplier(env, result.data[0].id, 'sync'))
  } catch (error) {
    return json({ error: error instanceof HttpError ? error.message : 'Scheduled sync failed.' }, error instanceof HttpError ? error.status : 503)
  }
}
