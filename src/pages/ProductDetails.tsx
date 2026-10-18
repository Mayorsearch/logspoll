import { useEffect, useState, useMemo } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  PackageOpen,
  ShieldCheck,
  Heart,
  ShoppingBag,
  Zap,
  Share2,
  Copy,
  Check,
  Star,
  Sparkles,
  Clock,
  Server,
  ChevronRight,
  CheckCircle2,
  Lock,
  Layers,
  FileText,
} from 'lucide-react'
import { ProductArtwork } from '../components/ProductArtwork'
import { useCart } from '../lib/cart'
import { useCurrency } from '../lib/currency'
import { useFavorites } from '../lib/favorites'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import '../product-details.css'

export interface Product {
  id: string
  category_id: string
  slug: string
  name: string
  brand?: string
  description: string
  price_minor: number
  currency: string
  category_name?: string
  category_slug?: string
  available_quantity: number
  term?: string
  delivery_type?: string
  image_path?: string | null
  supplier_image_urls?: string[]
  features?: string[]
  server_number?: number
}

interface TierInfo {
  minQty: number
  maxQty: number | null
  usdPrice: number
  priceMinor: number
  savingsPercent: number
}

interface ReviewRecord {
  id: string
  display_name: string
  location?: string
  rating: number
  message: string
  verified_purchase?: number
}

export function ProductDetails() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const { add } = useCart()
  const { formatPrice } = useCurrency()
  const { favorites, toggleFavorite } = useFavorites()

  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [activeTab, setActiveTab] = useState<'overview' | 'specs' | 'activation' | 'reviews'>('overview')
  const [toastMessage, setToastMessage] = useState('')
  const [cartFeedback, setCartFeedback] = useState(false)

  // Recommendations & Reviews
  const [relatedProducts, setRelatedProducts] = useState<Product[]>([])
  const [affordableProducts, setAffordableProducts] = useState<Product[]>([])
  const [reviews, setReviews] = useState<ReviewRecord[]>([])
  const [reviewsLoading, setReviewsLoading] = useState(false)

  // Load Main Product
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setCartFeedback(false)
    setQuantity(1)

    void cloudflareRequest<{ records?: Product[]; product?: Product }>(
      `/api/products?slug=${encodeURIComponent(slug ?? '')}`
    )
      .then((data) => {
        if (!active) return
        const item = data.product ?? data.records?.[0] ?? null
        setProduct(item)
        if (!item) {
          setError('This product is not currently available in the catalog.')
        }
      })
      .catch((problem) => {
        if (active) setError(problem.message || 'Failed to load product.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [slug])

  // Load Related & Affordable Products
  useEffect(() => {
    if (!product) return
    let active = true

    // Fetch related products (same category)
    if (product.category_slug) {
      void cloudflareRequest<{ records?: Product[] }>(
        `/api/products?category=${encodeURIComponent(product.category_slug)}&limit=8`
      )
        .then((res) => {
          if (!active) return
          const filtered = (res.records ?? [])
            .filter((p) => p.id !== product.id)
            .slice(0, 4)
          setRelatedProducts(filtered)
        })
        .catch(() => {})
    }

    // Fetch affordable recommendations (lowest price)
    void cloudflareRequest<{ records?: Product[] }>(
      `/api/products?sort=price-asc&limit=8`
    )
      .then((res) => {
        if (!active) return
        const filtered = (res.records ?? [])
          .filter((p) => p.id !== product.id && p.category_slug !== product.category_slug)
          .slice(0, 4)
        setAffordableProducts(filtered)
      })
      .catch(() => {})

    return () => {
      active = false
    }
  }, [product])

  // Load Verified Reviews
  useEffect(() => {
    let active = true
    setReviewsLoading(true)
    void cloudflareRequest<{ reviews?: ReviewRecord[] }>('/api/reviews')
      .then((res) => {
        if (!active) return
        setReviews(res.reviews ?? [])
      })
      .catch(() => {})
      .finally(() => {
        if (active) setReviewsLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  // Auto-dismiss Toast
  useEffect(() => {
    if (!toastMessage) return
    const timer = setTimeout(() => setToastMessage(''), 3000)
    return () => clearTimeout(timer)
  }, [toastMessage])

  // Parse Tiers from Features (e.g., DigitalCore Server 4 AI Tools)
  const tiers: TierInfo[] = useMemo(() => {
    if (!product || !Array.isArray(product.features)) return []
    const parsed: { minQty: number; maxQty: number | null; usdPrice: number }[] = []

    for (const f of product.features) {
      const match = f.match(/Tier\s*\(\s*(\d+)(?:[–-](\d+))?\+?\s*units?\s*\)\s*:\s*\$([0-9.]+)\s*USD/i)
      if (match) {
        parsed.push({
          minQty: parseInt(match[1], 10),
          maxQty: match[2] ? parseInt(match[2], 10) : null,
          usdPrice: parseFloat(match[3]),
        })
      }
    }

    if (parsed.length === 0) return []
    parsed.sort((a, b) => a.minQty - b.minQty)
    const baseUsd = parsed[0].usdPrice

    return parsed.map((t) => {
      const ratio = baseUsd > 0 ? t.usdPrice / baseUsd : 1
      const priceMinor = Math.round(product.price_minor * ratio)
      const savingsPercent = Math.max(0, Math.round((1 - ratio) * 100))
      return {
        ...t,
        priceMinor,
        savingsPercent,
      }
    })
  }, [product])

  // Determine Active Tier based on Quantity
  const activeTier = useMemo(() => {
    if (tiers.length === 0) return null
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (quantity >= tiers[i].minQty) {
        return tiers[i]
      }
    }
    return tiers[0]
  }, [tiers, quantity])

  // Price calculations
  const unitPriceMinor = activeTier ? activeTier.priceMinor : product?.price_minor ?? 0
  const totalPriceMinor = unitPriceMinor * quantity

  // Duration parser: uses product.term or extracts from title
  const displayDuration = useMemo(() => {
    if (product?.term && product.term.trim()) return product.term.trim()
    const match = product?.name.match(/\b(\d+\s*(?:Months?|Days?|Years?|Hours?|Weeks?))\b/i)
    return match ? match[1] : 'Standard Validity'
  }, [product])

  // Handlers
  const handleAddToCart = () => {
    if (!product || product.available_quantity < 1) return
    add(product.id, quantity, product.available_quantity)
    setCartFeedback(true)
    setToastMessage(`${product.name} (${quantity}) added to cart.`)
  }

  const handleBuyNow = () => {
    if (!product || product.available_quantity < 1) return
    add(product.id, quantity, product.available_quantity)
    navigate('/checkout')
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setToastMessage('Product link copied to clipboard!')
    } catch {
      setToastMessage('Link copied: ' + window.location.href)
    }
  }

  const handleShare = async () => {
    if (navigator.share && product) {
      try {
        await navigator.share({
          title: product.name,
          text: `Check out ${product.name} on LogsPoll`,
          url: window.location.href,
        })
        return
      } catch {
        // Fallback to copy link
      }
    }
    await handleCopyLink()
  }

  const isFavorite = product ? favorites.includes(product.id) : false

  // Loading State
  if (loading) {
    return (
      <main className="product-detail-page">
        <div className="product-detail-container">
          <div className="pd-breadcrumb-bar">
            <span className="pd-breadcrumbs">Loading catalog item…</span>
          </div>
          <div className="pd-empty-card" role="status">
            <div className="pd-empty-icon">
              <Sparkles size={28} />
            </div>
            <h2 className="pd-empty-title">Loading product details</h2>
            <p className="pd-empty-desc">Connecting to verified cluster and retrieving live availability…</p>
          </div>
        </div>
      </main>
    )
  }

  // Not Found / Error State
  if (!product) {
    return (
      <main className="product-detail-page">
        <div className="product-detail-container">
          <div className="pd-breadcrumb-bar">
            <Link to="/marketplace" className="pd-back-link">
              ← Return to Marketplace
            </Link>
          </div>
          <div className="pd-empty-card">
            <div className="pd-empty-icon">
              <PackageOpen size={32} />
            </div>
            <h1 className="pd-empty-title">Product Not Available</h1>
            <p className="pd-empty-desc">
              {error || 'This listing could not be found or has been withdrawn from the active catalog.'}
            </p>
            <Link to="/marketplace" className="pd-btn-buy-now" style={{ textDecoration: 'none', padding: '0 24px', flex: 'none' }}>
              Browse Available Products
            </Link>
          </div>
        </div>
      </main>
    )
  }

  const inStock = product.available_quantity > 0
  const serverNumber = product.server_number ?? 1
  const serverLabel = serverNumber === 4 ? 'Server 4 (AI Tools)' : `Server ${serverNumber}`
  const serverUpperLabel = serverNumber === 4 ? 'SERVER 4 (AI TOOLS)' : `SERVER ${serverNumber}`

  return (
    <main className="product-detail-page">
      <div className="product-detail-container">
        {/* Breadcrumb Navigation */}
        <nav aria-label="Breadcrumb" className="pd-breadcrumb-bar">
          <div className="pd-breadcrumbs">
            <Link to="/">Home</Link>
            <span className="separator">/</span>
            <Link to="/marketplace">Marketplace</Link>
            {product.category_name && (
              <>
                <span className="separator">/</span>
                <Link to={`/marketplace?category=${encodeURIComponent(product.category_slug ?? '')}`}>
                  {product.category_name}
                </Link>
              </>
            )}
            <span className="separator">/</span>
            <span className="current-crumb" aria-current="page">
              {product.name}
            </span>
          </div>
          <Link to="/marketplace" className="pd-back-link">
            ← Back to Marketplace
          </Link>
        </nav>

        {/* Main 2-Column Product Grid */}
        <section className="pd-main-grid" aria-labelledby="product-title-heading">
          {/* Left Column: Visual Media Presentation */}
          <div className="pd-media-col">
            <div className="pd-gallery-card">
              {/* Badge Overlay */}
              <div className="pd-gallery-badge-overlay">
                <span className="pd-overlay-server-pill">
                  <span className="pd-pulse-dot" />
                  {serverUpperLabel}
                </span>
                <span className={`pd-overlay-stock-badge ${!inStock ? 'out' : ''}`}>
                  {inStock ? `${product.available_quantity} In Stock` : 'Out of Stock'}
                </span>
              </div>

              {/* Responsive Artwork Presentation */}
              <div className="pd-artwork-wrapper">
                <ProductArtwork
                  path={product.image_path}
                  name={product.name}
                  category={product.category_name ?? 'Digital'}
                  images={product.supplier_image_urls ?? []}
                />
              </div>
            </div>

            {/* Buyer Trust Strip */}
            <div className="pd-trust-strip">
              <div className="pd-trust-item">
                <div className="pd-trust-icon">
                  <Zap size={18} />
                </div>
                <div className="pd-trust-text">
                  <strong>Instant Delivery</strong>
                  <span>Auto-dispatched</span>
                </div>
              </div>
              <div className="pd-trust-item">
                <div className="pd-trust-icon">
                  <ShieldCheck size={18} />
                </div>
                <div className="pd-trust-text">
                  <strong>Verified Stock</strong>
                  <span>Real-time guarantee</span>
                </div>
              </div>
              <div className="pd-trust-item">
                <div className="pd-trust-icon">
                  <Lock size={18} />
                </div>
                <div className="pd-trust-text">
                  <strong>Secure SSL</strong>
                  <span>Protected checkout</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Information, Pricing & Purchase Controls */}
          <div className="pd-info-col">
            {/* Header Card */}
            <div className="pd-header-card">
              <div className="pd-tags-row">
                <div className="pd-left-tags">
                  <span className="pd-server-tag">
                    <span className="pd-pulse-dot" />
                    {serverUpperLabel}
                  </span>
                  {product.category_name && (
                    <Link
                      to={`/marketplace?category=${encodeURIComponent(product.category_slug ?? '')}`}
                      className="pd-category-tag"
                    >
                      {product.category_name}
                    </Link>
                  )}
                </div>

                <div className="pd-share-group">
                  <button
                    type="button"
                    className="pd-icon-action-btn"
                    onClick={handleCopyLink}
                    title="Copy product link"
                    aria-label="Copy product link"
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    type="button"
                    className="pd-icon-action-btn"
                    onClick={handleShare}
                    title="Share product"
                    aria-label="Share product"
                  >
                    <Share2 size={16} />
                  </button>
                </div>
              </div>

              <h1 id="product-title-heading" className="pd-title">
                {product.name}
              </h1>

              <div className="pd-meta-row">
                <div className="pd-rating-badge">
                  <Star size={15} fill="#f59e0b" color="#f59e0b" />
                  <span>5.0</span>
                  <span style={{ color: 'var(--pd-text-muted)', fontWeight: 500 }}>
                    ({reviews.length > 0 ? `${reviews.length} reviews` : 'Verified'})
                  </span>
                </div>
                <span className="pd-meta-divider" />
                <div className="pd-verified-badge">
                  <CheckCircle2 size={15} />
                  <span>Verified Resale</span>
                </div>
                <span className="pd-meta-divider" />
                <span>Duration: {displayDuration}</span>
              </div>
            </div>

            {/* Pricing Card */}
            <div className="pd-pricing-card">
              <div className="pd-price-display-row">
                <div className="pd-price-group">
                  <span className="pd-main-price">{formatPrice(unitPriceMinor)}</span>
                  <span className="pd-price-unit">/ unit</span>
                </div>

                <span className={`pd-stock-indicator ${!inStock ? 'out' : ''}`}>
                  <span className="pd-pulse-dot" style={{ background: inStock ? '#10b981' : '#ef4444' }} />
                  {inStock ? `${product.available_quantity} available now` : 'Sold out'}
                </span>
              </div>

              {/* Volume / Subscription Tiers (Documented AI Tools formats) */}
              {tiers.length > 1 && (
                <div className="pd-tiers-card">
                  <div className="pd-tiers-header">
                    <strong>
                      <Layers size={15} /> Volume Pricing Tiers
                    </strong>
                    {activeTier && activeTier.savingsPercent > 0 && (
                      <span>Saving {activeTier.savingsPercent}%</span>
                    )}
                  </div>
                  <div className="pd-tiers-grid">
                    {tiers.map((t, idx) => {
                      const label = t.maxQty ? `${t.minQty}–${t.maxQty} units` : `${t.minQty}+ units`
                      const isSelected = activeTier === t
                      return (
                        <button
                          key={idx}
                          type="button"
                          className={`pd-tier-btn ${isSelected ? 'active' : ''}`}
                          onClick={() => setQuantity(t.minQty)}
                        >
                          <span className="pd-tier-range">{label}</span>
                          <span className="pd-tier-price">{formatPrice(t.priceMinor)}</span>
                          {t.savingsPercent > 0 && (
                            <span className="pd-tier-savings">Save {t.savingsPercent}%</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Quantity Stepper & Subtotal */}
              <div className="pd-quantity-row">
                <div className="pd-qty-label-group">
                  <strong>Select Quantity</strong>
                  <span className="pd-qty-subtotal">
                    Total: <strong style={{ color: 'var(--pd-text-main)' }}>{formatPrice(totalPriceMinor)}</strong>
                  </span>
                </div>

                <div className="pd-stepper-box">
                  <button
                    type="button"
                    className="pd-stepper-btn"
                    aria-label="Decrease quantity"
                    disabled={quantity <= 1 || !inStock}
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    className="pd-stepper-input"
                    value={quantity}
                    min={1}
                    max={Math.min(1000, product.available_quantity)}
                    disabled={!inStock}
                    aria-label="Quantity"
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10)
                      if (!isNaN(val)) {
                        setQuantity(Math.max(1, Math.min(product.available_quantity, val)))
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="pd-stepper-btn"
                    aria-label="Increase quantity"
                    disabled={quantity >= Math.min(1000, product.available_quantity) || !inStock}
                    onClick={() => setQuantity(quantity + 1)}
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Action Buttons Row */}
              <div className="pd-actions-row">
                <button
                  type="button"
                  className="pd-btn-buy-now"
                  disabled={!inStock}
                  onClick={handleBuyNow}
                >
                  <Zap size={18} /> Buy Now
                </button>

                <button
                  type="button"
                  className="pd-btn-add-cart"
                  disabled={!inStock}
                  onClick={handleAddToCart}
                >
                  <ShoppingBag size={18} /> Add to Cart
                </button>

                <button
                  type="button"
                  className={`pd-btn-fav ${isFavorite ? 'active' : ''}`}
                  onClick={() => toggleFavorite(product.id)}
                  title={isFavorite ? 'Remove from favorites' : 'Save to favorites'}
                  aria-label={isFavorite ? 'Remove from favorites' : 'Save to favorites'}
                >
                  <Heart
                    size={20}
                    fill={isFavorite ? '#ef4444' : 'none'}
                    color={isFavorite ? '#ef4444' : 'currentColor'}
                  />
                </button>
              </div>

              {/* Cart Feedback Banner */}
              {cartFeedback && (
                <div className="pd-cart-feedback" role="status">
                  <span>
                    <Check size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                    Added {quantity} unit(s) to your cart.
                  </span>
                  <Link to="/cart">View Cart →</Link>
                </div>
              )}

              <p className="pd-guarantee-note">
                <ShieldCheck size={14} color="var(--pd-orange)" />
                Instant automated dispatch to your account dashboard & email upon payment.
              </p>
            </div>

            {/* Quick Specs Grid */}
            <div className="pd-quick-specs">
              <div className="pd-spec-cell">
                <span className="pd-spec-cell-label">Delivery Format</span>
                <span className="pd-spec-cell-value">
                  {product.delivery_type || 'Digital Activation'}
                </span>
              </div>
              <div className="pd-spec-cell">
                <span className="pd-spec-cell-label">Validity / Duration</span>
                <span className="pd-spec-cell-value">{displayDuration}</span>
              </div>
              <div className="pd-spec-cell">
                <span className="pd-spec-cell-label">Server Cluster</span>
                <span className="pd-spec-cell-value">{serverLabel}</span>
              </div>
              <div className="pd-spec-cell">
                <span className="pd-spec-cell-label">Region</span>
                <span className="pd-spec-cell-value">Global / Worldwide</span>
              </div>
            </div>
          </div>
        </section>

        {/* Detailed Tabs Section */}
        <section className="pd-tabs-section" aria-label="Product Information Tabs">
          <div className="pd-tabs-nav" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'overview'}
              className={`pd-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              <FileText size={16} /> Overview & Description
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'specs'}
              className={`pd-tab-btn ${activeTab === 'specs' ? 'active' : ''}`}
              onClick={() => setActiveTab('specs')}
            >
              <Server size={16} /> Specifications
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'activation'}
              className={`pd-tab-btn ${activeTab === 'activation' ? 'active' : ''}`}
              onClick={() => setActiveTab('activation')}
            >
              <Clock size={16} /> Delivery & Activation
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'reviews'}
              className={`pd-tab-btn ${activeTab === 'reviews' ? 'active' : ''}`}
              onClick={() => setActiveTab('reviews')}
            >
              <Star size={16} /> Verified Reviews ({reviews.length})
            </button>
          </div>

          <div className="pd-tab-content">
            {/* Tab 1: Overview */}
            {activeTab === 'overview' && (
              <div className="pd-description-body">
                {product.description ? (
                  product.description
                    .split('\n')
                    .filter((line) => line.trim().length > 0)
                    .map((paragraph, index) => {
                      if (paragraph.startsWith('•') || paragraph.startsWith('-')) {
                        return (
                          <ul key={index}>
                            <li>{paragraph.replace(/^[•-]\s*/, '')}</li>
                          </ul>
                        )
                      }
                      return <p key={index}>{paragraph}</p>
                    })
                ) : (
                  <p>Comprehensive description and features will be displayed once confirmed.</p>
                )}
              </div>
            )}

            {/* Tab 2: Specifications */}
            {activeTab === 'specs' && (
              <table className="pd-specs-table">
                <tbody>
                  <tr>
                    <th>Product Title</th>
                    <td>{product.name}</td>
                  </tr>
                  <tr>
                    <th>Category</th>
                    <td>{product.category_name ?? 'Digital Product'}</td>
                  </tr>
                  <tr>
                    <th>Server Origin</th>
                    <td>{serverLabel}</td>
                  </tr>
                  <tr>
                    <th>Delivery Type</th>
                    <td>{product.delivery_type || 'Licensed digital download'}</td>
                  </tr>
                  <tr>
                    <th>Duration</th>
                    <td>{displayDuration}</td>
                  </tr>
                  <tr>
                    <th>Fulfillment Speed</th>
                    <td>Instant automated delivery upon payment confirmation</td>
                  </tr>
                  <tr>
                    <th>Verification Status</th>
                    <td>100% Authorized Resale & Verified Stock</td>
                  </tr>
                  <tr>
                    <th>Stock Units</th>
                    <td>{product.available_quantity} available in current cluster</td>
                  </tr>
                </tbody>
              </table>
            )}

            {/* Tab 3: Activation & Delivery Instructions */}
            {activeTab === 'activation' && (
              <div className="pd-activation-steps">
                <div className="pd-step-card">
                  <div className="pd-step-number">1</div>
                  <div className="pd-step-body">
                    <h4>Submit Order Securely</h4>
                    <p>
                      Add items to your cart and complete checkout. Payment is processed securely via Bachs
                      payment gateway.
                    </p>
                  </div>
                </div>

                <div className="pd-step-card">
                  <div className="pd-step-number">2</div>
                  <div className="pd-step-body">
                    <h4>Instant Automated Dispatch</h4>
                    <p>
                      As soon as your payment is verified by our system, license keys, credentials, or subscription
                      activation details are automatically generated and assigned to your order.
                    </p>
                  </div>
                </div>

                <div className="pd-step-card">
                  <div className="pd-step-number">3</div>
                  <div className="pd-step-body">
                    <h4>Access in Customer Dashboard & Email</h4>
                    <p>
                      Find your delivery notes under <strong>My Orders / My Downloads</strong> in your account
                      dashboard. A copy is also dispatched immediately to your verified email address.
                    </p>
                  </div>
                </div>

                <div className="pd-step-card">
                  <div className="pd-step-number">4</div>
                  <div className="pd-step-body">
                    <h4>Warranty & Dedicated Support</h4>
                    <p>
                      All items include full warranty coverage for their specified duration. If you encounter any
                      activation issues, our support team is available 24/7 to assist.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 4: Verified Reviews */}
            {activeTab === 'reviews' && (
              <div className="pd-reviews-container">
                <div className="pd-reviews-summary-card">
                  <div className="pd-rating-big">
                    <span className="pd-rating-number">5.0</span>
                    <div className="pd-rating-stars-col">
                      <div className="pd-stars-row">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <Star key={i} size={18} fill="#f59e0b" color="#f59e0b" />
                        ))}
                      </div>
                      <span className="pd-reviews-count-label">
                        Based on verified customer orders
                      </span>
                    </div>
                  </div>

                  <div className="pd-review-guarantee">
                    <ShieldCheck size={28} color="var(--pd-orange)" style={{ flexShrink: 0 }} />
                    <span>
                      <strong>Verified Buyer Guarantee:</strong> Only customers who have completed and received an
                      order on LogsPoll can submit verified reviews.
                    </span>
                  </div>
                </div>

                {reviewsLoading ? (
                  <p style={{ textAlign: 'center', color: 'var(--pd-text-muted)' }}>Loading reviews…</p>
                ) : reviews.length > 0 ? (
                  <div className="pd-reviews-list">
                    {reviews.map((rev) => (
                      <div key={rev.id} className="pd-review-card">
                        <div className="pd-review-header">
                          <div className="pd-reviewer-info">
                            <span className="pd-reviewer-name">{rev.display_name}</span>
                            {rev.location && (
                              <span style={{ fontSize: 12, color: 'var(--pd-text-muted)' }}>
                                · {rev.location}
                              </span>
                            )}
                          </div>
                          <div className="pd-stars-row">
                            {[1, 2, 3, 4, 5].map((i) => (
                              <Star
                                key={i}
                                size={14}
                                fill={i <= rev.rating ? '#f59e0b' : 'none'}
                                color={i <= rev.rating ? '#f59e0b' : '#cbd5e1'}
                              />
                            ))}
                          </div>
                        </div>
                        <p className="pd-review-comment">{rev.message}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="pd-no-reviews-state">
                    <Sparkles size={32} color="var(--pd-orange)" />
                    <p style={{ margin: 0, fontWeight: 700, color: 'var(--pd-text-main)' }}>
                      No customer reviews yet for this product.
                    </p>
                    <p style={{ margin: 0, fontSize: 13 }}>
                      Be the first to review once your order is completed and delivered!
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Related Products from Same Category */}
        {relatedProducts.length > 0 && (
          <section className="pd-recommendations-section" aria-labelledby="related-heading">
            <div className="pd-section-header">
              <h2 id="related-heading">Related Products in {product.category_name}</h2>
              <Link
                to={`/marketplace?category=${encodeURIComponent(product.category_slug ?? '')}`}
                className="pd-back-link"
              >
                View all in category <ChevronRight size={16} />
              </Link>
            </div>

            <div className="pd-recommendations-grid">
              {relatedProducts.map((rel) => (
                <Link key={rel.id} to={`/products/${rel.slug}`} className="pd-rec-card">
                  <div className="pd-rec-image-box">
                    <ProductArtwork
                      path={rel.image_path}
                      name={rel.name}
                      category={rel.category_name ?? ''}
                      images={rel.supplier_image_urls ?? []}
                    />
                  </div>
                  <div className="pd-rec-body">
                    <div className="pd-rec-badges-row">
                      <span className="pd-rec-server-badge">Server {rel.server_number ?? 1}{(rel.server_number ?? 1) === 4 ? ' (AI Tools)' : ''}</span>
                    </div>
                    <h3 className="pd-rec-name">{rel.name}</h3>
                    <div className="pd-rec-price-row">
                      <strong className="pd-rec-price">{formatPrice(rel.price_minor)}</strong>
                      <span className="pd-rec-stock-label">
                        {rel.available_quantity > 0 ? `${rel.available_quantity} in stock` : 'Out of stock'}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Affordable Recommendations from Other Categories */}
        {affordableProducts.length > 0 && (
          <section className="pd-recommendations-section" aria-labelledby="affordable-heading">
            <div className="pd-section-header">
              <h2 id="affordable-heading">Affordable Recommendations</h2>
              <Link to="/marketplace?sort=price-asc" className="pd-back-link">
                Explore budget-friendly finds <ChevronRight size={16} />
              </Link>
            </div>

            <div className="pd-recommendations-grid">
              {affordableProducts.map((aff) => (
                <Link key={aff.id} to={`/products/${aff.slug}`} className="pd-rec-card">
                  <div className="pd-rec-image-box">
                    <ProductArtwork
                      path={aff.image_path}
                      name={aff.name}
                      category={aff.category_name ?? ''}
                      images={aff.supplier_image_urls ?? []}
                    />
                  </div>
                  <div className="pd-rec-body">
                    <div className="pd-rec-badges-row">
                      <span className="pd-rec-server-badge">Server {aff.server_number ?? 1}{(aff.server_number ?? 1) === 4 ? ' (AI Tools)' : ''}</span>
                    </div>
                    <h3 className="pd-rec-name">{aff.name}</h3>
                    <div className="pd-rec-price-row">
                      <strong className="pd-rec-price">{formatPrice(aff.price_minor)}</strong>
                      <span className="pd-rec-stock-label">
                        {aff.available_quantity > 0 ? `${aff.available_quantity} in stock` : 'Out of stock'}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="pd-toast" role="alert">
          <CheckCircle2 size={18} color="var(--pd-orange)" />
          <span>{toastMessage}</span>
        </div>
      )}
    </main>
  )
}
