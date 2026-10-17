import { adminActor,bodyJSON,uuid } from './admin.ts'
import { HttpError,json } from './http.ts'
import type { ApiEnv } from './types.ts'
import {DESCRIPTION_REQUIRED,identifier,listingsFrom,listingSlug,record,resaleAllowlist,SupplierReadError,youngpgGet,YOUNGPG_ORIGIN} from '../../server/youngpg.ts'
import {openCredential} from '../../server/supplier-crypto.ts'
import {categoryMappingStatements} from './catalog-sync.ts'
import {productImages} from '../../src/lib/product-images.ts'
const methods=['Licensed digital download','Redemption code','Subscription activation','Manual fulfillment']
export async function supplierReview(request:Request,env:ApiEnv){
 const actor=await adminActor(request,env),db=env.DB!
 if(request.method==='GET'){
  const params=new URL(request.url).searchParams
  const page=Math.min(1000,Math.max(1,Math.floor(Number(params.get('discovery_page'))||1)))
  const where:string[]=[],values:(string|number)[]=[]
  const connection=params.get('after_connection'),external=params.get('after_external'),q=(params.get('q')??'').trim().slice(0,200)
  if(connection||external){if(!uuid(connection)||!external||!/^\w[\w-]{0,99}$/.test(external))throw new HttpError(400,'Invalid discovery cursor.');where.push('(j.connection_id>? OR (j.connection_id=? AND i.external_id>?))');values.push(connection,connection,external)}
  if(q){where.push("instr(lower(COALESCE(json_extract(i.metadata,'$.name'),'')),lower(?))>0");values.push(q)}
  if(params.get('category')){where.push("json_extract(i.metadata,'$.category_id')=?");values.push(params.get('category')!.slice(0,120))}
  if(params.get('stock')==='in-stock')where.push("json_extract(i.metadata,'$.stock')>0")
  if(params.get('stock')==='out-of-stock')where.push("json_extract(i.metadata,'$.stock')=0")
  if(params.get('approval')==='blocked')where.push("json_extract(i.metadata,'$.review_block') IS NOT NULL")
  else if(['pending','approved','rejected'].includes(params.get('approval')??'')){where.push("COALESCE(f.approval,'pending')=? AND json_extract(i.metadata,'$.review_block') IS NULL");values.push(params.get('approval')!)}
  const [counts,items,categories,discovery,sourceCategories,discoveryCounts]=await Promise.all([
   db.prepare('SELECT approval,count(*) total FROM staging_supplier_feed_items GROUP BY approval').all(),
   db.prepare(`SELECT f.connection_id,f.external_id,f.name,f.source_category,f.supplier_cost_minor,f.stock_quantity,f.authorization_verified,f.source_checked_at,f.approval,f.category_id,f.selling_price_minor,f.delivery_type,f.reviewed_at,f.supplier_description,f.reviewed_description,f.supplier_image_urls,sp.product_id,p.publication_verified FROM staging_supplier_feed_items f LEFT JOIN supplier_products sp ON sp.connection_id=f.connection_id AND sp.external_id=f.external_id LEFT JOIN products p ON p.id=sp.product_id ORDER BY f.source_checked_at DESC,f.external_id LIMIT 500`).all(),
   db.prepare('SELECT id,name FROM categories WHERE active=1 ORDER BY name LIMIT 100').all(),
   db.prepare(`SELECT j.connection_id,j.phase,i.external_id,json_extract(i.metadata,'$.name') name,json_extract(i.metadata,'$.description') description,json_extract(i.metadata,'$.image_urls') image_urls,json_extract(i.metadata,'$.category_id') category_id,json_extract(i.metadata,'$.subcategory_id') subcategory_id,json_extract(i.metadata,'$.cost_minor') cost_minor,json_extract(i.metadata,'$.stock') stock,json_extract(i.metadata,'$.review_block') blocked_reason,COALESCE(f.approval,'pending') approval,f.selling_price_minor FROM supplier_sync_items i JOIN supplier_sync_jobs j ON j.id=i.job_id LEFT JOIN staging_supplier_feed_items f ON f.connection_id=j.connection_id AND f.external_id=i.external_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY j.connection_id,i.external_id LIMIT 101 OFFSET ?`).bind(...values,connection?0:(page-1)*100).all(),
   db.prepare('SELECT connection_id,kind,external_id,parent_id,slug,name FROM supplier_source_categories ORDER BY connection_id,kind,name LIMIT 5000').all(),
   db.prepare(`SELECT count(*) total,sum(CASE WHEN json_extract(metadata,'$.review_block') IS NOT NULL THEN 1 ELSE 0 END) blocked FROM supplier_sync_items`).all()])
  const now=Date.now()
  const shown=discovery.results.slice(0,100),last=shown.at(-1)
  return json({environment:env.ENVIRONMENT,supplierSyncEnabled:env.CATALOG_SYNC_ENABLED==='true',publicationEnabled:true,counts:counts.results,items:items.results.map(item=>({...item,publication_blockers:[...(item.approval!=='approved'?['Administrator approval required']:[]),...(!item.category_id?['Storefront category required']:[]),...(Number(item.source_checked_at)<=now-3600000?['Stock verification older than one hour']:[]),...(Number(item.stock_quantity)<=0?['Unavailable from supplier']:[]),...(!item.publication_verified?['Separate publication required']:[])]})),categories:categories.results,discovery:shown,nextCursor:discovery.results.length>100&&last?{connection:last.connection_id,external:last.external_id}:null,sourceCategories:sourceCategories.results,discoveryCounts:discoveryCounts.results[0],discoveryPage:page})
 }
 if(request.method!=='POST')throw new HttpError(405,'Unsupported review method.')
 const b=await bodyJSON(request),now=Date.now()
 if(b.action==='bulk_price'){
  if(!Array.isArray(b.items)||!b.items.length||b.items.length>25||!['price','fixed_markup','percent_markup'].includes(String(b.mode))||!Number.isSafeInteger(b.amount)||Number(b.amount)<0||Number(b.amount)>99999999900)throw new HttpError(400,'Select 1–25 listings and a valid integer price/markup.')
  const writes=[],seen=new Set<string>()
  for(const value of b.items){const item=record(value);if(!uuid(item.connection_id)||typeof item.external_id!=='string'||!/^[\w-]{1,100}$/.test(item.external_id))throw new HttpError(400,'Invalid listing selection.');const key=item.connection_id+'/'+item.external_id;if(seen.has(key))throw new HttpError(400,'Duplicate selection.');seen.add(key)
   const f=await db.prepare('SELECT supplier_cost_minor,selling_price_minor FROM staging_supplier_feed_items WHERE connection_id=? AND external_id=?').bind(item.connection_id,item.external_id).first<{supplier_cost_minor:number;selling_price_minor:number|null}>();if(!f)throw new HttpError(409,'Open Review once to load this listing before saving its price.')
   const cost=BigInt(f.supplier_cost_minor),amount=BigInt(Number(b.amount)),price=Number(b.mode==='price'?amount:b.mode==='fixed_markup'?cost+amount:cost+(cost*amount+9999n)/10000n);if(!Number.isSafeInteger(price)||price>99999999900)throw new HttpError(400,'Resulting selling price exceeds supported NGN range.')
   const fence=crypto.randomUUID();writes.push(db.prepare('INSERT INTO admin_write_fences(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM staging_supplier_feed_items WHERE connection_id=? AND external_id=? AND supplier_cost_minor=? AND selling_price_minor IS ?) THEN 1 ELSE 0 END').bind(fence,item.connection_id,item.external_id,f.supplier_cost_minor,f.selling_price_minor),db.prepare("UPDATE products SET price_minor=?,pricing_mode='override' WHERE id=(SELECT product_id FROM supplier_products WHERE connection_id=? AND external_id=?)").bind(price,item.connection_id,item.external_id),db.prepare('UPDATE staging_supplier_feed_items SET selling_price_minor=? WHERE connection_id=? AND external_id=?').bind(price,item.connection_id,item.external_id),db.prepare('DELETE FROM admin_write_fences WHERE id=?').bind(fence),db.prepare("INSERT INTO audit_logs(id,actor_id,table_name,record_id,action) VALUES(?,?,'staging_supplier_feed_items',?,'UPDATE')").bind(crypto.randomUUID(),actor.id,key))
  }
  try{await db.batch(writes)}catch{throw new HttpError(409,'Supplier costs changed; refresh and retry. No selected prices were saved.')}
  return json({saved:true,count:b.items.length})
 }
 if(!uuid(b.connection_id)||typeof b.external_id!=='string'||!/^[\w-]{1,100}$/.test(b.external_id)||!['prepare','approve','reject'].includes(String(b.action)))throw new HttpError(400,'Invalid review request.')
 if(b.action==='prepare'){
  if(!env.SUPPLIER_ENCRYPTION_KEY)throw new HttpError(503,'Supplier encryption binding missing.')
  const owner=crypto.randomUUID(),c=await db.prepare('UPDATE staging_supplier_connections SET lease_owner=?,lease_until=? WHERE id=? AND enabled=1 AND next_attempt<=? AND (lease_until IS NULL OR lease_until<=?) RETURNING id,revision,encrypted_key,key_nonce,authorized_products').bind(owner,now+300000,b.connection_id,now,now).first<{id:string;revision:number;encrypted_key:string;key_nonce:string;authorized_products:string}>()
  if(!c)throw new HttpError(409,'Supplier batch or rate-limit cooldown active. Retry Review in a few seconds.')
  try{
   const source=await db.prepare("SELECT j.id,j.categories,i.metadata FROM supplier_sync_jobs j JOIN supplier_sync_items i ON i.job_id=j.id WHERE j.connection_id=? AND j.phase='complete' AND j.revision=? AND i.external_id=?").bind(c.id,c.revision,b.external_id).first<{id:string;categories:string;metadata:string}>();if(!source)throw new HttpError(409,'Wait for the complete catalog snapshot, then retry Review.')
   const cached=JSON.parse(source.metadata),categories=JSON.parse(source.categories),category=categories.find((x:{id:string})=>x.id===cached.category_id);if(!category||!cached.slug)throw new HttpError(409,'Supplier category or listing URL missing. Run Sync Now to repair metadata.')
   const key=await openCredential(c.encrypted_key,c.key_nonce,c.id,env.SUPPLIER_ENCRYPTION_KEY),detail=record((await youngpgGet(YOUNGPG_ORIGIN,key,`listings/${listingSlug(cached.slug)}`)).data)
   if(identifier(detail.id)!==b.external_id)throw new HttpError(409,'Supplier detail ID does not match the selected listing.')
   if(detail.price_ngn===undefined||detail.available_stock===undefined)throw new HttpError(409,'Supplier detail omitted current price/stock. Sync the catalog before approving.')
   const product=listingsFrom([{...detail,id:b.external_id,title:detail.title??cached.name,description:detail.description??cached.description,slug:cached.slug,category:{slug:category.slug,title:category.name},image_urls:[...productImages(detail),...productImages({image_urls:cached.image_urls})]}],categories,resaleAllowlist(JSON.parse(c.authorized_products))).products[0]
   if(!product)throw new HttpError(409,'No current product-specific or supplier-wide authorization reference. Update Supplier API settings.')
   const fence=crypto.randomUUID();await db.batch([
    db.prepare('INSERT INTO supplier_sync_fences(owner,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM staging_supplier_connections WHERE id=? AND revision=? AND lease_owner=? AND lease_until>?) THEN 1 ELSE 0 END').bind(fence,c.id,c.revision,owner,Date.now()),
    db.prepare(`INSERT INTO staging_supplier_feed_items(connection_id,external_id,name,source_category,supplier_cost_minor,stock_quantity,authorization_verified,evidence_reference,source_checked_at,supplier_description,supplier_image_urls,supplier_category_id,snapshot_id) VALUES(?,?,?,'permitted_digital_good',?,?,1,?,?,?,?,?,?) ON CONFLICT(connection_id,external_id) DO UPDATE SET supplier_cost_minor=excluded.supplier_cost_minor,stock_quantity=CASE WHEN evidence_reference=excluded.evidence_reference OR approval<>'approved' THEN excluded.stock_quantity ELSE 0 END,authorization_verified=1,evidence_reference=CASE WHEN approval='approved' THEN evidence_reference ELSE excluded.evidence_reference END,source_category='permitted_digital_good',source_checked_at=excluded.source_checked_at,supplier_description=CASE WHEN excluded.supplier_description=? THEN supplier_description ELSE excluded.supplier_description END,supplier_image_urls=CASE WHEN json_array_length(excluded.supplier_image_urls)>0 THEN excluded.supplier_image_urls ELSE supplier_image_urls END,supplier_category_id=excluded.supplier_category_id,snapshot_id=excluded.snapshot_id`).bind(c.id,product.id,product.name.slice(0,200),product.cost_minor,product.stock,product.authorization_ref,Date.now(),product.description,JSON.stringify(product.image_urls??[]),product.category_id,source.id,DESCRIPTION_REQUIRED),
    ...categoryMappingStatements(db,c.id,categories),
    db.prepare('DELETE FROM supplier_sync_fences WHERE owner=?').bind(fence),
    db.prepare('UPDATE staging_supplier_connections SET lease_owner=NULL,lease_until=NULL,next_attempt=? WHERE id=? AND lease_owner=?').bind(Date.now()+5500,c.id,owner),
   ])
   return json({item:await db.prepare('SELECT * FROM staging_supplier_feed_items WHERE connection_id=? AND external_id=?').bind(c.id,b.external_id).first(),categories:(await db.prepare('SELECT id,name FROM categories WHERE active=1 ORDER BY name LIMIT 5000').all()).results})
  }catch(error){await db.prepare('UPDATE staging_supplier_connections SET lease_owner=NULL,lease_until=NULL,next_attempt=? WHERE id=? AND lease_owner=?').bind(Date.now()+(error instanceof SupplierReadError?Math.max(30000,error.retryAfterMs):30000),c.id,owner).run();throw error}
 }
 if(b.action==='reject'){
  const result=await db.prepare("UPDATE staging_supplier_feed_items SET approval='rejected',reviewed_by=?,reviewed_at=? WHERE connection_id=? AND external_id=? RETURNING external_id").bind(actor.id,now,b.connection_id,b.external_id).first()
  if(!result)throw new HttpError(404,'Supplier listing not found.')
  return json({success:true,review:'rejected',published:false})
 }
 if(!uuid(b.category_id)||!methods.includes(String(b.delivery_type))||typeof b.description!=='string'||b.description.trim().length<20||b.description.length>10000||/ypg_[a-f\d]{48}|sk_(?:live|sandbox)_[a-z\d]{16,}|[\w.+-]+@[\w.-]+\.[a-z]{2,}:[^\s]{4,}/i.test(b.description))throw new HttpError(400,'Choose a category/delivery method and a description of 20–10000 characters without actual secrets or private credentials.')
 if(b.delivery_verified!==true||b.privacy_verified!==true||b.provider_verified!==true||typeof b.review_reference!=='string'||b.review_reference.trim().length<5||b.review_reference.length>500)throw new HttpError(400,'Confirm lawful transfer/delivery, privacy/security and provider permission; enter the supporting review reference (5–500 characters).')
 const auto=b.price_minor===undefined||b.price_minor===null
 if(auto&&b.pricing_mode!=='auto')throw new HttpError(400,'Enter a selling price or explicitly choose automatic supplier-cost pricing.')
 if(!auto&&(!Number.isSafeInteger(b.price_minor)||Number(b.price_minor)<0||Number(b.price_minor)>99999999900))throw new HttpError(400,'Integer NGN kobo price required.')
 const candidate=await db.prepare(`SELECT f.name,f.supplier_description,f.supplier_category_id,f.snapshot_id,s.name category_name FROM staging_supplier_feed_items f LEFT JOIN supplier_source_categories s ON s.connection_id=f.connection_id AND s.kind='category' AND s.external_id=f.supplier_category_id WHERE f.connection_id=? AND f.external_id=?`).bind(b.connection_id,b.external_id).first<{name:string;supplier_description:string;supplier_category_id:string|null;snapshot_id:string|null;category_name:string|null}>()
 if(!candidate)throw new HttpError(404,'Supplier listing not found.')
 const state=await db.prepare('SELECT f.source_checked_at,f.evidence_reference,f.authorization_verified,c.enabled,c.authorized_products,s.revision snapshot_revision,c.revision FROM staging_supplier_feed_items f JOIN staging_supplier_connections c ON c.id=f.connection_id LEFT JOIN supplier_snapshots s ON s.id=f.snapshot_id WHERE f.connection_id=? AND f.external_id=?').bind(b.connection_id,b.external_id).first<{source_checked_at:number;evidence_reference:string;authorization_verified:number;enabled:number;authorized_products:string;snapshot_revision:number;revision:number}>()
 if(!state?.enabled)throw new HttpError(409,'Enable this supplier in Supplier API settings.')
 if(state.source_checked_at<=now-3600000||state.source_checked_at>now)throw new HttpError(409,'Stock verification expired. Click Review again to fetch current supplier price and stock.')
 const evidence=resaleAllowlist(JSON.parse(state.authorized_products));if(state.authorization_verified!==1||(evidence[b.external_id]??evidence['*'])!==state.evidence_reference)throw new HttpError(409,'Authorization reference changed or missing. Refresh Review and verify Supplier API authorization settings.')
 if(state.snapshot_revision!==state.revision)throw new HttpError(409,'Supplier configuration changed; complete Sync Now before approval.')
 if(!await db.prepare('SELECT id FROM categories WHERE id=? AND active=1').bind(b.category_id).first())throw new HttpError(409,'Select an active storefront category.')
 if(b.description.trim()===DESCRIPTION_REQUIRED)throw new HttpError(400,'Enter the actual verified product description; the missing-description notice cannot be published.')
 const eligible=`SELECT 1 FROM staging_supplier_feed_items f JOIN staging_supplier_connections c ON c.id=f.connection_id JOIN supplier_snapshots s ON s.id=f.snapshot_id AND s.connection_id=c.id WHERE f.connection_id=? AND f.external_id=? AND f.authorization_verified=1 AND f.source_category='permitted_digital_good' AND c.enabled=1 AND s.revision=c.revision AND f.source_checked_at>? AND f.source_checked_at<=? AND length(trim(f.evidence_reference))>=5 AND EXISTS(SELECT 1 FROM json_each(c.authorized_products) a WHERE a.value=f.evidence_reference AND (a.key=f.external_id OR (a.key='*' AND NOT EXISTS(SELECT 1 FROM json_each(c.authorized_products) specific WHERE specific.key=f.external_id)))) AND EXISTS(SELECT 1 FROM categories WHERE id=? AND active=1)`
 const fence=crypto.randomUUID(),product=crypto.randomUUID(),slug='ypg-'+b.connection_id+'-'+b.external_id
 try{await db.batch([
  db.prepare(`INSERT INTO admin_write_fences(id,valid) SELECT ?,CASE WHEN EXISTS(${eligible} AND f.name=? AND f.supplier_description=? AND f.supplier_category_id IS ? AND f.snapshot_id IS ?) THEN 1 ELSE 0 END`).bind(fence,b.connection_id,b.external_id,now-3600000,now,b.category_id,candidate.name,candidate.supplier_description,candidate.supplier_category_id,candidate.snapshot_id),
  db.prepare("UPDATE staging_supplier_feed_items SET approval='approved',category_id=?,selling_price_minor=COALESCE(?,supplier_cost_minor),delivery_type=?,reviewed_description=?,reviewed_by=?,reviewed_at=? WHERE connection_id=? AND external_id=?").bind(b.category_id,auto?null:Number(b.price_minor),String(b.delivery_type),b.description.trim(),actor.id,now,b.connection_id,b.external_id),
  db.prepare(`INSERT INTO products(id,category_id,slug,name,description,price_minor,supplier_name,authorized_resale,status,delivery_type,supplier_image_urls,pricing_mode) SELECT ?,category_id,?,name,reviewed_description,selling_price_minor,'YoungPG Media',1,'draft',delivery_type,supplier_image_urls,? FROM staging_supplier_feed_items WHERE connection_id=? AND external_id=? ON CONFLICT(slug) DO NOTHING`).bind(product,slug,auto?'auto':'override',b.connection_id,b.external_id),
  db.prepare('INSERT INTO supplier_products(connection_id,external_id,product_id) SELECT ?,?,id FROM products WHERE slug=? ON CONFLICT(connection_id,external_id) DO NOTHING').bind(b.connection_id,b.external_id,slug),
  db.prepare("UPDATE products SET price_minor=CASE WHEN ?=1 THEN price_minor ELSE ? END,pricing_mode=CASE WHEN ?=1 THEN pricing_mode ELSE 'override' END,description=? WHERE id=(SELECT product_id FROM supplier_products WHERE connection_id=? AND external_id=?)").bind(auto?1:0,auto?null:Number(b.price_minor),auto?1:0,b.description.trim(),b.connection_id,b.external_id),
  db.prepare('INSERT INTO product_authorizations(product_id,evidence,reviewer_id,verified_at) SELECT product_id,?,?,? FROM supplier_products WHERE connection_id=? AND external_id=? ON CONFLICT(product_id) DO UPDATE SET evidence=excluded.evidence,reviewer_id=excluded.reviewer_id,verified_at=excluded.verified_at').bind(JSON.stringify({delivery:true,privacy:true,provider:true,reference:b.review_reference.trim()}),actor.id,now,b.connection_id,b.external_id),
  db.prepare('DELETE FROM admin_write_fences WHERE id=?').bind(fence),
 ])}catch{throw new HttpError(409,'Approval blocked: require fresh complete snapshot, current product-specific or supplier-wide resale evidence, enabled supplier and active category.')}
 const saved=await db.prepare('SELECT product_id FROM supplier_products WHERE connection_id=? AND external_id=?').bind(b.connection_id,b.external_id).first()
 return json({success:true,review:'approved',published:false,...saved})
}
