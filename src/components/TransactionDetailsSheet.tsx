import { useEffect } from 'react'
import { X, ArrowDown, ArrowUp, Link as LinkIcon, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

export interface WalletTransactionItem {
  id: string
  reference: string
  type: string
  direction: 'credit' | 'debit'
  amount_minor: number
  amount?: number
  balance_before_minor?: number
  balance_after_minor?: number
  status: string
  order_id?: string | null
  order_reference?: string | null
  reason?: string | null
  created_at: number | string
}

interface TransactionDetailsSheetProps {
  transaction: WalletTransactionItem | null
  onClose: () => void
}

export function TransactionDetailsSheet({ transaction, onClose }: TransactionDetailsSheetProps) {
  useEffect(() => {
    if (!transaction) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [transaction, onClose])

  if (!transaction) return null

  const isCredit = transaction.direction === 'credit'
  const formatPrice = (minor: number) =>
    new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(minor / 100)

  const dateObj = new Date(transaction.created_at)
  const formattedDate = !isNaN(dateObj.getTime())
    ? `${dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} at ${dateObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
    : String(transaction.created_at)

  const title =
    transaction.reason ||
    (isCredit
      ? 'Wallet funding'
      : transaction.order_reference
      ? `Order #${transaction.order_reference}`
      : 'Digital purchase')

  return (
    <div
      className="fintech-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="fintech-sheet" role="dialog" aria-modal="true" aria-labelledby="tx-detail-title">
        <div className="fintech-handle" />

        <div className="fintech-sheet-title">
          <h2 id="tx-detail-title">Transaction details</h2>
          <button className="close" onClick={onClose} aria-label="Close details">
            <X size={18} />
          </button>
        </div>

        <div className="fintech-detail-top">
          <div className={`fintech-tx-symbol ${isCredit ? 'credit' : ''}`}>
            {isCredit ? <ArrowDown size={24} /> : <ArrowUp size={24} />}
          </div>
          <div className="fintech-detail-amount" style={{ color: isCredit ? 'var(--positive)' : 'var(--ink)' }}>
            {isCredit ? '+' : '−'}
            {formatPrice(transaction.amount_minor)}
          </div>
          <span className={`fintech-small-pill ${transaction.status === 'pending' ? 'pending' : ''}`}>
            {transaction.status === 'completed' || transaction.status === 'paid'
              ? 'Confirmed · Verified'
              : transaction.status}
          </span>
          <p style={{ margin: '8px 0 0', fontWeight: 650, fontSize: 13, color: 'var(--ink)' }}>{title}</p>
        </div>

        <div style={{ margin: '12px 0 16px' }}>
          <div className="fintech-field-line">
            <span>Reference</span>
            <strong style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
              {transaction.reference}
            </strong>
          </div>

          <div className="fintech-field-line">
            <span>Date &amp; Time</span>
            <strong>{formattedDate}</strong>
          </div>

          <div className="fintech-field-line">
            <span>Transaction Type</span>
            <strong style={{ textTransform: 'capitalize' }}>
              {transaction.type.replace(/_/g, ' ')}
            </strong>
          </div>

          <div className="fintech-field-line">
            <span>Flow</span>
            <strong>{isCredit ? 'Money In (Credit)' : 'Purchase (Debit)'}</strong>
          </div>

          {transaction.balance_after_minor !== undefined && transaction.balance_after_minor !== null && (
            <div className="fintech-field-line">
              <span>Balance After</span>
              <strong>{formatPrice(transaction.balance_after_minor)}</strong>
            </div>
          )}

          {transaction.order_reference && (
            <div className="fintech-field-line">
              <span>Linked Order</span>
              <Link
                to={`/dashboard/orders?search=${encodeURIComponent(transaction.order_reference)}`}
                onClick={onClose}
                style={{ color: 'var(--orange)', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700 }}
              >
                <span>#{transaction.order_reference}</span>
                <LinkIcon size={12} />
              </Link>
            </div>
          )}
        </div>

        <div className="fintech-notice" style={{ margin: '0 0 16px' }}>
          <ShieldCheck size={16} />
          <span>This record is permanently signed in your Cloudflare D1 customer ledger.</span>
        </div>

        <button type="button" className="fintech-btn fintech-btn-outline fintech-full" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

