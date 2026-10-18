import { useEffect, useRef, useState } from 'react'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import { Copy, Check, ShieldCheck } from 'lucide-react'

type Event = {
  event_id: string
  event_type: string
  external_id: string | null
  received_at: number
  status: string
  attempts: number
  last_error: string | null
}

type Status = {
  configured: boolean
  source: string
  canRotate: boolean
  endpoint: string
  events: Event[]
}

export default function HstoraWebhookPanel() {
  const [status, setStatus] = useState<Status | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const secret = useRef<HTMLInputElement>(null)

  const endpointUrl = status?.endpoint ?? 'https://logspoll.com/api/webhooks/hstora'

  async function refresh() {
    const result = await cloudflareRequest<Status>('/api/admin/hstora-webhook')
    setStatus(result)
  }

  useEffect(() => {
    let active = true
    void cloudflareRequest<Status>('/api/admin/hstora-webhook')
      .then((result) => {
        if (active) setStatus(result)
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : 'Webhook status unavailable.')
      })
    return () => {
      active = false
    }
  }, [])

  function copyUrl() {
    navigator.clipboard.writeText(endpointUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function save() {
    const val = secret.current?.value?.trim()
    if (!val) {
      setMessage('Enter a webhook secret.')
      return
    }
    setBusy(true)
    try {
      await cloudflareRequest('/api/admin/hstora-webhook', { webhook_secret: val })
      setMessage('Signing secret stored encrypted. Configure this endpoint and the same secret in HStora.')
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Webhook configuration failed.')
    } finally {
      if (secret.current) secret.current.value = ''
      setBusy(false)
    }
  }

  return (
    <section className="cf-panel" style={{ padding: 24, borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <ShieldCheck size={20} color="#f97316" />
        <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>HStora Webhook Integration</h3>
      </div>

      <p style={{ margin: '0 0 16px', color: 'var(--admin-muted, #64748b)', fontSize: '0.875rem' }}>
        Real-time stock and price synchronization. HStora pushes notifications directly to this endpoint whenever products change.
      </p>

      {/* Endpoint URL with Copy Button */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--admin-muted, #64748b)', display: 'block', marginBottom: 6 }}>
          WEBHOOK ENDPOINT URL (COPY-ONLY)
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            readOnly
            value={endpointUrl}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--admin-border, #cbd5e1)',
              background: 'var(--admin-subtle, #f8fafc)',
              fontFamily: 'monospace',
              fontSize: '0.85rem',
            }}
          />
          <button
            type="button"
            className="cf-btn secondary"
            onClick={copyUrl}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 105 }}
          >
            {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
            {copied ? 'Copied!' : 'Copy URL'}
          </button>
        </div>
      </div>

      {/* Secret Configuration */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: '0.875rem' }}>
          <span>Status:</span>
          <span style={{ fontWeight: 600, color: status?.configured ? '#10b981' : '#f59e0b' }}>
            {!status ? 'Checking…' : !status.configured ? 'Signing secret required' : status.events.length ? 'Verified deliveries active' : 'Configured; awaiting first event'}
          </span>
        </div>

        {status?.canRotate && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              ref={secret}
              type="password"
              autoComplete="new-password"
              placeholder="whsec_... (Enter webhook signing secret)"
              style={{ flex: 1, minWidth: 240, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--admin-border, #cbd5e1)', fontSize: '0.85rem' }}
            />
            <button
              type="button"
              className="cf-btn"
              disabled={busy}
              onClick={() => void save()}
            >
              {status.configured ? 'Rotate Secret' : 'Save Webhook Secret'}
            </button>
          </div>
        )}

        {status && !status.canRotate && (
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#64748b' }}>
            Signing secret is managed securely via Cloudflare Pages environment as <code>HSTORA_WEBHOOK_SECRET</code>.
          </p>
        )}
      </div>

      {/* Subscribed Events Checklist */}
      <div style={{ padding: '10px 14px', background: 'var(--admin-subtle, #f8fafc)', borderRadius: 8, marginBottom: 16, fontSize: '0.8rem', color: '#64748b' }}>
        <strong>Supported Events:</strong> <code>product.created</code> · <code>product.updated</code> · <code>product.deleted</code> · <code>product.stock_changed</code> · <code>product.price_changed</code>
      </div>

      {message && (
        <p role="status" style={{ margin: '8px 0', fontSize: '0.85rem', color: '#f97316' }}>
          {message}
        </p>
      )}

      {/* Event Log */}
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', color: '#64748b' }}>
          Recent Verified Webhook Events ({status?.events.length ?? 0})
        </summary>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {status?.events.length === 0 && (
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', fontStyle: 'italic', margin: '4px 0' }}>
              No webhook events received yet. Events will appear here automatically when sent by HStora.
            </p>
          )}
          {status?.events.map((event) => (
            <div
              key={event.event_id}
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                background: 'var(--admin-subtle, #f8fafc)',
                border: '1px solid var(--admin-border, #e2e8f0)',
                fontSize: '0.8rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                <span>{event.event_type}</span>
                <span style={{ color: event.status === 'processed' ? '#10b981' : '#f59e0b' }}>{event.status}</span>
              </div>
              <div style={{ color: '#64748b', marginTop: 2 }}>
                Product: {event.external_id ?? '—'} · {new Date(event.received_at).toLocaleString()} · {event.attempts} attempt(s)
              </div>
              {event.last_error && <div style={{ color: '#ef4444', marginTop: 2 }}>{event.last_error}</div>}
            </div>
          ))}
        </div>
      </details>
    </section>
  )
}
