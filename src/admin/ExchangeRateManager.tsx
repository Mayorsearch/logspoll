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
  Globe,
  Radio,
} from 'lucide-react'

type RateState = {
  current_rate: number
  source: 'remitano_p2p' | 'quidax_spot_proxy' | 'override' | 'fallback'
  status: 'active' | 'stale' | 'paused'
  updated_at: number
  is_fresh: boolean
  override_active: boolean
  override_rate: number | null
  remitano_configured: boolean
  remitano_access_key_masked: string | null
  remitano_base_url: string
  quidax_backup_enabled: boolean
  markup_bps: number
  proxy_asset: 'USDT'
  proxy_note: string
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

type TestResults = {
  remitano?: {
    success: boolean
    base_url_used?: string
    offers_count?: number
    rate?: number
    raw_median?: number
    details?: string
    error?: string
  }
  quidax?: {
    success: boolean
    rate?: number
    buy?: number
    sell?: number
    label?: string
    error?: string
  }
}

export default function ExchangeRateManager() {
  const [rateState, setRateState] = useState<RateState | null>(null)
  const [history, setHistory] = useState<HistoryRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [testResults, setTestResults] = useState<TestResults | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [messageType, setMessageType] = useState<'success' | 'warning' | 'error' | 'info'>('info')

  // Form states
  const [overrideInput, setOverrideInput] = useState<string>('')
  const [apiKeyInput, setApiKeyInput] = useState<string>('')
  const [apiSecretInput, setApiSecretInput] = useState<string>('')
  const [baseUrlInput, setBaseUrlInput] = useState<string>('https://api.remitano.com')
  const [quidaxBackup, setQuidaxBackup] = useState<boolean>(false)
  const [confirmJumpData, setConfirmJumpData] = useState<{ new_rate: number; current_rate: number } | null>(null)

  async function loadData() {
    try {
      const res = await cloudflareRequest<{
        rate_state: RateState
        history: HistoryRecord[]
      }>('/api/admin/exchange-rate')
      setRateState(res.rate_state)
      setHistory(res.history || [])
      setBaseUrlInput(res.rate_state.remitano_base_url || 'https://api.remitano.com')
      setQuidaxBackup(res.rate_state.quidax_backup_enabled)
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
        source?: string
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
        setMessage(res.error || res.message || 'Unable to refresh rate from market.')
        await loadData()
      }
    } catch (err) {
      setMessageType('error')
      setMessage(err instanceof Error ? err.message : 'Refresh request failed.')
    } finally {
      setLoading(false)
    }
  }

  async function testConnection() {
    setTestingConnection(true)
    setMessage(null)
    setTestResults(null)
    try {
      const res = await cloudflareRequest<{
        tested: boolean
        results: TestResults
      }>('/api/admin/exchange-rate', {
        action: 'test_connection',
        api_key: apiKeyInput.trim(),
        api_secret: apiSecretInput.trim(),
        base_url: baseUrlInput.trim(),
        test_quidax: true,
      })

      if (res.tested && res.results) {
        setTestResults(res.results)
        if (res.results.remitano?.success) {
          setMessageType('success')
          setMessage(`Remitano P2P connection succeeded! Found ${res.results.remitano.offers_count ?? 0} offers. Calculated rate: ₦${res.results.remitano.rate}/USDT.`)
        } else if (res.results.quidax?.success) {
          setMessageType('warning')
          setMessage(`Remitano P2P: ${res.results.remitano?.error || 'Unavailable'}. Quidax Spot backup ticker succeeded (₦${res.results.quidax.rate}/USDT).`)
        } else {
          setMessageType('error')
          setMessage(`Remitano connection error: ${res.results.remitano?.error || 'Failed'}`)
        }
      }
    } catch (err) {
      setMessageType('error')
      setMessage(err instanceof Error ? err.message : 'Connection test request failed.')
    } finally {
      setTestingConnection(false)
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
        base_url: baseUrlInput.trim(),
        quidax_backup_enabled: quidaxBackup,
      })

      if (res.saved) {
        setMessageType('success')
        setMessage(res.message || 'Exchange rate settings saved successfully.')
        setApiKeyInput('')
        setApiSecretInput('')
        await loadData()
      } else {
        setMessageType('error')
        setMessage(res.error || 'Failed to save settings.')
      }
    } catch (err) {
      setMessageType('error')
      setMessage(err instanceof Error ? err.message : 'Settings save failed.')
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
                background: rateState?.override_active
                  ? '#f59e0b20'
                  : rateState?.source === 'quidax_spot_proxy'
                    ? '#3b82f620'
                    : '#10b98120',
                color: rateState?.override_active
                  ? '#f59e0b'
                  : rateState?.source === 'quidax_spot_proxy'
                    ? '#2563eb'
                    : '#10b981',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <TrendingUp size={14} />
              {rateState?.override_active
                ? 'MANUAL OVERRIDE'
                : rateState?.source === 'quidax_spot_proxy'
                  ? 'QUIDAX SPOT PROXY'
                  : 'REMITANO P2P REFERENCE'}
            </span>

            {/* Asset Proxy Badge */}
            <span
              style={{
                padding: '6px 12px',
                borderRadius: 20,
                fontSize: '0.75rem',
                fontWeight: 700,
                background: '#6366f115',
                color: '#4f46e5',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
              title="USDT/NGN market represents the NGN cost to purchase 1 USD equivalent (USDT)."
            >
              <Radio size={14} />
              USDT PROXY ASSET
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
                Apply Large Jump (₦{confirmJumpData.new_rate})
              </button>
            )}
          </div>
        )}

        {/* Test Connection Breakdown Modal/Panel */}
        {testResults && (
          <div
            style={{
              marginTop: 16,
              padding: 16,
              borderRadius: 8,
              background: 'var(--admin-subtle, #f8fafc)',
              border: '1px solid var(--admin-border, #e2e8f0)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--admin-text, #0f172a)' }}>
              Live Connection Diagnostics:
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
              {/* Remitano result */}
              <div
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: testResults.remitano?.success ? '#10b98110' : '#ef444410',
                  border: `1px solid ${testResults.remitano?.success ? '#10b98130' : '#ef444430'}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <strong style={{ color: testResults.remitano?.success ? '#059669' : '#dc2626' }}>
                    Remitano P2P (Primary)
                  </strong>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>
                    {testResults.remitano?.success ? 'PASS' : 'FAIL'}
                  </span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--admin-muted, #64748b)' }}>
                  {testResults.remitano?.success ? (
                    <>
                      <div>Active Offers: {testResults.remitano.offers_count}</div>
                      <div>Calculated Rate: ₦{testResults.remitano.rate}/USDT</div>
                      <div>Base URL Used: {testResults.remitano.base_url_used}</div>
                    </>
                  ) : (
                    <div>{testResults.remitano?.error || 'Connection failed'}</div>
                  )}
                </div>
              </div>

              {/* Quidax result */}
              {testResults.quidax && (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    background: testResults.quidax.success ? '#3b82f610' : '#64748b10',
                    border: `1px solid ${testResults.quidax.success ? '#3b82f630' : '#64748b30'}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <strong style={{ color: testResults.quidax.success ? '#2563eb' : '#64748b' }}>
                      Quidax Spot Orderbook (Secondary Proxy)
                    </strong>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>
                      {testResults.quidax.success ? 'PASS' : 'FAIL'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--admin-muted, #64748b)' }}>
                    {testResults.quidax.success ? (
                      <>
                        <div>Ask (Sell): ₦{testResults.quidax.sell}/USDT</div>
                        <div>Bid (Buy): ₦{testResults.quidax.buy}/USDT</div>
                        <div>Status: Active Market Ticker</div>
                      </>
                    ) : (
                      <div>{testResults.quidax.error || 'Connection failed'}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Two Column Control Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
        {/* Manual Override Panel */}
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
            When enabled, the manual rate locks all USD supplier conversions to this fixed value, suspending automated market rate polling.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--admin-text, #334155)' }}>
              Fixed Exchange Rate (₦ / $1 USD)
              <input
                type="number"
                step="0.01"
                min="500"
                max="5000"
                value={overrideInput}
                onChange={(e) => setOverrideInput(e.target.value)}
                placeholder="e.g. 1500.00"
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
              {!rateState?.override_active ? (
                <button
                  type="button"
                  onClick={() => void handleToggleOverride(true)}
                  disabled={loading}
                  className="cf-btn"
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    borderRadius: 8,
                    background: '#f59e0b',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: loading ? 'not-allowed' : 'pointer',
                  }}
                >
                  Enable Manual Override
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleToggleOverride(false)}
                  disabled={loading}
                  className="cf-btn"
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    borderRadius: 8,
                    background: '#10b981',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: loading ? 'not-allowed' : 'pointer',
                  }}
                >
                  Disable Override (Return to Market P2P)
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Remitano P2P & Quidax Settings Panel */}
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
                Remitano P2P &amp; Quidax Config
              </h2>
            </div>
            <span
              style={{
                fontSize: '0.75rem',
                padding: '2px 8px',
                borderRadius: 12,
                fontWeight: 700,
                background: rateState?.remitano_configured ? '#10b98120' : '#64748b20',
                color: rateState?.remitano_configured ? '#10b981' : '#64748b',
              }}
            >
              {rateState?.remitano_configured ? 'AUTHENTICATED' : 'PUBLIC / DEFAULT'}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--admin-muted, #64748b)' }}>
            Retrieves USDT/NGN market offers from Remitano P2P. Credentials sign requests via official HMAC-SHA1 APIAuth.
          </p>

          <form onSubmit={handleSaveCredentials} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--admin-text, #334155)' }}>
              Remitano Base URL
              <input
                type="text"
                value={baseUrlInput}
                onChange={(e) => setBaseUrlInput(e.target.value)}
                placeholder="https://api.remitano.com"
                style={{
                  width: '100%',
                  marginTop: 6,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--admin-border, #cbd5e1)',
                  background: 'var(--admin-input-bg, #ffffff)',
                  color: 'var(--admin-text, #0f172a)',
                  fontSize: '0.85rem',
                }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)', fontWeight: 400 }}>
                Default: <code>https://api.remitano.com</code>. Supports mirror fallbacks (e.g. <code>https://api.remitano.net</code>).
              </span>
            </label>

            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--admin-text, #334155)' }}>
              Remitano Access Key {rateState?.remitano_access_key_masked && `(${rateState.remitano_access_key_masked})`}
              <input
                type="text"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="Enter Remitano Access Key..."
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
              Remitano Secret Key
              <input
                type="password"
                value={apiSecretInput}
                onChange={(e) => setApiSecretInput(e.target.value)}
                placeholder="Enter Remitano Secret Key..."
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

            {/* Quidax Secondary Backup Toggle */}
            <div
              style={{
                marginTop: 4,
                padding: '12px 14px',
                borderRadius: 8,
                background: 'var(--admin-subtle, #f8fafc)',
                border: '1px solid var(--admin-border, #e2e8f0)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
              }}
            >
              <input
                type="checkbox"
                id="quidaxBackupToggle"
                checked={quidaxBackup}
                onChange={(e) => setQuidaxBackup(e.target.checked)}
                style={{ marginTop: 3, cursor: 'pointer' }}
              />
              <label htmlFor="quidaxBackupToggle" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
                <strong style={{ color: 'var(--admin-text, #0f172a)' }}>Enable Quidax Spot Ticker Backup (Secondary Proxy)</strong>
                <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)' }}>
                  If Remitano P2P is temporarily blocked or unavailable, use Quidax USDT/NGN orderbook ask ticker as a strictly labeled secondary spot proxy (never labeled as P2P).
                </p>
              </label>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button
                type="button"
                onClick={() => void testConnection()}
                disabled={testingConnection || loading}
                className="cf-btn"
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 8,
                  background: 'var(--admin-subtle, #f1f5f9)',
                  color: 'var(--admin-text, #334155)',
                  border: '1px solid var(--admin-border, #cbd5e1)',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: testingConnection ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <Globe size={14} />
                <span>{testingConnection ? 'Testing...' : 'Test Connection'}</span>
              </button>

              <button
                type="submit"
                disabled={loading}
                className="cf-btn"
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 8,
                  background: '#10b981',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                Save Settings
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Audit History Panel */}
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
            Exchange Rate History &amp; Outlier Audit Log
          </h2>
        </div>

        {history.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--admin-muted, #64748b)', fontSize: '0.875rem' }}>
            No exchange rate refresh records recorded yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--admin-border, #e2e8f0)', textAlign: 'left', color: 'var(--admin-muted, #64748b)' }}>
                  <th style={{ padding: '8px 12px' }}>Timestamp</th>
                  <th style={{ padding: '8px 12px' }}>Applied Rate</th>
                  <th style={{ padding: '8px 12px' }}>Source</th>
                  <th style={{ padding: '8px 12px' }}>Sample Size</th>
                  <th style={{ padding: '8px 12px' }}>Raw Median</th>
                  <th style={{ padding: '8px 12px' }}>Status</th>
                  <th style={{ padding: '8px 12px' }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} style={{ borderBottom: '1px solid var(--admin-border, #f1f5f9)' }}>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      {new Date(h.recorded_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 700 }}>
                      ₦{h.rate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          padding: '2px 8px',
                          borderRadius: 10,
                          fontWeight: 600,
                          background:
                            h.source === 'override'
                              ? '#f59e0b15'
                              : h.source === 'quidax_spot_proxy'
                                ? '#3b82f615'
                                : '#10b98115',
                          color:
                            h.source === 'override'
                              ? '#f59e0b'
                              : h.source === 'quidax_spot_proxy'
                                ? '#2563eb'
                                : '#10b981',
                        }}
                      >
                        {h.source === 'override'
                          ? 'Manual Override'
                          : h.source === 'quidax_spot_proxy'
                            ? 'Quidax Spot'
                            : 'Remitano P2P'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>{h.sample_size}</td>
                    <td style={{ padding: '10px 12px' }}>
                      {h.raw_median > 0 ? `₦${h.raw_median.toFixed(2)}` : '—'}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          padding: '2px 8px',
                          borderRadius: 10,
                          fontWeight: 600,
                          background:
                            h.status === 'active'
                              ? '#10b98115'
                              : h.status === 'rejected'
                                ? '#f59e0b15'
                                : '#ef444415',
                          color:
                            h.status === 'active'
                              ? '#10b981'
                              : h.status === 'rejected'
                                ? '#f59e0b'
                                : '#ef4444',
                        }}
                      >
                        {h.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--admin-muted, #64748b)', maxWidth: 260 }}>
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
