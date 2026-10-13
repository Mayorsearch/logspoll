import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { cloudflareRequest } from '../lib/cloudflare-auth'

interface Supplier {
  id: string; name: string; enabled: number; revision: number; last_status: string
  phase?: string; page?: number; scanned?: number; total?: number
  supplier_wide_authorized?: number
}

export default function CloudflareCatalog({ onComplete }: { onComplete: () => Promise<void> }) {
  const [rows, setRows] = useState<Supplier[]>([])
  const [id, setId] = useState('')
  const [name, setName] = useState('YoungPG Media')
  const [enabled, setEnabled] = useState(false)
  const [authorizationRef, setAuthorizationRef] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const key = useRef<HTMLInputElement>(null)

  async function refresh() {
    const result = await cloudflareRequest<{ suppliers: Supplier[] }>('/api/admin/catalog')
    setRows(result.suppliers)
  }
  useEffect(() => {
    let active = true
    void cloudflareRequest<{ suppliers: Supplier[] }>('/api/admin/catalog').then(result => {
      if (!active) return
      setRows(result.suppliers)
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
      for (let batch = 0; batch < 2000; batch++) {
        const result = await cloudflareRequest<{
          done: boolean; skipped?: string; phase: string; scanned: number
        }>('/api/admin/catalog', { action: 'sync', id })
        setStatus(`${result.phase ?? result.skipped}: ${result.scanned ?? 0} listings scanned. Approval and publication remain separate.`)
        if (result.done) { await onComplete(); break }
        if (result.skipped) break
        await new Promise(resolve=>setTimeout(resolve,5500))
      }
      await refresh()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Sync paused; saved checkpoint retained.')
    } finally { setBusy(false) }
  }
  const selected = rows.find(row => row.id === id)
  return <section className="cf-panel catalog-panel">
    <h2>YoungPG catalog synchronization</h2>
    <p>Read-only supplier access. Eligible products enter review after a complete snapshot; importing never approves products or makes purchases.</p>
    <form className="catalog-config-form" onSubmit={save}>
      <fieldset disabled={busy}>
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
        <p className="catalog-help">For authorization covering YoungPG's entire eligible catalog, enter a reference to your genuine supplier agreement or confirmation once. Leave blank to retain your previously saved authorization. Account-access and credential products remain excluded.</p>
        {selected?.supplier_wide_authorized === 1 &&
          <p className="catalog-note" role="status">Supplier-wide authorization reference recorded. Product review and stock checks are still required.</p>}
        <label className="catalog-checkbox"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/> Enabled</label>
        <button type="submit" className="cf-btn catalog-save" disabled={busy}>{busy ? 'Saving…' : 'Save / replace key'}</button>
      </fieldset>
    </form>
    <div className="catalog-actions">
      <button type="button" className="cf-btn" disabled={busy || !id || !selected?.enabled} onClick={() => void sync()}>Sync complete catalog</button>
      <button type="button" className="cf-btn secondary" disabled={busy} onClick={() => void refresh().catch(() => setStatus('Status unavailable.'))}>Refresh progress</button>
    </div>
    {status && <p role="status" className="catalog-status">{status}</p>}
    {rows.map(row => <p key={row.id} className="catalog-progress">{row.name}: {row.last_status} · {row.scanned ?? 0}/{row.total ?? 'unknown'} scanned</p>)}
  </section>
}
