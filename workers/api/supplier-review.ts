import { adminActor,bodyJSON,uuid } from './admin.ts'
import { HttpError,json } from './http.ts'
import type { ApiEnv } from './types.ts'
const methods=['Licensed digital download','Redemption code','Subscription activation','Manual fulfillment']
export async function supplierReview(request:Request,env:ApiEnv){
 const actor=await adminActor(request,env),db=env.DB!
 if(request.method==='GET'){
  const [counts,items,categories]=await Promise.all([
   db.prepare('SELECT approval,count(*) total FROM staging_supplier_feed_items GROUP BY approval').all(),
   db.prepare(`SELECT f.connection_id,f.external_id,f.name,f.source_category,f.supplier_cost_minor,f.stock_quantity,f.authorization_verified,f.source_checked_at,f.approval,f.category_id,f.selling_price_minor,f.delivery_type,f.reviewed_at,f.supplier_description,f.reviewed_description,f.supplier_image_urls,sp.product_id,p.publication_verified FROM staging_supplier_feed_items f LEFT JOIN supplier_products sp ON sp.connection_id=f.connection_id AND sp.external_id=f.external_id LEFT JOIN products p ON p.id=sp.product_id ORDER BY f.source_checked_at DESC,f.external_id LIMIT 500`).all(),
   db.prepare('SELECT id,name FROM categories WHERE active=1 ORDER BY name LIMIT 100').all()])
  return json({environment:env.ENVIRONMENT,supplierSyncEnabled:env.CATALOG_SYNC_ENABLED==='true',publicationEnabled:true,counts:counts.results,items:items.results,categories:categories.results})
 }
 if(request.method!=='POST')throw new HttpError(405,'Unsupported review method.')
 const b=await bodyJSON(request),now=Date.now()
 if(!uuid(b.connection_id)||typeof b.external_id!=='string'||!/^[\w-]{1,100}$/.test(b.external_id)||!['approve','reject'].includes(String(b.action)))throw new HttpError(400,'Invalid review request.')
 if(b.action==='reject'){
  const result=await db.prepare("UPDATE staging_supplier_feed_items SET approval='rejected',reviewed_by=?,reviewed_at=? WHERE connection_id=? AND external_id=? RETURNING external_id").bind(actor.id,now,b.connection_id,b.external_id).first()
  if(!result)throw new HttpError(404,'Supplier listing not found.')
  return json({success:true,review:'rejected',published:false})
 }
 if(!uuid(b.category_id)||!methods.includes(String(b.delivery_type))||typeof b.description!=='string'||b.description.trim().length<20||b.description.length>10000||/ypg_[a-f\d]{48}|session[ _-]?cookie|auth[ _-]?token|email\s*(?:and|\+)\s*password/i.test(b.description))throw new HttpError(400,'Verified category, description and permitted delivery required.')
 const auto=b.price_minor===undefined||b.price_minor===null
 if(!auto&&(!Number.isSafeInteger(b.price_minor)||Number(b.price_minor)<0||Number(b.price_minor)>99999999900))throw new HttpError(400,'Integer NGN kobo price required.')
 const eligible=`SELECT 1 FROM staging_supplier_feed_items f JOIN staging_supplier_connections c ON c.id=f.connection_id JOIN supplier_snapshots s ON s.id=f.snapshot_id AND s.connection_id=c.id WHERE f.connection_id=? AND f.external_id=? AND f.authorization_verified=1 AND f.source_category='permitted_digital_good' AND c.enabled=1 AND s.revision=c.revision AND f.source_checked_at>? AND f.source_checked_at<=? AND length(trim(f.evidence_reference))>=5 AND EXISTS(SELECT 1 FROM json_each(c.authorized_products) a WHERE a.key=f.external_id AND a.value=f.evidence_reference) AND EXISTS(SELECT 1 FROM categories WHERE id=? AND active=1)`
 const fence=crypto.randomUUID(),product=crypto.randomUUID(),slug='ypg-'+b.connection_id+'-'+b.external_id
 try{await db.batch([
  db.prepare(`INSERT INTO admin_write_fences(id,valid) SELECT ?,CASE WHEN EXISTS(${eligible}) THEN 1 ELSE 0 END`).bind(fence,b.connection_id,b.external_id,now-3600000,now,b.category_id),
  db.prepare("UPDATE staging_supplier_feed_items SET approval='approved',category_id=?,selling_price_minor=COALESCE(?,supplier_cost_minor),delivery_type=?,reviewed_description=?,reviewed_by=?,reviewed_at=? WHERE connection_id=? AND external_id=?").bind(b.category_id,auto?null:Number(b.price_minor),String(b.delivery_type),b.description.trim(),actor.id,now,b.connection_id,b.external_id),
  db.prepare(`INSERT INTO products(id,category_id,slug,name,description,price_minor,supplier_name,authorized_resale,status,delivery_type,supplier_image_urls,pricing_mode) SELECT ?,category_id,?,name,reviewed_description,selling_price_minor,'YoungPG Media',1,'draft',delivery_type,supplier_image_urls,? FROM staging_supplier_feed_items WHERE connection_id=? AND external_id=? ON CONFLICT(slug) DO NOTHING`).bind(product,slug,auto?'auto':'override',b.connection_id,b.external_id),
  db.prepare('INSERT INTO supplier_products(connection_id,external_id,product_id) SELECT ?,?,id FROM products WHERE slug=? ON CONFLICT(connection_id,external_id) DO NOTHING').bind(b.connection_id,b.external_id,slug),
  db.prepare("UPDATE products SET price_minor=CASE WHEN ?=1 THEN price_minor ELSE ? END,pricing_mode=CASE WHEN ?=1 THEN pricing_mode ELSE 'override' END,description=? WHERE id=(SELECT product_id FROM supplier_products WHERE connection_id=? AND external_id=?)").bind(auto?1:0,auto?null:Number(b.price_minor),auto?1:0,b.description.trim(),b.connection_id,b.external_id),
  db.prepare('DELETE FROM admin_write_fences WHERE id=?').bind(fence),
 ])}catch{throw new HttpError(409,'Approval blocked: require fresh complete snapshot, current product-specific resale evidence, enabled supplier and active category.')}
 const saved=await db.prepare('SELECT product_id FROM supplier_products WHERE connection_id=? AND external_id=?').bind(b.connection_id,b.external_id).first()
 return json({success:true,review:'approved',published:false,...saved})
}
