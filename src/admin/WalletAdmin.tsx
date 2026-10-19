import { useEffect, useState, useCallback } from 'react'
import {
  Wallet,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Lock,
  Unlock,
  PlusCircle,
  MinusCircle,
  Copy,
  Check
} from 'lucide-react'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import { useCurrency } from '../lib/currency'

interface AdminWalletItem {
  id: string
  customer_id: string
  currency: string
  balance_minor: number
  balance: number
  status: 'active' | 'frozen' | 'closed'
  created_at: number
  updated_at: number
  email: string
  customer_name: string
  transaction_count: number
  wallet_orders_count: number
}

interface AdminWalletStats {
  total_liabilities_minor: number
  total_liabilities: number
  total_wallets: number
  frozen_wallets: number
}

interface AdminTransactionItem {
  id: string
  wallet_id: string
  customer_id: string
  reference: string
  type: string
  direction: 'credit' | 'debit'
  amount_minor: number
  amount: number
  balance_before_minor: number
  balance_after_minor: number
  status: string
  order_id: string | null
  reason: string | null
  created_at: number
  customer_email?: string
}

export function WalletAdmin() {
  const { formatPrice } = useCurrency()
  const [stats, setStats] = useState<AdminWalletStats>({
    total_liabilities_minor: 0,
    total_liabilities: 0,
    total_wallets: 0,
    frozen_wallets: 0
  })
  const [wallets, setWallets] = useState<AdminWalletItem[]>([])
  const [transactions, setTransactions] = useState<AdminTransactionItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Freeze Modal State
  const [freezeTarget, setFreezeTarget] = useState<AdminWalletItem | null>(null)
  const [freezeReason, setFreezeReason] = useState('')
  const [freezeBusy, setFreezeBusy] = useState(false)

  // Adjustment Modal State
  const [adjustTarget, setAdjustTarget] = useState<AdminWalletItem | null>(null)
  const [adjustDirection, setAdjustDirection] = useState<'credit' | 'debit'>('credit')
  const [adjustAmountNaira, setAdjustAmountNaira] = useState<string>('500')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjustBusy, setAdjustBusy] = useState(false)

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2500)
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const q = searchQuery.trim() ? `?q=${encodeURIComponent(searchQuery.trim())}` : ''
      const res = await cloudflareRequest<{
        stats: AdminWalletStats
        wallets: AdminWalletItem[]
        recent_transactions: AdminTransactionItem[]
      }>(`/api/admin/wallets${q}`)

      setStats(res.stats)
      setWallets(res.wallets || [])
      setTransactions(res.recent_transactions || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load wallet management data.')
    } finally {
      setLoading(false)
    }
  }, [searchQuery])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronize authenticated account state on navigation.
    void loadData()
  }, [loadData])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void loadData()
  }

  const handleConfirmFreeze = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!freezeTarget || freezeBusy) return
    if (!freezeReason.trim() || freezeReason.trim().length < 5) {
      setError('A detailed audit justification reason (at least 5 characters) is required.')
      return
    }

    setFreezeBusy(true)
    setError('')
    try {
      const shouldFreeze = freezeTarget.status !== 'frozen'
      await cloudflareRequest('/api/admin/wallets/freeze', {
        customerId: freezeTarget.customer_id,
        freeze: shouldFreeze,
        reason: freezeReason.trim()
      })
      setSuccessMsg(`Wallet for ${freezeTarget.email} successfully ${shouldFreeze ? 'frozen' : 'unfrozen'}.`)
      setFreezeTarget(null)
      setFreezeReason('')
      void loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to change wallet freeze status.')
    } finally {
      setFreezeBusy(false)
    }
  }

  const handleConfirmAdjustment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!adjustTarget || adjustBusy) return
    const naira = parseFloat(adjustAmountNaira)
    if (!/^\d+(?:\.\d{1,2})?$/.test(adjustAmountNaira) || !Number.isFinite(naira) || naira <= 0) {
      setError('Please enter a valid positive adjustment amount.')
      return
    }
    if (!adjustReason.trim() || adjustReason.trim().length < 5) {
      setError('A mandatory audit trail reason (at least 5 characters) is required.')
      return
    }

    const amountMinor = Math.round(naira * 100)
    if (!window.confirm(`Confirm ${adjustDirection} of ₦${naira.toLocaleString('en-NG')} for ${adjustTarget.email}? Reason: ${adjustReason.trim()}`)) return
    setAdjustBusy(true)
    setError('')
    try {
      await cloudflareRequest('/api/admin/wallets/adjust', {
        customerId: adjustTarget.customer_id,
        direction: adjustDirection,
        amountMinor,
        reason: adjustReason.trim()
      })
      setSuccessMsg(`Successfully applied ${adjustDirection.toUpperCase()} of ₦${naira.toLocaleString()} to ${adjustTarget.email}.`)
      setAdjustTarget(null)
      setAdjustReason('')
      void loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete manual wallet adjustment.')
    } finally {
      setAdjustBusy(false)
    }
  }

  return (
    <div className="admin-page-container">
      <div className="admin-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>
            <Wallet size={24} color="#ff6500" />
            <span>Customer Wallet Management</span>
          </h1>
          <p style={{ margin: '4px 0 0', color: 'var(--lp-text-muted)', fontSize: '0.875rem' }}>
            System-wide wallet liability accounting, freeze controls, and auditable balance adjustments.
          </p>
        </div>

        <button
          type="button"
          className="button button-outline button-small"
          onClick={() => void loadData()}
          disabled={loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
          <span>Refresh Ledger</span>
        </button>
      </div>

      {successMsg && (
        <div style={{ padding: '12px 16px', background: '#10b98115', border: '1px solid #10b981', color: '#047857', borderRadius: 8, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle2 size={16} />
            <span>{successMsg}</span>
          </div>
          <button type="button" onClick={() => setSuccessMsg('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>✕</button>
        </div>
      )}

      {error && (
        <div style={{ padding: '12px 16px', background: '#ef444415', border: '1px solid #ef4444', color: '#b91c1c', borderRadius: 8, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>✕</button>
        </div>
      )}

      {/* High-Level Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div style={{ background: 'var(--lp-card-bg, #ffffff)', border: '1px solid var(--lp-border, #e2e8f0)', borderRadius: 12, padding: 18 }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--lp-text-muted)', textTransform: 'uppercase' }}>
            TOTAL WALLET LIABILITIES
          </span>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#ff6500', margin: '4px 0' }}>
            {formatPrice(stats.total_liabilities_minor)}
          </div>
          <small style={{ color: 'var(--lp-text-muted)', fontSize: '0.75rem' }}>Sum of all active customer deposits</small>
        </div>

        <div style={{ background: 'var(--lp-card-bg, #ffffff)', border: '1px solid var(--lp-border, #e2e8f0)', borderRadius: 12, padding: 18 }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--lp-text-muted)', textTransform: 'uppercase' }}>
            PROVISIONED WALLETS
          </span>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--lp-text-main)', margin: '4px 0' }}>
            {stats.total_wallets}
          </div>
          <small style={{ color: 'var(--lp-text-muted)', fontSize: '0.75rem' }}>Total registered customer accounts</small>
        </div>

        <div style={{ background: 'var(--lp-card-bg, #ffffff)', border: '1px solid var(--lp-border, #e2e8f0)', borderRadius: 12, padding: 18 }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--lp-text-muted)', textTransform: 'uppercase' }}>
            FROZEN WALLETS
          </span>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: stats.frozen_wallets > 0 ? '#ef4444' : '#10b981', margin: '4px 0' }}>
            {stats.frozen_wallets}
          </div>
          <small style={{ color: 'var(--lp-text-muted)', fontSize: '0.75rem' }}>Restricted for security reviews</small>
        </div>
      </div>

      {/* Customer Wallets Search & Table */}
      <div style={{ background: 'var(--lp-card-bg, #ffffff)', border: '1px solid var(--lp-border, #e2e8f0)', borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Customer Accounts &amp; Balances</h2>
          
          <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 360 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--lp-text-muted)' }} />
              <input
                type="text"
                placeholder="Search by email, name or ID…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px 8px 32px',
                  borderRadius: 6,
                  border: '1px solid var(--lp-border, #cbd5e1)',
                  fontSize: '0.85rem',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            <button type="submit" className="button button-orange button-small">Search</button>
            {searchQuery && (
              <button
                type="button"
                className="button button-outline button-small"
                onClick={() => {
                  setSearchQuery('')
                }}
              >
                Clear
              </button>
            )}
          </form>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--lp-border, #e2e8f0)' }}>
                <th style={{ padding: '10px 12px' }}>Customer Email / Name</th>
                <th style={{ padding: '10px 12px' }}>Customer ID</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Balance</th>
                <th style={{ padding: '10px 12px', textAlign: 'center' }}>Status</th>
                <th style={{ padding: '10px 12px', textAlign: 'center' }}>Transactions</th>
                <th style={{ padding: '10px 12px', textAlign: 'center' }}>Orders Paid</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Controls</th>
              </tr>
            </thead>
            <tbody>
              {wallets.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--lp-text-muted)' }}>
                    {searchQuery ? 'No customer wallets matched your search query.' : 'No customer wallets provisioned yet.'}
                  </td>
                </tr>
              ) : (
                wallets.map((w) => (
                  <tr key={w.id} style={{ borderBottom: '1px solid var(--lp-border, #f1f5f9)' }}>
                    <td style={{ padding: '12px' }}>
                      <strong>{w.customer_name}</strong>
                      <div style={{ fontSize: '0.75rem', color: 'var(--lp-text-muted)' }}>{w.email}</div>
                    </td>

                    <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span>{w.customer_id.slice(0, 13)}…</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(w.customer_id, w.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--lp-text-muted)' }}
                          title="Copy full Customer ID"
                        >
                          {copiedId === w.id ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </td>

                    <td style={{ padding: '12px', textAlign: 'right', fontWeight: 700, fontSize: '0.95rem', color: w.balance_minor > 0 ? '#ff6500' : 'var(--lp-text-muted)' }}>
                      {formatPrice(w.balance_minor)}
                    </td>

                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '3px 8px',
                        borderRadius: 12,
                        fontSize: '0.725rem',
                        fontWeight: 700,
                        background: w.status === 'active' ? '#10b98115' : '#ef444415',
                        color: w.status === 'active' ? '#059669' : '#dc2626'
                      }}>
                        {w.status === 'active' ? 'Active' : 'Frozen'}
                      </span>
                    </td>

                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      {w.transaction_count}
                    </td>

                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      {w.wallet_orders_count}
                    </td>

                    <td style={{ padding: '12px', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button
                          type="button"
                          className="button button-outline button-small"
                          onClick={() => {
                            setAdjustTarget(w)
                            setAdjustDirection('credit')
                            setAdjustAmountNaira('500')
                            setAdjustReason('')
                          }}
                          title="Credit or Debit Balance"
                        >
                          Adjust
                        </button>
                        <button
                          type="button"
                          className={`button ${w.status === 'active' ? 'button-outline' : 'button-orange'} button-small`}
                          onClick={() => {
                            setFreezeTarget(w)
                            setFreezeReason('')
                          }}
                          title={w.status === 'active' ? 'Freeze Wallet' : 'Unfreeze Wallet'}
                        >
                          {w.status === 'active' ? 'Freeze' : 'Unfreeze'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Global Transaction Ledger Log */}
      <div style={{ background: 'var(--lp-card-bg, #ffffff)', border: '1px solid var(--lp-border, #e2e8f0)', borderRadius: 12, padding: 20 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: '1.1rem', fontWeight: 700 }}>Recent Wallet Ledger Transactions</h2>

        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--lp-border, #e2e8f0)' }}>
                <th style={{ padding: '8px 10px' }}>Date</th>
                <th style={{ padding: '8px 10px' }}>Customer</th>
                <th style={{ padding: '8px 10px' }}>Reference</th>
                <th style={{ padding: '8px 10px' }}>Type</th>
                <th style={{ padding: '8px 10px' }}>Reason / Notes</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Amount</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Balance After</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 18, textAlign: 'center', color: 'var(--lp-text-muted)' }}>
                    No ledger transactions recorded yet.
                  </td>
                </tr>
              ) : (
                transactions.map((t) => (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--lp-border, #f1f5f9)' }}>
                    <td style={{ padding: '10px', color: 'var(--lp-text-muted)' }}>
                      {new Date(t.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '10px' }}>{t.customer_email}</td>
                    <td style={{ padding: '10px', fontFamily: 'monospace' }}>{t.reference}</td>
                    <td style={{ padding: '10px', textTransform: 'uppercase', fontSize: '0.725rem', fontWeight: 700, color: t.direction === 'credit' ? '#10b981' : '#334155' }}>
                      {t.type}
                    </td>
                    <td style={{ padding: '10px' }}>{t.reason || '—'}</td>
                    <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, color: t.direction === 'credit' ? '#10b981' : 'var(--lp-text-main)' }}>
                      {t.direction === 'credit' ? '+' : '-'}{formatPrice(t.amount_minor)}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right', color: 'var(--lp-text-muted)' }}>
                      {formatPrice(t.balance_after_minor)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: FREEZE / UNFREEZE CONFIRMATION */}
      {freezeTarget && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16
        }}>
          <div style={{ background: 'var(--lp-card-bg, #ffffff)', borderRadius: 14, maxWidth: 440, width: '100%', padding: 24, boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              {freezeTarget.status === 'active' ? <Lock size={20} color="#ef4444" /> : <Unlock size={20} color="#10b981" />}
              <span>{freezeTarget.status === 'active' ? 'Freeze Customer Wallet' : 'Unfreeze Customer Wallet'}</span>
            </h3>

            <p style={{ fontSize: '0.875rem', color: 'var(--lp-text-muted)', lineHeight: 1.5, margin: '0 0 16px' }}>
              {freezeTarget.status === 'active'
                ? `Freezing will immediately prevent ${freezeTarget.email} from debiting funds or placing orders with this wallet balance.`
                : `Unfreezing will restore full purchasing privileges for ${freezeTarget.email}.`}
            </p>

            <form onSubmit={handleConfirmFreeze}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: 6 }}>
                Mandatory Audit Justification Reason <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <textarea
                rows={3}
                required
                minLength={5}
                placeholder="e.g. Account security audit, verified user dispute, etc."
                value={freezeReason}
                onChange={(e) => setFreezeReason(e.target.value)}
                style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--lp-border, #cbd5e1)', fontSize: '0.85rem', marginBottom: 16, boxSizing: 'border-box' }}
              />

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="button button-outline" style={{ flex: 1 }} onClick={() => setFreezeTarget(null)} disabled={freezeBusy}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`button ${freezeTarget.status === 'active' ? 'button-danger' : 'button-orange'}`}
                  style={{ flex: 1 }}
                  disabled={freezeBusy || freezeReason.trim().length < 5}
                >
                  {freezeBusy ? 'Processing…' : (freezeTarget.status === 'active' ? 'Confirm Freeze' : 'Confirm Unfreeze')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: MANUAL ADJUSTMENT */}
      {adjustTarget && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16
        }}>
          <div style={{ background: 'var(--lp-card-bg, #ffffff)', borderRadius: 14, maxWidth: 460, width: '100%', padding: 24, boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Wallet size={20} color="#ff6500" />
              <span>Authorized Balance Adjustment</span>
            </h3>

            <p style={{ fontSize: '0.85rem', color: 'var(--lp-text-muted)', margin: '0 0 16px' }}>
              Customer: <strong>{adjustTarget.email}</strong><br />
              Current Balance: <strong>{formatPrice(adjustTarget.balance_minor)}</strong>
            </p>

            <form onSubmit={handleConfirmAdjustment}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: 6 }}>Adjustment Direction</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button
                    type="button"
                    className={`button ${adjustDirection === 'credit' ? 'button-orange' : 'button-outline'}`}
                    onClick={() => setAdjustDirection('credit')}
                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  >
                    <PlusCircle size={15} />
                    <span>Credit (+)</span>
                  </button>
                  <button
                    type="button"
                    className={`button ${adjustDirection === 'debit' ? 'button-orange' : 'button-outline'}`}
                    onClick={() => setAdjustDirection('debit')}
                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  >
                    <MinusCircle size={15} />
                    <span>Debit (-)</span>
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: 6 }}>Amount (₦ NGN)</label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  value={adjustAmountNaira}
                  onChange={(e) => setAdjustAmountNaira(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--lp-border, #cbd5e1)', fontSize: '1rem', fontWeight: 700, boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: 6 }}>
                  Mandatory Audit Reason <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <textarea
                  rows={3}
                  required
                  minLength={5}
                  placeholder="e.g. Authorized goodwill credit for delayed order delivery #12345"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--lp-border, #cbd5e1)', fontSize: '0.85rem', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="button button-outline" style={{ flex: 1 }} onClick={() => setAdjustTarget(null)} disabled={adjustBusy}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button-orange"
                  style={{ flex: 1 }}
                  disabled={adjustBusy || adjustReason.trim().length < 5}
                >
                  {adjustBusy ? 'Saving…' : 'Execute Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default WalletAdmin

