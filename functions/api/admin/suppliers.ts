import { createClient } from '@supabase/supabase-js'
import { HttpError, json, requireAdmin } from '../../../server/auth.ts'
import type { Env } from '../../../server/auth.ts'
import { sealCredential } from '../../../server/supplier-crypto.ts'
import { YOUNGPG_ORIGIN, supplierOrigin, record, resaleAllowlist } from '../../../server/youngpg.ts'

import { syncSupplier } from '../../../server/catalog-sync.ts'

const publicColumns = 'id,provider,name,base_url,auth_method,enabled,revision,authorized_products,last_attempt_at,last_sync_at,last_status,imported_count,updated_at'
const uuid = (value: unknown) => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new HttpError(400, 'Invalid supplier ID.')
  return value
}
function backend(env: Env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new HttpError(503, 'Configure the server-only SUPABASE_SERVICE_ROLE_KEY in Pages Functions secrets.')
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
}
async function readBody(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'Use JSON.')
  const reader = request.body?.getReader()
  if (!reader) throw new HttpError(400, 'Request body required.')
  const decoder = new TextDecoder(); let value = ''; let size = 0
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 64000) { await reader.cancel(); throw new HttpError(413, 'Configuration exceeds 64 KB.') }; value += decoder.decode(part.value, { stream: true }) }
  try { return record(JSON.parse(value + decoder.decode())) } catch { throw new HttpError(400, 'Invalid JSON configuration.') }
}
const databaseFailure = () => new HttpError(503, 'Supplier storage unavailable. Apply the reviewed 202610110002_configurable_suppliers.sql migration and verify server configuration.')
const failureResponse = (problem: unknown) => json({ error: problem instanceof HttpError ? problem.message : 'Supplier operation unavailable. No success was assumed.' }, problem instanceof HttpError ? problem.status : 503)

export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
  try {
    await requireAdmin(request, env)
    const result = await backend(env).from('supplier_connections').select(publicColumns).order('name')
    if (result.error) throw databaseFailure()
    return json({ suppliers: result.data })
  } catch (problem) { return failureResponse(problem) }
}
export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  let db: ReturnType<typeof backend> | undefined; let id: string | undefined
  try {
    const administrator = await requireAdmin(request, env)
    const body = await readBody(request)
    const action = body.action
    // Approvals execute using the verified user JWT: database checks the admin role again.
    if (action === 'approve' || action === 'reject') {
      id = uuid(body.id)
      if (typeof body.external_id !== 'string' || body.external_id.length > 100) throw new HttpError(400, 'Invalid listing ID.')
      if (action === 'approve' && (typeof body.description !== 'string' || body.description.trim().length < 20 || body.description.length > 10000 || [...body.description].some(character => character.charCodeAt(0) < 32 && ![9, 10].includes(character.charCodeAt(0))) || /ypg_[a-fA-F0-9]{48}/.test(body.description))) throw new HttpError(400, 'Enter a verified, non-sensitive product description (20–10000 characters).')
      const result = action === 'approve'
        ? await administrator.rpc('approve_supplier_feed_item', { connection_uuid: id, external_product_id: body.external_id, category_uuid: uuid(body.category_id), selling_price_minor: body.price_minor, delivery_method: body.delivery_type, reviewed_description: typeof body.description === 'string' ? body.description.trim() : null })
        : await administrator.rpc('reject_supplier_feed_item', { connection_uuid: id, external_product_id: body.external_id })
      if (result.error) throw new HttpError(400, 'Approval failed. Verify fresh resale authorization, category, nonnegative NGN price, delivery method and admin role.')
      return json({ success: true })
    }
    if (action === 'catalog') {
      id = uuid(body.id)
      if (!['price', 'auto', 'markup', 'publication', 'description'].includes(String(body.operation))) throw new HttpError(400, 'Unsupported catalog operation.')
      if (body.operation !== 'markup' && (typeof body.external_id !== 'string' || body.external_id.length > 100)) throw new HttpError(400, 'Invalid listing ID.')
      const result = await administrator.rpc('admin_supplier_catalog', { connection_uuid: id, external_product_id: body.external_id ?? '', operation: body.operation, settings: record(body.settings) })
      if (result.error) throw new HttpError(400, 'Catalog update failed. Apply 202610120001_catalog_refresh_pricing.sql, then verify values, fresh approval and sync status.')
      return json({ success: true })
    }
    db = backend(env)
    if (action === 'save') {
      id = body.id ? uuid(body.id) : crypto.randomUUID()
      if (body.provider !== 'youngpg') throw new HttpError(400, 'Select the documented YoungPG adapter. Other providers require a reviewed adapter.')
      supplierOrigin(body.base_url)
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120 || [...body.name].some(character => character.charCodeAt(0) < 32) || typeof body.enabled !== 'boolean') throw new HttpError(400, 'Supplier name and enabled status are required.')
      if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0) throw new HttpError(400, 'Reload configuration before saving.')
      const approved = resaleAllowlist(body.authorized_products)
      if (/ypg_[a-fA-F0-9]{48}/.test(body.name)) throw new HttpError(400, 'Enter credentials only in the API key input, never the supplier name.')
      let encrypted: { ciphertext: string; nonce: string } | undefined
      if (body.api_key !== undefined && body.api_key !== '') {
        if (typeof body.api_key !== 'string' || !/^ypg_[a-fA-F0-9]{48}$/.test(body.api_key)) throw new HttpError(400, 'YoungPG requires a ypg_ key followed by 48 hexadecimal characters.')
        encrypted = await sealCredential(body.api_key, id, env.SUPPLIER_ENCRYPTION_KEY)
      }
      if (!body.id && !encrypted) throw new HttpError(400, 'Enter an API key for a new supplier.')
      const saved = await db.rpc('save_supplier_connection', { connection_uuid: id, expected_revision: body.revision,
        settings: { provider: 'youngpg', name: body.name.trim(), base_url: YOUNGPG_ORIGIN, enabled: body.enabled, authorized_products: approved },
        cipher: encrypted?.ciphertext ?? null, nonce: encrypted?.nonce ?? null })
      if (saved.error) {
        if (saved.error.code === '40001' || saved.error.code === '55P03') throw new HttpError(409, 'Configuration changed or a supplier operation is running. Reload and retry.')
        throw databaseFailure()
      }
      return json({ success: true, id }) // Never return the key, ciphertext or nonce.
    }
    if (!['test', 'categories', 'sync'].includes(String(action))) throw new HttpError(400, 'Unsupported supplier action.')
    id = uuid(body.id)
    return json(await syncSupplier(env, id, action as 'test' | 'categories' | 'sync'))
  } catch (problem) {
    return failureResponse(problem)
  }
}
