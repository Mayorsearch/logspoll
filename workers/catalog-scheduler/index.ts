interface SchedulerEnv { CATALOG_SYNC_URL: string; SCHEDULER_SHARED_SECRET: string }
export async function scheduledSync(env: SchedulerEnv, options: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {}) {
  const url = new URL(env.CATALOG_SYNC_URL)
  // Preview-only scheduler. Production target requires a separate reviewed configuration.
  if (url.protocol !== 'https:' || !/^mobile-preview\.[a-z0-9-]+\.pages\.dev$/.test(url.hostname) || url.pathname !== '/api/internal/catalog-sync' || url.search || url.hash || url.username || url.password || env.SCHEDULER_SHARED_SECRET?.length < 32) throw new Error('Preview catalog scheduler configuration required.')
  let job: string | undefined
  let connection: string | undefined
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const deadline = now() + 12 * 60 * 1000
  // Below the Free-plan 50 subrequest limit, even for very large catalogs.
  // Further invocations resume privately persisted progress without a computer.
  for (let batch = 0; batch < 40 && now() < deadline; batch++) {
    const response = await fetch(url, { method: 'POST', redirect: 'manual', headers: { Authorization: `Bearer ${env.SCHEDULER_SHARED_SECRET}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: job, connection_id: connection }), signal: AbortSignal.timeout(100000) })
    if (response.status === 429) { await response.body?.cancel(); return }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Catalog sync returned HTTP ${response.status}`) }
    const result = await response.json() as { done?: boolean; skipped?: string; job_id?: string; connection_id?: string }
    if (result.done || result.skipped) return
    if (!result.job_id || !result.connection_id) throw new Error('Catalog sync checkpoint missing')
    job = result.job_id
    connection = result.connection_id
    await sleep(1500)
  }
}
export default { async scheduled(_event: unknown, env: SchedulerEnv) { await scheduledSync(env) } }
