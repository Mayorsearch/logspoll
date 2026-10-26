import { useEffect, useRef, useState, useCallback } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useCart } from '../lib/cart'
import { useAuth } from '../auth/AuthProvider'
import { useCurrency } from '../lib/currency'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import { checkoutRequestId, clearCheckoutRequest, getCartActiveOrderId, setCartActiveOrderId, clearCartActiveOrderId } from '../lib/checkout-request'
import { getOrderDeliveryStatus } from '../lib/order-status'
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
  ShoppingBag,
  Wallet,
  MessageSquare
} from 'lucide-react'
import { WhatsAppSupportButton } from '../components/WhatsAppSupportButton'

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
  fulfillment_status: 'unfulfilled' | 'pending' | 'processing' | 'delivered' | 'failed'
  delivery_status?: string | null
  delivery_error?: string | null
  has_entitlement?: boolean | number | null
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

  // Track order ID from query params or customer- and cart-scoped storage.
  // Stale or completed previous orders NEVER override the current cart.
  const paramOrderId = searchParams.get('order_id')
  const [activeOrderId, setActiveOrderId] = useState<string | null>(() => {
    if (paramOrderId) return paramOrderId
    if (session?.user.id && items.length > 0) {
      return getCartActiveOrderId(sessionStorage, session.user.id, items)
    }
    clearCartActiveOrderId(sessionStorage)
    return null
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

  // Payment Method selection ('wallet' | 'bachs')
  const [paymentMethod, setPaymentMethod] = useState<'wallet' | 'bachs'>('wallet')
  const [wallet, setWallet] = useState<{ balance_minor: number; status: string } | null>(null)
  const [loadingWallet, setLoadingWallet] = useState(false)

  // Fetch customer wallet on mount.
  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (!active || !session) return
      setLoadingWallet(true)
      void cloudflareRequest<{ wallet: { balance_minor: number; status: string } }>('/api/wallet')
        .then(res => { if (active && res.wallet) setWallet(res.wallet) })
        .catch(() => { /* Wallet failures never assume a spendable balance. */ })
        .finally(() => { if (active) setLoadingWallet(false) })
    })
    return () => { active = false }
  }, [session])

  // Track the in-flight status request ID to prevent async responses for older orders from overwriting newer carts
  const orderReqRef = useRef<string | null>(activeOrderId)

  // 1. Check order status if active order ID exists
  const checkOrderStatus = async (orderId: string) => {
    if (!session) return
    orderReqRef.current = orderId
    setCheckingStatus(true)
    setStatusError('')

    try {
      const res = await cloudflareRequest<{ order?: OrderStatusRecord }>(
        `/api/orders/${encodeURIComponent(orderId)}/status`
      )
      // Guard against race conditions if active order changed in the meantime
      if (orderReqRef.current !== orderId) return

      if (res.order) {
        setOrderStatus(res.order)
        // Clear cart ONLY if this confirmed order was the one placed for the current cart items.
        // Viewing order history or an older order must NEVER erase a newly added cart item.
        const isCurrentCart = Boolean(session && getCartActiveOrderId(sessionStorage, session.user.id, items) === orderId)
        if (res.order.payment_status === 'paid' && isCurrentCart) {
          clear()
          clearCheckoutRequest(sessionStorage, session.user.id, items)
          clearCartActiveOrderId(sessionStorage, session.user.id, items)
        } else if ((res.order.payment_status === 'refunded' || res.order.payment_status === 'cancelled') && isCurrentCart) {
          clearCheckoutRequest(sessionStorage, session.user.id, items)
          clearCartActiveOrderId(sessionStorage, session.user.id, items)
          if (items.length > 0 && !paramOrderId) {
            setActiveOrderId(null)
            setOrderStatus(null)
          }
        }
      } else {
        setStatusError('Order details could not be retrieved.')
      }
    } catch (err) {
      if (orderReqRef.current === orderId) {
        setStatusError(err instanceof Error ? err.message : 'Unable to check order status.')
      }
    } finally {
      if (orderReqRef.current === orderId) {
        setCheckingStatus(false)
      }
    }
  }

  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active && activeOrderId) void checkOrderStatus(activeOrderId) })
    return () => { active = false }
    // Recheck when the active order or signed-in customer changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrderId, session])

  // 2. Fetch live product data for items currently in cart
  const priceRequest = useRef(0)
  const ids = items.map(i => i.id).sort().join(',')

  // Synchronize active order state when cart items change and no explicit paramOrderId is in URL
  useEffect(() => {
    if (!paramOrderId) {
      const cartOrder = getCartActiveOrderId(sessionStorage, session?.user.id, items)
      setActiveOrderId(cartOrder)
      if (!cartOrder) {
        setOrderStatus(null)
        setStatusError('')
      }
    }
  }, [ids, session?.user.id, paramOrderId])

  const refreshProducts = useCallback(async () => {
    const requestId = ++priceRequest.current
    if (!ids || orderStatus) {
      setLoadingProducts(false)
      return
    }
    setLoadingProducts(true)
    setCartError('')

    try {
      const res = await cloudflareRequest<{ records: Product[]; blockedItems?: Array<{ reason: string }> }>('/api/cart/refresh-prices', { ids: ids.split(',') })
      if (requestId !== priceRequest.current) return false
      if (res.blockedItems?.length) setCartError(res.blockedItems.map(item => item.reason).join(' '))
      setProducts(res.records || [])
      return !res.blockedItems?.length
    } catch (err) {
      if (requestId !== priceRequest.current) return false
      setCartError(err instanceof Error ? err.message : 'Unable to verify items.')
      return false
    } finally {
      if (requestId === priceRequest.current) {
        setLoadingProducts(false)
      }
    }
  }, [ids, orderStatus])

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) void refreshProducts()
    })
    return () => {
      active = false
      priceRequest.current++
    }
  }, [refreshProducts])

  // Compute live subtotal
  const subtotalMinor = items.reduce((sum, item) => {
    const product = products.find(p => p.id === item.id)
    return sum + (product ? product.price_minor * item.quantity : 0)
  }, 0)

  // Handle Checkout submission
  const handleInitiatePayment = async () => {
    if (!session) {
      navigate(`/login?next=${encodeURIComponent('/checkout')}`)
      return
    }
    if (!items.length || subtotalMinor <= 0) return

    setSubmitting(true)
    setCheckoutError('')

    // 1. Pay with Customer Wallet Flow
    if (paymentMethod === 'wallet') {
      const balanceMinor = wallet?.balance_minor ?? 0
      if (balanceMinor < subtotalMinor) {
        setCheckoutError(`Insufficient wallet balance. Total: ${formatPrice(subtotalMinor)}, Available: ${formatPrice(balanceMinor)}. Please fund your wallet or pay with Bachs.`)
        setSubmitting(false)
        return
      }

      try {
        const res = await cloudflareRequest<{
          ok: boolean
          orderId: string
          reference: string
          totalMinor: number
          balanceAfterMinor: number
        }>('/api/wallet/pay-order', {
          requestId: checkoutRequestId(sessionStorage, session.user.id, items),
          items: items.map(i => ({ id: i.id, quantity: i.quantity })),
        })

        clear()
        clearCheckoutRequest(sessionStorage, session.user.id, items)
        clearCartActiveOrderId(sessionStorage, session.user.id, items)
        if (res.orderId) {
          setActiveOrderId(res.orderId)
          await checkOrderStatus(res.orderId)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Wallet payment failed.'
        if (msg.includes('Supplier pricing refresh is pending') || msg.includes('pricing refresh') || msg.includes('Price updated')) {
          const refreshed = await refreshProducts()
          setCheckoutError(refreshed ? 'Prices updated. Review your total before selecting Pay again.' : msg)
        } else {
          setCheckoutError(msg)
        }
      } finally {
        setSubmitting(false)
      }
      return
    }

    // 2. Direct Bachs Gateway Flow
    if (subtotalMinor < 10000) {
      setCheckoutError('Bachs checkout requires a minimum order total of ₦100.00. Please increase quantity or add more items.')
      setSubmitting(false)
      return
    }

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          requestId: checkoutRequestId(sessionStorage, session.user.id, items),
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
        if (response.status === 409 && data.error === 'Idempotency request does not match the original checkout.') {
          checkoutRequestId(sessionStorage, session.user.id, items, true)
          throw new Error('Your cart changed. Its checkout reference is refreshed; select Pay again. Existing orders are unchanged.')
        }
        if (data.error?.includes('Supplier pricing refresh is pending') || data.error?.includes('pricing refresh') || data.error?.includes('Price updated')) {
          const refreshed = await refreshProducts()
          throw new Error(refreshed ? 'Prices updated. Review your total before selecting Pay again.' : data.error)
        }
        throw new Error(data.error || 'Payment gateway connection was not accepted.')
      }

      const orderId = data.orderId || data.order_id
      const checkoutUrl = data.checkoutUrl || data.checkout_url

      if (orderId) {
        setActiveOrderId(orderId)
        setCartActiveOrderId(sessionStorage, session.user.id, items, orderId)
      }

      if (checkoutUrl) {
        window.location.assign(checkoutUrl)
      } else if (orderId) {
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
    const delivery = getOrderDeliveryStatus(orderStatus)
    const isDelivered = delivery.status === 'delivered'
    const isFailed = delivery.status === 'delivery_failed'
    const isAwaitingSupplier = delivery.status === 'awaiting_supplier'

    const stepTitle = isDelivered ? 'Delivered' : isFailed ? 'Support Review' : isAwaitingSupplier ? 'Awaiting Supplier' : 'Delivery Processing'
    const stepColor = isDelivered ? '#10b981' : isFailed ? '#ef4444' : '#ff6500'

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
            <div className="cart-step-separator" style={{ background: stepColor }} />
            <div className={`cart-step-item ${isDelivered ? 'completed' : 'active'}`}>
              <span className="cart-step-badge" style={isFailed ? { background: '#ef4444', borderColor: '#ef4444', color: '#fff' } : undefined}>
                {isDelivered ? '✓' : isFailed ? '!' : '3'}
              </span>
              <span className="cart-step-title">{stepTitle}</span>
            </div>
          </div>

          <div className="order-success-card" style={isFailed ? { borderColor: '#ef4444' } : undefined}>
            <div
              className="order-success-icon-wrap"
              style={
                isFailed
                  ? { background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', boxShadow: '0 0 0 10px rgba(239, 68, 68, 0.05)' }
                  : isDelivered
                    ? undefined
                    : { background: 'rgba(255, 101, 0, 0.1)', color: 'var(--lp-orange)', boxShadow: '0 0 0 10px rgba(255, 101, 0, 0.05)' }
              }
            >
              {isDelivered ? <CheckCircle2 size={44} /> : isFailed ? <AlertCircle size={44} /> : isAwaitingSupplier ? <Clock size={44} /> : <Zap size={44} />}
            </div>

            <h1 className="order-success-title">
              {isDelivered
                ? 'Payment Confirmed & Delivered'
                : isFailed
                  ? 'Delivery Assistance Required'
                  : isAwaitingSupplier
                    ? 'Delivery Awaiting Supplier'
                    : 'Payment Confirmed — Delivery Processing'}
            </h1>
            <p style={{ margin: 0, color: 'var(--lp-text-muted)', fontSize: '0.95rem' }}>
              {isDelivered
                ? 'Your order has been verified and digital credentials have been delivered to your secure vault.'
                : isFailed
                  ? 'Your payment was confirmed and recorded, but automated fulfillment could not be completed. Your funds remain secure, and our support team is available to assist or issue a prompt refund.'
                  : isAwaitingSupplier
                    ? 'Your payment is confirmed. The order was dispatched to the supplier and is awaiting credential generation. Delivery typically completes in 1–2 minutes.'
                    : 'Your payment is confirmed. Our automated fulfillment engine is initializing and preparing your digital credentials.'}
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
                <span style={{
                  color: isDelivered ? '#10b981' : isFailed ? '#ef4444' : '#ff6500',
                  fontWeight: 700
                }}>
                  {delivery.label}
                </span>
              </div>
              <div className="order-success-row">
                <span>Confirmation Sent To</span>
                <strong>{session?.user.email}</strong>
              </div>
            </div>

            {isFailed && orderStatus.delivery_error && (
              <div className="checkout-verification-notice" style={{ background: 'rgba(239, 68, 68, 0.08)', borderColor: '#ef4444', color: '#dc2626' }}>
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>Diagnostic Note: {orderStatus.delivery_error}</span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', marginTop: 8 }}>
              {isDelivered ? (
                <Link to="/dashboard/purchases" className="cart-primary-btn">
                  Access Purchased Downloads <ArrowRight size={16} />
                </Link>
              ) : isFailed ? (
                <>
                  <WhatsAppSupportButton
                    orderReference={orderStatus.reference}
                    variant="primary"
                    buttonText="Contact Support on WhatsApp"
                    style={{ width: '100%' }}
                  />
                  <Link
                    to={`/dashboard/support?ref=${encodeURIComponent(orderStatus.reference)}`}
                    className="cart-secondary-btn"
                  >
                    <PhoneCall size={16} /> Open Web Support Ticket
                  </Link>
                </>
              ) : (
                <button
                  type="button"
                  className="cart-primary-btn"
                  onClick={() => checkOrderStatus(orderStatus.id)}
                  disabled={checkingStatus}
                >
                  <RefreshCw size={16} className={checkingStatus ? 'animate-spin' : ''} />
                  Check Delivery Status
                </button>
              )}
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
              {isPending ? 'Payment Pending' : 'Payment Status: ' + orderStatus.payment_status.toUpperCase()}
            </h1>

            <p style={{ margin: 0, color: 'var(--lp-text-muted)', fontSize: '0.9rem' }}>
              {isPending
                ? 'Your transaction is awaiting payment confirmation. Once settlement is received, automated delivery will begin immediately.'
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
              {isPending ? (
                <button
                  type="button"
                  className="cart-primary-btn"
                  onClick={() => checkOrderStatus(orderStatus.id)}
                  disabled={checkingStatus}
                >
                  <RefreshCw size={16} className={checkingStatus ? 'animate-spin' : ''} />
                  Check Status Again
                </button>
              ) : (
                <button
                  type="button"
                  className="cart-primary-btn"
                  onClick={() => {
                    if (session) {
                      clearCartActiveOrderId(sessionStorage, session.user.id, items)
                      clearCheckoutRequest(sessionStorage, session.user.id, items)
                    }
                    setActiveOrderId(null)
                    setOrderStatus(null)
                  }}
                >
                  Start New Checkout
                </button>
              )}
              <Link to="/cart" className="cart-secondary-btn">
                Return to Cart
              </Link>
              <WhatsAppSupportButton
                orderReference={orderStatus.reference}
                variant="outline"
                buttonText="Report Issue on WhatsApp"
                style={{ width: '100%' }}
              />
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
            <div className="checkout-details-column">
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

              {/* Payment Method Selector Card */}
              <div className="cart-panel">
                <div className="checkout-section-header">
                  <CreditCard size={18} color="#ff6500" />
                  <span>Choose Payment Method</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
                  {/* Option 1: Pay with Wallet */}
                  <div
                    onClick={() => setPaymentMethod('wallet')}
                    style={{
                      padding: 14,
                      borderRadius: 10,
                      border: `2px solid ${paymentMethod === 'wallet' ? '#ff6500' : 'var(--lp-border, #e2e8f0)'}`,
                      background: paymentMethod === 'wallet' ? '#ff650008' : 'var(--lp-card-bg, #ffffff)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                        <Wallet size={16} color={paymentMethod === 'wallet' ? '#ff6500' : 'var(--lp-text-muted)'} />
                        <span>Pay with Wallet</span>
                      </div>
                      <span style={{
                        width: 16, height: 16, borderRadius: '50%',
                        border: `2px solid ${paymentMethod === 'wallet' ? '#ff6500' : '#cbd5e1'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        {paymentMethod === 'wallet' && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff6500' }} />}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--lp-text-muted)' }}>
                      Available: <strong style={{ color: (wallet?.balance_minor ?? 0) >= subtotalMinor ? '#10b981' : '#ef4444' }}>{loadingWallet ? '…' : formatPrice(wallet?.balance_minor ?? 0)}</strong>
                    </div>
                  </div>

                  {/* Option 2: Bachs Direct Gateway */}
                  <div
                    onClick={() => setPaymentMethod('bachs')}
                    style={{
                      padding: 14,
                      borderRadius: 10,
                      border: `2px solid ${paymentMethod === 'bachs' ? '#ff6500' : 'var(--lp-border, #e2e8f0)'}`,
                      background: paymentMethod === 'bachs' ? '#ff650008' : 'var(--lp-card-bg, #ffffff)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                        <Building2 size={16} color={paymentMethod === 'bachs' ? '#ff6500' : 'var(--lp-text-muted)'} />
                        <span>Bachs Online Gateway</span>
                      </div>
                      <span style={{
                        width: 16, height: 16, borderRadius: '50%',
                        border: `2px solid ${paymentMethod === 'bachs' ? '#ff6500' : '#cbd5e1'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        {paymentMethod === 'bachs' && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff6500' }} />}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--lp-text-muted)' }}>
                      Card · Bank Transfer · USSD
                    </div>
                  </div>
                </div>

                {/* Wallet Details Breakdown */}
                {paymentMethod === 'wallet' && (
                  <div style={{
                    padding: 16,
                    borderRadius: 10,
                    background: 'var(--lp-bg-subtle, #f8fafc)',
                    border: '1px solid var(--lp-border, #e2e8f0)',
                    marginBottom: 16
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 6 }}>
                      <span style={{ color: 'var(--lp-text-muted)' }}>Current Wallet Balance:</span>
                      <strong>{formatPrice(wallet?.balance_minor ?? 0)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 6 }}>
                      <span style={{ color: 'var(--lp-text-muted)' }}>Amount to Deduct:</span>
                      <strong style={{ color: '#ff6500' }}>-{formatPrice(subtotalMinor)}</strong>
                    </div>
                    <div style={{ height: 1, background: 'var(--lp-border, #e2e8f0)', margin: '8px 0' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                      <span style={{ fontWeight: 600 }}>Remaining Wallet Balance:</span>
                      <strong style={{ color: (wallet?.balance_minor ?? 0) >= subtotalMinor ? '#10b981' : '#ef4444' }}>
                        {formatPrice(Math.max(0, (wallet?.balance_minor ?? 0) - subtotalMinor))}
                      </strong>
                    </div>

                    {(wallet?.balance_minor ?? 0) < subtotalMinor && (
                      <div style={{
                        marginTop: 14,
                        padding: '10px 14px',
                        background: '#ef444415',
                        border: '1px solid #ef4444',
                        color: '#b91c1c',
                        borderRadius: 8,
                        fontSize: '0.825rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 10
                      }}>
                        <div>
                          <strong>Insufficient Wallet Balance.</strong> You need {formatPrice(subtotalMinor - (wallet?.balance_minor ?? 0))} more.
                        </div>
                        <Link
                          to="/dashboard/wallet"
                          className="button button-orange button-small"
                          style={{ padding: '5px 12px', fontSize: '0.75rem', textDecoration: 'none' }}
                        >
                          Fund Wallet Now →
                        </Link>
                      </div>
                    )}
                  </div>
                )}

                {/* Bachs Info Box */}
                {paymentMethod === 'bachs' && (
                  <>
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

                    <div className="checkout-verification-notice">
                      <Lock size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                      <div>
                        <strong style={{ display: 'block', marginBottom: 2 }}>Production Verification Notice:</strong>
                        Live settlement is completing final merchant onboarding verification. Per security protocol, live card charging remains locked until compliance clearance is completed. No customer accounts will be debited.
                      </div>
                    </div>
                  </>
                )}

                {checkoutError && (
                  <div className="checkout-verification-notice" style={{ background: 'rgba(239, 68, 68, 0.08)', borderColor: '#ef4444', color: '#dc2626' }}>
                    <AlertCircle size={18} style={{ flexShrink: 0 }} />
                    <div>
                      <strong>Checkout Notice:</strong> {checkoutError}
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
                disabled={
                  submitting ||
                  loadingProducts ||
                  Boolean(cartError) ||
                  items.some(item => !products.some(product => product.id === item.id && product.available_quantity >= item.quantity)) ||
                  !items.length ||
                  subtotalMinor <= 0 ||
                  (paymentMethod === 'wallet' && (wallet?.balance_minor ?? 0) < subtotalMinor)
                }
              >
                {submitting ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    <span>
                      {paymentMethod === 'wallet' ? 'Authorizing Wallet Payment…' : 'Connecting to Bachs…'}
                    </span>
                  </>
                ) : paymentMethod === 'wallet' ? (
                  (wallet?.balance_minor ?? 0) < subtotalMinor ? (
                    <>
                      <AlertCircle size={16} />
                      <span>Insufficient Wallet Balance</span>
                    </>
                  ) : (
                    <>
                      <Wallet size={16} />
                      <span>Pay {formatPrice(subtotalMinor)} from Wallet</span>
                    </>
                  )
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

              {/* Checkout WhatsApp Help Section */}
              <div
                style={{
                  marginTop: 18,
                  padding: '14px 16px',
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, rgba(37, 211, 102, 0.08), rgba(18, 140, 126, 0.05))',
                  border: '1px solid rgba(37, 211, 102, 0.25)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '0.85rem', color: '#128C7E' }}>
                  <MessageSquare size={16} />
                  <span>Need Checkout Assistance?</span>
                </div>
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--lp-text-muted)', lineHeight: 1.4 }}>
                  Have questions about payment methods or need instant help? Our WhatsApp support desk is available to assist you.
                </p>
                <WhatsAppSupportButton
                  variant="primary"
                  buttonText="Contact Support on WhatsApp"
                  style={{ width: '100%', marginTop: 4, minHeight: 38 }}
                />
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  )
}
export default Checkout

