import { Fragment, useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { LayoutDashboard, Users, Package, Tags, ShoppingBag, CreditCard, MessageSquare, Plug, LifeBuoy, Settings, LogOut, Menu, X, ExternalLink, RefreshCw, ShieldCheck, Mail } from 'lucide-react'
import { cloudflareAuth, cloudflareRequest } from '../lib/cloudflare-auth'
import { useAuth } from '../auth/AuthProvider'
import './demo-admin.css'
import './reference-admin.css'
import './cloudflare-admin.css'
import './d1-reference-theme.css'
import CloudflareCatalog from './CloudflareCatalog'
import AdminRecords from './AdminRecords'

type Counts = { customers: number; products: number; orders: number }
type FeedItem = {
  connection_id: string; external_id: string; name: string; source_category: string
  supplier_cost_minor: number; stock_quantity: number; authorization_verified: number
  source_checked_at: number; approval: 'pending' | 'approved' | 'rejected'
  category_id: string | null; selling_price_minor: number | null
  delivery_type: string | null; reviewed_at: number | null
  supplier_description?: string; reviewed_description?: string; product_id?: string
}
type ReviewSnapshot = {
  environment: string; supplierSyncEnabled: boolean; publicationEnabled: boolean
  legacyApprovalsImported: boolean; counts: { approval: string; total: number }[]
  items: FeedItem[]; categories: { id: string; name: string }[]
}
const d1Nav = [
  { slug: 'overview', label: 'Dashboard overview', Icon: LayoutDashboard },
  { slug: 'customers', label: 'Customers', Icon: Users },
  { slug: 'products', label: 'Products', Icon: Package },
  { slug: 'categories', label: 'Categories', Icon: Tags },
  { slug: 'orders', label: 'Orders', Icon: ShoppingBag },
  { slug: 'purchases', label: 'Purchases', Icon: ShoppingBag },
  { slug: 'reviews', label: 'Reviews', Icon: MessageSquare },
  { slug: 'integrations', label: 'API Integrations', Icon: Plug },
  { slug: 'support', label: 'Support tickets', Icon: LifeBuoy },
  { slug: 'settings', label: 'Website settings', Icon: Settings },
  { slug: 'audit', label: 'Audit log', Icon: ShieldCheck },
  { slug: 'email', label: 'Email notifications', Icon: Mail },
  { slug: 'payments', label: 'Payments (locked)', Icon: CreditCard },
] as const

const deliveryMethods = ['Licensed digital download', 'Redemption code', 'Subscription activation', 'Manual fulfillment'] as const

// Convert NGN entered in naira to exact integer kobo, without floating-point rounding.
function toKobo(value: string) {
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(value.trim())) throw new Error('Enter a valid NGN amount with at most two decimal places.')
  const [whole, fraction = ''] = value.trim().split('.')
  const kobo = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(kobo) || kobo > 99999999900) throw new Error('Selling price is outside the supported range.')
  return kobo
}
const ngn = (minor: number) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(minor / 100)

export default function CloudflareAdmin() {
  const { section,tab } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const [overview, setOverview] = useState<Counts | null>(null)
  const [review, setReview] = useState<ReviewSnapshot | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<FeedItem | null>(null)
  const [categoryId, setCategoryId] = useState('')
  const [price, setPrice] = useState('')
  const [delivery, setDelivery] = useState<string>(deliveryMethods[0])
  const [description, setDescription] = useState('')
  const recordSections=['products','categories','customers','orders','purchases','support','reviews','settings','audit','email']; const viewing = ['integrations','supplier-review'].includes(section??'')||tab==='supplier-api' ? 'review' : section === 'payments' ? 'payments' : recordSections.includes(section??'')?'records':'overview'

  const refresh = useCallback(() => {
    void cloudflareRequest<{schemaReady:boolean}>('/api/admin/readiness').then(r=>{if(!r.schemaReady)setNotice('D1 migration 0006_admin_publication.sql is required.')}).catch(e=>setError(e.message))
    return Promise.all([
        cloudflareRequest<{ records: Counts[] }>('/api/admin/overview'),
        cloudflareRequest<ReviewSnapshot>('/api/admin/supplier-review'),
      ]).then(([o,r])=>{
      setError('')
      setOverview(o.records?.[0] ?? null)
      setReview(r)
    }).catch(problem=>{
      setError(problem instanceof Error ? problem.message : 'Administrator data unavailable.')
    }).finally(()=>setLoading(false))
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  function edit(item: FeedItem) {
    setChosen(item); setCategoryId(item.category_id ?? '')
    setPrice(item.selling_price_minor == null ? '' : String(item.selling_price_minor / 100))
    setDelivery(item.delivery_type ?? deliveryMethods[0]); setDescription(item.reviewed_description|| (item.supplier_description==='Description not supplied by supplier; administrator review required.'?'':item.supplier_description??'')); setError(''); setNotice('')
  }
  async function decide(item: FeedItem, action: 'approve' | 'reject') {
    if (busy) return
    if (action === 'reject' && !window.confirm('Reject this supplier review item? Published stock for this listing will be disabled.')) return
    setBusy(true); setError(''); setNotice('')
    try {
      const body = action === 'approve'
        ? { action, connection_id: item.connection_id, external_id: item.external_id, category_id: categoryId,
            ...(price.trim()?{price_minor:toKobo(price)}:{}), delivery_type: delivery, description }
        : { action, connection_id: item.connection_id, external_id: item.external_id }
      const result = await cloudflareRequest<{ review: string; published: boolean }>('/api/admin/supplier-review', body)

      setNotice(`Decision saved: ${result.review}. Use Products to publish only verified available stock.`)
      setChosen(null)
      await refresh()
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Review was not saved.') }
    finally { setBusy(false) }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (chosen) void decide(chosen, 'approve')
  }
  async function logout() {
    setBusy(true)
    try { await cloudflareAuth('sign-out', {}); navigate('/admin/login', { replace: true }) }
    catch { setError('Unable to sign out. Retry.'); setBusy(false) }
  }
  const pending = review?.counts.find(x => x.approval === 'pending')?.total ?? 0
  const approved = review?.counts.find(x => x.approval === 'approved')?.total ?? 0
  const rejected = review?.counts.find(x => x.approval === 'rejected')?.total ?? 0
  return <div className="demo-admin reference-admin d1-reference-admin">
    <header className="demo-topbar admin-reference-topbar">
      <div className="admin-reference-brand">
        <button type="button" className="icon-button demo-menu" aria-label="Open admin navigation" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={20}/></button>
        <Link to="/" className="brand">LOGS<span>POLL</span></Link>
        <span className="admin-hq">ADMIN HQ</span>
      </div>
      <div className="admin-topbar-actions">
        <Link className="demo-mini-button" to="/admin/integrations"><RefreshCw size={13}/>Supplier API</Link>
        <Link className="admin-live-store" to="/marketplace">Live Store <ExternalLink size={12}/></Link>
        <Link to="/admin/settings" className="demo-account"><span><strong>LOGSPOLL Admin</strong><small>{session?.user.email ?? '—'}</small></span><span className="demo-avatar">AD</span></Link>
        <button type="button" className="icon-button d1-logout-top" onClick={() => void logout()} disabled={busy} aria-label="Log out"><LogOut size={16}/></button>
      </div>
    </header>
    <aside className={`demo-sidebar ${open ? 'is-open' : ''}`} id="admin-navigation" aria-label="Admin navigation">
      <button type="button" className="icon-button demo-close" onClick={() => setOpen(false)} aria-label="Close admin navigation"><X size={19}/></button>
      <div className="demo-workspace admin-workspace"><span className="demo-avatar">LP</span><div><strong>Admin workspace</strong><small>LOGSPOLL operations</small></div></div>
      <span className="demo-nav-label">OPERATIONS CONTROL</span>
      <nav>
        {d1Nav.map(({slug,label,Icon}) => <Fragment key={slug}>
          {slug==='integrations' && <span className="demo-nav-label">INTEGRATIONS & CONFIG</span>}
          <NavLink end={slug==='overview'} onClick={() => setOpen(false)} to={slug==='overview'?'/admin':`/admin/${slug}`}>
            <Icon size={17}/>{label}
          </NavLink>
        </Fragment>)}
      </nav>
      <div className="demo-sidebar-bottom"><Link className="text-link" to="/">View website →</Link><button className="text-link" type="button" onClick={() => void logout()} disabled={busy}><LogOut size={16}/> Log out</button></div>
    </aside>
    {open && <button type="button" className="demo-backdrop" aria-label="Close navigation overlay" onClick={() => setOpen(false)}/>}
    <div className="demo-main"><main className="demo-content">
      <header className="cf-header demo-heading"><div><div className="cf-eyebrow">LOGSPOLL CONTROL CENTER</div><h1>{viewing === 'overview' ? 'Platform Command Center' : viewing === 'review' ? 'Supplier reviews' : viewing==='records'?section:'Payment status'}</h1><p>Verified admin session: {session?.user.email ?? '—'}</p></div><button className="cf-btn secondary" onClick={() => void refresh()} disabled={busy || loading}>Refresh</button></header>
      <p className="cf-warning" role="status">Cloudflare D1 records. Supplier approval and publication are separate; publication requires current authorization and verified stock. Payments remain disabled.</p>
      {loading && <p role="status">Loading administrator records…</p>}
      {error && <p className="cf-error" role="alert">{error}</p>}
      {notice && <p className="cf-success" role="status">{notice}</p>}
      {viewing==='records'&&<AdminRecords key={section} section={section!}/>}
      {viewing==='review'&&<CloudflareCatalog onComplete={refresh}/>}
      {viewing === 'overview' && <>
        <div className="cf-metrics">
          <div><span>CUSTOMERS</span><strong>{overview?.customers ?? '—'}</strong></div>
          <div><span>PRODUCTS</span><strong>{overview?.products ?? '—'}</strong></div>
          <div><span>ORDERS</span><strong>{overview?.orders ?? '—'}</strong></div>
          <div><span>PENDING REVIEWS</span><strong>{review ? pending : '—'}</strong></div>
          <div><span>APPROVED REVIEWS</span><strong>{review ? approved : '—'}</strong></div>
          <div><span>REJECTED REVIEWS</span><strong>{review ? rejected : '—'}</strong></div>
        </div>
        <section className="cf-panel"><h2>Migration status</h2><p>Supplier synchronization to D1: <strong>{review?.supplierSyncEnabled?'Configured; verify actual progress in supplier reviews':'Disabled pending migration and configuration'}</strong></p><p>Sellable supplier inventory: <strong>Verified publication only</strong></p><p>Bachs live payments: <strong>Disabled</strong></p><p>All displayed records come from this D1 database.</p><Link className="cf-btn" to="/admin/products">Open supplier reviews</Link></section>
      </>}
      {viewing === 'payments' && <section className="cf-panel"><h2>Bachs integration</h2><p>Payments and automatic fulfillment are deliberately disabled during the D1 migration. Live payments require a separate verified integration.</p></section>}
      {viewing === 'review' && <>
        <div className="cf-metrics"><div><span>Pending</span><strong>{review ? pending : '—'}</strong></div><div><span>Approved</span><strong>{review ? approved : '—'}</strong></div><div><span>Rejected</span><strong>{review ? rejected : '—'}</strong></div></div>
        <section className="cf-panel"><h2>Supplier catalog review queue</h2><p className="cf-muted">Rows appear only after a separately verified D1 ingestion step. This page does not fetch or import YoungPG products.</p>
          <div className="cf-table-scroll"><table><thead><tr><th>Listing</th><th>Supplier cost</th><th>Stock reported</th><th>Eligibility</th><th>Review status</th><th>Action</th></tr></thead><tbody>
          {review?.items.map(item => <tr key={`${item.connection_id}/${item.external_id}`}><td><strong>{item.name}</strong><small>{item.external_id}</small></td><td>{ngn(item.supplier_cost_minor)}</td><td>{item.stock_quantity}</td><td>{item.source_category === 'permitted_digital_good' && item.authorization_verified === 1 ? 'Rights recorded; server rechecks' : 'Not eligible for approval'}</td><td>{item.approval}</td><td>{item.approval === 'pending' ? <div className="cf-actions"><button className="cf-btn secondary" onClick={() => edit(item)} disabled={busy}>Review</button><button className="cf-btn danger" onClick={() => void decide(item, 'reject')} disabled={busy}>Reject</button></div> : '—'}</td></tr>)}
          {!review?.items.length && <tr><td colSpan={6}>No staged supplier rows. </td></tr>}
          </tbody></table></div>
        </section>
        {chosen && <section className="cf-panel cf-editor"><h2>Approve: {chosen.name}</h2><p className="cf-muted">Requires independently verified resale rights, an eligible source category, recent supplier scan and an active LOGSPOLL category. Publish the approved product separately after stock verification.</p>
          <form onSubmit={submit}>
            <label>LOGSPOLL category<select value={categoryId} onChange={e => setCategoryId(e.target.value)} required><option value="">Select category</option>{review?.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Selling price (₦)<input value={price} onChange={e => setPrice(e.target.value)} placeholder="Automatic supplier price" inputMode="decimal" /></label>
            <label>Delivery method<select value={delivery} onChange={e => setDelivery(e.target.value)}>{deliveryMethods.map(m => <option key={m} value={m}>{m}</option>)}</select></label>
            <label>Verified product description<textarea value={description} onChange={e => setDescription(e.target.value)} minLength={20} maxLength={10000} rows={5} required placeholder="Enter the verified product description; do not include credentials or account access details." /></label>
            <div className="cf-actions"><button type="submit" className="cf-btn" disabled={busy || !categoryId}>{busy ? 'Saving…' : 'Save review approval'}</button><button type="button" className="cf-btn secondary" onClick={() => setChosen(null)}>Cancel</button></div>
          </form>
        </section>}
      </>}
    </main></div>
  </div>
}
