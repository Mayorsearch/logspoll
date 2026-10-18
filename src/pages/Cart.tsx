import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useCart } from '../lib/cart'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import { useCurrency } from '../lib/currency'
import { ProductArtwork } from '../components/ProductArtwork'
import {
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  ArrowRight,
  ShieldCheck,
  Zap,
  Lock,
  AlertTriangle,
  RefreshCw,
  Server as ServerIcon,
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

export function Cart() {
  const { items, update, remove, clear } = useCart()
  const { formatPrice } = useCurrency()
  const navigate = useNavigate()

  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState<boolean>(Boolean(items.length))
  const [error, setError] = useState<string>('')
  const [refreshing, setRefreshing] = useState<boolean>(false)

  const ids = items.map(item => item.id).sort().join(',')

  // Fetch real-time stock and prices from production D1
  const fetchProducts = async (isManual = false) => {
    if (!ids) {
      setProducts([])
      setLoading(false)
      return
    }
    if (isManual) setRefreshing(true)
    else setLoading(true)
    setError('')

    try {
      const res = await cloudflareRequest<{ records: Product[] }>(
        `/api/products?ids=${encodeURIComponent(ids)}`
      )
      setProducts(res.records || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to verify real-time product prices.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) void fetchProducts()
    })
    return () => {
      active = false
    }
  }, [ids])

  // Map items to their validated live product record
  const cartEntries = items.map(item => {
    const product = products.find(p => p.id === item.id)
    const available = product ? product.available_quantity : 0
    const isOutOfStock = Boolean(product && available <= 0)
    const isExceeded = Boolean(product && available > 0 && item.quantity > available)
    const isMissing = !loading && !product && products.length > 0
    const hasIssue = isOutOfStock || isExceeded || isMissing
    const unitPrice = product ? product.price_minor : 0
    const lineTotal = unitPrice * item.quantity

    return {
      item,
      product,
      available,
      isOutOfStock,
      isExceeded,
      isMissing,
      hasIssue,
      unitPrice,
      lineTotal,
    }
  })

  const hasAnyIssues = cartEntries.some(e => e.hasIssue)
  const subtotalMinor = cartEntries.reduce((sum, e) => sum + e.lineTotal, 0)
  const totalItemCount = items.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <div className="cart-checkout-page">
      <div className="cart-checkout-container">
        {/* Navigation Step Breadcrumbs */}
        <div className="cart-steps-nav" aria-label="Checkout Progress">
          <div className="cart-step-item active">
            <span className="cart-step-badge">1</span>
            <span className="cart-step-title">Review Cart</span>
          </div>
          <div className="cart-step-separator" />
          <div className="cart-step-item">
            <span className="cart-step-badge">2</span>
            <span className="cart-step-title">Secure Checkout</span>
          </div>
          <div className="cart-step-separator" />
          <div className="cart-step-item">
            <span className="cart-step-badge">3</span>
            <span className="cart-step-title">Instant Delivery</span>
          </div>
        </div>

        {/* Empty Cart State */}
        {!items.length ? (
          <div className="cart-empty-state">
            <div className="cart-empty-icon-box">
              <ShoppingBag size={34} />
            </div>
            <h1 className="cart-empty-title">Your Cart is Empty</h1>
            <p className="cart-empty-desc">
              Browse our verified digital inventory across Servers 1 to 4 to find high-performance accounts, VPNs, and tools.
            </p>
            <Link to="/marketplace" className="cart-primary-btn" style={{ maxWidth: 240, marginTop: 12 }}>
              Browse Marketplace <ArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <div className="cart-grid-layout">
            {/* Left Column: Cart Items List */}
            <div className="cart-panel">
              <div className="cart-panel-header">
                <h1 className="cart-panel-title">
                  <ShoppingCart size={22} color="#ff6500" />
                  Shopping Cart
                  <span className="cart-item-count-badge">
                    {totalItemCount} {totalItemCount === 1 ? 'item' : 'items'}
                  </span>
                </h1>
                <button
                  type="button"
                  className="cart-secondary-btn"
                  style={{ width: 'auto', padding: '6px 12px', fontSize: '0.8rem' }}
                  onClick={() => void fetchProducts(true)}
                  disabled={refreshing || loading}
                  title="Verify latest stock and prices against production D1"
                >
                  <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
                  <span>Verify Stock</span>
                </button>
              </div>

              {error && (
                <div className="checkout-verification-notice" style={{ background: 'rgba(239, 68, 68, 0.08)', borderColor: '#ef4444', color: '#dc2626' }}>
                  <AlertTriangle size={18} />
                  <div>
                    <strong>Stock verification alert:</strong> {error}
                  </div>
                </div>
              )}

              {hasAnyIssues && (
                <div className="checkout-verification-notice">
                  <AlertTriangle size={18} />
                  <div>
                    <strong>Inventory update required:</strong> One or more items in your cart have stock limitations. Adjust quantities or remove unavailable products to proceed to checkout.
                  </div>
                </div>
              )}

              {loading && !products.length ? (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--lp-text-muted)' }}>
                  <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 12px', color: '#ff6500' }} />
                  <p style={{ margin: 0, fontSize: '0.9rem' }}>Verifying live stock & prices from production database…</p>
                </div>
              ) : (
                <div className="cart-items-list">
                  {cartEntries.map(({ item, product, available, isOutOfStock, isExceeded, isMissing, hasIssue, unitPrice, lineTotal }) => (
                    <article
                      key={item.id}
                      className={`cart-item-card ${hasIssue ? 'has-issue' : ''}`}
                    >
                      {/* Product Artwork Image */}
                      <div className="cart-item-image-wrap">
                        {product ? (
                          <ProductArtwork
                            name={product.name}
                            path={product.image_path}
                            category={product.category_name ?? ''}
                            images={product.supplier_image_urls}
                          />
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1e293b', color: '#64748b' }}>
                            <ShoppingBag size={20} />
                          </div>
                        )}
                      </div>

                      {/* Details */}
                      <div className="cart-item-details">
                        <div className="cart-item-meta-row">
                          {product?.server_number ? (
                            <span className={`cart-server-badge s${product.server_number}`}>
                              <ServerIcon size={10} />
                              Server {product.server_number}{product.server_number === 4 ? ' (AI Tools)' : ''}
                            </span>
                          ) : (
                            <span className="cart-server-badge">
                              <ServerIcon size={10} />
                              Verified Server
                            </span>
                          )}
                          {product?.category_name && (
                            <span className="cart-category-tag">· {product.category_name}</span>
                          )}
                        </div>

                        {product ? (
                          <Link to={`/products/${product.slug}`} className="cart-item-title">
                            {product.name}
                          </Link>
                        ) : (
                          <div className="cart-item-title" style={{ color: '#ef4444' }}>
                            {isMissing ? 'Product no longer listed in catalog' : 'Verifying item…'}
                          </div>
                        )}

                        {/* Stock status indicator */}
                        {product && (
                          <div className={`cart-item-stock-status ${isOutOfStock ? 'out-of-stock' : isExceeded ? 'low-stock' : 'in-stock'}`}>
                            {isOutOfStock ? (
                              <>
                                <AlertTriangle size={13} />
                                <span>Out of stock — remove to continue</span>
                              </>
                            ) : isExceeded ? (
                              <>
                                <AlertTriangle size={13} />
                                <span>Only {available} available in stock</span>
                              </>
                            ) : (
                              <span>✓ In Stock ({available} available)</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Right: Stepper, Price & Remove */}
                      <div className="cart-item-right">
                        <div className="cart-stepper" aria-label="Item quantity stepper">
                          <button
                            type="button"
                            className="cart-stepper-btn"
                            aria-label="Decrease quantity"
                            disabled={item.quantity <= 1}
                            onClick={() => update(item.id, item.quantity - 1)}
                          >
                            <Minus size={13} />
                          </button>
                          <input
                            type="number"
                            className="cart-stepper-input"
                            aria-label={`Quantity for ${product?.name ?? 'item'}`}
                            min={1}
                            max={product ? Math.min(1000, product.available_quantity) : 1000}
                            value={item.quantity}
                            onChange={e => {
                              const val = parseInt(e.target.value, 10)
                              if (!isNaN(val)) update(item.id, val)
                            }}
                          />
                          <button
                            type="button"
                            className="cart-stepper-btn"
                            aria-label="Increase quantity"
                            disabled={Boolean(product && item.quantity >= product.available_quantity)}
                            onClick={() => update(item.id, item.quantity + 1)}
                          >
                            <Plus size={13} />
                          </button>
                        </div>

                        <div className="cart-item-price-block">
                          <div className="cart-item-total-price">
                            {formatPrice(lineTotal)}
                          </div>
                          {item.quantity > 1 && (
                            <div className="cart-item-unit-price">
                              {formatPrice(unitPrice)} each
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          className="cart-item-remove-btn"
                          aria-label="Remove item"
                          onClick={() => remove(item.id)}
                          title="Remove item from cart"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {/* Bottom Actions */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTop: '1px solid var(--lp-border)' }}>
                <Link to="/marketplace" className="cart-secondary-btn" style={{ width: 'auto' }}>
                  ← Continue Shopping
                </Link>
                <button
                  type="button"
                  className="cart-secondary-btn"
                  style={{ width: 'auto', color: '#ef4444', borderColor: 'transparent' }}
                  onClick={() => {
                    if (window.confirm('Are you sure you want to clear your cart?')) {
                      clear()
                    }
                  }}
                >
                  <Trash2 size={14} />
                  <span>Clear Cart</span>
                </button>
              </div>
            </div>

            {/* Right Column: Order Summary & Checkout Action */}
            <aside className="cart-summary-box">
              <h2 className="cart-summary-title">Order Summary</h2>

              <div className="cart-summary-breakdown">
                <div className="cart-summary-row">
                  <span>Subtotal ({totalItemCount} {totalItemCount === 1 ? 'item' : 'items'})</span>
                  <strong>{formatPrice(subtotalMinor)}</strong>
                </div>

                <div className="cart-summary-row free-tag">
                  <span>Digital Delivery</span>
                  <span>Instant · FREE</span>
                </div>

                <div className="cart-summary-divider" />

                <div className="cart-summary-total-row">
                  <span className="cart-summary-total-label">Estimated Total</span>
                  <span className="cart-summary-total-amount">
                    {formatPrice(subtotalMinor)}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--lp-text-muted)', textAlign: 'right' }}>
                  Official settlement currency: NGN ₦
                </div>
              </div>

              {hasAnyIssues ? (
                <button type="button" className="cart-primary-btn" disabled>
                  <AlertTriangle size={16} /> Resolve Stock Issues to Checkout
                </button>
              ) : (
                <button
                  type="button"
                  className="cart-primary-btn"
                  onClick={() => navigate('/checkout')}
                  disabled={loading || !items.length || subtotalMinor <= 0}
                >
                  <Lock size={16} /> Proceed to Secure Checkout
                </button>
              )}

              {/* Security & Guarantees */}
              <div className="cart-trust-badges">
                <div className="cart-trust-item">
                  <div className="cart-trust-icon">
                    <Zap size={12} />
                  </div>
                  <span>Instant automated digital delivery upon payment</span>
                </div>
                <div className="cart-trust-item">
                  <div className="cart-trust-icon">
                    <Lock size={12} />
                  </div>
                  <span>256-Bit SSL encrypted transaction</span>
                </div>
                <div className="cart-trust-item">
                  <div className="cart-trust-icon">
                    <ShieldCheck size={12} />
                  </div>
                  <span>100% verified server catalog stock</span>
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  )
}
export default Cart
