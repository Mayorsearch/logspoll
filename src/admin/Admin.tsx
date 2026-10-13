import { cloudflareMode, cloudflareAuth } from '../lib/cloudflare-auth'
import { Fragment, useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import { Link, NavLink, Navigate, useNavigate, useParams } from 'react-router-dom'
import { LayoutDashboard, Users, Package, Tags, ShoppingBag, CreditCard, MessageSquare, Plug, LifeBuoy, Settings, UserCircle, LogOut, Menu, X, Plus, Search, Pencil, Eye, Check, Ban, DollarSign, TrendingUp, Wallet, CircleCheck, CircleX, ExternalLink, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { Profile } from '../pages/Dashboard'
import { adminSections } from './live-config'
import { Inputs, Modal } from './ui'
import type { Row } from './types'
import './demo-admin.css'
import SupplierSettings from './SupplierSettings'
import EmailNotifications from './EmailNotifications'
import PaymentProviders from './PaymentProviders'
import CloudflareAdmin from './CloudflareAdmin'

const navigation = [['overview', 'Dashboard overview', LayoutDashboard], ['customers', 'Customers', Users], ['products', 'Products', Package], ['categories', 'Categories', Tags], ['orders', 'Orders', ShoppingBag], ['purchases', 'Purchases', ShoppingBag], ['transactions', 'Transactions', CreditCard], ['reviews', 'Reviews', MessageSquare], ['integrations', 'API Integrations', Plug], ['support', 'Support tickets', LifeBuoy], ['settings', 'Website settings', Settings], ['profile', 'Admin profile', UserCircle]] as const
export default function Admin() {
  const { section = 'overview', tab } = useParams()
  const paymentSettings = section === 'settings' && tab === 'payment-providers'
  const emailSettings = section === 'settings' && tab === 'email-notifications'
  const supplierSettings = (section === 'settings' && tab === 'supplier-api') || (section === 'integrations' && !tab)
  const { session } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  async function logout() { const result = cloudflareMode ? (await cloudflareAuth('sign-out', {}), { error: null }) : await supabase?.auth.signOut({ scope: 'local' }); if (result?.error) setError('Sign out failed. Please retry.'); else navigate('/admin/login', { replace: true }) }
  // New D1 staging environment uses an isolated admin interface, never legacy Supabase queries.
  if (cloudflareMode) return <CloudflareAdmin />
  const item = navigation.find(item => item[0] === section)
  if (!item) return <Navigate to="/admin" replace />
  if (tab && !supplierSettings && !emailSettings && !paymentSettings) return <Navigate to={`/admin/${section}`} replace />
  return <div className="demo-admin reference-admin"><header className="demo-topbar admin-reference-topbar"><div className="admin-reference-brand"><button className="icon-button demo-menu" aria-label="Open admin navigation" aria-expanded={open} aria-controls="admin-navigation" onClick={() => setOpen(true)}><Menu size={20} /></button><Link to="/" className="brand">LOGS<span>POLL</span></Link><span className="admin-hq">ADMIN HQ</span></div><div className="admin-topbar-actions"><Link className="demo-mini-button" to="/admin/settings/supplier-api"><RefreshCw size={13} />Supplier API</Link><Link className="admin-live-store" to="/marketplace">Live Store <ExternalLink size={12} /></Link><Link to="/admin/profile" className="demo-account"><span><strong>LOGSPOLL Admin</strong><small>{session?.user.email}</small></span><span className="demo-avatar">AD</span></Link><button className="icon-button" onClick={logout} aria-label="Log out"><LogOut size={16} /></button></div></header><aside className={`demo-sidebar ${open ? 'is-open' : ''}`} id="admin-navigation"><button className="icon-button demo-close" aria-label="Close navigation" onClick={() => setOpen(false)}><X size={19} /></button><div className="demo-workspace admin-workspace"><span className="demo-avatar">LP</span><div><strong>Admin workspace</strong><small>LOGSPOLL operations</small></div></div><span className="demo-nav-label">OPERATIONS CONTROL</span><nav aria-label="Admin navigation">{navigation.map(([slug, title, Icon]) => <Fragment key={slug}>{slug === 'integrations' && <span className="demo-nav-label">INTEGRATIONS & CONFIG</span>}<NavLink to={slug === 'overview' ? '/admin' : `/admin/${slug}`} end={slug === 'overview'} key={slug} onClick={() => setOpen(false)}><Icon size={17} />{title}</NavLink></Fragment>)}</nav><div className="demo-sidebar-bottom"><Link className="text-link" to="/">View website →</Link><button className="text-link" onClick={logout}><LogOut size={16} />Log out</button>{error && <p role="alert">{error}</p>}</div></aside>{open && <button className="demo-backdrop" aria-label="Close navigation overlay" onClick={() => setOpen(false)} />}
    <div className="demo-main"><main className="demo-content"><div className="demo-heading"><span className="eyebrow">LOGSPOLL CONTROL CENTER</span><h1>{section === 'overview' ? 'Platform Command Center' : item[1]}</h1><p>Marketplace records, transactions, and product health.</p>{section === 'overview' && <div className="admin-command-actions"><Link className="demo-mini-button" to="/admin/customers"><Users size={13} />Manage Customers</Link><Link className="button" to="/admin/settings/supplier-api"><RefreshCw size={13} />Supplier API Sync</Link></div>}</div>{paymentSettings ? <PaymentProviders /> : emailSettings ? <EmailNotifications /> : supplierSettings ? <SupplierSettings /> : section === 'overview' ? <AdminOverview /> : section === 'profile' ? <Profile /> : <>{section === 'settings' && <div className="demo-panel demo-readiness"><div><h2>Supplier API</h2><p>Securely configure YoungPG, replace credentials and synchronize authorized products.</p></div><Link className="button" to="/admin/settings/supplier-api">Manage Supplier API</Link></div>}{section === 'settings' && <div className="demo-panel demo-readiness"><div><h2>Payment Providers</h2><p>Verify sandbox credentials, webhook configuration and launch blockers server-side.</p></div><Link className="button" to="/admin/settings/payment-providers">Payment provider status</Link></div>}{section === 'settings' && <div className="demo-panel demo-readiness"><div><h2>Email Notifications</h2><p>Preview branded messages and test the verified email provider using synthetic data.</p></div><Link className="button" to="/admin/settings/email-notifications">Manage Email Notifications</Link></div>}<DatabasePanel key={section} section={section} /></>}<footer className="demo-footer">LOGSPOLL Admin<span>Database authorization enforced by Supabase</span></footer></main></div></div>
}
function AdminOverview() {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const client = supabase!
    void Promise.all([
      client.from('profiles').select('id', { count: 'exact', head: true }),
      client.from('storefront_products').select('id', { count: 'exact', head: true }).gt('available_quantity', 0),
      client.from('storefront_products').select('id', { count: 'exact', head: true }).eq('available_quantity', 0),
    ]).then(results => {
      if (!active) return
      if (results.some(result => result.error)) { setError('Live summary records could not be loaded.'); return }
      setCounts({ customers: results[0].count ?? 0, inStock: results[1].count ?? 0, outOfStock: results[2].count ?? 0 })
    })
    return () => { active = false }
  }, [])
  const metrics = [
    { label: 'GROSS SALES', Icon: DollarSign, value: '—', detail: 'Reporting not connected', path: 'orders' },
    { label: 'TOTAL FUNDED', Icon: TrendingUp, value: '—', detail: 'Wallet reporting unavailable', path: 'transactions' },
    { label: 'USERS BALANCE', Icon: Wallet, value: '—', detail: 'Wallet reporting unavailable', path: 'transactions' },
    { label: 'CUSTOMERS', Icon: Users, value: error ? '—' : counts.customers ?? '…', detail: 'Manage users ›', path: 'customers' },
    { label: 'IN STOCK', Icon: CircleCheck, value: error ? '—' : counts.inStock ?? '…', detail: 'Approved catalog products', path: 'products' },
    { label: 'OUT OF STOCK', Icon: CircleX, value: error ? '—' : counts.outOfStock ?? '…', detail: 'Approved catalog products', path: 'products' },
  ]
  return <>{error && <p className="form-error" role="alert">{error}</p>}<div className="demo-stat-grid">{metrics.map(({ label, Icon, value, detail, path }) => <Link key={label} className="demo-stat" to={`/admin/${path}`}><span className="demo-stat-icon"><Icon size={16} /></span><span>{label}</span><strong>{value}</strong><small>{detail}</small></Link>)}</div><div className="demo-overview-grid"><OverviewRecords section="purchases" title="Recent Delivered Purchases" /><section className="demo-panel"><div className="demo-panel-heading"><h2><Wallet size={14} />Recent Wallet Activity</h2><Link to="/admin/transactions">View All</Link></div><div className="demo-table-wrap"><table><thead><tr>{['Reference', 'Customer', 'Type', 'Amount', 'Status'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody><tr><td colSpan={5} className="admin-wallet-empty">Wallet activity reporting is not connected. No balances or deposits are assumed.</td></tr></tbody></table></div></section></div><div className="demo-panel demo-readiness"><div><h2>Supplier approval and secure checkout</h2><p>Only verified, approved inventory may be published. No supplier purchases or payment success is simulated.</p></div><Link className="button" to="/admin/integrations">Supplier integration</Link></div></>
}
function OverviewRecords({ section, title }: { section: 'purchases' | 'customers'; title: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [state, setState] = useState('Loading records…')
  useEffect(() => {
    let active = true
    const config = adminSections[section]
    let request = supabase!.from(config.table).select(section === 'purchases' ? `${config.columns},order_items(product_name)` : config.columns)
    if (section === 'purchases') request = request.eq('payment_status', 'paid').eq('fulfillment_status', 'delivered')
    void request.order('created_at', { ascending: false }).limit(8).then(({ data, error }) => {
      if (!active) return
      if (error) { setState('Records could not be loaded. Open the management page to retry.'); return }
      setRows((data ?? []).map(value => { const record = value as unknown as Record<string, unknown>; return asRow({ ...record, product_name: Array.isArray(record.order_items) ? record.order_items.map(item => String(item.product_name ?? '')).join(', ') : '' }) }))
      setState(data?.length ? '' : `No ${section} yet.`)
    })
    return () => { active = false }
  }, [section])
  return <section className="demo-panel"><div className="demo-panel-heading"><h2>{title}</h2><Link to={`/admin/${section}`}>View All</Link></div><div className="demo-table-wrap"><table><thead><tr>{(section === 'purchases' ? ['Order ID', 'Customer ID', 'Product', 'Amount', 'Status'] : ['Customer', 'Joined']).map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{state ? <tr><td className="admin-wallet-empty" colSpan={section === 'purchases' ? 5 : 2} role="status">{state}</td></tr> : rows.map(row => <tr key={row.id}>{section === 'purchases' ? <><td><Link to="/admin/purchases">{row.reference}</Link></td><td title={row.customer_id}>{row.customer_id}</td><td title={row.product_name}>{row.product_name || '—'}</td><td>{new Intl.NumberFormat('en-NG', { style: 'currency', currency: row.currency }).format(Number(row.total_minor) / 100)}</td><td><span className="demo-status green">{row.fulfillment_status}</span></td></> : <><td><Link to="/admin/customers">{row.full_name || 'Unnamed customer'}</Link></td><td>{new Date(row.created_at).toLocaleDateString()}</td></>}</tr>)}</tbody></table></div></section>
}
function asRow(value: Record<string, unknown>): Row { return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item ?? '')])) }
function DatabasePanel({ section }: { section: string }) {
  const config = adminSections[section]
  const [rows, setRows] = useState<Row[]>([])
  const [categories, setCategories] = useState<Row[]>([])
  const [loading, setLoading] = useState(Boolean(config.table))
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('All')
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [syncState, setSyncState] = useState<Row | null>(null)
  const [dialog, setDialog] = useState<{ row: Row; mode: 'edit' | 'view' | 'approve' | 'settings' | 'fulfill' } | null>(null)
  useEffect(() => {
    let active = true
    if (!config.table || !supabase) return
    setLoading(true); setError('')
    void (async () => {
      try {
        let request = supabase.from(config.table).select(config.columns).limit(100)
        if (section === 'purchases') request = request.eq('payment_status', 'paid').eq('fulfillment_status', 'delivered')
        if (!['settings', 'integrations'].includes(section)) request = request.order('created_at', { ascending: false })
        const result = await request
        if (result.error) throw result.error
        if (active) setRows((result.data ?? []).map(value => asRow(value as unknown as Record<string, unknown>)))
        if (section === 'products' || section === 'integrations') {
          const cats = await supabase.from('categories').select('id,name').order('name'); if (cats.error) throw cats.error
          if (active) setCategories((cats.data ?? []).map(asRow))
        }
        if (section === 'integrations') { const state = await supabase.from('supplier_sync_state').select('*').eq('provider', 'shopviaclone22').maybeSingle(); if (state.error) throw state.error; if (active) setSyncState(state.data ? asRow(state.data) : null) }
      } catch { if (active) setError('Records unavailable. Check the table schema, reviewed migrations and administrator permissions.') }
      finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [section, attempt, config.table, config.columns])
  async function action(work: () => PromiseLike<{ error: { message: string } | null }>, success: string) {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try { const result = await work(); if (result.error) throw result.error; setMessage(success); setDialog(null); setAttempt(value => value + 1) }
    catch { setError('The operation failed. Verify your permissions and input, then retry. No success has been assumed.') }
    finally { setBusy(false) }
  }
  function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget)) as Row
    if (!dialog || !supabase) return
    const client = supabase
    if (Object.values(values).some(value => value.length > 10000)) { setError('Input is too long.'); return }
    if (section === 'products') void action(() => client.rpc('admin_save_product', { p: { ...values, id: dialog.row.id || null, authorized_resale: values.authorized_resale === 'true', available_quantity: Number(values.available_quantity), price_minor: Number(values.price_minor) } }), 'Product and inventory saved.')
    else if (section === 'categories') { const payload = { ...values, active: values.active === 'true' }; void action(() => dialog.row.id ? client.from('categories').update(payload).eq('id', dialog.row.id) : client.from('categories').insert(payload), 'Category saved.') }
    else if (section === 'support') void action(() => client.from('support_tickets').update({ status: values.status, reply: values.reply }).eq('id', dialog.row.id), 'Ticket reply saved. Email delivery is not configured.')
    else if (dialog.mode === 'approve') void action(() => client.rpc('approve_supplier_listing', { external_product_id: dialog.row.external_id, category_uuid: values.category_id, selling_price_minor: Number(values.price_minor), delivery_method: values.delivery_type, authorization_evidence: values.authorization_ref }), 'Listing approved and product published.')
    else if (dialog.mode === 'fulfill') {
      try { const delivery: unknown = JSON.parse(values.delivery); if (typeof delivery !== 'object' || !delivery || Array.isArray(delivery)) throw new Error(); void action(() => client.rpc('admin_fulfill_order', { order_uuid: dialog.row.id, delivery }), 'Verified paid order fulfilled.') }
      catch { setError('Provide an object mapping every order-item UUID to permitted delivery instructions.') }
    } else if (dialog.mode === 'settings') void action(() => client.from('website_settings').upsert({ key: 'general', value: values }), 'Website settings saved.')
  }
  async function sync() {
    if (busy || !supabase) return
    setBusy(true); setError(''); setMessage('')
    try {
      const { data } = await supabase.auth.getSession()
      const response = await fetch('/api/admin/supplier-sync', { method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` } })
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Supplier backend unavailable. Run the Cloudflare Pages Functions runtime.')
      const body = await response.json() as { error?: string; imported?: number }
      if (!response.ok) throw new Error(body.error ?? 'Synchronization failed.')
      setMessage(`${body.imported ?? 0} verified eligible listings refreshed. Pending listings require approval.`); setAttempt(value => value + 1)
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Supplier backend unavailable. Use the Cloudflare Pages runtime.') }
    finally { setBusy(false) }
  }
  const statuses = [...new Set(rows.map(row => row.status ?? row.approval).filter(Boolean))]
  const filtered = rows.filter(row => Object.values(row).join(' ').toLowerCase().includes(query.toLowerCase()) && (status === 'All' || (row.status ?? row.approval) === status))
  const fields = section === 'support' ? config.fields.filter(field => ['status', 'reply'].includes(field.key)) : section === 'products' ? config.fields.map(field => field.key === 'category_id' ? { ...field, options: categories.map(category => category.id) } : field) : config.fields
  return <>{message && <p className="form-success" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}{section === 'integrations' && <div className="demo-panel demo-preferences"><h2>ShopViaClone22 · secure catalog connector</h2><p>GET /api/products.php · server-side API key · only verified allowlisted inventory. No supplier purchases.</p><p>Last attempt: {syncState?.last_attempt_at || 'Never'}<br />Last success: {syncState?.last_success_at || 'Never'}<br />Status: {syncState?.message || 'Not synchronized'}</p><button className="button" disabled={busy} onClick={sync}>{busy ? 'Synchronizing…' : 'Synchronize eligible catalog'}</button></div>}
    <section className="demo-panel"><div className="demo-record-toolbar"><div className="demo-tabs">{['All', ...statuses].map(value => <button key={value} aria-pressed={status === value} className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>{value}</button>)}</div><div className="button-row"><button className="demo-mini-button" disabled={loading || busy} onClick={() => setAttempt(value => value + 1)}>Refresh</button>{['products', 'categories'].includes(section) && <button className="button" onClick={() => setDialog({ row: {}, mode: 'edit' })}><Plus size={15} />Add {section === 'products' ? 'product' : 'category'}</button>}{section === 'settings' && <button className="button" onClick={() => setDialog({ row: {}, mode: 'settings' })}>Edit website settings</button>}</div></div><div className="demo-search-row"><label className="search-input"><Search size={17} /><span className="sr-only">Search records</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search records…" /></label></div>{loading ? <p className="demo-empty" role="status">Loading records…</p> : !config.table ? <p className="demo-empty">Payment processing and the transaction ledger are not configured. No transactions are simulated.</p> : <div className="demo-table-wrap"><table><thead><tr>{config.fields.filter(field => field.type !== 'textarea').slice(0, 6).map(field => <th key={field.key}>{field.label}</th>)}<th>Actions</th></tr></thead><tbody>{filtered.map((row, index) => <tr key={row.id || row.external_id || row.key || index}>{config.fields.filter(field => field.type !== 'textarea').slice(0, 6).map(field => <td key={field.key}>{row[field.key] || '—'}</td>)}<td><div className="demo-row-actions"><button className="icon-button" aria-label="View record" onClick={() => setDialog({ row, mode: 'view' })}><Eye size={16} /></button>{config.editable && <button className="icon-button" aria-label="Edit record" onClick={async () => { if (section === 'products') { const result = await supabase!.from('inventory').select('available_quantity').eq('product_id', row.id).maybeSingle(); if (result.error) { setError('Inventory unavailable.'); return }; setDialog({ row: { ...row, available_quantity: String(result.data?.available_quantity ?? 0) }, mode: 'edit' }) } else setDialog({ row, mode: 'edit' }) }}><Pencil size={16} /></button>}{section === 'reviews' && <><button className="icon-button" aria-label="Approve review" disabled={busy} onClick={() => void action(() => supabase!.rpc('moderate_review', { review_uuid: row.id, decision: 'approved' }), 'Review approved.')}><Check size={16} /></button><button className="icon-button" aria-label="Reject review" disabled={busy} onClick={() => void action(() => supabase!.rpc('moderate_review', { review_uuid: row.id, decision: 'rejected' }), 'Review rejected.')}><Ban size={16} /></button></>}{section === 'integrations' && <><button className="demo-mini-button" onClick={() => setDialog({ row, mode: 'approve' })}>Approve listing</button><button className="demo-mini-button" disabled={busy} onClick={() => void action(() => supabase!.rpc('reject_supplier_listing', { external_product_id: row.external_id }), 'Supplier listing rejected and any published product disabled.')}>Reject</button></>}{section === 'orders' && row.payment_status === 'paid' && row.fulfillment_status !== 'delivered' && <button className="demo-mini-button" onClick={() => setDialog({ row, mode: 'fulfill' })}>Record permitted delivery</button>}</div></td></tr>)}</tbody></table>{!filtered.length && <p className="demo-empty">{error ? 'Records could not be verified.' : 'No matching records.'}</p>}</div>}<div className="demo-table-footer">Up to 100 records · Customer and payment records are never fabricated</div></section>
    {dialog && <Modal title={dialog.mode === 'view' ? 'Record details' : dialog.mode === 'approve' ? 'Approve verified supplier listing' : dialog.mode === 'settings' ? 'Website settings' : dialog.mode === 'fulfill' ? 'Record permitted delivery' : 'Save record'} onClose={() => { if (!busy) setDialog(null) }}>{dialog.mode === 'view' ? <dl className="demo-detail-list">{Object.entries(dialog.row).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl> : <form className="account-form" onSubmit={save}><fieldset disabled={busy}><Inputs values={dialog.row} fields={dialog.mode === 'approve' ? [{ key: 'category_id', label: 'Category UUID', options: categories.map(category => category.id) }, { key: 'price_minor', label: 'Customer selling price (NGN kobo)', type: 'number' }, { key: 'delivery_type', label: 'Delivery method', options: ['Licensed digital download', 'Redemption code', 'Subscription activation', 'Manual fulfillment'] }, { key: 'authorization_ref', label: 'Resale authorization evidence reference' }] : dialog.mode === 'settings' ? [{ key: 'site_name', label: 'Website name' }, { key: 'support_email', label: 'Support email', type: 'email' }] : dialog.mode === 'fulfill' ? [{ key: 'delivery', label: 'Order-item UUIDs and permitted instructions (JSON)', type: 'textarea' }] : fields} /><p>Only authorized products and permitted delivery records may be published. Supplier cost is separate from customer selling price.</p><button className="button">{busy ? 'Saving…' : 'Save to database'}</button>{error && <p className="form-error" role="alert">{error}</p>}</fieldset></form>}</Modal>}
  </>
}
