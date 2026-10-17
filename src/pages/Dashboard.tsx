import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { 
  LogOut, PackageOpen, House, History, Settings, UserRound, 
  ShoppingBag, ShieldCheck, ArrowRight, Heart, BookOpen, 
  Key, Copy, Check
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { cloudflareAuth, cloudflareRequest } from '../lib/cloudflare-auth'
import { ProductArtwork } from '../components/ProductArtwork'
import { ReviewForm } from '../components/Reviews'
import { useCurrency } from '../lib/currency'
import { useFavorites } from '../lib/favorites'
import type { Order } from '../lib/customer-data'

const links = [
  ['', 'Overview', House],
  ['/purchases', 'Purchase History', History],
  ['/orders', 'Orders', ShoppingBag],
  ['/profile', 'Profile', UserRound],
  ['/settings', 'Settings', Settings],
] as const

export function DashboardLayout() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const displayName = String(
    session?.user.user_metadata?.full_name || 
    session?.user.user_metadata?.name || 
    session?.user.email?.split('@')[0] || 
    'Your Account'
  )

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
      <aside className="dashboard-sidebar">
        <div className="customer-identity">
          <span className="customer-avatar">
            {displayName.charAt(0).toUpperCase()}
          </span>
          <div className="customer-meta">
            <strong>{displayName}</strong>
            <span className="member-label">VERIFIED MEMBER</span>
            <small className="account-email">{session?.user.email}</small>
          </div>
        </div>

        <nav aria-label="Customer dashboard navigation">
          {links.map(([suffix, label, Icon]) => (
            <NavLink key={label} to={`/dashboard${suffix}`} end={suffix === ''}>
              <Icon size={19} />
              <span>{label}</span>
            </NavLink>
          ))}
          <Link to="/marketplace?favorites=1" className="dashboard-nav-extra">
            <Heart size={19} />
            <span>Saved Favorites</span>
          </Link>
          <Link to="/docs" className="dashboard-nav-extra">
            <BookOpen size={19} />
            <span>API Documentation</span>
          </Link>
        </nav>

        <button 
          className="text-link logout-button" 
          disabled={busy} 
          onClick={logout}
          aria-label="Sign out of account"
        >
          <LogOut size={18} />
          <span>{busy ? 'Signing out…' : 'Sign Out'}</span>
        </button>

        {error && <p className="form-error" role="alert">{error}</p>}
      </aside>

      <section className="dashboard-content">
        <Outlet />
      </section>
    </div>
  )
}

function CopyableInstruction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="credential-box">
      <div className="credential-header">
        <span>Delivery Credentials &amp; Access Details</span>
        <button onClick={handleCopy} className="credential-copy-btn">
          {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="delivery-instructions">{text}</pre>
    </div>
  )
}

export function CustomerRecords({
  mode,
}: {
  mode: 'overview' | 'orders' | 'purchases' | 'transactions'
}) {
  const { session } = useAuth()
  const { formatPrice } = useCurrency()
  const { favorites } = useFavorites()
  const [records, setRecords] = useState<Order[]>([])
  const [loading, setLoading] = useState(mode !== 'transactions')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (session && mode !== 'transactions') {
      let active = true
      void cloudflareRequest<{
        records: Order[]
      }>(mode === 'purchases' ? '/api/orders?purchases=true' : '/api/orders')
        .then(({ records }) => {
          if (active) {
            setRecords(
              mode === 'purchases'
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

  const username = String(
    session?.user.user_metadata?.full_name ||
    session?.user.user_metadata?.name ||
    session?.user.email?.split('@')[0] ||
    'there'
  )

  const titles = {
    overview: `Welcome back, ${username}! 👋`,
    orders: 'Your Orders',
    purchases: 'Purchased Products & Delivery Vault',
    transactions: 'Transaction History',
  }

  const descriptions = {
    overview: 'Manage your verified digital essentials, active purchases, and recent order history.',
    purchases: 'Access your paid, delivered product credentials and access instructions.',
    orders: 'Track authoritative payment reconciliation and order fulfillment status.',
    transactions: 'Payment records and reconciliation ledger for your account.',
  }

  // Calculate Overview Metric Cards
  const completedPurchases = records.filter(
    (r) => r.payment_status === 'paid' && r.fulfillment_status === 'delivered'
  ).length

  const [expandedPurchases, setExpandedPurchases] = useState<Record<string, boolean>>({})

  return (
    <div className={mode === 'overview' ? 'customer-overview' : 'customer-page-panel'}>
      <div className="dashboard-page-header">
        <h1>{mode === 'purchases' ? 'All Purchases' : titles[mode]}</h1>
        <p className="dashboard-intro">{descriptions[mode]}</p>
      </div>

      {/* Top 3 Genuine Metric Cards (PadiLogs Reference without fake wallet) */}
      {mode === 'overview' && (
        <div className="dashboard-top-cards">
          {/* Card 1: DELIVERED PURCHASES / DIGITAL ASSETS */}
          <article className="dashboard-stat-card">
            <span className="stat-card-badge">DIGITAL ASSETS</span>
            <strong className="stat-card-value">{completedPurchases} Assets</strong>
            <p className="stat-card-subtext">Access credentials &amp; instant delivery vault</p>
            <Link to="/dashboard/purchases" className="stat-card-action">
              Open Vault <ArrowRight size={14} />
            </Link>
          </article>

          {/* Card 2: TOTAL ORDERS */}
          <article className="dashboard-stat-card">
            <span className="stat-card-badge">TOTAL ORDERS</span>
            <strong className="stat-card-value">{records.length} Orders</strong>
            <p className="stat-card-subtext">Authoritative payment &amp; fulfillment status</p>
            <Link to="/dashboard/orders" className="stat-card-action">
              View Orders <ArrowRight size={14} />
            </Link>
          </article>

          {/* Card 3: SAVED FAVORITES */}
          <article className="dashboard-stat-card">
            <span className="stat-card-badge">WISHLIST</span>
            <strong className="stat-card-value">{favorites.length} Saved</strong>
            <p className="stat-card-subtext">Quickly access your pinned essentials</p>
            <Link to="/marketplace?favorites=1" className="stat-card-action">
              View Favorites <ArrowRight size={14} />
            </Link>
          </article>
        </div>
      )}

      {/* Trending Now 🔥 Ranked Section */}
      {mode === 'overview' && <TrendingSection />}

      {/* Records Activity / Purchases */}
      <div className={mode === 'overview' ? 'customer-activity' : undefined}>
        {mode === 'overview' && (
          <div className="activity-heading">
            <h2>Recent Orders</h2>
            <Link className="text-link" to="/dashboard/orders">
              View All Orders →
            </Link>
          </div>
        )}

        {mode === 'transactions' ? (
          <Empty
            title="Transaction History"
            text="All past transactions are reconciled with your orders. View current payment statuses under your orders tab."
          />
        ) : loading ? (
          <p role="status">Loading your records…</p>
        ) : error ? (
          <div role="alert" className="error-retry-card">
            <p className="form-error">{error}</p>
            <button className="button button-outline" onClick={() => setAttempt(attempt + 1)}>
              Retry
            </button>
          </div>
        ) : records.length === 0 ? (
          <Empty
            title={mode === 'purchases' ? 'No purchases yet' : 'No orders placed yet'}
            text={
              mode === 'purchases'
                ? 'Your verified paid and delivered products will appear here with complete access instructions.'
                : 'Browse our marketplace to find verified digital products, tools, and accounts.'
            }
          />
        ) : mode === 'purchases' ? (
          /* Purchases View matching Target Reference 84_customer_purchases.jpg */
          <div className="purchases-target-list">
            {records.map((order) => {
              const items = order.order_items || [];
              const isExpanded = !!expandedPurchases[order.id];

              return (
                <article className="target-purchase-card" key={order.id}>
                  {/* Top: Brand Squircle Icon on left + DELIVERED badge on right */}
                  <div className="target-purchase-top">
                    <div className="target-purchase-icon-box">
                      <ShoppingBag size={20} />
                    </div>
                    <span className="target-purchase-status-badge">
                      DELIVERED
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
                    {new Date(order.created_at).toLocaleDateString(undefined, {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })}
                  </span>

                  {/* Paid Amount Row */}
                  <div className="target-purchase-pricing">
                    <div className="pricing-left">
                      <span className="paid-amount-label">PAID AMOUNT</span>
                      <strong className="paid-amount-val">{formatPrice(order.total_minor)}</strong>
                    </div>
                    <span className="target-order-ref-pill">
                      Ord: {order.reference}
                    </span>
                  </div>

                  {/* Alert banner */}
                  <div className="target-purchase-notice">
                    <span className="notice-icon">ⓘ</span>
                    <span>See product description for Credentials Format</span>
                  </div>

                  {/* Action Button: View Details > */}
                  <button
                    type="button"
                    className="target-purchase-btn"
                    onClick={() =>
                      setExpandedPurchases((prev) => ({
                        ...prev,
                        [order.id]: !prev[order.id],
                      }))
                    }
                  >
                    <span>{isExpanded ? 'Hide Details' : 'View Details'}</span>
                    <ArrowRight size={15} />
                  </button>

                  {/* Expanded Vault Details */}
                  {isExpanded && (
                    <div className="target-purchase-expanded-vault">
                      {items.map((item) => (
                        <div key={item.id} className="vault-item-block">
                          <h4 className="vault-item-name">
                            {item.product_name} <span className="item-qty">× {item.quantity}</span>
                          </h4>
                          {item.product_entitlements?.instructions ? (
                            <CopyableInstruction text={item.product_entitlements.instructions} />
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
                </article>
              );
            })}
          </div>
        ) : (
          /* General Orders List */
          <>
            <div className="order-list">
              {records.slice(0, mode === 'overview' ? 5 : 50).map((order) => (
                <article className="order-card" key={order.id}>
                  <div className="order-heading">
                    <div>
                      <span className="order-ref-badge">{order.reference}</span>
                      <small className="order-date">
                        {new Date(order.created_at).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </small>
                    </div>
                    <strong className="order-total">{formatPrice(order.total_minor)}</strong>
                  </div>

                  <div className="order-status-row">
                    <span className={`status-pill payment-${order.payment_status}`}>
                      Payment: {order.payment_status}
                    </span>
                    <span className={`status-pill delivery-${order.fulfillment_status}`}>
                      Fulfillment: {order.fulfillment_status}
                    </span>
                  </div>
                </article>
              ))}
            </div>
            {mode === 'overview' && records.length > 5 && (
              <p className="preview-note">Showing 5 most recent records. View Orders for full history.</p>
            )}
          </>
        )}
      </div>

      {/* Quick Actions on Overview */}
      {mode === 'overview' && (
        <div className="customer-quick-actions">
          <h2>Quick Actions</h2>
          <div className="quick-actions-row">
            <Link to="/marketplace" className="quick-action-link">
              <PackageOpen size={20} />
              <span>Browse Marketplace</span>
              <ArrowRight size={16} />
            </Link>
            <Link to="/docs" className="quick-action-link">
              <BookOpen size={20} />
              <span>API Documentation</span>
              <ArrowRight size={16} />
            </Link>
            <Link to="/dashboard/settings" className="quick-action-link">
              <Settings size={20} />
              <span>Security Settings</span>
              <ArrowRight size={16} />
            </Link>
            <Link to="/support" className="quick-action-link">
              <ShieldCheck size={20} />
              <span>Customer Support</span>
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

function TrendingSection() {
  const { formatPrice } = useCurrency()
  const [products, setProducts] = useState<
    {
      id: string
      slug: string
      name: string
      category_name: string
      price_minor: number
      currency: string
      image_path?: string
      supplier_image_urls?: string[]
      server_number?: number
    }[]
  >([])

  useEffect(() => {
    let active = true
    void cloudflareRequest<{ records: typeof products }>('/api/products?page=1')
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
          <h2>Trending Now 🔥</h2>
          <p className="stat-card-subtext">Top performing digital tools and accounts this week</p>
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
                #{index + 1}
              </span>

              <Link to={`/products/${product.slug}`} className="live-product-icon">
                <ProductArtwork
                  name={product.name}
                  category={product.category_name}
                  path={product.image_path}
                  images={product.supplier_image_urls}
                />
              </Link>

              <div className="trending-card-body">
                <div className="product-badges-row">
                  <span className="product-category-badge">{product.category_name}</span>
                  {product.server_number ? (
                    <span className={`server-badge server-badge-${product.server_number}`}>
                      Server {product.server_number}
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

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <PackageOpen size={36} />
      <h2>{title}</h2>
      <p>{text}</p>
      <Link className="button" to="/marketplace">
        Browse Marketplace →
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

  async function save(event: SubmitEvent<HTMLFormElement>) {
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
      <h1>Profile &amp; Settings</h1>
      <p className="dashboard-intro">Manage your personal information, email address, and account preferences.</p>

      <div className="profile-columns">
        <div className="profile-details">
          <h2><UserRound size={20} /> Personal Information</h2>
          <form className="account-form profile-form" onSubmit={save}>
            <fieldset disabled={busy}>
              <label>
                Full Name
                <input
                  name="full_name"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={120}
                />
              </label>
              <label>
                Email Address
                <input type="email" value={session?.user.email ?? ''} readOnly />
                <small className="field-hint">Email address is verified and tied to your account identity.</small>
              </label>
              <button className="button" type="submit">
                {busy ? 'Saving Changes…' : 'Save Changes'}
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
    <section className={embedded ? 'profile-security' : 'customer-page-panel'}>
      {!embedded && (
        <>
          <h1>Security &amp; Account Settings</h1>
          <p className="dashboard-intro">Manage password authentication, security, and administrative access.</p>
          <Link className="text-link" to="/dashboard/profile">
            ← Edit personal details
          </Link>
        </>
      )}

      <div className="settings-panel">
        <h2><Key size={20} /> Security &amp; Password</h2>
        <p>Password updates require a secure single-use email verification code sent to your verified email.</p>
        <div className="button-row">
          <button className="button button-navy" onClick={reset} disabled={busy}>
            {busy ? 'Sending Code…' : 'Send Password Reset Code'}
          </button>
          <button className="button button-outline" onClick={() => void acceptAdmin()} disabled={busy}>
            Accept Administrator Invitation
          </button>
        </div>
        {message && <p role="status" className="form-success">{message}</p>}
        {error && <p role="alert" className="form-error">{error}</p>}
      </div>
    </section>
  )
}
