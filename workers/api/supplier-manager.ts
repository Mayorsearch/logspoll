import {adminActor,bodyJSON,uuid} from './admin.ts'
import {HttpError,json} from './http.ts'
import {openCredential} from '../../server/supplier-crypto.ts'
import {youngpgGet,YOUNGPG_ORIGIN,SupplierReadError} from '../../server/youngpg.ts'
import type {ApiEnv} from './types.ts'
export async function supplierManager(request:Request,env:ApiEnv){
 await adminActor(request,env);const db=env.DB!
 if(request.method==='POST'){
  const b=await bodyJSON(request);if(b.action!=='test'||!uuid(b.id))throw new HttpError(400,'Select a supported YoungPG connection.')
  const c=await db.prepare("SELECT encrypted_key,key_nonce,next_attempt FROM staging_supplier_connections WHERE id=? AND provider='youngpg'").bind(b.id).first<{encrypted_key:string;key_nonce:string;next_attempt:number}>()
  if(!c)throw new HttpError(404,'Configure YoungPG first.')
  if(c.next_attempt>Date.now())throw new HttpError(429,'Supplier cooldown active. Retry after the next attempt time.')
  try{const key=await openCredential(c.encrypted_key,c.key_nonce,b.id,env.SUPPLIER_ENCRYPTION_KEY);await youngpgGet(YOUNGPG_ORIGIN,key,'categories');return json({connected:true})}catch(error){throw new HttpError(502,error instanceof SupplierReadError?error.message:'Supplier connection could not be verified.')}
 }
 if(request.method!=='GET')throw new HttpError(405,'Method not permitted.')
 const params=new URL(request.url).searchParams
 if(params.get('provider')!=='youngpg')throw new HttpError(400,'Unsupported provider.')
 const page=Math.max(1,Math.floor(Number(params.get('page'))||1)),q=(params.get('q')??'').slice(0,200),approval=params.get('approval'),stock=params.get('stock')
 const conditions=["c.provider='youngpg'","instr(lower(json_extract(i.metadata,'$.name')),lower(?))>0"],values:(string|number)[]=[q]
 if(['pending','approved','rejected'].includes(approval??'')){conditions.push("COALESCE(f.approval,'pending')=?");values.push(approval!)}
 if(stock==='in-stock')conditions.push("json_extract(i.metadata,'$.stock')>0")
 if(stock==='out-of-stock')conditions.push("json_extract(i.metadata,'$.stock')=0")
 const joins="FROM supplier_sync_items i JOIN supplier_sync_jobs j ON j.id=i.job_id JOIN staging_supplier_connections c ON c.id=j.connection_id LEFT JOIN staging_supplier_feed_items f ON f.connection_id=c.id AND f.external_id=i.external_id LEFT JOIN supplier_products sp ON sp.connection_id=c.id AND sp.external_id=i.external_id LEFT JOIN products p ON p.id=sp.product_id"
 const rows=await db.prepare(`SELECT c.id connection_id,i.external_id,i.metadata,f.supplier_cost_minor,f.selling_price_minor,COALESCE(f.approval,'pending') approval_status,f.reviewed_description manual_description,f.category_id,sp.product_id,p.publication_verified,p.price_minor product_price_minor ${joins} WHERE ${conditions.join(' AND ')} ORDER BY c.id,i.external_id LIMIT 51 OFFSET ?`).bind(...values,(page-1)*50).all()
 const summary=await db.prepare(`SELECT count(*) total,sum(CASE WHEN COALESCE(f.approval,'pending')='pending' THEN 1 ELSE 0 END) pending,sum(CASE WHEN p.publication_verified=1 THEN 1 ELSE 0 END) published ${joins} WHERE c.provider='youngpg'`).first()
 const categories=await db.prepare('SELECT id,name FROM categories WHERE active=1 ORDER BY name').all()
 return json({page,has_more:rows.results.length>50,summary,categories:categories.results,items:rows.results.slice(0,50).map(row=>{const m=JSON.parse(String(row.metadata));return {...row,name:m.name,currency:'NGN',supplier_price:String(Number(row.supplier_cost_minor??m.cost_minor??0)/100),supplier_stock:m.stock,selling_price_minor:row.product_price_minor??row.selling_price_minor,metadata:{description:m.description??'',images:m.image_urls??[],price_tiers:[]},blockers:[...(m.review_block?[String(m.review_block)]:[]),...(row.approval_status!=='approved'?['Administrator review required']:[]),...(!row.publication_verified?['Not published']:[])]}})})
}
