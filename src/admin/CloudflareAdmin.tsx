import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { LayoutDashboard, Users, Package, Tags, ShoppingBag, CreditCard, MessageSquare, Plug, LifeBuoy, Settings, LogOut, Menu, X, ExternalLink, RefreshCw, ShieldCheck, Mail, Sparkles } from 'lucide-react'
import { cloudflareAuth, cloudflareRequest } from '../lib/cloudflare-auth'
import { useAuth } from '../auth/AuthProvider'
import './demo-admin.css'
import './reference-admin.css'
import './cloudflare-admin.css'
import './d1-reference-theme.css'
import CloudflareCatalog from './CloudflareCatalog'
import CloudflarePayments from './CloudflarePayments'
import AdminRecords from './AdminRecords'
import HstoraReview from './HstoraReview'
import HstoraManager from './HstoraManager'
import Shopviaclone22Manager from './Shopviaclone22Manager'
import DigitalCoreManager from './DigitalCoreManager'
import SupplierAutomation from './SupplierAutomation'
import ApiManager from './ApiManager'
import StorefrontDiscoveryManager from './StorefrontDiscoveryManager'
import WalletAdmin from './WalletAdmin'
import { ProductArtwork } from '../components/ProductArtwork'
import { storedProductImages } from '../lib/product-images'

type Counts = { customers: number; products: number; orders: number; revenue_minor?: number; paid_orders?: number }
type FeedItem = {
  connection_id: string; external_id: string; name: string; source_category: string
  supplier_cost_minor: number; stock_quantity: number; authorization_verified: number
  source_checked_at: number; approval: 'pending' | 'approved' | 'rejected'
  category_id: string | null; selling_price_minor: number | null
  delivery_type: string | null; reviewed_at: number | null
  supplier_description?: string; reviewed_description?: string; product_id?: string
  publication_blockers?: string[]
  supplier_image_urls?:string
}
type Cursor={connection:string;external:string}
type ReviewSnapshot = {
  environment: string; supplierSyncEnabled: boolean; publicationEnabled: boolean
  legacyApprovalsImported: boolean; counts: { approval: string; total: number }[]
  items: FeedItem[]; categories: { id: string; name: string }[]
  discovery?: {connection_id:string;external_id:string;name:string;description?:string;image_urls?:string;blocked_reason?:string;cost_minor?:number;stock?:number;approval?:string;selling_price_minor?:number|null}[]
  sourceCategories?: {connection_id:string;kind:string;external_id:string;name:string}[]
  discoveryCounts?: {total:number;blocked:number}
  nextCursor?:Cursor|null
}
const d1Nav = [
  { slug: 'overview', label: 'Dashboard overview', Icon: LayoutDashboard },
  { slug: 'wallets', label: 'Wallet Management', Icon: CreditCard },
  { slug: 'customers', label: 'Customers', Icon: Users },
  { slug: 'products', label: 'Products', Icon: Package },
  { slug: 'categories', label: 'Categories', Icon: Tags },
  { slug: 'orders', label: 'Orders', Icon: ShoppingBag },
  { slug: 'price_review', label: 'Price Review', Icon: ShoppingBag },
  { slug: 'purchases', label: 'Purchases', Icon: ShoppingBag },
  { slug: 'reviews', label: 'Reviews', Icon: MessageSquare },
  { slug: 'api-manager', label: 'API Manager', Icon: RefreshCw },
  { slug: 'discovery', label: 'Storefront Discovery', Icon: Sparkles },
  { slug: 'server1', label: 'Server 1 · HStora', Icon: Plug },
  { slug: 'server2', label: 'Server 2 · YoungPG', Icon: Plug },
  { slug: 'server3', label: 'Server 3 · ShopViaClone22', Icon: Plug },
  { slug: 'server4', label: 'Server 4 · DigitalCore', Icon: Plug },
  { slug: 'integrations', label: 'Supplier Hub & Pricing', Icon: RefreshCw },
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
  const editorRef = useRef<HTMLElement>(null)
  const [reviewReady, setReviewReady] = useState(false)
  const [preparingKey, setPreparingKey] = useState('')
  const [reviewIssue, setReviewIssue] = useState('')
  const [priceIssue, setPriceIssue] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [price, setPrice] = useState('')
  const [delivery, setDelivery] = useState<string>(deliveryMethods[0])
  const [description, setDescription] = useState('')
  const [automaticPrice,setAutomaticPrice]=useState(false)
  const [selectedListings,setSelectedListings]=useState<string[]>([]),[bulkMode,setBulkMode]=useState('fixed_markup'),[bulkAmount,setBulkAmount]=useState('')
  const [discoveryCursor,setDiscoveryCursor]=useState<Cursor|null>(null)
  const [cursorTrail,setCursorTrail]=useState<(Cursor|null)[]>([])
  const [discoveryFilter,setDiscoveryFilter]=useState('')
  const [serverTab, setServerTab] = useState<'api' | 'review' | 'pricing'>('api')
  useEffect(() => {
    setServerTab(tab === 'review' ? 'review' : 'api')
  }, [section, tab])
  const recordSections=['products','categories','customers','orders','price_review','purchases','support','reviews','settings','audit','email']
  const viewing =
    section === 'wallets' ? 'wallets' :
    section === 'server1' ? 'server1' :
    section === 'server2' ? 'server2' :
    section === 'server3' ? 'server3' :
    section === 'server4' ? 'server4' :
    section === 'api-manager' ? 'api-manager' :
    section === 'discovery' ? 'discovery' :
    ['integrations','supplier-hub'].includes(section??'') ? 'hub' :
    ['supplier-review'].includes(section??'')||tab==='supplier-api' ? 'review' :
    section === 'payments' ? 'payments' :
    recordSections.includes(section??'') ? 'records' : 'overview'

  const refresh = useCallback(() => {
    void cloudflareRequest<{schemaReady:boolean}>('/api/admin/readiness').then(r=>{if(!r.schemaReady)setNotice('D1 migration 0006_admin_publication.sql is required.')}).catch(e=>setError(e.message))
    return Promise.all([
        cloudflareRequest<{ records: Counts[] }>('/api/admin/overview'),
        cloudflareRequest<ReviewSnapshot>(`/api/admin/supplier-review?${discoveryFilter}${discoveryCursor?'&'+new URLSearchParams({after_connection:discoveryCursor.connection,after_external:discoveryCursor.external}):''}`),
      ]).then(([o,r])=>{
      setError('')
      setOverview(o.records?.[0] ?? null)
      setReview(r)
    }).catch(problem=>{
      setError(problem instanceof Error ? problem.message : 'Administrator data unavailable.')
    }).finally(()=>setLoading(false))
  }, [discoveryCursor,discoveryFilter])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (chosen) editorRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    })
  }, [chosen])

  function edit(item: FeedItem) {
    setChosen(item); setCategoryId(item.category_id ?? '')
    setPriceIssue('')
    setAutomaticPrice(false)
    setPrice(item.selling_price_minor == null ? '' : String(item.selling_price_minor / 100))
    setDelivery(item.delivery_type ?? deliveryMethods[0]); setDescription(item.reviewed_description|| (item.supplier_description==='Description not supplied by supplier; administrator review required.'?'':item.supplier_description??'')); setError(''); setNotice('')
  }
  async function prepare(item:{
    connection_id:string;
    external_id:string
  }) {
    const key = `${item.connection_id}/${item.external_id}`
    const staged = review?.items.find(
      x => x.connection_id === item.connection_id &&
           x.external_id === item.external_id
    )

    setPreparingKey(key)
    setReviewIssue('')
    setPriceIssue('')
    setReviewReady(false)
    setBusy(true)
    setError('')

    // Show existing staged details immediately.
    if (staged) {
      edit(staged)
    } else {
      const discovered = review?.discovery?.find(
        x => x.connection_id === item.connection_id &&
             x.external_id === item.external_id
      )

      if (discovered) {
        edit({
          connection_id: discovered.connection_id,
          external_id: discovered.external_id,
          name: discovered.name,
          source_category: 'unverified',
          supplier_cost_minor: discovered.cost_minor ?? 0,
          stock_quantity: discovered.stock ?? 0,
          authorization_verified: 0,
          source_checked_at: 0,
          approval: discovered.approval === 'approved'
            || discovered.approval === 'rejected'
            ? discovered.approval : 'pending',
          category_id: null,
          selling_price_minor:
            discovered.selling_price_minor ?? null,
          delivery_type: null,
          reviewed_at: null,
          supplier_description:
            discovered.description ?? '',
          supplier_image_urls: discovered.image_urls
        })
      }
    }

    try {
      const result = await cloudflareRequest<{
        item:FeedItem;
        categories:{id:string;name:string}[]
      }>('/api/admin/supplier-review', {
        action:'prepare',
        ...item
      })

      setReview(r => r ? {
        ...r,
        categories:result.categories
      } : r)

      setReviewReady(true)
      setChosen(result.item)
      setCategoryId(current => current || result.item.category_id || '')
      setPrice(current => current || (result.item.selling_price_minor == null ? '' : String(result.item.selling_price_minor / 100)))
      setDescription(current => current || result.item.reviewed_description || result.item.supplier_description || '')
    } catch (e) {
      const message = e instanceof Error
        ? e.message
        : 'Supplier verification could not complete.'

      setReviewIssue(message)
      setError(message)
    } finally {
      setBusy(false)
    }
  }
  function closeEditor() {
    setChosen(null)
    setReviewReady(false)
    setReviewIssue('')
    setPriceIssue('')
  }
  async function saveIndividualPrice() {
    if (!chosen || busy || automaticPrice) return
    setPriceIssue('')
    setNotice('')
    const staged = reviewReady || Boolean(review?.items.some(
      item => item.connection_id === chosen.connection_id && item.external_id === chosen.external_id
    ))
    if (!staged) {
      setPriceIssue('This listing is not staged for pricing yet. Complete Review verification first; a supplier API cooldown may require retrying later.')
      return
    }
    let amount: number
    try {
      amount = toKobo(price)
      if (amount <= 0) throw new Error('Enter a selling price greater than zero.')
    } catch (problem) {
      setPriceIssue(problem instanceof Error ? problem.message : 'Invalid selling price.')
      return
    }
    setBusy(true)
    try {
      await cloudflareRequest('/api/admin/supplier-review', {
        action: 'bulk_price', mode: 'price', amount,
        items: [{ connection_id: chosen.connection_id, external_id: chosen.external_id }]
      })
      setChosen(current => current ? { ...current, selling_price_minor: amount } : current)
      setNotice(`Selling price saved: ${ngn(amount)}. This does not approve or publish the product.`)
      await refresh()
    } catch (problem) {
      setPriceIssue(problem instanceof Error ? problem.message : 'Could not save selling price.')
    } finally {
      setBusy(false)
    }
  }
  async function priceSelected(){
    if(!selectedListings.length)return
    if(!/^\d+(?:\.\d{1,2})?$/.test(bulkAmount)){setError('Enter a price/markup with at most two decimal places.');return}
    if(!window.confirm('Save selling-price overrides for selected listings? Supplier sync will preserve these prices.'))return
    setBusy(true);setError('');try{await cloudflareRequest('/api/admin/supplier-review',{action:'bulk_price',mode:bulkMode,amount:toKobo(bulkAmount),items:selectedListings.map(key=>{const [connection_id,external_id]=key.split('/');return{connection_id,external_id}})});setSelectedListings([]);setNotice('Selected selling prices saved.');await refresh()}catch(e){setError(e instanceof Error?e.message:'Prices were not saved.')}finally{setBusy(false)}
  }
  async function decide(item: FeedItem, action: 'approve' | 'reject') {
    if (busy) return
    if (action === 'reject' && !window.confirm('Reject this supplier review item? Published stock for this listing will be disabled.')) return
    setBusy(true); setError(''); setNotice('')
    try {
      const body = action === 'approve'
        ? { action, connection_id: item.connection_id, external_id: item.external_id, category_id: categoryId,
            ...(automaticPrice?{pricing_mode:'auto'}:{price_minor:toKobo(price)}), delivery_type: delivery, description,
            delivery_verified: true, privacy_verified: true, provider_verified: true, review_reference: 'system-authorized', publish: true }
        : { action, connection_id: item.connection_id, external_id: item.external_id }
      await cloudflareRequest<{ review: string; published: boolean }>('/api/admin/supplier-review', body)

      setNotice('Listing approved and published live to storefront!')
      closeEditor()
      await refresh()
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Review was not saved.') }
    finally { setBusy(false) }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (chosen) void decide(chosen, 'approve')
  }
  function searchDiscovery(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=new FormData(event.currentTarget)
    setDiscoveryCursor(null);setCursorTrail([])
    setDiscoveryFilter(new URLSearchParams(Object.fromEntries(['q','category','stock','approval'].map(k=>[k,String(form.get(k)??'')]))).toString())
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
          {slug==='server1' && <span className="demo-nav-label">SUPPLIER SERVERS</span>}
          {slug==='support' && <span className="demo-nav-label">SYSTEM & CONFIG</span>}
          <NavLink end={slug==='overview'} onClick={() => setOpen(false)} to={slug==='overview'?'/admin':`/admin/${slug}`}>
            <Icon size={17}/>{label}
          </NavLink>
        </Fragment>)}
      </nav>
      <div className="demo-sidebar-bottom"><Link className="text-link" to="/">View website →</Link><button className="text-link" type="button" onClick={() => void logout()} disabled={busy}><LogOut size={16}/> Log out</button></div>
    </aside>
    {open && <button type="button" className="demo-backdrop" aria-label="Close navigation overlay" onClick={() => setOpen(false)}/>}
    <div className="demo-main"><main className="demo-content">
      <header className="cf-header demo-heading"><div><div className="cf-eyebrow">LOGSPOLL CONTROL CENTER</div><h1>{viewing === 'overview' ? 'Platform Command Center' : viewing === 'wallets' ? 'Customer Wallet Management' : viewing === 'server1' ? 'Server 1 · HStora' : viewing === 'server2' ? 'Server 2 · YoungPG' : viewing === 'server3' ? 'Server 3 · ShopViaClone22' : viewing === 'server4' ? 'Server 4 · DigitalCore' : viewing === 'hub' ? 'Supplier Hub & Pricing' : viewing === 'review' ? 'Supplier reviews' : viewing==='records'?section:'Payment status'}</h1><p>Verified admin session: {session?.user.email ?? '—'}</p></div><button className="cf-btn secondary" onClick={() => void refresh()} disabled={busy || loading}>Refresh</button></header>
      <p className="cf-warning" role="status">Cloudflare D1 production database. Supplier sync auto-approves and publishes live immediately. Payments remain disabled.</p>
      {loading && <p role="status">Loading administrator records…</p>}
      {error && <p className="cf-error" role="alert">{error}</p>}
      {notice && <p className="cf-success" role="status">{notice}</p>}
      {viewing==='wallets'&&<WalletAdmin/>}
      {viewing==='records'&&<AdminRecords key={section} section={section!}/>}
      {viewing==='server1' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="cf-panel" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Server 1 · HStora</h2>
              <p style={{ margin: '2px 0 0', color: 'var(--admin-muted)', fontSize: '0.85rem' }}>
                Add API key & signing secret, test connection, sync catalog, and review products.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={`cf-btn ${serverTab === 'api' ? '' : 'secondary'}`}
                onClick={() => setServerTab('api')}
              >
                API Configuration
              </button>
              <button
                type="button"
                className={`cf-btn ${serverTab === 'review' ? '' : 'secondary'}`}
                onClick={() => setServerTab('review')}
              >
                Products & Catalog Review
              </button>
            </div>
          </div>
          {serverTab === 'api' ? <HstoraManager onComplete={refresh} /> : <HstoraReview provider="hstora" />}
        </div>
      )}
      {viewing==='server2' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="cf-panel" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Server 2 · YoungPG</h2>
              <p style={{ margin: '2px 0 0', color: 'var(--admin-muted)', fontSize: '0.85rem' }}>
                Manage YoungPG credentials, category allowlist, pricing markup, and approvals.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={`cf-btn ${serverTab === 'api' ? '' : 'secondary'}`}
                onClick={() => setServerTab('api')}
              >
                API Configuration & Allowlist
              </button>
              <button
                type="button"
                className={`cf-btn ${serverTab === 'review' ? '' : 'secondary'}`}
                onClick={() => setServerTab('review')}
              >
                Products & Catalog Review
              </button>
            </div>
          </div>
          {serverTab === 'api' ? <CloudflareCatalog showHstora={false} onComplete={refresh} /> : <HstoraReview provider="youngpg" />}
        </div>
      )}
      {viewing==='server3' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="cf-panel" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Server 3 · ShopViaClone22</h2>
              <p style={{ margin: '2px 0 0', color: 'var(--admin-muted)', fontSize: '0.85rem' }}>
                Enter API credentials, test provider connectivity, batch sync products, and manage pricing.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={`cf-btn ${serverTab === 'api' ? '' : 'secondary'}`}
                onClick={() => setServerTab('api')}
              >
                API Configuration
              </button>
              <button
                type="button"
                className={`cf-btn ${serverTab === 'pricing' ? '' : 'secondary'}`}
                onClick={() => setServerTab('pricing')}
              >
                Pricing & Markup
              </button>
            </div>
          </div>
          {serverTab === 'api' ? <Shopviaclone22Manager onComplete={refresh} /> : <SupplierAutomation />}
        </div>
      )}
      {viewing==='server4' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <DigitalCoreManager onComplete={refresh} />
        </div>
      )}
      {viewing==='api-manager' && (
        <ApiManager
          initialTab={tab === 'server2' ? 'server2' : tab === 'server3' ? 'server3' : tab === 'pricing' ? 'pricing' : 'server1'}
          onComplete={refresh}
        />
      )}
      {viewing==='discovery' && (
        <StorefrontDiscoveryManager />
      )}
      {viewing==='hub'&&<SupplierAutomation/>}
      {viewing==='review'&&<CloudflareCatalog onComplete={refresh}/>}
      {viewing === 'overview' && <>
        <div className="cf-metrics">
          <div><span>CUSTOMERS</span><strong>{overview?.customers ?? '—'}</strong></div>
          <div><span>PRODUCTS</span><strong>{overview?.products ?? '—'}</strong></div>
          <div><span>ORDERS</span><strong>{overview?.orders ?? '—'}</strong></div>
          <div><span>PAID ORDERS</span><strong>{overview?.paid_orders ?? 0}</strong></div>
          <div><span>TOTAL REVENUE</span><strong>{overview?.revenue_minor !== undefined ? ngn(overview.revenue_minor) : '₦0.00'}</strong></div>
          <div><span>PENDING REVIEWS</span><strong>{review ? pending : '—'}</strong></div>
          <div><span>APPROVED REVIEWS</span><strong>{review ? approved : '—'}</strong></div>
          <div><span>REJECTED REVIEWS</span><strong>{review ? rejected : '—'}</strong></div>
        </div>
        <section className="cf-panel"><h2>Migration status</h2><p>Supplier synchronization to D1: <strong>{review?.supplierSyncEnabled?'Configured; verify actual progress in supplier reviews':'Disabled pending migration and configuration'}</strong></p><p>Sellable supplier inventory: <strong>Verified publication only</strong></p><p>Bachs live payments: <strong>Disabled</strong></p><p>All displayed records come from this D1 database.</p><Link className="cf-btn" to="/admin/products">Open supplier reviews</Link></section>
      </>}
      {viewing === 'payments' && <CloudflarePayments/>}
      {viewing === 'review' && <>
        <div className="cf-metrics"><div><span>Pending</span><strong>{review ? pending : '—'}</strong></div><div><span>Approved</span><strong>{review ? approved : '—'}</strong></div><div><span>Rejected</span><strong>{review ? rejected : '—'}</strong></div></div>
        {chosen && <section ref={editorRef} className="cf-panel cf-editor" id="supplier-review-editor" aria-label="Selected supplier listing review"><h2>Review and price: {chosen.name}</h2><p className="cf-muted">Manage listing category, selling price and delivery method. Approved listings publish live to the storefront immediately.</p>
          <form onSubmit={submit}>
      {busy && preparingKey === `${chosen.connection_id}/${chosen.external_id}` &&
        <p className="cf-warning" role="status">Checking current YoungPG product details…</p>}
      {!reviewReady && <p className="cf-warning" role="status">
        Product details are available for review. Approval needs fresh supplier verification.
        {reviewIssue && ` ${reviewIssue}`}
      </p>}
      {reviewReady && <p className="cf-success" role="status">Current supplier verification passed. You can now complete the approval checklist.</p>}
      {priceIssue && <p role="alert" className="cf-error">{priceIssue}</p>}
            <label>LOGSPOLL category<select value={categoryId} onChange={e => setCategoryId(e.target.value)} required><option value="">Select category</option>{review?.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Selling price (₦)<input value={price} onChange={e => setPrice(e.target.value)} disabled={automaticPrice || busy} required={!automaticPrice} placeholder="Enter your selling price" inputMode="decimal" /></label>
            <div className="cf-review-price">
              <p>Supplier cost: <strong>{ngn(chosen.supplier_cost_minor)}</strong>. Saving a price does not publish the listing.</p>
              <button type="button" className="cf-btn secondary" onClick={() => void saveIndividualPrice()} disabled={busy || automaticPrice || !price.trim()}>Save selling price only</button>
            </div>
            <label className="catalog-checkbox"><input type="checkbox" checked={automaticPrice} onChange={e=>setAutomaticPrice(e.target.checked)}/> Use supplier cost as selling price; automatically track cost changes</label>
            <label>Delivery method<select value={delivery} onChange={e => setDelivery(e.target.value)}>{deliveryMethods.map(m => <option key={m} value={m}>{m}</option>)}</select></label>
            <label>Product description<textarea value={description} onChange={e => setDescription(e.target.value)} minLength={20} maxLength={10000} rows={5} required placeholder="Enter the product description." /></label>
            <div className="cf-actions"><button type="submit" className="cf-btn" disabled={busy || !reviewReady || !categoryId}>{busy ? 'Saving…' : 'Approve & Publish Live to Store'}</button><button type="button" className="cf-btn secondary" onClick={closeEditor}>Close editor</button><Link className="cf-btn secondary" to="/admin/products">Manage publication in Products</Link></div>
          </form>
        </section>}
        <section className="cf-panel"><h2>Supplier discovery · {review?.discoveryCounts?.total??0} metadata records</h2><p>All supplier categories remain visible here. Discovery is private and never grants approval. Older checkpoints gain complete discovery metadata on the next scheduled scan.</p>
          <details><summary>Supplier categories and subcategories ({review?.sourceCategories?.length??0})</summary><p>{review?.sourceCategories?.map(c=><span key={`${c.connection_id}/${c.kind}/${c.external_id}`}>{c.name} ({c.kind}) · </span>)}</p></details>
          <form className="catalog-filters" onSubmit={searchDiscovery}><input name="q" placeholder="Search all supplier listings" aria-label="Search supplier listings"/><select name="category" aria-label="Supplier category"><option value="">All categories</option>{review?.sourceCategories?.filter(c=>c.kind==='category').map(c=><option key={`${c.connection_id}/${c.external_id}`} value={c.external_id}>{c.name}</option>)}</select><select name="stock" aria-label="Stock"><option value="">All stock</option><option value="in-stock">In stock</option><option value="out-of-stock">Out of stock</option></select><select name="approval" aria-label="Approval"><option value="">All review states</option>{['pending','approved','rejected','blocked'].map(s=><option key={s}>{s}</option>)}</select><button className="cf-btn secondary">Search / filter</button></form>
          <div className="cf-actions"><span>{selectedListings.length}/25 selected — bulk pricing requires staged products</span><select aria-label="Supplier pricing mode" value={bulkMode} onChange={e=>setBulkMode(e.target.value)}><option value="fixed_markup">Fixed markup (NGN)</option><option value="percent_markup">Percentage markup (%)</option><option value="price">Selling price (NGN)</option></select><input aria-label="Supplier price or markup" inputMode="decimal" value={bulkAmount} onChange={e=>setBulkAmount(e.target.value)}/><button className="cf-btn secondary" disabled={busy||!selectedListings.length} onClick={()=>void priceSelected()}>Save selected prices</button></div>
          <div className="cf-table-scroll"><table className="catalog-mobile-table"><thead><tr><th>Select / image</th><th>Listing</th><th>Review / price</th></tr></thead><tbody>{review?.discovery?.map(item=><tr key={`${item.connection_id}/${item.external_id}`}><td data-label="Select / image"><input type="checkbox" aria-label={`Select ${item.name}`} checked={selectedListings.includes(`${item.connection_id}/${item.external_id}`)} disabled={busy||selectedListings.length>=25&&!selectedListings.includes(`${item.connection_id}/${item.external_id}`)} onChange={e=>setSelectedListings(old=>e.target.checked?[...old,`${item.connection_id}/${item.external_id}`]:old.filter(key=>key!==`${item.connection_id}/${item.external_id}`))}/><span className="catalog-thumbnail"><ProductArtwork name={item.name} images={storedProductImages(item.image_urls)}/></span></td><td data-label="Listing"><strong>{item.name}</strong><details><summary>Product description</summary><p>{item.description||'Supplier description unavailable; verified manual details required.'}</p></details></td><td data-label="Review / price"><p>Cost: {ngn(item.cost_minor??0)} · Selling: {item.selling_price_minor==null?'Set a price':ngn(item.selling_price_minor)}</p><p>{item.blocked_reason??`Review: ${item.approval??'pending'}; confirm delivery/privacy/provider checks before publication.`}</p><button className="cf-btn secondary" disabled={busy} onClick={()=>void prepare(item)}>
      {busy && preparingKey === `${item.connection_id}/${item.external_id}`
        ? 'Loading review…' : 'Review / edit'}
    </button>
    {reviewIssue && preparingKey === `${item.connection_id}/${item.external_id}` &&
      <p className="cf-error" role="alert">{reviewIssue}</p>}</td></tr>)}</tbody></table></div>
          <div className="cf-actions"><button className="cf-btn secondary" disabled={loading||!cursorTrail.length} onClick={()=>{setDiscoveryCursor(cursorTrail.at(-1)??null);setCursorTrail(t=>t.slice(0,-1))}}>Previous</button><span>Page {cursorTrail.length+1}</span><button className="cf-btn secondary" disabled={loading||!review?.nextCursor} onClick={()=>{setCursorTrail(t=>[...t,discoveryCursor]);setDiscoveryCursor(review!.nextCursor!)}}>Next</button></div>
        </section>
        <section className="cf-panel"><h2>Supplier catalog review queue</h2><p className="cf-muted">Rows appear only after a separately verified D1 ingestion step. This page does not fetch or import YoungPG products.</p>
          <div className="cf-table-scroll"><table className="catalog-mobile-table"><thead><tr><th>Listing</th><th>Supplier cost</th><th>Stock reported</th><th>Eligibility</th><th>Review status</th><th>Action</th></tr></thead><tbody>
          {review?.items.map(item => <tr key={`${item.connection_id}/${item.external_id}`}><td data-label="Listing"><span className="catalog-thumbnail"><ProductArtwork name={item.name} images={storedProductImages(item.supplier_image_urls)}/></span><strong>{item.name}</strong><small>{item.external_id}</small></td><td data-label="Supplier cost">{ngn(item.supplier_cost_minor)}</td><td data-label="Stock reported">{item.stock_quantity}</td><td data-label="Eligibility">{item.source_category === 'permitted_digital_good' && item.authorization_verified === 1 ? 'Rights recorded; server rechecks' : 'Not eligible for approval'}<small>{item.publication_blockers?.join('; ')}</small></td><td data-label="Review status">{item.approval}</td><td data-label="Actions">{<div className="cf-actions"><button className="cf-btn secondary" onClick={() => void prepare(item)} disabled={busy}>
      {busy && preparingKey === `${item.connection_id}/${item.external_id}`
        ? 'Loading review…' : 'Review'}
    </button>
    {reviewIssue && preparingKey === `${item.connection_id}/${item.external_id}` &&
      <p className="cf-error" role="alert">{reviewIssue}</p>}<button className="cf-btn danger" onClick={() => void decide(item, 'reject')} disabled={busy}>Reject</button></div>}</td></tr>)}
          {!review?.items.length && <tr><td colSpan={6}>No staged supplier rows. </td></tr>}
          </tbody></table></div>
        </section>

      </>}
    </main></div>
  </div>
}
