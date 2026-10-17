import HstoraWebhookPanel from './HstoraWebhookPanel'
import {useEffect,useRef,useState} from 'react'
import {cloudflareRequest} from '../lib/cloudflare-auth'
type Status={enabled:number;phase:string;scanned:number;total:number|null;imported:number;last_status:string;last_success:number|null;fx_rate_minor:number|null;with_images:number;with_descriptions:number}
export default function HstoraManager(){
 const [status,setStatus]=useState<Status|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
 const [rate,setRate]=useState('')
 const key=useRef<HTMLInputElement>(null),secret=useRef<HTMLInputElement>(null)
 async function refresh(){const result=await cloudflareRequest<{connection:Status|null}>('/api/admin/hstora');setStatus(result.connection)}
 useEffect(()=>{void refresh().catch(error=>setMessage(error instanceof Error?error.message:'Supplier settings unavailable.'))},[])
 async function action(action:string){if(action==='toggle'&&status?.enabled&&!confirm('Disable HStora? New synchronization and purchases stop. Existing records and orders remain.'))return;setBusy(true);setMessage('');try{
  const credentials=action==='save'?{api_key:key.current?.value,api_secret:secret.current?.value,enabled:Boolean(status?.enabled)}:action==='toggle'?{enabled:!status?.enabled}:action==='rate'?{enabled:Boolean(status?.enabled),fx_rate_minor:Math.round(Number(rate)*100)}:{}
  const result=await cloudflareRequest<{connected?:boolean;total?:number;message?:string}>('/api/admin/hstora',{action:['toggle','rate'].includes(action)?'save':action,...credentials})
  if(key.current)key.current.value='';if(secret.current)secret.current.value=''
  setMessage(result.message??(result.connected?`Connection verified; ${result.total} accessible products.`:action==='sync'?'Background synchronization queued.':'Saved.'))
  await refresh()
 }catch(error){setMessage(error instanceof Error?error.message:'Supplier request failed.')}finally{setBusy(false)}}
 return <><section className="cf-panel"><h2>API Manager · HStora</h2><p>Independent supplier. Imports remain private for review under server1. Credentials are encrypted on the server.</p>
 <label>API key<input ref={key} type="password" autoComplete="new-password" placeholder="New HStora API key" /></label>
 <label>Signing secret<input ref={secret} type="password" autoComplete="new-password" placeholder="New HStora signing secret" /></label>
 <label>NGN per one supplier currency unit (for markup; no automatic currency guessing)<input inputMode="decimal" value={rate} onChange={e=>setRate(e.target.value)} placeholder="Exchange rate"/></label><button className="cf-btn secondary" disabled={busy||!status||!/^\d+(\.\d{1,2})?$/.test(rate)} onClick={()=>void action('rate')}>Save exchange rate</button><div className="cf-actions"><button className="cf-btn secondary" disabled={busy} onClick={()=>void action('save')}>{status?'Replace Credentials':'Save Credentials'}</button><button className="cf-btn secondary" disabled={busy||!status} onClick={()=>void action('toggle')}>{status?.enabled?'Disable':'Enable'} HStora</button><button className="cf-btn secondary" disabled={busy||!status} onClick={()=>void action('test')}>Test Connection</button><button className="cf-btn secondary" disabled={busy||!status?.enabled} onClick={()=>void action('sync')}>Sync Now</button><button className="cf-btn secondary" disabled={busy} onClick={()=>void refresh().catch(()=>setMessage('Status unavailable.'))}>Refresh status</button></div>
 <p role="status">{message}</p>{status&&<dl><dt>Progress</dt><dd>{status.phase}: {status.scanned}/{status.total??'unknown'}</dd><dt>Imported</dt><dd>{status.imported} · images: {status.with_images} · descriptions: {status.with_descriptions}</dd><dt>Last successful sync</dt><dd>{status.last_success?new Date(status.last_success).toLocaleString():'Never'}</dd><dt>Last status</dt><dd>{status.last_status}</dd></dl>}</section><HstoraWebhookPanel/></>
}
