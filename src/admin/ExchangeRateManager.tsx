import { useState, useEffect } from 'react'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import {
  DollarSign,
  RefreshCw,
  Sliders,
  Key,
  Clock,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  TrendingUp,
  History,
} from 'lucide-react'

type RateState = {
  current_rate: number
  source: 'bybit_p2p' | 'override' | 'fallback'
  status: 'active' | 'stale' | 'paused'
  updated_at: number
  is_fresh: boolean
  override_active: boolean
  override_rate: number | null
  bybit_configured: boolean
  bybit_api_key_masked: string | null
  markup_bps: number
}

type HistoryRecord = {
  id: string
  rate: number
  source: string
  sample_size: number
  raw_median: number
  status: string
  error_detail: string | null
  recorded_at: number
}

export default function ExchangeRateManager() {
  const [rateState, setRateState] = useState<RateState | null>(null)
  const [history, setHistory] = useState<HistoryRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [messageType, setMessageType] = useState<'success' | 'warning' | 'error' | 'info'>('info')

  // Form states
  const [overrideInput, setOverrideInput] = useState<string>('')
  const [apiKeyInput, setApiKeyInput] = useState<string>('')
  const [apiSecretInput, setApiSecretInput] = useState<string>('')
  const [confirmJumpData, setConfirmJumpData] = useState<{ new_rate: number; current_rate: number } | null>(null)

  async function loadData() {
    try {
      const res = await cloudflareRequest<{
        rate_state: RateState
        history: HistoryRecord[]
      }>('/api/admin/exchange-rate')
      setRateState(res.rate_state)
      setHistory(res.history || [])
      if (res.rate_state.override_rate) {
        setOverrideInput(String(res.rate_state.override_rate))
      } else {
        setOverrideInput(String(res.rate_state.current_rate))
      }
    } catch (err) {
      setMessageType('error')
      setMessage(err instanceof Error ? err.message : 'Failed to load exchange rate state.')
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  async function refreshRate(confirmJump = false) {
    setLoading(true)
    setMessage(null)
    setConfirmJumpData(null)
    try {
      const res = await cloudflareRequest<{
        refreshed: boolean
        rate?: number
        warning?: string
        new_rate?: number
        current_rate?: number
        message?: string
        error?: string
      }>('/api/admin/exchange-rate', {
        action: 'refresh',
        confirm_jump: confirmJump,
      })

      if (res.warning === 'abnormal_jump' && res.new_rate && res.current_rate) {
        setConfirmJumpData({ new_rate: res.new_rate, current_rate: res.current_rate })
        setMessageType('warning')
        setMessage(res.message || 'Abnormal rate jump detected. Please confirm before applying.')
      } else if (res.refreshed) {
        setMessageType('success')
        setMessage(res.message || `Exchange rate refreshed to ₦${res.rate}/$1. Products dynamically repriced.`)
        await loadData()
      } else {
        setMessageType('warning')
        setMessage(res.error || res.message || 'Unable to refresh rate from Bybit.')
        await loadData()
      }
    } catch (err) {
      setMessageType('error')
      setMessage(err instanceof Error ? err.message : 'Refresh request failed.')
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleOverride(enabled: boolean) {
    setLoading(true)
    setMessage(null)
    try {
      const rateNum = Number(overrideInput)
      if (enabled && (!Number.isFinite(rateNum) || rateNum < 500 || rateNum > 5000)) {
        setMessageType('error')
        setMessage('Please enter a valid rate between ₦500 and ₦5,000 per USD.')
        setLoading(false)
        return
      }

      const res = await cloudflareRequest<{
        saved: boolean
        message?: string
        error?: string
      }>('/api/admin/exchange-rate', {
        action: 'set_override',
        enabled,
        rate: rateNum,
      })

      if (res.saved) {
        setMessageType('success')
        setMessage(res.message || 'Manual override updated.')
        await loadData()
      } else {
        setMessageType('error')
        setMessage(res.error || 'Failed to update override.')
      }
    } catch (err) {
      setMessageType('error')
      setMessage(err instanceof Error ? err.message : 'Override update failed.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveCredentials(e: React.FormEvent) {
    e.preventDefault()
    if (!apiKeyInput.trim() && !apiSecretInput.trim()) return

    setLoading(true)
    setMessage(null)
    try {
      const res = await cloudflareRequest<{
        saved: boolean
        message?: string
        error?: string
      }>('/api/admin/exchange-rate', {
        action: 'save_credentials',
        api_key: apiKeyInput.trim(),
        api_secret: apiSecretInput.trim(),
      })

      if (res.saved) {
        setMessageType('success')
        setMessage(res.message || 'Bybit credentials saved successfully.')
        setApiKeyInput('')
        setApiSecretInput('')
        await loadData()
      } else {
        setMessageType('error')
        setMessage(res.error || 'Failed to save Bybit credentials.')
      }
    } catch (err) {
      setMessageType('error')
      setMessage(err instanceof Error ? err.message : 'Credential save failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Rate Banner */}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #10b98120, #05966930)',
                color: '#10b981',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <DollarSign size={28} />
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--admin-muted, #64748b)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Active Market Exchange Rate
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 2 }}>
                <span style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--admin-text, #0f172a)' }}>
                  ₦{rateState?.current_rate ? rateState.current_rate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '1,500.00'}
                </span>
                <span style={{ fontSize: '0.95rem', color: 'var(--admin-muted, #64748b)', fontWeight: 500 }}>
                  / $1.00 USD
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Source Badge */}
            <span
              style={{
                padding: '6px 12px',
                borderRadius: 20,
                fontSize: '0.75rem',
                fontWeight: 700,
                background: rateState?.override_active ? '#f59e0b20' : '#10b98120',
                color: rateState?.override_active ? '#f59e0b' : '#10b981',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <TrendingUp size={14} />
              {rateState?.override_active ? 'MANUAL OVERRIDE' : 'BYBIT P2P REFERENCE'}
            </span>

            {/* Freshness Badge */}
            <span
              style={{
                padding: '6px 12px',
                borderRadius: 20,
                fontSize: '0.75rem',
                fontWeight: 700,
                background: rateState?.is_fresh ? '#10b98115' : '#ef444415',
                color: rateState?.is_fresh ? '#10b981' : '#ef4444',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Clock size={14} />
              {rateState?.is_fresh ? 'FRESH (< 60m)' : 'STALE (> 60m)'}
            </span>

            <button
              type="button"
              onClick={() => void refreshRate(false)}
              disabled={loading}
              className="cf-btn"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderRadius: 8,
                background: '#f97316',
                color: '#fff',
                border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                fontSize: '0.85rem',
              }}
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
              <span>{loading ? 'Refreshing...' : 'Refresh Rate'}</span>
            </button>
          </div>
        </div>

        {/* Status Message Banner */}
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
              background:
                messageType === 'success'
                  ? '#10b98115'
                  : messageType === 'warning'
                    ? '#f59e0b15'
                    : messageType === 'error'
                      ? '#ef444415'
                      : '#3b82f615',
              border: `1px solid ${
                messageType === 'success'
                  ? '#10b98140'
                  : messageType === 'warning'
                    ? '#f59e0b40'
                    : messageType === 'error'
                      ? '#ef444440'
                      : '#3b82f640'
              }`,
              color:
                messageType === 'success'
                  ? '#059669'
                  : messageType === 'warning'
                    ? '#b45309'
                    : messageType === 'error'
                      ? '#dc2626'
                      : '#2563eb',
            }}
          >
            {messageType === 'success' ? (
              <CheckCircle2 size={16} />
            ) : messageType === 'warning' ? (
              <AlertTriangle size={16} />
            ) : (
              <AlertCircle size={16} />
            )}
            <span style={{ flex: 1 }}>{message}</span>

            {confirmJumpData && (
              <button
                type="button"
                onClick={() => void refreshRate(true)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 6,
                  background: '#f59e0b',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                Confirm Jump & Apply
              </button>
            )}
          </div>
        )}
      </div>

      {/* Grid: Manual Override & Bybit Credentials */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        {/* Manual Override Control */}
        <div
          className="cf-panel"
          style={{
            padding: 20,
            borderRadius: 12,
            background: 'var(--admin-card-bg, #ffffff)',
            border: '1px solid var(--admin-border, #e2e8f0)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sliders size={18} color="#f97316" />
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--admin-text, #0f172a)' }}>
              Manual Rate Override
            </h2>
          </div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--admin-muted, #64748b)' }}>
            Lock a fixed USD/NGN exchange rate for selling price calculations across ShopViaClone22, HStora USD items, and DigitalTop.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--admin-text, #334155)' }}>
              Override Rate (₦ per USD)
              <input
                type="number"
                step="0.01"
                min="500"
                max="5000"
                value={overrideInput}
                onChange={(e) => setOverrideInput(e.target.value)}
                placeholder="1500.00"
                style={{
                  width: '100%',
                  marginTop: 6,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--admin-border, #cbd5e1)',
                  background: 'var(--admin-input-bg, #ffffff)',
                  color: 'var(--admin-text, #0f172a)',
                  fontSize: '0.95rem',
                }}
              />
            </label>

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => void handleToggleOverride(true)}
                disabled={loading}
                className="cf-btn"
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 8,
                  background: '#f97316',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                Apply Override
              </button>
              {rateState?.override_active && (
                <button
                  type="button"
                  onClick={() => void handleToggleOverride(false)}
                  disabled={loading}
                  className="cf-btn"
                  style={{
                    padding: '10px 16px',
                    borderRadius: 8,
                    background: 'var(--admin-subtle, #f1f5f9)',
                    color: 'var(--admin-text, #334155)',
                    border: '1px solid var(--admin-border, #cbd5e1)',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: loading ? 'not-allowed' : 'pointer',
                  }}
                >
                  Disable Override
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Bybit API Credentials */}
        <div
          className="cf-panel"
          style={{
            padding: 20,
            borderRadius: 12,
            background: 'var(--admin-card-bg, #ffffff)',
            border: '1px solid var(--admin-border, #e2e8f0)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Key size={18} color="#10b981" />
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--admin-text, #0f172a)' }}>
                Bybit V5 P2P Credentials
              </h2>
            </div>
            <span
              style={{
                fontSize: '0.75rem',
                padding: '2px 8px',
                borderRadius: 12,
                fontWeight: 700,
                background: rateState?.bybit_configured ? '#10b98120' : '#64748b20',
                color: rateState?.bybit_configured ? '#10b981' : '#64748b',
              }}
            >
              {rateState?.bybit_configured ? 'CONFIGURED' : 'NOT SET'}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--admin-muted, #64748b)' }}>
            Requires an active Bybit account with Verified Advertiser/Merchant status to poll official P2P rates without scraping.
          </p>

          <form onSubmit={handleSaveCredentials} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--admin-text, #334155)' }}>
              Bybit API Key {rateState?.bybit_api_key_masked && `(${rateState.bybit_api_key_masked})`}
              <input
                type="text"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="Enter Bybit V5 API Key..."
                style={{
                  width: '100%',
                  marginTop: 6,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--admin-border, #cbd5e1)',
                  background: 'var(--admin-input-bg, #ffffff)',
                  color: 'var(--admin-text, #0f172a)',
                  fontSize: '0.85rem',
                  fontFamily: 'monospace',
                }}
              />
            </label>

            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--admin-text, #334155)' }}>
              Bybit API Secret
              <input
                type="password"
                value={apiSecretInput}
                onChange={(e) => setApiSecretInput(e.target.value)}
                placeholder="Enter Bybit API Secret..."
                style={{
                  width: '100%',
                  marginTop: 6,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--admin-border, #cbd5e1)',
                  background: 'var(--admin-input-bg, #ffffff)',
                  color: 'var(--admin-text, #0f172a)',
                  fontSize: '0.85rem',
                  fontFamily: 'monospace',
                }}
              />
            </label>

            <button
              type="submit"
              disabled={loading || (!apiKeyInput.trim() && !apiSecretInput.trim())}
              className="cf-btn"
              style={{
                marginTop: 4,
                padding: '10px 16px',
                borderRadius: 8,
                background: '#10b981',
                color: '#fff',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: loading || (!apiKeyInput.trim() && !apiSecretInput.trim()) ? 'not-allowed' : 'pointer',
              }}
            >
              Save Credentials
            </button>
          </form>
        </div>
      </div>

      {/* History Log Table */}
      <div
        className="cf-panel"
        style={{
          padding: 20,
          borderRadius: 12,
          background: 'var(--admin-card-bg, #ffffff)',
          border: '1px solid var(--admin-border, #e2e8f0)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <History size={18} color="#64748b" />
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--admin-text, #0f172a)' }}>
            Recent Rate Sync History
          </h2>
        </div>

        {history.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--admin-muted, #64748b)', fontSize: '0.875rem' }}>
            No exchange rate sync events recorded yet. Click Refresh Rate to trigger an initial sync.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--admin-border, #e2e8f0)', textAlign: 'left', color: 'var(--admin-muted, #64748b)' }}>
                  <th style={{ padding: '8px 12px' }}>Timestamp</th>
                  <th style={{ padding: '8px 12px' }}>Rate (₦/$)</th>
                  <th style={{ padding: '8px 12px' }}>Source</th>
                  <th style={{ padding: '8px 12px' }}>Sample Size</th>
                  <th style={{ padding: '8px 12px' }}>Status</th>
                  <th style={{ padding: '8px 12px' }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} style={{ borderBottom: '1px solid var(--admin-subtle, #f1f5f9)' }}>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: 'var(--admin-text, #0f172a)' }}>
                      {new Date(h.recorded_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--admin-text, #0f172a)' }}>
                      ₦{h.rate.toFixed(2)}
                    </td>
                    <td style={{ padding: '10px 12px', textTransform: 'uppercase', fontSize: '0.75rem', fontWeight: 600 }}>
                      {h.source}
                    </td>
                    <td style={{ padding: '10px 12px' }}>{h.sample_size} ads</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 10,
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          background: h.status === 'active' ? '#10b98120' : '#ef444420',
                          color: h.status === 'active' ? '#10b981' : '#ef4444',
                        }}
                      >
                        {h.status}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--admin-muted, #64748b)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {h.error_detail || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

