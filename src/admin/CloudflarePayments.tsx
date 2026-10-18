import { useState, useEffect } from 'react'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import {
  CreditCard,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronUp,
  Activity,
  ShieldCheck,
  Radio,
} from 'lucide-react'

type PaymentAttempt = {
  id: string
  order_id: string
  reference: string
  customer_id: string
  customer_email: string
  client_request_id: string
  checkout_id: string | null
  idempotency_key: string
  provider_mode: string
  amount_minor: number
  currency: string
  attempt_status: string
  payment_status: string
  fulfillment_status: string
  created_at: number
  updated_at: number
}

type WebhookEvent = {
  event_id: string
  event_type: string
  checkout_id: string | null
  attempt_id: string | null
  processing_status: string
  received_at: number
  processed_at: number | null
}

type PaymentMetrics = {
  total_volume_minor: number
  total_paid: number
  total_attempts: number
  total_open: number
  total_failed: number
  total_refunded: number
  webhook_count: number
  webhook_processed: number
}

type PaymentStatus = {
  mode: string
  apiKeyConfigured: boolean
  webhookSecretConfigured: boolean
  ledgerTables: string[]
  webhookHandlerEnabled: boolean
  history: PaymentAttempt[]
  webhooks: WebhookEvent[]
  metrics: PaymentMetrics
  paymentReadPermission: string
  providerCheck: string
  providerHttpStatus: number | null
  webhookDestinationConfigured: boolean | null
  blockers: string[]
}

export default function CloudflarePayments() {
  const [status, setStatus] = useState<PaymentStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [activeTab, setActiveTab] = useState<'all' | 'paid' | 'open' | 'failed' | 'review'>('all')
  const [query, setQuery] = useState('')
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [showConfig, setShowConfig] = useState(false)

  async function refresh() {
    setBusy(true)
    setError('')
    try {
      const data = await cloudflareRequest<{ payments: PaymentStatus }>('/api/admin/readiness?verify_bachs=1')
      setStatus(data.payments)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Payment readiness unavailable.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const history = status?.history || []
  const filteredHistory = history.filter((item) => {
    if (activeTab === 'paid' && item.attempt_status !== 'paid' && item.payment_status !== 'paid') return false
    if (activeTab === 'open' && !['initiating', 'open'].includes(item.attempt_status)) return false
    if (activeTab === 'failed' && !['failed', 'expired'].includes(item.attempt_status)) return false
    if (activeTab === 'review' && item.attempt_status !== 'needs_review' && item.payment_status !== 'refunded') return false

    if (query.trim()) {
      const q = query.toLowerCase()
      return (
        item.reference?.toLowerCase().includes(q) ||
        item.customer_email?.toLowerCase().includes(q) ||
        item.checkout_id?.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q)
      )
    }
    return true
  })

  const formatNgn = (minor: number) =>
    new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(minor / 100)

  return (
    <section className="cf-panel" style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>Bachs Payments & Transaction Monitor</h2>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                padding: '4px 8px',
                borderRadius: 6,
                background: status?.mode === 'live' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                color: status?.mode === 'live' ? '#10b981' : '#f59e0b',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {status?.mode ?? 'Checking'}
            </span>
          </div>
          <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '0.875rem' }}>
            Production Webhook: <code style={{ color: '#6366f1' }}>https://logspoll.com/api/webhooks/bachs</code>
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="cf-btn secondary"
            onClick={() => setShowConfig(!showConfig)}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <ShieldCheck size={16} />
            {showConfig ? 'Hide Diagnostics' : 'View Diagnostics'}
          </button>
          <button
            type="button"
            className="cf-btn"
            disabled={busy}
            onClick={() => void refresh()}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
            {busy ? 'Verifying…' : 'Refresh Transactions'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: '#ef4444', marginBottom: 20 }}>
          {error}
        </div>
      )}

      {/* KPI Metrics */}
      {status?.metrics && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 16,
            marginBottom: 24,
          }}
        >
          <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', padding: '16px', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#6366f1', marginBottom: 6 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Paid Volume
              </span>
              <CreditCard size={18} />
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f8fafc' }}>
              {formatNgn(status.metrics.total_volume_minor)}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }}>
              {status.metrics.total_paid} successful payments
            </div>
          </div>

          <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', padding: '16px', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#10b981', marginBottom: 6 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Paid Orders
              </span>
              <CheckCircle2 size={18} />
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#10b981' }}>{status.metrics.total_paid}</div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }}>Reconciled & Entitled</div>
          </div>

          <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', padding: '16px', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#f59e0b', marginBottom: 6 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                In-Flight Checkouts
              </span>
              <Clock size={18} />
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f59e0b' }}>{status.metrics.total_open}</div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }}>Active reservations held</div>
          </div>

          <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', padding: '16px', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#ef4444', marginBottom: 6 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Expired / Failed
              </span>
              <AlertTriangle size={18} />
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ef4444' }}>{status.metrics.total_failed}</div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }}>Holds safely released</div>
          </div>

          <div style={{ background: 'rgba(148,163,184,0.06)', border: '1px solid rgba(148,163,184,0.2)', padding: '16px', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 6 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Webhooks Processed
              </span>
              <Activity size={18} />
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f8fafc' }}>
              {status.metrics.webhook_processed}/{status.metrics.webhook_count}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }}>HMAC signature verified</div>
          </div>
        </div>
      )}

      {/* Diagnostics Accordion */}
      {showConfig && status && (
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 18, marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '1.1rem', fontWeight: 600 }}>Provider Diagnostics & Permissions</h3>
          <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px 24px', margin: 0 }}>
            <div>
              <dt style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Credential Environment</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{status.mode}</dd>
            </div>
            <div>
              <dt style={{ color: '#94a3b8', fontSize: '0.8rem' }}>API Key Configured</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{status.apiKeyConfigured ? 'Yes (Encrypted)' : 'No'}</dd>
            </div>
            <div>
              <dt style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Webhook Secret</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{status.webhookSecretConfigured ? 'Configured (HMAC-SHA256 active)' : 'Missing'}</dd>
            </div>
            <div>
              <dt style={{ color: '#94a3b8', fontSize: '0.8rem' }}>D1 Ledger Tables</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{status.ledgerTables.join(', ') || 'None'}</dd>
            </div>
            <div>
              <dt style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Provider API Status</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>
                {status.providerCheck} {status.providerHttpStatus !== null ? `(HTTP ${status.providerHttpStatus})` : ''}
              </dd>
            </div>
            <div>
              <dt style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Webhook Destination</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>
                {status.webhookDestinationConfigured === true
                  ? 'Configured for https://logspoll.com/api/webhooks/bachs'
                  : status.webhookDestinationConfigured === false
                    ? 'Endpoint not registered in Bachs dashboard'
                    : 'Unverified'}
              </dd>
            </div>
          </dl>

          {status.blockers.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f59e0b', marginBottom: 6 }}>
                Production Deployment Gates:
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.85rem', color: '#94a3b8' }}>
                {status.blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Transaction Filter Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            ['all', `All (${history.length})`],
            ['paid', `Paid (${status?.metrics?.total_paid ?? 0})`],
            ['open', `In-Flight (${status?.metrics?.total_open ?? 0})`],
            ['failed', `Failed (${status?.metrics?.total_failed ?? 0})`],
            ['review', `Review / Refunded (${status?.metrics?.total_refunded ?? 0})`],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`cf-btn ${activeTab === key ? '' : 'secondary'}`}
              onClick={() => setActiveTab(key as typeof activeTab)}
              style={{ padding: '6px 12px', fontSize: '0.85rem' }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ position: 'relative', minWidth: 260 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#94a3b8' }} />
          <input
            type="text"
            placeholder="Search reference, email, checkout ID..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ paddingLeft: 32, fontSize: '0.85rem', width: '100%' }}
          />
        </div>
      </div>

      {/* Transactions Table */}
      <div style={{ overflowX: 'auto', background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', textAlign: 'left' }}>
              <th style={{ padding: '12px 14px' }}>Reference</th>
              <th style={{ padding: '12px 14px' }}>Customer</th>
              <th style={{ padding: '12px 14px' }}>Amount</th>
              <th style={{ padding: '12px 14px' }}>Mode</th>
              <th style={{ padding: '12px 14px' }}>Payment Status</th>
              <th style={{ padding: '12px 14px' }}>Fulfillment</th>
              <th style={{ padding: '12px 14px' }}>Date</th>
              <th style={{ padding: '12px 14px' }}>Details</th>
            </tr>
          </thead>
          <tbody>
            {filteredHistory.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                  No transactions match the selected filter.
                </td>
              </tr>
            ) : (
              filteredHistory.map((t) => {
                const isExpanded = expandedRow === t.id
                return (
                  <>
                    <tr
                      key={t.id}
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        background: isExpanded ? 'rgba(99,102,241,0.04)' : undefined,
                      }}
                    >
                      <td style={{ padding: '12px 14px', fontWeight: 600 }}>{t.reference}</td>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ color: '#f8fafc' }}>{t.customer_email}</div>
                        {t.checkout_id && (
                          <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                            {t.checkout_id}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', fontWeight: 700 }}>{formatNgn(t.amount_minor)}</td>
                      <td style={{ padding: '12px 14px' }}>
                        <span
                          style={{
                            fontSize: '0.75rem',
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: t.provider_mode === 'live' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                            color: t.provider_mode === 'live' ? '#10b981' : '#f59e0b',
                            textTransform: 'uppercase',
                          }}
                        >
                          {t.provider_mode}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span
                          style={{
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            padding: '4px 8px',
                            borderRadius: 6,
                            background:
                              t.payment_status === 'paid' || t.attempt_status === 'paid'
                                ? 'rgba(16,185,129,0.15)'
                                : ['open', 'initiating'].includes(t.attempt_status)
                                  ? 'rgba(99,102,241,0.15)'
                                  : 'rgba(239,68,68,0.15)',
                            color:
                              t.payment_status === 'paid' || t.attempt_status === 'paid'
                                ? '#10b981'
                                : ['open', 'initiating'].includes(t.attempt_status)
                                  ? '#818cf8'
                                  : '#ef4444',
                            textTransform: 'capitalize',
                          }}
                        >
                          {t.payment_status || t.attempt_status}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span
                          style={{
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            padding: '4px 8px',
                            borderRadius: 6,
                            background:
                              t.fulfillment_status === 'delivered'
                                ? 'rgba(16,185,129,0.15)'
                                : 'rgba(148,163,184,0.15)',
                            color: t.fulfillment_status === 'delivered' ? '#10b981' : '#94a3b8',
                            textTransform: 'capitalize',
                          }}
                        >
                          {t.fulfillment_status}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', color: '#94a3b8', fontSize: '0.8rem' }}>
                        {new Date(t.created_at).toLocaleString()}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <button
                          type="button"
                          className="cf-btn secondary"
                          style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                          onClick={() => setExpandedRow(isExpanded ? null : t.id)}
                        >
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </td>
                    </tr>

                    {/* Expanded details */}
                    {isExpanded && (
                      <tr style={{ background: 'rgba(99,102,241,0.02)' }}>
                        <td colSpan={8} style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, fontSize: '0.8rem' }}>
                            <div>
                              <strong style={{ color: '#94a3b8' }}>Attempt UUID:</strong>
                              <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{t.id}</div>
                            </div>
                            <div>
                              <strong style={{ color: '#94a3b8' }}>Order UUID:</strong>
                              <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{t.order_id}</div>
                            </div>
                            <div>
                              <strong style={{ color: '#94a3b8' }}>Idempotency Key:</strong>
                              <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{t.idempotency_key}</div>
                            </div>
                            <div>
                              <strong style={{ color: '#94a3b8' }}>Client Request ID:</strong>
                              <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{t.client_request_id}</div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Webhook Activity Feed */}
      {status?.webhooks && status.webhooks.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Radio size={16} color="#6366f1" />
            Recent Webhook Events
          </h3>
          <div style={{ overflowX: 'auto', background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', textAlign: 'left' }}>
                  <th style={{ padding: '10px 14px' }}>Event ID</th>
                  <th style={{ padding: '10px 14px' }}>Event Type</th>
                  <th style={{ padding: '10px 14px' }}>Checkout Reference</th>
                  <th style={{ padding: '10px 14px' }}>Processing Status</th>
                  <th style={{ padding: '10px 14px' }}>Received At</th>
                </tr>
              </thead>
              <tbody>
                {status.webhooks.map((w) => (
                  <tr key={w.event_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#818cf8' }}>{w.event_id}</td>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{w.event_type}</td>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#94a3b8' }}>{w.checkout_id ?? '—'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          padding: '2px 6px',
                          borderRadius: 4,
                          background:
                            w.processing_status === 'processed'
                              ? 'rgba(16,185,129,0.15)'
                              : w.processing_status === 'needs_review'
                                ? 'rgba(245,158,11,0.15)'
                                : 'rgba(148,163,184,0.15)',
                          color:
                            w.processing_status === 'processed'
                              ? '#10b981'
                              : w.processing_status === 'needs_review'
                                ? '#f59e0b'
                                : '#94a3b8',
                        }}
                      >
                        {w.processing_status}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', color: '#94a3b8', fontSize: '0.8rem' }}>
                      {new Date(w.received_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
