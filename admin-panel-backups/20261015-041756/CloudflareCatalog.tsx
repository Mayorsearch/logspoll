import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { cloudflareRequest } from '../lib/cloudflare-auth'

interface Supplier {
  id: string; name: string; enabled: number; revision: number; last_status: string
  phase?: string; page?: number; scanned?: number; total?: number
  supplier_wide_authorized?: number
  job_id?:string;last_verified_scan_at?:number;next_attempt?:number;automatic_enabled?:number
}

export default function CloudflareCatalog({ onComplete }: { onComplete: () => Promise<void> }) {
  const [rows, setRows] = useState<Supplier[]>([])
  const [id, setId] = useState('')
  const [name, setName] = useState('YoungPG Media')
  const [enabled, setEnabled] = useState(false)
  const [authorizationRef, setAuthorizationRef] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [writeReady,setWriteReady]=useState(false)
  const [resumeAt,setResumeAt]=useState<string|null>(null)
  const key = useRef<HTMLInputElement>(null)

  async function refresh() {
    const result = await cloudflareRequest<{ suppliers: Supplier[];writeReady:boolean;resumeAt:string|null }>('/api/admin/catalog')
    setRows(result.suppliers)
    setWriteReady(result.writeReady);setResumeAt(result.resumeAt)
  }
  useEffect(() => {
    let active = true
    void cloudflareRequest<{ suppliers: Supplier[];writeReady:boolean;resumeAt:string|null }>('/api/admin/catalog').then(result => {
      if (!active) return
      setRows(result.suppliers)
      setWriteReady(result.writeReady);setResumeAt(result.resumeAt)
      const first = result.suppliers.find(row => row.enabled)
      if (first) { setId(first.id); setName(first.name); setEnabled(true) }
    }).catch(error => {
      if (active) setStatus(error instanceof Error ? error.message : 'Catalog configuration unavailable.')
    })
    return () => { active = false }
  }, [])
  function select(value: string) {
    setId(value)
    const row = rows.find(r => r.id === value)
    setName(row?.name ?? 'YoungPG Media')
    setEnabled(Boolean(row?.enabled))
    setAuthorizationRef('')
    if (key.current) key.current.value = ''
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setStatus('')
    try {
      const reference = authorizationRef.trim()
      const result = await cloudflareRequest<{ id: string }>('/api/admin/catalog', {
        action: 'save', ...(id ? { id } : {}), name, enabled,
        revision: rows.find(r => r.id === id)?.revision ?? 0,
        ...(reference ? { authorized_products: { '*': reference } } : {}),
        ...(key.current?.value ? { api_key: key.current.value } : {}),
      })
      setId(result.id)
      setAuthorizationRef('')
      await refresh()
      setStatus('Supplier configuration saved. Stored API keys are never displayed.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save unavailable.')
    } finally {
      if (key.current) key.current.value = ''
      setBusy(false)
    }
  }
  async function sync() {
    setBusy(true)
    setStatus('')
    try {
      const result=await cloudflareRequest<{job_id:string;message:string}>('/api/admin/catalog',{action:'sync',id})
      setStatus(`${result.message} Job: ${result.job_id}`)
      await refresh()
      await onComplete()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Sync paused; saved checkpoint retained.')
    } finally { setBusy(false) }
  }
  async function control(action:'automatic'|'stock'|'categories',automatic?:boolean){
    setBusy(true)
    try{const result=await cloudflareRequest<{message?:string}>('/api/admin/catalog',{action,id,...(automatic===undefined?{}:{enabled:automatic})});setStatus(result.message??`Automatic full scans ${automatic?'enabled':'paused'}. Published stock checks remain active.`);await refresh()}
    catch(error){setStatus(error instanceof Error?error.message:'Control unavailable.')}
    finally{setBusy(false)}
  }
  const selected = rows.find(row => row.id === id)
  return <section className="cf-panel catalog-panel">
    <h2>YoungPG catalog synchronization</h2>
    <p>Read-only supplier access. Eligible products enter review after a complete snapshot; importing never approves products or makes purchases.</p>
    {!writeReady&&<p className="cf-warning" role="status">Catalog writes paused{resumeAt?` until ${new Date(resumeAt).toLocaleString()}`:': synchronization is disabled'}. Existing records are preserved.</p>}
    <form className="catalog-config-form" onSubmit={save}>
      <fieldset disabled={busy||!writeReady}>
        <label className="catalog-field">Supplier
          <select value={id} onChange={event => select(event.target.value)}>
            <option value="">New supplier</option>
            {rows.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label className="catalog-field">Supplier name
          <input value={name} onChange={event => setName(event.target.value)} required maxLength={120}/>
        </label>
        <label className="catalog-field">API URL
          <input value="https://youngpgmedia.com.ng" readOnly/>
        </label>
        <label className="catalog-field">Replace API key (optional if already saved)
          <input ref={key} type="password" autoComplete="off" placeholder="Saved keys are never displayed"/>
        </label>
        <label className="catalog-field catalog-wide">Supplier-wide resale authorization reference
          <textarea value={authorizationRef} onChange={event => setAuthorizationRef(event.target.value)}
            rows={3} maxLength={1000} placeholder="Reference your actual YoungPG agreement or written confirmation"/>
        </label>
        <p className="catalog-help">For authorization covering YoungPG's entire eligible catalog, enter a reference to your genuine supplier agreement or confirmation once. Leave blank to retain your previously saved authorization. Listings involving access credentials or private data need appropriate transfer, privacy and payment-provider checks before publication.</p>
        {selected?.supplier_wide_authorized === 1 &&
          <p className="catalog-note" role="status">Supplier-wide authorization reference recorded. Product review and stock checks are still required.</p>}
        <label className="catalog-checkbox"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/> Enabled</label>
        <button type="submit" className="cf-btn catalog-save" disabled={busy}>{busy ? 'Saving…' : 'Save / replace key'}</button>
      </fieldset>
    </form>
    <div className="catalog-actions">
      <button type="button" className="cf-btn" disabled={busy || !writeReady || !id || !selected?.enabled} onClick={() => void sync()}>Sync Now / retry</button>
      <button type="button" className="cf-btn secondary" disabled={busy||!writeReady||!selected?.enabled} onClick={()=>void control('categories')}>Fetch categories / subcategories</button>
      <button type="button" className="cf-btn secondary" disabled={busy||!writeReady||!selected?.enabled} onClick={()=>void control('stock')}>Refresh stock only</button>
      <button type="button" className="cf-btn secondary" disabled={busy||!writeReady||!id} onClick={()=>void control('automatic',selected?.automatic_enabled===0)}>Automatic full scans: {selected?.automatic_enabled===0?'OFF':'ON'}</button>
      <button type="button" className="cf-btn secondary" disabled={busy} onClick={() => void refresh().catch(() => setStatus('Status unavailable.'))}>Refresh progress</button>
    </div>
    {status && <p role="status" className="catalog-status">{status}</p>}
    {rows.map(row => <div key={row.id} className="catalog-progress"><p>{row.name}: {row.last_status} · {row.scanned ?? 0}/{row.total ?? 'unknown'} scanned</p><p>Last verified scan: {row.last_verified_scan_at?new Date(row.last_verified_scan_at).toLocaleString():'Never'} · Next full scan due: {row.automatic_enabled===0?'Paused':row.last_verified_scan_at?new Date(Math.max(row.last_verified_scan_at+12*60*60*1000,Date.parse(resumeAt??'')||0)).toLocaleString():'Next scheduler tick'}</p>{row.job_id&&<small>Job: {row.job_id}. Cloudflare continues after this page closes.</small>}</div>)}
  </section>
}
