import SupplierAutomation from './SupplierAutomation'
import { useEffect, useState } from 'react'
import HstoraManager from './HstoraManager'
import HstoraReview from './HstoraReview'
import CloudflareCatalog from './CloudflareCatalog'
import Shopviaclone22Manager from './Shopviaclone22Manager'
import { cloudflareRequest } from '../lib/cloudflare-auth'

type Supplier = {
  id: string
  name: string
  enabled: number
  revision: number
  last_status: string
  total?: number
  scanned?: number
  last_verified_scan_at?: number
}

type Hstora = {
  enabled: number
  last_status: string
  phase: string
  imported: number
  last_success: number | null
  requested: number
  scanned: number
  total: number | null
  next_attempt: number
  lease_until: number | null
}

type ShopVia = {
  enabled: number
  last_status: string
  phase: string
  imported: number
  in_stock: number
  approved: number
  last_success: number | null
  requested: number
  scanned: number
  total: number | null
  next_attempt: number
  lease_until: number | null
  base_url: string
}

export default function SupplierHub() {
  const view = location.pathname.includes('supplier-review') ? 'review' : 'api'
  const [provider, setProvider] = useState('hstora')
  const [managed, setManaged] = useState<string | null>(null)
  const [hstora, setHstora] = useState<Hstora | null>(null)
  const [youngpg, setYoungpg] = useState<Supplier | null>(null)
  const [shopviaclone22, setShopviaclone22] = useState<ShopVia | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function refresh() {
    const results = await Promise.allSettled([
      cloudflareRequest<{ connection: Hstora | null }>('/api/admin/hstora'),
      cloudflareRequest<{ suppliers: Supplier[] }>('/api/admin/catalog'),
      cloudflareRequest<{ connection: ShopVia | null }>('/api/admin/shopviaclone22'),
    ])

    if (results[0].status === 'fulfilled') {
      setHstora(results[0].value.connection)
      setLoaded((v) => ({ ...v, hstora: true }))
    }
    if (results[1].status === 'fulfilled') {
      setYoungpg(results[1].value.suppliers[0] ?? null)
      setLoaded((v) => ({ ...v, youngpg: true }))
    }
    if (results[2].status === 'fulfilled') {
      setShopviaclone22(results[2].value.connection)
      setLoaded((v) => ({ ...v, shopviaclone22: true }))
    }

    setErrors({
      hstora: results[0].status === 'rejected' ? (results[0].reason instanceof Error ? results[0].reason.message : 'Unavailable') : '',
      youngpg: results[1].status === 'rejected' ? (results[1].reason instanceof Error ? results[1].reason.message : 'Unavailable') : '',
      shopviaclone22: results[2].status === 'rejected' ? (results[2].reason instanceof Error ? results[2].reason.message : 'Unavailable') : '',
    })

    const rejectedMsgs = results
      .filter((r) => r.status === 'rejected')
      .map((r) => (r.status === 'rejected' && r.reason instanceof Error ? r.reason.message : 'Status unavailable.'))
    if (rejectedMsgs.length) setMessage(rejectedMsgs.join(' '))
  }

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 15000)
    return () => clearInterval(timer)
  }, [])

  async function action(prov: string, act: string) {
    const row = prov === 'hstora' ? hstora : prov === 'shopviaclone22' ? shopviaclone22 : youngpg
    if (!row) return
    if (act === 'toggle' && row.enabled && !confirm(`Disable ${prov.toUpperCase()}? New syncs and purchases stop. Existing products remain.`)) return

    setBusy(true)
    try {
      const endpoint = prov === 'hstora' ? '/api/admin/hstora' : prov === 'shopviaclone22' ? '/api/admin/shopviaclone22' : act === 'test' ? '/api/admin/supplier-manager' : '/api/admin/catalog'
      let body: Record<string, unknown>
      if (prov === 'hstora') {
        body = act === 'toggle' ? { action: 'save', enabled: !row.enabled } : { action: act }
      } else if (prov === 'shopviaclone22') {
        body = act === 'toggle' ? { action: 'toggle' } : { action: act }
      } else {
        body = act === 'toggle' ? { action: 'save', id: youngpg!.id, name: youngpg!.name, revision: youngpg!.revision, enabled: !youngpg!.enabled } : { action: act, id: youngpg!.id }
      }

      const result = await cloudflareRequest<{ connected?: boolean; message?: string }>('/api' + endpoint.replace('/api', ''), body)
      setMessage(
        result.message ??
          (result.connected
            ? 'Connection verified.'
            : act === 'sync'
              ? 'Background synchronization queued.'
              : 'Supplier setting saved.')
      )
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Supplier request failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="supplier-hub">
      <aside className="supplier-sidebar">
        <a className="supplier-brand" href="/admin">
          Logs<span>Poll</span>
        </a>
        <nav>
          {[
            ['Dashboard', '/admin'],
            ['Orders', '/admin/orders'],
            ['Products', '/admin/products'],
            ['Supplier Review', '/admin/supplier-review'],
            ['API Manager', '/admin/api-manager'],
            ['Payments', '/admin/payments'],
            ['Customers', '/admin/customers'],
            ['Settings', '/admin/settings'],
          ].map(([name, path]) => (
            <a
              key={path}
              className={(view === 'api' && name === 'API Manager') || (view === 'review' && name === 'Supplier Review') ? 'active' : ''}
              href={path}
            >
              {name}
            </a>
          ))}
        </nav>
      </aside>

      <main className="supplier-main">
        <header>
          <div>
            <small>LOGSPOLL ADMIN HQ</small>
            <h1>{view === 'api' ? 'API Manager' : 'Supplier Review'}</h1>
          </div>
          <button id="admin-theme-toggle" type="button" aria-label="Toggle admin color theme">
            ☀ / ☾
          </button>
        </header>

        {message && (
          <p role="status" className="supplier-notice">
            {message}
          </p>
        )}

        {view === 'api' ? (
          <>
            <SupplierAutomation />
            <div className="supplier-grid">
              {[
                { id: 'hstora', name: 'Server 1 · HStora', row: hstora, count: hstora?.imported ?? 0 },
                { id: 'youngpg', name: 'Server 2 · YoungPG', row: youngpg, count: youngpg?.scanned ?? youngpg?.total ?? 0 },
                { id: 'shopviaclone22', name: 'Server 3 · ShopViaClone22', row: shopviaclone22, count: shopviaclone22?.imported ?? 0 },
              ].map((item) => (
                <section className="supplier-card" key={item.id}>
                  <div className="supplier-card-top">
                    <h2>{item.name}</h2>
                    <button
                      className="supplier-switch"
                      role="switch"
                      aria-checked={Boolean(item.row?.enabled)}
                      aria-label={`Enable ${item.name}`}
                      disabled={busy || !item.row}
                      onClick={() => void action(item.id, 'toggle')}
                    >
                      {item.row?.enabled ? 'Enabled' : item.row ? 'Disabled' : loaded[item.id] ? 'Not configured' : 'Loading…'}
                    </button>
                  </div>

                  <span className="supplier-badge">
                    {errors[item.id] || (item.row ? item.row.last_status : loaded[item.id] ? 'Not configured' : 'Loading status…')}
                  </span>

                  <p>
                    Products <strong>{loaded[item.id] ? item.count : '—'}</strong>
                  </p>

                  {item.id === 'hstora' && hstora && (
                    <p>
                      {hstora.lease_until && hstora.lease_until > Date.now()
                        ? 'Running'
                        : hstora.next_attempt > Date.now()
                          ? 'Retry waiting'
                          : hstora.requested
                            ? 'Queued'
                            : hstora.phase === 'complete'
                              ? 'Completed'
                              : hstora.phase}{' '}
                      · {hstora.scanned}/{hstora.total ?? 'unknown'} scanned
                      <br />
                      Last success: {hstora.last_success ? new Date(hstora.last_success).toLocaleString() : 'Never'}
                    </p>
                  )}

                  {item.id === 'shopviaclone22' && shopviaclone22 && (
                    <p>
                      {shopviaclone22.lease_until && shopviaclone22.lease_until > Date.now()
                        ? 'Running'
                        : shopviaclone22.next_attempt > Date.now()
                          ? 'Retry waiting'
                          : shopviaclone22.requested
                            ? 'Queued'
                            : shopviaclone22.phase === 'complete'
                              ? 'Synchronized'
                              : shopviaclone22.phase}{' '}
                      · {shopviaclone22.imported} imported ({shopviaclone22.in_stock} in stock)
                      <br />
                      Last success: {shopviaclone22.last_success ? new Date(shopviaclone22.last_success).toLocaleString() : 'Never'}
                    </p>
                  )}

                  <div className="cf-actions">
                    <button
                      className="cf-btn"
                      onClick={() => {
                        setManaged(item.id)
                        setProvider(item.id)
                      }}
                    >
                      Manage API
                    </button>
                    <button className="cf-btn secondary" disabled={busy || !item.row} onClick={() => void action(item.id, 'test')}>
                      Test Connection
                    </button>
                    <button className="cf-btn secondary" disabled={busy || !item.row?.enabled} onClick={() => void action(item.id, 'sync')}>
                      Sync Now
                    </button>
                    <button className="cf-btn supplier-retry" disabled={busy || !item.row?.enabled} onClick={() => void action(item.id, 'sync')}>
                      Retry Sync
                    </button>
                    <button className="cf-btn secondary" disabled={busy} onClick={() => void refresh()}>
                      Refresh Status
                    </button>
                  </div>
                </section>
              ))}
            </div>

            {managed && (
              <section className="supplier-settings">
                <div className="supplier-card-top">
                  <h2>{managed.toUpperCase()} Settings</h2>
                  <button
                    className="cf-btn secondary"
                    onClick={() => {
                      setManaged(null)
                      void refresh()
                    }}
                  >
                    Close / Refresh
                  </button>
                </div>

                {managed === 'hstora' ? (
                  <HstoraManager />
                ) : managed === 'youngpg' ? (
                  <CloudflareCatalog showHstora={false} onComplete={refresh} />
                ) : managed === 'shopviaclone22' ? (
                  <Shopviaclone22Manager onComplete={refresh} />
                ) : null}
              </section>
            )}
          </>
        ) : (
          <>
            <div className="supplier-tabs" role="tablist" aria-label="Supplier products">
              {['hstora', 'youngpg', 'shopviaclone22'].map((id) => (
                <button role="tab" aria-selected={provider === id} key={id} onClick={() => setProvider(id)}>
                  {id === 'hstora' ? 'SERVER 1 · HSTORA' : id === 'youngpg' ? 'SERVER 2 · YOUNGPG' : 'SERVER 3 · SHOPVIACLONE22'}
                </button>
              ))}
            </div>
            {provider === 'shopviaclone22' ? (
              <section className="supplier-card">
                <h2>Server 3 · ShopViaClone22 Products</h2>
                <p>
                  {shopviaclone22?.imported ?? 0} products imported ({shopviaclone22?.in_stock ?? 0} in stock).
                </p>
                <div className="cf-actions">
                  <button className="cf-btn" onClick={() => setManaged('shopviaclone22')}>
                    Configure API
                  </button>
                  <button className="cf-btn secondary" disabled={busy || !shopviaclone22?.enabled} onClick={() => void action('shopviaclone22', 'sync')}>
                    Sync Now
                  </button>
                </div>
              </section>
            ) : (
              <HstoraReview key={provider} provider={provider as 'hstora' | 'youngpg'} />
            )}
          </>
        )}
      </main>
    </div>
  )
}
