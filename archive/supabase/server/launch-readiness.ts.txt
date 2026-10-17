import { supplierBackend } from './catalog-sync.ts'
import type { Env } from './auth.ts'
import type { BachsEnv } from './bachs-auth.ts'
import { sandboxEnabled } from './bachs-auth.ts'
import type { EmailEnv } from './email.ts'
import { emailTestReady } from './email.ts'

export async function supplierReadiness(env: Env) {
  const db = supplierBackend(env)
  // GET with limit=0 retains PostgREST errors; HEAD can omit the error body.
  const [jobs, pricing, pending, approved] = await Promise.all([
    db.from('supplier_catalog_jobs').select('connection_id,phase,next_page,scanned,skipped_details,imported,started_at').limit(100),
    db.from('supplier_feed_items').select('publication_enabled').limit(0),
    db.from('supplier_feed_items').select('external_id', { count: 'exact' }).eq('approval', 'pending').limit(0),
    db.from('supplier_feed_items').select('external_id', { count: 'exact' }).eq('approval', 'approved').limit(0),
  ])
  const blockers: string[] = []
  if (jobs.error) blockers.push(['PGRST205', '42P01'].includes(jobs.error.code) ? 'Apply reviewed 202610120002_resumable_supplier_sync.sql after staging validation and database approval.' : 'Checkpoint storage could not be verified. Retry after checking server/database access.')
  if (pricing.error) blockers.push(['42703', 'PGRST204'].includes(pricing.error.code) ? 'Apply reviewed 202610120001_catalog_refresh_pricing.sql after staging validation and database approval.' : 'Pricing storage could not be verified.')
  return { ready: !jobs.error, pricingReady: !pricing.error, blockers, pending: pending.error ? null : pending.count, approved: approved.error ? null : approved.count, progress: jobs.error ? [] : jobs.data }
}

export async function launchReadiness(env: BachsEnv & EmailEnv) {
  const [supplier, ledger] = await Promise.all([
    supplierReadiness(env),
    supplierBackend(env).from('bachs_sandbox_orders').select('id').limit(0),
  ])
  return {
    supplier,
    payments: { provider: 'Bachs', mode: 'sandbox', keyConfigured: Boolean(env.BACHS_API_KEY?.startsWith('sk_sandbox_')), webhookConfigured: Boolean(env.BACHS_WEBHOOK_SECRET), ledgerReady: !ledger.error, enabled: sandboxEnabled(env) && !ledger.error, liveEnabled: false, automaticFulfillment: false },
    email: { provider: 'Resend', keyConfigured: Boolean(env.RESEND_API_KEY), testReady: emailTestReady(env), automaticDelivery: false },
  }
}
