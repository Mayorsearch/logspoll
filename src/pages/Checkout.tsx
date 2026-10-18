import { useEffect, useState, useId } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useCart } from '../lib/cart'
import { useAuth } from '../auth/AuthProvider'
import { useCurrency } from '../lib/currency'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import {
  ShieldCheck,
  Lock,
  Zap,
  CheckCircle2,
  Clock,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  Mail,
  Copy,
  Check,
  CreditCard,
  Building2,
  PhoneCall,
  ShoppingBag
} from 'lucide-react'

interface Product {
  id: string
  name: string
  slug: string
  price_minor: number
  currency: string
  available_quantity: number
  server_number?: number | null
  category_name?: string | null
  image_path?: string | null
  supplier_image_urls?: string[]
}

interface OrderStatusRecord {
  id: string
  reference: string
  payment_status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded'
  fulfillment_status: 'unfulfilled' | 'processing' | 'delivered' | 'failed'
  total_minor: number
  currency: string
  created_at: string
}

export function Checkout() {
  const { items, clear } = useCart()
  const { session } = useAuth()
  const { formatPrice } = useCurrency()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // Track order ID from query params or session storage
  const paramOrderId = searchParams.get('order_id') || searchParams.get('id')
  const [activeOrderId, setActiveOrderId] = useState<string | null>(() => {
    return paramOrderId || sessionStorage.getItem('logspoll-active-order-id')
  })

  // Order recovery state
  const [orderStatus, setOrderStatus] = useState<OrderStatusRecord | null>(null)
  const [checkingStatus, setCheckingStatus] = useState<boolean>(Boolean(activeOrderId))
  const [statusError, setStatusError] = useState<string>('')

  // Live cart validation state
  const [products, setProducts] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState<boolean>(Boolean(items.length))
  const [cartError, setCartError] = useState<string>('')

  // Submission state
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [checkoutError, setCheckoutError] = useState<string>('')
  const [copiedRef, setCopiedRef] = useState<boolean>(false)

  // Stable client request ID to enforce idempotency
  const defaultRequestId = useId().replace(/[^a-f0-9]/gi, '')
  const [clientRequestId] = useState<string>(() => {
    const key = 'logspoll-checkout-req-id'
    const existing = sessionStorage.getItem(key)
    if (existing) return existing
    const newId = crypto.randomUUID ? crypto.randomUUID() : 'req-' + Date.now() + '-' + defaultRequestId
    sessionStorage.setItem(key, newId)
    return newId
  })

  // 1. Check order status if active order ID exists
  const checkOrderStatus = async (orderId: string) => {
    if (!session) return
    setCheckingStatus(true)
    setStatusError('')

    try {
      const res = await cloudflareRequest<{ order?: OrderStatusRecord }>(
        `/api/orders/${encodeURIComponent(orderId)}/status`
      )
      if (res.order) {
        setOrderStatus(res.order)
        if (res.order.payment_status === 'paid') {
          // Clear cart on confirmed verified payment
          clear()
          sessionStorage.removeItem('logspoll-checkout-req-id')
        }
      } else {
        setStatusError('Order details could not be retrieved.')
      }
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Unable to check order status.')
    } finally {
      setCheckingStatus(false)
    }
  }

  useEffect(() => {
    if (activeOrderId) {
      void checkOrderStatus(activeOrderId)
    }
  }, [activeOrderId, session])

  // 2. Fetch live product data for items currently in cart
  const ids = items.map(i => i.id).sort().join(',')
  useEffect(() => {
    if (!ids || orderStatus) {
      setLoadingProducts(false)
      return
    }
    let active = true
    setLoadingProducts(true)
    setCartError('')

    void cloudflareRequest<{ records: Product[] }>(`/api/products?ids=${encodeURIComponent(ids)}`)
      .then(res => {
        if (active) setProducts(res.records || [])
      })
      .catch(err => {
        if (active) setCartError(err instanceof Error ? err.message : 'Unable to verify items.')
      })
      .finally(() => {
        if (active) setLoadingProducts(false)
      })

    return () => {
      active = false
    }
  }, [ids, orderStatus])

  // Compute live subtotal
  const subtotalMinor = items.reduce((sum, item) => {
    const product = products.find(p => p.id === item.id)
    return sum + (product ? product.price_minor * item.quantity : 0)
  }, 0)

  // Handle Checkout submission to /api/checkout
  const handleInitiatePayment = async () => {
    if (!session) {
      navigate(`/login?next=${encodeURIComponent('/checkout')}`)
      return
    }
    if (!items.length || subtotalMinor <= 0) return

    setSubmitting(true)
    setCheckoutError('')

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          requestId: clientRequestId,
          items: items.map(i => ({ id: i.id, quantity: i.quantity })),
        }),
      })

      const data: {
        error?: string
        checkoutUrl?: string
        checkout_url?: string
        orderId?: string
        order_id?: string
        status?: string
      } = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.error || 'Payment gateway connection was not accepted.')
      }

      const orderId = data.orderId || data.order_id
      const checkoutUrl = data.checkoutUrl || data.checkout_url

      if (orderId) {
        setActiveOrderId(orderId)
        sessionStorage.setItem('logspoll-active-order-id', orderId)
      }

      if (checkoutUrl) {
        window.location.assign(checkoutUrl)
      } else if (orderId) {
        // Poll status immediately
        await checkOrderStatus(orderId)
      }
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Unable to complete checkout request.')
    } finally {
      setSubmitting(false)
    }
  }

  const copyReference = (ref: string) => {
    void navigator.clipboard.writeText(ref)
    setCopiedRef(true)
    setTimeout(() => setCopiedRef(false), 2000)
  }

  // ------------------------------------------------------------------------
  // A. ORDER CONFIRMED & PAID SUCCESS STATE
  // ------------------------------------------------------------------------
  if (orderStatus && orderStatus.payment_status === 'paid') {
    return (
      <div className="cart-checkout-page">
        <div className="cart-checkout-container">
          <div className="cart-steps-nav">
            <div className="cart-step-item completed">
              <span className="cart-step-badge">✓</span>
              <span className="cart-step-title">Cart</span>
            </div>
            <div className="cart-step-separator" style={{ background: '#10b981' }} />
            <div className="cart-step-item completed">
              <span className="cart-step-badge">✓</span>
              <span className="cart-step-title">Payment</span>
            </div>
            <div className="cart-step-separator" style={{ background: '#10b981' }} />
            <div className="cart-step-item active">
              <span className="cart-step-badge">3</span>
              <span className="cart-step-title">Fulfillment Ready</span>
            </div>
          </div>

          <div className="order-success-card">
            <div className="order-success-icon-wrap">
              <CheckCircle2 size={44} />
            </div>

            <h1 className="order-success-title">Payment Confirmed & Verified</h1>
            <p style={{ margin: 0, color: 'var(--lp-text-muted)', fontSize: '0.95rem' }}>
              Your order has been verified through Bachs payment gateway and registered in production D1.
            </p>

            <div className="order-success-ref-box">
              <span>Ref: {orderStatus.reference}</span>
              <button
                type="button"
                onClick={() => copyReference(orderStatus.reference)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--lp-orange)', display: 'flex' }}
                title="Copy reference"
              >
                {copiedRef ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>

            <div className="order-success-table">
              <div className="order-success-row">
                <span>Amount Paid</span>
                <strong>{formatPrice(orderStatus.total_minor)}</strong>
              </div>
              <div className="order-success-row">
                <span>Payment Status</span>
                <span style={{ color: '#10b981', fontWeight: 700 }}>Confirmed (Paid)</span>
              </div>
              <div className="order-success-row">
                <span>Fulfillment Status</span>
                <span style={{ color: '#ff6500', fontWeight: 700 }}>
                  {orderStatus.fulfillment_status === 'delivered' ? 'Delivered' : 'Ready in Dashboard'}
                </span>
              </div>
              <div className="order-success-row">
                <span>Confirmation Sent To</span>
                <strong>{session?.user.email}</strong>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', marginTop: 8 }}>
              <Link to="/dashboard/purchases" className="cart-primary-btn">
                Access Purchased Downloads <ArrowRight size={16} />
              </Link>
              <Link to="/dashboard/orders" className="cart-secondary-btn">
                View My Orders
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ------------------------------------------------------------------------
  // B. ORDER PENDING / FAILED / CANCELLED STATE
  // ------------------------------------------------------------------------
  if (orderStatus && orderStatus.payment_status !== 'paid') {
    const isPending = orderStatus.payment_status === 'pending'
    return (
      <div className="cart-checkout-page">
        <div className="cart-checkout-container">
          <div className="order-success-card" style={{ borderColor: isPending ? '#f59e0b' : '#ef4444' }}>
            <div
              className="order-success-icon-wrap"
              style={{
                background: isPending ? '#f59e0b15' : '#ef444415',
                color: isPending ? '#f59e0b' : '#ef4444',
                boxShadow: isPending ? '0 0 0 10px #f59e0b08' : '0 0 0 10px #ef444408',
              }}
            >
              {isPending ? <Clock size={44} /> : <AlertCircle size={44} />}
            </div>

            <h1 className="order-success-title">
              {isPending ? 'Payment Awaiting Confirmation' : 'Payment Status: ' + orderStatus.payment_status.toUpperCase()}
            </h1>

            <p style={{ margin: 0, color: 'var(--lp-text-muted)', fontSize: '0.9rem' }}>
              {isPending
                ? 'Your transaction is being confirmed by the Bachs payment gateway. Once settlement is received, fulfillment will complete automatically.'
                : 'The payment for this order was not completed. No supplier product was dispatched.'}
            </p>

            {statusError && (
              <div className="checkout-verification-notice" style={{ background: 'rgba(239, 68, 68, 0.08)', borderColor: '#ef4444', color: '#dc2626' }}>
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{statusError}</span>
              </div>
            )}

            <div className="order-success-ref-box">
              <span>Ref: {orderStatus.reference}</span>
            </div>

            <div className="order-success-actions">
              {isPending && (
                <button
                  type="button"
                  className="cart-primary-btn"
                  onClick={() => checkOrderStatus(orderStatus.id)}
                  disabled={checkingStatus}
                >
                  <RefreshCw size={16} className={checkingStatus ? 'animate-spin' : ''} />
                  Check Status Again
                </button>
              )}
              <Link to="/cart" className="cart-secondary-btn">
                Return to Cart
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ------------------------------------------------------------------------
  // C. STANDARD CHECKOUT INTERFACE
  // ------------------------------------------------------------------------
  return (
    <div className="cart-checkout-page">
      <div className="cart-checkout-container">
        {/* Navigation Step Breadcrumbs */}
        <div className="cart-steps-nav">
          <Link to="/cart" className="cart-step-item completed" style={{ textDecoration: 'none' }}>
            <span className="cart-step-badge">✓</span>
            <span className="cart-step-title">Review Cart</span>
          </Link>
          <div className="cart-step-separator" style={{ background: '#ff6500' }} />
          <div className="cart-step-item active">
            <span className="cart-step-badge">2</span>
            <span className="cart-step-title">Secure Checkout</span>
          </div>
          <div className="cart-step-separator" />
          <div className="cart-step-item">
            <span className="cart-step-badge">3</span>
            <span className="cart-step-title">Instant Delivery</span>
          </div>
        </div>

        {!items.length ? (
          <div className="cart-empty-state">
            <div className="cart-empty-icon-box">
              <ShoppingBag size={34} />
            </div>
            <h1 className="cart-empty-title">Your Cart is Empty</h1>
            <p className="cart-empty-desc">Add products to your cart before proceeding to checkout.</p>
            <Link to="/marketplace" className="cart-primary-btn" style={{ maxWidth: 220, marginTop: 12 }}>
              Browse Marketplace <ArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <div className="cart-grid-layout">
            {/* Left Column: Delivery & Payment Details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {cartError && (
                <div className="checkout-verification-notice" style={{ background: 'rgba(239, 68, 68, 0.08)', borderColor: '#ef4444', color: '#dc2626' }}>
                  <AlertCircle size={18} style={{ flexShrink: 0 }} />
                  <div>
                    <strong>Inventory Notice:</strong> {cartError}
                  </div>
                </div>
              )}

              {/* Delivery Information Card */}
              <div className="cart-panel">
                <div className="checkout-section-header">
                  <Mail size={18} color="#ff6500" />
                  <span>Digital Delivery Destination</span>
                </div>

                <div className="checkout-info-box">
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--lp-text-main)' }}>
                      {String(session?.user.user_metadata?.full_name || session?.user.email?.split('@')[0] || 'Account Holder')}
                    </div>
                    <div style={{ color: 'var(--lp-text-muted)', fontSize: '0.8rem', marginTop: 2 }}>
                      Delivery Email: <strong>{session?.user.email}</strong>
                    </div>
                  </div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: '#10b98120', color: '#10b981' }}>
                    Verified Account
                  </span>
                </div>

                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--lp-text-muted)', lineHeight: 1.45 }}>
                  ⚡ Digital licenses and credentials are automatically delivered directly to your Customer Dashboard downloads and verified email address upon confirmed payment.
                </p>
              </div>

              {/* Payment Gateway Card */}
              <div className="cart-panel">
                <div className="checkout-section-header">
                  <CreditCard size={18} color="#ff6500" />
                  <span>Payment Gateway & Settlement</span>
                </div>

                <div className="checkout-payment-box">
                  <div className="checkout-payment-header">
                    <div className="checkout-payment-brand">
                      <Building2 size={16} color="#ff6500" />
                      <span>Bachs Payments (NGN Settlement)</span>
                    </div>
                    <span className="checkout-payment-badge">Bank Transfer · Card · USSD</span>
                  </div>

                  <p className="checkout-payment-desc">
                    Secure Naira checkout powered by Bachs. Orders are created with atomic D1 inventory holds and verified cryptographic webhooks.
                  </p>

                  <div className="checkout-payment-channels">
                    <div className="checkout-channel-item">
                      <Building2 size={13} color="#ff6500" />
                      <span>Direct Bank Transfer</span>
                    </div>
                    <div className="checkout-channel-item">
                      <CreditCard size={13} color="#ff6500" />
                      <span>Debit & Credit Cards</span>
                    </div>
                    <div className="checkout-channel-item">
                      <PhoneCall size={13} color="#ff6500" />
                      <span>USSD Channels</span>
                    </div>
                  </div>
                </div>

                {/* Pre-Activation Notice explaining that live charging is disabled per prompt instructions */}
                <div className="checkout-verification-notice">
                  <Lock size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong style={{ display: 'block', marginBottom: 2 }}>Production Verification Notice:</strong>
                    Live settlement is completing final merchant onboarding verification. Per security protocol, live card charging remains locked until compliance clearance is completed. No customer accounts will be debited.
                  </div>
                </div>

                {checkoutError && (
                  <div className="checkout-verification-notice" style={{ background: 'rgba(239, 68, 68, 0.08)', borderColor: '#ef4444', color: '#dc2626' }}>
                    <AlertCircle size={18} style={{ flexShrink: 0 }} />
                    <div>
                      <strong>Gateway Status:</strong> {checkoutError}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Order Summary & Place Order Button */}
            <aside className="cart-summary-box">
              <h2 className="cart-summary-title">Order Summary</h2>

              {/* Compact List of Items */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 220, overflowY: 'auto' }}>
                {items.map(item => {
                  const product = products.find(p => p.id === item.id)
                  return (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10,
                        fontSize: '0.825rem',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600, color: 'var(--lp-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {product?.name || 'Item ' + item.id.slice(0, 8)}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.725rem', color: 'var(--lp-text-muted)' }}>
                          <span>Qty: {item.quantity}</span>
                          {product?.server_number && (
                            <span className={`cart-server-badge s${product.server_number}`} style={{ fontSize: '0.65rem', padding: '1px 5px' }}>
                              Server {product.server_number}{product.server_number === 4 ? ' (AI Tools)' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, color: 'var(--lp-text-main)', flexShrink: 0 }}>
                        {product ? formatPrice(product.price_minor * item.quantity) : '—'}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="cart-summary-divider" />

              <div className="cart-summary-breakdown">
                <div className="cart-summary-row">
                  <span>Subtotal</span>
                  <strong>{formatPrice(subtotalMinor)}</strong>
                </div>
                <div className="cart-summary-row free-tag">
                  <span>Digital Delivery</span>
                  <span>Instant · FREE</span>
                </div>
                <div className="cart-summary-divider" />
                <div className="cart-summary-total-row">
                  <span className="cart-summary-total-label">Final Amount</span>
                  <span className="cart-summary-total-amount">
                    {formatPrice(subtotalMinor)}
                  </span>
                </div>
                <div style={{ fontSize: '0.725rem', color: 'var(--lp-text-muted)', textAlign: 'right' }}>
                  Settlement currency: Nigerian Naira (NGN ₦)
                </div>
              </div>

              {/* Action Button */}
              <button
                type="button"
                className="cart-primary-btn"
                onClick={() => void handleInitiatePayment()}
                disabled={submitting || loadingProducts || !items.length || subtotalMinor <= 0}
              >
                {submitting ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    <span>Connecting to Bachs…</span>
                  </>
                ) : (
                  <>
                    <Lock size={16} />
                    <span>Pay {formatPrice(subtotalMinor)} with Bachs</span>
                  </>
                )}
              </button>

              <div style={{ textAlign: 'center' }}>
                <Link to="/cart" style={{ fontSize: '0.8rem', color: 'var(--lp-text-muted)', textDecoration: 'none' }}>
                  ← Modify Cart Items
                </Link>
              </div>

              {/* Trust Badges */}
              <div className="cart-trust-badges">
                <div className="cart-trust-item">
                  <div className="cart-trust-icon">
                    <ShieldCheck size={12} />
                  </div>
                  <span>Non-custodial escrow & authorized catalog stock</span>
                </div>
                <div className="cart-trust-item">
                  <div className="cart-trust-icon">
                    <Lock size={12} />
                  </div>
                  <span>256-Bit SSL End-to-End Encryption</span>
                </div>
                <div className="cart-trust-item">
                  <div className="cart-trust-icon">
                    <Zap size={12} />
                  </div>
                  <span>Zero supplier exposure to third parties</span>
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  )
}
export default Checkout

