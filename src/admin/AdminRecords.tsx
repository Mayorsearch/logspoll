import { useEffect,useState } from 'react'
import type { FormEvent } from 'react'
import { cloudflareRequest } from '../lib/cloudflare-auth'
type Row=Record<string,string|number|null>
const methods=['Licensed digital download','Redemption code','Subscription activation','Manual fulfillment']
export default function AdminRecords({section}:{section:string}){
 const [rows,setRows]=useState<Row[]>([]),[categories,setCategories]=useState<Row[]>([]),[edit,setEdit]=useState<Record<string,string>|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 async function refresh(){try{const [r,c]=await Promise.all([cloudflareRequest<{records:Row[]}>(`/api/admin/operations?section=${section}`),cloudflareRequest<{records:Row[]}>('/api/admin/operations?section=categories')]);setRows(r.records);setCategories(c.records);setError('')}catch(e){setError(e instanceof Error?e.message:'Records unavailable.')}}
 useEffect(()=>{let active=true;void cloudflareRequest<{records:Row[]}>(`/api/admin/operations?section=${section}`).then(r=>{if(active)setRows(r.records)}).catch(e=>{if(active)setError(e.message)});void cloudflareRequest<{records:Row[]}>('/api/admin/operations?section=categories').then(r=>{if(active)setCategories(r.records)}).catch(()=>{});return()=>{active=false}},[section])
 function choose(row:Row={}){setEdit(Object.fromEntries(Object.entries(row).map(([k,v])=>[k,String(v??'')])));setError('')}
 async function action(body:Record<string,unknown>){setBusy(true);setError('');try{await cloudflareRequest('/api/admin/operations',body);setEdit(null);await refresh()}catch(e){setError(e instanceof Error?e.message:'Save failed.')}finally{setBusy(false)}}
 function save(e:FormEvent){e.preventDefault();if(!edit)return;const id=edit.id||undefined
  const actions:Record<string,string>={products:'save_product',categories:'save_category',support:'support_reply',settings:'settings',orders:'deliver'}
  const body:Record<string,unknown>={...edit,id,action:actions[section]}
  if(section==='products'){body.price_minor=Number(edit.price_minor);body.category_id=edit.category_id||categories[0]?.id;body.delivery_type=edit.delivery_type||methods[0];delete body.available_quantity;if(edit.evidence?.trim())body.available_quantity=Number(edit.available_quantity??0)}
  if(section==='categories')body.active=edit.active!=='0'&&edit.active!=='false'
  if(section==='settings'){try{body.value=JSON.parse(edit.value||'{}')}catch{setError('Valid settings JSON required.');return}}
  void action(body)
 }
 const fields=section==='products'?['name','slug','description','category_id','price_minor','delivery_type','image_path','term',...(edit?.connection_id?[]:['available_quantity','evidence'])]:section==='categories'?['name','short_name','slug','description','active']:section==='support'?['reply','status']:section==='settings'?['value']:section==='orders'?['instructions']:[]
 const labels:Record<string,string>={price_minor:'Selling price (NGN kobo)',available_quantity:'Actual manual stock (used only with evidence)',evidence:'Verified resale/stock evidence reference',instructions:'Permitted delivery instructions'}
 return <section className="cf-panel"><div className="cf-actions"><h2>{section}</h2><button className="cf-btn secondary" onClick={()=>void refresh()} disabled={busy}>Refresh</button>{['products','categories','settings'].includes(section)&&<button className="cf-btn" onClick={()=>choose()} disabled={busy}>{section==='settings'?'Edit settings':'Add record'}</button>}</div>
 {error&&<p className="cf-error" role="alert">{error}</p>}
 <div className="cf-table-scroll"><table><thead><tr>{Object.keys(rows[0]??{}).filter(k=>!['description','message','reply'].includes(k)).slice(0,8).map(k=><th key={k}>{k.replaceAll('_',' ')}</th>)}<th>Actions</th></tr></thead><tbody>{rows.map((row,i)=><tr key={String(row.id??row.key??i)}>{Object.entries(row).filter(([k])=>!['description','message','reply'].includes(k)).slice(0,8).map(([k,v])=><td key={k}>{String(v??'—')}</td>)}<td><div className="cf-actions">
 {['products','categories','support','settings'].includes(section)&&<button className="cf-btn secondary" onClick={()=>choose(row)}>Edit</button>}
 {section==='products'&&<button className="cf-btn" disabled={busy} onClick={()=>void action({action:row.publication_verified?'unpublish':'publish',id:row.id})}>{row.publication_verified?'Unpublish':'Publish verified stock'}</button>}
 {section==='customers'&&<><button className="cf-btn secondary" disabled={busy} onClick={()=>void action({action:'account_status',id:row.id,status:row.status==='active'?'restricted':'active'})}>{row.status==='active'?'Restrict':'Restore'}</button><button className="cf-btn secondary" disabled={busy} onClick={()=>{if(window.confirm('Invite this verified customer to accept administrator access?'))void action({action:'invite_admin',id:row.id})}}>Invite administrator</button></>}
 {section==='reviews'&&['approved','rejected'].map(status=><button key={status} className="cf-btn secondary" disabled={busy} onClick={()=>void action({action:'moderate_review',id:row.id,status})}>{status}</button>)}
 {section==='orders'&&row.payment_status==='paid'&&row.fulfillment_status!=='delivered'&&<button className="cf-btn" onClick={()=>choose(row)}>Record delivery</button>}
 </div></td></tr>)}</tbody></table>{!rows.length&&<p>No records.</p>}</div>
 {edit&&<form className="cf-editor" onSubmit={save}><fieldset disabled={busy}>{fields.map(field=><label key={field}>{labels[field]??field.replaceAll('_',' ')}{field==='category_id'?<select value={edit[field]??''} onChange={e=>setEdit({...edit,[field]:e.target.value})}><option value="">Choose category</option>{categories.map(c=><option key={String(c.id)} value={String(c.id)}>{c.name}</option>)}</select>:field==='delivery_type'?<select value={edit[field]||methods[0]} onChange={e=>setEdit({...edit,[field]:e.target.value})}>{methods.map(m=><option key={m}>{m}</option>)}</select>:['description','reply','value','instructions'].includes(field)?<textarea rows={5} value={edit[field]??''} onChange={e=>setEdit({...edit,[field]:e.target.value})}/>:<input value={edit[field]??''} onChange={e=>setEdit({...edit,[field]:e.target.value})}/>}</label>)}<button className="cf-btn">Save</button><button type="button" className="cf-btn secondary" onClick={()=>setEdit(null)}>Cancel</button></fieldset></form>}
 </section>
}
