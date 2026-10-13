import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { cloudflareAuth, cloudflareRequest } from '../lib/cloudflare-auth'
import { useAuth } from '../auth/AuthProvider'
import './cloudflare-admin.css'
import CloudflareCatalog from './CloudflareCatalog'

type Counts = { customers: number; products: number; orders: number }
type FeedItem = {
  connection_id: string; external_id: string; name: string; source_category: string
  supplier_cost_minor: number; stock_quantity: number; authorization_verified: number
  source_checked_at: number; approval: 'pending' | 'approved' | 'rejected'
  category_id: string | null; selling_price_minor: number | null
  delivery_type: string | null; reviewed_at: number | null
  supplier_description?: string
}
type ReviewSnapshot = {
  environment: string; supplierSyncEnabled: boolean; publicationEnabled: boolean
  legacyApprovalsImported: boolean; counts: { approval: string; total: number }[]
  items: FeedItem[]; categories: { id: string; name: string }[]
}
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
  const { section } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const [overview, setOverview] = useState<Counts | null>(null)
  const [review, setReview] = useState<ReviewSnapshot | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [chosen, setChosen] = useState<FeedItem | null>(null)
  const [categoryId, setCategoryId] = useState('')
  const [price, setPrice] = useState('')
  const [delivery, setDelivery] = useState<string>(deliveryMethods[0])
  const [description, setDescription] = useState('')
  const viewing = ['products', 'integrations', 'supplier-review', 'settings'].includes(section ?? '') ? 'review' : section === 'payments' ? 'payments' : 'overview'

  const refresh = useCallback(() => {
    return Promise.all([
        cloudflareRequest<{ records: Counts[] }>('/api/admin/overview'),
        cloudflareRequest<ReviewSnapshot>('/api/admin/supplier-review'),
      ]).then(([o,r])=>{
      setError('')
      setOverview(o.records?.[0] ?? null)
      setReview(r)
    }).catch(problem=>{
      setError(problem instanceof Error ? problem.message : 'Staging administrator data unavailable.')
    }).finally(()=>setLoading(false))
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  function edit(item: FeedItem) {
    setChosen(item); setCategoryId(item.category_id ?? '')
    setPrice(item.selling_price_minor == null ? '' : String(item.selling_price_minor / 100))
    setDelivery(item.delivery_type ?? deliveryMethods[0]); setDescription(item.supplier_description==='Description not supplied by supplier; administrator review required.'?'':item.supplier_description??''); setError(''); setNotice('')
  }
  async function decide(item: FeedItem, action: 'approve' | 'reject') {
    if (busy) return
    if (action === 'reject' && !window.confirm('Reject this staging review item? This does not change your live Supabase approvals.')) return
    setBusy(true); setError(''); setNotice('')
    try {
      const body = action === 'approve'
        ? { action, connection_id: item.connection_id, external_id: item.external_id, category_id: categoryId,
            price_minor: toKobo(price), delivery_type: delivery, description }
        : { action, connection_id: item.connection_id, external_id: item.external_id }
      const result = await cloudflareRequest<{ review: string; published: boolean }>('/api/admin/supplier-review', body)
      if (result.published) throw new Error('Unexpected publication reported; stop and investigate.')
      setNotice(`Staging decision saved: ${result.review}. This item was not published or added to sellable inventory.`)
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
  return <div className="cf-admin">
    <aside className="cf-nav" aria-label="Staging administrator navigation">
      <Link to="/admin" className="cf-brand">LOGS<span>POLL</span><small>Staging admin</small></Link>
      <Link className={viewing === 'overview' ? 'current' : ''} to="/admin">Overview</Link>
      <Link className={viewing === 'review' ? 'current' : ''} to="/admin/products">Supplier reviews</Link>
      <Link className={viewing === 'payments' ? 'current' : ''} to="/admin/payments">Payments (locked)</Link>
      <div className="cf-nav-bottom"><Link to="/">Back to website</Link><button onClick={() => void logout()} disabled={busy}>Sign out</button></div>
    </aside>
    <main className="cf-main">
      <header className="cf-header"><div><div className="cf-eyebrow">CLOUDFLARE D1 · STAGING ONLY</div><h1>{viewing === 'overview' ? 'Dashboard overview' : viewing === 'review' ? 'Supplier reviews' : 'Payment status'}</h1><p>Verified admin session: {session?.user.email ?? '—'}</p></div><button className="cf-btn secondary" onClick={() => void refresh()} disabled={busy || loading}>Refresh</button></header>
      <p className="cf-warning" role="status">This environment contains staging data only. Legacy Supabase approvals have not been imported. No review decision here publishes products, updates stock, or enables payments.</p>
      {loading && <p role="status">Loading authenticated staging records…</p>}
      {error && <p className="cf-error" role="alert">{error}</p>}
      {notice && <p className="cf-success" role="status">{notice}</p>}
      {viewing==='review'&&<CloudflareCatalog onComplete={refresh}/>}
      {viewing === 'overview' && <>
        <div className="cf-metrics">
          <div><span>Customers (D1 staging)</span><strong>{overview?.customers ?? '—'}</strong></div>
          <div><span>Products (D1 staging)</span><strong>{overview?.products ?? '—'}</strong></div>
          <div><span>Orders (D1 staging)</span><strong>{overview?.orders ?? '—'}</strong></div>
          <div><span>Pending staged reviews</span><strong>{review ? pending : '—'}</strong></div>
        </div>
        <section className="cf-panel"><h2>Migration status</h2><p>Supplier synchronization to D1: <strong>{review?.supplierSyncEnabled?'Configured; verify actual progress in supplier reviews':'Disabled pending migration and configuration'}</strong></p><p>Sellable supplier inventory: <strong>Disabled</strong></p><p>Bachs live payments: <strong>Disabled</strong></p><p>Original Supabase products and the pending approval queue are not represented by these staging counts.</p><Link className="cf-btn" to="/admin/products">Open staging supplier reviews</Link></section>
      </>}
      {viewing === 'payments' && <section className="cf-panel"><h2>Bachs integration</h2><p>Payments and automatic fulfillment are deliberately disabled during the D1 migration. Do not accept live payments or assume the old Supabase sandbox ledger has been migrated.</p></section>}
      {viewing === 'review' && <>
        <div className="cf-metrics"><div><span>Pending</span><strong>{review ? pending : '—'}</strong></div><div><span>Approved (not published)</span><strong>{review ? approved : '—'}</strong></div><div><span>Rejected</span><strong>{review ? rejected : '—'}</strong></div></div>
        <section className="cf-panel"><h2>Staging catalog review queue</h2><p className="cf-muted">Rows appear only after a separately verified D1 ingestion step. This page does not fetch or import YoungPG products.</p>
          <div className="cf-table-scroll"><table><thead><tr><th>Listing</th><th>Supplier cost</th><th>Stock reported</th><th>Eligibility</th><th>Review status</th><th>Action</th></tr></thead><tbody>
          {review?.items.map(item => <tr key={`${item.connection_id}/${item.external_id}`}><td><strong>{item.name}</strong><small>{item.external_id}</small></td><td>{ngn(item.supplier_cost_minor)}</td><td>{item.stock_quantity}</td><td>{item.source_category === 'permitted_digital_good' && item.authorization_verified === 1 ? 'Rights recorded; server rechecks' : 'Not eligible for approval'}</td><td>{item.approval}</td><td>{item.approval === 'pending' ? <div className="cf-actions"><button className="cf-btn secondary" onClick={() => edit(item)} disabled={busy}>Review</button><button className="cf-btn danger" onClick={() => void decide(item, 'reject')} disabled={busy}>Reject</button></div> : '—'}</td></tr>)}
          {!review?.items.length && <tr><td colSpan={6}>No staged supplier rows. This is not the 29-item legacy Supabase queue.</td></tr>}
          </tbody></table></div>
        </section>
        {chosen && <section className="cf-panel cf-editor"><h2>Approve: {chosen.name}</h2><p className="cf-muted">Requires independently verified resale rights, an eligible source category, recent supplier scan and an active LOGSPOLL category. A review approval does not make this product sellable.</p>
          <form onSubmit={submit}>
            <label>LOGSPOLL category<select value={categoryId} onChange={e => setCategoryId(e.target.value)} required><option value="">Select category</option>{review?.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Selling price (₦)<input value={price} onChange={e => setPrice(e.target.value)} placeholder="2500.00" inputMode="decimal" required /></label>
            <label>Delivery method<select value={delivery} onChange={e => setDelivery(e.target.value)}>{deliveryMethods.map(m => <option key={m} value={m}>{m}</option>)}</select></label>
            <label>Verified product description<textarea value={description} onChange={e => setDescription(e.target.value)} minLength={20} maxLength={10000} rows={5} required placeholder="Enter the verified product description; do not include credentials or account access details." /></label>
            <div className="cf-actions"><button type="submit" className="cf-btn" disabled={busy || !categoryId}>{busy ? 'Saving…' : 'Save review approval'}</button><button type="button" className="cf-btn secondary" onClick={() => setChosen(null)}>Cancel</button></div>
          </form>
        </section>}
      </>}
    </main>
  </div>
}
