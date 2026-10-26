import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, NavLink, Outlet, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { 
  PackageOpen, House, UserRound, 
  ShoppingBag, ShieldCheck, ArrowRight, Heart, 
  Key, Check, Download, HelpCircle, Search, 
  Clock, CheckCircle2, XCircle, AlertCircle, MessageSquare,
  ChevronDown, ChevronUp, Wallet, RefreshCw, Store,
  Sun, Moon, Bell, Eye, EyeOff, Plus, ChevronRight, ArrowDown, ArrowUp, Send, LogOut
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { cloudflareAuth, cloudflareRequest } from '../lib/cloudflare-auth'
import { ProductArtwork } from '../components/ProductArtwork'
import { BrandIcon } from '../components/BrandIcon'
import { ReviewForm } from '../components/Reviews'
import { DeliveryVaultCard } from '../components/DeliveryVaultCard'
import { useCurrency } from '../lib/currency'
import { useFavorites } from '../lib/favorites'
import { DashboardProvider, useDashboard } from './DashboardContext'
import { FundWalletSheet } from '../components/FundWalletSheet'
import { TransactionDetailsSheet } from '../components/TransactionDetailsSheet'
import type { WalletTransactionItem } from '../components/TransactionDetailsSheet'
import type { StructuredProductDelivery } from '../lib/delivery-parser'
import type { Order } from '../lib/customer-data'
import { getOrderDeliveryStatus } from '../lib/order-status'
import { WhatsAppSupportButton } from '../components/WhatsAppSupportButton'
import { WhatsAppSupportModal } from '../components/WhatsAppSupportModal'

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

function DashboardShellInner() {
  const { session } = useAuth()
  const location = useLocation()
  const { theme, toggleTheme, toastMessage, showToast } = useDashboard()
  const [signingOut, setSigningOut] = useState(false)

  async function handleLogout() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await cloudflareAuth('sign-out', {})
      window.location.assign('/login')
    } catch {
      window.location.assign('/login')
    } finally {
      setSigningOut(false)
    }
  }

  const displayName = String(
    session?.user.user_metadata?.full_name || 
    session?.user.user_metadata?.name || 
    session?.user.email?.split('@')[0] || 
    'Customer'
  )

  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || 'LP'

  const getSectionTitle = () => {
    const p = location.pathname
    if (p === '/dashboard' || p === '/dashboard/') return 'Dashboard'
    if (p.includes('/wallet') || p.includes('/transactions')) return 'My Wallet'
    if (p.includes('/orders')) return 'My Orders'
    if (p.includes('/purchases') || p.includes('/downloads')) return 'Delivery Vault'
    if (p.includes('/favorites') || p.includes('/saved')) return 'Saved Items'
    if (p.includes('/profile') || p.includes('/settings')) return 'Account Settings'
    if (p.includes('/support')) return 'Support & Help'
    return 'Dashboard'
  }

  return (
    <div className={`fintech-app ${theme === 'dark' ? 'dark' : ''}`}>
      {/* Desktop Persistent Sidebar (>= 1000px) */}
      <aside className="fintech-sidebar" aria-label="Desktop navigation">
        <Link to="/dashboard" className="fintech-logo" aria-label="LogsPoll Dashboard">
          <img
            src="/logo-dark.png"
            alt="LogsPoll"
            style={{ height: 32, width: 'auto', display: 'block' }}
          />
        </Link>

        <div className="fintech-side-heading">MY ACCOUNT</div>

        <nav className="fintech-side-links" aria-label="Account navigation">
          <NavLink
            to="/dashboard"
            end
            className={({ isActive }) => `side-nav-link ${isActive ? 'active' : ''}`}
          >
            <House size={18} />
            <span>Dashboard</span>
          </NavLink>
          <NavLink
            to="/marketplace"
            className={({ isActive }) => `side-nav-link ${isActive ? 'active' : ''}`}
          >
            <Store size={18} />
            <span>Shop</span>
          </NavLink>
          <NavLink
            to="/dashboard/wallet"
            className={({ isActive }) => `side-nav-link ${isActive ? 'active' : ''}`}
          >
            <Wallet size={18} />
            <span>My Wallet</span>
          </NavLink>
          <NavLink
            to="/dashboard/orders"
            className={({ isActive }) => `side-nav-link ${isActive ? 'active' : ''}`}
          >
            <ShoppingBag size={18} />
            <span>My Orders</span>
          </NavLink>
          <NavLink
            to="/dashboard/profile"
            className={({ isActive }) => `side-nav-link ${isActive ? 'active' : ''}`}
          >
            <UserRound size={18} />
            <span>Account Settings</span>
          </NavLink>

          <button
            type="button"
            className="side-nav-link"
            style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, cursor: 'pointer', color: '#ef4444' }}
            onClick={handleLogout}
            disabled={signingOut}
            aria-label="Sign out of account"
          >
            <LogOut size={18} />
            <span>{signingOut ? 'Signing out…' : 'Sign Out'}</span>
          </button>
        </nav>

        <div className="fintech-side-spacer" />

        <div className="fintech-side-tip">
          <strong>Need help?</strong>
          <p>Get support with your wallet, recent purchases or account.</p>
          <Link to="/dashboard/support">Visit help centre →</Link>
        </div>
      </aside>

      {/* Mainframe */}
      <div className="fintech-mainframe">
        {/* Topbar */}
        <header className="fintech-topbar">
          <Link to="/dashboard" className="fintech-logo" aria-label="LogsPoll Dashboard">
            <img
              src={theme === 'dark' ? '/logo-dark.png' : '/logo-light.png'}
              alt="LogsPoll"
              style={{ height: 28, width: 'auto', display: 'block' }}
            />
          </Link>

          <div className="fintech-topbar-breadcrumb">
            My account <span style={{ margin: '0 8px', color: 'var(--line)' }}>/</span>
            <strong id="breadcrumb">{getSectionTitle()}</strong>
          </div>

          <div className="fintech-header-tools">
            <button
              type="button"
              className="fintech-icon-btn"
              onClick={toggleTheme}
              aria-label="Toggle light or dark appearance"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            <button
              type="button"
              className="fintech-icon-btn"
              onClick={() => showToast("You're all caught up! No unread notifications.")}
              aria-label="Notifications"
            >
              <Bell size={18} />
              <span className="ping" />
            </button>

            <Link
              to="/dashboard/profile"
              className="fintech-avatar"
              aria-label="Open account settings"
            >
              {initials}
            </Link>

            <button
              type="button"
              className="fintech-icon-btn"
              onClick={handleLogout}
              disabled={signingOut}
              title="Sign Out"
              aria-label="Sign Out"
              style={{ color: '#ef4444' }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="fintech-content" id="main">
          <Outlet />
        </main>
      </div>

      {/* Fixed Mobile Bottom Navigation (< 1000px) */}
      <nav className="fintech-mobile-nav" aria-label="Bottom navigation">
        <NavLink
          to="/dashboard"
          end
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        >
          <span className="nav-icon"><House size={19} /></span>
          <span>Dashboard</span>
        </NavLink>
        <NavLink
          to="/marketplace"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        >
          <span className="nav-icon"><Store size={19} /></span>
          <span>Shop</span>
        </NavLink>
        <NavLink
          to="/dashboard/wallet"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        >
          <span className="nav-icon"><Wallet size={19} /></span>
          <span>Wallet</span>
        </NavLink>
        <NavLink
          to="/dashboard/orders"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        >
          <span className="nav-icon"><ShoppingBag size={19} /></span>
          <span>Orders</span>
        </NavLink>
        <NavLink
          to="/dashboard/profile"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        >
          <span className="nav-icon"><UserRound size={19} /></span>
          <span>Profile</span>
        </NavLink>
      </nav>

      {/* Global Dashboard Toast */}
      <div className={`fintech-toast ${toastMessage ? 'show' : ''}`} role="status" aria-live="polite">
        {toastMessage}
      </div>
    </div>
  )
}

export function DashboardLayout() {
  return (
    <DashboardProvider>
      <DashboardShellInner />
    </DashboardProvider>
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
  const [whatsAppModalOpen, setWhatsAppModalOpen] = useState(false)
  const [whatsAppOrderRef, setWhatsAppOrderRef] = useState<string | undefined>(undefined)

  // Dashboard & Wallet state
  const { hideBalance, toggleHideBalance, walletBalanceMinor: sharedBalanceMinor } = useDashboard()
  const [walletBalanceMinor, setWalletBalanceMinor] = useState<number | null>(null)
  const [walletTransactions, setWalletTransactions] = useState<WalletTransactionItem[]>([])
  const [fundingInfo, setFundingInfo] = useState<{ enabled: boolean; mode: string; reason: string } | null>(null)
  const [showFundSheet, setShowFundSheet] = useState(false)
  const [selectedTx, setSelectedTx] = useState<WalletTransactionItem | null>(null)

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

      void cloudflareRequest<{
        wallet?: { balance_minor: number }
        transactions?: WalletTransactionItem[]
        funding?: { enabled: boolean; mode: string; reason: string }
      }>('/api/wallet')
        .then((data) => {
          if (active && data.wallet) setWalletBalanceMinor(data.wallet.balance_minor)
          if (active && data.transactions) setWalletTransactions(data.transactions)
          if (active && data.funding) setFundingInfo(data.funding)
        })
        .catch(() => {
          if (active) {
            setWalletBalanceMinor(null)
            setFundingInfo(null)
          }
        })
      
      void cloudflareRequest<{ records: Order[] }>(endpoint)
        .then(({ records }) => {
          if (active) {
            setRecords(
              isPurchasesMode
                ? records.filter(
                    (order) => getOrderDeliveryStatus(order).status === 'delivered'
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
    (r) => getOrderDeliveryStatus(r).status === 'delivered'
  ).length

  const pendingOrders = records.filter(
    (r) => {
      const s = getOrderDeliveryStatus(r).status
      return s === 'delivery_processing' || s === 'awaiting_supplier' || s === 'payment_pending'
    }
  ).length

  const failedOrders = records.filter(
    (r) => getOrderDeliveryStatus(r).status === 'delivery_failed'
  ).length

  // Filtered orders based on selected tab and search query
  const filteredOrders = records.filter((order) => {
    const s = getOrderDeliveryStatus(order).status
    if (orderFilter === 'completed') {
      if (s !== 'delivered') return false
    } else if (orderFilter === 'pending') {
      if (s !== 'delivery_processing' && s !== 'awaiting_supplier' && s !== 'payment_pending') return false
    } else if (orderFilter === 'failed') {
      if (s !== 'delivery_failed') return false
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
            Need help with an order, account credentials, or automated fulfillment? Reach out to our priority support desk on WhatsApp or submit a ticket below.
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

                <button
                  type="button"
                  onClick={() => {
                    setWhatsAppOrderRef(supportOrderRef || undefined)
                    setWhatsAppModalOpen(true)
                  }}
                  className="channel-item"
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}
                >
                  <div className="channel-icon whatsapp">
                    <MessageSquare size={16} />
                  </div>
                  <div className="channel-details">
                    <strong>WhatsApp Priority Desk</strong>
                    <span>Instant chat with support agent</span>
                  </div>
                  <ArrowRight size={14} className="channel-arrow" />
                </button>

                <div style={{ marginTop: 8 }}>
                  <WhatsAppSupportButton
                    orderReference={supportOrderRef || undefined}
                    variant="primary"
                    buttonText="Contact Support on WhatsApp"
                    style={{ width: '100%' }}
                  />
                </div>

                <div className="sla-badge-box">
                  <Clock size={15} />
                  <span>Direct Priority Desk: <strong>Verified support team</strong></span>
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
        <div className="fintech-screen-head" style={{ marginBottom: 20 }}>
          <div>
            <p className="fintech-eyebrow">YOUR SHORTLIST</p>
            <h1>Saved Items</h1>
            <p>Keep the products you're interested in close.</p>
          </div>
        </div>

        {favLoading ? (
          <div className="dashboard-loading-state">
            <RefreshCw size={24} className="spin-icon" />
            <p>Loading your saved items…</p>
          </div>
        ) : favoriteProducts.length === 0 ? (
          <Empty
            icon={Heart}
            title="Nothing saved yet"
            text="When you save a product, it will show up here for easy access later."
            actionLabel="Browse products"
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
              const statusDetails = getOrderDeliveryStatus(order)
              const isDelivered = statusDetails.canDownload
              const isAwaitingSupplier = statusDetails.status === 'awaiting_supplier'
              const isProcessing = statusDetails.status === 'delivery_processing' || statusDetails.status === 'payment_pending'
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

                        <span className={`status-pill ${statusDetails.badgeClass}`}>
                          {statusDetails.status === 'delivered' && <CheckCircle2 size={12} />}
                          {statusDetails.status === 'delivery_processing' && <RefreshCw size={12} className="spin-slow" />}
                          {statusDetails.status === 'awaiting_supplier' && <Clock size={12} />}
                          {statusDetails.status === 'delivery_failed' && <AlertCircle size={12} />}
                          {statusDetails.status === 'payment_pending' && <Clock size={12} />}
                          <span>{statusDetails.label}</span>
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
                      ) : isAwaitingSupplier ? (
                        <div className="expanded-status-notice pending">
                          <Clock size={16} className="spin-slow" />
                          <div>
                            <strong>Delivery Awaiting Supplier</strong>
                            <p>{statusDetails.description}</p>
                          </div>
                        </div>
                      ) : isProcessing ? (
                        <div className="expanded-status-notice pending">
                          <Clock size={16} className="spin-slow" />
                          <div>
                            <strong>{statusDetails.label}</strong>
                            <p>{statusDetails.description}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="expanded-status-notice failed">
                          <AlertCircle size={16} />
                          <div>
                            <strong>{statusDetails.label}</strong>
                            <p>{statusDetails.description}</p>
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
                        <WhatsAppSupportButton
                          orderReference={order.reference}
                          variant="compact"
                          buttonText="Chat on WhatsApp"
                        />
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

  const currentMonth = new Date().getMonth()
  const currentYear = new Date().getFullYear()
  const currentMonthName = new Date().toLocaleDateString('en-GB', { month: 'long' })

  const thisMonthOrders = records.filter((r) => {
    const d = new Date(r.created_at)
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear
  })
  const thisMonthOrdersCount = thisMonthOrders.length

  const thisMonthSpendMinor = thisMonthOrders
    .filter((r) => r.payment_status === 'paid')
    .reduce((sum, r) => sum + r.total_minor, 0)

  const totalSpendMinor = records
    .filter((r) => r.payment_status === 'paid')
    .reduce((sum, r) => sum + r.total_minor, 0)

  const todayDate = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).toUpperCase()

  const displayBalanceMinor = walletBalanceMinor ?? sharedBalanceMinor

  // -------------------------------------------------------------
  // VIEW: DEFAULT OVERVIEW (Matches Reference 1 & 3)
  // -------------------------------------------------------------
  return (
    <div>
      {/* Screen Head */}
      <div className="fintech-screen-head">
        <div>
          <p className="fintech-eyebrow">{todayDate}</p>
          <h1>Hello, {firstName} <span aria-hidden="true">👋</span></h1>
          <p>Here's what’s happening with your LogsPoll account.</p>
        </div>
      </div>

      <div className="fintech-dashboard-grid">
        {/* Left Column */}
        <div className="fintech-stack">
          {/* Wallet Hero Card */}
          <section className="fintech-wallet-hero" aria-label="Wallet balance">
            <div className="fintech-hero-overline">
              <span>LogsPoll Wallet</span>
              <span className="tag">
                <i className="online" /> NGN Wallet
              </span>
            </div>

            <p className="fintech-hero-amount-label">Available balance</p>

            <div className="fintech-hero-amount">
              <span className="balance-number">
                {hideBalance ? '₦ ••••••••' : formatPrice(displayBalanceMinor ?? 0)}
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
              <ShieldCheck size={14} /> Only verified payments credit your wallet
            </p>

            <div className="fintech-hero-actions">
              <button
                type="button"
                className="fintech-btn fintech-btn-orange"
                onClick={() => setShowFundSheet(true)}
              >
                <Plus size={16} /> Fund wallet
              </button>
              <Link to="/dashboard/wallet" className="fintech-btn fintech-btn-hero-alt">
                <Wallet size={16} /> View wallet
              </Link>
            </div>
          </section>

          {/* Account Summary Stats */}
          <div className="fintech-stats" aria-label="Account summary">
            <div className="fintech-stat">
              <div className="fintech-stat-top">
                <span>Total orders</span>
                <span className="fintech-stat-icon">
                  <ShoppingBag size={15} />
                </span>
              </div>
              <div>
                <strong>{records.length}</strong>
                <span className="fintech-stat-footer">
                  {thisMonthOrdersCount > 0 ? `${thisMonthOrdersCount} new this month` : 'Lifetime purchases'}
                </span>
              </div>
            </div>

            <div className="fintech-stat stat-blue">
              <div className="fintech-stat-top">
                <span>Monthly spend</span>
                <span className="fintech-stat-icon">
                  <ArrowUp size={15} />
                </span>
              </div>
              <div>
                <strong>
                  {formatPrice(thisMonthSpendMinor > 0 ? thisMonthSpendMinor : totalSpendMinor)}
                </strong>
                <span className="fintech-stat-footer">
                  {thisMonthSpendMinor > 0 ? `${currentMonthName} spending` : 'Total verified spending'}
                </span>
              </div>
            </div>
          </div>

          {/* Marketplace Discovery Banner */}
          <Link to="/marketplace" className="fintech-shop-banner">
            <span>
              <strong>Find something new</strong>
              <span>Explore products in the LogsPoll marketplace</span>
            </span>
            <span className="fintech-shop-arrow">
              <ArrowRight size={16} />
            </span>
          </Link>
        </div>

        {/* Right Column */}
        <div className="fintech-stack">
          {/* Recent Activity Panel */}
          <section className="fintech-panel fintech-panel-pad" aria-labelledby="recent-activity-heading">
            <div className="fintech-panel-heading">
              <div>
                <h2 id="recent-activity-heading">Recent activity</h2>
                <p className="hint">Your latest wallet movements</p>
              </div>
              <Link to="/dashboard/wallet" className="fintech-more">
                <span>View all</span>
                <ChevronRight size={13} />
              </Link>
            </div>

            {walletTransactions.length > 0 ? (
              <ul className="fintech-tx-list">
                {walletTransactions.slice(0, 4).map((tx) => {
                  const isCredit = tx.direction === 'credit'
                  const title =
                    tx.reason ||
                    (isCredit
                      ? 'Wallet funding'
                      : tx.order_reference
                      ? `Order #${tx.order_reference}`
                      : 'Digital purchase')
                  const dateObj = new Date(tx.created_at)
                  const dateStr = !isNaN(dateObj.getTime())
                    ? `${dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${dateObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
                    : String(tx.created_at)

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
                          <small>{dateStr}</small>
                        </span>
                        <span className="fintech-tx-right">
                          <strong className={isCredit ? 'positive' : ''}>
                            {isCredit ? '+' : '−'}{formatPrice(tx.amount_minor)}
                          </strong>
                          <small>{isCredit ? 'Money in' : 'Purchase'} · Done</small>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="fintech-empty-state">
                <Search size={24} className="icon" />
                <p>No recent activity recorded yet.</p>
              </div>
            )}
          </section>

          {/* Recent Orders Panel */}
          <section className="fintech-panel fintech-panel-pad" aria-labelledby="recent-orders-heading">
            <div className="fintech-panel-heading">
              <div>
                <h2 id="recent-orders-heading">Recent orders</h2>
                <p className="hint">Track your purchases</p>
              </div>
              <Link to="/dashboard/orders" className="fintech-more">
                <span>View all</span>
                <ChevronRight size={13} />
              </Link>
            </div>

            {records.length > 0 ? (
              <div className="fintech-order-list">
                {records.slice(0, 3).map((order) => {
                  const firstItem = order.order_items?.[0]
                  const title = firstItem?.product_name || `Order #${order.reference}`
                  const dateObj = new Date(order.created_at)
                  const dateStr = !isNaN(dateObj.getTime())
                    ? dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                    : String(order.created_at)
                  const statusDetails = getOrderDeliveryStatus(order)
                  const isDelivered = statusDetails.canDownload
                  const isProcessing = statusDetails.status === 'delivery_processing' || statusDetails.status === 'awaiting_supplier' || statusDetails.status === 'payment_pending'

                  return (
                    <div className="fintech-order-item" key={order.id}>
                      <span className="fintech-order-icon">
                        <ShoppingBag size={18} />
                      </span>
                      <span className="fintech-order-info">
                        <strong>{title}</strong>
                        <small>#{order.reference} · {dateStr}</small>
                      </span>
                      <span className="fintech-order-side">
                        <strong>{formatPrice(order.total_minor)}</strong>
                        <span className={`fintech-small-pill ${isProcessing ? 'pending' : isDelivered ? 'completed' : 'failed'}`}>
                          {statusDetails.label}
                        </span>
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="fintech-empty-state">
                <ShoppingBag size={24} className="icon" />
                <p>No orders recorded yet.</p>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Sheets */}
      <FundWalletSheet
        isOpen={showFundSheet}
        onClose={() => setShowFundSheet(false)}
        onSuccess={() => setAttempt((a) => a + 1)}
        fundingEnabled={fundingInfo ? fundingInfo.enabled : false}
        fundingReason={fundingInfo?.reason}
      />

      <TransactionDetailsSheet
        transaction={selectedTx}
        onClose={() => setSelectedTx(null)}
      />

      <WhatsAppSupportModal
        isOpen={whatsAppModalOpen}
        onClose={() => setWhatsAppModalOpen(false)}
        orderReference={whatsAppOrderRef}
      />
    </div>
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
  const { theme, toggleTheme, hideBalance, toggleHideBalance, showToast } = useDashboard()
  const [alertsOn, setAlertsOn] = useState(true)
  const [name, setName] = useState(String(session?.user.user_metadata?.full_name || session?.user.user_metadata?.name || ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const displayName = String(
    session?.user.user_metadata?.full_name || 
    session?.user.user_metadata?.name || 
    session?.user.email?.split('@')[0] || 
    'Customer'
  )

  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || 'LP'

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
      <div className="fintech-screen-head" style={{ marginBottom: 20 }}>
        <div>
          <p className="fintech-eyebrow">YOUR ACCOUNT</p>
          <h1>Profile &amp; Settings</h1>
          <p>Make LogsPoll work your way.</p>
        </div>
      </div>

      {/* Profile Card & Settings Panel Matching Reference 3 */}
      <div className="fintech-stack" style={{ marginBottom: 24 }}>
        <div className="fintech-panel fintech-profile-card">
          <span className="fintech-avatar">{initials}</span>
          <div>
            <strong>{displayName}</strong>
            <small>Personal account · Verified Customer</small>
          </div>
        </div>

        <div className="fintech-panel fintech-settings-panel">
          <div className="fintech-setting-row">
            <span className="fintech-setting-icon"><Moon size={18} /></span>
            <div className="fintech-setting-copy">
              <strong>Dark appearance</strong>
              <small>Choose a comfortable theme</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={theme === 'dark'}
              className={`fintech-switch ${theme === 'dark' ? 'on' : ''}`}
              onClick={toggleTheme}
              aria-label="Dark appearance"
            />
          </div>

          <div className="fintech-setting-row">
            <span className="fintech-setting-icon"><EyeOff size={18} /></span>
            <div className="fintech-setting-copy">
              <strong>Hide wallet balance</strong>
              <small>Keep your balance private on screen</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={hideBalance}
              className={`fintech-switch ${hideBalance ? 'on' : ''}`}
              onClick={toggleHideBalance}
              aria-label="Hide wallet balance"
            />
          </div>

          <div className="fintech-setting-row">
            <span className="fintech-setting-icon"><Bell size={18} /></span>
            <div className="fintech-setting-copy">
              <strong>Transaction alerts</strong>
              <small>Get notified when payments are confirmed</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={alertsOn}
              className={`fintech-switch ${alertsOn ? 'on' : ''}`}
              onClick={() => {
                setAlertsOn((prev) => {
                  const next = !prev
                  showToast(next ? 'Transaction alerts enabled.' : 'Transaction alerts disabled.')
                  return next
                })
              }}
              aria-label="Transaction alerts"
            />
          </div>
        </div>
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

        <div className="profile-details-card profile-session-card" style={{ marginTop: 20 }}>
          <div className="card-title-row">
            <LogOut size={20} className="title-icon" style={{ color: '#ef4444' }} />
            <h2>Account Session</h2>
          </div>
          <p className="security-desc" style={{ fontSize: 13, color: 'var(--muted)', margin: '8px 0 16px', lineHeight: 1.5 }}>
            Sign out of your LogsPoll account on this device. You will need to sign in again to access your wallet and orders.
          </p>
          <button
            type="button"
            className="dashboard-logout-btn"
            style={{ width: '100%', minHeight: 46 }}
            onClick={async () => {
              try {
                await cloudflareAuth('sign-out', {})
                window.location.assign('/login')
              } catch {
                window.location.assign('/login')
              }
            }}
          >
            <LogOut size={16} />
            <span>Sign Out of Account</span>
          </button>
        </div>
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
  const [hasPendingInvite, setHasPendingInvite] = useState(false)

  useEffect(() => {
    let active = true
    if (!session) return
    cloudflareRequest<{ invited: boolean }>('/api/account/admin-enrollment')
      .then((data) => {
        if (active && data?.invited) {
          setHasPendingInvite(true)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [session])

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

      {hasPendingInvite && (
        <div style={{ background: '#fff3e9', border: '1px solid #fed7aa', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShieldCheck size={20} style={{ color: 'var(--orange)', flexShrink: 0 }} />
            <div>
              <strong style={{ display: 'block', fontSize: 13, color: '#9a3412' }}>Administrator Invitation Pending</strong>
              <span style={{ fontSize: 11.5, color: '#c2410c' }}>You have an active invitation to join the administrator team.</span>
            </div>
          </div>
          <Link to="/accept-invitation" className="button button-orange" style={{ padding: '6px 12px', fontSize: 12, whiteSpace: 'nowrap' }}>
            Review Invitation →
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
