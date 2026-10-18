import { useEffect, useRef, useState } from 'react'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import {
  Globe,
  Key,
  RefreshCw,
  Play,
  Power,
  AlertCircle,
  CheckCircle2,
  Info,
  Cpu,
  Wallet,
  ShoppingBag,
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

type ProfileData = {
  balance?: number
  total_orders?: number | string
}

export default function DigitalCoreManager({ onComplete }: { onComplete?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [baseUrl, setBaseUrl] = useState('https://digitalcore.top')
  const key = useRef<HTMLInputElement>(null)

  async function refresh() {
    try {
      const result = await cloudflareRequest<{ connection: Status | null }>('/api/admin/digitalcore')
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
    if (act === 'toggle' && status?.enabled && !confirm('Disable DigitalCore? Automated catalog synchronization will pause. Existing AI Tools products remain securely stored in D1.')) {
      return
    }
    setBusy(true)
    setMessage('')
    setIsError(false)
    try {
      let body: Record<string, unknown> = { action: act }
      if (act === 'save') {
        const apiKey = key.current?.value?.trim()
        body = {
          action: 'save',
          base_url: baseUrl.trim(),
          enabled: Boolean(status?.enabled),
          ...(apiKey ? { api_key: apiKey } : {}),
        }
      } else if (act === 'toggle') {
        body = { action: 'toggle' }
      }

      const result = await cloudflareRequest<{
        connected?: boolean
        total?: number
        message?: string
        error?: string
        profile?: ProfileData
      }>('/api/admin/digitalcore', body)

      if (key.current && act === 'save') key.current.value = ''

      if (result.profile) {
        setProfile(result.profile)
      }

      if (result.error) {
        setIsError(true)
        setMessage(result.error)
      } else {
        setIsError(false)
        setMessage(
          result.message ??
            (result.connected
              ? `Connection verified: Balance $${Number(result.profile?.balance ?? 0).toFixed(2)} USD, Total Orders: ${result.profile?.total_orders ?? 0}`
              : act === 'sync'
                ? 'DigitalCore background synchronization queued successfully.'
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
                background: 'linear-gradient(135deg, rgba(249,115,22,0.12) 0%, rgba(234,88,12,0.2) 100%)',
                color: '#ea580c',
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
                  Server 4 — DigitalCore
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
                  {status?.enabled ? 'ACTIVE' : 'DISABLED'}
                </span>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--admin-muted, #64748b)' }}>
                Authorized wholesale AI tools, accounts, and subscriptions with sub-second automated delivery.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`cf-btn ${status?.enabled ? 'danger' : 'success'}`}
              onClick={() => void action('toggle')}
              disabled={busy || !status}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}
            >
              <Power size={14} />
              {status?.enabled ? 'Disable Server 4' : 'Enable Server 4'}
            </button>
            <button
              type="button"
              className="cf-btn secondary"
              onClick={() => void action('test')}
              disabled={busy || !status}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}
            >
              <RefreshCw size={14} className={busy ? 'cf-spin' : ''} />
              Test Connection
            </button>
            <button
              type="button"
              className="cf-btn primary"
              onClick={() => void action('sync')}
              disabled={busy || !status?.enabled}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}
            >
              <Play size={14} />
              Sync Products
            </button>
          </div>
        </div>

        {/* Message Banner */}
        {message && (
          <div
            style={{
              marginTop: 16,
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: '0.85rem',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: isError ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
              color: isError ? '#ef4444' : '#10b981',
              border: `1px solid ${isError ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)'}`,
            }}
          >
            {isError ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            <span>{message}</span>
          </div>
        )}

        {/* Metric Cards Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            marginTop: 20,
          }}
        >
          <div
            style={{
              padding: 14,
              borderRadius: 8,
              background: 'var(--admin-bg-subtle, #f8fafc)',
              border: '1px solid var(--admin-border-subtle, #e2e8f0)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 600, color: 'var(--admin-muted, #64748b)', textTransform: 'uppercase' }}>
              <Wallet size={14} />
              Telegram Bot Balance
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, marginTop: 4, color: 'var(--admin-text, #0f172a)' }}>
              {profile?.balance !== undefined ? `$${Number(profile.balance).toFixed(2)}` : '—'}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--admin-muted, #64748b)', marginTop: 2 }}>
              USD wholesale credit
            </div>
          </div>

          <div
            style={{
              padding: 14,
              borderRadius: 8,
              background: 'var(--admin-bg-subtle, #f8fafc)',
              border: '1px solid var(--admin-border-subtle, #e2e8f0)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 600, color: 'var(--admin-muted, #64748b)', textTransform: 'uppercase' }}>
              <Cpu size={14} />
              Imported Products
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, marginTop: 4, color: 'var(--admin-text, #0f172a)' }}>
              {status?.imported ?? 0}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--admin-muted, #64748b)', marginTop: 2 }}>
              {status?.in_stock ?? 0} in stock
            </div>
          </div>

          <div
            style={{
              padding: 14,
              borderRadius: 8,
              background: 'var(--admin-bg-subtle, #f8fafc)',
              border: '1px solid var(--admin-border-subtle, #e2e8f0)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 600, color: 'var(--admin-muted, #64748b)', textTransform: 'uppercase' }}>
              <ShoppingBag size={14} />
              Approved Products
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, marginTop: 4, color: 'var(--admin-text, #0f172a)' }}>
              {status?.approved ?? 0}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--admin-muted, #64748b)', marginTop: 2 }}>
              Eligible for publication
            </div>
          </div>

          <div
            style={{
              padding: 14,
              borderRadius: 8,
              background: 'var(--admin-bg-subtle, #f8fafc)',
              border: '1px solid var(--admin-border-subtle, #e2e8f0)',
            }}
          >
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--admin-muted, #64748b)', textTransform: 'uppercase' }}>
              Last Successful Sync
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 700, marginTop: 6, color: 'var(--admin-text, #0f172a)' }}>
              {status?.last_success ? new Date(status.last_success).toLocaleTimeString() : 'Never'}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--admin-muted, #64748b)', marginTop: 2 }}>
              {status?.last_success ? new Date(status.last_success).toLocaleDateString() : 'Awaiting first sync'}
            </div>
          </div>
        </div>

        {/* Status Message Line */}
        {status?.last_status && (
          <div
            style={{
              marginTop: 14,
              padding: '8px 12px',
              borderRadius: 6,
              background: 'var(--admin-bg-subtle, #f8fafc)',
              fontSize: '0.8rem',
              color: 'var(--admin-muted, #64748b)',
              fontFamily: 'monospace',
            }}
          >
            <strong>Status:</strong> {status.last_status}
          </div>
        )}
      </div>

      {/* Official Documentation & Key Guidance Callout */}
      <div
        style={{
          padding: 18,
          borderRadius: 12,
          background: 'rgba(249, 115, 22, 0.05)',
          border: '1px solid rgba(249, 115, 22, 0.25)',
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
        }}
      >
        <Info size={20} style={{ color: '#ea580c', flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: '0.86rem', lineHeight: 1.6, color: 'var(--admin-text, #1e293b)' }}>
          <strong style={{ color: '#ea580c' }}>How to obtain your DigitalCore API Key:</strong>
          <br />
          API keys are linked to your Telegram account and balance.
          Open the official Telegram Bot <a href="https://t.me/DCoreStoreBot" target="_blank" rel="noreferrer" style={{ color: '#ea580c', fontWeight: 700, textDecoration: 'underline' }}>@DCoreStoreBot</a>, navigate to <strong>⚙️ Reseller API</strong>, and copy your personal <code>Api-Key</code>.
          Requests are sent with the HTTP header <code>Api-Key: YOUR_KEY</code> to <code>https://digitalcore.top</code>.
        </div>
      </div>

      {/* Credentials Configuration Form */}
      <form
        className="cf-panel"
        onSubmit={(e) => {
          e.preventDefault()
          void action('save')
        }}
        style={{
          padding: 24,
          borderRadius: 12,
          background: 'var(--admin-card-bg, #ffffff)',
          border: '1px solid var(--admin-border, #e2e8f0)',
        }}
      >
        <h3 style={{ margin: '0 0 16px 0', fontSize: '1.05rem', fontWeight: 700, color: 'var(--admin-text, #0f172a)' }}>
          DigitalCore API Configuration &amp; Credentials
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
          {/* Base URL */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: 'var(--admin-text, #334155)',
                marginBottom: 6,
              }}
            >
              API Base URL
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                required
                placeholder="https://digitalcore.top"
                className="cf-input"
                style={{
                  width: '100%',
                  padding: '9px 12px 9px 36px',
                  borderRadius: 8,
                  fontSize: '0.88rem',
                }}
              />
              <Globe
                size={16}
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--admin-muted, #94a3b8)',
                }}
              />
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)' }}>
              Official REST API base URL: <code>https://digitalcore.top</code>
            </p>
          </div>

          {/* API Key */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: 'var(--admin-text, #334155)',
                marginBottom: 6,
              }}
            >
              Personal API Key (Api-Key Header)
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="password"
                ref={key}
                placeholder={status ? '•••••••••••••••••••••••••••••••• (leave blank to keep existing)' : 'Enter DigitalCore API Key'}
                className="cf-input"
                style={{
                  width: '100%',
                  padding: '9px 12px 9px 36px',
                  borderRadius: 8,
                  fontSize: '0.88rem',
                }}
              />
              <Key
                size={16}
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--admin-muted, #94a3b8)',
                }}
              />
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)' }}>
              Stored encrypted using AES-GCM in Cloudflare D1. Never exposed to browsers or public endpoints.
            </p>
          </div>
        </div>

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="submit"
            className="cf-btn primary"
            disabled={busy}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.88rem' }}
          >
            {busy ? 'Saving…' : 'Save Credentials'}
          </button>
        </div>
      </form>
    </div>
  )
}

