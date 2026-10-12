import { HttpError, json, requireAdmin } from '../../../server/auth.ts'
import type { Env } from '../../../server/auth.ts'
import { authorizedProducts, normalizeCatalog, supplierGet } from '../../../server/supplier.ts'
export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  let client: Awaited<ReturnType<typeof requireAdmin>> | undefined
  let claimed = false
  try {
    client = await requireAdmin(request, env)
    const approved = authorizedProducts(env.SUPPLIER_AUTHORIZED_PRODUCTS)
    if (!env.SUPPLIER_API_KEY || env.SUPPLIER_SCHEMA_VERIFIED !== 'shopviaclone22-v1') throw new HttpError(503, 'Configure the rotated supplier secret and verify the response schema first.')
    const claim = await client.rpc('claim_supplier_sync')
    if (claim.error) throw new HttpError(503, 'Supplier database functions are not configured.')
    if (claim.data !== true) throw new HttpError(429, 'A sync is running or was attempted recently. Wait at least one minute.')
    claimed = true
    const normalized = normalizeCatalog(await supplierGet(env, 'products'), approved, env.SUPPLIER_COST_CURRENCY ?? '')
    const saved = await client.rpc('sync_supplier_catalog', { catalog: normalized })
    if (saved.error) throw new HttpError(503, 'Supplier catalog could not be saved. No success was assumed.')
    return json({ imported: saved.data, approval_required: true })
  } catch (problem) {
    if (claimed && client) { try { await client.rpc('record_supplier_sync_failure') } catch { /* Never log upstream errors or credentials. */ } }
    return json({ error: problem instanceof HttpError ? problem.message : 'Supplier synchronization unavailable.' }, problem instanceof HttpError ? problem.status : 503)
  }
}
export const onRequestGet = () => json({ error: 'Use authenticated POST.' }, 405)
