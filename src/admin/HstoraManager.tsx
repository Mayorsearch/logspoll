import HstoraWebhookPanel from './HstoraWebhookPanel'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import { Globe, Key, Lock, RefreshCw, Play, Power, AlertCircle, CheckCircle2, DollarSign } from 'lucide-react'

type Status = {
  enabled: number
  phase: string
  scanned: number
  total: number | null
  imported: number
  discovered: number
  sellable: number
  out_of_stock: number
  pending_details: number
  failed_details: number
  unavailable_details: number
  requested: number
  next_attempt: number
  last_error: string | null
  last_progress_at: number | null
  attention_required: boolean
  scheduler_healthy: boolean
  in_stock?: number
  published?: number
  rejected?: number
  last_status: string
  last_success: number | null
  fx_rate_minor: number | null
  with_images: number
  with_descriptions: number
  base_url?: string
  allowed_origin?: string
  key_configured?: boolean
  key_prefix?: string
  key_len?: number
  secret_configured?: boolean
  secret_len?: number
}

export default function HstoraManager({ onComplete }: { onComplete?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [baseUrl, setBaseUrl] = useState('https://hstora.com')
  const [allowedOrigin, setAllowedOrigin] = useState('')
  const [rate, setRate] = useState('1500')
  const key = useRef<HTMLInputElement>(null)
  const secret = useRef<HTMLInputElement>(null)
  const edited = useRef({ baseUrl: false, allowedOrigin: false, rate: false })
  const refreshing = useRef(false)
  const refreshQueued = useRef(false)

  const refresh = useCallback(async function refreshStatus() {
    if (refreshing.current) {
      refreshQueued.current = true
      return
    }
    refreshing.current = true
    try {
      const result = await cloudflareRequest<{ connection: Status | null }>('/api/admin/hstora')
      setStatus(result.connection)
      if (!edited.current.baseUrl && result.connection?.base_url) setBaseUrl(result.connection.base_url)
      if (!edited.current.allowedOrigin && result.connection?.allowed_origin !== undefined) setAllowedOrigin(result.connection.allowed_origin)
      if (!edited.current.rate && result.connection?.fx_rate_minor) setRate(String(result.connection.fx_rate_minor / 100))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Supplier settings unavailable.')
      setIsError(true)
    } finally {
      refreshing.current = false
      if (refreshQueued.current) {
        refreshQueued.current = false
        void refreshStatus()
      }
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Fetch supplier configuration on mount
    void refresh()
  }, [refresh])

  const activeSync = Boolean(status?.enabled && (status.requested || ['listings', 'details', 'finalize'].includes(status.phase)))
  useEffect(() => {
    if (!activeSync || busy) return
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 30000)
    return () => window.clearInterval(interval)
  }, [activeSync, busy, refresh])

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
        if ((apiKey && !apiSecret) || (!apiKey && apiSecret)) {
          setIsError(true)
          setMessage('Both API Key (hs_pk_) and Secret Key (hs_sk_) must be entered together. Leaving one blank would mismatch your credentials.')
          setBusy(false)
          return
        }
        body = {
          action: 'save',
          base_url: baseUrl.trim(),
          allowed_origin: allowedOrigin.trim() || undefined,
          enabled: Boolean(status?.enabled),
          fx_rate_minor: Math.round(Number(rate) * 100),
          ...(apiKey ? { api_key: apiKey } : {}),
          ...(apiSecret ? { api_secret: apiSecret } : {}),
        }
      } else if (act === 'test') {
        const apiKey = key.current?.value?.trim()
        const apiSecret = secret.current?.value?.trim()
        if ((apiKey && !apiSecret) || (!apiKey && apiSecret)) {
          setIsError(true)
          setMessage('To test new credentials, enter both the API Key and Secret Key together. Or leave both blank to test saved credentials.')
          setBusy(false)
          return
        }
        body = {
          action: 'test',
          base_url: baseUrl.trim(),
          allowed_origin: allowedOrigin.trim() || undefined,
          ...(apiKey && apiSecret ? { api_key: apiKey, api_secret: apiSecret } : {})
        }
      } else if (act === 'toggle') {
        body = { action: 'toggle' }
      } else if (act === 'rate') {
        body = { action: 'save', enabled: Boolean(status?.enabled), fx_rate_minor: Math.round(Number(rate) * 100) }
      }

      const result = await cloudflareRequest<{ connected?: boolean; balance?: number; currency?: string; total?: number; message?: string; error?: string; layer?: string }>('/api/admin/hstora', body)

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
              ? `Connection verified: ${result.currency ?? 'USD'} ${(result.balance ?? 0).toFixed(2)} wallet balance · ${result.total ?? 0} accessible products found.`
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
              onChange={(e) => { edited.current.baseUrl = true; setBaseUrl(e.target.value) }}
              placeholder="https://hstora.com"
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--admin-border, #cbd5e1)', fontSize: '0.875rem' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85rem', fontWeight: 600 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Globe size={14} color="#f97316" /> Allowed Origin (Optional)
            </span>
            <input
              type="url"
              value={allowedOrigin}
              onChange={(e) => { edited.current.allowedOrigin = true; setAllowedOrigin(e.target.value) }}
              placeholder="Leave blank for standard headers"
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
              onChange={(e) => { edited.current.rate = true; setRate(e.target.value) }}
              placeholder="1500.00"
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--admin-border, #cbd5e1)', fontSize: '0.875rem' }}
            />
          </label>
        </div>

        {status?.key_configured && (
          <div style={{ marginTop: 12, fontSize: '0.82rem', color: 'var(--admin-muted, #64748b)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Configured Key: <code style={{ color: '#0f766e', background: 'rgba(15,118,110,0.08)', padding: '2px 6px', borderRadius: 4 }}>{status.key_prefix}</code> ({status.key_len} chars)</span>
            <span>·</span>
            <span>Secret: <span style={{ color: '#16a34a' }}>● Saved</span> ({status.secret_len} chars)</span>
          </div>
        )}

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

        {status?.attention_required && (
          <div role="alert" style={{ marginTop: 18, padding: '12px 16px', borderRadius: 8, background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#b91c1c', fontSize: '0.875rem', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>Sync needs attention: {status.scheduler_healthy ? 'progress has stalled or supplier requests keep failing.' : 'the scheduler is not reporting healthy activity.'} Check the last error and retry time below.</div>
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
              <div style={{ fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)', fontWeight: 600 }}>DISCOVERED / IMPORTED</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 4 }}>{status.discovered ?? status.scanned} / {status.imported}</div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                {status.published ?? 0} published
              </div>
            </div>

            <div style={{ background: 'var(--admin-subtle, #f8fafc)', padding: 12, borderRadius: 8 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)', fontWeight: 600 }}>SYNC PHASE & PROGRESS</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: 4, textTransform: 'capitalize' }}>
                {status.phase}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                {status.scanned}/{status.total ?? 'unknown'} processed
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                Last progress: {status.last_progress_at ? new Date(status.last_progress_at).toLocaleString() : 'Not recorded'}
              </div>
            </div>

            <div style={{ background: 'var(--admin-subtle, #f8fafc)', padding: 12, borderRadius: 8 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)', fontWeight: 600 }}>STOCK & AVAILABILITY</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 4 }}>{status.sellable ?? 0} sellable</div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                {status.out_of_stock ?? 0} out of stock · {status.unavailable_details ?? 0} supplier-unavailable
              </div>
            </div>

            <div style={{ background: 'var(--admin-subtle, #f8fafc)', padding: 12, borderRadius: 8 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)', fontWeight: 600 }}>PRODUCT DETAILS</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 4 }}>{status.pending_details ?? 0} pending</div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                {status.failed_details ?? 0} failed
              </div>
            </div>

            <div style={{ background: 'var(--admin-subtle, #f8fafc)', padding: 12, borderRadius: 8 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)', fontWeight: 600 }}>LAST SUCCESSFUL SYNC</div>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, marginTop: 6 }}>
                {status.last_success ? new Date(status.last_success).toLocaleString() : 'Never'}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 4 }}>
                Next retry: {status.next_attempt ? new Date(status.next_attempt).toLocaleString() : 'No retry scheduled'}
              </div>
            </div>

            <div style={{ background: status.last_error ? 'rgba(239, 68, 68, 0.08)' : 'var(--admin-subtle, #f8fafc)', padding: 12, borderRadius: 8, border: status.last_error ? '1px solid rgba(239, 68, 68, 0.25)' : 'none' }}>
              <div style={{ fontSize: '0.75rem', color: status.last_error ? '#b91c1c' : 'var(--admin-muted, #64748b)', fontWeight: 600 }}>LAST STATUS / ERROR LOG</div>
              <div style={{ fontSize: '0.8rem', marginTop: 4, color: status.last_error ? '#991b1b' : 'var(--admin-text, #1e293b)', overflowWrap: 'anywhere' }}>
                {status.last_error || status.last_status || 'Ready'}
              </div>
              {status.last_error && <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 4 }}>{status.last_status}</div>}
            </div>
          </div>
        )}
      </section>

      {/* Webhook integration */}
      <HstoraWebhookPanel />
    </div>
  )
}
