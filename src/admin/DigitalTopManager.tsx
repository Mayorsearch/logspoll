import { useEffect, useRef, useState } from 'react'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import {
  Globe,
  Key,
  Lock,
  RefreshCw,
  Play,
  Power,
  AlertCircle,
  CheckCircle2,
  Info,
  Cpu,
} from 'lucide-react'

type Status = {
  enabled: number
  phase: string
  scanned: number
  total: number | null
  imported: number
  approved: number
  in_stock: number
  last_status: string
  last_success: number | null
  base_url?: string
}

export default function DigitalTopManager({ onComplete }: { onComplete?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [baseUrl, setBaseUrl] = useState('https://api.digitaltop.core')
  const key = useRef<HTMLInputElement>(null)
  const secret = useRef<HTMLInputElement>(null)

  async function refresh() {
    try {
      const result = await cloudflareRequest<{ connection: Status | null }>('/api/admin/digitaltop')
      setStatus(result.connection)
      if (result.connection?.base_url) setBaseUrl(result.connection.base_url)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Supplier settings unavailable.')
      setIsError(true)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function action(act: string) {
    if (act === 'toggle' && status?.enabled && !confirm('Disable DigitalTop? Automated catalog synchronization will pause. Existing AI Tools products remain securely stored in D1.')) {
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
          ...(apiKey ? { api_key: apiKey } : {}),
          ...(apiSecret ? { api_secret: apiSecret } : {}),
        }
      } else if (act === 'toggle') {
        body = { action: 'toggle' }
      }

      const result = await cloudflareRequest<{
        connected?: boolean
        total?: number
        message?: string
        error?: string
        username?: string
      }>('/api/admin/digitaltop', body)

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
              ? `Connection verified: ${result.total ?? 0} accessible AI tool products found.`
              : act === 'sync'
                ? 'DigitalTop background synchronization queued successfully.'
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
      {/* Status Panel */}
      <div
        className="cf-panel"
        style={{
          padding: 24,
          borderRadius: 12,
          background: 'var(--admin-card-bg, #ffffff)',
          border: '1px solid var(--admin-border, #e2e8f0)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(99,102,241,0.1) 0%, rgba(139,92,246,0.15) 100%)',
                color: '#6366f1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Cpu size={26} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--admin-text, #0f172a)' }}>
                  Server 4 · DigitalTop (AI Tools)
                </h2>
                <span
                  style={{
                    fontSize: '0.75rem',
                    padding: '2px 8px',
                    borderRadius: 12,
                    fontWeight: 700,
                    background: status?.enabled ? '#10b98120' : '#64748b20',
                    color: status?.enabled ? '#10b981' : '#64748b',
                  }}
                >
                  {status?.enabled ? 'SYNC ACTIVE' : 'DISABLED'}
                </span>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: 'var(--admin-muted, #64748b)' }}>
                Authorized digital AI licenses, software subscriptions, and developer tools catalog.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={busy || !status}
              onClick={() => void action('toggle')}
              className="cf-btn"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 8,
                background: status?.enabled ? '#ef4444' : '#10b981',
                color: '#fff',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: busy || !status ? 'not-allowed' : 'pointer',
              }}
            >
              <Power size={14} />
              <span>{status?.enabled ? 'Disable' : 'Enable'}</span>
            </button>

            <button
              type="button"
              disabled={busy || !status}
              onClick={() => void action('test')}
              className="cf-btn"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 8,
                background: 'var(--admin-subtle, #f1f5f9)',
                color: 'var(--admin-text, #334155)',
                border: '1px solid var(--admin-border, #cbd5e1)',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: busy || !status ? 'not-allowed' : 'pointer',
              }}
            >
              <Play size={14} />
              <span>Test Connection</span>
            </button>

            <button
              type="button"
              disabled={busy || !status?.enabled}
              onClick={() => void action('sync')}
              className="cf-btn"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 8,
                background: '#6366f1',
                color: '#fff',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: busy || !status?.enabled ? 'not-allowed' : 'pointer',
              }}
            >
              <RefreshCw size={14} className={busy ? 'spin' : ''} />
              <span>Sync Products</span>
            </button>
          </div>
        </div>

        {/* Status Metrics Bar */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 16,
            marginTop: 20,
            paddingTop: 16,
            borderTop: '1px solid var(--admin-border, #e2e8f0)',
          }}
        >
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)', fontWeight: 600, textTransform: 'uppercase' }}>
              Imported Items
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--admin-text, #0f172a)', marginTop: 2 }}>
              {status?.imported ?? 0}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)', fontWeight: 600, textTransform: 'uppercase' }}>
              Approved Products
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#10b981', marginTop: 2 }}>
              {status?.approved ?? 0}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)', fontWeight: 600, textTransform: 'uppercase' }}>
              In-Stock Items
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#6366f1', marginTop: 2 }}>
              {status?.in_stock ?? 0}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)', fontWeight: 600, textTransform: 'uppercase' }}>
              Last Sync Attempt
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--admin-text, #0f172a)', marginTop: 4 }}>
              {status?.last_success ? new Date(status.last_success).toLocaleString() : 'Never'}
            </div>
          </div>
        </div>

        {/* Last Status Text */}
        <div style={{ marginTop: 14, fontSize: '0.8rem', color: 'var(--admin-muted, #64748b)' }}>
          <strong>Status:</strong> {status?.last_status || 'Awaiting configuration.'}
        </div>

        {/* Message Banner */}
        {message && (
          <div
            style={{
              marginTop: 16,
              padding: '12px 16px',
              borderRadius: 8,
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: isError ? '#ef444415' : '#10b98115',
              border: `1px solid ${isError ? '#ef444440' : '#10b98140'}`,
              color: isError ? '#dc2626' : '#059669',
            }}
          >
            {isError ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            <span>{message}</span>
          </div>
        )}
      </div>

      {/* Credentials Configuration Form */}
      <div
        className="cf-panel"
        style={{
          padding: 24,
          borderRadius: 12,
          background: 'var(--admin-card-bg, #ffffff)',
          border: '1px solid var(--admin-border, #e2e8f0)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Key size={18} color="#6366f1" />
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--admin-text, #0f172a)' }}>
            DigitalTop API Configuration & Credentials
          </h3>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--admin-text, #334155)' }}>
            API Base URL
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <Globe size={16} color="#64748b" />
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.digitaltop.core"
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--admin-border, #cbd5e1)',
                  background: 'var(--admin-input-bg, #ffffff)',
                  color: 'var(--admin-text, #0f172a)',
                  fontSize: '0.85rem',
                  fontFamily: 'monospace',
                }}
              />
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)', marginTop: 4, display: 'block' }}>
              Base HTTPS endpoint where DigitalTop provides product and stock data.
            </span>
          </label>

          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--admin-text, #334155)' }}>
            API Key / Token
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <Lock size={16} color="#64748b" />
              <input
                ref={key}
                type="password"
                placeholder={status ? '•••••••••••••••••••••••••••••••• (leave blank to keep existing)' : 'Enter DigitalTop API Key'}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--admin-border, #cbd5e1)',
                  background: 'var(--admin-input-bg, #ffffff)',
                  color: 'var(--admin-text, #0f172a)',
                  fontSize: '0.85rem',
                }}
              />
            </div>
          </label>

          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--admin-text, #334155)' }}>
            API Secret (Optional)
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <Lock size={16} color="#64748b" />
              <input
                ref={secret}
                type="password"
                placeholder={status ? '•••••••••••••••••••••••••••••••• (leave blank to keep existing)' : 'Enter DigitalTop API Secret if required'}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--admin-border, #cbd5e1)',
                  background: 'var(--admin-input-bg, #ffffff)',
                  color: 'var(--admin-text, #0f172a)',
                  fontSize: '0.85rem',
                }}
              />
            </div>
          </label>

          <button
            type="button"
            disabled={busy}
            onClick={() => void action('save')}
            className="cf-btn"
            style={{
              alignSelf: 'flex-start',
              padding: '10px 24px',
              borderRadius: 8,
              background: '#6366f1',
              color: '#fff',
              border: 'none',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: busy ? 'not-allowed' : 'pointer',
              marginTop: 4,
            }}
          >
            {busy ? 'Saving...' : 'Save Credentials'}
          </button>
        </div>
      </div>

      {/* Integration Reference Note */}
      <div
        style={{
          padding: 16,
          borderRadius: 8,
          background: 'rgba(99,102,241,0.06)',
          border: '1px solid rgba(99,102,241,0.2)',
          fontSize: '0.85rem',
          color: 'var(--admin-text, #334155)',
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
        }}
      >
        <Info size={18} color="#6366f1" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <strong>DigitalTop API Protocol Notice:</strong>
          <p style={{ margin: '4px 0 0', lineHeight: 1.5 }}>
            The LogsPoll backend adapter securely stores DigitalTop credentials in Cloudflare D1 with AES-GCM encryption.
            Catalog normalization automatically converts USD tool pricing to NGN using the active Bybit P2P rate and applies the global 50% markup.
            If DigitalTop requires specific custom endpoint paths or header authentication formats, provide the API documentation to finalize provider calls.
          </p>
        </div>
      </div>
    </div>
  )
}

