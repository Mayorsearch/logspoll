import { useState, useEffect, useRef, useCallback } from 'react'
import { X, ArrowRight, ShieldCheck, Copy, Check, Clock, RefreshCw, AlertCircle, ExternalLink, Lock, CheckCircle2 } from 'lucide-react'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import { useDashboard } from '../pages/DashboardContext'

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

export interface ActiveFundingSession {
  attemptId: string
  reference: string
  amountMinor: number
  amount: number
  feeMinor?: number
  creditedMinor?: number
  checkoutUrl?: string
  bankTransfer?: BankTransferDetails | null
  status: 'awaiting_payment' | 'checking' | 'paid' | 'failed'
}

interface FundWalletSheetProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
  initialAmount?: number
}

const PRESET_AMOUNTS = [5000, 10000, 20000, 50000]

export function FundWalletSheet({ isOpen, onClose, onSuccess, initialAmount = 10000 }: FundWalletSheetProps) {
  const { refreshWallet, showToast } = useDashboard()
  const [amountRaw, setAmountRaw] = useState(() => initialAmount.toLocaleString('en-NG'))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [activeSession, setActiveSession] = useState<ActiveFundingSession | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  // Close overlay on Escape
  useEffect(() => {
    if (!isOpen) {
      stopPolling()
      return
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
      stopPolling()
    }
  }, [isOpen, onClose, stopPolling])

  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
      showToast('Copied to clipboard')
    } catch {
      // Fallback
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    }
  }

  // Reconcile status
  const checkStatus = useCallback(async (attemptId: string) => {
    try {
      setReconciling(true)
      const res = await cloudflareRequest<{
        reconciled?: boolean
        paid?: boolean
        status?: string
        wallet?: { balance_minor: number }
      }>(`/api/wallet/reconcile?attempt_id=${encodeURIComponent(attemptId)}`)

      if (res.paid || res.status === 'paid') {
        stopPolling()
        setActiveSession((prev) => (prev ? { ...prev, status: 'paid' } : null))
        await refreshWallet()
        onSuccess?.()
      } else if (res.status === 'failed' || res.status === 'expired') {
        stopPolling()
        setActiveSession((prev) => (prev ? { ...prev, status: 'failed' } : null))
      }
    } catch {
      // transient network error, keep polling
    } finally {
      setReconciling(false)
    }
  }, [onSuccess, refreshWallet, stopPolling])

  // Start polling when activeSession is awaiting payment
  useEffect(() => {
    if (!activeSession || activeSession.status !== 'awaiting_payment') {
      stopPolling()
      return
    }
    stopPolling()
    pollingRef.current = setInterval(() => {
      void checkStatus(activeSession.attemptId)
    }, 4000)

    return () => stopPolling()
  }, [activeSession, checkStatus, stopPolling])

  if (!isOpen) return null

  const handleAmountChange = (val: string) => {
    const raw = val.replace(/\D/g, '').slice(0, 10)
    setAmountRaw(raw ? Number(raw).toLocaleString('en-NG') : '')
    setError('')
  }

  const handlePresetClick = (amt: number) => {
    setAmountRaw(amt.toLocaleString('en-NG'))
    setError('')
  }

  const handleInitiate = async () => {
    const numericAmount = Number(amountRaw.replace(/,/g, ''))
    if (!Number.isFinite(numericAmount) || numericAmount < 100) {
      setError('Minimum deposit is ₦100.00.')
      return
    }
    if (numericAmount > 1000000) {
      setError('Maximum single deposit is ₦1,000,000.00.')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const res = await cloudflareRequest<{
        success?: boolean
        ok?: boolean
        error?: string
        attemptId?: string
        reference?: string
        amount_minor?: number
        amountMinor?: number
        amount?: number
        fee_minor?: number
        feeMinor?: number
        credited_minor?: number
        creditedMinor?: number
        status?: string
        checkout_url?: string
        checkoutUrl?: string
        bank_transfer?: BankTransferDetails | null
        bankTransfer?: BankTransferDetails | null
        attempt?: {
          id: string
          reference: string
          amount_minor: number
          amount: number
          fee_minor?: number
          credited_minor?: number
          status: string
          checkout_url?: string
          bank_transfer?: BankTransferDetails | null
        }
      }>('/api/wallet/fund', {
        amount: numericAmount,
        channel: 'bank_transfer',
        request_id: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
      })

      const isSuccess = Boolean(res.ok || res.success)
      const attemptId = res.attempt?.id || res.attemptId
      const reference = String(res.attempt?.reference || res.reference || attemptId || '')
      const checkoutUrl = res.attempt?.checkout_url || res.checkout_url || res.checkoutUrl
      const bankTransfer = res.attempt?.bank_transfer || res.bank_transfer || res.bankTransfer || null
      const amountMinor = res.attempt?.amount_minor ?? res.amount_minor ?? res.amountMinor ?? Math.round(numericAmount * 100)
      const amount = res.attempt?.amount ?? res.amount ?? numericAmount
      const feeMinor = res.attempt?.fee_minor ?? res.fee_minor ?? res.feeMinor ?? 0
      const creditedMinor = res.attempt?.credited_minor ?? res.credited_minor ?? res.creditedMinor ?? amountMinor

      if (!isSuccess || !attemptId) {
        throw new Error(res.error || 'Failed to initiate deposit.')
      }

      setActiveSession({
        attemptId,
        reference,
        amountMinor,
        amount,
        feeMinor,
        creditedMinor,
        checkoutUrl,
        bankTransfer,
        status: 'awaiting_payment',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create payment session. Please retry.')
    } finally {
      setSubmitting(false)
    }
  }

  const formatPrice = (minor: number) =>
    new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(minor / 100)

  const bank = activeSession?.bankTransfer
  const bankName = bank?.bankName || bank?.bank_name
  const accNum = bank?.accountNumber || bank?.account_number
  const accName = bank?.accountName || bank?.account_name
  const hasBankDetails = Boolean(bankName && accNum)

  return (
    <div
      className="fintech-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="fintech-sheet" role="dialog" aria-modal="true" aria-labelledby="fund-sheet-title">
        <div className="fintech-handle" />

        <div className="fintech-sheet-title">
          <h2 id="fund-sheet-title">
            {activeSession?.status === 'paid'
              ? 'Wallet Funded Successfully!'
              : activeSession
              ? 'Complete Your Transfer'
              : 'Fund your wallet'}
          </h2>
          <button className="close" onClick={onClose} aria-label="Close funding sheet">
            <X size={18} />
          </button>
        </div>

        {/* STAGE 1: AMOUNT SELECTION */}
        {!activeSession && (
          <div>
            <p className="fintech-sheet-subtitle">
              Choose the amount you'd like to add to your personal NGN wallet balance.
            </p>

            <label htmlFor="fund-amount-input" className="fintech-input-label">
              Amount (NGN)
            </label>
            <div className="fintech-amount-box">
              <span>₦</span>
              <input
                id="fund-amount-input"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                type="text"
                value={amountRaw}
                onChange={(e) => handleAmountChange(e.target.value)}
                placeholder="10,000"
              />
            </div>

            <div className="fintech-quick-amounts">
              {PRESET_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => handlePresetClick(amt)}
                  className={amountRaw === amt.toLocaleString('en-NG') ? 'active' : ''}
                >
                  ₦{amt.toLocaleString('en-NG')}
                </button>
              ))}
            </div>

            {error && (
              <div
                className="fintech-notice fintech-notice-error"
                role="alert"
                style={{
                  borderColor: 'rgba(239, 68, 68, 0.4)',
                  background: 'rgba(239, 68, 68, 0.08)',
                  color: '#dc2626',
                  padding: '12px 14px',
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  marginTop: 10,
                }}
              >
                <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.45 }}>
                  <strong style={{ display: 'block', marginBottom: 2 }}>Unable to Initiate Deposit</strong>
                  <span>{error}</span>
                </div>
              </div>
            )}

            <div className="fintech-notice">
              <ShieldCheck size={16} />
              <span>
                A secure temporary bank account will be generated by Bachs for this deposit. Funds are credited instantly upon payment verification.
              </span>
            </div>

            <button
              type="button"
              className="fintech-btn fintech-btn-orange fintech-full"
              disabled={submitting || !amountRaw}
              onClick={handleInitiate}
            >
              {submitting ? (
                <>
                  <RefreshCw size={16} className="spin-icon" />
                  <span>Requesting Payment Details…</span>
                </>
              ) : (
                <>
                  <span>Continue to Payment</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
        )}

        {/* STAGE 2: AWAITING PAYMENT (TEMPORARY BANK DETAILS) */}
        {activeSession && activeSession.status === 'awaiting_payment' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span className="fintech-small-pill pending" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 11 }}>
                <Clock size={13} className="spin-slow" /> Awaiting Payment
              </span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                Ref: {activeSession.reference}
              </span>
            </div>

            {hasBankDetails ? (
              <div className="fintech-bank-box">
                <div className="fintech-bank-row" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
                  <span className="fintech-bank-label">Bank Name</span>
                  <strong className="fintech-bank-val">{bankName}</strong>
                </div>

                <div className="fintech-bank-row" style={{ borderBottom: '1px solid var(--line)', padding: '12px 0' }}>
                  <span className="fintech-bank-label">Account Number</span>
                  <div className="fintech-bank-val">
                    <span className="fintech-mono-num">{accNum}</span>
                    <button
                      type="button"
                      className="fintech-copy-btn"
                      onClick={() => copyToClipboard(accNum || '', 'accountNumber')}
                      title="Copy account number"
                    >
                      {copiedKey === 'accountNumber' ? <Check size={13} color="var(--positive)" /> : <Copy size={13} />}
                      <span>{copiedKey === 'accountNumber' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>

                {accName && (
                  <div className="fintech-bank-row" style={{ borderBottom: '1px solid var(--line)', padding: '10px 0' }}>
                    <span className="fintech-bank-label">Account Name</span>
                    <strong className="fintech-bank-val" style={{ fontSize: 12 }}>{accName}</strong>
                  </div>
                )}

                <div className="fintech-bank-row" style={{ paddingTop: 10 }}>
                  <span className="fintech-bank-label">Exact Amount</span>
                  <div className="fintech-bank-val">
                    <strong style={{ fontSize: 15, color: 'var(--ink)' }}>{formatPrice(activeSession.amountMinor)}</strong>
                    <button
                      type="button"
                      className="fintech-copy-btn"
                      onClick={() => copyToClipboard((activeSession.amountMinor / 100).toFixed(2), 'amount')}
                      title="Copy amount"
                    >
                      {copiedKey === 'amount' ? <Check size={13} color="var(--positive)" /> : <Copy size={13} />}
                      <span>{copiedKey === 'amount' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : activeSession.checkoutUrl ? (
              <div className="fintech-bank-box" style={{ textAlign: 'center', padding: '24px 16px' }}>
                <Lock size={32} style={{ color: 'var(--orange)', margin: '0 auto 12px' }} />
                <h3 style={{ fontSize: 14, margin: '0 0 6px', fontWeight: 780 }}>Bachs Hosted Checkout</h3>
                <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '0 0 16px', lineHeight: 1.5 }}>
                  Dynamic transfer accounts are unavailable for this channel. Complete your deposit securely on Bachs Checkout.
                </p>
                <a
                  href={activeSession.checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="fintech-btn fintech-btn-orange"
                  style={{ width: '100%', gap: 8 }}
                >
                  <span>Open Bachs Checkout</span>
                  <ExternalLink size={16} />
                </a>
              </div>
            ) : null}

            <div className="fintech-notice">
              <Lock size={16} />
              <span>
                <strong>Single-use account:</strong> Do not save these bank details. This account is uniquely allocated to this deposit and will expire upon payment.
              </span>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              <button
                type="button"
                className="fintech-btn fintech-btn-orange fintech-full"
                disabled={reconciling}
                onClick={() => checkStatus(activeSession.attemptId)}
              >
                {reconciling ? (
                  <>
                    <RefreshCw size={16} className="spin-icon" />
                    <span>Checking Payment Status…</span>
                  </>
                ) : (
                  <>
                    <RefreshCw size={16} />
                    <span>I Have Sent The Funds / Check Status</span>
                  </>
                )}
              </button>

              <button
                type="button"
                className="fintech-btn fintech-btn-outline fintech-full"
                onClick={() => {
                  stopPolling()
                  setActiveSession(null)
                }}
              >
                Cancel / Change Amount
              </button>
            </div>
          </div>
        )}

        {/* STAGE 3: PAYMENT CONFIRMED / CREDITED */}
        {activeSession && activeSession.status === 'paid' && (
          <div>
            <div className="fintech-detail-top">
              <div className="fintech-tx-symbol credit">
                <CheckCircle2 size={28} />
              </div>
              <div className="fintech-detail-amount" style={{ color: 'var(--positive)' }}>
                +{formatPrice(activeSession.creditedMinor ?? activeSession.amountMinor)}
              </div>
              <span className="fintech-small-pill">Payment Confirmed · Credited</span>
            </div>

            <div style={{ margin: '14px 0' }}>
              <div className="fintech-field-line">
                <span>Deposit Reference</span>
                <strong>{activeSession.reference}</strong>
              </div>
              <div className="fintech-field-line">
                <span>Deposit Amount</span>
                <strong>{formatPrice(activeSession.amountMinor)}</strong>
              </div>
              <div className="fintech-field-line">
                <span>Gateway Fee</span>
                <strong>₦0.00</strong>
              </div>
              <div className="fintech-field-line">
                <span>Net Credited</span>
                <strong style={{ color: 'var(--positive)' }}>
                  {formatPrice(activeSession.creditedMinor ?? activeSession.amountMinor)}
                </strong>
              </div>
            </div>

            <button
              type="button"
              className="fintech-btn fintech-btn-orange fintech-full"
              onClick={() => {
                onClose()
                setActiveSession(null)
              }}
            >
              Done
            </button>
          </div>
        )}

        {/* STAGE 4: EXPIRED / FAILED */}
        {activeSession && activeSession.status === 'failed' && (
          <div>
            <div className="fintech-detail-top">
              <div className="fintech-tx-symbol" style={{ background: '#fee2e2', color: '#dc2626' }}>
                <AlertCircle size={28} />
              </div>
              <div className="fintech-detail-amount" style={{ color: '#dc2626' }}>
                Session Expired
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '6px 0 0' }}>
                This funding session has timed out. Any funds already transferred will be reconciled and credited automatically.
              </p>
            </div>

            <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
              <button
                type="button"
                className="fintech-btn fintech-btn-orange fintech-full"
                onClick={() => checkStatus(activeSession.attemptId)}
              >
                <RefreshCw size={16} />
                <span>Verify Again</span>
              </button>
              <button
                type="button"
                className="fintech-btn fintech-btn-outline fintech-full"
                onClick={() => setActiveSession(null)}
              >
                Start New Deposit
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

