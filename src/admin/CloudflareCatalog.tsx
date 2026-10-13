import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { cloudflareRequest } from '../lib/cloudflare-auth'

interface Supplier { id:string;name:string;enabled:number;revision:number;last_status:string;phase?:string;page?:number;scanned?:number;total?:number }
export default function CloudflareCatalog({onComplete}:{onComplete:()=>Promise<void>}) {
  const [rows,setRows]=useState<Supplier[]>([]);const [id,setId]=useState('');const [name,setName]=useState('YoungPG Media')
  const [enabled,setEnabled]=useState(false);const [evidence,setEvidence]=useState('');const [status,setStatus]=useState('');const [busy,setBusy]=useState(false)
  const key=useRef<HTMLInputElement>(null)
  async function refresh(){const result=await cloudflareRequest<{suppliers:Supplier[]}>('/api/admin/catalog');setRows(result.suppliers)}
  useEffect(()=>{let active=true;void cloudflareRequest<{suppliers:Supplier[]}>('/api/admin/catalog').then(result=>{if(active){setRows(result.suppliers);const first=result.suppliers.find(r=>r.enabled);if(first){setId(first.id);setName(first.name);setEnabled(true)}}}).catch(error=>{if(active)setStatus(error instanceof Error?error.message:'Catalog configuration unavailable.')});return()=>{active=false}},[])
  function select(value:string){setId(value);const row=rows.find(r=>r.id===value);setName(row?.name??'YoungPG Media');setEnabled(Boolean(row?.enabled));setEvidence('');if(key.current)key.current.value=''}
  async function save(event:FormEvent){event.preventDefault();setBusy(true);setStatus('')
    try{
      const permissions=evidence.trim()?JSON.parse(evidence) as Record<string,string>:undefined
      const result=await cloudflareRequest<{id:string}>('/api/admin/catalog',{action:'save',...(id?{id}:{}),name,enabled,revision:rows.find(r=>r.id===id)?.revision??0,...(permissions?{authorized_products:permissions}:{}),...(key.current?.value?{api_key:key.current.value}:{})})
      setId(result.id);await refresh();setStatus('Configuration saved. Credentials are never returned.')
    }catch(error){setStatus(error instanceof Error?error.message:'Save unavailable.')}
    finally{if(key.current)key.current.value='';setBusy(false)}
  }
  async function sync(){setBusy(true);setStatus('')
    try{
      for(let batch=0;batch<2000;batch++){
        const result=await cloudflareRequest<{done:boolean;skipped?:string;phase:string;scanned:number}>('/api/admin/catalog',{action:'sync',id})
        setStatus(`${result.phase??result.skipped}: ${result.scanned??0} listings scanned. Approval and publication remain separate.`)
        if(result.done){await onComplete();break}
        if(result.skipped)break
        await new Promise(resolve=>setTimeout(resolve,1600))
      }
      await refresh()
    }catch(error){setStatus(error instanceof Error?error.message:'Sync paused; saved checkpoint retained.')}
    finally{setBusy(false)}
  }
  return <section className="cf-panel"><h2>YoungPG catalog synchronization</h2><p>Read-only supplier access. Complete snapshots enter review; ingestion never grants approval or starts purchases.</p>
    <form onSubmit={save}><fieldset disabled={busy}>
      <label>Supplier<select value={id} onChange={e=>select(e.target.value)}><option value="">New supplier</option>{rows.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label>Name<input value={name} onChange={e=>setName(e.target.value)} required maxLength={120}/></label>
      <label>API URL<input value="https://youngpgmedia.com.ng" readOnly/></label>
      <label>Replace API key<input ref={key} type="password" autoComplete="new-password" placeholder="Saved keys are never displayed"/></label>
      <label>Verified product ID to resale evidence JSON<textarea value={evidence} onChange={e=>setEvidence(e.target.value)}/></label>
      <p>Leave evidence blank to preserve it. Enter a complete verified allowlist to replace it; an empty JSON object disables imports.</p>
      <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Enabled</label>
      <button className="cf-btn">Save / replace key</button>
    </fieldset></form>
    <button className="cf-btn" disabled={busy||!id||!rows.find(r=>r.id===id)?.enabled} onClick={()=>void sync()}>Sync complete catalog</button>
    <button className="cf-btn secondary" disabled={busy} onClick={()=>void refresh().catch(()=>setStatus('Status unavailable.'))}>Refresh progress</button>
    {status&&<p role="status">{status}</p>}
    {rows.map(row=><p key={row.id}>{row.name}: {row.last_status} · {row.scanned??0}/{row.total??'unknown'} scanned</p>)}
  </section>
}
