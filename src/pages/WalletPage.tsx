import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Download, Plus, Search, Eye, EyeOff, ShieldCheck,
  Lock, ArrowDown, ArrowUp, ArrowRight, RefreshCw, AlertCircle, X
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import { useDashboard } from './DashboardContext'
import { FundWalletSheet } from '../components/FundWalletSheet'
import { TransactionDetailsSheet } from '../components/TransactionDetailsSheet'
import type { WalletTransactionItem } from '../components/TransactionDetailsSheet'

interface WalletInfo {
  id: string
  currency: string
  balance_minor: number
  balance: number
  status: 'active' | 'frozen' | 'closed'
  created_at: number
  updated_at: number
}

interface WalletOverviewResponse {
  wallet: WalletInfo
  transactions: WalletTransactionItem[]
  pending_deposits?: unknown[]
  deposit_limits?: {
    min_ngn: number
    max_ngn: number
    fee_percent: number
  }
  funding?: { enabled: boolean; mode?: string; reason: string }
}

export function WalletPage() {
  const { session } = useAuth()
  const { hideBalance, toggleHideBalance, setWalletBalanceMinor, showToast } = useDashboard()
  const [searchParams, setSearchParams] = useSearchParams()

  const [wallet, setWallet] = useState<WalletInfo | null>(null)
  const [transactions, setTransactions] = useState<WalletTransactionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notification, setNotification] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null)

  // Filter & Search
  const [txFilter, setTxFilter] = useState<'all' | 'credit' | 'debit'>('all')
  const [txSearch, setTxSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)

  // Sheets
  const [showFundSheet, setShowFundSheet] = useState(false)
  const [selectedTx, setSelectedTx] = useState<WalletTransactionItem | null>(null)

  const formatPrice = (minor: number) =>
    new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(minor / 100)

  const fetchWallet = useCallback(async (isRefresh = false) => {
    if (!session) return
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError('')

    try {
      const data = await cloudflareRequest<WalletOverviewResponse>('/api/wallet')
      setWallet(data.wallet)
      if (data.wallet) {
        setWalletBalanceMinor(data.wallet.balance_minor)
      }
      setTransactions(data.transactions || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load wallet information.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [session, setWalletBalanceMinor])

  useEffect(() => {
    void fetchWallet()
  }, [fetchWallet])

  // Open fund sheet if requested in URL
  useEffect(() => {
    if (searchParams.get('fund') === '1') {
      setShowFundSheet(true)
      searchParams.delete('fund')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // Return from Bachs checkout session handling
  useEffect(() => {
    const fundingStatus = searchParams.get('funding_status')
    const attemptId = searchParams.get('attempt_id')

    if (fundingStatus === 'success' && attemptId) {
      setNotification({
        type: 'info',
        message: 'Verifying your wallet deposit confirmation with the payment gateway…',
      })

      cloudflareRequest<{ status: string }>(`/api/wallet/reconcile?attempt_id=${encodeURIComponent(attemptId)}`)
        .then((res) => {
          if (res.status === 'paid') {
            setNotification({
              type: 'success',
              message: 'Deposit confirmed! Your wallet balance has been credited successfully.',
            })
          } else {
            setNotification({
              type: 'info',
              message: 'Deposit submitted. The transaction will appear once the payment gateway finalizes confirmation.',
            })
          }
          void fetchWallet(true)
        })
        .catch(() => {
          void fetchWallet(true)
        })
        .finally(() => {
          searchParams.delete('funding_status')
          searchParams.delete('attempt_id')
          setSearchParams(searchParams, { replace: true })
        })
    } else if (fundingStatus === 'cancelled') {
      setNotification({
        type: 'info',
        message: 'Checkout was cancelled.',
      })
      searchParams.delete('funding_status')
      searchParams.delete('attempt_id')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams, fetchWallet])

  // Export CSV Statement
  const exportCsv = () => {
    if (transactions.length === 0) {
      showToast('No transactions to export yet.')
      return
    }
    const headers = ['Reference', 'Date & Time', 'Type', 'Flow', 'Amount (NGN)', 'Balance After (NGN)', 'Status', 'Description/Order']
    const rows = transactions.map((t) => [
      t.reference,
      new Date(t.created_at).toISOString(),
      t.type,
      t.direction,
      (t.direction === 'credit' ? '+' : '-') + (t.amount_minor / 100).toFixed(2),
      t.balance_after_minor !== undefined && t.balance_after_minor !== null ? (t.balance_after_minor / 100).toFixed(2) : '',
      t.status,
      t.reason || t.order_reference || '',
    ])
    const csv = [headers, ...rows]
      .map((row) => row.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `logspoll-wallet-statement-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    showToast('Transaction statement downloaded.')
  }

  // Filter transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (txFilter === 'credit' && t.direction !== 'credit') return false
      if (txFilter === 'debit' && t.direction !== 'debit') return false
      if (txSearch.trim()) {
        const q = txSearch.toLowerCase().trim()
        const matchRef = t.reference.toLowerCase().includes(q)
        const matchOrder = t.order_reference?.toLowerCase().includes(q)
        const matchType = t.type.toLowerCase().includes(q)
        const matchReason = t.reason?.toLowerCase().includes(q)
        return matchRef || matchOrder || matchType || matchReason
      }
      return true
    })
  }, [transactions, txFilter, txSearch])

  // Group transactions by "Today" vs "Earlier"
  const groupedTransactions = useMemo(() => {
    const today = new Date().toDateString()
    const todayItems: WalletTransactionItem[] = []
    const earlierItems: WalletTransactionItem[] = []

    for (const t of filteredTransactions) {
      const d = new Date(t.created_at).toDateString()
      if (d === today) {
        todayItems.push(t)
      } else {
        earlierItems.push(t)
      }
    }

    const groups: { group: string; items: WalletTransactionItem[] }[] = []
    if (todayItems.length > 0) groups.push({ group: 'Today', items: todayItems })
    if (earlierItems.length > 0) groups.push({ group: 'Earlier', items: earlierItems })
    return groups
  }, [filteredTransactions])

  const formatDateTime = (raw: number | string) => {
    const d = new Date(raw)
    if (isNaN(d.getTime())) return String(raw)
    return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
  }

  return (
    <div>
      {/* Screen Head */}
      <div className="fintech-screen-head">
        <div>
          <p className="fintech-eyebrow">YOUR MONEY, SIMPLIFIED</p>
          <h1>My Wallet</h1>
          <p>Fund your balance and see every transaction.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="fintech-icon-btn"
            style={{ width: 32, height: 32 }}
            onClick={() => void fetchWallet(true)}
            disabled={loading || refreshing}
            title="Refresh balance"
            aria-label="Refresh balance"
          >
            <RefreshCw size={14} className={refreshing ? 'spin-icon' : ''} />
          </button>
          <span className="fintech-small-secure">
            <Lock size={12} /> Secured
          </span>
        </div>
      </div>

      {/* Notifications */}
      {notification && (
        <div
          className="fintech-notice"
          style={{
            borderColor: notification.type === 'success' ? 'var(--positive)' : 'var(--orange)',
            background: notification.type === 'success' ? 'var(--positive-wash)' : 'var(--orange-wash)',
            marginBottom: 16,
          }}
        >
          <ShieldCheck size={16} />
          <span style={{ flex: 1 }}>{notification.message}</span>
          <button type="button" onClick={() => setNotification(null)} style={{ border: 0, background: 'none', cursor: 'pointer' }}>
            <X size={15} />
          </button>
        </div>
      )}

      {error && (
        <div
          className="fintech-notice"
          style={{ borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.06)', color: '#dc2626', marginBottom: 16 }}
        >
          <AlertCircle size={16} />
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" onClick={() => void fetchWallet(true)} className="fintech-more" style={{ color: '#dc2626' }}>
            Retry
          </button>
        </div>
      )}

      {/* Wallet Grid */}
      <div className="fintech-wallet-grid">
        {/* Left Column: Wallet Hero + Explainer + How It Works */}
        <div className="fintech-stack">
          {/* Wallet Hero Card (Matches Reference 2 & 3) */}
          <section className="fintech-wallet-hero" aria-label="Wallet balance">
            <div className="fintech-hero-overline">
              <span>Personal NGN wallet</span>
              <span className="tag">
                <i className="online" /> NGN
              </span>
            </div>

            <p className="fintech-hero-amount-label">Available balance</p>

            <div className="fintech-hero-amount">
              <span className="balance-number">
                {hideBalance ? '₦ ••••••••' : formatPrice(wallet?.balance_minor ?? 0)}
              </span>
              <button
                type="button"
                className="fintech-eye-btn"
                onClick={toggleHideBalance}
                aria-label={hideBalance ? 'Show wallet balance' : 'Hide wallet balance'}
              >
                {hideBalance ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            <p className="fintech-hero-sub">
              <ShieldCheck size={14} /> Available after verified payment
            </p>

            <div className="fintech-hero-actions">
              <button
                type="button"
                className="fintech-btn fintech-btn-orange"
                onClick={() => setShowFundSheet(true)}
              >
                <Plus size={16} /> Add money
              </button>
              <button
                type="button"
                className="fintech-btn fintech-btn-hero-alt"
                onClick={exportCsv}
              >
                <Download size={16} /> Statement
              </button>
            </div>
          </section>

          {/* Funding Explainer */}
          <div className="fintech-funding-explainer">
            <span className="bolt">
              <Lock size={18} />
            </span>
            <div>
              <h3>Safe, one-time funding details</h3>
              <p>
                A new temporary bank account is provided by the payment provider for each funding request. Funds are credited only after verification.
              </p>
            </div>
          </div>

          {/* How funding works */}
          <section className="fintech-panel fintech-how" aria-label="How wallet funding works">
            <h2>How funding works</h2>
            <div className="fintech-how-step">
              <span className="fintech-step-num">01</span>
              <div>
                <strong>Choose an amount</strong>
                <p>Enter the value you'd like to deposit.</p>
              </div>
            </div>
            <div className="fintech-how-step">
              <span className="fintech-step-num">02</span>
              <div>
                <strong>Get temporary account details</strong>
                <p>Receive fresh details for this specific funding session.</p>
              </div>
            </div>
            <div className="fintech-how-step">
              <span className="fintech-step-num">03</span>
              <div>
                <strong>Transfer and confirm</strong>
                <p>Your wallet updates after the provider verifies payment.</p>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Transactions History */}
        <section className="fintech-panel fintech-history-panel" aria-labelledby="tx-history-heading">
          <div className="fintech-panel-heading">
            <div>
              <h2 id="tx-history-heading">Transactions</h2>
              <p className="hint">A clear view of money in and out</p>
            </div>
            <button
              type="button"
              className="fintech-more"
              onClick={exportCsv}
              disabled={transactions.length === 0}
            >
              <Download size={14} /> Export
            </button>
          </div>

          <div className="fintech-history-controls">
            <div className="fintech-filter-bar" role="group" aria-label="Transaction filters">
              <button
                type="button"
                className={`fintech-filter ${txFilter === 'all' ? 'active' : ''}`}
                onClick={() => setTxFilter('all')}
              >
                All
              </button>
              <button
                type="button"
                className={`fintech-filter ${txFilter === 'credit' ? 'active' : ''}`}
                onClick={() => setTxFilter('credit')}
              >
                Money in
              </button>
              <button
                type="button"
                className={`fintech-filter ${txFilter === 'debit' ? 'active' : ''}`}
                onClick={() => setTxFilter('debit')}
              >
                Purchases
              </button>
            </div>

            <button
              type="button"
              className="fintech-search-trigger"
              onClick={() => setShowSearch((prev) => !prev)}
              aria-label="Search transactions"
            >
              <Search size={15} />
            </button>
          </div>

          {showSearch && (
            <div className="fintech-tx-search">
              <input
                type="search"
                placeholder="Search transactions or reference…"
                value={txSearch}
                onChange={(e) => setTxSearch(e.target.value)}
                autoFocus
              />
            </div>
          )}

          {/* Transactions List */}
          {loading ? (
            <div className="fintech-empty-state">
              <RefreshCw size={24} className="spin-icon" style={{ margin: '0 auto 8px', color: 'var(--orange)' }} />
              <p>Loading transactions…</p>
            </div>
          ) : filteredTransactions.length > 0 ? (
            <div>
              {groupedTransactions.map(({ group, items }) => (
                <div key={group}>
                  <div className="fintech-group-label">{group}</div>
                  <div className="fintech-history-list">
                    <ul className="fintech-tx-list">
                      {items.map((tx) => {
                        const isCredit = tx.direction === 'credit'
                        const title =
                          tx.reason ||
                          (isCredit
                            ? 'Wallet funding'
                            : tx.order_reference
                            ? `Order #${tx.order_reference}`
                            : 'Digital purchase')
                        return (
                          <li key={tx.id}>
                            <button
                              type="button"
                              className="fintech-tx-row"
                              onClick={() => setSelectedTx(tx)}
                            >
                              <span className={`fintech-tx-symbol ${isCredit ? 'credit' : ''}`}>
                                {isCredit ? <ArrowDown size={16} /> : <ArrowUp size={16} />}
                              </span>
                              <span className="fintech-tx-copy">
                                <strong>{title}</strong>
                                <small>{formatDateTime(tx.created_at)}</small>
                              </span>
                              <span className="fintech-tx-right">
                                <strong className={isCredit ? 'positive' : ''}>
                                  {isCredit ? '+' : '−'}
                                  {formatPrice(tx.amount_minor)}
                                </strong>
                                <small>{isCredit ? 'Money in' : 'Purchase'} · Done</small>
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="fintech-empty-state">
              <Search size={28} className="icon" />
              <p>{txSearch ? 'No transactions match your search query.' : 'No transactions recorded yet.'}</p>
            </div>
          )}

          {/* Footer */}
          <div className="fintech-history-footer">
            <span>
              Showing {filteredTransactions.length} of {transactions.length} transactions
            </span>
            <button
              type="button"
              className="fintech-more"
              onClick={exportCsv}
              disabled={transactions.length === 0}
            >
              <span>Download CSV</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </section>
      </div>

      {/* Fund Wallet Sheet */}
      <FundWalletSheet
        isOpen={showFundSheet}
        onClose={() => setShowFundSheet(false)}
        onSuccess={() => void fetchWallet(true)}
      />

      {/* Transaction Details Sheet */}
      <TransactionDetailsSheet
        transaction={selectedTx}
        onClose={() => setSelectedTx(null)}
      />
    </div>
  )
}
