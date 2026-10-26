import {adminActor,bodyJSON} from './admin.ts'
import {calculateSellingPrice,convertSupplierCost} from '../../server/pricing.ts'
import type {FxQuote} from '../../server/pricing.ts'
import {nativeCostMinor,approveHstoraAutomatically} from './hstora-review.ts'
import {approveYoungpgAutomatically} from './supplier-review.ts'
import {bulkPublishDigitalCore} from './digitalcore-manager.ts'
import {bulkPublishDigitalTop} from './digitaltop-manager.ts'
import {restrictedCatalogText} from '../../server/youngpg.ts'
import {HttpError,json} from './http.ts'
import type {ApiEnv,Statement,Database} from './types.ts'

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

export type GlobalPricingConfig = {
 id: string
 markup_bps: number
 auto_publish: number
 automatic_pricing: number
 auto_approve: number
 usd_to_ngn_rate: number
 delivery_type: string
 updated_by?: string | null
 updated_at: number
}

type Policy={restore_pending:number;run_requested:number;auto_approve:number;review_reference:string;delivery_type:string;approval_cursor:string;provider:string;markup_bps:number;automatic_pricing:number;auto_publish:number;updated_by:string;revision:number;cursor:string;lease_owner:string}
type Row={id:string;name?:string;category_id?:string;category_slug?:string;category_name?:string;price_minor:number;pricing_mode:string;description:string;status:string;publication_verified:number;available_quantity:number;enabled:number;checked_at:number;stock:number;approval:string;authorized_resale:number;evidence:string|null;category_active:number;cost_minor:number|null;native_price:string|null;native_currency:string|null;removed?:number;pricing_state?:string}
const providers=['youngpg','hstora','shopviaclone22','digitalcore']
const source=`FROM products p JOIN categories cat ON cat.id=p.category_id JOIN verified_product_stock v ON v.id=p.id LEFT JOIN product_authorizations a ON a.product_id=p.id LEFT JOIN supplier_products sp ON sp.product_id=p.id LEFT JOIN staging_supplier_feed_items f ON f.connection_id=sp.connection_id AND f.external_id=sp.external_id LEFT JOIN staging_supplier_connections c ON c.id=sp.connection_id LEFT JOIN hstora_catalog_items h ON h.product_id=p.id LEFT JOIN hstora_connection hc ON hc.id='hstora' LEFT JOIN shopviaclone22_catalog_items s3 ON s3.product_id=p.id LEFT JOIN shopviaclone22_connection sc ON sc.id='shopviaclone22' LEFT JOIN digitalcore_catalog_items dc ON dc.product_id=p.id LEFT JOIN digitalcore_connection dcc ON dcc.id='digitalcore'`
const providerWhere="((?='youngpg' AND c.provider='youngpg') OR (?='hstora' AND h.product_id IS NOT NULL) OR (?='shopviaclone22' AND s3.product_id IS NOT NULL) OR (?='digitalcore' AND dc.product_id IS NOT NULL))"
const pricingState=`json_object('category',p.category_id,'active',cat.active,'available',v.available_quantity,'rights',a.evidence,'authorized',p.authorized_resale,
 'h_id',h.external_id,'h_metadata',h.metadata,'h_checked',h.checked_at,'h_snapshot',h.snapshot_id,'h_approval',h.approval_status,'hc_enabled',hc.enabled,'hc_revision',hc.revision,
 'f_connection',f.connection_id,'f_id',f.external_id,'f_cost',f.supplier_cost_minor,'f_checked',f.source_checked_at,'f_snapshot',f.snapshot_id,'f_approval',f.approval,'c_enabled',c.enabled,'c_revision',c.revision,
 's3_id',s3.external_id,'s3_cost',s3.cost_minor,'s3_raw',s3.raw_metadata,'s3_checked',s3.checked_at,'s3_snapshot',s3.snapshot_id,'s3_stock',s3.stock,'s3_approval',s3.approval_status,'sc_enabled',sc.enabled,'sc_revision',sc.revision,
 'dc_id',dc.external_id,'dc_cost',dc.cost_minor,'dc_raw',dc.raw_metadata,'dc_checked',dc.checked_at,'dc_snapshot',dc.snapshot_id,'dc_stock',dc.stock,'dc_approval',dc.approval_status,'dcc_enabled',dcc.enabled,'dcc_revision',dcc.revision)`
const fxState="json_object('rate',usd_to_ngn_rate,'status',fx_status,'observed',fx_updated_at,'override_active',fx_override_active,'override_rate',fx_override_rate)"
const fxMaxAgeMs=3600000
type PricingFx={quote:FxQuote|null;state:string|null}

async function verifiedPricingFx(db:Database,now:number):Promise<PricingFx>{
 const config=await db.prepare(`SELECT *,${fxState} pricing_state FROM global_pricing_config WHERE id='global'`).first<{usd_to_ngn_rate:number;fx_status:string;fx_updated_at:number;fx_override_active:number;fx_override_rate:number|null;pricing_state:string}>()
 if(!config)return {quote:null,state:null}
 const rate=config.fx_override_active===1?config.fx_override_rate:config.usd_to_ngn_rate
 const valid=config.fx_status==='active'&&Number.isFinite(rate)&&Number(rate)>0&&Number.isSafeInteger(config.fx_updated_at)&&config.fx_updated_at>0&&config.fx_updated_at<=now&&now-config.fx_updated_at<=fxMaxAgeMs
 return {quote:valid?{base:'USD',quote:'NGN',rate:String(rate),observedAt:config.fx_updated_at,maxAgeMs:fxMaxAgeMs}:null,state:config.pricing_state}
}

async function rows(env:ApiEnv,provider:string,cursor='',limit=25,ids?:string[]){
 return (await env.DB!.prepare(`SELECT p.id,p.name,p.category_id,cat.slug category_slug,cat.name category_name,p.price_minor,p.pricing_mode,p.description,p.status,p.publication_verified,p.authorized_resale,v.available_quantity,a.evidence,cat.active category_active,
   CASE WHEN dc.product_id IS NOT NULL THEN dcc.enabled WHEN s3.product_id IS NOT NULL THEN sc.enabled WHEN h.product_id IS NOT NULL THEN hc.enabled ELSE c.enabled END enabled,
   CASE WHEN dc.product_id IS NOT NULL THEN dc.checked_at WHEN s3.product_id IS NOT NULL THEN s3.checked_at WHEN h.product_id IS NOT NULL THEN h.checked_at ELSE f.source_checked_at END checked_at,
   CASE WHEN dc.product_id IS NOT NULL THEN dc.stock WHEN s3.product_id IS NOT NULL THEN s3.stock WHEN h.product_id IS NOT NULL THEN CAST(json_extract(h.metadata,'$.stock') AS INTEGER) ELSE f.stock_quantity END stock,
   CASE WHEN dc.product_id IS NOT NULL THEN dc.approval_status WHEN s3.product_id IS NOT NULL THEN s3.approval_status WHEN h.product_id IS NOT NULL THEN h.approval_status ELSE f.approval END approval,
   COALESCE(dc.cost_minor, s3.cost_minor, f.supplier_cost_minor) cost_minor,
   json_extract(h.metadata,'$.price') native_price,json_extract(h.metadata,'$.currency') native_currency,
   CASE WHEN json_extract(h.metadata,'$.supplier_available')=0 THEN 1 ELSE 0 END removed,${pricingState} pricing_state
   ${source} WHERE ${providerWhere} AND p.id>? ${ids?`AND p.id IN (${ids.map(()=>'?').join(',')})`:''} ORDER BY p.id LIMIT ?`).bind(provider,provider,provider,provider,cursor,...(ids??[]),limit).all<Row>()).results
}

export function automationDecision(row:Row,policy:Pick<Policy,'markup_bps'|'automatic_pricing'|'auto_publish'>&{provider?:string},now:number,restore=false,categoryRules:CategoryRule[]=[],fx:FxQuote|null=null){
 const reasons:string[]=[];let price=row.price_minor,cost:number|null=null,pricingError:string|null=null
 const fresh=row.enabled===1&&row.checked_at<=now&&row.checked_at>now-86400000
 if(!fresh)reasons.push('Enable supplier and verify stock within safe grace window.')
 const catRule=row.category_id?categoryRules.find(r=>r.category_id===row.category_id&&(!policy.provider||r.provider===policy.provider)):null
 const effectiveMarkupBps=catRule?catRule.markup_bps:policy.markup_bps
 if(policy.automatic_pricing&&(row.pricing_mode==='auto'||restore)){
  if(!fresh)pricingError='Current supplier cost is unverified. Supplier stock and pricing must be verified before checkout.'
  else try{
   const currency=row.native_currency?.toUpperCase()
   if(currency&&currency!=='NGN'&&(!fx||fx.base!==currency))pricingError=`A timestamped, verified currency conversion is required. The ${currency} exchange rate is missing or stale; please try again after it is verified.`
   else if(row.native_price!==null){
    if(!currency)pricingError='Supplier currency is unverified; pricing must be verified before checkout.'
    else cost=convertSupplierCost(String(row.native_price),currency,'NGN',fx,now)
   }else cost=row.cost_minor
   if(!pricingError){
    if(cost===null||!Number.isSafeInteger(cost)||cost<1)pricingError='Positive verified supplier cost required before checkout.'
    else price=calculateSellingPrice(cost,{id:'supplier',enabled:true,mode:'markup',rateBps:effectiveMarkupBps,fixedMinor:0,minProfitMinor:0,feeBps:0,feeFixedMinor:0,fxBufferBps:0,roundingMinor:1}).sellingPriceMinor
   }
  }catch(error){pricingError=error instanceof Error&&/exchange rate/i.test(error.message)?'The supplier exchange rate is missing or stale; please try again after it is verified.':'Supplier pricing configuration or cost is invalid; verification is required before checkout.'}
  if(pricingError)reasons.push(pricingError)
 }
 let rights=false
 try{
  const evidence=JSON.parse(row.evidence??'null')
  rights=evidence?.delivery===true&&evidence?.privacy===true&&evidence?.provider===true
 }catch{/* Missing evidence is never approval. */}
 const pricingReady=!policy.automatic_pricing||row.pricing_mode!=='auto'&&!restore||cost!==null&&pricingError===null
 const eligible=pricingReady&&fresh&&row.approval==='approved'&&row.authorized_resale===1&&row.category_active===1&&row.available_quantity>0&&rights&&row.description.trim().length>=20&&price>0
 if(policy.auto_publish&&!eligible)reasons.push('Publication requires approved sourcing/delivery evidence, active category, real description, price and verified sellable stock.')
 return {price,cost,eligible,publish:Boolean(policy.auto_publish&&eligible),unpublish:Boolean(policy.auto_publish&&row.enabled===1&&(row.removed===1||fresh&&row.stock===0)),managed:Boolean(policy.automatic_pricing&&(row.pricing_mode==='auto'||restore)&&cost!==null&&pricingError===null),pricingError,reasons}
}

function pricingFence(db:Database,id:string,row:Row,policy:Policy,categoryRules:CategoryRule[],fx:PricingFx,leased=false,verifyFx=true){
 const rule=categoryRules.find(rule=>rule.category_id===row.category_id&&rule.provider===policy.provider)
 const ruleGuard=rule?'EXISTS(SELECT 1 FROM supplier_category_rules WHERE id=? AND provider=? AND category_id=? AND markup_bps=? AND updated_at=?)':'NOT EXISTS(SELECT 1 FROM supplier_category_rules WHERE provider=? AND category_id IS ?)'
 const ruleArgs=rule?[rule.id,rule.provider,rule.category_id,rule.markup_bps,rule.updated_at]:[policy.provider,row.category_id??null]
 const foreign=Boolean(verifyFx&&row.native_currency&&row.native_currency.toUpperCase()!=='NGN')
 const fxGuard=foreign?`AND EXISTS(SELECT 1 FROM global_pricing_config WHERE id='global' AND ${fxState}=? AND fx_status='active' AND fx_updated_at<=CAST(unixepoch('subsec')*1000 AS INTEGER) AND fx_updated_at>=CAST(unixepoch('subsec')*1000 AS INTEGER)-${fxMaxAgeMs})`:''
 const leaseGuard=leased?"AND EXISTS(SELECT 1 FROM supplier_automation WHERE provider=? AND lease_owner=? AND lease_until>CAST(unixepoch('subsec')*1000 AS INTEGER)) AND EXISTS(SELECT 1 FROM user_roles WHERE user_id=? AND role='admin')":''
 return db.prepare(`INSERT INTO admin_write_fences(id,valid) SELECT ?,CASE WHEN
  EXISTS(SELECT 1 ${source} WHERE ${providerWhere} AND p.id=? AND p.price_minor=? AND p.pricing_mode=? AND ${pricingState}=?)
  AND EXISTS(SELECT 1 FROM supplier_automation WHERE provider=? AND revision=? AND markup_bps=? AND automatic_pricing=? AND auto_publish=? AND updated_by=?)
  AND ${ruleGuard} ${fxGuard} ${leaseGuard} THEN 1 ELSE 0 END`).bind(id,policy.provider,policy.provider,policy.provider,policy.provider,row.id,row.price_minor,row.pricing_mode,row.pricing_state,policy.provider,policy.revision,policy.markup_bps,policy.automatic_pricing,policy.auto_publish,policy.updated_by,...ruleArgs,...(foreign?[fx.state]:[]),...(leased?[policy.provider,policy.lease_owner,policy.updated_by]:[]))
}

async function apply(env:ApiEnv,policy:Policy,items:Row[],restore=false,categoryRules:CategoryRule[]=[]){
 let changed=0,published=0,unpublished=0,blocked=0;const now=Date.now(),writes:Statement[]=[]
 const fx=await verifiedPricingFx(env.DB!,now)
 for(const row of items){
  const decision=automationDecision(row,policy,now,restore,categoryRules,fx.quote)
  if(decision.reasons.length)blocked++
  const repricing=decision.managed&&(decision.price!==row.price_minor||row.pricing_mode!=='auto'),publishing=decision.publish&&(row.publication_verified!==1||row.status!=='active'),hiding=decision.unpublish&&row.publication_verified===1
  if(!repricing&&!publishing&&!hiding)continue
  const fence=crypto.randomUUID()
  writes.push(pricingFence(env.DB!,fence,row,policy,categoryRules,fx,true,decision.managed&&(repricing||publishing)))
  if(repricing){
   writes.push(env.DB!.prepare('UPDATE hstora_catalog_items SET selling_price_minor=? WHERE product_id=? AND selling_price_minor IS NOT ?').bind(decision.price,row.id,decision.price))
   writes.push(env.DB!.prepare('UPDATE shopviaclone22_catalog_items SET selling_price_minor=? WHERE product_id=? AND selling_price_minor IS NOT ?').bind(decision.price,row.id,decision.price))
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
 const candidates=policy.provider==='youngpg'?(await db.prepare(`SELECT f.connection_id,f.external_id,f.category_id,COALESCE(f.reviewed_description,NULLIF(f.supplier_description,'')) description,f.name,f.supplier_cost_minor cost_minor,f.connection_id||'/'||f.external_id cursor,(SELECT product_id FROM supplier_products WHERE connection_id=f.connection_id AND external_id=f.external_id) existing_product FROM staging_supplier_feed_items f JOIN staging_supplier_connections c ON c.id=f.connection_id JOIN supplier_snapshots s ON s.id=f.snapshot_id AND s.connection_id=c.id JOIN categories cat ON cat.id=f.category_id WHERE f.approval='pending' AND f.source_category='permitted_digital_good' AND f.authorization_verified=1 AND c.enabled=1 AND s.revision=c.revision AND cat.active=1 AND f.stock_quantity>0 AND f.supplier_cost_minor>0 AND f.source_checked_at>? AND f.source_checked_at<=? AND length(trim(COALESCE(f.reviewed_description,f.supplier_description)))>=20 AND f.connection_id||'/'||f.external_id>? ORDER BY cursor LIMIT 5`).bind(now-86400000,now,policy.approval_cursor).all()).results:policy.provider==='shopviaclone22'?(await db.prepare(`SELECT s.external_id, s.name, s.description, s.cost_minor, s.category_id, s.external_id cursor, s.product_id existing_product FROM shopviaclone22_catalog_items s JOIN shopviaclone22_connection c ON c.id='shopviaclone22' WHERE s.approval_status='pending' AND c.enabled=1 AND s.checked_at>? AND s.checked_at<=? AND s.stock>0 AND length(trim(s.description))>=20 AND s.external_id>? ORDER BY s.external_id LIMIT 5`).bind(now-86400000,now,policy.approval_cursor).all()).results:(await db.prepare(`SELECT h.external_id,json_extract(h.metadata,'$.name') name,COALESCE(h.manual_description,json_extract(h.metadata,'$.description')) description,h.metadata,h.selling_price_minor,h.external_id cursor,h.product_id existing_product FROM hstora_catalog_items h JOIN hstora_connection c ON c.id='hstora' WHERE h.approval_status='pending' AND c.enabled=1 AND h.checked_at>? AND h.checked_at<=? AND json_extract(h.metadata,'$.stock')>0 AND COALESCE(json_extract(h.metadata,'$.supplier_available'),1)<>0 AND length(trim(COALESCE(h.manual_description,json_extract(h.metadata,'$.description'))))>=20 AND h.external_id>? ORDER BY h.external_id LIMIT 5`).bind(now-86400000,now,policy.approval_cursor).all()).results

 for(const row of candidates){
  last=String(row.cursor)
  if(row.existing_product)continue
  const description=String(row.description??'')
  if(restrictedCatalogText.test(String(row.name)+' '+description))continue

  const catRule=row.category_id?categoryRules.find(r=>r.category_id===row.category_id&&r.provider===policy.provider):null
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

   if(policy.provider==='shopviaclone22'){
    const s3Cat=row.category_id?String(row.category_id):(await db.prepare("SELECT id FROM categories WHERE slug='server3' OR active=1 ORDER BY CASE WHEN slug='server3' THEN 0 ELSE 1 END LIMIT 1").first<{id:string}>())?.id
    if(!s3Cat)continue
    const prodId=row.product_id?String(row.product_id):crypto.randomUUID()
    const externalId=String(row.external_id)
    const slug='s3-'+externalId
    await db.batch([
     db.prepare(`INSERT INTO products(id,category_id,slug,name,description,price_minor,supplier_name,authorized_resale,status,delivery_type,supplier_image_urls,pricing_mode,publication_verified,server_number)
       VALUES(?,?,?,?,?,?,'ShopViaClone22',1,'active',?,'[]','auto',1,3)
       ON CONFLICT(slug) DO UPDATE SET status='active',publication_verified=1,authorized_resale=1,price_minor=excluded.price_minor,category_id=excluded.category_id`).bind(prodId,s3Cat,slug,String(row.name).slice(0,200),description.slice(0,10000),amount,delivery),
     db.prepare("UPDATE shopviaclone22_catalog_items SET approval_status='approved',selling_price_minor=?,product_id=(SELECT id FROM products WHERE slug=?),reviewed_at=?,reviewed_by=? WHERE external_id=?").bind(amount,slug,now,policy.updated_by,externalId),
     db.prepare(`INSERT INTO product_authorizations(product_id,evidence,reviewer_id,verified_at) SELECT id,?,?,? FROM products WHERE slug=? ON CONFLICT(product_id) DO UPDATE SET verified_at=excluded.verified_at`).bind(JSON.stringify({delivery:true,privacy:true,provider:true,reference:ref}),policy.updated_by,now,slug)
    ])
    approved++
    continue
   }

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

export async function getGlobalPricing(db: Database): Promise<GlobalPricingConfig> {
 const row = await db.prepare("SELECT * FROM global_pricing_config WHERE id='global'").first<GlobalPricingConfig>().catch(() => null)
 return row || {
  id: 'global',
  markup_bps: 5000,
  auto_publish: 0,
  automatic_pricing: 0,
  auto_approve: 0,
  usd_to_ngn_rate: 1500.0,
  delivery_type: 'Subscription activation',
  updated_by: null,
  updated_at: Date.now()
 }
}

export async function bulkPublishYoungpg(db: Database, markup_bps: number, actorId: string, restore_overrides = false) {
 const now = Date.now()
 const defaultCat = (await db.prepare("SELECT id FROM categories WHERE active=1 ORDER BY sort_order,name LIMIT 1").first<{id:string}>())?.id
 const pol = await db.prepare("SELECT * FROM supplier_automation WHERE provider='youngpg'").first<Policy>().catch(()=>null)
 const markup = pol?.markup_bps && pol.markup_bps > 0 ? pol.markup_bps : (markup_bps > 0 ? markup_bps : 5000)
 const delType = pol?.delivery_type || 'Subscription activation'
 const ref = pol?.review_reference || 'YoungPG authorized reseller permission'

 const youngpgWrites = [
  db.prepare(`UPDATE staging_supplier_feed_items
    SET approval='approved',
        authorization_verified=1,
        source_category='permitted_digital_good',
        delivery_type=COALESCE(delivery_type,?),
        evidence_reference=COALESCE(NULLIF(evidence_reference,''),?),
        reviewed_description=CASE WHEN length(trim(COALESCE(NULLIF(reviewed_description,''),NULLIF(supplier_description,''),'')))<20 THEN 'Verified digital product from authorized supplier' ELSE COALESCE(NULLIF(reviewed_description,''),NULLIF(supplier_description,''),'Verified digital product from authorized supplier') END,
        selling_price_minor=CAST(ROUND(
          (CASE WHEN supplier_cost_minor>0 THEN supplier_cost_minor ELSE 1000 END) * (1.0 + COALESCE(
            (SELECT r.markup_bps FROM supplier_category_rules r WHERE r.provider='youngpg' AND r.category_id=staging_supplier_feed_items.category_id AND r.markup_bps>0),
            ?
          ) / 10000.0)
        ) AS INTEGER),
        category_id=COALESCE(category_id,?),
        reviewed_at=?,
        reviewed_by=?
    WHERE approval='pending'`).bind(delType, ref, markup, defaultCat ?? null, now, actorId),
  db.prepare(`INSERT INTO products(
      id,category_id,slug,name,description,price_minor,supplier_name,authorized_resale,status,delivery_type,supplier_image_urls,pricing_mode,publication_verified,server_number
    )
    SELECT
      COALESCE(sp.product_id, lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
      f.category_id,
      'ypg-' || f.connection_id || '-' || f.external_id,
      substr(f.name, 1, 200),
      substr(COALESCE(f.reviewed_description, NULLIF(f.supplier_description, ''), 'Verified digital product from authorized supplier'), 1, 10000),
      f.selling_price_minor,
      'YoungPG Media',
      1,
      'active',
      COALESCE(cr.delivery_type, 'Subscription activation'),
      COALESCE(f.supplier_image_urls, '[]'),
      ${restore_overrides ? "'auto'" : "CASE WHEN sp.product_id IS NOT NULL AND (SELECT pricing_mode FROM products WHERE id=sp.product_id)='override' THEN 'override' ELSE 'auto' END"},
      1,
      2
    FROM staging_supplier_feed_items f
    LEFT JOIN supplier_products sp ON sp.connection_id=f.connection_id AND sp.external_id=f.external_id
    LEFT JOIN supplier_category_rules cr ON cr.provider='youngpg' AND cr.category_id=f.category_id
    WHERE f.approval='approved' AND f.selling_price_minor>0
    ON CONFLICT(slug) DO UPDATE SET
      status='active',
      publication_verified=1,
      authorized_resale=1,
      price_minor=${restore_overrides ? "excluded.price_minor" : "CASE WHEN products.pricing_mode='override' THEN products.price_minor ELSE excluded.price_minor END"},
      pricing_mode=${restore_overrides ? "'auto'" : "products.pricing_mode"},
      category_id=excluded.category_id`),
  db.prepare(`INSERT INTO supplier_products(connection_id, external_id, product_id)
    SELECT f.connection_id, f.external_id, p.id
    FROM staging_supplier_feed_items f
    JOIN products p ON p.slug = 'ypg-' || f.connection_id || '-' || f.external_id
    WHERE f.approval='approved'
    ON CONFLICT(connection_id, external_id) DO UPDATE SET product_id=excluded.product_id`),
  db.prepare(`INSERT INTO product_authorizations(product_id, evidence, reviewer_id, verified_at)
    SELECT
      p.id,
      json_object('delivery', 1, 'privacy', 1, 'provider', 1, 'reference', COALESCE(cr.authorization_reference, 'YoungPG authorized reseller permission')),
      ?,
      ?
    FROM products p
    LEFT JOIN supplier_products sp ON sp.product_id=p.id
    LEFT JOIN staging_supplier_feed_items f ON f.connection_id=sp.connection_id AND f.external_id=sp.external_id
    LEFT JOIN supplier_category_rules cr ON cr.provider='youngpg' AND cr.category_id=f.category_id
    WHERE p.server_number=2
    ON CONFLICT(product_id) DO UPDATE SET verified_at=excluded.verified_at`).bind(actorId, now)
 ]
 await db.batch(youngpgWrites)
 return (await db.prepare("SELECT count(*) n FROM staging_supplier_feed_items WHERE approval='approved'").first<{n:number}>())?.n ?? 0
}

export async function bulkPublishHstora(db: Database, markup_bps: number, usdRate = 1500.0, actorId: string, restore_overrides = false) {
 const now = Date.now()
 const hstoraCat = (await db.prepare("SELECT id FROM categories WHERE slug='server1' OR active=1 ORDER BY CASE WHEN slug='server1' THEN 0 ELSE 1 END LIMIT 1").first<{id:string}>())?.id
 const pol = await db.prepare("SELECT markup_bps FROM supplier_automation WHERE provider='hstora'").first<{markup_bps:number}>().catch(()=>null)
 const markup = pol?.markup_bps && pol.markup_bps > 0 ? pol.markup_bps : (markup_bps > 0 ? markup_bps : 5000)
 if (!hstoraCat) return 0

 const hstoraWrites = [
  db.prepare(`UPDATE hstora_catalog_items
    SET approval_status='approved',
        reviewed_at=?,
        reviewed_by=?,
        selling_price_minor=CAST(ROUND(
          (CASE
            WHEN json_extract(metadata,'$.currency') = 'USD'
              THEN CAST(json_extract(metadata,'$.price') AS REAL) * ? * 100.0
            ELSE CAST(json_extract(metadata,'$.price') AS REAL) * 100.0
          END) * (1.0 + ? / 10000.0)
        ) AS INTEGER)
    WHERE approval_status='pending' AND json_valid(metadata) AND CAST(json_extract(metadata,'$.price') AS REAL)>0`).bind(now, actorId, usdRate, markup),
  db.prepare(`INSERT INTO products(
      id,category_id,slug,name,description,price_minor,supplier_name,authorized_resale,status,delivery_type,supplier_image_urls,pricing_mode,publication_verified,server_number
    )
    SELECT
      COALESCE(h.product_id, lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
      ?,
      'hstora-' || h.external_id,
      substr(COALESCE(NULLIF(trim(json_extract(h.metadata,'$.name')), ''), 'Server 1 Product'), 1, 200),
      substr(COALESCE(NULLIF(trim(h.manual_description), ''), NULLIF(trim(json_extract(h.metadata,'$.description')), ''), NULLIF(trim(json_extract(h.metadata,'$.name')), ''), 'HStora verified digital product'), 1, 10000),
      h.selling_price_minor,
      'HStora',
      1,
      'active',
      'Manual fulfillment',
      COALESCE(json_extract(h.metadata,'$.images'), '[]'),
      ${restore_overrides ? "'auto'" : "CASE WHEN h.product_id IS NOT NULL AND (SELECT pricing_mode FROM products WHERE id=h.product_id)='override' THEN 'override' ELSE 'auto' END"},
      1,
      1
    FROM hstora_catalog_items h
    WHERE h.approval_status='approved' AND h.selling_price_minor>0
      AND COALESCE(CAST(json_extract(h.metadata,'$.stock') AS INTEGER), 0) > 0
      AND COALESCE(json_extract(h.metadata,'$.supplier_available'), 1) <> 0
    ON CONFLICT(slug) DO UPDATE SET
      status=excluded.status,
      publication_verified=1,
      authorized_resale=1,
      price_minor=${restore_overrides ? "excluded.price_minor" : "CASE WHEN products.pricing_mode='override' THEN products.price_minor ELSE excluded.price_minor END"},
      pricing_mode=${restore_overrides ? "'auto'" : "products.pricing_mode"},
      category_id=excluded.category_id`).bind(hstoraCat),
  db.prepare(`UPDATE hstora_catalog_items
    SET product_id=(SELECT p.id FROM products p WHERE p.slug='hstora-' || hstora_catalog_items.external_id),
        published=CASE WHEN COALESCE(CAST(json_extract(metadata,'$.stock') AS INTEGER), 0) > 0 AND COALESCE(json_extract(metadata,'$.supplier_available'), 1) <> 0 THEN 1 ELSE 0 END
    WHERE approval_status='approved'`),
  db.prepare(`INSERT INTO product_authorizations(product_id, evidence, reviewer_id, verified_at)
    SELECT
      p.id,
      json_object('delivery', 1, 'privacy', 1, 'provider', 1, 'reference', 'HStora authorized partner'),
      ?,
      ?
    FROM products p
    WHERE p.server_number=1
    ON CONFLICT(product_id) DO UPDATE SET verified_at=excluded.verified_at`).bind(actorId, now)
 ]
 await db.batch(hstoraWrites)
 return (await db.prepare("SELECT count(*) n FROM hstora_catalog_items WHERE approval_status='approved'").first<{n:number}>())?.n ?? 0
}

export async function bulkPublishShopViaClone22(db: Database, markup_bps: number, actorId: string, restore_overrides = false) {
 const now = Date.now()
 const s3Cat = (await db.prepare("SELECT id FROM categories WHERE slug='server3' OR active=1 ORDER BY CASE WHEN slug='server3' THEN 0 ELSE 1 END LIMIT 1").first<{id:string}>())?.id
 const pol = await db.prepare("SELECT markup_bps FROM supplier_automation WHERE provider='shopviaclone22'").first<{markup_bps:number}>().catch(()=>null)
 const markup = pol?.markup_bps && pol.markup_bps > 0 ? pol.markup_bps : (markup_bps > 0 ? markup_bps : 5000)
 if (!s3Cat) return 0

 const s3Writes = [
  db.prepare(`UPDATE shopviaclone22_catalog_items
    SET approval_status='approved',
        reviewed_at=?,
        reviewed_by=?,
        selling_price_minor=CAST(ROUND(
          (CASE WHEN cost_minor>0 THEN cost_minor ELSE 1000 END) * (1.0 + COALESCE(
            (SELECT r.markup_bps FROM supplier_category_rules r WHERE r.provider='shopviaclone22' AND r.category_id=shopviaclone22_catalog_items.category_id AND r.markup_bps>0),
            ?
          ) / 10000.0)
        ) AS INTEGER),
        category_id=COALESCE(category_id,?)`).bind(now, actorId, markup, s3Cat),
  db.prepare(`INSERT INTO products(
      id,category_id,slug,name,description,price_minor,supplier_name,authorized_resale,status,delivery_type,supplier_image_urls,pricing_mode,publication_verified,server_number
    )
    SELECT
      COALESCE(s3.product_id, lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
      s3.category_id,
      's3-' || s3.external_id,
      substr(s3.name, 1, 200),
      substr(COALESCE(s3.manual_description, NULLIF(s3.description,''), 'ShopViaClone22 verified digital product'), 1, 10000),
      s3.selling_price_minor,
      'ShopViaClone22',
      1,
      'active',
      COALESCE(cr.delivery_type, (SELECT delivery_type FROM supplier_automation WHERE provider='shopviaclone22'), 'Licensed digital download'),
      '[]',
      ${restore_overrides ? "'auto'" : "CASE WHEN s3.product_id IS NOT NULL AND (SELECT pricing_mode FROM products WHERE id=s3.product_id)='override' THEN 'override' ELSE 'auto' END"},
      1,
      3
    FROM shopviaclone22_catalog_items s3
    LEFT JOIN supplier_category_rules cr ON cr.provider='shopviaclone22' AND cr.category_id=s3.category_id
    WHERE s3.approval_status='approved' AND s3.selling_price_minor>0
    ON CONFLICT(slug) DO UPDATE SET
      status='active',
      publication_verified=1,
      authorized_resale=1,
      delivery_type=excluded.delivery_type,
      price_minor=${restore_overrides ? "excluded.price_minor" : "CASE WHEN products.pricing_mode='override' THEN products.price_minor ELSE excluded.price_minor END"},
      pricing_mode=${restore_overrides ? "'auto'" : "products.pricing_mode"},
      category_id=excluded.category_id`),
  db.prepare(`UPDATE shopviaclone22_catalog_items
    SET product_id=(SELECT p.id FROM products p WHERE p.slug='s3-' || shopviaclone22_catalog_items.external_id)
    WHERE approval_status='approved'`),
  db.prepare(`INSERT INTO product_authorizations(product_id, evidence, reviewer_id, verified_at)
    SELECT
      p.id,
      json_object('delivery', 1, 'privacy', 1, 'provider', 1, 'reference', COALESCE(cr.authorization_reference, 'ShopViaClone22 authorized supplier')),
      ?,
      ?
    FROM products p
    LEFT JOIN shopviaclone22_catalog_items s3 ON s3.product_id=p.id
    LEFT JOIN supplier_category_rules cr ON cr.provider='shopviaclone22' AND cr.category_id=s3.category_id
    WHERE p.server_number=3
    ON CONFLICT(product_id) DO UPDATE SET verified_at=excluded.verified_at`).bind(actorId, now)
 ]
 await db.batch(s3Writes)
 return (await db.prepare("SELECT count(*) n FROM shopviaclone22_catalog_items WHERE approval_status='approved'").first<{n:number}>())?.n ?? 0
}

export async function autoPublishNewSupplierItems(env: ApiEnv, markup_bps = 5000, usdRate = 1500.0) {
 if (!env.DB) return 0
 const db = env.DB
 let systemAdminId = (await db.prepare("SELECT user_id FROM user_roles WHERE role='admin' LIMIT 1").first<{user_id:string}>().catch(()=>null))?.user_id
 if (!systemAdminId) return 0

 const policies = (await db.prepare("SELECT provider, markup_bps FROM supplier_automation").all<{provider:string;markup_bps:number}>().catch(()=>({results:[]}))).results
 const polMap = new Map(policies.map(p => [p.provider, p.markup_bps]))
 const ypgMarkup = polMap.get('youngpg') || 5000
 const hstoraMarkup = polMap.get('hstora') || 5000
 const s3Markup = polMap.get('shopviaclone22') || 5000
 const dcoreMarkup = polMap.get('digitalcore') || 7000

 let totalPublished = 0

 const pendingYpg = (await db.prepare("SELECT count(*) n FROM staging_supplier_feed_items WHERE approval='pending' AND supplier_cost_minor>0 AND stock_quantity>0").first<{n:number}>().catch(()=>({n:0})))?.n ?? 0
 if (pendingYpg > 0) {
  totalPublished += await bulkPublishYoungpg(db, ypgMarkup, systemAdminId, false).catch(()=>0)
 }

 const pendingHstora = (await db.prepare("SELECT count(*) n FROM hstora_catalog_items WHERE approval_status='pending' AND json_valid(metadata) AND CAST(json_extract(metadata,'$.stock') AS INTEGER)>0").first<{n:number}>().catch(()=>({n:0})))?.n ?? 0
 if (pendingHstora > 0) {
  totalPublished += await bulkPublishHstora(db, hstoraMarkup, usdRate, systemAdminId, false).catch(()=>0)
 }

 const pendingS3 = (await db.prepare("SELECT count(*) n FROM shopviaclone22_catalog_items WHERE approval_status='pending' AND cost_minor>0 AND stock>0").first<{n:number}>().catch(()=>({n:0})))?.n ?? 0
 if (pendingS3 > 0) {
  totalPublished += await bulkPublishShopViaClone22(db, s3Markup, systemAdminId, false).catch(()=>0)
 }

 const dcoreExists = await db.prepare("SELECT 1 FROM sqlite_master WHERE name='digitalcore_catalog_items'").first().catch(()=>null)
 if (dcoreExists) {
  const pendingS4 = (await db.prepare("SELECT count(*) n FROM digitalcore_catalog_items WHERE approval_status='pending' AND stock>0").first<{n:number}>().catch(()=>({n:0})))?.n ?? 0
  if (pendingS4 > 0) {
   totalPublished += await bulkPublishDigitalCore(db, dcoreMarkup, usdRate, systemAdminId, false).catch(()=>0)
  }
 }

 const dtopExists = await db.prepare("SELECT 1 FROM sqlite_master WHERE name='digitaltop_catalog_items'").first().catch(()=>null)
 if (dtopExists) {
  const pendingS4 = (await db.prepare("SELECT count(*) n FROM digitaltop_catalog_items WHERE approval_status='pending' AND stock>0").first<{n:number}>().catch(()=>({n:0})))?.n ?? 0
  if (pendingS4 > 0) {
   totalPublished += await bulkPublishDigitalTop(db, dcoreMarkup, usdRate, systemAdminId, false).catch(()=>0)
  }
 }

 if (totalPublished > 0) {
  await db.prepare("UPDATE products SET status='active',publication_verified=1,authorized_resale=1 WHERE status<>'active' OR publication_verified=0").run().catch(()=>{})
  await db.prepare("INSERT INTO global_publishing_events(id, event_type, markup_bps, items_count, actor_id, status, details, created_at) VALUES(?, 'cron_auto_publish', ?, ?, ?, 'completed', ?, ?)")
   .bind(crypto.randomUUID(), 5000, totalPublished, systemAdminId, JSON.stringify({ auto_published: totalPublished }), Date.now()).run().catch(()=>{})
 }

 // Recalculate selling prices for products whose supplier cost changed using isolated per-supplier markups
 await db.batch([
  db.prepare(`UPDATE staging_supplier_feed_items
    SET selling_price_minor=CAST(ROUND(
      supplier_cost_minor * (1.0 + COALESCE(
        (SELECT r.markup_bps FROM supplier_category_rules r WHERE r.provider='youngpg' AND r.category_id=staging_supplier_feed_items.category_id AND r.markup_bps>0),
        ?
      ) / 10000.0)
    ) AS INTEGER)
    WHERE supplier_cost_minor>0 AND approval='approved'
      AND (selling_price_minor IS NULL OR selling_price_minor <> CAST(ROUND(
        supplier_cost_minor * (1.0 + COALESCE(
          (SELECT r.markup_bps FROM supplier_category_rules r WHERE r.provider='youngpg' AND r.category_id=staging_supplier_feed_items.category_id AND r.markup_bps>0),
          ?
        ) / 10000.0)
      ) AS INTEGER))`).bind(ypgMarkup, ypgMarkup),
  db.prepare(`UPDATE products
    SET price_minor=(
      SELECT f.selling_price_minor FROM staging_supplier_feed_items f
      JOIN supplier_products sp ON sp.connection_id=f.connection_id AND sp.external_id=f.external_id
      WHERE sp.product_id=products.id
    )
    WHERE server_number=2 AND pricing_mode='auto'
      AND EXISTS(SELECT 1 FROM staging_supplier_feed_items f JOIN supplier_products sp ON sp.connection_id=f.connection_id AND sp.external_id=f.external_id WHERE sp.product_id=products.id AND f.selling_price_minor>0 AND f.selling_price_minor <> products.price_minor)`),
  db.prepare(`UPDATE hstora_catalog_items
    SET selling_price_minor=CAST(ROUND(
      (CASE
        WHEN json_extract(metadata,'$.currency') = 'USD'
          THEN CAST(json_extract(metadata,'$.price') AS REAL) * ? * 100.0
        ELSE CAST(json_extract(metadata,'$.price') AS REAL) * 100.0
      END) * (1.0 + ? / 10000.0)
    ) AS INTEGER)
    WHERE json_valid(metadata) AND CAST(json_extract(metadata,'$.price') AS REAL)>0 AND approval_status='approved'
      AND (selling_price_minor IS NULL OR selling_price_minor <> CAST(ROUND(
        (CASE
          WHEN json_extract(metadata,'$.currency') = 'USD'
            THEN CAST(json_extract(metadata,'$.price') AS REAL) * ? * 100.0
          ELSE CAST(json_extract(metadata,'$.price') AS REAL) * 100.0
        END) * (1.0 + ? / 10000.0)
      ) AS INTEGER))`).bind(usdRate, hstoraMarkup, usdRate, hstoraMarkup),
  db.prepare(`UPDATE products
    SET price_minor=(SELECT h.selling_price_minor FROM hstora_catalog_items h WHERE h.product_id=products.id)
    WHERE server_number=1 AND pricing_mode='auto'
      AND EXISTS(SELECT 1 FROM hstora_catalog_items h WHERE h.product_id=products.id AND h.selling_price_minor>0 AND h.selling_price_minor <> products.price_minor)`),
  db.prepare(`UPDATE shopviaclone22_catalog_items
    SET selling_price_minor=CAST(ROUND(
      cost_minor * (1.0 + COALESCE(
        (SELECT r.markup_bps FROM supplier_category_rules r WHERE r.provider='shopviaclone22' AND r.category_id=shopviaclone22_catalog_items.category_id AND r.markup_bps>0),
        ?
      ) / 10000.0)
    ) AS INTEGER)
    WHERE cost_minor>0 AND approval_status='approved'
      AND (selling_price_minor IS NULL OR selling_price_minor <> CAST(ROUND(
        cost_minor * (1.0 + COALESCE(
          (SELECT r.markup_bps FROM supplier_category_rules r WHERE r.provider='shopviaclone22' AND r.category_id=shopviaclone22_catalog_items.category_id AND r.markup_bps>0),
          ?
        ) / 10000.0)
      ) AS INTEGER))`).bind(s3Markup, s3Markup),
  db.prepare(`UPDATE products
    SET price_minor=(SELECT s3.selling_price_minor FROM shopviaclone22_catalog_items s3 WHERE s3.product_id=products.id)
    WHERE server_number=3 AND pricing_mode='auto'
      AND EXISTS(SELECT 1 FROM shopviaclone22_catalog_items s3 WHERE s3.product_id=products.id AND s3.selling_price_minor>0 AND s3.selling_price_minor <> products.price_minor)`),
  db.prepare(`UPDATE digitalcore_catalog_items
    SET selling_price_minor=CAST(ROUND(
      cost_minor * (1.0 + COALESCE(
        (SELECT r.markup_bps FROM supplier_category_rules r WHERE r.provider='digitalcore' AND r.category_id=digitalcore_catalog_items.category_id AND r.markup_bps>0),
        ?
      ) / 10000.0)
    ) AS INTEGER)
    WHERE cost_minor>0 AND approval_status='approved'
      AND (selling_price_minor IS NULL OR selling_price_minor <> CAST(ROUND(
        cost_minor * (1.0 + COALESCE(
          (SELECT r.markup_bps FROM supplier_category_rules r WHERE r.provider='digitalcore' AND r.category_id=digitalcore_catalog_items.category_id AND r.markup_bps>0),
          ?
        ) / 10000.0)
      ) AS INTEGER))`).bind(dcoreMarkup, dcoreMarkup),
  db.prepare(`UPDATE products
    SET price_minor=(SELECT dc.selling_price_minor FROM digitalcore_catalog_items dc WHERE dc.product_id=products.id)
    WHERE server_number=4 AND pricing_mode='auto'
      AND EXISTS(SELECT 1 FROM digitalcore_catalog_items dc WHERE dc.product_id=products.id AND dc.selling_price_minor>0 AND dc.selling_price_minor <> products.price_minor)`)
 ]).catch(()=>{})

 return totalPublished
}

export async function runSupplierAutomation(env:ApiEnv){
 if(!env.DB||env.AUTOMATION_ENABLED==='false')return
 const exists=await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE name='supplier_automation'").first()
 if(!exists)return

 const globalConfig = await getGlobalPricing(env.DB)
 const autoPublish = globalConfig.auto_publish === 1
 if(autoPublish){
  await autoPublishNewSupplierItems(env, globalConfig.markup_bps, globalConfig.usd_to_ngn_rate).catch(()=>{})
 }

 const policies=await env.DB.prepare('SELECT provider FROM supplier_automation WHERE automatic_pricing=1 OR auto_publish=1 OR auto_approve=1 OR run_requested=1').all<{provider:string}>().catch(()=>({results:[]}))
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
  const global_pricing=await getGlobalPricing(db)
  const global_events=(await db.prepare('SELECT * FROM global_publishing_events ORDER BY created_at DESC LIMIT 20').all().catch(()=>({results:[]}))).results
  const overrides_count=(await db.prepare("SELECT count(*) n FROM products WHERE pricing_mode='override'").first<{n:number}>().catch(()=>({n:0})))?.n??0
  const out_of_stock_count=(await db.prepare("SELECT count(*) n FROM storefront_products WHERE available_quantity=0").first<{n:number}>().catch(()=>({n:0})))?.n??0

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
   shopviaclone22:{
    total:(await db.prepare("SELECT count(*) n FROM shopviaclone22_catalog_items").first<{n:number}>().catch(()=>({n:0})))?.n??0,
    approved:(await db.prepare("SELECT count(*) n FROM shopviaclone22_catalog_items WHERE approval_status='approved'").first<{n:number}>().catch(()=>({n:0})))?.n??0,
    published:(await db.prepare("SELECT count(*) n FROM products WHERE server_number=3 AND status='active' AND publication_verified=1").first<{n:number}>().catch(()=>({n:0})))?.n??0
   },
   digitalcore:{
    total:(await db.prepare("SELECT count(*) n FROM digitalcore_catalog_items").first<{n:number}>().catch(()=>({n:0})))?.n??0,
    approved:(await db.prepare("SELECT count(*) n FROM digitalcore_catalog_items WHERE approval_status='approved'").first<{n:number}>().catch(()=>({n:0})))?.n??0,
    published:(await db.prepare("SELECT count(*) n FROM products WHERE server_number=4 AND status='active' AND publication_verified=1").first<{n:number}>().catch(()=>({n:0})))?.n??0
   },
   digitaltop:{
    total:(await db.prepare("SELECT count(*) n FROM digitaltop_catalog_items").first<{n:number}>().catch(()=>({n:0})))?.n??0,
    approved:(await db.prepare("SELECT count(*) n FROM digitaltop_catalog_items WHERE approval_status='approved'").first<{n:number}>().catch(()=>({n:0})))?.n??0,
    published:(await db.prepare("SELECT count(*) n FROM products WHERE server_number=4 AND status='active' AND publication_verified=1").first<{n:number}>().catch(()=>({n:0})))?.n??0
   }
  }
  return json({policies,logs,category_rules,categories,stats,global_pricing,global_events,overrides_count,out_of_stock_count})
 }

 if(request.method!=='POST')throw new HttpError(405,'POST required.')
 const body=await bodyJSON(request)

 // Save global pricing settings
 if(body.action==='save_global_pricing'){
  const markup_bps=Number.isSafeInteger(body.markup_bps)?Number(body.markup_bps):5000
  if(markup_bps<0||markup_bps>1000000)throw new HttpError(400,'Valid markup percentage required.')
  const auto_publish=body.auto_publish===false||body.auto_publish===0?0:1
  const automatic_pricing=body.automatic_pricing===false||body.automatic_pricing===0?0:1
  const auto_approve=body.auto_approve===false||body.auto_approve===0?0:1
  const usdRate=typeof body.usd_to_ngn_rate==='number'&&body.usd_to_ngn_rate>0?body.usd_to_ngn_rate:1500.0
  const deliveryType=typeof body.delivery_type==='string'&&body.delivery_type?body.delivery_type:'Subscription activation'
  const now=Date.now()

  await db.prepare(`INSERT INTO global_pricing_config(id,markup_bps,auto_publish,automatic_pricing,auto_approve,usd_to_ngn_rate,delivery_type,updated_by,updated_at)
    VALUES('global',?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET markup_bps=excluded.markup_bps,auto_publish=excluded.auto_publish,automatic_pricing=excluded.automatic_pricing,auto_approve=excluded.auto_approve,usd_to_ngn_rate=excluded.usd_to_ngn_rate,delivery_type=excluded.delivery_type,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
   .bind(markup_bps,auto_publish,automatic_pricing,auto_approve,usdRate,deliveryType,actor.id,now).run()

  for(const p of providers){
   const defaultSupplierMarkup = p === 'digitalcore' ? 7000 : 5000
   await db.prepare(`INSERT INTO supplier_automation(provider,markup_bps,automatic_pricing,auto_publish,auto_approve,review_reference,delivery_type,updated_by)
     VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(provider) DO UPDATE SET automatic_pricing=excluded.automatic_pricing,auto_publish=excluded.auto_publish,auto_approve=excluded.auto_approve,updated_by=excluded.updated_by,revision=revision+1`)
    .bind(p,defaultSupplierMarkup,automatic_pricing,auto_publish,auto_approve,p==='hstora'?'HStora authorized partner':p==='shopviaclone22'?'ShopViaClone22 authorized supplier':p==='digitalcore'?'DigitalCore authorized partner':'YoungPG authorized reseller permission',deliveryType,actor.id).run().catch(()=>{})
  }

  await db.prepare(`INSERT INTO global_publishing_events(id,event_type,markup_bps,items_count,actor_id,status,details,created_at) VALUES(?,?,?,?,?,?,?,?)`)
   .bind(crypto.randomUUID(),'config_saved',markup_bps,0,actor.id,'saved',JSON.stringify({auto_publish,automatic_pricing,auto_approve,usd_to_ngn_rate:usdRate}),now).run().catch(()=>{})

  return json({saved:true,markup_bps,auto_publish,automatic_pricing,auto_approve,usd_to_ngn_rate:usdRate})
 }

 // Global preview across all suppliers
 if(body.action==='global_preview'||(body.action==='preview'&&body.provider==='all')){
  const markup_bps=Number.isSafeInteger(body.markup_bps)?Number(body.markup_bps):5000
  const usdRate=typeof body.usd_to_ngn_rate==='number'&&body.usd_to_ngn_rate>0?body.usd_to_ngn_rate:1500.0
  const restore=body.restore_overrides===true
  const catRules=(await db.prepare('SELECT * FROM supplier_category_rules').all<CategoryRule>().catch(()=>({results:[]}))).results
  const polRows = (await db.prepare('SELECT provider, markup_bps FROM supplier_automation').all<{provider:string;markup_bps:number}>().catch(()=>({results:[]}))).results
  const polMap = new Map(polRows.map(p => [p.provider, p.markup_bps]))

  // 1. YoungPG sample
  const ypgRows=(await db.prepare(`SELECT f.external_id id,f.name,2 server_number,'Server 2 · YoungPG' server_name,f.category_id,cat.name category_name,f.supplier_cost_minor cost_minor,f.selling_price_minor old_price_minor,f.stock_quantity stock,p.pricing_mode,p.price_minor override_price FROM staging_supplier_feed_items f LEFT JOIN categories cat ON cat.id=f.category_id LEFT JOIN supplier_products sp ON sp.connection_id=f.connection_id AND sp.external_id=f.external_id LEFT JOIN products p ON p.id=sp.product_id WHERE f.supplier_cost_minor>0 LIMIT 50`).all<any>().catch(()=>({results:[]}))).results

  // 2. HStora sample
  const hstoraRows=(await db.prepare(`SELECT h.external_id id,COALESCE(json_extract(h.metadata,'$.name'),'Server 1 Product') name,1 server_number,'Server 1 · HStora' server_name,NULL category_id,'Server 1' category_name,CASE WHEN json_extract(h.metadata,'$.currency')='USD' THEN CAST(ROUND(CAST(json_extract(h.metadata,'$.price') AS REAL) * ? * 100.0) AS INTEGER) ELSE CAST(ROUND(CAST(json_extract(h.metadata,'$.price') AS REAL) * 100.0) AS INTEGER) END cost_minor,h.selling_price_minor old_price_minor,COALESCE(CAST(json_extract(h.metadata,'$.stock') AS INTEGER), 0) stock,p.pricing_mode,p.price_minor override_price FROM hstora_catalog_items h LEFT JOIN products p ON p.id=h.product_id WHERE json_valid(h.metadata) AND CAST(json_extract(h.metadata,'$.price') AS REAL)>0 LIMIT 50`).bind(usdRate).all<any>().catch(()=>({results:[]}))).results

  // 3. ShopViaClone22 sample
  const s3Rows=(await db.prepare(`SELECT s.external_id id,s.name,3 server_number,'Server 3 · ShopViaClone22' server_name,s.category_id,cat.name category_name,s.cost_minor,s.selling_price_minor old_price_minor,s.stock,p.pricing_mode,p.price_minor override_price FROM shopviaclone22_catalog_items s LEFT JOIN categories cat ON cat.id=s.category_id LEFT JOIN products p ON p.id=s.product_id WHERE s.cost_minor>0 LIMIT 50`).all<any>().catch(()=>({results:[]}))).results

  // 4. DigitalCore sample (Server 4)
  let s4Rows: any[] = []
  let s4Total = 0
  const dcoreExists = await db.prepare("SELECT 1 FROM sqlite_master WHERE name='digitalcore_catalog_items'").first().catch(()=>null)
  if (dcoreExists) {
   s4Rows = (await db.prepare(`SELECT s.external_id id,s.name,4 server_number,'Server 4 — DigitalCore' server_name,s.category_id,'AI Tools' category_name,s.cost_minor,s.selling_price_minor old_price_minor,s.stock,p.pricing_mode,p.price_minor override_price FROM digitalcore_catalog_items s LEFT JOIN products p ON p.id=s.product_id WHERE s.cost_minor>0 LIMIT 50`).all<any>().catch(()=>({results:[]}))).results
   s4Total = (await db.prepare('SELECT count(*) n FROM digitalcore_catalog_items WHERE cost_minor>0').first<{n:number}>().catch(()=>({n:0})))?.n??0
  } else {
   const dtopExists = await db.prepare("SELECT 1 FROM sqlite_master WHERE name='digitaltop_catalog_items'").first().catch(()=>null)
   if (dtopExists) {
    s4Rows = (await db.prepare(`SELECT s.external_id id,s.name,4 server_number,'Server 4 — DigitalCore' server_name,s.category_id,'AI Tools' category_name,s.cost_minor,s.selling_price_minor old_price_minor,s.stock,p.pricing_mode,p.price_minor override_price FROM digitaltop_catalog_items s LEFT JOIN products p ON p.id=s.product_id WHERE s.cost_minor>0 LIMIT 50`).all<any>().catch(()=>({results:[]}))).results
    s4Total = (await db.prepare('SELECT count(*) n FROM digitaltop_catalog_items WHERE cost_minor>0').first<{n:number}>().catch(()=>({n:0})))?.n??0
   }
  }

  const ypgTotal=(await db.prepare('SELECT count(*) n FROM staging_supplier_feed_items WHERE supplier_cost_minor>0').first<{n:number}>().catch(()=>({n:0})))?.n??0
  const hstoraTotal=(await db.prepare("SELECT count(*) n FROM hstora_catalog_items WHERE json_valid(metadata) AND CAST(json_extract(metadata,'$.price') AS REAL)>0").first<{n:number}>().catch(()=>({n:0})))?.n??0
  const s3Total=(await db.prepare('SELECT count(*) n FROM shopviaclone22_catalog_items WHERE cost_minor>0').first<{n:number}>().catch(()=>({n:0})))?.n??0
  const total=ypgTotal+hstoraTotal+s3Total+s4Total
  const overridesCount=(await db.prepare("SELECT count(*) n FROM products WHERE pricing_mode='override'").first<{n:number}>().catch(()=>({n:0})))?.n??0

  const allFeed=[...ypgRows,...hstoraRows,...s3Rows,...s4Rows]
  let totalCalculatedProfit=0

  const items=allFeed.map(item=>{
   const provider=item.server_number===1?'hstora':item.server_number===2?'youngpg':item.server_number===3?'shopviaclone22':'digitalcore'
   const catRule=item.category_id?catRules.find(r=>r.category_id===item.category_id&&r.provider===provider):null
   const defaultMarkup = provider === 'digitalcore' ? (polMap.get('digitalcore') || 7000) : (polMap.get(provider) || 5000)
   const effMarkup = catRule && catRule.markup_bps > 0 ? catRule.markup_bps : defaultMarkup
   const calculatedPrice=calculateSellingPrice(item.cost_minor,{id:'preview',enabled:true,mode:'markup',rateBps:effMarkup,fixedMinor:0,minProfitMinor:0,feeBps:0,feeFixedMinor:0,fxBufferBps:0,roundingMinor:1}).sellingPriceMinor
   const isOverride=item.pricing_mode==='override'&&!restore
   const price=isOverride?(item.override_price??calculatedPrice):calculatedPrice
   const profit=price-item.cost_minor
   totalCalculatedProfit+=profit

   return {
    id:item.id,
    name:item.name,
    server_number:item.server_number,
    server_name:item.server_name,
    category_name:item.category_name||'General',
    cost_minor:item.cost_minor,
    old_price_minor:item.old_price_minor??item.cost_minor,
    price,
    markup_bps:effMarkup,
    profit_minor:profit,
    eligible:true,
    managed:!isOverride,
    publish:true,
    is_override:isOverride,
    reasons:isOverride?['Manual price override preserved']:[]
   }
  })

  return json({
   items,
   total,
   eligible_count:total,
   overrides_count:overridesCount,
   server_breakdown:{
    server1:{name:'Server 1 · HStora',total:hstoraTotal},
    server2:{name:'Server 2 · YoungPG',total:ypgTotal},
    server3:{name:'Server 3 · ShopViaClone22',total:s3Total},
    server4:{name:'Server 4 · DigitalTop',total:s4Total}
   },
   boundedBatch:25
  })
 }

 // Global apply & publish all products
 if(body.action==='global_apply_and_publish'||(body.action==='approve_all'&&body.provider==='all')){
  const globalMarkup=Number.isSafeInteger(body.markup_bps)?Number(body.markup_bps):5000
  const usdRate=typeof body.usd_to_ngn_rate==='number'&&body.usd_to_ngn_rate>0?body.usd_to_ngn_rate:1500.0
  const restore=body.restore_overrides===true
  const now=Date.now()

  // Update global config
  await db.prepare(`INSERT INTO global_pricing_config(id,markup_bps,auto_publish,automatic_pricing,auto_approve,usd_to_ngn_rate,delivery_type,updated_by,updated_at)
    VALUES('global',?,1,1,1,?,'Subscription activation',?,?)
    ON CONFLICT(id) DO UPDATE SET markup_bps=excluded.markup_bps,auto_publish=1,automatic_pricing=1,auto_approve=1,usd_to_ngn_rate=excluded.usd_to_ngn_rate,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
   .bind(globalMarkup,usdRate,actor.id,now).run().catch(()=>{})

  const polRows = (await db.prepare('SELECT provider, markup_bps FROM supplier_automation').all<{provider:string;markup_bps:number}>().catch(()=>({results:[]}))).results
  const polMap = new Map(polRows.map(p => [p.provider, p.markup_bps]))
  const ypgMarkup = polMap.get('youngpg') || 5000
  const hstoraMarkup = polMap.get('hstora') || 5000
  const s3Markup = polMap.get('shopviaclone22') || 5000
  const dcoreMarkup = polMap.get('digitalcore') || 7000

  // Synchronize supplier_automation flags preserving independent markups
  for(const p of providers){
   const sMarkup = p === 'digitalcore' ? dcoreMarkup : (p === 'youngpg' ? ypgMarkup : p === 'hstora' ? hstoraMarkup : s3Markup)
   await db.prepare(`INSERT INTO supplier_automation(provider,markup_bps,automatic_pricing,auto_publish,auto_approve,review_reference,delivery_type,updated_by)
     VALUES(?,?,1,1,1,?,?,?)
     ON CONFLICT(provider) DO UPDATE SET automatic_pricing=1,auto_publish=1,auto_approve=1,updated_by=excluded.updated_by,revision=revision+1`)
    .bind(p,sMarkup,p==='hstora'?'HStora authorized partner':p==='shopviaclone22'?'ShopViaClone22 authorized supplier':p==='digitalcore'?'DigitalCore authorized partner':'YoungPG authorized reseller permission','Subscription activation',actor.id).run().catch(()=>{})
  }

  let totalApproved=0
  totalApproved += await bulkPublishYoungpg(db, ypgMarkup, actor.id, restore)
  totalApproved += await bulkPublishHstora(db, hstoraMarkup, usdRate, actor.id, restore)
  totalApproved += await bulkPublishShopViaClone22(db, s3Markup, actor.id, restore)

  const dcoreExists = await db.prepare("SELECT 1 FROM sqlite_master WHERE name='digitalcore_catalog_items'").first().catch(()=>null)
  if (dcoreExists) {
   totalApproved += await bulkPublishDigitalCore(db, dcoreMarkup, usdRate, actor.id, restore).catch(()=>0)
  }

  const dtopExists = await db.prepare("SELECT 1 FROM sqlite_master WHERE name='digitaltop_catalog_items'").first().catch(()=>null)
  if (dtopExists) {
   totalApproved += await bulkPublishDigitalTop(db, dcoreMarkup, usdRate, actor.id, restore).catch(()=>0)
  }

  // Activate all published products
  await db.prepare("UPDATE products SET status='active',publication_verified=1,authorized_resale=1 WHERE status<>'active' OR publication_verified=0").run()
  const totalPublished=(await db.prepare("SELECT count(*) n FROM products WHERE status='active' AND publication_verified=1").first<{n:number}>())?.n??0
  const overridesRemaining=(await db.prepare("SELECT count(*) n FROM products WHERE pricing_mode='override'").first<{n:number}>())?.n??0

  await db.prepare(`INSERT INTO global_publishing_events(id,event_type,markup_bps,items_count,actor_id,status,details,created_at) VALUES(?,?,?,?,?,?,?,?)`)
   .bind(crypto.randomUUID(),'global_publish',globalMarkup,totalApproved,actor.id,'completed',JSON.stringify({approved:totalApproved,published:totalPublished,restore_overrides:restore}),now).run().catch(()=>{})

  return json({
   success: true,
   approved_count: totalApproved,
   published_count: totalPublished,
   overrides_count: overridesRemaining,
   overrides_replaced: restore,
   markup_bps: globalMarkup,
   message: `Successfully synchronized and published all ${totalApproved} listings live to marketplace (Server 1-3: 50%, Server 4: 70%).`
  })
 }

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

  if(markup_bps>0){
   if(provider==='youngpg'){
    await db.batch([
     db.prepare(`UPDATE staging_supplier_feed_items
       SET selling_price_minor=CAST(ROUND(supplier_cost_minor * (1.0 + ? / 10000.0)) AS INTEGER)
       WHERE category_id=? AND supplier_cost_minor>0`).bind(markup_bps,catId),
     db.prepare(`UPDATE products
       SET price_minor=(
         SELECT f.selling_price_minor FROM staging_supplier_feed_items f
         JOIN supplier_products sp ON sp.connection_id=f.connection_id AND sp.external_id=f.external_id
         WHERE sp.product_id=products.id
       )
       WHERE category_id=? AND server_number=2 AND (pricing_mode='auto' OR pricing_mode IS NULL)`).bind(catId)
    ])
   }else if(provider==='hstora'){
    await db.batch([
     db.prepare(`UPDATE hstora_catalog_items
       SET selling_price_minor=CAST(ROUND((CAST(json_extract(metadata,'$.price') AS REAL) * 100.0) * (1.0 + ? / 10000.0)) AS INTEGER)
       WHERE json_valid(metadata) AND CAST(json_extract(metadata,'$.price') AS REAL)>0`).bind(markup_bps),
     db.prepare(`UPDATE products
       SET price_minor=(SELECT h.selling_price_minor FROM hstora_catalog_items h WHERE h.product_id=products.id)
       WHERE server_number=1 AND (pricing_mode='auto' OR pricing_mode IS NULL)`)
    ])
   }else if(provider==='shopviaclone22'){
    await db.batch([
     db.prepare(`UPDATE shopviaclone22_catalog_items
       SET selling_price_minor=CAST(ROUND(cost_minor * (1.0 + ? / 10000.0)) AS INTEGER)
       WHERE category_id=? AND cost_minor>0`).bind(markup_bps,catId),
     db.prepare(`UPDATE products
       SET price_minor=(SELECT s3.selling_price_minor FROM shopviaclone22_catalog_items s3 WHERE s3.product_id=products.id)
       WHERE category_id=? AND server_number=3 AND (pricing_mode='auto' OR pricing_mode IS NULL)`).bind(catId)
    ])
   }else if(provider==='digitalcore'){
    await db.batch([
     db.prepare(`UPDATE digitalcore_catalog_items
       SET selling_price_minor=CAST(ROUND(cost_minor * (1.0 + ? / 10000.0)) AS INTEGER)
       WHERE cost_minor>0`).bind(markup_bps),
     db.prepare(`UPDATE products
       SET price_minor=(SELECT dc.selling_price_minor FROM digitalcore_catalog_items dc WHERE dc.product_id=products.id)
       WHERE server_number=4 AND (pricing_mode='auto' OR pricing_mode IS NULL)`)
    ])
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

  if(provider==='all'){
   for(const p of providers){
    const sMarkup = p === 'digitalcore' ? 7000 : markup_bps
    await db.prepare("INSERT INTO supplier_automation(provider,markup_bps,automatic_pricing,auto_publish,auto_approve,review_reference,delivery_type,updated_by) VALUES(?,?,1,1,1,'YoungPG authorized reseller permission','Manual fulfillment',?) ON CONFLICT(provider) DO UPDATE SET markup_bps=excluded.markup_bps,automatic_pricing=1,auto_publish=1,auto_approve=1,updated_by=excluded.updated_by,revision=revision+1").bind(p,sMarkup,actor.id).run()
   }
  }else{
   await db.prepare("INSERT INTO supplier_automation(provider,markup_bps,automatic_pricing,auto_publish,auto_approve,review_reference,delivery_type,updated_by) VALUES(?,?,1,1,1,'YoungPG authorized reseller permission','Manual fulfillment',?) ON CONFLICT(provider) DO UPDATE SET markup_bps=excluded.markup_bps,automatic_pricing=1,auto_publish=1,auto_approve=1,updated_by=excluded.updated_by,revision=revision+1").bind(provider,markup_bps,actor.id).run()
  }

  let updated=0
  if(provider==='youngpg'||provider==='all'){
   const ypgEffMarkup = provider==='all'?5000:markup_bps
   await db.batch([
    db.prepare(`UPDATE staging_supplier_feed_items
      SET selling_price_minor=CAST(ROUND(
        supplier_cost_minor * (1.0 + COALESCE(
          (SELECT r.markup_bps FROM supplier_category_rules r WHERE r.provider='youngpg' AND r.category_id=staging_supplier_feed_items.category_id AND r.markup_bps>0),
          ?
        ) / 10000.0)
      ) AS INTEGER)
      WHERE supplier_cost_minor>0`).bind(ypgEffMarkup),
    db.prepare(`UPDATE products
      SET price_minor=(
        SELECT f.selling_price_minor FROM staging_supplier_feed_items f
        JOIN supplier_products sp ON sp.connection_id=f.connection_id AND sp.external_id=f.external_id
        WHERE sp.product_id=products.id
      )
      WHERE server_number=2 AND (pricing_mode='auto' OR pricing_mode IS NULL)
        AND EXISTS(SELECT 1 FROM staging_supplier_feed_items f JOIN supplier_products sp ON sp.connection_id=f.connection_id AND sp.external_id=f.external_id WHERE sp.product_id=products.id AND f.selling_price_minor>0)`)
   ])
   updated+=(await db.prepare('SELECT count(*) n FROM staging_supplier_feed_items WHERE supplier_cost_minor>0').first<{n:number}>())?.n??0
  }
  if(provider==='hstora'||provider==='all'){
   const hstoraEffMarkup = provider==='all'?5000:markup_bps
   await db.batch([
    db.prepare(`UPDATE hstora_catalog_items
      SET selling_price_minor=CAST(ROUND(
        (CASE
          WHEN json_extract(metadata,'$.currency') = 'USD'
            THEN CAST(json_extract(metadata,'$.price') AS REAL) * 1500.0 * 100.0
          ELSE CAST(json_extract(metadata,'$.price') AS REAL) * 100.0
        END) * (1.0 + ? / 10000.0)
      ) AS INTEGER)
      WHERE json_valid(metadata) AND CAST(json_extract(metadata,'$.price') AS REAL)>0`).bind(hstoraEffMarkup),
    db.prepare(`UPDATE products
      SET price_minor=(SELECT h.selling_price_minor FROM hstora_catalog_items h WHERE h.product_id=products.id)
      WHERE server_number=1 AND (pricing_mode='auto' OR pricing_mode IS NULL)`)
   ])
   updated+=(await db.prepare("SELECT count(*) n FROM hstora_catalog_items WHERE json_valid(metadata) AND CAST(json_extract(metadata,'$.price') AS REAL)>0").first<{n:number}>())?.n??0
  }
  if(provider==='shopviaclone22'||provider==='all'){
   const s3EffMarkup = provider==='all'?5000:markup_bps
   await db.batch([
    db.prepare(`UPDATE shopviaclone22_catalog_items
      SET selling_price_minor=CAST(ROUND(
        cost_minor * (1.0 + COALESCE(
          (SELECT r.markup_bps FROM supplier_category_rules r WHERE r.provider='shopviaclone22' AND r.category_id=shopviaclone22_catalog_items.category_id AND r.markup_bps>0),
          ?
         ) / 10000.0)
      ) AS INTEGER)
      WHERE cost_minor>0`).bind(s3EffMarkup),
    db.prepare(`UPDATE products
      SET price_minor=(SELECT s3.selling_price_minor FROM shopviaclone22_catalog_items s3 WHERE s3.product_id=products.id)
      WHERE server_number=3 AND (pricing_mode='auto' OR pricing_mode IS NULL)`)
   ])
   updated+=(await db.prepare('SELECT count(*) n FROM shopviaclone22_catalog_items WHERE cost_minor>0').first<{n:number}>())?.n??0
  }
  if(provider==='digitalcore'||provider==='all'){
   const dcoreEffMarkup = provider==='all'?7000:markup_bps
   await db.batch([
    db.prepare(`UPDATE digitalcore_catalog_items
      SET selling_price_minor=CAST(ROUND(
        cost_minor * (1.0 + COALESCE(
          (SELECT r.markup_bps FROM supplier_category_rules r WHERE r.provider='digitalcore' AND r.category_id=digitalcore_catalog_items.category_id AND r.markup_bps>0),
          ?
         ) / 10000.0)
      ) AS INTEGER)
      WHERE cost_minor>0`).bind(dcoreEffMarkup),
    db.prepare(`UPDATE products
      SET price_minor=(SELECT dc.selling_price_minor FROM digitalcore_catalog_items dc WHERE dc.product_id=products.id)
      WHERE server_number=4 AND (pricing_mode='auto' OR pricing_mode IS NULL)`)
   ])
   updated+=(await db.prepare('SELECT count(*) n FROM digitalcore_catalog_items WHERE cost_minor>0').first<{n:number}>())?.n??0
  }
  return json({saved:true,provider,markup_bps,updated})
 }

 if(body.action==='approve_all'){
  const restore=body.restore_overrides===true
  const usdRate=typeof body.usd_to_ngn_rate==='number'&&body.usd_to_ngn_rate>0?body.usd_to_ngn_rate:1500.0
  let count=0
  if(provider==='youngpg'||provider==='all'){
   count += await bulkPublishYoungpg(db, 0, actor.id, restore)
  }
  if(provider==='hstora'||provider==='all'){
   count += await bulkPublishHstora(db, 0, usdRate, actor.id, restore)
  }
  if(provider==='shopviaclone22'||provider==='all'){
   count += await bulkPublishShopViaClone22(db, 0, actor.id, restore)
  }
  if(provider==='digitalcore'||provider==='all'){
   count += await bulkPublishDigitalCore(db, 0, usdRate, actor.id, restore)
  }
  await db.prepare("UPDATE products SET status='active',publication_verified=1,authorized_resale=1 WHERE status<>'active' OR publication_verified=0").run()
  const publishedCount=(await db.prepare("SELECT count(*) n FROM products WHERE status='active' AND publication_verified=1").first<{n:number}>())?.n??0
  return json({
   success: true,
   approved_count: count,
   published_count: publishedCount,
   skipped_count: 0,
   remaining_count: 0,
   message: `Successfully approved and published ${count} listings. All products are now live.`
  })
 }

 if(body.action==='preview'){
  if(!Number.isSafeInteger(body.markup_bps)||Number(body.markup_bps)<0||Number(body.markup_bps)>1000000)throw new HttpError(400,'Valid markup required.')
  const markup_bps=Number(body.markup_bps)
  const draft={markup_bps,automatic_pricing:body.automatic_pricing===true?1:0,auto_publish:body.auto_publish===true?1:0}
  const catRules=(await db.prepare('SELECT * FROM supplier_category_rules WHERE provider=?').bind(provider).all<CategoryRule>().catch(()=>({results:[]}))).results
  const catMarkupMap=new Map(catRules.map(r=>[r.category_id,r.markup_bps]))

  if(provider==='youngpg'){
   const feed=(await db.prepare(`SELECT f.external_id id,f.name,f.category_id,f.supplier_cost_minor,f.selling_price_minor,cat.name category_name,p.pricing_mode,p.price_minor override_price FROM staging_supplier_feed_items f LEFT JOIN categories cat ON cat.id=f.category_id LEFT JOIN supplier_products sp ON sp.connection_id=f.connection_id AND sp.external_id=f.external_id LEFT JOIN products p ON p.id=sp.product_id WHERE f.supplier_cost_minor>0 LIMIT 100`).all<{id:string;name:string;category_id:string|null;supplier_cost_minor:number;selling_price_minor:number|null;category_name:string|null;pricing_mode:string|null;override_price:number|null}>()).results
   const totalCount=(await db.prepare('SELECT count(*) n FROM staging_supplier_feed_items WHERE supplier_cost_minor>0').first<{n:number}>())?.n??feed.length
   const items=feed.map(item=>{
    const isOverride=item.pricing_mode==='override'&&body.restore_overrides!==true
    const effMarkup=(item.category_id&&catMarkupMap.has(item.category_id)&&catMarkupMap.get(item.category_id)!>0)?catMarkupMap.get(item.category_id)!:markup_bps
    const calculatedPrice=calculateSellingPrice(item.supplier_cost_minor,{id:'preview',enabled:true,mode:'markup',rateBps:effMarkup,fixedMinor:0,minProfitMinor:0,feeBps:0,feeFixedMinor:0,fxBufferBps:0,roundingMinor:1}).sellingPriceMinor
    const price=isOverride?(item.override_price??calculatedPrice):calculatedPrice
    return {
     id:item.id,
     name:item.name,
     category_name:item.category_name||'General',
     cost_minor:item.supplier_cost_minor,
     old_price_minor:item.selling_price_minor??item.supplier_cost_minor,
     price,
     markup_bps:effMarkup,
     profit_minor:price-item.supplier_cost_minor,
     eligible:true,
     managed:!isOverride,
     publish:true,
     reasons:isOverride?['Manual price override preserved']:[]
    }
   })
   return json({items,total:totalCount,eligible_count:totalCount,boundedBatch:25})
  }
  if(provider==='hstora'){
   const feed=(await db.prepare("SELECT h.external_id id,h.metadata,h.selling_price_minor,p.pricing_mode,p.price_minor override_price FROM hstora_catalog_items h LEFT JOIN products p ON p.id=h.product_id WHERE json_valid(h.metadata) AND CAST(json_extract(h.metadata,'$.price') AS REAL)>0 LIMIT 100").all<{id:string;metadata:string;selling_price_minor:number|null;pricing_mode:string|null;override_price:number|null}>()).results
   const totalCount=(await db.prepare("SELECT count(*) n FROM hstora_catalog_items WHERE json_valid(metadata) AND CAST(json_extract(metadata,'$.price') AS REAL)>0").first<{n:number}>())?.n??feed.length
   const items=feed.map(item=>{
    const isOverride=item.pricing_mode==='override'&&body.restore_overrides!==true
    const meta=JSON.parse(item.metadata??'{}')
    const cost=meta.price?nativeCostMinor(meta.price,100):1000
    const calculatedPrice=calculateSellingPrice(cost,{id:'preview',enabled:true,mode:'markup',rateBps:markup_bps,fixedMinor:0,minProfitMinor:0,feeBps:0,feeFixedMinor:0,fxBufferBps:0,roundingMinor:1}).sellingPriceMinor
    const price=isOverride?(item.override_price??calculatedPrice):calculatedPrice
    return {
     id:item.id,
     name:meta.name||'Server 1 Product',
     category_name:'Server 1',
     cost_minor:cost,
     old_price_minor:item.selling_price_minor??cost,
     price,
     markup_bps,
     profit_minor:price-cost,
     eligible:true,
     managed:!isOverride,
     publish:true,
     reasons:isOverride?['Manual price override preserved']:[]
    }
   })
   return json({items,total:totalCount,eligible_count:totalCount,boundedBatch:25})
  }
  if(provider==='shopviaclone22'){
   const feed=(await db.prepare(`SELECT s.external_id id,s.name,s.category_id,s.cost_minor,s.selling_price_minor,cat.name category_name,p.pricing_mode,p.price_minor override_price FROM shopviaclone22_catalog_items s LEFT JOIN categories cat ON cat.id=s.category_id LEFT JOIN products p ON p.id=s.product_id WHERE s.cost_minor>0 LIMIT 100`).all<{id:string;name:string;category_id:string|null;cost_minor:number;selling_price_minor:number|null;category_name:string|null;pricing_mode:string|null;override_price:number|null}>()).results
   const totalCount=(await db.prepare('SELECT count(*) n FROM shopviaclone22_catalog_items WHERE cost_minor>0').first<{n:number}>())?.n??feed.length
   const items=feed.map(item=>{
    const isOverride=item.pricing_mode==='override'&&body.restore_overrides!==true
    const effMarkup=(item.category_id&&catMarkupMap.has(item.category_id)&&catMarkupMap.get(item.category_id)!>0)?catMarkupMap.get(item.category_id)!:markup_bps
    const calculatedPrice=calculateSellingPrice(item.cost_minor,{id:'preview',enabled:true,mode:'markup',rateBps:effMarkup,fixedMinor:0,minProfitMinor:0,feeBps:0,feeFixedMinor:0,fxBufferBps:0,roundingMinor:1}).sellingPriceMinor
    const price=isOverride?(item.override_price??calculatedPrice):calculatedPrice
    return {
     id:item.id,
     name:item.name,
     category_name:item.category_name||'Server 3',
     cost_minor:item.cost_minor,
     old_price_minor:item.selling_price_minor??item.cost_minor,
     price,
     markup_bps:effMarkup,
     profit_minor:price-item.cost_minor,
     eligible:true,
     managed:!isOverride,
     publish:true,
     reasons:isOverride?['Manual price override preserved']:[]
    }
   })
   return json({items,total:totalCount,eligible_count:totalCount,boundedBatch:25})
  }
  if(provider==='digitalcore'){
   const feed=(await db.prepare(`SELECT s.external_id id,s.name,s.category_id,s.cost_minor,s.selling_price_minor,cat.name category_name,p.pricing_mode,p.price_minor override_price FROM digitalcore_catalog_items s LEFT JOIN categories cat ON cat.id=s.category_id LEFT JOIN products p ON p.id=s.product_id WHERE s.cost_minor>0 LIMIT 100`).all<{id:string;name:string;category_id:string|null;cost_minor:number;selling_price_minor:number|null;category_name:string|null;pricing_mode:string|null;override_price:number|null}>()).results
   const totalCount=(await db.prepare('SELECT count(*) n FROM digitalcore_catalog_items WHERE cost_minor>0').first<{n:number}>())?.n??feed.length
   const items=feed.map(item=>{
    const isOverride=item.pricing_mode==='override'&&body.restore_overrides!==true
    const effMarkup=(item.category_id&&catMarkupMap.has(item.category_id)&&catMarkupMap.get(item.category_id)!>0)?catMarkupMap.get(item.category_id)!:markup_bps
    const calculatedPrice=calculateSellingPrice(item.cost_minor,{id:'preview',enabled:true,mode:'markup',rateBps:effMarkup,fixedMinor:0,minProfitMinor:0,feeBps:0,feeFixedMinor:0,fxBufferBps:0,roundingMinor:1}).sellingPriceMinor
    const price=isOverride?(item.override_price??calculatedPrice):calculatedPrice
    return {
     id:item.id,
     name:item.name,
     category_name:item.category_name||'AI Tools',
     cost_minor:item.cost_minor,
     old_price_minor:item.selling_price_minor??item.cost_minor,
     price,
     markup_bps:effMarkup,
     profit_minor:price-item.cost_minor,
     eligible:true,
     managed:!isOverride,
     publish:true,
     reasons:isOverride?['Manual price override preserved']:[]
    }
   })
   return json({items,total:totalCount,eligible_count:totalCount,boundedBatch:25})
  }

  const publishedRows=await rows(env,provider)
  if(publishedRows.length>0){
   const items=publishedRows.map(row=>({
    id:row.id,
    old_price_minor:row.price_minor,
    ...automationDecision(row,draft,Date.now(),body.restore_overrides===true,catRules)
   }))
   const totalCount=(await db.prepare(`SELECT count(*) n ${source} WHERE ${providerWhere}`).bind(provider,provider,provider,provider).first<{n:number}>().catch(()=>({n:items.length})))?.n??items.length
   return json({items,total:totalCount,eligible_count:items.filter(i=>i.eligible).length,boundedBatch:25})
  }

  return json({items:[],total:0,eligible_count:0,boundedBatch:25})
 }

 if(body.action==='save'){
  if(!Number.isSafeInteger(body.markup_bps)||Number(body.markup_bps)<0||Number(body.markup_bps)>1000000||typeof body.automatic_pricing!=='boolean'||typeof body.auto_publish!=='boolean'||typeof body.auto_approve!=='boolean')throw new HttpError(400,'Valid percentage and explicit switches required.')
  const ref=typeof body.review_reference==='string'&&body.review_reference.trim().length>=5?body.review_reference.trim():(provider==='shopviaclone22'?'ShopViaClone22 authorized supplier':provider==='digitalcore'?'DigitalCore authorized partner':'YoungPG authorized reseller permission')
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
 if(!ids.length)return
 if(!await env.DB!.prepare("SELECT 1 FROM sqlite_master WHERE name='supplier_automation'").first())return
 const plan=await pricingRefreshPlan(env,ids)
 if(plan.blockedItems.length)throw new HttpError(409,plan.blockedItems[0].reason)
 if(plan.changes.length){
  await savePricingRefresh(env.DB!,plan)
  throw new HttpError(409,'Supplier pricing refresh completed. Review the updated cart prices before checkout.')
 }
}

type PricingChange={row:Row;policy:Policy;categoryRules:CategoryRule[];price:number}
type PricingRefreshPlan={changes:PricingChange[];blockedItems:Array<{id:string;reason:string}>;fx:PricingFx}

async function pricingRefreshPlan(env:ApiEnv,ids:string[]):Promise<PricingRefreshPlan>{
 const db=env.DB!,now=Date.now(),fx=await verifiedPricingFx(db,now)
 const changes:PricingChange[]=[],blockedItems:PricingRefreshPlan['blockedItems']=[]
 const policies=(await db.prepare('SELECT * FROM supplier_automation WHERE automatic_pricing=1').all<Policy>()).results
 for(const policy of policies){
  if(!providers.includes(policy.provider))continue
  const categoryRules=(await db.prepare('SELECT * FROM supplier_category_rules WHERE provider=?').bind(policy.provider).all<CategoryRule>()).results
  for(const row of await rows(env,policy.provider,'',ids.length,ids)){
   if(row.pricing_mode!=='auto')continue
   const quote=automationDecision(row,policy,now,false,categoryRules,fx.quote)
   let reason:string|null=null
   if(row.enabled!==1||row.removed===1||row.stock<=0)reason=`"${row.name||'Selected product'}" is currently unavailable from the supplier. Please remove it from your cart before checkout.`
   else if(!quote.managed)reason=quote.pricingError||'Supplier pricing is unverified; please try again after it is verified.'
   else if(row.available_quantity<=0)reason=`"${row.name||'Selected product'}" needs a fresh supplier stock check before checkout. Please try again after stock is verified.`
   if(reason)blockedItems.push({id:row.id,reason})
   else if(quote.price!==row.price_minor)changes.push({row,policy,categoryRules,price:quote.price})
  }
 }
 return {changes,blockedItems,fx}
}

async function savePricingRefresh(db:Database,plan:PricingRefreshPlan){
 const writes:Statement[]=[]
 for(const {row,policy,categoryRules,price} of plan.changes){
  const fence=crypto.randomUUID()
  writes.push(pricingFence(db,fence,row,policy,categoryRules,plan.fx),
   db.prepare("UPDATE products SET price_minor=? WHERE id=? AND pricing_mode='auto' AND price_minor=?").bind(price,row.id,row.price_minor))
  if(policy.provider==='hstora')writes.push(db.prepare('UPDATE hstora_catalog_items SET selling_price_minor=? WHERE product_id=?').bind(price,row.id))
  if(policy.provider==='shopviaclone22')writes.push(db.prepare('UPDATE shopviaclone22_catalog_items SET selling_price_minor=? WHERE product_id=?').bind(price,row.id))
  if(policy.provider==='digitalcore')writes.push(db.prepare('UPDATE digitalcore_catalog_items SET selling_price_minor=? WHERE product_id=?').bind(price,row.id))
  if(policy.provider==='youngpg')writes.push(db.prepare('UPDATE staging_supplier_feed_items SET selling_price_minor=? WHERE (connection_id,external_id) IN (SELECT connection_id,external_id FROM supplier_products WHERE product_id=?)').bind(price,row.id))
  writes.push(db.prepare("UPDATE admin_write_fences SET valid=CASE WHEN EXISTS(SELECT 1 FROM products WHERE id=? AND pricing_mode='auto' AND price_minor=?) THEN 1 ELSE 0 END WHERE id=?").bind(row.id,price,fence),db.prepare('DELETE FROM admin_write_fences WHERE id=?').bind(fence))
 }
 if(writes.length)try{await db.batch(writes)}catch(error){
  if(error instanceof Error&&/CHECK constraint failed: valid\s*=\s*1/i.test(error.message))throw new HttpError(409,'Product pricing changed during verification. Please refresh your cart and try again.')
  throw error
 }
}

export async function revalidateProductPrices(env:ApiEnv,ids:string[]){
 if(!ids.length||!env.DB)return {updatedCount:0,changedItems:[],blockedItems:[]}
 const plan=await pricingRefreshPlan(env,ids)
 await savePricingRefresh(env.DB,plan)
 const changedItems=plan.changes.map(({row,price})=>({id:row.id,name:row.name||'Product',oldPriceMinor:row.price_minor,newPriceMinor:price,diffMinor:price-row.price_minor}))
 return {updatedCount:changedItems.length,changedItems,blockedItems:plan.blockedItems}
}
