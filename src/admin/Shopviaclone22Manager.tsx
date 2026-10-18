import { useEffect, useRef, useState } from 'react'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import { Globe, Key, Lock, Play, RefreshCw, Power, AlertCircle, CheckCircle2, ShieldAlert } from 'lucide-react'

type Status = {
  enabled: number
  phase: string
  scanned: number
  total: number | null
  imported: number
  in_stock: number
  approved: number
  last_status: string
  last_success: number | null
  base_url: string
}

export default function Shopviaclone22Manager({ onComplete }: { onComplete?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [baseUrl, setBaseUrl] = useState('https://shopviaclone22.com/api')
  const keyRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    try {
      const result = await cloudflareRequest<{ connection: Status | null }>('/api/admin/shopviaclone22')
      setStatus(result.connection)
      if (result.connection?.base_url) setBaseUrl(result.connection.base_url)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Status unavailable.')
      setIsError(true)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function action(act: string) {
    if (act === 'toggle' && status?.enabled && !confirm('Disable ShopViaClone22? Purchases and new syncs will stop. Existing products remain.')) {
      return
    }
    setBusy(true)
    setMessage('')
    setIsError(false)
    try {
      const body: Record<string, unknown> = { action: act }
      if (act === 'save') {
        const apiKey = keyRef.current?.value?.trim()
        if (apiKey) body.api_key = apiKey
        body.base_url = baseUrl.trim()
        body.enabled = Boolean(status?.enabled)
      } else if (act === 'toggle') {
        body.action = 'toggle'
      } else if (act === 'test') {
        body.action = 'test'
      } else if (act === 'sync') {
        body.action = 'sync'
      }

      const result = await cloudflareRequest<{
        connected?: boolean
        total?: number
        categories?: number
        message?: string
        error?: string
      }>('/api/admin/shopviaclone22', body)

      if (keyRef.current && act === 'save') keyRef.current.value = ''

      if (result.error) {
        setIsError(true)
        setMessage(`Error: ${result.error}`)
      } else {
        setIsError(false)
        setMessage(
          result.message ??
            (result.connected
              ? `Connection verified: ${result.total ?? 0} products found in ${result.categories ?? 0} categories.`
              : act === 'sync'
                ? 'Background catalog sync queued successfully.'
                : 'Settings saved successfully.')
        )
      }
      await refresh()
      if (onComplete) onComplete()
    } catch (error) {
      setIsError(true)
      setMessage(error instanceof Error ? error.message : 'Operation failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section className="cf-panel" style={{ padding: 24, borderRadius: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Server 3 · ShopViaClone22</h2>
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: 20,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  background: status?.enabled ? 'rgba(16,185,129,0.15)' : 'rgba(148,163,184,0.15)',
                  color: status?.enabled ? '#10b981' : '#64748b',
                  border: `1px solid ${status?.enabled ? 'rgba(16,185,129,0.3)' : 'rgba(148,163,184,0.3)'}`,
                }}
              >
                {status?.enabled ? '● Enabled' : '○ Disabled'}
              </span>
            </div>
            <p style={{ margin: '6px 0 0', color: 'var(--admin-muted, #64748b)', fontSize: '0.875rem' }}>
              Direct supplier API integration. Products map to Server 3 on the customer storefront.
            </p>
          </div>

          <button
            type="button"
            className={`cf-btn ${status?.enabled ? 'secondary' : ''}`}
            disabled={busy || !status}
            onClick={() => void action('toggle')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Power size={14} />
            {status?.enabled ? 'Disable Supplier' : 'Enable Supplier'}
          </button>
        </div>

        {/* Credentials Form */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85rem', fontWeight: 600 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Globe size={14} color="#f97316" /> API Base URL
            </span>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://shopviaclone22.com/api"
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--admin-border, #cbd5e1)', fontSize: '0.875rem' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85rem', fontWeight: 600 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Key size={14} color="#f97316" /> API Key / Token
            </span>
            <input
              ref={keyRef}
              type="password"
              autoComplete="new-password"
              placeholder={status ? '•••••••••••••••• (Leave blank to keep existing key)' : 'Enter ShopViaClone22 API key'}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--admin-border, #cbd5e1)', fontSize: '0.875rem' }}
            />
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85rem', fontWeight: 600 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Lock size={14} color="#64748b" /> API Secret
            </span>
            <div
              style={{
                padding: '9px 12px',
                borderRadius: 8,
                background: 'var(--admin-subtle, #f8fafc)',
                border: '1px dashed var(--admin-border, #cbd5e1)',
                color: 'var(--admin-muted, #64748b)',
                fontSize: '0.8rem',
              }}
            >
              Not required by ShopViaClone22 (uses query parameter auth)
            </div>
          </div>
        </div>

        {/* Action Buttons Toolbar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 20 }}>
          <button
            type="button"
            className="cf-btn"
            disabled={busy}
            onClick={() => void action('save')}
          >
            {status ? 'Save / Replace Key' : 'Save Credentials'}
          </button>
          <button
            type="button"
            className="cf-btn secondary"
            disabled={busy || !status}
            onClick={() => void action('test')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Play size={13} /> Test Connection
          </button>
          <button
            type="button"
            className="cf-btn secondary"
            disabled={busy || !status?.enabled}
            onClick={() => void action('sync')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={13} /> Sync Products Now
          </button>
          <button
            type="button"
            className="cf-btn secondary"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Refresh Status
          </button>
        </div>

        {/* Diagnostics alert box */}
        {message && (
          <div
            style={{
              marginTop: 18,
              padding: '12px 16px',
              borderRadius: 8,
              background: isError ? 'rgba(239, 68, 68, 0.08)' : 'rgba(16, 185, 129, 0.08)',
              border: `1px solid ${isError ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.25)'}`,
              color: isError ? '#b91c1c' : '#047857',
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
            }}
          >
            {isError ? <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} /> : <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: 2 }} />}
            <div>{message}</div>
          </div>
        )}

        {/* Metrics Grid */}
        {status && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
              marginTop: 20,
              paddingTop: 16,
              borderTop: '1px solid var(--admin-border, #e2e8f0)',
            }}
          >
            <div style={{ background: 'var(--admin-subtle, #f8fafc)', padding: 12, borderRadius: 8 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)', fontWeight: 600 }}>IMPORTED PRODUCTS</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 4 }}>{status.imported}</div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                {status.in_stock} in stock · {status.approved} approved
              </div>
            </div>

            <div style={{ background: 'var(--admin-subtle, #f8fafc)', padding: 12, borderRadius: 8 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)', fontWeight: 600 }}>SYNC PHASE</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: 4, textTransform: 'capitalize' }}>
                {status.phase}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                {status.scanned}/{status.total ?? 'unknown'} scanned
              </div>
            </div>

            <div style={{ background: 'var(--admin-subtle, #f8fafc)', padding: 12, borderRadius: 8 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)', fontWeight: 600 }}>LAST SUCCESSFUL SYNC</div>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, marginTop: 6 }}>
                {status.last_success ? new Date(status.last_success).toLocaleString() : 'Never'}
              </div>
            </div>

            <div style={{ background: 'var(--admin-subtle, #f8fafc)', padding: 12, borderRadius: 8 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)', fontWeight: 600 }}>LAST STATUS</div>
              <div style={{ fontSize: '0.8rem', marginTop: 4, color: 'var(--admin-text, #1e293b)', overflowWrap: 'anywhere' }}>
                {status.last_status || 'Ready'}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Webhook Architecture Information Panel */}
      <section className="cf-panel" style={{ padding: 24, borderRadius: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <ShieldAlert size={20} color="#64748b" />
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>ShopViaClone22 Webhook Status</h3>
        </div>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--admin-muted, #64748b)', lineHeight: 1.6 }}>
          ShopViaClone22 operates via direct catalog and stock polling API (<code>products.php</code> and <code>product.php</code>).
          Webhooks are not supported or used by this supplier. Catalog synchronization and inventory refreshes run continuously via the 24/7 Cloudflare background scheduler or on-demand via &ldquo;Sync Products Now&rdquo;.
        </p>
      </section>
    </div>
  )
}
