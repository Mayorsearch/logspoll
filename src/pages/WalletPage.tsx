import { useEffect, useState, useCallback, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { 
  Wallet, ArrowUpRight, ArrowDownLeft, RefreshCw, 
  Clock, AlertCircle, CheckCircle2, Copy, Check, 
  CreditCard, X, ArrowRight, Search, PlusCircle, ExternalLink
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import '../dashboard-ui.css'

interface WalletInfo {
  id: string
  currency: string
  balance_minor: number
  balance: number
  status: 'active' | 'frozen' | 'closed'
  created_at: number
  updated_at: number
}

interface WalletTransaction {
  id: string
  reference: string
  type: 'funding' | 'purchase' | 'refund' | 'admin_adjustment' | 'reversal'
  direction: 'credit' | 'debit'
  amount_minor: number
  amount: number
  balance_before_minor: number
  balance_after_minor: number
  balance_after: number
  status: 'pending' | 'completed' | 'failed' | 'reversed' | 'refunded'
  order_id?: string | null
  order_reference?: string | null
  reason?: string | null
  created_at: number
}

export interface BankTransferDetails {
  bankName?: string
  bank_name?: string
  accountNumber?: string
  account_number?: string
  accountName?: string
  account_name?: string
  amount?: string | number
  currency?: string
  reference?: string
  expiresAt?: string | number | null
  expires_at?: string | number | null
}

interface PendingDeposit {
  id: string
  reference: string
  checkout_id?: string | null
  amount_minor: number
  amount: number
  fee: number
  credited_amount: number
  status: string
  created_at: number
  bankTransfer?: BankTransferDetails | null
}

export interface ActiveFundingSession {
  attemptId: string
  reference: string
  amountMinor: number
  amount: number
  checkoutUrl?: string
  bankTransfer?: BankTransferDetails | null
  status: 'awaiting_payment' | 'checking' | 'paid' | 'failed'
}

interface WalletOverviewResponse {
  wallet: WalletInfo
  transactions: WalletTransaction[]
  pending_deposits: PendingDeposit[]
  virtual_account: {
    status: 'AVAILABLE' | 'UNAVAILABLE' | 'UNVERIFIED'
    reason?: string
  }
  funding?: { enabled: boolean; mode?: string; reason: string }
  deposit_limits: {
    min_ngn: number
    max_ngn: number
    fee_percent: number
  }
}

const PRESET_AMOUNTS = [1000, 2000, 5000, 10000, 20000, 50000]

export function WalletPage() {
  const { session } = useAuth()
  const formatPrice = (minor: number) => new Intl.NumberFormat('en-NG', {style:'currency',currency:'NGN'}).format(minor / 100)
  const fundingRequest = useRef<{amount:number;id:string} | null>(null)
  const [funding, setFunding] = useState<{enabled:boolean;mode?:string;reason:string}>({enabled:false,mode:'unknown',reason:'Wallet funding is unavailable until provider approval and verification are complete.'})
  const [searchParams, setSearchParams] = useSearchParams()

  const [wallet, setWallet] = useState<WalletInfo | null>(null)
  const [transactions, setTransactions] = useState<WalletTransaction[]>([])
  const [pendingDeposits, setPendingDeposits] = useState<PendingDeposit[]>([])
  const [virtualAccountStatus, setVirtualAccountStatus] = useState<string>('UNVERIFIED')
  const [virtualAccountReason, setVirtualAccountReason] = useState<string>('')
  const [depositLimits, setDepositLimits] = useState({ min_ngn: 100, max_ngn: 1000000, fee_percent: 0 })

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notification, setNotification] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null)

  // Active funding modal & polling state
  const [activeFunding, setActiveFunding] = useState<ActiveFundingSession | null>(null)
  const [reconcilingId, setReconcilingId] = useState<string | null>(null)

  // Transaction filter & search state
  const [txFilter, setTxFilter] = useState<'all' | 'credit' | 'debit'>('all')
  const [txSearch, setTxSearch] = useState('')

  // Fund Modal State
  const [showFundModal, setShowFundModal] = useState(false)
  const [depositAmount, setDepositAmount] = useState<number>(2000)
  const [customAmountStr, setCustomAmountStr] = useState<string>('2000')
  const [fundingBusy, setFundingBusy] = useState(false)
  const [fundingError, setFundingError] = useState('')

  // Receipt Modal State
  const [selectedTx, setSelectedTx] = useState<WalletTransaction | null>(null)
  const [copiedRef, setCopiedRef] = useState<string | null>(null)

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedRef(id)
    setTimeout(() => setCopiedRef(null), 2500)
  }

  const fetchWallet = useCallback(async (isRefresh = false) => {
    if (!session) return
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError('')

    try {
      const data = await cloudflareRequest<WalletOverviewResponse>('/api/wallet')
      setWallet(data.wallet)
      if (data.funding) setFunding(data.funding)
      setTransactions(data.transactions || [])
      setPendingDeposits(data.pending_deposits || [])
      if (data.virtual_account) {
        setVirtualAccountStatus(data.virtual_account.status)
        setVirtualAccountReason(data.virtual_account.reason || '')
      }
      if (data.deposit_limits) {
        setDepositLimits(data.deposit_limits)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load your wallet information.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [session])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronize authenticated account state on navigation.
    void fetchWallet()
  }, [fetchWallet])

  // Handle Return from Bachs checkout session (?funding_status=success&attempt_id=...)
  useEffect(() => {
    const fundingStatus = searchParams.get('funding_status')
    const attemptId = searchParams.get('attempt_id')

    if (fundingStatus === 'success' && attemptId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Reflect the authenticated payment-return status.
      setNotification({
        type: 'info',
        message: 'Verifying your wallet deposit confirmation with the payment gateway…'
      })

      // Trigger automatic server reconciliation
      cloudflareRequest<{ status: string }>(`/api/wallet/reconcile?attempt_id=${encodeURIComponent(attemptId)}`)
        .then((res) => {
          if (res.status === 'paid') {
            setNotification({
              type: 'success',
              message: 'Deposit confirmed! Your wallet balance has been credited successfully.'
            })
          } else {
            setNotification({
              type: 'info',
              message: 'Deposit submitted. The transaction will appear as soon as the payment gateway finalizes confirmation.'
            })
          }
          void fetchWallet(true)
        })
        .catch(() => {
          void fetchWallet(true)
        })
        .finally(() => {
          // Clean up search params
          searchParams.delete('funding_status')
          searchParams.delete('attempt_id')
          setSearchParams(searchParams, { replace: true })
        })
    } else if (fundingStatus === 'cancelled') {
      setNotification({
        type: 'info',
        message: 'Checkout was cancelled. Any completed payment is verified separately.'
      })
      searchParams.delete('funding_status')
      searchParams.delete('attempt_id')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams, fetchWallet])

  const handlePresetSelect = (amt: number) => {
    setDepositAmount(amt)
    setCustomAmountStr(String(amt))
  }

  const handleCustomChange = (val: string) => {
    setCustomAmountStr(val)
    const parsed = parseFloat(val)
    if (!isNaN(parsed) && parsed > 0) {
      setDepositAmount(parsed)
    }
  }

  // Auto-polling for active deposit reconciliation every 4 seconds
  useEffect(() => {
    if (!activeFunding || activeFunding.status === 'paid' || activeFunding.status === 'failed') return
    const interval = setInterval(async () => {
      try {
        const res = await cloudflareRequest<{ status: string }>(`/api/wallet/reconcile?attempt_id=${encodeURIComponent(activeFunding.attemptId)}`)
        if (res.status === 'paid') {
          setActiveFunding((prev) => (prev ? { ...prev, status: 'paid' } : null))
          void fetchWallet(true)
        } else if (res.status === 'failed' || res.status === 'cancelled') {
          setActiveFunding((prev) => (prev ? { ...prev, status: 'failed' } : null))
          void fetchWallet(true)
        }
      } catch {
        // Silently continue polling
      }
    }, 4000)
    return () => clearInterval(interval)
  }, [activeFunding, fetchWallet])

  const handleCheckStatus = async (attemptId: string) => {
    setReconcilingId(attemptId)
    try {
      const res = await cloudflareRequest<{ status: string }>(`/api/wallet/reconcile?attempt_id=${encodeURIComponent(attemptId)}`)
      if (res.status === 'paid') {
        setActiveFunding((prev) => (prev && prev.attemptId === attemptId ? { ...prev, status: 'paid' } : prev))
        setNotification({
          type: 'success',
          message: 'Deposit confirmed! Your wallet balance has been credited successfully.'
        })
        void fetchWallet(true)
      } else if (res.status === 'failed' || res.status === 'cancelled') {
        setActiveFunding((prev) => (prev && prev.attemptId === attemptId ? { ...prev, status: 'failed' } : prev))
        setNotification({
          type: 'info',
          message: 'This payment attempt has expired or failed.'
        })
        void fetchWallet(true)
      } else {
        setNotification({
          type: 'info',
          message: 'Payment verification is still pending. Your wallet will credit as soon as Bachs confirms receipt.'
        })
      }
    } catch (err) {
      setNotification({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to verify payment status.'
      })
    } finally {
      setReconcilingId(null)
    }
  }

  const handleInitiateFunding = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session || fundingBusy || !funding.enabled) return
    if (!/^\d+(?:\.\d{1,2})?$/.test(customAmountStr)) { setFundingError('Enter an amount with at most two decimal places.'); return }
    setFundingError('')

    if (depositAmount < depositLimits.min_ngn) {
      setFundingError(`Minimum deposit amount is ₦${depositLimits.min_ngn.toLocaleString('en-NG', { minimumFractionDigits: 2 })}.`)
      return
    }
    if (depositAmount > depositLimits.max_ngn) {
      setFundingError(`Maximum deposit amount is ₦${depositLimits.max_ngn.toLocaleString('en-NG', { minimumFractionDigits: 2 })}.`)
      return
    }

    if (!fundingRequest.current || fundingRequest.current.amount !== depositAmount) fundingRequest.current = {amount:depositAmount,id:crypto.randomUUID()}
    setFundingBusy(true)
    try {
      const res = await cloudflareRequest<{
        ok: boolean
        checkoutUrl?: string
        reference: string
        attemptId: string
        bankTransfer?: BankTransferDetails | null
        amountMinor?: number
        amount?: number
      }>('/api/wallet/fund', {
        amount: customAmountStr,
        requestId: fundingRequest.current.id,
      })

      setShowFundModal(false)
      setActiveFunding({
        attemptId: res.attemptId,
        reference: res.reference,
        amountMinor: res.amountMinor ?? Math.round(depositAmount * 100),
        amount: res.amount ?? depositAmount,
        checkoutUrl: res.checkoutUrl,
        bankTransfer: res.bankTransfer ?? null,
        status: 'awaiting_payment',
      })
      void fetchWallet(true)
    } catch (err) {
      setFundingError(err instanceof Error ? err.message : 'Unable to initiate wallet deposit. Please try again.')
    } finally {
      setFundingBusy(false)
    }
  }

  const feeAmount = (depositAmount * depositLimits.fee_percent) / 100
  const creditedAmount = Math.max(0, depositAmount - feeAmount)
  const pendingMinor = pendingDeposits.reduce((sum, deposit) => sum + deposit.amount_minor, 0)
  const dateLabel = (time: number) => new Date(time).toLocaleString('en-NG', {day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})

  // Filtered transactions
  const filteredTransactions = transactions.filter((tx) => {
    if (txFilter === 'credit' && tx.direction !== 'credit') return false
    if (txFilter === 'debit' && tx.direction !== 'debit') return false
    if (txSearch.trim()) {
      const q = txSearch.toLowerCase().trim()
      const matchRef = tx.reference.toLowerCase().includes(q)
      const matchOrder = tx.order_reference?.toLowerCase().includes(q)
      const matchType = tx.type.toLowerCase().includes(q)
      return matchRef || matchOrder || matchType
    }
    return true
  })

  return (
    <div className="customer-page-panel wallet-page-container">
      {/* Top Header */}
      <header className="wallet-page-heading">
        <div>
          <span className="dashboard-eyebrow">FINANCIAL DASHBOARD</span>
          <h1>Wallet &amp; Funds</h1>
          <p>Authoritative balance and verified transaction ledger in NGN.</p>
        </div>
        <button 
          type="button" 
          className="button button-outline button-small" 
          onClick={() => void fetchWallet(true)} 
          disabled={loading || refreshing}
        >
          <RefreshCw size={14} className={refreshing ? 'spin-icon' : ''} /> 
          <span>{refreshing ? 'Refreshing…' : 'Refresh Balance'}</span>
        </button>
      </header>

      {/* Notifications */}
      {notification && (
        <div className="wallet-notice" role="status">
          <AlertCircle size={16} />
          <span>{notification.message}</span>
          <button type="button" aria-label="Dismiss notification" onClick={() => setNotification(null)}>
            <X size={15} />
          </button>
        </div>
      )}
      {error && (
        <div className="wallet-notice wallet-error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => void fetchWallet(true)}>Retry</button>
        </div>
      )}

      {/* Top Financial Grid: Balance + Funding Methods */}
      <div className="wallet-summary-layout">
        {/* Available Balance Panel */}
        <section className="wallet-balance-panel" aria-label="Available wallet balance">
          <div className="wallet-balance-label">
            <Wallet size={18} />
            <span>Available Balance (NGN)</span>
            <span className={`wallet-account-status ${wallet?.status === 'active' ? 'active' : 'frozen'}`}>
              <CheckCircle2 size={11} className="inline-icon" /> {wallet?.status || (loading ? 'Loading' : 'Unavailable')}
            </span>
          </div>

          <strong className="account-balance">
            {loading ? '₦…' : wallet ? formatPrice(wallet.balance_minor) : 'Unavailable'}
          </strong>

          <p className="wallet-subtext">
            Authoritative funds held in Cloudflare D1. Ready for instant product purchases with zero payment delays.
          </p>

          <div className="account-actions">
            <button 
              type="button" 
              className="button button-orange button-small" 
              disabled={!funding.enabled || wallet?.status !== 'active'} 
              onClick={() => setShowFundModal(true)}
            >
              <PlusCircle size={15} />
              <span>Fund Wallet</span>
            </button>
            <Link to="/marketplace" className="button button-outline button-small">
              <span>Browse Shop</span>
              <ArrowRight size={14} />
            </Link>
          </div>
        </section>

        {/* Funding Methods Panel */}
        <section className="wallet-funding-panel" aria-label="Verified funding methods">
          <span className="account-label">
            <CreditCard size={18} /> Verified Payment Channels
          </span>

          <div className="funding-channel-item">
            <div className="channel-top">
              <div className="channel-info">
                <strong>Bachs Online Checkout</strong>
                <small>Cards (Mastercard, Visa, Verve), Bank Transfer &amp; USSD</small>
              </div>
              <span className={`channel-badge ${funding.enabled ? 'supported' : 'safeguard'}`}>
                {funding.enabled ? (funding.mode === 'live' ? 'Live' : 'Supported') : 'Sandbox / Safeguard'}
              </span>
            </div>
            <p className="channel-note">
              {funding.enabled 
                ? `Minimum: ${formatPrice(depositLimits.min_ngn * 100)} · Maximum: ${formatPrice(depositLimits.max_ngn * 100)}. Direct ledger crediting.`
                : funding.reason}
            </p>
          </div>

          <div className="funding-channel-item secondary">
            <div className="channel-top">
              <div className="channel-info">
                <strong>Dedicated Virtual Accounts</strong>
                <small>Direct Inbound Bank Transfers</small>
              </div>
              <span className="channel-badge unavailable">
                {virtualAccountStatus}
              </span>
            </div>
            <p className="channel-note">
              {virtualAccountReason || 'Virtual bank accounts require formal merchant banking partner approval. Please use online checkout.'}
            </p>
          </div>

          {pendingMinor > 0 && (
            <div className="wallet-pending-total">
              <span>Pending Deposits:</span>
              <strong>{formatPrice(pendingMinor)}</strong>
            </div>
          )}
        </section>
      </div>

      {/* Awaiting Gateway Confirmation */}
      {pendingDeposits.length > 0 && (
        <section className="wallet-pending-section">
          <h2>Awaiting Payment Confirmation ({pendingDeposits.length})</h2>
          {pendingDeposits.map((deposit) => (
            <div className="wallet-pending-row" key={deposit.id}>
              <Clock size={16} className="spin-slow" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>Deposit Ref: {deposit.reference}</strong>
                <small>{dateLabel(deposit.created_at)}</small>
              </div>
              <strong style={{ margin: '0 10px', whiteSpace: 'nowrap' }}>{formatPrice(deposit.amount_minor)}</strong>
              <div className="pending-deposit-actions">
                <span className="status-pill warning">{deposit.status}</span>
                <button
                  type="button"
                  className="button button-outline button-small"
                  onClick={() => {
                    setActiveFunding({
                      attemptId: deposit.id,
                      reference: deposit.reference,
                      amountMinor: deposit.amount_minor,
                      amount: deposit.amount,
                      bankTransfer: deposit.bankTransfer ?? null,
                      status: 'awaiting_payment',
                    })
                  }}
                  style={{ padding: '4px 8px', fontSize: 11 }}
                >
                  View Details
                </button>
                <button
                  type="button"
                  className="button button-outline button-small"
                  disabled={reconcilingId === deposit.id}
                  onClick={() => handleCheckStatus(deposit.id)}
                  style={{ padding: '4px 8px', fontSize: 11 }}
                  title="Check confirmation with Bachs"
                >
                  <RefreshCw size={12} className={reconcilingId === deposit.id ? 'spin-icon' : ''} />
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Transaction History */}
      <section className="wallet-transactions" id="transactions">
        <div className="wallet-tx-header">
          <div>
            <h2>Transaction Ledger</h2>
            <p>Credits, purchases, refunds and balance adjustments.</p>
          </div>

          {/* Filter Tabs */}
          <div className="wallet-tx-filter-tabs">
            <button 
              type="button" 
              className={`tx-filter-btn ${txFilter === 'all' ? 'active' : ''}`}
              onClick={() => setTxFilter('all')}
            >
              All ({transactions.length})
            </button>
            <button 
              type="button" 
              className={`tx-filter-btn ${txFilter === 'credit' ? 'active' : ''}`}
              onClick={() => setTxFilter('credit')}
            >
              Credits ({transactions.filter(t => t.direction === 'credit').length})
            </button>
            <button 
              type="button" 
              className={`tx-filter-btn ${txFilter === 'debit' ? 'active' : ''}`}
              onClick={() => setTxFilter('debit')}
            >
              Debits ({transactions.filter(t => t.direction === 'debit').length})
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="wallet-search-bar">
          <Search size={15} className="search-icon" />
          <input
            type="text"
            placeholder="Search by reference, order ID, or transaction type…"
            value={txSearch}
            onChange={(e) => setTxSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="wallet-empty" role="status">
            <RefreshCw size={20} className="spin-icon" />
            <p>Loading your transactions…</p>
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="wallet-empty">
            <Wallet size={28} />
            <h3>No transactions found</h3>
            <p>{txSearch ? 'Try searching with a different reference or term.' : 'Your confirmed wallet activity will appear here.'}</p>
          </div>
        ) : (
          <div className="wallet-transaction-list">
            {filteredTransactions.map((tx) => (
              <button 
                className="wallet-transaction-row" 
                type="button" 
                key={tx.id} 
                onClick={() => setSelectedTx(tx)}
              >
                <span className={`wallet-direction ${tx.direction}`}>
                  {tx.direction === 'credit' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                </span>

                <span className="wallet-transaction-description">
                  <div className="tx-type-line">
                    <strong>{tx.type.replaceAll('_', ' ')}</strong>
                    <span className={`status-pill tx-status-${tx.status}`}>{tx.status}</span>
                  </div>
                  <small>{dateLabel(tx.created_at)}</small>
                  <small className="wallet-reference">Ref: {tx.reference}</small>
                  {tx.order_reference && (
                    <small className="wallet-order-ref">Order: {tx.order_reference}</small>
                  )}
                </span>

                <span className="wallet-transaction-amount">
                  <strong className={tx.direction === 'credit' ? 'credit-amount' : 'debit-amount'}>
                    {tx.direction === 'credit' ? '+' : '−'}{formatPrice(tx.amount_minor)}
                  </strong>
                  <small className="balance-after-text">Bal: {formatPrice(tx.balance_after_minor)}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Fund Wallet Modal */}
      {showFundModal && (
        <div className="wallet-modal-backdrop" onClick={() => setShowFundModal(false)}>
          <section 
            role="dialog" 
            aria-modal="true" 
            aria-labelledby="wallet-fund-title" 
            className="wallet-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-header-row">
              <h2 id="wallet-fund-title">Fund Your Wallet</h2>
              <button 
                type="button" 
                className="wallet-icon-button" 
                aria-label="Close funding dialog" 
                onClick={() => setShowFundModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleInitiateFunding}>
              <label htmlFor="wallet-amount">Deposit Amount (NGN)</label>
              
              <div className="wallet-preset-grid">
                {PRESET_AMOUNTS.map((amount) => (
                  <button 
                    type="button" 
                    className={depositAmount === amount ? 'active' : ''} 
                    key={amount} 
                    onClick={() => handlePresetSelect(amount)}
                  >
                    {formatPrice(amount * 100)}
                  </button>
                ))}
              </div>

              <div className="wallet-amount-input-box">
                <span className="currency-prefix">₦</span>
                <input 
                  id="wallet-amount" 
                  inputMode="decimal" 
                  value={customAmountStr} 
                  onChange={(e) => handleCustomChange(e.target.value)} 
                  required 
                  autoFocus 
                />
              </div>

              <p className="wallet-caption">
                Minimum: {formatPrice(depositLimits.min_ngn * 100)} · Maximum: {formatPrice(depositLimits.max_ngn * 100)}
              </p>

              <dl className="wallet-receipt-lines">
                <div>
                  <dt>Deposit Amount</dt>
                  <dd>{formatPrice(Math.round(depositAmount * 100))}</dd>
                </div>
                <div>
                  <dt>Payment Gateway Fee</dt>
                  <dd>{formatPrice(Math.round(feeAmount * 100))}</dd>
                </div>
                <div className="receipt-total-row">
                  <dt>Wallet Balance Credit</dt>
                  <dd>{formatPrice(Math.round(creditedAmount * 100))}</dd>
                </div>
              </dl>

              {fundingError && <p role="alert" className="wallet-error">{fundingError}</p>}

              <button 
                className="button button-orange" 
                type="submit" 
                disabled={fundingBusy || !funding.enabled}
                style={{ width: '100%', marginTop: 8 }}
              >
                {fundingBusy ? 'Preparing Bachs Checkout…' : 'Proceed to Secure Payment'}
              </button>
            </form>
          </section>
        </div>
      )}

      {/* Active Temporary Bank Transfer Modal */}
      {activeFunding && (
        <div className="wallet-modal-backdrop" onClick={() => {
          if (activeFunding.status === 'paid' || activeFunding.status === 'failed') {
            setActiveFunding(null)
          }
        }}>
          <section 
            role="dialog" 
            aria-modal="true" 
            aria-labelledby="active-funding-title" 
            className="wallet-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-header-row">
              <h2 id="active-funding-title">
                {activeFunding.status === 'paid' ? 'Deposit Completed' : 'Temporary Bank Transfer'}
              </h2>
              <button 
                type="button" 
                className="wallet-icon-button" 
                aria-label="Close dialog" 
                onClick={() => {
                  setActiveFunding(null)
                  void fetchWallet(true)
                }}
              >
                <X size={18} />
              </button>
            </div>

            {activeFunding.status === 'paid' ? (
              <div className="deposit-success-view">
                <div className="success-icon-wrap">
                  <CheckCircle2 size={32} />
                </div>
                <h3>Wallet Credited Successfully!</h3>
                <p className="wallet-subtext" style={{ margin: '8px 0 16px' }}>
                  {formatPrice(activeFunding.amountMinor)} has been added to your LogsPoll wallet balance.
                </p>
                <dl className="wallet-receipt-lines" style={{ textAlign: 'left', marginBottom: 16 }}>
                  <div>
                    <dt>Deposit Reference</dt>
                    <dd>{activeFunding.reference}</dd>
                  </div>
                  <div>
                    <dt>Amount Credited</dt>
                    <dd>{formatPrice(activeFunding.amountMinor)}</dd>
                  </div>
                  <div className="receipt-total-row">
                    <dt>Current Wallet Balance</dt>
                    <dd>{wallet ? formatPrice(wallet.balance_minor) : 'Updated'}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  className="button button-orange"
                  style={{ width: '100%' }}
                  onClick={() => {
                    setActiveFunding(null)
                    void fetchWallet(true)
                  }}
                >
                  Done
                </button>
              </div>
            ) : activeFunding.status === 'failed' ? (
              <div className="deposit-success-view">
                <div className="success-icon-wrap" style={{ background: '#fee2e2', color: '#dc2626' }}>
                  <AlertCircle size={32} />
                </div>
                <h3>Deposit Window Closed</h3>
                <p className="wallet-subtext" style={{ margin: '8px 0 16px' }}>
                  This payment session was cancelled or expired. Any uncompleted transfer will not debit your account or can be re-initiated anytime.
                </p>
                <button
                  type="button"
                  className="button button-outline"
                  style={{ width: '100%' }}
                  onClick={() => setActiveFunding(null)}
                >
                  Close
                </button>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span className="transfer-status-badge awaiting">
                    <span className="pulse-amber" />
                    <span>Awaiting Payment</span>
                  </span>
                  <small style={{ color: 'var(--dash-text-muted)', fontSize: 11 }}>
                    Ref: {activeFunding.reference}
                  </small>
                </div>

                {activeFunding.bankTransfer ? (
                  <div className="bank-transfer-card">
                    <div className="bank-transfer-row">
                      <span className="label">Bank Name</span>
                      <span className="value">
                        {activeFunding.bankTransfer.bank_name || activeFunding.bankTransfer.bankName || 'Bachs Settlement Bank'}
                      </span>
                    </div>

                    <div className="bank-transfer-row">
                      <span className="label">Account Number</span>
                      <div className="value-group">
                        <span className="value monospace">
                          {activeFunding.bankTransfer.account_number || activeFunding.bankTransfer.accountNumber}
                        </span>
                        <button
                          type="button"
                          className="copy-mini-btn"
                          aria-label="Copy Account Number"
                          onClick={() => copyToClipboard(
                            activeFunding.bankTransfer!.account_number || activeFunding.bankTransfer!.accountNumber || '',
                            'acc_num'
                          )}
                        >
                          {copiedRef === 'acc_num' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                          <span>{copiedRef === 'acc_num' ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                    </div>

                    <div className="bank-transfer-row">
                      <span className="label">Account Name</span>
                      <div className="value-group">
                        <span className="value">
                          {activeFunding.bankTransfer.account_name || activeFunding.bankTransfer.accountName || 'LogsPoll Checkout'}
                        </span>
                        <button
                          type="button"
                          className="copy-mini-btn"
                          aria-label="Copy Account Name"
                          onClick={() => copyToClipboard(
                            activeFunding.bankTransfer!.account_name || activeFunding.bankTransfer!.accountName || '',
                            'acc_name'
                          )}
                        >
                          {copiedRef === 'acc_name' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </div>

                    <div className="bank-transfer-row">
                      <span className="label">Amount to Transfer</span>
                      <div className="value-group">
                        <span className="value" style={{ color: '#16a34a' }}>
                          {formatPrice(activeFunding.amountMinor)}
                        </span>
                        <button
                          type="button"
                          className="copy-mini-btn"
                          aria-label="Copy Amount"
                          onClick={() => copyToClipboard(String(activeFunding.amountMinor / 100), 'amt')}
                        >
                          {copiedRef === 'amt' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </div>

                    <div className="bank-transfer-row">
                      <span className="label">Payment Reference</span>
                      <div className="value-group">
                        <span className="value monospace" style={{ fontSize: 11 }}>
                          {activeFunding.reference}
                        </span>
                        <button
                          type="button"
                          className="copy-mini-btn"
                          aria-label="Copy Reference"
                          onClick={() => copyToClipboard(activeFunding.reference, 'ref')}
                        >
                          {copiedRef === 'ref' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bank-transfer-card" style={{ textAlign: 'center', padding: '20px 14px' }}>
                    <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--dash-text-dark)' }}>
                      Payment session initialized for <strong>{formatPrice(activeFunding.amountMinor)}</strong>.
                    </p>
                    {activeFunding.checkoutUrl && (
                      <a 
                        href={activeFunding.checkoutUrl} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="button button-orange button-small"
                        style={{ display: 'inline-flex', gap: 6, margin: '4px 0' }}
                      >
                        <span>Open Bachs Secure Checkout</span>
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                )}

                <div className="transfer-instructions-note">
                  <strong>Important:</strong> Send the exact amount ({formatPrice(activeFunding.amountMinor)}) using the temporary bank details above. This account is single-use for this deposit and will be cleared automatically once payment is verified.
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
                  <button
                    type="button"
                    className="button button-orange"
                    disabled={reconcilingId === activeFunding.attemptId}
                    onClick={() => handleCheckStatus(activeFunding.attemptId)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  >
                    <RefreshCw size={14} className={reconcilingId === activeFunding.attemptId ? 'spin-icon' : ''} />
                    <span>{reconcilingId === activeFunding.attemptId ? 'Verifying with Bachs…' : 'I Have Sent The Funds / Check Status'}</span>
                  </button>

                  {activeFunding.checkoutUrl && activeFunding.bankTransfer && (
                    <a
                      href={activeFunding.checkoutUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="button button-outline button-small"
                      style={{ textAlign: 'center', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <span>Pay with Card via Bachs Checkout</span>
                      <ExternalLink size={13} />
                    </a>
                  )}

                  <button
                    type="button"
                    className="button button-outline button-small"
                    onClick={() => {
                      setActiveFunding(null)
                      void fetchWallet(true)
                    }}
                    style={{ justifyContent: 'center' }}
                  >
                    Close (Keeps Awaiting in Background)
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Transaction Details Modal */}
      {selectedTx && (
        <div className="wallet-modal-backdrop" onClick={() => setSelectedTx(null)}>
          <section 
            className="wallet-modal" 
            role="dialog" 
            aria-modal="true" 
            aria-labelledby="wallet-receipt-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-header-row">
              <h2 id="wallet-receipt-title">Transaction Receipt</h2>
              <button 
                className="wallet-icon-button" 
                type="button" 
                aria-label="Close transaction details" 
                onClick={() => setSelectedTx(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="receipt-status-banner">
              <span className="account-label">
                {selectedTx.status === 'completed' ? <CheckCircle2 size={16} /> : <Clock size={16} />}
                <span className="capitalize">{selectedTx.status}</span>
              </span>
              <strong className={`receipt-amount ${selectedTx.direction === 'credit' ? 'credit' : 'debit'}`}>
                {selectedTx.direction === 'credit' ? '+' : '−'}{formatPrice(selectedTx.amount_minor)}
              </strong>
            </div>

            <dl className="wallet-receipt-lines">
              <div>
                <dt>Transaction Type</dt>
                <dd className="capitalize">{selectedTx.type.replaceAll('_', ' ')}</dd>
              </div>
              <div>
                <dt>Date &amp; Time</dt>
                <dd>{dateLabel(selectedTx.created_at)}</dd>
              </div>
              <div>
                <dt>Balance After Transaction</dt>
                <dd>{formatPrice(selectedTx.balance_after_minor)}</dd>
              </div>
              {selectedTx.order_reference && (
                <div>
                  <dt>Associated Order</dt>
                  <dd>
                    <Link to="/dashboard/orders" className="text-link">
                      {selectedTx.order_reference}
                    </Link>
                  </dd>
                </div>
              )}
            </dl>

            <div className="wallet-receipt-reference">
              <span>Ref: {selectedTx.reference}</span>
              <button 
                type="button" 
                className="wallet-icon-button" 
                aria-label="Copy transaction reference" 
                onClick={() => copyToClipboard(selectedTx.reference, selectedTx.id)}
              >
                {copiedRef === selectedTx.id ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
              </button>
            </div>

            {selectedTx.reason && (
              <p className="receipt-reason-text">Note: {selectedTx.reason}</p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
