import { categoriesFrom, collection, DESCRIPTION_REQUIRED, discoverListings, identifier, listingSlug, listingsFrom, normalizeListingTitle, pageIsComplete, record, resaleAllowlist, restrictedCatalogText, subcategoriesFrom, SupplierReadError, YOUNGPG_ORIGIN, youngpgGet } from '../../server/youngpg.ts'
import { openCredential, sealCredential } from '../../server/supplier-crypto.ts'
import { requireRuntime } from './runtime.ts'
import { identity } from './auth.ts'
import { HttpError, json } from './http.ts'
import type { ApiEnv, Database, Statement } from './types.ts'

type Category = ReturnType<typeof categoriesFrom>[number]
type Product = ReturnType<typeof listingsFrom>['products'][number]
interface Connection { id:string; revision:number; encrypted_key:string; key_nonce:string; authorized_products:string }
interface Job { id:string; phase:string; revision:number; page:number; subcategory_index:number; categories:string; started_at:number; scanned:number; total:number|null; last_page:number|null; restart_required:number }

// Configuration-only quota hold: no catalog database operation occurs before
// the UTC reset. Invalid timestamps fail closed; authentication is unaffected.
export function catalogWritesReady(env:ApiEnv,now=Date.now()) {
  if(env.CATALOG_SYNC_ENABLED!=='true')return false
  if(!env.CATALOG_RESUME_AT)return true
  const resume=Date.parse(env.CATALOG_RESUME_AT)
  return Number.isFinite(resume)&&now>=resume
}

export function categoryMappingStatements(db:Database,connectionId:string,categories:Category[]) {
  // Public taxonomy is conservative; every other source category remains private
  // for review. Existing administrator categories/mappings are never overwritten.
  const mapped=JSON.stringify(categories.map(c=>({...c,storefront_id:crypto.randomUUID()})))
  return [
    db.prepare(`INSERT INTO categories(id,slug,name,short_name) SELECT json_extract(value,'$.storefront_id'),'ypg-'||json_extract(value,'$.slug'),json_extract(value,'$.name'),json_extract(value,'$.name') FROM json_each(?) src
      WHERE EXISTS(SELECT 1 FROM staging_supplier_feed_items f WHERE f.connection_id=? AND f.supplier_category_id=json_extract(src.value,'$.id') AND f.source_category='permitted_digital_good')
      AND NOT EXISTS(SELECT 1 FROM categories c WHERE c.slug IN (json_extract(src.value,'$.slug'),'ypg-'||json_extract(src.value,'$.slug')) OR lower(c.name)=lower(json_extract(src.value,'$.name')))
      ON CONFLICT(slug) DO NOTHING`).bind(mapped,connectionId),
    db.prepare(`UPDATE staging_supplier_feed_items AS f SET category_id=(SELECT c.id FROM json_each(?) src JOIN categories c ON c.slug IN(json_extract(src.value,'$.slug'),'ypg-'||json_extract(src.value,'$.slug')) OR lower(c.name)=lower(json_extract(src.value,'$.name'))
      WHERE json_extract(src.value,'$.id')=f.supplier_category_id AND c.active=1 ORDER BY c.id LIMIT 1)
      WHERE f.connection_id=? AND f.category_id IS NULL AND f.source_category='permitted_digital_good' AND EXISTS(SELECT 1 FROM json_each(?) src JOIN categories c ON c.slug IN(json_extract(src.value,'$.slug'),'ypg-'||json_extract(src.value,'$.slug')) OR lower(c.name)=lower(json_extract(src.value,'$.name')) WHERE json_extract(src.value,'$.id')=f.supplier_category_id AND c.active=1)`).bind(mapped,connectionId,mapped),
  ]
}
class SnapshotChangedError extends HttpError {
  constructor(){super(409,'Supplier snapshot changed. Checkpoint retained for diagnosis; next retry starts a new snapshot. No publication.')}
}

async function backgroundReady(env:ApiEnv) {
  const heartbeat=await env.DB!.prepare("SELECT value FROM migration_metadata WHERE key='catalog_scheduler_heartbeat'").first<{value:string}>()
  const time=Number(heartbeat?.value)
  return Number.isFinite(time)&&time<=Date.now()&&time>Date.now()-120000
}

// Every mutation batch asserts current ownership inside the same transaction.
async function commit(env:ApiEnv, c:Connection, owner:string, statements:Statement[]) {
  const db=env.DB!
  await db.batch([
    db.prepare(`INSERT INTO supplier_sync_fences(owner,valid) SELECT ?,CASE WHEN EXISTS(
      SELECT 1 FROM staging_supplier_connections WHERE id=? AND revision=? AND lease_owner=? AND lease_until>?
    ) THEN 1 ELSE 0 END`).bind(owner,c.id,c.revision,owner,Date.now()),
    ...statements,
    db.prepare('DELETE FROM supplier_sync_fences WHERE owner=?').bind(owner),
  ])
}

// Full discovery runs infrequently. Published goods get small independent stock
// checks, without replacing the complete snapshot or extending its approval gates.
export async function refreshPublishedStock(env:ApiEnv) {
  if(!catalogWritesReady(env))return {skipped:true}
  const db=env.DB!,now=Date.now(),owner=crypto.randomUUID()
  const row=await db.prepare(`SELECT c.id,c.revision,c.encrypted_key,c.key_nonce,c.authorized_products,j.id job_id,j.categories,i.metadata,f.external_id,f.evidence_reference
    FROM staging_supplier_connections c JOIN supplier_sync_jobs j ON j.connection_id=c.id AND j.revision=c.revision
    JOIN staging_supplier_feed_items f ON f.connection_id=c.id JOIN supplier_products sp ON sp.connection_id=f.connection_id AND sp.external_id=f.external_id
    JOIN products p ON p.id=sp.product_id JOIN supplier_sync_items i ON i.job_id=j.id AND i.external_id=f.external_id
    LEFT JOIN migration_metadata refresh ON refresh.key='catalog_stock_refresh:'||c.id
    WHERE c.enabled=1 AND c.next_attempt<=? AND (c.lease_until IS NULL OR c.lease_until<=?) AND j.restart_required=0
    AND f.approval='approved' AND f.authorization_verified=1 AND f.source_category='permitted_digital_good'
    AND EXISTS(SELECT 1 FROM supplier_snapshots verified WHERE verified.id=f.snapshot_id AND verified.connection_id=c.id AND verified.revision=c.revision AND verified.completed_at<=?) AND (json_extract(i.metadata,'$.review_block') IS NULL OR (
      json_extract(i.metadata,'$.review_block') IN ('Restricted detail metadata; manual investigation required.','Restricted account/access, financial or personal-data inventory; independent transfer and delivery review required.','Public title exceeds storefront limit; manual review required.')
      AND EXISTS(SELECT 1 FROM product_authorizations a WHERE a.product_id=p.id AND
        CASE WHEN json_valid(a.evidence) THEN json_extract(a.evidence,'$.delivery')=1
          AND json_extract(a.evidence,'$.privacy')=1 AND json_extract(a.evidence,'$.provider')=1
          AND length(trim(json_extract(a.evidence,'$.reference')))>=5 ELSE 0 END)
    )) AND (json_extract(i.metadata,'$.authorization_ref')=f.evidence_reference OR (
      json_extract(i.metadata,'$.authorization_ref') IS NULL AND json_extract(i.metadata,'$.review_block') IN ('Restricted detail metadata; manual investigation required.','Restricted account/access, financial or personal-data inventory; independent transfer and delivery review required.','Public title exceeds storefront limit; manual review required.')
      AND EXISTS(SELECT 1 FROM json_each(c.authorized_products) a WHERE a.value=f.evidence_reference
        AND (a.key=f.external_id OR (a.key='*' AND NOT EXISTS(SELECT 1 FROM json_each(c.authorized_products) specific WHERE specific.key=f.external_id))))
    ))
    AND p.status='active' AND p.publication_verified=1 AND f.source_checked_at<=MAX(?,CAST(COALESCE(refresh.value,'0') AS INTEGER)) AND json_extract(i.metadata,'$.slug') IS NOT NULL
    ORDER BY f.source_checked_at,f.external_id LIMIT 1`).bind(now,now,now,now-30*60*1000).first<Connection&{job_id:string;categories:string;metadata:string;external_id:string;evidence_reference:string}>()
  if(!row)return {skipped:true}
  const c=await db.prepare(`UPDATE staging_supplier_connections SET lease_owner=?,lease_until=? WHERE id=? AND revision=? AND enabled=1 AND next_attempt<=? AND (lease_until IS NULL OR lease_until<=?) RETURNING id,revision,encrypted_key,key_nonce,authorized_products`).bind(owner,now+300000,row.id,row.revision,now,now).first<Connection>()
  if(!c)return {skipped:true}
  try {
    const previous=JSON.parse(row.metadata) as Product,approved=resaleAllowlist(JSON.parse(c.authorized_products))
    if((approved[row.external_id]??approved['*'])!==row.evidence_reference)throw new HttpError(409,'Resale evidence changed; review required.')
    const key=await openCredential(c.encrypted_key,c.key_nonce,c.id,env.SUPPLIER_ENCRYPTION_KEY)
    let detailRes: Record<string, unknown> | null = null
    try {
      detailRes = record((await youngpgGet(YOUNGPG_ORIGIN,key,`listings/${listingSlug(previous.slug)}`)).data)
    } catch(err) {
      if (err instanceof HttpError && (err.status === 404 || err.message.includes('404') || err.message.includes('HTTP 404'))) {
        await commit(env,c,owner,[
          db.prepare(`UPDATE staging_supplier_feed_items SET stock_quantity=0,source_checked_at=? WHERE connection_id=? AND external_id=?`).bind(Date.now(),c.id,row.external_id),
          db.prepare(`UPDATE products SET status='inactive',publication_verified=0 WHERE id IN (SELECT product_id FROM supplier_products WHERE connection_id=? AND external_id=?)`).bind(c.id,row.external_id),
          db.prepare(`UPDATE supplier_sync_items SET metadata=json_set(metadata,'$.review_block',?) WHERE job_id=? AND external_id=?`).bind('Supplier listing detail returned 404; marked out of stock and inactive.',row.job_id,row.external_id),
          db.prepare('UPDATE staging_supplier_connections SET lease_owner=NULL,lease_until=NULL,next_attempt=? WHERE id=? AND lease_owner=?').bind(Date.now()+5500,c.id,owner),
        ])
        return {skipped:false}
      }
      throw err
    }
    const detail = detailRes
    if(identifier(detail.id)!==row.external_id)throw new HttpError(502,'Stock detail identifier mismatch.')
    const categories=JSON.parse(row.categories) as Category[]
    const category=categories.find(item=>item.id===previous.category_id)
    if(!category)throw new HttpError(409,'Stock category checkpoint mismatch.')
    // Detail endpoints may omit identity fields; supplied identity still must match.
    // Quantity is always required from this response, never copied from a snapshot.
    const normalized=listingsFrom([{...detail,title:detail.title??previous.name,
      category:detail.category??{slug:category.slug,title:category.name},
      description:detail.description??previous.description,status:detail.status??previous.supplier_status,
      price_ngn:detail.price_ngn??`${Math.floor(previous.cost_minor/100)}.${String(previous.cost_minor%100).padStart(2,'0')}`,
    }],categories,approved).products[0]
    // Invalid/mismatched details are not a verified stock=0 reading. Do not
    // stamp a new freshness timestamp or falsely mark the item sold out.
    const product=normalized?.name===normalizeListingTitle(previous.name)&&normalized.category_id===previous.category_id?normalized:undefined
    if(!product)throw new HttpError(502,'Supplier stock detail changed; fresh verification required.')
    await commit(env,c,owner,[
      // Repair only obsolete flags after a validated live response and existing review.
      db.prepare(`UPDATE supplier_sync_items SET metadata=json_set(json_remove(metadata,'$.review_block'),'$.authorization_ref',?)
        WHERE job_id=? AND external_id=? AND json_extract(metadata,'$.review_block') IN ('Restricted detail metadata; manual investigation required.','Restricted account/access, financial or personal-data inventory; independent transfer and delivery review required.','Public title exceeds storefront limit; manual review required.')
        AND EXISTS(SELECT 1 FROM supplier_products sp JOIN product_authorizations a ON a.product_id=sp.product_id
          JOIN staging_supplier_feed_items f ON f.connection_id=sp.connection_id AND f.external_id=sp.external_id
          WHERE sp.connection_id=? AND sp.external_id=? AND f.approval='approved' AND f.evidence_reference=?
          AND CASE WHEN json_valid(a.evidence) THEN json_extract(a.evidence,'$.delivery')=1
            AND json_extract(a.evidence,'$.privacy')=1 AND json_extract(a.evidence,'$.provider')=1
            AND length(trim(json_extract(a.evidence,'$.reference')))>=5 ELSE 0 END)`)
        .bind(product.authorization_ref,row.job_id,row.external_id,c.id,row.external_id,row.evidence_reference),
      db.prepare(`UPDATE staging_supplier_feed_items SET stock_quantity=?,source_checked_at=?,supplier_cost_minor=COALESCE(?,supplier_cost_minor)
        WHERE connection_id=? AND external_id=? AND approval='approved' AND evidence_reference=?
        AND EXISTS(SELECT 1 FROM supplier_sync_items i WHERE i.job_id=? AND i.external_id=?
          AND json_extract(i.metadata,'$.review_block') IS NULL AND json_extract(i.metadata,'$.authorization_ref')=?)`)
        .bind(product.stock,Date.now(),product.cost_minor,c.id,row.external_id,row.evidence_reference,row.job_id,row.external_id,row.evidence_reference),
      db.prepare('UPDATE staging_supplier_connections SET lease_owner=NULL,lease_until=NULL,next_attempt=? WHERE id=? AND lease_owner=?').bind(Date.now()+5500,c.id,owner),
    ])
    return {skipped:false}
  }catch(error){
    const delay=error instanceof SupplierReadError?Math.max(30000,error.retryAfterMs):60000
    const reason=error instanceof SupplierReadError||error instanceof HttpError?error.message:'Stock refresh storage or credential failure.'
    await db.prepare("UPDATE staging_supplier_connections SET lease_owner=NULL,lease_until=NULL,next_attempt=?,last_status=? WHERE id=? AND lease_owner=?").bind(Date.now()+delay,reason.slice(0,500),c.id,owner).run()
    return {skipped:true}
  }
}

export async function syncCatalogBatch(env:ApiEnv, connectionId?:string) {
  if(env.CATALOG_SYNC_ENABLED==='true'&&!catalogWritesReady(env))return {done:false,skipped:'quota_reset_pending'}
  await requireRuntime(env)
  if ((env.ENVIRONMENT!=='staging'&&!(env.ENVIRONMENT==='production'&&env.PRODUCTION_CUTOVER_ENABLED==='true')) || env.CATALOG_SYNC_ENABLED!=='true' || !env.DB || !env.SUPPLIER_ENCRYPTION_KEY) throw new HttpError(503,'D1 catalog synchronization is not enabled/configured.')
  const db=env.DB; const now=Date.now(); const owner=crypto.randomUUID()
  const c=await db.prepare(`UPDATE staging_supplier_connections SET lease_owner=?,lease_until=?
    WHERE id=(SELECT id FROM staging_supplier_connections WHERE enabled=1 AND (? IS NULL OR id=?)
      AND next_attempt<=? AND (lease_until IS NULL OR lease_until<=?)
      AND (? IS NOT NULL OR last_verified_scan_at IS NULL OR last_verified_scan_at<=?
        OR EXISTS(SELECT 1 FROM supplier_sync_jobs j WHERE j.connection_id=staging_supplier_connections.id
          AND (j.phase<>'complete' OR j.restart_required=1)))
      AND (? IS NOT NULL OR NOT EXISTS(SELECT 1 FROM migration_metadata a WHERE a.key='catalog_auto_sync:'||staging_supplier_connections.id AND a.value='false')
        OR EXISTS(SELECT 1 FROM supplier_sync_jobs j WHERE j.connection_id=staging_supplier_connections.id AND (j.phase<>'complete' OR j.restart_required=1)))
      ORDER BY COALESCE(last_verified_scan_at,0),id LIMIT 1)
    RETURNING id,revision,encrypted_key,key_nonce,authorized_products`)
    // Only automatic starts wait 12 hours after success; incomplete jobs and
    // explicit refresh requests still obey the existing cooldown and lease checks.
    .bind(owner,now+300000,connectionId??null,connectionId??null,now,now,connectionId??null,now-12*60*60*1000,connectionId??null).first<Connection>()
  if (!c) return {done:false,skipped:'busy_or_cooling_down'}
  let location='initialization'
  try {
    const approved=resaleAllowlist(JSON.parse(c.authorized_products))
    if (!Object.keys(approved).length) throw new HttpError(409,'Supplier-wide or product-specific resale authorization reference is required before ingestion.')
    let job=await db.prepare('SELECT * FROM supplier_sync_jobs WHERE connection_id=?').bind(c.id).first<Job>()
    if (!job || job.phase==='complete' || job.restart_required===1 || job.revision!==c.revision || now-job.started_at>3600000) {
      const id=crypto.randomUUID()
      await commit(env,c,owner,[
        db.prepare('DELETE FROM supplier_sync_jobs WHERE connection_id=?').bind(c.id),
        db.prepare("INSERT INTO supplier_sync_jobs(id,connection_id,revision,phase,started_at) VALUES(?,?,?,'categories',?)").bind(id,c.id,c.revision,now),
      ])
      job=(await db.prepare('SELECT * FROM supplier_sync_jobs WHERE id=?').bind(id).first<Job>())!
    }
    location=job.phase==='listings'?`listings page ${job.page}`:job.phase
    const key=await openCredential(c.encrypted_key,c.key_nonce,c.id,env.SUPPLIER_ENCRYPTION_KEY)
    let categories=JSON.parse(job.categories) as Category[]
    const statements:Statement[]=[]; let next=job.phase; let page=job.page; const sub=job.subcategory_index; let scanned=job.scanned
    let total=job.total; let last=job.last_page
    const get=(resource:Parameters<typeof youngpgGet>[2],p=1)=>youngpgGet(YOUNGPG_ORIGIN,key,resource,p)
    if (job.phase==='categories') {
      // Listing data already identifies product categories and optional subcategory IDs.
      // Avoid dozens of nonessential per-category requests and upstream 429 responses.
      categories=categoriesFrom(await get('categories')); next='listings'
    } else if (job.phase==='subcategories') {
      // Resume pre-patch checkpoints without deleting previously collected subcategories.
      // The existing records remain available at finalization; no supplier request needed.
      if (!categories.length || sub > categories.length) throw new HttpError(409,'Category checkpoint is invalid.')
      next='listings'
    } else if (job.phase==='listings') {
      const response=await get('listings',page); const values=collection(response); const meta=record(values.meta)
      const complete=pageIsComplete(response,page,values.rows.length)
      const declaredTotal=Number(meta.total);const declaredLast=Number(meta.last_page)
      if (!Number.isSafeInteger(declaredTotal)||declaredTotal<0||declaredTotal>100000||!Number.isSafeInteger(declaredLast)||declaredLast<1||declaredLast>1000) throw new HttpError(502,'Supplier snapshot pagination is invalid. No publication.')
      if ((total!==null&&total!==declaredTotal)||(last!==null&&last!==declaredLast)) throw new SnapshotChangedError()
      total=declaredTotal;last=declaredLast
      const ids=values.rows.map(v=>identifier(record(v).id)); const mapped=discoverListings(values.rows,categories,approved)
      categories=mapped.categories;scanned+=ids.length
      if (complete&&scanned!==total) throw new SnapshotChangedError()
      statements.push(db.prepare('INSERT INTO supplier_sync_seen(job_id,external_id) SELECT ?,value FROM json_each(?)').bind(job.id,JSON.stringify(ids)))
      statements.push(db.prepare(`INSERT INTO supplier_sync_items(job_id,external_id,metadata,detail_done)
        SELECT ?,json_extract(value,'$.id'),value,CASE WHEN json_extract(value,'$.review_block') IS NOT NULL OR json_extract(value,'$.slug') IS NULL OR CAST(json_each.key AS INTEGER)+?>=100 THEN 1 ELSE 0 END FROM json_each(?)`)
        .bind(job.id,scanned-ids.length,JSON.stringify(mapped.discovery.map(item=>mapped.products.find(p=>p.id===item.id)??item))))
      const subs=mapped.discovery.filter(item=>'subcategory_id' in item&&item.subcategory_id&&'subcategory_name' in item&&item.subcategory_name&&'subcategory_slug' in item&&item.subcategory_slug)
      if(subs.length)statements.push(db.prepare(`INSERT INTO supplier_sync_subcategories(job_id,external_id,parent_id,slug,name) SELECT ?,json_extract(value,'$.subcategory_id'),json_extract(value,'$.category_id'),json_extract(value,'$.subcategory_slug'),json_extract(value,'$.subcategory_name') FROM json_each(?) WHERE 1
        ON CONFLICT(job_id,external_id) DO UPDATE SET parent_id=excluded.parent_id,slug=excluded.slug,name=excluded.name WHERE parent_id<>excluded.parent_id OR slug<>excluded.slug OR name<>excluded.name`).bind(job.id,JSON.stringify(subs)))
      if (complete) next='details'; else page++
    } else if (job.phase==='details') {
      const pending=await db.prepare('SELECT external_id,metadata FROM supplier_sync_items WHERE job_id=? AND detail_done=0 ORDER BY external_id LIMIT 1').bind(job.id).first<{external_id:string;metadata:string}>()
      if (!pending) next='finalize'
      else {
        const product=JSON.parse(pending.metadata) as Product
        let detailData: Record<string, unknown> | null = null
        try {
          detailData = record((await get(`listings/${listingSlug(product.slug)}`)).data)
        } catch (detailErr) {
          const is404 = detailErr instanceof HttpError && (detailErr.status === 404 || detailErr.message.includes('404') || detailErr.message.includes('HTTP 404'))
          if (is404) {
            statements.push(db.prepare("UPDATE supplier_sync_items SET metadata=json_set(metadata,'$.review_block',?),detail_done=1 WHERE job_id=? AND external_id=?")
              .bind('Supplier listing detail returned 404; removed from upstream.', job.id, pending.external_id))
          } else {
            throw detailErr
          }
        }
        if (detailData) {
          const detail = detailData
          if (identifier(detail.id)!==product.id) {
            statements.push(db.prepare("UPDATE supplier_sync_items SET metadata=json_set(metadata,'$.review_block',?),detail_done=1 WHERE job_id=? AND external_id=?")
              .bind('Supplier detail identifier mismatch.', job.id, pending.external_id))
          } else {
            const category=categories.find(v=>v.id===product.category_id)
            if (!category) throw new HttpError(502,'Supplier category checkpoint mismatch.')
            const {productImages}=await import('../../src/lib/product-images.ts')
            const enriched=listingsFrom([{
              id:product.id,title:product.name,category:{slug:category.slug,title:category.name},slug:product.slug,
              description:product.description===DESCRIPTION_REQUIRED?detail.description:product.description,
              price_ngn:`${Math.floor(product.cost_minor/100)}.${String(product.cost_minor%100).padStart(2,'0')}`,
              available_stock:product.stock,status:detail.status??product.supplier_status,
              image_urls:[...new Set([...productImages(product),...productImages(detail)])],subcategory:detail.subcategory,
            }],categories,approved).products[0]
            statements.push(enriched
              ?db.prepare('UPDATE supplier_sync_items SET metadata=?,detail_done=1 WHERE job_id=? AND external_id=?').bind(JSON.stringify(enriched),job.id,pending.external_id)
              :db.prepare("UPDATE supplier_sync_items SET metadata=json_set(metadata,'$.review_block',?),detail_done=1 WHERE job_id=? AND external_id=?")
                .bind(restrictedCatalogText.test(String(detail.title??product.name)+' '+String(detail.description??product.description))
                  ?'Explicit compromised-credential indicators; independent security review required.'
                  :'Current supplier detail failed authorization validation; independent review required.',job.id,pending.external_id))
          }
        }
      }
    } else if (job.phase==='finalize') {
      const check=await db.prepare(`SELECT (SELECT count(*) FROM supplier_sync_seen WHERE job_id=?) scanned,
        (SELECT count(*) FROM supplier_sync_items WHERE job_id=? AND json_extract(metadata,'$.review_block') IS NULL) eligible,
        (SELECT count(*) FROM supplier_sync_items WHERE job_id=? AND detail_done=0) pending`).bind(job.id,job.id,job.id).first<{scanned:number;eligible:number;pending:number}>()
      if (!check||check.scanned!==total||check.pending||check.eligible>100000||now-job.started_at>3600000) throw new HttpError(409,'Complete, current supplier snapshot required; nothing published.')
      statements.push(db.prepare(`INSERT INTO supplier_source_categories(connection_id,kind,external_id,slug,name,snapshot_id)
        SELECT ?,'category',json_extract(value,'$.id'),json_extract(value,'$.slug'),json_extract(value,'$.name'),? FROM json_each(?) WHERE 1
        ON CONFLICT(connection_id,kind,external_id) DO UPDATE SET slug=excluded.slug,name=excluded.name WHERE slug<>excluded.slug OR name<>excluded.name`).bind(c.id,job.id,JSON.stringify(categories)))
      statements.push(db.prepare(`INSERT INTO supplier_source_categories(connection_id,kind,external_id,parent_id,slug,name,snapshot_id)
        SELECT ?,'subcategory',external_id,parent_id,slug,name,? FROM supplier_sync_subcategories WHERE job_id=? AND 1
        ON CONFLICT(connection_id,kind,external_id) DO UPDATE SET parent_id=excluded.parent_id,slug=excluded.slug,name=excluded.name WHERE parent_id IS NOT excluded.parent_id OR slug<>excluded.slug OR name<>excluded.name`).bind(c.id,job.id,job.id))
      statements.push(db.prepare(`INSERT INTO staging_supplier_feed_items(connection_id,external_id,name,source_category,supplier_cost_minor,stock_quantity,authorization_verified,evidence_reference,source_checked_at,supplier_description,supplier_image_urls,supplier_category_id,supplier_subcategory_id,snapshot_id)
        SELECT ?,external_id,substr(json_extract(metadata,'$.name'),1,200),'permitted_digital_good',json_extract(metadata,'$.cost_minor'),json_extract(metadata,'$.stock'),1,json_extract(metadata,'$.authorization_ref'),?,json_extract(metadata,'$.description'),COALESCE(json_extract(metadata,'$.image_urls'),'[]'),json_extract(metadata,'$.category_id'),json_extract(metadata,'$.subcategory_id'),?
        FROM supplier_sync_items WHERE job_id=? AND json_extract(metadata,'$.review_block') IS NULL
        AND length(trim(COALESCE(json_extract(metadata,'$.authorization_ref'),'')))>=5
        ON CONFLICT(connection_id,external_id) DO UPDATE SET name=excluded.name,supplier_cost_minor=excluded.supplier_cost_minor,
          stock_quantity=CASE WHEN staging_supplier_feed_items.evidence_reference=excluded.evidence_reference THEN excluded.stock_quantity ELSE 0 END,
          source_checked_at=CASE WHEN staging_supplier_feed_items.evidence_reference=excluded.evidence_reference THEN excluded.source_checked_at ELSE staging_supplier_feed_items.source_checked_at END,
          supplier_description=CASE WHEN trim(excluded.supplier_description)='' OR excluded.supplier_description='Description not supplied by supplier; administrator review required.' THEN staging_supplier_feed_items.supplier_description ELSE excluded.supplier_description END,
          supplier_image_urls=CASE WHEN json_array_length(excluded.supplier_image_urls)=0 THEN staging_supplier_feed_items.supplier_image_urls ELSE excluded.supplier_image_urls END,
          supplier_category_id=excluded.supplier_category_id,supplier_subcategory_id=excluded.supplier_subcategory_id,snapshot_id=excluded.snapshot_id`)
        .bind(c.id,job.started_at,job.id,job.id))
      statements.push(db.prepare('UPDATE staging_supplier_feed_items SET stock_quantity=0 WHERE connection_id=? AND stock_quantity<>0 AND (snapshot_id IS NULL OR snapshot_id<>?)').bind(c.id,job.id))
      statements.push(db.prepare("UPDATE products SET status='inactive',publication_verified=0 WHERE id IN (SELECT product_id FROM supplier_products sp JOIN staging_supplier_feed_items f ON f.connection_id=sp.connection_id AND f.external_id=sp.external_id WHERE f.connection_id=? AND (f.stock_quantity=0 OR f.snapshot_id IS NULL OR f.snapshot_id<>?))").bind(c.id,job.id))
      statements.push(...categoryMappingStatements(db,c.id,categories))
      statements.push(db.prepare('INSERT OR IGNORE INTO supplier_snapshots(id,connection_id,revision,started_at,completed_at) VALUES(?,?,?,?,?)').bind(job.id,c.id,c.revision,job.started_at,now))
      statements.push(db.prepare("UPDATE supplier_sync_jobs SET phase='complete',completed_at=? WHERE id=?").bind(now,job.id))
      statements.push(db.prepare('UPDATE staging_supplier_connections SET last_verified_scan_at=? WHERE id=?').bind(now,c.id))
      next='complete'
    } else throw new HttpError(409,'Unsupported catalog checkpoint.')
    if (next!=='complete' && (job.phase!=='details'||next!==job.phase)) statements.push(db.prepare('UPDATE supplier_sync_jobs SET phase=?,page=?,subcategory_index=?,categories=?,scanned=?,total=?,last_page=? WHERE id=?')
      .bind(next,page,sub,JSON.stringify(categories),scanned,total,last,job.id))
    statements.push(db.prepare('UPDATE staging_supplier_connections SET lease_owner=NULL,lease_until=NULL,last_status=?,next_attempt=? WHERE id=? AND lease_owner=?')
      .bind(next==='complete'?'Verified snapshot stored; review required':`Catalog ${next}; ${scanned} scanned`,Date.now()+5500,c.id,owner))
    await commit(env,c,owner,statements)
    return {done:next==='complete',connection_id:c.id,job_id:job.id,phase:next,scanned,publicationEnabled:false}
  } catch(error) {
    const delay=error instanceof SupplierReadError?Math.max(30000,error.retryAfterMs):60000
    // Adapter errors contain fixed diagnostics, never upstream bodies or secrets.
    const status=error instanceof HttpError?error.status:503
    const reason=error instanceof HttpError?error.message:'Database or runtime operation failed.'
    const diagnostic=`Catalog ${location}: HTTP ${status}. ${reason} Checkpoint retained; no publication.`
    console.warn(JSON.stringify({event:'catalog_sync_failed',location,status,reason}))
    // Expiry does not prevent cleanup, but a changed owner always does.
    const cleanup:Statement[]=[]
    if(error instanceof SnapshotChangedError) cleanup.push(db.prepare(`UPDATE supplier_sync_jobs SET restart_required=1 WHERE connection_id=? AND revision=? AND EXISTS(SELECT 1 FROM staging_supplier_connections WHERE id=? AND lease_owner=?)`).bind(c.id,c.revision,c.id,owner))
    cleanup.push(db.prepare('UPDATE staging_supplier_connections SET lease_owner=NULL,lease_until=NULL,next_attempt=?,last_status=? WHERE id=? AND lease_owner=?')
      .bind(Date.now()+delay,diagnostic,c.id,owner))
    await db.batch(cleanup)
    if (error instanceof HttpError) throw error
    if (error instanceof SupplierReadError) throw new HttpError(error.status,error.message)
    throw new HttpError(503,'Catalog batch rejected or unavailable; checkpoint retained. No partial snapshot published.')
  }
}

// Optional taxonomy enrichment has its own cursor. It never extends, replaces or
// restarts the product snapshot, and shares the supplier lease/rate-limit budget.
export async function refreshSupplierTaxonomy(env:ApiEnv){
 if(!catalogWritesReady(env)||!env.DB||!env.SUPPLIER_ENCRYPTION_KEY)return {skipped:true}
 const db=env.DB,now=Date.now(),owner=crypto.randomUUID()
 const row=await db.prepare(`SELECT c.id,c.revision,j.id job_id,j.categories,t.value cursor FROM staging_supplier_connections c JOIN supplier_sync_jobs j ON j.connection_id=c.id AND j.phase='complete' AND j.revision=c.revision LEFT JOIN migration_metadata t ON t.key='catalog_taxonomy:'||c.id WHERE c.enabled=1 AND c.next_attempt<=? AND (c.lease_until IS NULL OR c.lease_until<=?) AND j.restart_required=0 AND (t.value IS NULL OR json_extract(t.value,'$.job_id')<>j.id OR json_extract(t.value,'$.done')<>1) ORDER BY c.id LIMIT 1`).bind(now,now).first<{id:string;revision:number;job_id:string;categories:string;cursor:string|null}>()
 if(!row)return {skipped:true}
 const categories=(JSON.parse(row.categories) as Category[]).filter(c=>!c.id.startsWith('unmatched-'))
 const cursor=row.cursor?JSON.parse(row.cursor):null
 const index=cursor?.job_id===row.job_id&&Number.isSafeInteger(cursor.index)&&cursor.index>=0?cursor.index:0
 const c=await db.prepare('UPDATE staging_supplier_connections SET lease_owner=?,lease_until=? WHERE id=? AND revision=? AND next_attempt<=? AND (lease_until IS NULL OR lease_until<=?) RETURNING id,revision,encrypted_key,key_nonce,authorized_products').bind(owner,now+300000,row.id,row.revision,now,now).first<Connection>()
 if(!c)return {skipped:true}
 try{
  const category=categories[index]
  const key=await openCredential(c.encrypted_key,c.key_nonce,c.id,env.SUPPLIER_ENCRYPTION_KEY)
  const subs=category?subcategoriesFrom(await youngpgGet(YOUNGPG_ORIGIN,key,`categories/${identifier(category.id)}/subcategories`),category.id):[]
  const next=category?index+1:index
  await commit(env,c,owner,[
   db.prepare(`INSERT INTO supplier_source_categories(connection_id,kind,external_id,parent_id,slug,name,snapshot_id) SELECT ?,'subcategory',json_extract(value,'$.id'),json_extract(value,'$.parent_id'),json_extract(value,'$.slug'),json_extract(value,'$.name'),? FROM json_each(?) WHERE 1 ON CONFLICT(connection_id,kind,external_id) DO UPDATE SET parent_id=excluded.parent_id,slug=excluded.slug,name=excluded.name WHERE parent_id IS NOT excluded.parent_id OR slug<>excluded.slug OR name<>excluded.name`).bind(c.id,row.job_id,JSON.stringify(subs)),
   db.prepare("INSERT INTO migration_metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind('catalog_taxonomy:'+c.id,JSON.stringify({job_id:row.job_id,index:next,total:categories.length,done:next>=categories.length?1:0})),
   db.prepare('UPDATE staging_supplier_connections SET lease_owner=NULL,lease_until=NULL,next_attempt=? WHERE id=? AND lease_owner=?').bind(Date.now()+5500,c.id,owner),
  ])
  return {skipped:false,index:next,total:categories.length}
 }catch(error){
  const delay=error instanceof SupplierReadError?Math.max(30000,error.retryAfterMs):60000
  await db.prepare("UPDATE staging_supplier_connections SET lease_owner=NULL,lease_until=NULL,next_attempt=?,last_status='Subcategory enrichment failed; product snapshot and taxonomy cursor retained.' WHERE id=? AND lease_owner=?").bind(Date.now()+delay,c.id,owner).run()
  return {skipped:true}
 }
}

export async function catalogAdmin(request:Request,env:ApiEnv) {
  if (!env.DB) throw new HttpError(503,'D1 unavailable.')
  const actor=await identity(request,env)
  if (actor.role!=='admin') throw new HttpError(403,'Administrator access required.')
  if (request.method==='GET') {
    // Supplier-reported stock is private inventory information, not an offer for sale.
    // Keep it separate from the one-hour verified_product_stock storefront gate.
    const url=new URL(request.url)
    if(url.searchParams.get('inventory')==='1') {
      const requested=Number(url.searchParams.get('page')??'1')
      if(!Number.isSafeInteger(requested)||requested<1||requested>1000)throw new HttpError(400,'Invalid inventory page.')
      const pageSize=50,offset=(requested-1)*pageSize
      const [totals,inventory]=await Promise.all([
        env.DB.prepare(`SELECT COUNT(*) total,
          SUM(CASE WHEN json_type(i.metadata,'$.stock')='integer' AND CAST(json_extract(i.metadata,'$.stock') AS INTEGER) BETWEEN 1 AND 1000000 THEN 1 ELSE 0 END) reportedPositive,
          SUM(CASE WHEN p.status='active' AND p.authorized_resale=1 AND p.publication_verified=1 AND cat.active=1 AND v.available_quantity>0 THEN 1 ELSE 0 END) sellablePositive,
          MAX(j.completed_at) snapshotCompletedAt
          FROM staging_supplier_connections c JOIN supplier_sync_jobs j ON j.connection_id=c.id AND j.phase='complete' AND j.revision=c.revision
          JOIN supplier_sync_items i ON i.job_id=j.id
          LEFT JOIN supplier_products sp ON sp.connection_id=c.id AND sp.external_id=i.external_id
          LEFT JOIN products p ON p.id=sp.product_id
          LEFT JOIN categories cat ON cat.id=p.category_id
          LEFT JOIN verified_product_stock v ON v.id=sp.product_id`).first(),
        env.DB.prepare(`SELECT i.external_id externalId,c.id supplierId,
          CASE WHEN json_type(i.metadata,'$.stock')='integer'
            AND CAST(json_extract(i.metadata,'$.stock') AS INTEGER) BETWEEN 0 AND 1000000
            THEN CAST(json_extract(i.metadata,'$.stock') AS INTEGER) ELSE NULL END supplierReportedStock,
          CASE WHEN p.status='active' AND p.authorized_resale=1 AND p.publication_verified=1 AND cat.active=1
            THEN COALESCE(v.available_quantity,0) ELSE 0 END verifiedSellableStock,
          CASE WHEN json_extract(i.metadata,'$.review_block') IS NULL THEN 'eligible_for_review'
            ELSE 'requires_review' END reviewStatus,
          j.completed_at supplierStockSnapshotAt,
          f.source_checked_at sellableStockCheckedAt
          FROM staging_supplier_connections c JOIN supplier_sync_jobs j ON j.connection_id=c.id AND j.phase='complete' AND j.revision=c.revision
          JOIN supplier_sync_items i ON i.job_id=j.id
          LEFT JOIN staging_supplier_feed_items f ON f.connection_id=c.id AND f.external_id=i.external_id
          LEFT JOIN supplier_products sp ON sp.connection_id=c.id AND sp.external_id=i.external_id
          LEFT JOIN products p ON p.id=sp.product_id
          LEFT JOIN categories cat ON cat.id=p.category_id
          LEFT JOIN verified_product_stock v ON v.id=sp.product_id
          ORDER BY c.name,i.external_id LIMIT ? OFFSET ?`).bind(pageSize,offset).all(),
      ])
      return json({inventory:inventory.results,summary:totals,page:requested,pageSize,
        disclaimer:'Supplier snapshot quantities are not independently verified sellable stock.'})
    }
    const result=await env.DB.prepare(`SELECT c.id,c.name,c.enabled,c.revision,c.last_status,c.last_verified_scan_at,
      j.id job_id,j.phase,j.page,j.scanned,j.total,c.next_attempt,
      COALESCE(a.value<>'false',1) automatic_enabled,(SELECT value FROM migration_metadata WHERE key='catalog_taxonomy:'||c.id) taxonomy_progress,
      CASE WHEN json_type(c.authorized_products,'$."*"')='text' THEN 1 ELSE 0 END AS supplier_wide_authorized
      FROM staging_supplier_connections c LEFT JOIN supplier_sync_jobs j ON j.connection_id=c.id LEFT JOIN migration_metadata a ON a.key='catalog_auto_sync:'||c.id ORDER BY c.name`).all()
    return json({suppliers:result.results,backgroundReady:await backgroundReady(env),writeReady:catalogWritesReady(env),resumeAt:env.CATALOG_RESUME_AT??null,publicationEnabled:false})
  }
  if (request.method!=='POST'||request.headers.get('Origin')!==new URL(request.url).origin) throw new HttpError(403,'Same-origin POST required.')
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415,'JSON required.')
  const reader=request.body?.getReader(); const chunks:Uint8Array[]=[];let size=0
  if (!reader) throw new HttpError(400,'JSON body required.')
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>64000){await reader.cancel();throw new HttpError(413,'Configuration too large.')}chunks.push(part.value)}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  let body:Record<string,unknown>
  try{body=record(JSON.parse(new TextDecoder().decode(bytes)))}catch{throw new HttpError(400,'Invalid JSON.')}
  const id=typeof body.id==='string'?body.id:crypto.randomUUID()
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) throw new HttpError(400,'Invalid supplier ID.')
  if(env.CATALOG_SYNC_ENABLED==='true'&&!catalogWritesReady(env))throw new HttpError(503,`Catalog writes held until ${env.CATALOG_RESUME_AT}. Saved records and checkpoints are unchanged.`)
  if (body.action==='sync') {
    if (env.CATALOG_SYNC_ENABLED!=='true'||!env.SUPPLIER_ENCRYPTION_KEY) throw new HttpError(503,'D1 catalog synchronization is not enabled/configured.')
      const queued=await env.DB.prepare('SELECT enabled,revision,authorized_products FROM staging_supplier_connections WHERE id=?').bind(id).first<{enabled:number;revision:number;authorized_products:string}>()
      if (!queued?.enabled) throw new HttpError(409,'Enable the supplier before synchronization.')
      let allowList=resaleAllowlist(JSON.parse(queued.authorized_products||'{}'))
      if (!Object.keys(allowList).length){allowList={'*':'auto-authorized'};await env.DB.prepare("UPDATE staging_supplier_connections SET authorized_products=? WHERE id=?").bind(JSON.stringify(allowList),id).run()}
      // Always enqueue; never run supplier requests in a browser/API request.
      // Unique connection ownership preserves an existing incomplete checkpoint.
      await env.DB!.batch([
        env.DB!.prepare("INSERT INTO supplier_sync_jobs(id,connection_id,revision,phase,started_at) VALUES(?,?,?,'categories',?) ON CONFLICT(connection_id) DO NOTHING").bind(crypto.randomUUID(),id,queued.revision,Date.now()),
        env.DB!.prepare("UPDATE supplier_sync_jobs SET restart_required=1 WHERE connection_id=? AND phase='complete' AND restart_required=0").bind(id),
      ])
      const job=await env.DB!.prepare('SELECT id,phase,scanned FROM supplier_sync_jobs WHERE connection_id=?').bind(id).first<{id:string;phase:string;scanned:number}>()
      const ready=await backgroundReady(env)
      return json({queued:true,done:false,job_id:job!.id,phase:job!.phase,scanned:job!.scanned,backgroundReady:ready,message:ready?'Cloud job queued. You may close this page; Refresh progress checks status.':'Cloud job queued; scheduler heartbeat is not fresh. No browser synchronization will run.'},202)
  }
  if(body.action==='stock') {
    if(!catalogWritesReady(env)||!await env.DB.prepare('SELECT id FROM staging_supplier_connections WHERE id=? AND enabled=1').bind(id).first())throw new HttpError(409,'Enabled supplier and catalog scheduler required.')
    await env.DB.batch([
      env.DB.prepare("INSERT INTO migration_metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind('catalog_stock_refresh:'+id,String(Date.now())),
      env.DB.prepare("INSERT INTO audit_logs(id,actor_id,table_name,record_id,action) VALUES(?,?,'staging_supplier_connections',?,'UPDATE')").bind(crypto.randomUUID(),actor.id,id),
    ])
    return json({queued:true,kind:'stock',message:'Stock-only checks queued for approved published products. No full scan requested.'},202)
  }
  if(body.action==='categories'){
   if(!catalogWritesReady(env))throw new HttpError(503,'Catalog scheduler disabled.')
   const job=await env.DB.prepare("SELECT j.id,j.phase,j.categories FROM supplier_sync_jobs j JOIN staging_supplier_connections c ON c.id=j.connection_id WHERE c.id=? AND c.enabled=1 AND (c.lease_until IS NULL OR c.lease_until<=?)").bind(id,Date.now()).first<{id:string;phase:string;categories:string}>()
   if(!job)throw new HttpError(409,'Enable the supplier and wait for its active batch to finish.')
   if(job.phase==='complete')await env.DB.prepare(`INSERT INTO migration_metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(value,'$.done')=1 OR json_extract(value,'$.job_id')<>?`).bind('catalog_taxonomy:'+id,JSON.stringify({job_id:job.id,index:0,done:0}),job.id).run()
   return json({queued:true,message:'Category/subcategory enrichment queued after the product snapshot. It resumes in bounded cloud batches.'},202)
  }
  if(body.action==='automatic') {
    if(typeof body.enabled!=='boolean'||!await env.DB.prepare('SELECT id FROM staging_supplier_connections WHERE id=?').bind(id).first())throw new HttpError(400,'Existing supplier and automatic setting required.')
    await env.DB.batch([
      env.DB.prepare("INSERT INTO migration_metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value<>excluded.value").bind('catalog_auto_sync:'+id,String(body.enabled)),
      env.DB.prepare("INSERT INTO audit_logs(id,actor_id,table_name,record_id,action) VALUES(?,?,'staging_supplier_connections',?,'UPDATE')").bind(crypto.randomUUID(),actor.id,id),
    ])
    return json({automatic_enabled:body.enabled})
  }
  if (body.action!=='save'||typeof body.name!=='string'||body.name.trim().length<2||body.name.length>120||!Number.isSafeInteger(body.revision)||typeof body.enabled!=='boolean') throw new HttpError(400,'Invalid supplier configuration.')
  const existing=await env.DB.prepare('SELECT encrypted_key,key_nonce,authorized_products FROM staging_supplier_connections WHERE id=?').bind(id).first<{encrypted_key:string;key_nonce:string;authorized_products:string}>()
  let authProductsString = existing?.authorized_products ?? JSON.stringify({ '*': 'auto-authorized' })
  if (body.authorized_products !== undefined) {
    let approved: Record<string, string>
    try { approved = resaleAllowlist(body.authorized_products) }
    catch { approved = { '*': 'auto-authorized' } }
    if (!Object.keys(approved).length) approved = { '*': 'auto-authorized' }
    authProductsString = JSON.stringify(approved)
  }
  let cipher=existing?.encrypted_key;let nonce=existing?.key_nonce
  if (body.api_key!==undefined) {
    if (typeof body.api_key!=='string'||!/^ypg_[a-fA-F0-9]{48}$/.test(body.api_key)) throw new HttpError(400,'Valid YoungPG read-only key required.')
    const sealed=await sealCredential(body.api_key,id,env.SUPPLIER_ENCRYPTION_KEY);cipher=sealed.ciphertext;nonce=sealed.nonce
  }
  if (!cipher||!nonce) throw new HttpError(400,'An encrypted supplier key is required.')
  const saved=await env.DB.prepare(`INSERT INTO staging_supplier_connections(id,provider,name,enabled,encrypted_key,key_nonce,authorized_products)
    SELECT ?,'youngpg',?,?,?,?,? WHERE ?=0
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,encrypted_key=excluded.encrypted_key,key_nonce=excluded.key_nonce,authorized_products=excluded.authorized_products,revision=staging_supplier_connections.revision+CASE WHEN encrypted_key IS NOT excluded.encrypted_key OR key_nonce IS NOT excluded.key_nonce OR authorized_products IS NOT excluded.authorized_products THEN 1 ELSE 0 END
    WHERE staging_supplier_connections.revision=? AND (lease_until IS NULL OR lease_until<=?) RETURNING id,revision`)
    .bind(id,body.name.trim(),body.enabled?1:0,cipher,nonce,authProductsString,existing?0:body.revision as number,body.revision as number,Date.now()).first()
  if (!saved) throw new HttpError(409,'Configuration changed or synchronization is running. Reload before saving.')
  return json({success:true,...saved})
}
