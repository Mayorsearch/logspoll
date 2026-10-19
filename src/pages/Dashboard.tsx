import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, NavLink, Outlet, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { 
  LogOut, PackageOpen, House, UserRound, 
  ShoppingBag, ShieldCheck, ArrowRight, Heart, BookOpen, 
  Key, Check, Download, HelpCircle, Search, 
  Clock, CheckCircle2, XCircle, AlertCircle, MessageSquare,
  ChevronDown, ChevronUp, Wallet, Send, RefreshCw, Star
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { cloudflareAuth, cloudflareRequest } from '../lib/cloudflare-auth'
import { ProductArtwork } from '../components/ProductArtwork'
import { BrandIcon } from '../components/BrandIcon'
import { ReviewForm } from '../components/Reviews'
import { DeliveryVaultCard } from '../components/DeliveryVaultCard'
import { useCurrency } from '../lib/currency'
import { useFavorites } from '../lib/favorites'
import type { StructuredProductDelivery } from '../lib/delivery-parser'
import type { Order } from '../lib/customer-data'

interface ProductItem {
  id: string
  slug: string
  name: string
  brand?: string
  description?: string
  price_minor: number
  currency: string
  image_path?: string
  supplier_image_urls?: string[]
  server_number?: number
  available_quantity: number
  category_name?: string
  category_slug?: string
}

interface NavItem {
  path: string
  label: string
  icon: typeof House
  exact?: boolean
}

const navLinks: NavItem[] = [
  { path: '', label: 'Overview', icon: House, exact: true },
  { path: '/wallet', label: 'Wallet & Funds', icon: Wallet },
  { path: '/orders', label: 'My Orders', icon: ShoppingBag },
  { path: '/purchases', label: 'Downloads & Vault', icon: Download },
  { path: '/favorites', label: 'Saved Favorites', icon: Heart },
  { path: '/profile', label: 'Profile Settings', icon: UserRound },
  { path: '/settings', label: 'Security & Access', icon: Key },
  { path: '/support', label: 'Support & Help', icon: HelpCircle },
]

export function DashboardLayout() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { favorites } = useFavorites()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const displayName = String(
    session?.user.user_metadata?.full_name || 
    session?.user.user_metadata?.name || 
    session?.user.email?.split('@')[0] || 
    'Your Account'
  )

  const email = session?.user.email ?? ''

  async function logout() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await cloudflareAuth('sign-out', {})
      navigate('/login', { replace: true })
    } catch {
      setError('Unable to sign out. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container dashboard-shell">
      {/* Mobile Horizontal Navigation Tabs */}
      <nav className="dashboard-mobile-nav" aria-label="Mobile dashboard navigation">
        {navLinks.map(({ path, label, icon: Icon, exact }) => {
          const target = `/dashboard${path}`
          const isActive = exact ? location.pathname === target : location.pathname.startsWith(target)
          return (
            <NavLink 
              key={label} 
              to={target} 
              end={exact}
              className={`dashboard-mobile-pill ${isActive ? 'active' : ''}`}
            >
              <Icon size={16} />
              <span>{label}</span>
              {path === '/favorites' && favorites.length > 0 && (
                <span className="pill-badge">{favorites.length}</span>
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* Desktop Sidebar Navigation */}
      <aside className="dashboard-sidebar">
        {/* Customer Identity Card */}
        <div className="customer-identity">
          <div className="customer-avatar-wrapper">
            <span className="customer-avatar">
              {displayName.charAt(0).toUpperCase()}
            </span>
            <span className="avatar-online-dot" title="Active session" />
          </div>
          <div className="customer-meta">
            <strong className="customer-name">{displayName}</strong>
            <span className="member-label">
              <ShieldCheck size={12} className="inline-icon" /> VERIFIED CUSTOMER
            </span>
            <small className="account-email" title={email}>{email}</small>
          </div>
        </div>

        {/* Primary Navigation Menu */}
        <nav className="dashboard-nav-list" aria-label="Customer dashboard navigation">
          {navLinks.map(({ path, label, icon: Icon, exact }) => (
            <NavLink 
              key={label} 
              to={`/dashboard${path}`} 
              end={exact}
              className={({ isActive }) => `dashboard-nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={18} className="nav-icon" />
              <span className="nav-label">{label}</span>
              {path === '/favorites' && favorites.length > 0 && (
                <span className="nav-count-badge">{favorites.length}</span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Secondary Quick Links */}
        <div className="dashboard-sidebar-extra">
          <span className="sidebar-section-title">QUICK ACCESS</span>
          <Link to="/marketplace" className="dashboard-nav-extra">
            <PackageOpen size={17} />
            <span>Marketplace</span>
          </Link>
          <Link to="/docs" className="dashboard-nav-extra">
            <BookOpen size={17} />
            <span>API Docs</span>
          </Link>
        </div>

        {/* Sign Out Button */}
        <button 
          className="dashboard-logout-btn" 
          disabled={busy} 
          onClick={logout}
          aria-label="Sign out of account"
        >
          <LogOut size={17} />
          <span>{busy ? 'Signing out…' : 'Sign Out'}</span>
        </button>

        {error && <p className="form-error" role="alert">{error}</p>}
      </aside>

      {/* Main Content Area */}
      <main className="dashboard-content">
        <Outlet />
      </main>
    </div>
  )
}

export function CustomerRecords({
  mode,
}: {
  mode: 'overview' | 'orders' | 'purchases' | 'transactions' | 'downloads' | 'favorites' | 'support'
}) {
  const { session } = useAuth()
  const { formatPrice } = useCurrency()
  const { favorites, toggleFavorite } = useFavorites()
  const [records, setRecords] = useState<Order[]>([])
  const [loading, setLoading] = useState(mode !== 'transactions' && mode !== 'support')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  // Orders Filter state
  const [orderFilter, setOrderFilter] = useState<'all' | 'completed' | 'pending' | 'failed'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({})
  const [vaultCache, setVaultCache] = useState<Record<string, Record<string, { instructions: string; structured?: StructuredProductDelivery | null }>>>({})
  const [loadingVaultId, setLoadingVaultId] = useState<string | null>(null)

  const handleToggleOrderVault = async (orderId: string) => {
    const nextState = !expandedOrders[orderId]
    setExpandedOrders((prev) => ({ ...prev, [orderId]: nextState }))

    if (nextState && !vaultCache[orderId]) {
      setLoadingVaultId(orderId)
      try {
        const res = await cloudflareRequest<{ records: Order[] }>('/api/orders?purchases=true')
        const matching = res.records.find((o) => o.id === orderId)
        if (matching && matching.order_items) {
          const itemMap: Record<string, { instructions: string; structured?: StructuredProductDelivery | null }> = {}
          for (const item of matching.order_items) {
            if (item.product_entitlements) {
              itemMap[item.id] = item.product_entitlements
            }
          }
          setVaultCache((prev) => ({ ...prev, [orderId]: itemMap }))
        }
      } catch {
        // ignore network error
      } finally {
        setLoadingVaultId(null)
      }
    }
  }

  // Favorites state
  const [favoriteProducts, setFavoriteProducts] = useState<ProductItem[]>([])
  const [favLoading, setFavLoading] = useState(mode === 'favorites')

  // Support ticket form state
  const [supportSubject, setSupportSubject] = useState('')
  const [supportMessage, setSupportMessage] = useState('')
  const [supportOrderRef, setSupportOrderRef] = useState('')
  const [supportBusy, setSupportBusy] = useState(false)
  const [supportSuccess, setSupportSuccess] = useState('')
  const [supportError, setSupportError] = useState('')

  // Wallet state
  const [walletBalanceMinor, setWalletBalanceMinor] = useState<number | null>(null)

  const [searchParams] = useSearchParams()

  // Pre-fill support ticket from order reference in query parameter
  useEffect(() => {
    const ref = searchParams.get('ref')
    if (ref) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronize authenticated account state on navigation.
      setSupportOrderRef(ref)
      setSupportSubject(`Order Support: ${ref}`)
    }
  }, [searchParams])

  // Fetch orders and wallet from D1
  useEffect(() => {
    if (session && mode !== 'transactions' && mode !== 'support') {
      let active = true
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronize authenticated account state on navigation.
      setLoading(true)
      const isPurchasesMode = mode === 'purchases' || mode === 'downloads'
      const endpoint = isPurchasesMode ? '/api/orders?purchases=true' : '/api/orders'

      void cloudflareRequest<{ wallet: { balance_minor: number } }>('/api/wallet')
        .then((data) => {
          if (active && data.wallet) setWalletBalanceMinor(data.wallet.balance_minor)
        })
        .catch(() => { if (active) setWalletBalanceMinor(null) })
      
      void cloudflareRequest<{ records: Order[] }>(endpoint)
        .then(({ records }) => {
          if (active) {
            setRecords(
              isPurchasesMode
                ? records.filter(
                    (order) =>
                      order.payment_status === 'paid' &&
                      order.fulfillment_status === 'delivered'
                  )
                : records
            )
          }
        })
        .catch((problem) => {
          if (active) setError(problem.message)
        })
        .finally(() => {
          if (active) setLoading(false)
        })
      return () => {
        active = false
      }
    }
  }, [session, mode, attempt])

  // Fetch favorites product data if on favorites tab or overview
  useEffect(() => {
    if ((mode === 'favorites' || mode === 'overview') && favorites.length > 0) {
      let active = true
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Load saved products from the authenticated catalog.
      setFavLoading(true)
      void cloudflareRequest<{ records: ProductItem[] }>(`/api/products?ids=${favorites.slice(0, 50).join(',')}`)
        .then(({ records }) => {
          if (active) setFavoriteProducts(records || [])
        })
        .catch(() => {})
        .finally(() => {
          if (active) setFavLoading(false)
        })
      return () => {
        active = false
      }
    } else if (favorites.length === 0) {
      setFavoriteProducts([])
      setFavLoading(false)
    }
  }, [mode, favorites])

  const username = String(
    session?.user.user_metadata?.full_name ||
    session?.user.user_metadata?.name ||
    session?.user.email?.split('@')[0] ||
    'there'
  )

  const firstName = username.split(' ')[0]

  // Counts for metric cards and tabs
  const completedPurchases = records.filter(
    (r) => r.payment_status === 'paid' && r.fulfillment_status === 'delivered'
  ).length

  const pendingOrders = records.filter(
    (r) => r.payment_status === 'pending' || r.fulfillment_status === 'pending' || r.fulfillment_status === 'processing'
  ).length

  const failedOrders = records.filter(
    (r) => r.payment_status === 'failed' || r.fulfillment_status === 'failed' || r.payment_status === 'cancelled'
  ).length

  // Filtered orders based on selected tab and search query
  const filteredOrders = records.filter((order) => {
    if (orderFilter === 'completed') {
      if (order.fulfillment_status !== 'delivered' && order.payment_status !== 'paid') return false
    } else if (orderFilter === 'pending') {
      if (order.fulfillment_status === 'delivered' || order.payment_status === 'failed') return false
    } else if (orderFilter === 'failed') {
      if (order.payment_status !== 'failed' && order.fulfillment_status !== 'failed' && order.payment_status !== 'cancelled') return false
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      const matchesRef = order.reference.toLowerCase().includes(q)
      const matchesItems = order.order_items?.some((i) => i.product_name.toLowerCase().includes(q))
      return matchesRef || matchesItems
    }
    return true
  })

  // Submit Support Ticket to D1
  async function handleSupportSubmit(e: FormEvent) {
    e.preventDefault()
    if (supportBusy) return
    if (supportSubject.trim().length < 2) {
      setSupportError('Please provide a subject line (minimum 2 characters).')
      return
    }
    if (supportMessage.trim().length < 10) {
      setSupportError('Please explain your issue in detail (minimum 10 characters).')
      return
    }

    setSupportBusy(true)
    setSupportError('')
    setSupportSuccess('')

    const fullMessage = supportOrderRef.trim() 
      ? `[Order Ref: ${supportOrderRef.trim()}]\n\n${supportMessage.trim()}`
      : supportMessage.trim()

    try {
      const res = await cloudflareRequest<{ id: string; saved: boolean }>('/api/support', {
        subject: supportSubject.trim(),
        message: fullMessage,
      })
      setSupportSuccess(`Your support ticket has been received (Ticket ID: ${res.id.slice(0, 8).toUpperCase()}). A support specialist will respond to your verified email shortly.`)
      setSupportSubject('')
      setSupportMessage('')
      setSupportOrderRef('')
    } catch (err) {
      setSupportError(err instanceof Error ? err.message : 'Unable to submit support ticket. Please try again or email support@logspoll.com.')
    } finally {
      setSupportBusy(false)
    }
  }

  // -------------------------------------------------------------
  // VIEW: CUSTOMER SUPPORT & HELP
  // -------------------------------------------------------------
  if (mode === 'support') {
    return (
      <div className="customer-page-panel">
        <div className="dashboard-page-header">
          <div className="header-badge-row">
            <span className="dashboard-eyebrow">HELP &amp; ASSISTANCE</span>
          </div>
          <h1>Support &amp; Help Center</h1>
          <p className="dashboard-intro">
            Need help with an order, account credentials, or automated fulfillment? Our team is available 24/7.
          </p>
        </div>

        <div className="support-layout-grid">
          {/* Left Column: Submit Ticket Form */}
          <div className="support-form-card">
            <div className="card-header-with-icon">
              <div className="header-icon-box orange">
                <MessageSquare size={18} />
              </div>
              <div>
                <h2>Submit a Support Ticket</h2>
                <p>Logged directly to your verified customer profile.</p>
              </div>
            </div>

            <form onSubmit={handleSupportSubmit} className="account-form support-form">
              <fieldset disabled={supportBusy}>
                <label>
                  <span>Order Reference <small className="text-muted">(Optional)</small></span>
                  <input
                    type="text"
                    placeholder="e.g. LP-ORD-123456"
                    value={supportOrderRef}
                    onChange={(e) => setSupportOrderRef(e.target.value)}
                    maxLength={50}
                  />
                </label>

                <label>
                  <span>Subject <strong className="required">*</strong></span>
                  <input
                    type="text"
                    placeholder="Brief summary of your inquiry"
                    value={supportSubject}
                    onChange={(e) => setSupportSubject(e.target.value)}
                    required
                    minLength={2}
                    maxLength={200}
                  />
                </label>

                <label>
                  <span>Message Details <strong className="required">*</strong></span>
                  <textarea
                    rows={5}
                    placeholder="Please describe what you need assistance with in detail..."
                    value={supportMessage}
                    onChange={(e) => setSupportMessage(e.target.value)}
                    required
                    minLength={10}
                    maxLength={2000}
                    className="public-textarea"
                  />
                  <small className="field-hint">Minimum 10 characters. Never share raw passwords.</small>
                </label>

                <button type="submit" className="button button-orange" disabled={supportBusy}>
                  {supportBusy ? <RefreshCw size={16} className="spin-icon" /> : <Send size={16} />}
                  <span>{supportBusy ? 'Submitting Ticket…' : 'Submit Support Ticket'}</span>
                </button>
              </fieldset>
            </form>

            {supportSuccess && (
              <div className="form-success-banner" role="status">
                <CheckCircle2 size={18} />
                <p>{supportSuccess}</p>
              </div>
            )}
            {supportError && (
              <div className="form-error-banner" role="alert">
                <AlertCircle size={18} />
                <p>{supportError}</p>
              </div>
            )}
          </div>

          {/* Right Column: Direct Channels & FAQs */}
          <div className="support-info-column">
            {/* Quick Contact Box */}
            <div className="contact-methods-card">
              <h3>Direct Support Channels</h3>
              <p className="card-subtext">Immediate assistance for urgent orders and inquiries.</p>

              <div className="contact-channel-list">
                <a href="mailto:support@logspoll.com" className="channel-item">
                  <div className="channel-icon email">
                    <Send size={16} />
                  </div>
                  <div className="channel-details">
                    <strong>Official Email</strong>
                    <span>support@logspoll.com</span>
                  </div>
                  <ArrowRight size={14} className="channel-arrow" />
                </a>

                <a href="https://wa.me/2348000000000" target="_blank" rel="noopener noreferrer" className="channel-item">
                  <div className="channel-icon whatsapp">
                    <MessageSquare size={16} />
                  </div>
                  <div className="channel-details">
                    <strong>WhatsApp Priority Desk</strong>
                    <span>Instant chat with support agent</span>
                  </div>
                  <ArrowRight size={14} className="channel-arrow" />
                </a>

                <div className="sla-badge-box">
                  <Clock size={15} />
                  <span>Average response time: <strong>under 15 minutes</strong></span>
                </div>
              </div>
            </div>

            {/* Quick FAQs */}
            <div className="dashboard-faq-card">
              <h3>Frequently Asked Questions</h3>
              <div className="faq-item-list">
                <details className="faq-accordion-item">
                  <summary>How do I access my purchased digital items?</summary>
                  <p>All paid, delivered products immediately appear in your <strong>Downloads &amp; Vault</strong> tab with complete credentials and instructions.</p>
                </details>
                <details className="faq-accordion-item">
                  <summary>What if my order is marked pending?</summary>
                  <p>Pending orders are automatically synchronized with fulfillment networks every 60 seconds. If not completed within 10 minutes, submit a ticket above.</p>
                </details>
                <details className="faq-accordion-item">
                  <summary>How are credentials structured?</summary>
                  <p>Credentials follow standard industry format: <code>Username|Password|2FA</code> or token format as specified in the product description.</p>
                </details>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // -------------------------------------------------------------
  // VIEW: FAVORITES & SAVED PRODUCTS
  // -------------------------------------------------------------
  if (mode === 'favorites') {
    return (
      <div className="customer-page-panel">
        <div className="dashboard-page-header">
          <div className="header-badge-row">
            <span className="dashboard-eyebrow">YOUR WISHLIST</span>
          </div>
          <h1>Saved Favorites</h1>
          <p className="dashboard-intro">
            Keep track of digital products, tools, and accounts you want to purchase later.
          </p>
        </div>

        {favLoading ? (
          <div className="dashboard-loading-state">
            <RefreshCw size={24} className="spin-icon" />
            <p>Loading your saved favorites…</p>
          </div>
        ) : favoriteProducts.length === 0 ? (
          <Empty
            icon={Heart}
            title="No saved favorites yet"
            text="Explore the marketplace to bookmark essential digital products and accounts for quick access."
            actionLabel="Explore Marketplace"
            actionLink="/marketplace"
          />
        ) : (
          <div className="favorites-product-grid">
            {favoriteProducts.map((product) => (
              <article className="favorite-card" key={product.id}>
                <div className="fav-card-image-box">
                  <ProductArtwork
                    name={product.name}
                    category={product.category_name || 'Digital'}
                    path={product.image_path}
                    images={product.supplier_image_urls}
                  />
                  {product.server_number ? (
                    <span className={`server-badge server-badge-${product.server_number}`}>
                      Server {product.server_number}{product.server_number === 4 ? ' (AI Tools)' : ''}
                    </span>
                  ) : null}
                </div>

                <div className="fav-card-body">
                  <span className="product-category-badge">
                    {product.category_name || 'Digital Essential'}
                  </span>
                  <h3 className="fav-card-title">
                    <Link to={`/products/${product.slug}`}>{product.name}</Link>
                  </h3>

                  <div className="fav-card-pricing">
                    <strong className="fav-price">{formatPrice(product.price_minor)}</strong>
                    <span className={`stock-pill ${product.available_quantity > 0 ? 'in-stock' : 'out-of-stock'}`}>
                      {product.available_quantity > 0 ? `${product.available_quantity} in stock` : 'Out of stock'}
                    </span>
                  </div>

                  <div className="fav-card-actions">
                    <Link to={`/products/${product.slug}`} className="button button-orange button-small">
                      <span>View in Store</span>
                      <ArrowRight size={14} />
                    </Link>
                    <button
                      type="button"
                      className="button button-outline button-small button-remove-fav"
                      onClick={() => toggleFavorite(product.id)}
                      title="Remove from favorites"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    )
  }

  // -------------------------------------------------------------
  // VIEW: MY DOWNLOADS / DELIVERED PURCHASES
  // -------------------------------------------------------------
  if (mode === 'purchases' || mode === 'downloads') {
    return (
      <div className="customer-page-panel">
        <div className="dashboard-page-header">
          <div className="header-badge-row">
            <span className="dashboard-eyebrow">SECURE VAULT</span>
          </div>
          <h1>My Downloads &amp; Purchased Products</h1>
          <p className="dashboard-intro">
            Instant delivery vault for your paid, verified, and delivered digital assets and credentials.
          </p>
        </div>

        {loading ? (
          <div className="dashboard-loading-state">
            <RefreshCw size={24} className="spin-icon" />
            <p>Loading your delivery vault…</p>
          </div>
        ) : error ? (
          <div role="alert" className="error-retry-card">
            <AlertCircle size={20} className="text-red-500" />
            <p className="form-error">{error}</p>
            <button className="button button-outline button-small" onClick={() => setAttempt(attempt + 1)}>
              Retry Loading
            </button>
          </div>
        ) : records.length === 0 ? (
          <Empty
            icon={Download}
            title="No delivered purchases yet"
            text="Completed and verified purchases will appear here with instant access details and credentials."
            actionLabel="Browse Marketplace"
            actionLink="/marketplace"
          />
        ) : (
          <div className="purchases-target-list">
            {records.map((order) => {
              const items = order.order_items || []
              const isExpanded = !!expandedOrders[order.id]

              return (
                <article className="target-purchase-card" key={order.id}>
                  {/* Top: Icon + Status */}
                  <div className="target-purchase-top">
                    <div className="target-purchase-icon-box">
                      <Download size={20} />
                    </div>
                    <span className="target-purchase-status-badge">
                      <CheckCircle2 size={13} /> DELIVERED
                    </span>
                  </div>

                  {/* Category Pill */}
                  <div className="target-purchase-meta">
                    <span className="target-purchase-cat-pill">
                      {items[0]?.product_name ? items[0].product_name.split(' ')[0].toUpperCase() : 'DIGITAL ASSET'}
                    </span>
                  </div>

                  {/* Title */}
                  <h3 className="target-purchase-title">
                    {items.map((i) => i.product_name).join(', ') || `Order ${order.reference}`}
                  </h3>

                  {/* Date */}
                  <span className="target-purchase-date">
                    <Clock size={12} className="inline-icon" /> {new Date(order.created_at).toLocaleDateString(undefined, {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>

                  {/* Pricing Row */}
                  <div className="target-purchase-pricing">
                    <div className="pricing-left">
                      <span className="paid-amount-label">PAID AMOUNT</span>
                      <strong className="paid-amount-val">{formatPrice(order.total_minor)}</strong>
                    </div>
                    <span className="target-order-ref-pill">
                      Ref: {order.reference}
                    </span>
                  </div>

                  {/* Security Notice */}
                  <div className="target-purchase-notice">
                    <span className="notice-icon">ⓘ</span>
                    <span>Credentials format: see product details for format (e.g. Email|Password|2FA)</span>
                  </div>

                  {/* Expand / Hide Details Action */}
                  <button
                    type="button"
                    className="target-purchase-btn"
                    onClick={() =>
                      setExpandedOrders((prev) => ({
                        ...prev,
                        [order.id]: !prev[order.id],
                      }))
                    }
                  >
                    <span>{isExpanded ? 'Hide Access Credentials' : 'View Access Details & Credentials'}</span>
                    {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>

                  {/* Expanded Vault Details */}
                  {isExpanded && (
                    <div className="target-purchase-expanded-vault">
                      {items.map((item) => (
                        <div key={item.id} className="vault-item-block">
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                            <h4 className="vault-item-name" style={{ margin: 0 }}>
                              {item.product_name} <span className="item-qty">× {item.quantity}</span>
                            </h4>
                            {item.server_number ? (
                              <span className={`server-badge server-badge-${item.server_number}`} style={{ fontSize: '0.7rem', padding: '2px 8px' }}>
                                Server {item.server_number}{item.server_number === 4 ? ' (AI Tools)' : ''}
                              </span>
                            ) : null}
                          </div>
                          {item.product_entitlements?.instructions ? (
                            <DeliveryVaultCard
                              structured={item.product_entitlements.structured}
                              rawInstructions={item.product_entitlements.instructions}
                              productName={item.product_name}
                              categoryName={item.category_name}
                              orderRef={order.reference}
                              orderId={order.id}
                            />
                          ) : (
                            <p className="delivery-pending-note">
                              Access details are being processed or delivered via secure email. Contact support if needed.
                            </p>
                          )}
                          <ReviewForm itemId={item.id} />
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                    <Link
                      to={`/dashboard/support?ref=${encodeURIComponent(order.reference)}`}
                      className="button button-outline button-small"
                      style={{ fontSize: '0.75rem', gap: 6 }}
                    >
                      <HelpCircle size={13} />
                      <span>Need Help With This Order?</span>
                    </Link>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // -------------------------------------------------------------
  // VIEW: MY ORDERS (PENDING, COMPLETED, FAILED)
  // -------------------------------------------------------------
  if (mode === 'orders') {
    return (
      <div className="customer-page-panel">
        <div className="dashboard-page-header">
          <div className="header-badge-row">
            <span className="dashboard-eyebrow">ORDER RECONCILIATION</span>
          </div>
          <h1>My Orders</h1>
          <p className="dashboard-intro">
            Track payment reconciliation, automated processing, and order fulfillment status.
          </p>
        </div>

        {/* Filter Tabs and Search Bar */}
        <div className="orders-toolbar">
          <div className="orders-filter-tabs" role="tablist">
            <button
              type="button"
              className={`order-tab-btn ${orderFilter === 'all' ? 'active' : ''}`}
              onClick={() => setOrderFilter('all')}
            >
              All Orders <span className="tab-badge">{records.length}</span>
            </button>
            <button
              type="button"
              className={`order-tab-btn ${orderFilter === 'completed' ? 'active' : ''}`}
              onClick={() => setOrderFilter('completed')}
            >
              Completed <span className="tab-badge success">{completedPurchases}</span>
            </button>
            <button
              type="button"
              className={`order-tab-btn ${orderFilter === 'pending' ? 'active' : ''}`}
              onClick={() => setOrderFilter('pending')}
            >
              Pending <span className="tab-badge warning">{pendingOrders}</span>
            </button>
            <button
              type="button"
              className={`order-tab-btn ${orderFilter === 'failed' ? 'active' : ''}`}
              onClick={() => setOrderFilter('failed')}
            >
              Failed / Cancelled <span className="tab-badge danger">{failedOrders}</span>
            </button>
          </div>

          <div className="orders-search-box">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search by order ref or product..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="dashboard-loading-state">
            <RefreshCw size={24} className="spin-icon" />
            <p>Loading your orders…</p>
          </div>
        ) : error ? (
          <div role="alert" className="error-retry-card">
            <AlertCircle size={20} className="text-red-500" />
            <p className="form-error">{error}</p>
            <button className="button button-outline button-small" onClick={() => setAttempt(attempt + 1)}>
              Retry Loading
            </button>
          </div>
        ) : filteredOrders.length === 0 ? (
          <Empty
            icon={ShoppingBag}
            title={searchQuery ? 'No matching orders found' : 'No orders in this category'}
            text={searchQuery ? 'Try searching with a different order reference or term.' : 'Your placed orders will be tracked here.'}
            actionLabel="Browse Marketplace"
            actionLink="/marketplace"
          />
        ) : (
          <div className="order-cards-list">
            {filteredOrders.map((order) => {
              const primaryItem = order.order_items?.[0]
              const isDelivered = order.fulfillment_status === 'delivered' && order.payment_status === 'paid'
              const isPending = order.fulfillment_status === 'pending' || order.payment_status === 'pending' || order.fulfillment_status === 'processing'
              const isExpanded = !!expandedOrders[order.id]
              const itemsSummary = order.order_items?.map((i) => i.product_name).join(', ') || `Order ${order.reference}`
              const categoryLabel = primaryItem?.category_name || (primaryItem?.product_name ? primaryItem.product_name.split(' ')[0].toUpperCase() : 'DIGITAL')

              return (
                <article className="order-compact-card" key={order.id}>
                  <div className="order-compact-main">
                    {/* Category Brand Icon */}
                    <div className="order-compact-icon-box">
                      <BrandIcon 
                        name={primaryItem?.product_name || order.reference} 
                        category={primaryItem?.category_name || ''} 
                        size={24} 
                      />
                    </div>

                    {/* Center Information */}
                    <div className="order-compact-body">
                      <div className="order-compact-topline">
                        <span className="order-compact-cat-badge">{categoryLabel}</span>
                        <span className="order-compact-ref" title={order.reference}>Ref: {order.reference}</span>
                        <span className="order-compact-date">
                          <Clock size={12} className="inline-icon" />
                          {new Date(order.created_at).toLocaleDateString(undefined, {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric'
                          })}
                        </span>
                      </div>

                      <h3 className="order-compact-title" title={itemsSummary}>
                        {itemsSummary}
                      </h3>

                      <div className="order-compact-meta-row">
                        <span className={`status-pill payment-${order.payment_status}`}>
                          {order.payment_status === 'paid' && <CheckCircle2 size={12} />}
                          {order.payment_status === 'pending' && <Clock size={12} />}
                          {(order.payment_status === 'failed' || order.payment_status === 'cancelled') && <XCircle size={12} />}
                          {order.payment_status === 'refunded' && <ShieldCheck size={12} />}
                          <span className="capitalize">{order.payment_status}</span>
                        </span>

                        <span className={`status-pill delivery-${order.fulfillment_status}`}>
                          {order.fulfillment_status === 'delivered' && <CheckCircle2 size={12} />}
                          {order.fulfillment_status === 'processing' && <RefreshCw size={12} className="spin-slow" />}
                          {order.fulfillment_status === 'pending' && <Clock size={12} />}
                          {order.fulfillment_status === 'failed' && <AlertCircle size={12} />}
                          <span className="capitalize">{order.fulfillment_status}</span>
                        </span>
                      </div>
                    </div>

                    {/* Right Price & View Details Action */}
                    <div className="order-compact-actions">
                      <strong className="order-compact-price">{formatPrice(order.total_minor)}</strong>
                      <button
                        type="button"
                        className={`button button-small ${isExpanded ? 'button-outline' : 'button-dark'} order-details-toggle`}
                        onClick={() => handleToggleOrderVault(order.id)}
                      >
                        <span>{isExpanded ? 'Hide Details' : 'View Details'}</span>
                        {loadingVaultId === order.id ? (
                          <RefreshCw size={12} className="spin-icon" />
                        ) : isExpanded ? (
                          <ChevronUp size={12} />
                        ) : (
                          <ChevronDown size={12} />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Details Section */}
                  {isExpanded && (
                    <div className="order-compact-expanded">
                      {/* Item Breakdown */}
                      {order.order_items && order.order_items.length > 0 && (
                        <div className="expanded-items-list">
                          <span className="expanded-section-title">Purchased Items ({order.order_items.length})</span>
                          {order.order_items.map((item) => (
                            <div key={item.id} className="expanded-item-row">
                              <div className="expanded-item-info">
                                <strong>{item.product_name}</strong>
                                <span className="item-meta">Qty: {item.quantity} · Unit Price: {formatPrice(item.unit_price_minor ?? 0)}</span>
                              </div>
                              <strong className="expanded-item-total">
                                {formatPrice((item.unit_price_minor ?? 0) * item.quantity)}
                              </strong>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Delivery Details */}
                      {isDelivered ? (
                        <div className="expanded-vault-container">
                          <span className="expanded-section-title">Digital Credentials &amp; Access Details</span>
                          {loadingVaultId === order.id ? (
                            <div className="expanded-loading">
                              <RefreshCw size={16} className="spin-icon" />
                              <span>Retrieving secure credentials from delivery vault…</span>
                            </div>
                          ) : (
                            (order.order_items || []).map((item) => {
                              const ent = vaultCache[order.id]?.[item.id] || item.product_entitlements
                              return (
                                <div key={item.id} className="expanded-vault-item">
                                  <h4>{item.product_name}</h4>
                                  {ent?.instructions ? (
                                    <DeliveryVaultCard
                                      structured={ent.structured}
                                      rawInstructions={ent.instructions}
                                      productName={item.product_name}
                                      categoryName={item.category_name}
                                      orderRef={order.reference}
                                      orderId={order.id}
                                    />
                                  ) : (
                                    <p className="delivery-pending-note">
                                      Credentials delivered securely. View in your <Link to="/dashboard/purchases">Digital Delivery Vault</Link>.
                                    </p>
                                  )}
                                  <ReviewForm itemId={item.id} />
                                </div>
                              )
                            })
                          )}
                        </div>
                      ) : isPending ? (
                        <div className="expanded-status-notice pending">
                          <Clock size={16} className="spin-slow" />
                          <div>
                            <strong>Fulfillment In Progress</strong>
                            <p>Your payment is verified and our automated system is provisioning your digital products from verified servers. Delivery typically takes seconds to a few minutes.</p>
                          </div>
                        </div>
                      ) : (
                        <div className="expanded-status-notice failed">
                          <AlertCircle size={16} />
                          <div>
                            <strong>Order Status: {order.payment_status} / {order.fulfillment_status}</strong>
                            <p>If you made a payment that hasn't reflected, or need manual delivery assistance, our support team is available 24/7.</p>
                          </div>
                        </div>
                      )}

                      {/* Support & Vault Links */}
                      <div className="expanded-footer-actions">
                        <Link
                          to={`/dashboard/support?ref=${encodeURIComponent(order.reference)}`}
                          className="button button-outline button-small"
                        >
                          <HelpCircle size={13} />
                          <span>Need Help With This Order?</span>
                        </Link>
                        {isDelivered && (
                          <Link to="/dashboard/purchases" className="button button-outline button-small">
                            <Download size={13} />
                            <span>Open Delivery Vault</span>
                          </Link>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // -------------------------------------------------------------
  // VIEW: DEFAULT OVERVIEW
  // -------------------------------------------------------------
  return (
    <div className="customer-overview-container">
      {/* Personalized Welcome Header */}
      <div className="dashboard-welcome-banner">
        <div className="welcome-content">
          <div className="welcome-greeting-row">
            <h1>Welcome back, {firstName}</h1>
            <span className="welcome-verified-badge">
              <ShieldCheck size={14} /> Verified Customer
            </span>
          </div>
          <p className="welcome-subtext">
            Monitor your wallet balance, track live orders, and access delivered digital assets.
          </p>
        </div>

        <div className="welcome-actions">
          <Link to="/dashboard/wallet" className="button button-orange button-small">
            <Wallet size={16} />
            <span>Fund Wallet</span>
          </Link>
          <Link to="/marketplace" className="button button-outline button-small">
            <PackageOpen size={16} />
            <span>Browse Shop</span>
          </Link>
        </div>
      </div>

      {/* 5 Financial and Activity Metric Cards */}
      <div className="overview-stats-grid">
        {/* Wallet Balance Card */}
        <div className="overview-stat-card highlight-card">
          <div className="stat-card-header">
            <span className="stat-label">Wallet Balance</span>
            <div className="stat-icon-wrapper orange">
              <Wallet size={18} />
            </div>
          </div>
          <strong className="stat-number">
            {walletBalanceMinor === null ? '₦0.00' : new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(walletBalanceMinor / 100)}
          </strong>
          <div className="stat-card-footer">
            <span className="stat-badge-soft">Available NGN</span>
            <Link to="/dashboard/wallet" className="stat-link">Fund Wallet →</Link>
          </div>
        </div>

        {/* Total Orders Card */}
        <div className="overview-stat-card">
          <div className="stat-card-header">
            <span className="stat-label">Total Orders</span>
            <div className="stat-icon-wrapper blue">
              <ShoppingBag size={18} />
            </div>
          </div>
          <strong className="stat-number">{loading ? '—' : records.length}</strong>
          <div className="stat-card-footer">
            <span className="stat-subtext">Lifetime purchases</span>
            <Link to="/dashboard/orders" className="stat-link">View All →</Link>
          </div>
        </div>

        {/* Completed Purchases Card */}
        <div className="overview-stat-card">
          <div className="stat-card-header">
            <span className="stat-label">Completed</span>
            <div className="stat-icon-wrapper green">
              <CheckCircle2 size={18} />
            </div>
          </div>
          <strong className="stat-number">{loading ? '—' : completedPurchases}</strong>
          <div className="stat-card-footer">
            <span className="stat-subtext">Delivered &amp; active</span>
            <Link to="/dashboard/orders" className="stat-link">Delivered →</Link>
          </div>
        </div>

        {/* Pending Orders Card */}
        <div className="overview-stat-card">
          <div className="stat-card-header">
            <span className="stat-label">Pending Orders</span>
            <div className="stat-icon-wrapper amber">
              <Clock size={18} />
            </div>
          </div>
          <strong className="stat-number">{loading ? '—' : pendingOrders}</strong>
          <div className="stat-card-footer">
            <span className="stat-subtext">Awaiting fulfillment</span>
            <Link to="/dashboard/orders" className="stat-link">Track →</Link>
          </div>
        </div>

        {/* Digital Assets Card */}
        <div className="overview-stat-card">
          <div className="stat-card-header">
            <span className="stat-label">Digital Assets</span>
            <div className="stat-icon-wrapper purple">
              <Download size={18} />
            </div>
          </div>
          <strong className="stat-number">{loading ? '—' : completedPurchases}</strong>
          <div className="stat-card-footer">
            <span className="stat-subtext">Saved in vault</span>
            <Link to="/dashboard/purchases" className="stat-link">Open Vault →</Link>
          </div>
        </div>
      </div>

      {/* Recent Orders Section */}
      <section className="dashboard-section-block">
        <div className="section-header-row">
          <div>
            <h2>Recent Orders</h2>
            <p className="section-subtitle">Real-time payment and order fulfillment status.</p>
          </div>
          <Link to="/dashboard/orders" className="text-link">
            View All ({records.length}) →
          </Link>
        </div>

        {loading ? (
          <div className="dashboard-loading-state">
            <RefreshCw size={20} className="spin-icon" />
            <p>Loading recent orders…</p>
          </div>
        ) : records.length === 0 ? (
          <div className="empty-overview-card">
            <ShoppingBag size={24} className="empty-icon" />
            <p>No orders recorded for this account yet.</p>
            <Link to="/marketplace" className="button button-outline button-small">Browse Marketplace</Link>
          </div>
        ) : (
          <div className="order-cards-list">
            {records.slice(0, 5).map((order) => {
              const primaryItem = order.order_items?.[0]
              const itemsSummary = order.order_items?.map((i) => i.product_name).join(', ') || `Order ${order.reference}`
              const categoryLabel = primaryItem?.category_name || (primaryItem?.product_name ? primaryItem.product_name.split(' ')[0].toUpperCase() : 'DIGITAL')

              return (
                <article className="order-compact-card" key={order.id}>
                  <div className="order-compact-main">
                    <div className="order-compact-icon-box">
                      <BrandIcon 
                        name={primaryItem?.product_name || order.reference} 
                        category={primaryItem?.category_name || ''} 
                        size={24} 
                      />
                    </div>
                    <div className="order-compact-body">
                      <div className="order-compact-topline">
                        <span className="order-compact-cat-badge">{categoryLabel}</span>
                        <span className="order-compact-ref">Ref: {order.reference}</span>
                        <span className="order-compact-date">
                          <Clock size={11} className="inline-icon" />
                          {new Date(order.created_at).toLocaleDateString(undefined, {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric'
                          })}
                        </span>
                      </div>
                      <h3 className="order-compact-title">{itemsSummary}</h3>
                      <div className="order-compact-meta-row">
                        <span className={`status-pill payment-${order.payment_status}`}>
                          {order.payment_status === 'paid' && <CheckCircle2 size={12} />}
                          {order.payment_status === 'pending' && <Clock size={12} />}
                          {(order.payment_status === 'failed' || order.payment_status === 'cancelled') && <XCircle size={12} />}
                          {order.payment_status === 'refunded' && <ShieldCheck size={12} />}
                          <span className="capitalize">{order.payment_status}</span>
                        </span>
                        <span className={`status-pill delivery-${order.fulfillment_status}`}>
                          {order.fulfillment_status === 'delivered' && <CheckCircle2 size={12} />}
                          {order.fulfillment_status === 'processing' && <RefreshCw size={12} className="spin-slow" />}
                          {order.fulfillment_status === 'pending' && <Clock size={12} />}
                          {order.fulfillment_status === 'failed' && <AlertCircle size={12} />}
                          <span className="capitalize">{order.fulfillment_status}</span>
                        </span>
                      </div>
                    </div>
                    <div className="order-compact-actions">
                      <strong className="order-compact-price">{formatPrice(order.total_minor)}</strong>
                      <Link
                        to="/dashboard/orders"
                        className="button button-small button-outline order-details-toggle"
                      >
                        <span>View Details</span>
                        <ArrowRight size={12} />
                      </Link>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {/* Quick Action Shortcuts */}
      <section className="dashboard-quick-shortcuts">
        <h2>Quick Shortcuts</h2>
        <div className="shortcuts-grid">
          <Link to="/dashboard/wallet" className="shortcut-card">
            <Wallet size={20} className="shortcut-icon" />
            <div>
              <strong>Fund Wallet</strong>
              <small>Deposit funds via Bachs gateway</small>
            </div>
            <ArrowRight size={15} />
          </Link>

          <Link to="/marketplace" className="shortcut-card">
            <PackageOpen size={20} className="shortcut-icon" />
            <div>
              <strong>Shop Products</strong>
              <small>Browse published digital products</small>
            </div>
            <ArrowRight size={15} />
          </Link>

          <Link to="/dashboard/orders" className="shortcut-card">
            <ShoppingBag size={20} className="shortcut-icon" />
            <div>
              <strong>Order History</strong>
              <small>Reconcile fulfillment &amp; payments</small>
            </div>
            <ArrowRight size={15} />
          </Link>

          <Link to="/dashboard/purchases" className="shortcut-card">
            <Download size={20} className="shortcut-icon" />
            <div>
              <strong>Delivery Vault</strong>
              <small>Delivered credentials &amp; licenses</small>
            </div>
            <ArrowRight size={15} />
          </Link>

          <Link to="/dashboard/support" className="shortcut-card">
            <HelpCircle size={20} className="shortcut-icon" />
            <div>
              <strong>24/7 Support Desk</strong>
              <small>Submit ticket or get assistance</small>
            </div>
            <ArrowRight size={15} />
          </Link>

          <Link to="/dashboard/profile" className="shortcut-card">
            <UserRound size={20} className="shortcut-icon" />
            <div>
              <strong>Account Profile</strong>
              <small>Manage personal details &amp; access</small>
            </div>
            <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      {/* Trending Now Section */}
      <TrendingSection />
    </div>
  )
}

function TrendingSection() {
  const { formatPrice } = useCurrency()
  const [products, setProducts] = useState<ProductItem[]>([])

  useEffect(() => {
    let active = true
    void cloudflareRequest<{ records: ProductItem[] }>('/api/products?page=1')
      .then((data) => {
        if (active) setProducts(data.records.slice(0, 3))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  if (!products.length) return null

  return (
    <section className="trending-section" aria-label="Trending Products">
      <div className="trending-heading">
        <div>
          <h2>Trending Essentials 🔥</h2>
          <p className="stat-card-subtext">Popular digital tools and accounts on LogsPoll this week</p>
        </div>
        <Link className="text-link" to="/marketplace">
          View All Products →
        </Link>
      </div>

      <div className="trending-grid">
        {products.map((product, index) => {
          const rankClass = index === 0 ? 'trending-rank-1' : index === 1 ? 'trending-rank-2' : 'trending-rank-3'
          return (
            <article className="trending-card" key={product.id}>
              <span className={`trending-rank-tag ${rankClass}`}>
                <Star size={11} className="inline-icon" /> #{index + 1}
              </span>

              <Link to={`/products/${product.slug}`} className="live-product-icon">
                <ProductArtwork
                  name={product.name}
                  category={product.category_name || 'Digital'}
                  path={product.image_path}
                  images={product.supplier_image_urls}
                />
              </Link>

              <div className="trending-card-body">
                <div className="product-badges-row">
                  <span className="product-category-badge">{product.category_name || 'Tool'}</span>
                  {product.server_number ? (
                    <span className={`server-badge server-badge-${product.server_number}`}>
                      Server {product.server_number}{product.server_number === 4 ? ' (AI Tools)' : ''}
                    </span>
                  ) : null}
                </div>

                <h3>
                  <Link to={`/products/${product.slug}`}>{product.name}</Link>
                </h3>

                <div className="trending-card-footer">
                  <strong className="product-price">{formatPrice(product.price_minor)}</strong>
                  <Link to={`/products/${product.slug}`} className="text-link">
                    View Details →
                  </Link>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function Empty({ 
  icon: Icon = PackageOpen,
  title, 
  text, 
  actionLabel = 'Browse Marketplace', 
  actionLink = '/marketplace' 
}: { 
  icon?: typeof PackageOpen
  title: string
  text: string
  actionLabel?: string
  actionLink?: string
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon-circle">
        <Icon size={32} />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      <Link className="button button-orange button-small" to={actionLink}>
        {actionLabel} →
      </Link>
    </div>
  )
}

export function Profile() {
  const { session } = useAuth()
  const [name, setName] = useState(String(session?.user.user_metadata?.full_name || session?.user.user_metadata?.name || ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (name.trim().length < 2) {
      setError('Please enter at least 2 characters for your name.')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await cloudflareAuth('update-user', { name: name.trim() })
      setMessage('Profile updated successfully.')
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Unable to update your profile.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="customer-page-panel profile-page">
      <div className="dashboard-page-header">
        <div className="header-badge-row">
          <span className="dashboard-eyebrow">IDENTITY &amp; ACCOUNT</span>
        </div>
        <h1>Profile &amp; Account Settings</h1>
        <p className="dashboard-intro">Manage your personal information, email address, and account preferences.</p>
      </div>

      <div className="profile-columns">
        <div className="profile-details-card">
          <div className="card-title-row">
            <UserRound size={20} className="title-icon" />
            <h2>Personal Information</h2>
          </div>
          
          <form className="account-form profile-form" onSubmit={save}>
            <fieldset disabled={busy}>
              <label>
                <span>Full Name</span>
                <input
                  name="full_name"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={120}
                  placeholder="Your full name"
                />
              </label>

              <label>
                <span>Verified Email Address</span>
                <div className="verified-email-field">
                  <input type="email" value={session?.user.email ?? ''} readOnly />
                  <span className="email-verified-pill">
                    <Check size={12} /> Verified
                  </span>
                </div>
                <small className="field-hint">Email is tied to your verified login session and security alerts.</small>
              </label>

              <button className="button button-orange" type="submit" disabled={busy}>
                {busy ? <RefreshCw size={15} className="spin-icon" /> : null}
                <span>{busy ? 'Saving Changes…' : 'Save Profile Changes'}</span>
              </button>
            </fieldset>
          </form>

          {error && <p role="alert" className="form-error">{error}</p>}
          {message && <p role="status" className="form-success">{message}</p>}
        </div>

        <AccountSettings embedded />
      </div>
    </section>
  )
}

export function AccountSettings({ embedded = false }: { embedded?: boolean }) {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function reset() {
    if (!session?.user.email || busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await cloudflareAuth('email-otp/request-password-reset', { email: session.user.email })
      navigate('/reset-password', { state: { email: session.user.email, sentAt: Date.now() } })
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Unable to request password reset.')
    } finally {
      setBusy(false)
    }
  }

  async function acceptAdmin() {
    setBusy(true)
    setError('')
    try {
      await cloudflareRequest('/api/account/admin-enrollment', {})
      window.location.assign('/admin')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enrollment unavailable.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={embedded ? 'profile-security-card' : 'customer-page-panel'}>
      {!embedded && (
        <div className="dashboard-page-header">
          <div className="header-badge-row">
            <span className="dashboard-eyebrow">SECURITY</span>
          </div>
          <h1>Security &amp; Password Settings</h1>
          <p className="dashboard-intro">Manage password authentication, security, and administrative access.</p>
          <Link className="text-link" to="/dashboard/profile">
            ← Back to personal details
          </Link>
        </div>
      )}

      <div className="security-settings-box">
        <div className="card-title-row">
          <Key size={20} className="title-icon" />
          <h2>Security &amp; Password</h2>
        </div>

        <p className="security-desc">
          Password updates require a secure single-use email verification code sent directly to your verified email address.
        </p>

        <div className="security-action-buttons">
          <button className="button button-orange" onClick={reset} disabled={busy} type="button">
            {busy ? <RefreshCw size={15} className="spin-icon" /> : <Key size={15} />}
            <span>{busy ? 'Sending Code…' : 'Send Password Reset Code'}</span>
          </button>

          <button className="button button-outline" onClick={() => void acceptAdmin()} disabled={busy} type="button">
            Accept Administrator Invitation
          </button>
        </div>

        {message && <p role="status" className="form-success">{message}</p>}
        {error && <p role="alert" className="form-error">{error}</p>}

        <div className="security-tips-box">
          <ShieldCheck size={16} />
          <div>
            <strong>Security Recommendation</strong>
            <p>Always verify the URL is <code>https://logspoll.com</code> before entering your password or OTP code.</p>
          </div>
        </div>
      </div>
    </section>
  )
}
