import HstoraWebhookPanel from './HstoraWebhookPanel'
import { useEffect, useRef, useState } from 'react'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import { Globe, Key, Lock, RefreshCw, Play, Power, AlertCircle, CheckCircle2, DollarSign } from 'lucide-react'

type Status = {
  enabled: number
  phase: string
  scanned: number
  total: number | null
  imported: number
  last_status: string
  last_success: number | null
  fx_rate_minor: number | null
  with_images: number
  with_descriptions: number
  base_url?: string
}

export default function HstoraManager({ onComplete }: { onComplete?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [baseUrl, setBaseUrl] = useState('https://hstora.com')
  const [rate, setRate] = useState('1500')
  const key = useRef<HTMLInputElement>(null)
  const secret = useRef<HTMLInputElement>(null)

  async function refresh() {
    try {
      const result = await cloudflareRequest<{ connection: Status | null }>('/api/admin/hstora')
      setStatus(result.connection)
      if (result.connection?.base_url) setBaseUrl(result.connection.base_url)
      if (result.connection?.fx_rate_minor) setRate(String(result.connection.fx_rate_minor / 100))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Supplier settings unavailable.')
      setIsError(true)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function action(act: string) {
    if (act === 'toggle' && status?.enabled && !confirm('Disable HStora? Active catalog synchronization stops. Existing records remain safely stored in D1.')) {
      return
    }
    setBusy(true)
    setMessage('')
    setIsError(false)
    try {
      let body: Record<string, unknown> = { action: act }
      if (act === 'save') {
        const apiKey = key.current?.value?.trim()
        const apiSecret = secret.current?.value?.trim()
        body = {
          action: 'save',
          base_url: baseUrl.trim(),
          enabled: Boolean(status?.enabled),
          fx_rate_minor: Math.round(Number(rate) * 100),
          ...(apiKey ? { api_key: apiKey } : {}),
          ...(apiSecret ? { api_secret: apiSecret } : {}),
        }
      } else if (act === 'toggle') {
        body = { action: 'toggle' }
      } else if (act === 'rate') {
        body = { action: 'save', enabled: Boolean(status?.enabled), fx_rate_minor: Math.round(Number(rate) * 100) }
      }

      const result = await cloudflareRequest<{ connected?: boolean; total?: number; message?: string; error?: string; layer?: string }>('/api/admin/hstora', body)

      if (key.current && act === 'save') key.current.value = ''
      if (secret.current && act === 'save') secret.current.value = ''

      if (result.error) {
        setIsError(true)
        setMessage(result.error)
      } else {
        setIsError(false)
        setMessage(
          result.message ??
            (result.connected
              ? `Connection verified: ${result.total ?? 0} accessible products found.`
              : act === 'sync'
                ? 'Background catalog synchronization queued successfully.'
                : 'Settings saved successfully.')
        )
      }
      await refresh()
      if (onComplete) onComplete()
    } catch (error) {
      setIsError(true)
      setMessage(error instanceof Error ? error.message : 'Supplier request failed.')
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
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Server 1 · HStora</h2>
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
              Digital goods & subscription provider. Credentials and secrets are encrypted with AES-256-GCM on Cloudflare.
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
              placeholder="https://hstora.com"
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--admin-border, #cbd5e1)', fontSize: '0.875rem' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85rem', fontWeight: 600 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Key size={14} color="#f97316" /> API Key / Token
            </span>
            <input
              ref={key}
              type="password"
              autoComplete="new-password"
              placeholder={status ? '•••••••••••••••• (Leave blank to keep key)' : 'hs_pk_... (Enter HStora API key)'}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--admin-border, #cbd5e1)', fontSize: '0.875rem' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85rem', fontWeight: 600 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Lock size={14} color="#f97316" /> API Signing Secret
            </span>
            <input
              ref={secret}
              type="password"
              autoComplete="new-password"
              placeholder={status ? '•••••••••••••••• (Leave blank to keep secret)' : 'hs_sk_... (Enter signing secret)'}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--admin-border, #cbd5e1)', fontSize: '0.875rem' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85rem', fontWeight: 600 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <DollarSign size={14} color="#f97316" /> USD to NGN Exchange Rate
            </span>
            <input
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="1500.00"
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--admin-border, #cbd5e1)', fontSize: '0.875rem' }}
            />
          </label>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 20 }}>
          <button
            type="button"
            className="cf-btn"
            disabled={busy}
            onClick={() => void action('save')}
          >
            {status ? 'Save / Replace Credentials' : 'Save Credentials'}
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

        {/* Diagnostic alert box */}
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

        {/* Metrics Display */}
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
                {status.with_images} images · {status.with_descriptions} descriptions
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

      {/* Webhook integration */}
      <HstoraWebhookPanel />
    </div>
  )
}
