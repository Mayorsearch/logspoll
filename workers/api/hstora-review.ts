import {adminActor,bodyJSON} from './admin.ts'
import {openCredential} from '../../server/supplier-crypto.ts'
import {readHstoraDetail,HstoraError} from '../../server/hstora.ts'
import {HttpError,json} from './http.ts'
import type {ApiEnv,Statement} from './types.ts'
export function nativeCostMinor(price:string,rate:number){
 if(!/^\d+(?:\.\d+)?$/.test(price)||!Number.isSafeInteger(rate)||rate<=0)throw new HttpError(400,'Configure a valid NGN exchange rate first.')
 const [whole,fraction='']=price.split('.'),scale=10n**BigInt(fraction.length)
 const amount=((BigInt(whole)*scale+BigInt(fraction||'0'))*BigInt(rate)+scale-1n)/scale
 if(amount>99999999900n)throw new HttpError(400,'Converted supplier cost exceeds supported NGN range.')
 return Number(amount)
}
type Item={external_id:string;metadata:string;checked_at:number;product_id:string|null;selling_price_minor:number|null;manual_description:string|null;approval_status:string;evidence_reference:string|null}
export async function hstoraReview(request:Request,env:ApiEnv){
 const actor=await adminActor(request,env),db=env.DB!,now=Date.now()
 if(request.method==='GET'){
  const params=new URL(request.url).searchParams,page=Math.max(1,Math.floor(Number(params.get('page'))||1)),q=(params.get('q')??'').slice(0,200)
  const approval=params.get('approval'),stock=params.get('stock')
  const conditions=["instr(lower(json_extract(h.metadata,'$.name')),lower(?))>0"],values:(string|number)[]=[q]
  if(['pending','approved','rejected'].includes(approval??'')){conditions.push('h.approval_status=?');values.push(approval!)}
  if(stock==='in-stock')conditions.push("json_extract(h.metadata,'$.stock')>0")
  if(stock==='out-of-stock')conditions.push("json_extract(h.metadata,'$.stock')=0")
  const items=await db.prepare(`SELECT h.*,p.publication_verified,c.enabled supplier_enabled,c.revision connection_revision,json_extract(h.metadata,'$.name') name,json_extract(h.metadata,'$.currency') currency,json_extract(h.metadata,'$.price') supplier_price,json_extract(h.metadata,'$.stock') supplier_stock FROM hstora_catalog_items h LEFT JOIN products p ON p.id=h.product_id LEFT JOIN hstora_connection c ON c.id='hstora' WHERE ${conditions.join(' AND ')} ORDER BY h.external_id LIMIT 51 OFFSET ?`).bind(...values,(page-1)*50).all()
  const shown=items.results.slice(0,50).map(row=>({...row,metadata:JSON.parse(String(row.metadata)),blockers:[...(JSON.parse(String(row.metadata)).supplier_available===false?['Supplier reports product removed or unavailable']:[]),...(!row.supplier_enabled?['Enable HStora API']:[]),...(row.approval_status==='approved'&&row.reviewed_revision!==row.connection_revision?['Review authorization after credential replacement']:[]),...(row.approval_status!=='approved'?['Product review and resale evidence required']:[]),...(Number(row.checked_at)<=now-3600000?['Supplier stock older than one hour']:[]),...(!row.selling_price_minor?['Set a positive NGN selling price']:[]),...(!row.publication_verified?['Not published']:[])]}))
  const summary=await db.prepare("SELECT count(*) total,sum(CASE WHEN h.approval_status='pending' THEN 1 ELSE 0 END) pending,sum(CASE WHEN p.publication_verified=1 THEN 1 ELSE 0 END) published FROM hstora_catalog_items h LEFT JOIN products p ON p.id=h.product_id").first()
  return json({items:shown,summary,has_more:items.results.length>50,page})
 }
 if(request.method!=='POST')throw new HttpError(405,'Method not permitted.')
 const b=await bodyJSON(request),ids=b.ids??[b.external_id]
 if(!Array.isArray(ids)||!ids.length||ids.length>25||ids.some(id=>typeof id!=='string'||!/^\d{1,16}$/.test(id))||new Set(ids).size!==ids.length)throw new HttpError(400,'Select 1–25 distinct supplier IDs.')
 const connection=await db.prepare("SELECT enabled,revision,fx_rate_minor FROM hstora_connection WHERE id='hstora'").first<{enabled:number;revision:number;fx_rate_minor:number|null}>()
 if(!connection)throw new HttpError(409,'Configure HStora first.')
 if(b.action==='prepare'){
  if(ids.length!==1||!connection.enabled)throw new HttpError(409,'Select one product and enable HStora first.')
  const owner=crypto.randomUUID(),lease=await db.prepare("UPDATE hstora_connection SET lease_owner=?,lease_until=? WHERE id='hstora' AND enabled=1 AND next_attempt<=? AND (lease_until IS NULL OR lease_until<=?) RETURNING ciphertext,nonce,revision").bind(owner,now+60000,now,now).first<{ciphertext:string;nonce:string;revision:number}>()
  if(!lease)throw new HttpError(409,'Supplier batch or cooldown active; retry Review shortly.')
  try{
   const credentials=JSON.parse(await openCredential(lease.ciphertext,lease.nonce,'hstora',env.SUPPLIER_ENCRYPTION_KEY)),detail=await readHstoraDetail(credentials,ids[0])
   await db.batch([db.prepare("INSERT INTO hstora_sync_fences(owner,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM hstora_connection WHERE id='hstora' AND enabled=1 AND revision=? AND lease_owner=? AND lease_until>?) THEN 1 ELSE 0 END").bind(owner,lease.revision,owner,Date.now()),db.prepare('UPDATE hstora_catalog_items SET metadata=?,checked_at=? WHERE external_id=?').bind(JSON.stringify(detail),Date.now(),ids[0]),db.prepare('DELETE FROM hstora_sync_fences WHERE owner=?').bind(owner),db.prepare("UPDATE hstora_connection SET lease_owner=NULL,lease_until=NULL WHERE id='hstora' AND lease_owner=?").bind(owner)])
   return json({refreshed:true})
  }catch(error){await db.prepare("UPDATE hstora_connection SET lease_owner=NULL,lease_until=NULL,next_attempt=? WHERE id='hstora' AND lease_owner=?").bind(Date.now()+(error instanceof HstoraError?error.retryAfterMs:30000),owner).run();throw new HttpError(502,error instanceof HstoraError?error.message:'Supplier verification failed.')}
 }
 const writes:Statement[]=[]
 for(const id of ids){
  const item=await db.prepare('SELECT * FROM hstora_catalog_items WHERE external_id=?').bind(id).first<Item>()
  if(!item)throw new HttpError(404,'Imported product not found.')
  const metadata=JSON.parse(item.metadata),product=item.product_id??crypto.randomUUID(),fence=crypto.randomUUID()
  writes.push(db.prepare('INSERT INTO hstora_sync_fences(owner,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM hstora_catalog_items h JOIN hstora_connection c ON c.id=\'hstora\' WHERE external_id=? AND metadata=? AND c.revision=?) THEN 1 ELSE 0 END').bind(fence,id,item.metadata,connection.revision))
  if(b.action==='price'){
   if(!['price','fixed_markup','percent_markup'].includes(String(b.mode))||!Number.isSafeInteger(b.amount)||Number(b.amount)<0)throw new HttpError(400,'Enter a valid price or markup in kobo / basis points.')
   const amount=Number(b.amount),cost=b.mode==='price'?0:nativeCostMinor(metadata.price,metadata.currency==='NGN'?100:connection.fx_rate_minor??0)
   const price=b.mode==='price'?amount:b.mode==='fixed_markup'?cost+amount:cost+Number((BigInt(cost)*BigInt(amount)+9999n)/10000n)
   if(!Number.isSafeInteger(price)||price<=0||price>99999999900)throw new HttpError(400,'Selling price outside supported NGN range.')
   writes.push(db.prepare('UPDATE hstora_catalog_items SET selling_price_minor=? WHERE external_id=?').bind(price,id),db.prepare("UPDATE products SET price_minor=?,pricing_mode='override' WHERE id=?").bind(price,product))
  }else if(b.action==='approve'){
   if(ids.length!==1)throw new HttpError(400,'Review each product independently.')
   const description=typeof b.description==='string'?b.description.trim():''
   if(!connection.enabled||item.checked_at<=now-3600000||item.checked_at>now)throw new HttpError(409,'Enable supplier and refresh current stock before approval.')
   if(b.delivery_verified!==true||b.privacy_verified!==true||b.provider_verified!==true||typeof b.reference!=='string'||b.reference.trim().length<5||b.reference.length>1000)throw new HttpError(400,'Confirm resale/delivery rights, privacy and payment-provider permission with an evidence reference.')
   if(description.length<20||description.length>10000||!item.selling_price_minor)throw new HttpError(400,'Set positive NGN price and a verified description of 20–10000 characters.')
   const delivery=String(b.delivery_type);if(!['Licensed digital download','Redemption code','Subscription activation','Manual fulfillment'].includes(delivery))throw new HttpError(400,'Select permitted delivery method.')
   writes.push(db.prepare("INSERT INTO products(id,category_id,slug,name,description,price_minor,supplier_name,authorized_resale,status,delivery_type,supplier_image_urls,pricing_mode) SELECT ?,id,?,?,?,?, 'HStora',1,'draft',?,?,'override' FROM categories WHERE slug='server1' ON CONFLICT(slug) DO UPDATE SET description=excluded.description,delivery_type=excluded.delivery_type,authorized_resale=1").bind(product,'hstora-'+id,String(metadata.name).replace(/\s+/g,' ').trim().slice(0,200),description,item.selling_price_minor,delivery,JSON.stringify(metadata.images??[])),
    db.prepare("UPDATE hstora_catalog_items SET product_id=(SELECT id FROM products WHERE slug=?),manual_description=?,approval_status='approved',evidence_reference=?,reviewed_revision=?,reviewed_at=?,reviewed_by=? WHERE external_id=?").bind('hstora-'+id,description,b.reference.trim(),connection.revision,now,actor.id,id),
    db.prepare('INSERT INTO product_authorizations(product_id,evidence,reviewer_id,verified_at) SELECT product_id,?,?,? FROM hstora_catalog_items WHERE external_id=? ON CONFLICT(product_id) DO UPDATE SET evidence=excluded.evidence,reviewer_id=excluded.reviewer_id,verified_at=excluded.verified_at').bind(JSON.stringify({delivery:true,privacy:true,provider:true,reference:b.reference.trim()}),actor.id,now,id))
  }else if(b.action==='publish'){
   writes.push(db.prepare("INSERT INTO admin_write_fences(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM hstora_catalog_items h JOIN products p ON p.id=h.product_id JOIN verified_product_stock v ON v.id=p.id JOIN categories c ON c.id=p.category_id WHERE h.external_id=? AND h.approval_status='approved' AND v.available_quantity>0 AND p.authorized_resale=1 AND p.price_minor>0 AND length(trim(p.description))>=20 AND c.slug='server1' AND c.active=1) THEN 1 ELSE 0 END").bind(product+'-'+fence,id),db.prepare("UPDATE products SET status='active',publication_verified=1 WHERE id=?").bind(product),db.prepare('DELETE FROM admin_write_fences WHERE id=?').bind(product+'-'+fence))
  }else if(b.action==='reject'||b.action==='unpublish'){
   if(b.action==='reject')writes.push(db.prepare("UPDATE hstora_catalog_items SET approval_status='rejected' WHERE external_id=?").bind(id))
   writes.push(db.prepare("UPDATE products SET status='inactive',publication_verified=0 WHERE id=?").bind(product))
  }else throw new HttpError(400,'Unsupported review action.')
  writes.push(db.prepare('DELETE FROM hstora_sync_fences WHERE owner=?').bind(fence),db.prepare("INSERT INTO audit_logs(id,actor_id,table_name,record_id,action) VALUES(?,?,'hstora_catalog_items',?,'UPDATE')").bind(crypto.randomUUID(),actor.id,id))
 }
 try{await db.batch(writes)}catch{throw new HttpError(409,'Review changed or publication checks failed; nothing saved. Refresh and verify price, evidence, enabled supplier and fresh stock.')}
 return json({saved:true,count:ids.length})
}
