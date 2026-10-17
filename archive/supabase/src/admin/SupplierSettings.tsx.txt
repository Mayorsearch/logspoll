import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Modal } from './ui'

interface Supplier {
  id: string; provider: string; name: string; base_url: string; enabled: boolean; revision: number
  authorized_products: Record<string, string>; last_sync_at: string | null; last_status: string; imported_count: number
}
interface Listing { external_id: string; name: string; description: string; external_category_id: string; supplier_cost_minor: number; currency: string; stock_quantity: number; approval: string; product_id: string | null; selling_price_override_minor: number | null; publication_enabled: boolean; catalog_metadata?: { image_urls?: string[] }; products: { price_minor: number; status: string; description: string } | null }
interface Category { id: string; name: string; external_id?: string; markup_basis_points?: number }
interface SyncReadiness { ready: boolean; blockers: string[]; pending: number | null; approved: number | null; progress: { connection_id: string; phase: string; next_page: number; scanned: number; skipped_details: number; imported: number | null }[] }
const fresh = () => ({ id: '', provider: 'youngpg', name: 'YoungPG Media', base_url: 'https://youngpgmedia.com.ng', enabled: false, revision: 0, authorized_products: {}, last_sync_at: null, last_status: 'Not configured', imported_count: 0 }) as Supplier
async function api(body?: Record<string, unknown>) {
  const session = await supabase?.auth.getSession()
  if (!session?.data.session) throw new Error('Sign in again with your verified administrator account.')
  const response = await fetch('/api/admin/suppliers', { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${session.data.session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Supplier backend unavailable. Use the Cloudflare Pages runtime; Vite alone does not run Functions.')
  const result = await response.json() as { error?: string; sync?: SyncReadiness; suppliers?: Supplier[]; categories?: Category[]; imported?: number; detail_enrichment_skipped?: number; id?: string; job_id?: string; done?: boolean }
  if (!response.ok) throw new Error(result.error ?? 'Supplier operation failed.')
  return result
}
export default function SupplierSettings() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [draft, setDraft] = useState<Supplier>(fresh)
  const [evidence, setEvidence] = useState('{}')
  const [pricingReady, setPricingReady] = useState(false)
  const [syncReady, setSyncReady] = useState<SyncReadiness | null>(null)
  const [items, setItems] = useState<Listing[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [supplierCategories, setSupplierCategories] = useState<Category[]>([])
  const [editor, setEditor] = useState<Listing | null>(null)
  const [approval, setApproval] = useState<Listing | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [dirty, setDirty] = useState(false)
  const keyInput = useRef<HTMLInputElement>(null)
  function select(value: Supplier) {
    setDraft(value); setEvidence(JSON.stringify(value.authorized_products, null, 2)); setDirty(false)
    setItems([]); setSupplierCategories([]); setMessage('')
    if (keyInput.current) keyInput.current.value = ''
  }
  async function refresh(selectedId?: string) {
    const result = await api()
    setSyncReady(result.sync ?? null)
    setSuppliers(result.suppliers ?? [])
    if (selectedId) { const value = result.suppliers?.find(value => value.id === selectedId); if (value) select(value) }
  }
  useEffect(() => {
    let active = true
    void api().then(result => { if (active) { setSyncReady(result.sync ?? null); setSuppliers(result.suppliers ?? []); if (result.suppliers?.[0]) select(result.suppliers[0]) } }).catch(problem => { if (active) setError(problem instanceof Error ? problem.message : 'Supplier settings unavailable.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    let active = true
    if (!draft.id || !supabase) return
    const client = supabase
    void Promise.all([client.from('supplier_feed_items').select('external_id,name,description,external_category_id,supplier_cost_minor,currency,stock_quantity,approval,product_id,selling_price_override_minor,publication_enabled,catalog_metadata,products:product_id(price_minor,status,description)').eq('connection_id', draft.id).order('name').limit(500), client.from('categories').select('id,name').eq('active', true).order('name'), client.from('supplier_feed_categories').select('external_id,name,markup_basis_points').eq('connection_id', draft.id).order('name')]).then(async ([feed, local, source]) => {
      const extended = !feed.error && !source.error
      if (feed.error?.code === '42703') feed = await client.from('supplier_feed_items').select('external_id,name,description,external_category_id,supplier_cost_minor,currency,stock_quantity,approval,product_id,products:product_id(price_minor,status,description)').eq('connection_id', draft.id).order('name').limit(500) as unknown as typeof feed
      if (source.error?.code === '42703') source = await client.from('supplier_feed_categories').select('external_id,name').eq('connection_id', draft.id).order('name') as unknown as typeof source
      if (!active) return
      if (feed.error || local.error || source.error) { setError('Supplier listings unavailable. Apply reviewed migration 202610120001_catalog_refresh_pricing.sql and verify administrator policies.'); return }
      setPricingReady(extended); setItems((feed.data ?? []).map(row => ({ ...row, products: Array.isArray(row.products) ? row.products[0] ?? null : row.products })) as unknown as Listing[]); setCategories(local.data ?? []); setSupplierCategories((source.data ?? []).map(category => ({ ...category, id: category.external_id })))
    })
    return () => { active = false }
  }, [draft.id, draft.last_sync_at, message])
  useEffect(() => {
    if (!busy || !draft.id) return
    let active = true
    const timer = window.setInterval(() => { void api().then(result => { const value = result.suppliers?.find(item => item.id === draft.id); if (active && value) { setSyncReady(result.sync ?? null); setDraft(previous => ({ ...previous, last_status: value.last_status })) } }).catch(() => {}) }, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [busy, draft.id])
  async function run(work: () => Promise<string>, refreshOnFailure = true) {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try { const success = await work(); setMessage(success) }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Supplier operation failed.'); if (draft.id && refreshOnFailure) { try { await refresh(draft.id) } catch { /* Keep original error. */ } } }
    finally { setBusy(false) }
  }
  function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const replace = (event.nativeEvent as globalThis.SubmitEvent).submitter?.getAttribute('value') === 'replace'
    const key = keyInput.current?.value ?? ''
    if (replace && !key) { setError('Enter a new API key to replace the saved credential.'); return }
    let authorized: unknown
    try { authorized = JSON.parse(evidence) } catch { setError('Resale evidence must be a JSON object mapping product IDs to evidence references.'); return }
    void run(async () => {
      try {
        const result = await api({ action: 'save', ...draft, authorized_products: authorized, ...(key ? { api_key: key } : {}) })
        await refresh(result.id)
        return 'Configuration saved. The saved key is never returned. Test the connection before synchronizing.'
      } finally { if (keyInput.current) keyInput.current.value = '' }
    }, false)
  }
  function connect(action: 'test' | 'categories' | 'sync') {
    void run(async () => {
      let result = await api({ action, id: draft.id })
      // Each request commits one private checkpoint. Closing/reloading is safe:
      // the next Sync Catalog click resumes the server's saved job.
      for (let batches = 1; action === 'sync' && result.done === false; batches++) {
        if (batches >= 2000 || !result.job_id) throw new Error('Sync stopped safely; retry to resume the saved checkpoint.')
        await new Promise(resolve => window.setTimeout(resolve, 1500))
        result = await api({ action, id: draft.id, job_id: result.job_id })
      }
      await refresh(draft.id)
      if (action === 'categories') setSupplierCategories(result.categories ?? [])
      return action === 'sync' ? `${result.imported ?? 0} eligible listings synchronized. Pending products require approval before publication.${result.detail_enrichment_skipped ? ` ${result.detail_enrichment_skipped} product details were not enriched because YoungPG's detail endpoint was unreachable. Review descriptions and images before publishing.` : ''}` : action === 'categories' ? `${result.categories?.length ?? 0} supplier categories fetched.` : 'Connection authenticated; category response validated. Listings have not yet been synchronized.'
    })
  }
  function approve(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    void run(async () => { await api({ action: 'approve', id: draft.id, external_id: approval!.external_id, category_id: values.category_id, price_minor: pricingReady && values.price_minor === '' ? null : Number(values.price_minor), delivery_type: values.delivery_type, description: values.description }); setApproval(null); return 'Authorized product approved at the configured selling price.' })
  }
  async function catalog(item: Listing | null, operation: string, settings: Record<string, unknown>) {
    if (!pricingReady) { setError('Apply reviewed migration 202610120001_catalog_refresh_pricing.sql to enable pricing and publication controls. Existing approval remains available.'); return }
    await run(async () => { await api({ action: 'catalog', id: draft.id, external_id: item?.external_id, operation, settings }); return 'Catalog settings saved.' })
  }
  const canConnect = Boolean(draft.id && draft.enabled && !dirty && !busy && !loading)
  return <><div className="button-row"><Link className="text-link" to="/admin/settings">← Website settings</Link><button className="demo-mini-button" disabled={busy || loading} onClick={() => select(fresh())}>Add supplier configuration</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
    {!pricingReady && !loading && <p role="status">Advanced catalog controls require reviewed migration 202610120001_catalog_refresh_pricing.sql. Existing connection, sync and approval controls remain available.</p>}
    <section className="demo-panel demo-preferences"><h2>Supplier API</h2><p>Read-only catalog integration. Use a YoungPG key with <strong>listings:read</strong> scope only. Keys are encrypted on the server and never displayed after saving.</p>
      {loading ? <p role="status">Loading supplier configuration…</p> : suppliers.length > 0 && <label>Saved supplier<select aria-label="Saved supplier" value={draft.id} disabled={busy} onChange={event => select(suppliers.find(item => item.id === event.target.value) ?? fresh())}><option value="">New configuration</option>{suppliers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <form className="account-form" onSubmit={save} onChange={() => setDirty(true)}><fieldset disabled={busy || loading}>
        <label>Provider adapter<select value={draft.provider} onChange={event => setDraft({ ...draft, provider: event.target.value })}><option value="youngpg">YoungPG Media (verified documentation)</option></select></label>
        <label>Supplier name<input required maxLength={120} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Supplier API URL<input type="url" required value={draft.base_url} onChange={event => setDraft({ ...draft, base_url: event.target.value })} /><small>Only the documented YoungPG HTTPS origin is permitted by this adapter.</small></label>
        <label>Authentication method<input readOnly value="X-API-Key request header" /></label>
        <label>API key {draft.id ? '(leave blank to retain saved key)' : ''}<input ref={keyInput} type="password" name="supplier_api_key" autoComplete="new-password" required={!draft.id} maxLength={100} placeholder="Enter new YoungPG key" /></label>
        <label>Supplier status<select value={String(draft.enabled)} onChange={event => setDraft({ ...draft, enabled: event.target.value === 'true' })}><option value="false">Disabled</option><option value="true">Enabled</option></select></label>
        <label>Verified resale evidence (JSON: product ID → license/transfer reference)<textarea rows={4} maxLength={50000} value={evidence} onChange={event => setEvidence(event.target.value)} spellCheck={false} /><small>An empty object blocks imports. An API listing alone does not establish transfer authorization. Accounts, cookies and login credentials are excluded.</small></label>
        <div className="button-row"><button className="button" type="submit">{busy ? 'Working…' : 'Save Configuration'}</button>{draft.id && <button className="demo-mini-button" type="submit" value="replace">Save / Replace API Key</button>}</div>
      </fieldset></form>
      <p>GET /api/v1/categories · GET /api/v1/listings · NGN prices → integer kobo</p>
      <div className="button-row"><button className="demo-mini-button" disabled={!canConnect} onClick={() => connect('test')}>Test Connection</button><button className="demo-mini-button" disabled={!canConnect} onClick={() => connect('categories')}>Fetch Categories</button><button className="button" disabled={!canConnect || !syncReady?.ready} onClick={() => connect('sync')}>Sync Catalog</button><button className="demo-mini-button" disabled={busy || loading} onClick={() => void run(async () => { await refresh(draft.id); return 'Supplier status refreshed.' })}>Refresh status</button></div>
      {syncReady?.blockers.map(blocker => <p className="form-error" role="status" key={blocker}>{blocker}</p>)}
      {syncReady && <p>Pending approvals: {syncReady.pending ?? 'Unverified'} · Approved listings: {syncReady.approved ?? 'Unverified'}</p>}
      {syncReady?.progress.filter(job => job.connection_id === draft.id).map(job => <p role="status" key={job.connection_id}>Saved progress: {job.phase} · next page {job.next_page} · {job.scanned} scanned · {job.imported ?? 'Not finalized'} imported · {job.skipped_details} optional details skipped. Closing this page retains the checkpoint.</p>)}
      {dirty && <p>Save your changes before testing or synchronizing.</p>}<dl className="demo-detail-list"><div><dt>Last sync status</dt><dd>{draft.last_status}</dd></div><div><dt>Last successful sync</dt><dd>{draft.last_sync_at ? new Date(draft.last_sync_at).toLocaleString() : 'Never'}</dd></div><div><dt>Synchronized products (authorized only)</dt><dd>{draft.imported_count}</dd></div><div><dt>Synchronized categories</dt><dd>{supplierCategories.length}</dd></div><div><dt>Approved / published</dt><dd>{items.filter(item => item.approval === 'approved').length} / {items.filter(item => item.products?.status === 'active' && item.approval === 'approved').length}</dd></div><div><dt>Hidden or pending</dt><dd>{items.filter(item => item.approval !== 'approved' || item.products?.status !== 'active').length}</dd></div></dl>
      <form className="account-form" onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); void catalog(null, 'markup', { category_id: values.get('supplier_category'), basis_points: Math.round(Number(values.get('markup')) * 100) }) }}><fieldset disabled={busy || dirty || !draft.id || !pricingReady}><h3>Automatic category pricing</h3><label>Supplier category<select name="supplier_category" required><option value="">Select category</option>{supplierCategories.map(category => <option key={category.id} value={category.id}>{category.name} · {(category.markup_basis_points ?? 0) / 100}%</option>)}</select></label><label>Markup (%)<input name="markup" type="number" min="0" max="1000" step="0.01" required /></label><button className="demo-mini-button">Save markup</button><small>Applies to new approvals and products reset to automatic pricing. Existing prices remain manual overrides.</small></fieldset></form>
      {supplierCategories.length > 0 && <ul>{supplierCategories.map(category => <li key={category.id}>{category.name} · {category.id}</li>)}</ul>}
    </section>
    <section className="demo-panel"><div className="demo-panel-heading"><h2>Eligible supplier products</h2><p>Supplier cost and your manual selling price are separate. Manual overrides survive sync. New approvals use automatic supplier-category markup by default; existing prices require an explicit reset. Stock is cleared on configuration changes or failed connections.</p></div><div className="demo-table-wrap"><table><thead><tr><th>Product / supplier ID</th><th>API images</th><th>Supplier cost</th><th>Selling price / override</th><th>Stock</th><th>Approval</th><th>Actions</th></tr></thead><tbody>{items.map(item => <tr key={item.external_id}><td>{item.name}<small> · {item.external_id} · Supplier category: {item.external_category_id.startsWith('unmatched-') ? 'Unmatched — choose LOGSPOLL category manually' : item.external_category_id}</small></td><td>{item.catalog_metadata?.image_urls?.length ? item.catalog_metadata.image_urls.map(url => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} width={48} height={48} loading="lazy" referrerPolicy="no-referrer" alt={item.name} /></a>) : 'Not provided by API'}</td><td>{new Intl.NumberFormat('en-NG', { style: 'currency', currency: item.currency }).format(item.supplier_cost_minor / 100)}</td><td>{item.products && pricingReady ? <form onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); void catalog(item, 'price', { price_minor: Number(values.get('price_minor')) }) }}><label>Selling price (kobo)<input key={item.products.price_minor} name="price_minor" aria-label={`Selling price for ${item.name} in kobo`} type="number" min="0" max="99999999900" step="1" defaultValue={item.products.price_minor} required disabled={busy || dirty} /></label><small>{item.selling_price_override_minor == null ? 'Automatic category markup' : 'Manual override'}</small><button className="demo-mini-button" disabled={busy || dirty}>Save price</button></form> : item.products ? `${item.products.price_minor} kobo · edit through approval` : 'Approve before setting price'}</td><td>{item.stock_quantity}</td><td>{item.approval}</td><td><div className="button-row"><button className="demo-mini-button" disabled={busy || dirty} onClick={() => setApproval(item)}>Approve / set selling price</button><button className="demo-mini-button" disabled={busy || dirty} onClick={() => void run(async () => { await api({ action: 'reject', id: draft.id, external_id: item.external_id }); return 'Listing rejected and publication disabled.' })}>Reject</button>{item.product_id && pricingReady && <><button className="demo-mini-button" disabled={busy || dirty} onClick={() => void catalog(item, 'auto', {})}>Reset to automatic</button><button className="demo-mini-button" disabled={busy || dirty} onClick={() => void catalog(item, 'publication', { enabled: item.products?.status !== 'active' })}>{item.products?.status === 'active' ? 'Hide product' : 'Show approved product'}</button><button className="demo-mini-button" disabled={busy || dirty} onClick={() => setEditor(item)}>Edit public description</button></>}</div></td></tr>)}</tbody></table>{!items.length && <p className="demo-empty">No eligible supplier products loaded. Configure, authorize and sync permitted inventory.</p>}</div><p className="demo-table-footer"><Link to="/admin/products">Manage published selling prices and availability →</Link></p></section>
    {editor && <Modal title={`Edit ${editor.name}`} onClose={() => { if (!busy) setEditor(null) }}><form className="account-form" onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); void run(async () => { await api({ action: 'catalog', id: draft.id, external_id: editor.external_id, operation: 'description', settings: { description: values.get('description') } }); setEditor(null); return 'Public description saved.' }) }}><label>Public description<textarea name="description" minLength={20} maxLength={10000} required rows={6} defaultValue={editor.products?.description ?? ''} disabled={busy} /></label><button className="button" disabled={busy}>Save description</button>{error && <p role="alert" className="form-error">{error}</p>}</form></Modal>}
    {approval && <Modal title={`Approve ${approval.name}`} onClose={() => { if (!busy) setApproval(null) }}><form className="account-form" onSubmit={approve}><fieldset disabled={busy}><p>Approval publishes this fresh, authorized listing in the private customer catalog.</p><label>LOGSPOLL category<select name="category_id" required><option value="">Select category</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Verified product description<textarea name="description" required minLength={20} maxLength={10000} rows={4} defaultValue={approval.products?.description ?? (approval.description.startsWith('Description not supplied by supplier;') ? '' : approval.description)} placeholder="Describe the licensed product accurately. Do not include credentials or personal data." /><small>YoungPG may omit descriptions. Review and provide correct product details before publishing.</small></label><label>Selling price override (NGN kobo)<input name="price_minor" type="number" min="0" max="99999999900" step="1" required={!pricingReady} defaultValue={pricingReady ? approval.selling_price_override_minor ?? '' : approval.products?.price_minor ?? ''} placeholder={pricingReady ? 'Automatic supplier cost + category markup' : 'Required until pricing migration is applied'} /><small>{pricingReady ? 'Leave blank for automatic pricing on new products. Existing overrides are retained; use Reset to automatic to remove them. Entering 0 is an explicit zero-price override.' : 'Current database requires an explicit selling price.'}</small></label><label>Permitted delivery method<select name="delivery_type">{['Licensed digital download', 'Redemption code', 'Subscription activation', 'Manual fulfillment'].map(value => <option key={value}>{value}</option>)}</select></label><button className="button">Approve product</button>{error && <p className="form-error" role="alert">{error}</p>}</fieldset></form></Modal>}
  </>
}
