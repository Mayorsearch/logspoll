interface SchedulerEnv { CATALOG_SYNC_URL: string; SCHEDULER_SHARED_SECRET: string }
export async function scheduledSync(env: SchedulerEnv) {
  const url = new URL(env.CATALOG_SYNC_URL)
  // Preview-only scheduler. Production target requires a separate reviewed configuration.
  if (url.protocol !== 'https:' || !/^mobile-preview\.[a-z0-9-]+\.pages\.dev$/.test(url.hostname) || url.pathname !== '/api/internal/catalog-sync' || url.search || url.hash || url.username || url.password || env.SCHEDULER_SHARED_SECRET?.length < 32) throw new Error('Preview catalog scheduler configuration required.')
  const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${env.SCHEDULER_SHARED_SECRET}` }, signal: AbortSignal.timeout(270000) })
  // Do not log response bodies, configuration or credentials. No immediate job retry.
  if (!response.ok && response.status !== 429) throw new Error(`Catalog sync returned HTTP ${response.status}`)
}
export default { async scheduled(_event: unknown, env: SchedulerEnv) { await scheduledSync(env) } }
