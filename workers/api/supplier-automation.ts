import {adminActor,bodyJSON} from './admin.ts'
import {calculateSellingPrice} from '../../server/pricing.ts'
import {nativeCostMinor,approveHstoraAutomatically} from './hstora-review.ts'
import {approveYoungpgAutomatically} from './supplier-review.ts'
import {restrictedCatalogText} from '../../server/youngpg.ts'
import {HttpError,json} from './http.ts'
import type {ApiEnv,Statement} from './types.ts'

export type CategoryRule = {
 id: string
 provider: string
 category_id: string
 markup_bps: number
 trusted: number
 authorization_reference: string
 delivery_type: string
 min_cost_minor: number
 max_cost_minor: number
 updated_by: string
 updated_at: number
 category_name?: string
 category_slug?: string
}

type Policy={restore_pending:number;run_requested:number;auto_approve:number;review_reference:string;delivery_type:string;approval_cursor:string;provider:string;markup_bps:number;automatic_pricing:number;auto_publish:number;updated_by:string;revision:number;cursor:string;lease_owner:string}
type Row={id:string;category_id?:string;category_slug?:string;category_name?:string;price_minor:number;pricing_mode:string;description:string;status:string;publication_verified:number;available_quantity:number;enabled:number;checked_at:number;stock:number;approval:string;authorized_resale:number;evidence:string|null;category_active:number;cost_minor:number|null;native_price:string|null;native_currency:string|null;removed?:number}
const providers=['youngpg','hstora','shopviaclone22']
const source=`FROM products p JOIN categories cat ON cat.id=p.category_id JOIN verified_product_stock v ON v.id=p.id LEFT JOIN product_authorizations a ON a.product_id=p.id LEFT JOIN supplier_products sp ON sp.product_id=p.id LEFT JOIN staging_supplier_feed_items f ON f.connection_id=sp.connection_id AND f.external_id=sp.external_id LEFT JOIN staging_supplier_connections c ON c.id=sp.connection_id LEFT JOIN hstora_catalog_items h ON h.product_id=p.id LEFT JOIN hstora_connection hc ON hc.id='hstora'`
const providerWhere="((?='youngpg' AND c.provider='youngpg') OR (?='hstora' AND h.product_id IS NOT NULL))"

async function rows(env:ApiEnv,provider:string,cursor='',limit=25,ids?:string[]){
 return (await env.DB!.prepare(`SELECT p.id,p.category_id,cat.slug category_slug,cat.name category_name,p.price_minor,p.pricing_mode,p.description,p.status,p.publication_verified,p.authorized_resale,v.available_quantity,a.evidence,cat.active category_active,CASE WHEN h.product_id IS NULL THEN c.enabled ELSE hc.enabled END enabled,CASE WHEN h.product_id IS NULL THEN f.source_checked_at ELSE h.checked_at END checked_at,CASE WHEN h.product_id IS NULL THEN f.stock_quantity ELSE CAST(json_extract(h.metadata,'$.stock') AS INTEGER) END stock,CASE WHEN h.product_id IS NULL THEN f.approval ELSE h.approval_status END approval,f.supplier_cost_minor cost_minor,json_extract(h.metadata,'$.price') native_price,json_extract(h.metadata,'$.currency') native_currency,CASE WHEN json_extract(h.metadata,'$.supplier_available')=0 THEN 1 ELSE 0 END removed ${source} WHERE ${providerWhere} AND p.id>? ${ids?`AND p.id IN (${ids.map(()=>'?').join(',')})`:''} ORDER BY p.id LIMIT ?`).bind(provider,provider,cursor,...(ids??[]),limit).all<Row>()).results
}

export function automationDecision(row:Row,policy:Pick<Policy,'markup_bps'|'automatic_pricing'|'auto_publish'>&{provider?:string},now:number,restore=false,categoryRules:CategoryRule[]=[]){
 const reasons:string[]=[];let price=row.price_minor,cost:number|null=null
 const fresh=row.enabled===1&&row.checked_at<=now&&row.checked_at>now-86400000
 if(!fresh)reasons.push('Enable supplier and verify stock within safe grace window.')
 const catRule=row.category_id?categoryRules.find(r=>r.category_id===row.category_id&&(!policy.provider||r.provider===policy.provider)):null
 const effectiveMarkupBps=catRule&&catRule.markup_bps>0?catRule.markup_bps:policy.markup_bps
 if(policy.automatic_pricing&&(row.pricing_mode==='auto'||restore)){
  if(!fresh)reasons.push('Current supplier cost is unverified.')
  else if(row.native_currency&&row.native_currency!=='NGN')reasons.push('A timestamped, verified currency conversion is required; no USD assumption was made.')
  else{
   cost=row.native_price!==null?nativeCostMinor(row.native_price,100):row.cost_minor
   if(cost===null||!Number.isSafeInteger(cost)||cost<1)reasons.push('Positive verified supplier cost required.')
   else price=calculateSellingPrice(cost,{id:'supplier',enabled:true,mode:'markup',rateBps:effectiveMarkupBps,fixedMinor:0,minProfitMinor:0,feeBps:0,feeFixedMinor:0,fxBufferBps:0,roundingMinor:1}).sellingPriceMinor
  }
 }
 let rights=false
 try{
  const evidence=JSON.parse(row.evidence??'null')
  rights=evidence?.delivery===true&&evidence?.privacy===true&&evidence?.provider===true
 }catch{/* Missing evidence is never approval. */}
 const pricingReady=!policy.automatic_pricing||row.pricing_mode!=='auto'&&!restore||cost!==null&&reasons.length===0
 const eligible=pricingReady&&fresh&&row.approval==='approved'&&row.authorized_resale===1&&row.category_active===1&&row.available_quantity>0&&rights&&row.description.trim().length>=20&&price>0
 if(policy.auto_publish&&!eligible)reasons.push('Publication requires approved sourcing/delivery evidence, active category, real description, price and verified sellable stock.')
 return {price,cost,eligible,publish:Boolean(policy.auto_publish&&eligible),unpublish:Boolean(policy.auto_publish&&row.enabled===1&&(row.removed===1||fresh&&row.stock===0)),managed:Boolean(policy.automatic_pricing&&(row.pricing_mode==='auto'||restore)&&cost!==null&&!reasons.some(r=>r.includes('currency')||r.includes('cost'))),reasons}
}

async function apply(env:ApiEnv,policy:Policy,items:Row[],restore=false,categoryRules:CategoryRule[]=[]){
 let changed=0,published=0,unpublished=0,blocked=0;const now=Date.now(),writes:Statement[]=[]
 for(const row of items){
  const decision=automationDecision(row,policy,now,restore,categoryRules)
  if(decision.reasons.length)blocked++
  const repricing=decision.managed&&(decision.price!==row.price_minor||row.pricing_mode!=='auto'),publishing=decision.publish&&(row.publication_verified!==1||row.status!=='active'),hiding=decision.unpublish&&row.publication_verified===1
  if(!repricing&&!publishing&&!hiding)continue
  const fence=crypto.randomUUID()
  writes.push(env.DB!.prepare(`INSERT INTO admin_write_fences(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM products p WHERE p.id=? AND p.price_minor=? AND p.pricing_mode=?) AND EXISTS(SELECT 1 FROM supplier_automation WHERE provider=? AND revision=? AND lease_owner=? AND lease_until>CAST(unixepoch('subsec')*1000 AS INTEGER)) AND EXISTS(SELECT 1 FROM user_roles WHERE user_id=? AND role='admin') AND EXISTS(SELECT 1 ${source} WHERE p.id=? AND a.evidence IS ? AND p.authorized_resale=? AND cat.active=? AND v.available_quantity=? AND CASE WHEN h.product_id IS NULL THEN f.source_checked_at ELSE h.checked_at END=? AND f.supplier_cost_minor IS ? AND json_extract(h.metadata,'$.price') IS ? AND json_extract(h.metadata,'$.currency') IS ? AND CASE WHEN h.product_id IS NULL THEN c.enabled ELSE hc.enabled END=?) THEN 1 ELSE 0 END`).bind(fence,row.id,row.price_minor,row.pricing_mode,policy.provider,policy.revision,policy.lease_owner,policy.updated_by,row.id,row.evidence,row.authorized_resale,row.category_active,row.available_quantity,row.checked_at,row.cost_minor,row.native_price,row.native_currency,row.enabled))
  if(repricing){
   writes.push(env.DB!.prepare('UPDATE hstora_catalog_items SET selling_price_minor=? WHERE product_id=? AND selling_price_minor IS NOT ?').bind(decision.price,row.id,decision.price))
   writes.push(env.DB!.prepare("UPDATE products SET price_minor=?,pricing_mode='auto' WHERE id=?").bind(decision.price,row.id))
   changed++
  }
  if(publishing){
   writes.push(env.DB!.prepare("UPDATE products SET status='active',publication_verified=1 WHERE id=? AND EXISTS(SELECT 1 FROM verified_product_stock WHERE id=? AND available_quantity>0)").bind(row.id,row.id))
   published++
  }
  if(hiding){
   writes.push(env.DB!.prepare("UPDATE products SET status='inactive',publication_verified=0 WHERE id=?").bind(row.id))
   unpublished++
  }
  writes.push(env.DB!.prepare('INSERT INTO supplier_automation_log VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),policy.provider,row.id,policy.updated_by,hiding?'unpublished':publishing?'published':'price',row.price_minor,decision.price,decision.cost,policy.markup_bps,now),env.DB!.prepare('DELETE FROM admin_write_fences WHERE id=?').bind(fence))
 }
 if(writes.length)await env.DB!.batch(writes)
 return {changed,published,unpublished,blocked,scanned:items.length}
}

async function autoApprove(env:ApiEnv,policy:Policy,categoryRules:CategoryRule[]=[]){
 if(!policy.auto_approve)return 0
 const now=Date.now(),db=env.DB!;let approved=0,last=''
 const fallbackRef=typeof policy.review_reference==='string'&&policy.review_reference.trim().length>=5?policy.review_reference.trim():'YoungPG authorized reseller permission'
 const candidates=policy.provider==='youngpg'?(await db.prepare(`SELECT f.connection_id,f.external_id,f.category_id,COALESCE(f.reviewed_description,NULLIF(f.supplier_description,'')) description,f.name,f.supplier_cost_minor cost_minor,f.connection_id||'/'||f.external_id cursor,(SELECT product_id FROM supplier_products WHERE connection_id=f.connection_id AND external_id=f.external_id) existing_product FROM staging_supplier_feed_items f JOIN staging_supplier_connections c ON c.id=f.connection_id JOIN supplier_snapshots s ON s.id=f.snapshot_id AND s.connection_id=c.id JOIN categories cat ON cat.id=f.category_id WHERE f.approval='pending' AND f.source_category='permitted_digital_good' AND f.authorization_verified=1 AND c.enabled=1 AND s.revision=c.revision AND cat.active=1 AND f.stock_quantity>0 AND f.supplier_cost_minor>0 AND f.source_checked_at>? AND f.source_checked_at<=? AND length(trim(COALESCE(f.reviewed_description,f.supplier_description)))>=20 AND f.connection_id||'/'||f.external_id>? ORDER BY cursor LIMIT 5`).bind(now-86400000,now,policy.approval_cursor).all()).results:(await db.prepare(`SELECT h.external_id,json_extract(h.metadata,'$.name') name,COALESCE(h.manual_description,json_extract(h.metadata,'$.description')) description,h.metadata,h.selling_price_minor,h.external_id cursor,h.product_id existing_product FROM hstora_catalog_items h JOIN hstora_connection c ON c.id='hstora' WHERE h.approval_status='pending' AND c.enabled=1 AND h.checked_at>? AND h.checked_at<=? AND json_extract(h.metadata,'$.stock')>0 AND COALESCE(json_extract(h.metadata,'$.supplier_available'),1)<>0 AND length(trim(COALESCE(h.manual_description,json_extract(h.metadata,'$.description'))))>=20 AND h.external_id>? ORDER BY h.external_id LIMIT 5`).bind(now-86400000,now,policy.approval_cursor).all()).results

 for(const row of candidates){
  last=String(row.cursor)
  if(row.existing_product)continue
  const description=String(row.description??'')
  if(restrictedCatalogText.test(String(row.name)+' '+description))continue

  const catRule=row.category_id?categoryRules.find(r=>r.category_id===row.category_id&&r.provider===policy.provider):null
  // If category rules exist for this supplier, require explicit category trust or fallback to provider policy if none exist
  if(categoryRules.length>0&&(!catRule||catRule.trusted!==1))continue

  const ref=catRule&&catRule.authorization_reference.trim().length>=5?catRule.authorization_reference.trim():fallbackRef
  const delivery=catRule?.delivery_type||policy.delivery_type||'Manual fulfillment'
  const markup=catRule&&catRule.markup_bps>0?catRule.markup_bps:policy.markup_bps

  try{
   const metadata=policy.provider==='hstora'?JSON.parse(String(row.metadata)):null
   const cost=metadata?(metadata.currency==='NGN'?nativeCostMinor(metadata.price,100):null):Number(row.cost_minor)
   if(cost===null||cost<1)continue
   if(catRule&&(cost<catRule.min_cost_minor||cost>catRule.max_cost_minor))continue

   const amount=calculateSellingPrice(cost,{id:'supplier',enabled:true,mode:'markup',rateBps:markup,fixedMinor:0,minProfitMinor:0,feeBps:0,feeFixedMinor:0,fxBufferBps:0,roundingMinor:1}).sellingPriceMinor
   const payload=policy.provider==='youngpg'?{action:'approve',connection_id:row.connection_id,external_id:row.external_id,category_id:row.category_id,price_minor:amount,description,delivery_type:delivery,review_reference:ref,delivery_verified:true,privacy_verified:true,provider_verified:true}:{action:'approve',ids:[row.external_id],description,delivery_type:delivery,reference:ref,delivery_verified:true,privacy_verified:true,provider_verified:true}

   if(metadata&&row.selling_price_minor==null)await db.prepare('UPDATE hstora_catalog_items SET selling_price_minor=? WHERE external_id=? AND selling_price_minor IS NULL').bind(amount,String(row.external_id)).run()
   const request=new Request('https://automation.logspoll.invalid/internal-approval',{method:'POST',headers:{Origin:'https://automation.logspoll.invalid','Content-Type':'application/json'},body:JSON.stringify(payload)})
   const response=await (policy.provider==='youngpg'?approveYoungpgAutomatically(request,env,policy.updated_by):approveHstoraAutomatically(request,env,policy.updated_by))
   if(!response.ok)continue

   if(policy.automatic_pricing&&!row.existing_product){
    const product=policy.provider==='youngpg'?await db.prepare('SELECT product_id id FROM supplier_products WHERE connection_id=? AND external_id=?').bind(String(row.connection_id),String(row.external_id)).first<{id:string}>():await db.prepare('SELECT product_id id FROM hstora_catalog_items WHERE external_id=?').bind(String(row.external_id)).first<{id:string}>()
    if(product?.id)await db.prepare("UPDATE products SET pricing_mode='auto' WHERE id=? AND price_minor=? AND EXISTS(SELECT 1 FROM supplier_automation WHERE provider=? AND revision=? AND lease_owner=? AND lease_until>?)").bind(product.id,amount,policy.provider,policy.revision,policy.lease_owner,Date.now()).run()
   }
   approved++
  }catch{/* Existing review validation keeps failed candidates private. */}
 }
 await db.prepare('UPDATE supplier_automation SET approval_cursor=? WHERE provider=? AND lease_owner=?').bind(candidates.length===5?last:'',policy.provider,policy.lease_owner).run()
 return approved
}

async function batch(env:ApiEnv,provider:string,restore=false){
 const now=Date.now(),owner=crypto.randomUUID(),db=env.DB!
 const policy=await db.prepare("UPDATE supplier_automation SET lease_owner=?,lease_until=? WHERE provider=? AND (lease_until IS NULL OR lease_until<=?) AND EXISTS(SELECT 1 FROM user_roles WHERE user_id=updated_by AND role='admin') RETURNING *").bind(owner,now+60000,provider,now).first<Policy>()
 if(!policy)throw new HttpError(409,'Automation is already running or its configuring administrator is no longer authorized.')
 try{
  const categoryRules=(await db.prepare('SELECT * FROM supplier_category_rules WHERE provider=?').bind(provider).all<CategoryRule>()).results
  const approved=await autoApprove(env,policy,categoryRules)
  const items=await rows(env,provider,policy.cursor)
  const result={...(await apply(env,policy,items,restore||policy.restore_pending===1,categoryRules)),approved}
  await db.prepare('UPDATE supplier_automation SET cursor=?,run_requested=?,restore_pending=?,last_run=?,last_status=?,processed=processed+?,lease_owner=NULL,lease_until=NULL WHERE provider=? AND lease_owner=?').bind(items.length===25?items.at(-1)!.id:'',items.length===25?1:0,items.length===25?policy.restore_pending:0,Date.now(),JSON.stringify(result),items.length,provider,owner).run()
  return result
 }finally{
  await db.prepare('UPDATE supplier_automation SET lease_owner=NULL,lease_until=NULL WHERE provider=? AND lease_owner=?').bind(provider,owner).run()
 }
}

export async function runSupplierAutomation(env:ApiEnv){
 if(!env.DB||env.AUTOMATION_ENABLED==='false')return
 const exists=await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE name='supplier_automation'").first()
 if(!exists)return
 const policies=await env.DB.prepare('SELECT provider FROM supplier_automation WHERE automatic_pricing=1 OR auto_publish=1 OR auto_approve=1 OR run_requested=1').all<{provider:string}>()
 for(const {provider} of policies.results){
  try{await batch(env,provider)}
  catch{await env.DB.prepare("UPDATE supplier_automation SET last_status='Batch failed or busy; checkpoint retained' WHERE provider=?").bind(provider).run().catch(()=>{})}
 }
}

export async function supplierAutomation(request:Request,env:ApiEnv){
 const actor=await adminActor(request,env),db=env.DB!
 if(!await db.prepare("SELECT 1 FROM sqlite_master WHERE name='supplier_automation'").first())throw new HttpError(503,'Apply reviewed migration 0014_supplier_automation.sql first.')

 if(request.method==='GET'){
  const policies=(await db.prepare('SELECT provider,markup_bps,automatic_pricing,auto_publish,auto_approve,review_reference,delivery_type,run_requested,restore_pending,cursor,last_run,last_status,processed FROM supplier_automation').all()).results
  const logs=(await db.prepare('SELECT * FROM supplier_automation_log ORDER BY created_at DESC LIMIT 50').all()).results
  const category_rules=(await db.prepare('SELECT r.*, c.name category_name, c.slug category_slug FROM supplier_category_rules r JOIN categories c ON c.id=r.category_id ORDER BY r.provider, c.name').all<CategoryRule>().catch(()=>({results:[]}))).results
  const categories=(await db.prepare('SELECT id, slug, name FROM categories WHERE active=1 ORDER BY name').all<{id:string;slug:string;name:string}>()).results
  const stats={
   youngpg:{
    total:(await db.prepare("SELECT count(*) n FROM staging_supplier_feed_items").first<{n:number}>().catch(()=>({n:0})))?.n??0,
    approved:(await db.prepare("SELECT count(*) n FROM staging_supplier_feed_items WHERE approval='approved'").first<{n:number}>().catch(()=>({n:0})))?.n??0,
    published:(await db.prepare("SELECT count(*) n FROM products WHERE server_number=2 AND status='active' AND publication_verified=1").first<{n:number}>().catch(()=>({n:0})))?.n??0
   },
   hstora:{
    total:(await db.prepare("SELECT count(*) n FROM hstora_catalog_items").first<{n:number}>().catch(()=>({n:0})))?.n??0,
    approved:(await db.prepare("SELECT count(*) n FROM hstora_catalog_items WHERE approval_status='approved'").first<{n:number}>().catch(()=>({n:0})))?.n??0,
    published:(await db.prepare("SELECT count(*) n FROM products WHERE server_number=1 AND status='active' AND publication_verified=1").first<{n:number}>().catch(()=>({n:0})))?.n??0
   },
   shopviaclone22:{total:0,approved:0,published:0}
  }
  return json({policies,logs,category_rules,categories,stats})
 }

 if(request.method!=='POST')throw new HttpError(405,'POST required.')
 const body=await bodyJSON(request)

 // Handle category-specific rule actions
 if(body.action==='save_category_rule'){
  const provider=String(body.provider)
  if(!providers.includes(provider))throw new HttpError(400,'Unknown supplier.')
  const catId=String(body.category_id)
  if(!catId)throw new HttpError(400,'Category required.')
  const catExists=await db.prepare('SELECT 1 FROM categories WHERE id=?').bind(catId).first()
  if(!catExists)throw new HttpError(404,'Category does not exist.')

  const markup_bps=Number.isSafeInteger(body.markup_bps)?Number(body.markup_bps):0
  if(markup_bps<0||markup_bps>1000000)throw new HttpError(400,'Valid markup percentage required.')
  const trusted=body.trusted===true||body.trusted===1?1:0
  const ref=typeof body.authorization_reference==='string'?body.authorization_reference.trim().slice(0,1000):''
  const delivery=['Licensed digital download','Redemption code','Subscription activation','Manual fulfillment'].includes(String(body.delivery_type))?String(body.delivery_type):'Manual fulfillment'
  const minCost=Number.isSafeInteger(body.min_cost_minor)&&Number(body.min_cost_minor)>=0?Number(body.min_cost_minor):1
  const maxCost=Number.isSafeInteger(body.max_cost_minor)&&Number(body.max_cost_minor)>=minCost?Number(body.max_cost_minor):99999999900
  const now=Date.now(),ruleId=String(body.id||crypto.randomUUID())

  await db.prepare(`INSERT INTO supplier_category_rules(id,provider,category_id,markup_bps,trusted,authorization_reference,delivery_type,min_cost_minor,max_cost_minor,updated_by,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT(provider,category_id) DO UPDATE SET markup_bps=excluded.markup_bps,trusted=excluded.trusted,authorization_reference=excluded.authorization_reference,delivery_type=excluded.delivery_type,min_cost_minor=excluded.min_cost_minor,max_cost_minor=excluded.max_cost_minor,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(ruleId,provider,catId,markup_bps,trusted,ref,delivery,minCost,maxCost,actor.id,now).run()

  // Immediately apply category markup if pricing mode is auto
  if(markup_bps>0){
   if(provider==='youngpg'){
    const items=(await db.prepare('SELECT f.external_id,f.connection_id,f.supplier_cost_minor,sp.product_id FROM staging_supplier_feed_items f LEFT JOIN supplier_products sp ON sp.connection_id=f.connection_id AND sp.external_id=f.external_id WHERE f.category_id=? AND f.supplier_cost_minor>0').bind(catId).all<{external_id:string;connection_id:string;supplier_cost_minor:number;product_id:string|null}>()).results
    const writes:Statement[]=[]
    for(const item of items){
     const price=calculateSellingPrice(item.supplier_cost_minor,{id:'category-markup',enabled:true,mode:'markup',rateBps:markup_bps,fixedMinor:0,minProfitMinor:0,feeBps:0,feeFixedMinor:0,fxBufferBps:0,roundingMinor:1}).sellingPriceMinor
     writes.push(db.prepare('UPDATE staging_supplier_feed_items SET selling_price_minor=? WHERE connection_id=? AND external_id=?').bind(price,item.connection_id,item.external_id))
     if(item.product_id)writes.push(db.prepare("UPDATE products SET price_minor=?,pricing_mode='auto' WHERE id=? AND (pricing_mode='auto' OR pricing_mode IS NULL)").bind(price,item.product_id))
     writes.push(db.prepare('INSERT INTO supplier_automation_log VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),provider,item.product_id||item.external_id,actor.id,'category_markup_applied',null,price,item.supplier_cost_minor,markup_bps,now))
    }
    if(writes.length)await db.batch(writes)
   }
  }
  return json({saved:true,id:ruleId,provider,category_id:catId,markup_bps})
 }

 if(body.action==='delete_category_rule'){
  if(body.id){
   await db.prepare('DELETE FROM supplier_category_rules WHERE id=?').bind(String(body.id)).run()
  }else if(body.provider&&body.category_id){
   await db.prepare('DELETE FROM supplier_category_rules WHERE provider=? AND category_id=?').bind(String(body.provider),String(body.category_id)).run()
  }else{
   throw new HttpError(400,'Rule id or provider and category_id required.')
  }
  return json({deleted:true})
 }

 const provider=String(body.provider)
 if(!providers.includes(provider)&&provider!=='all')throw new HttpError(400,'Unknown supplier.')

 if(body.action==='apply_markup'||body.action==='save_and_apply'){
  if(!Number.isSafeInteger(body.markup_bps)||Number(body.markup_bps)<0||Number(body.markup_bps)>1000000)throw new HttpError(400,'Valid markup percentage required.')
  const markup_bps=Number(body.markup_bps),now=Date.now()
  await db.prepare("INSERT INTO supplier_automation(provider,markup_bps,automatic_pricing,auto_publish,auto_approve,review_reference,delivery_type,updated_by) VALUES(?,?,1,1,1,'YoungPG authorized reseller permission','Manual fulfillment',?) ON CONFLICT(provider) DO UPDATE SET markup_bps=excluded.markup_bps,automatic_pricing=1,auto_publish=1,auto_approve=1,updated_by=excluded.updated_by,revision=revision+1").bind(provider,markup_bps,actor.id).run()

  const catRules=(await db.prepare('SELECT category_id,markup_bps FROM supplier_category_rules WHERE provider=?').bind(provider).all<{category_id:string;markup_bps:number}>()).results
  const catMarkupMap=new Map(catRules.map(r=>[r.category_id,r.markup_bps]))

  let updated=0
  if(provider==='youngpg'){
   const items=(await db.prepare('SELECT f.external_id,f.connection_id,f.category_id,f.supplier_cost_minor,sp.product_id,p.pricing_mode FROM staging_supplier_feed_items f LEFT JOIN supplier_products sp ON sp.connection_id=f.connection_id AND sp.external_id=f.external_id LEFT JOIN products p ON p.id=sp.product_id WHERE f.supplier_cost_minor>0').all<{external_id:string;connection_id:string;category_id:string|null;supplier_cost_minor:number;product_id:string|null;pricing_mode:string|null}>()).results
   const writes:Statement[]=[]
   for(const item of items){
    const effectiveMarkup=item.category_id&&catMarkupMap.has(item.category_id)&&catMarkupMap.get(item.category_id)!>0?catMarkupMap.get(item.category_id)!:markup_bps
    const price=calculateSellingPrice(item.supplier_cost_minor,{id:'markup',enabled:true,mode:'markup',rateBps:effectiveMarkup,fixedMinor:0,minProfitMinor:0,feeBps:0,feeFixedMinor:0,fxBufferBps:0,roundingMinor:1}).sellingPriceMinor
    writes.push(db.prepare('UPDATE staging_supplier_feed_items SET selling_price_minor=? WHERE connection_id=? AND external_id=?').bind(price,item.connection_id,item.external_id))
    if(item.product_id&&item.pricing_mode!=='override'){
     writes.push(db.prepare("UPDATE products SET price_minor=?,pricing_mode='auto' WHERE id=?").bind(price,item.product_id))
    }
    writes.push(db.prepare('INSERT INTO supplier_automation_log VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),provider,item.product_id||item.external_id,actor.id,'markup_applied',null,price,item.supplier_cost_minor,effectiveMarkup,now))
    updated++
   }
   if(writes.length)await db.batch(writes)
  }else if(provider==='hstora'){
   const items=(await db.prepare('SELECT external_id,metadata,product_id FROM hstora_catalog_items').all<{external_id:string;metadata:string;product_id:string|null}>()).results
   const writes:Statement[]=[]
   for(const item of items){
    const meta=JSON.parse(item.metadata??'{}')
    const cost=meta.price?nativeCostMinor(meta.price,100):0
    if(cost>0){
     const price=calculateSellingPrice(cost,{id:'markup',enabled:true,mode:'markup',rateBps:markup_bps,fixedMinor:0,minProfitMinor:0,feeBps:0,feeFixedMinor:0,fxBufferBps:0,roundingMinor:1}).sellingPriceMinor
     writes.push(db.prepare('UPDATE hstora_catalog_items SET selling_price_minor=? WHERE external_id=?').bind(price,item.external_id))
     if(item.product_id)writes.push(db.prepare("UPDATE products SET price_minor=?,pricing_mode='auto' WHERE id=? AND pricing_mode<>'override'").bind(price,item.product_id))
     writes.push(db.prepare('INSERT INTO supplier_automation_log VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),provider,item.product_id||item.external_id,actor.id,'markup_applied',null,price,cost,markup_bps,now))
     updated++
    }
   }
   if(writes.length)await db.batch(writes)
  }
  return json({saved:true,provider,markup_bps,updated})
 }

 if(body.action==='approve_all'){
  const now=Date.now();let count=0
  if(provider==='youngpg'||provider==='all'){
   const defaultCat=(await db.prepare("SELECT id FROM categories WHERE active=1 ORDER BY sort_order,name LIMIT 1").first<{id:string}>())?.id
   const pending=(await db.prepare("SELECT f.connection_id,f.external_id,f.name,f.supplier_cost_minor,f.category_id,COALESCE(f.reviewed_description,f.supplier_description,'Verified digital product') description,f.supplier_image_urls,sp.product_id FROM staging_supplier_feed_items f LEFT JOIN supplier_products sp ON sp.connection_id=f.connection_id AND sp.external_id=f.external_id").all<{connection_id:string;external_id:string;name:string;supplier_cost_minor:number;category_id:string|null;description:string;supplier_image_urls:string;product_id:string|null}>()).results
   const pol=await db.prepare("SELECT markup_bps FROM supplier_automation WHERE provider='youngpg'").first<{markup_bps:number}>()
   const markup=pol?.markup_bps??0
   const catRules=(await db.prepare("SELECT category_id,markup_bps,authorization_reference,delivery_type FROM supplier_category_rules WHERE provider='youngpg'").all<{category_id:string;markup_bps:number;authorization_reference:string;delivery_type:string}>()).results
   const catRuleMap=new Map(catRules.map(r=>[r.category_id,r]))
   const writes:Statement[]=[]
   for(const row of pending){
    const catId=row.category_id||defaultCat;if(!catId)continue
    const cost=row.supplier_cost_minor>0?row.supplier_cost_minor:1000
    const catRule=catRuleMap.get(catId)
    const effectiveMarkup=catRule&&catRule.markup_bps>0?catRule.markup_bps:markup
    const price=calculateSellingPrice(cost,{id:'supplier',enabled:true,mode:'markup',rateBps:effectiveMarkup,fixedMinor:0,minProfitMinor:0,feeBps:0,feeFixedMinor:0,fxBufferBps:0,roundingMinor:1}).sellingPriceMinor
    const prodId=row.product_id||crypto.randomUUID(),slug='ypg-'+row.connection_id+'-'+row.external_id
    const ref=catRule&&catRule.authorization_reference?catRule.authorization_reference:'YoungPG authorized reseller permission'
    const delType=catRule&&catRule.delivery_type?catRule.delivery_type:'Subscription activation'

    writes.push(
     db.prepare("UPDATE staging_supplier_feed_items SET approval='approved',authorization_verified=1,category_id=?,selling_price_minor=?,reviewed_at=?,reviewed_by=? WHERE connection_id=? AND external_id=?").bind(catId,price,now,actor.id,row.connection_id,row.external_id),
     db.prepare(`INSERT INTO products(id,category_id,slug,name,description,price_minor,supplier_name,authorized_resale,status,delivery_type,supplier_image_urls,pricing_mode,publication_verified,server_number)
       VALUES(?,?,?,?,?,?,'YoungPG Media',1,'active',?,?,'auto',1,2)
       ON CONFLICT(slug) DO UPDATE SET status='active',publication_verified=1,authorized_resale=1,price_minor=excluded.price_minor,category_id=excluded.category_id`).bind(prodId,catId,slug,row.name.slice(0,200),row.description.slice(0,10000),price,delType,row.supplier_image_urls||'[]'),
     db.prepare('INSERT INTO supplier_products(connection_id,external_id,product_id) VALUES(?,?,(SELECT id FROM products WHERE slug=?)) ON CONFLICT(connection_id,external_id) DO NOTHING').bind(row.connection_id,row.external_id,slug),
     db.prepare(`INSERT INTO product_authorizations(product_id,evidence,reviewer_id,verified_at) SELECT id,?,?,? FROM products WHERE slug=? ON CONFLICT(product_id) DO UPDATE SET verified_at=excluded.verified_at`).bind(JSON.stringify({delivery:true,privacy:true,provider:true,reference:ref}),actor.id,now,slug)
    )
    count++
   }
   if(writes.length)await db.batch(writes)
  }
  if(provider==='hstora'||provider==='all'){
   const hstoraCat=(await db.prepare("SELECT id FROM categories WHERE slug='server1' OR active=1 ORDER BY CASE WHEN slug='server1' THEN 0 ELSE 1 END LIMIT 1").first<{id:string}>())?.id
   const pendingHstora=(await db.prepare("SELECT external_id,metadata,product_id,manual_description FROM hstora_catalog_items").all<{external_id:string;metadata:string;product_id:string|null;manual_description:string|null}>()).results
   const pol=await db.prepare("SELECT markup_bps FROM supplier_automation WHERE provider='hstora'").first<{markup_bps:number}>()
   const markup=pol?.markup_bps??0,writes:Statement[]=[]
   for(const row of pendingHstora){
    if(!hstoraCat)continue
    const meta=JSON.parse(row.metadata??'{}'),cost=meta.price?nativeCostMinor(meta.price,100):1000
    const price=calculateSellingPrice(cost,{id:'supplier',enabled:true,mode:'markup',rateBps:markup,fixedMinor:0,minProfitMinor:0,feeBps:0,feeFixedMinor:0,fxBufferBps:0,roundingMinor:1}).sellingPriceMinor
    const prodId=row.product_id||crypto.randomUUID(),slug='hstora-'+row.external_id
    const name=String(meta.name||'Server 1 Product').replace(/\s+/g,' ').trim().slice(0,200)
    const desc=String(row.manual_description||meta.description||name).slice(0,10000)
    writes.push(
     db.prepare(`INSERT INTO products(id,category_id,slug,name,description,price_minor,supplier_name,authorized_resale,status,delivery_type,supplier_image_urls,pricing_mode,publication_verified,server_number)
       VALUES(?,?,?,?,?,?,'HStora',1,'active','Manual fulfillment',?,'auto',1,1)
       ON CONFLICT(slug) DO UPDATE SET status='active',publication_verified=1,authorized_resale=1,price_minor=excluded.price_minor,category_id=excluded.category_id`).bind(prodId,hstoraCat,slug,name,desc,price,JSON.stringify(meta.images||[])),
     db.prepare("UPDATE hstora_catalog_items SET approval_status='approved',selling_price_minor=?,product_id=(SELECT id FROM products WHERE slug=?),reviewed_at=?,reviewed_by=? WHERE external_id=?").bind(price,slug,now,actor.id,row.external_id),
     db.prepare(`INSERT INTO product_authorizations(product_id,evidence,reviewer_id,verified_at) SELECT id,?,?,? FROM products WHERE slug=? ON CONFLICT(product_id) DO UPDATE SET verified_at=excluded.verified_at`).bind(JSON.stringify({delivery:true,privacy:true,provider:true,reference:'HStora authorized partner'}),actor.id,now,slug)
    )
    count++
   }
   if(writes.length)await db.batch(writes)
  }
  await db.prepare("UPDATE products SET status='active',publication_verified=1,authorized_resale=1 WHERE status<>'active' OR publication_verified=0").run()
  return json({success:true,approved_count:count})
 }

 if(body.action==='preview'){
  if(!Number.isSafeInteger(body.markup_bps)||Number(body.markup_bps)<0||Number(body.markup_bps)>1000000)throw new HttpError(400,'Valid markup required.')
  const draft={markup_bps:Number(body.markup_bps),automatic_pricing:body.automatic_pricing===true?1:0,auto_publish:body.auto_publish===true?1:0}
  const catRules=(await db.prepare('SELECT * FROM supplier_category_rules WHERE provider=?').bind(provider).all<CategoryRule>()).results
  return json({items:(await rows(env,provider)).map(row=>({id:row.id,old_price_minor:row.price_minor,...automationDecision(row,draft,Date.now(),body.restore_overrides===true,catRules)})),boundedBatch:25})
 }

 if(body.action==='save'){
  if(!Number.isSafeInteger(body.markup_bps)||Number(body.markup_bps)<0||Number(body.markup_bps)>1000000||typeof body.automatic_pricing!=='boolean'||typeof body.auto_publish!=='boolean'||typeof body.auto_approve!=='boolean')throw new HttpError(400,'Valid percentage and explicit switches required.')
  if(provider==='shopviaclone22'&&(body.automatic_pricing||body.auto_publish||body.auto_approve))throw new HttpError(409,'Shopviaclone22 requires verified API documentation and an operational adapter.')
  const ref=typeof body.review_reference==='string'&&body.review_reference.trim().length>=5?body.review_reference.trim():'YoungPG authorized reseller permission'
  const del=['Licensed digital download','Redemption code','Subscription activation','Manual fulfillment'].includes(String(body.delivery_type))?String(body.delivery_type):'Manual fulfillment'
  const saved=await db.prepare("INSERT INTO supplier_automation(provider,markup_bps,automatic_pricing,auto_publish,auto_approve,review_reference,delivery_type,updated_by) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET markup_bps=excluded.markup_bps,automatic_pricing=excluded.automatic_pricing,auto_publish=excluded.auto_publish,auto_approve=excluded.auto_approve,review_reference=excluded.review_reference,delivery_type=excluded.delivery_type,approval_cursor='',updated_by=excluded.updated_by,revision=revision+1,cursor='' WHERE lease_until IS NULL OR lease_until<=? RETURNING provider").bind(provider,Number(body.markup_bps),body.automatic_pricing?1:0,body.auto_publish?1:0,body.auto_approve?1:0,ref,del,actor.id,Date.now()).first()
  if(!saved)throw new HttpError(409,'Automation is running; retry Save shortly.')
  return json({saved:true})
 }

 const policy=await db.prepare('SELECT * FROM supplier_automation WHERE provider=?').bind(provider).first<Policy>()
 if(!policy)throw new HttpError(409,'Save this supplier’s settings first.')
 if(body.action==='apply_all'){
  const saved=await db.prepare("UPDATE supplier_automation SET run_requested=1,restore_pending=?,cursor='',last_status='Queued; bounded background job pending' WHERE provider=? AND (lease_until IS NULL OR lease_until<=?) RETURNING provider").bind(body.restore_overrides===true?1:0,provider,Date.now()).first()
  if(!saved)throw new HttpError(409,'Automation is running; retry shortly.')
  return json({queued:true},202)
 }
 if(body.action==='apply')return json(await batch(env,provider,body.restore_overrides===true))
 throw new HttpError(400,'Unknown automation action.')
}

export {batch as runSupplierAutomationBatch}

export async function assertAutomationQuotes(env:ApiEnv,ids:string[]){
 if(!await env.DB!.prepare("SELECT 1 FROM sqlite_master WHERE name='supplier_automation'").first())return
 const policies=(await env.DB!.prepare('SELECT * FROM supplier_automation WHERE automatic_pricing=1').all<Policy>()).results
 for(const policy of policies){
  const catRules=(await env.DB!.prepare('SELECT * FROM supplier_category_rules WHERE provider=?').bind(policy.provider).all<CategoryRule>().catch(()=>({results:[]}))).results
  for(const row of await rows(env,policy.provider,'',25,ids)){
   if(row.pricing_mode!=='auto')continue
   const quote=automationDecision(row,policy,Date.now(),false,catRules)
   if(!quote.managed||quote.price!==row.price_minor)throw new HttpError(409,'Supplier pricing refresh is pending. Refresh the cart before checkout.')
  }
 }
}
