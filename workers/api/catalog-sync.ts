import { categoriesFrom, collection, DESCRIPTION_REQUIRED, identifier, listingsFrom, pageIsComplete, record, resaleAllowlist, subcategoriesFrom, SupplierReadError, YOUNGPG_ORIGIN, youngpgGet } from '../../server/youngpg.ts'
import { openCredential, sealCredential } from '../../server/supplier-crypto.ts'
import { requireRuntime } from './runtime.ts'
import { identity } from './auth.ts'
import { HttpError, json } from './http.ts'
import type { ApiEnv, Statement } from './types.ts'

type Category = ReturnType<typeof categoriesFrom>[number]
type Product = ReturnType<typeof listingsFrom>['products'][number]
interface Connection { id:string; revision:number; encrypted_key:string; key_nonce:string; authorized_products:string }
interface Job { id:string; phase:string; revision:number; page:number; subcategory_index:number; categories:string; started_at:number; scanned:number; total:number|null; last_page:number|null }

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

export async function syncCatalogBatch(env:ApiEnv, connectionId?:string) {
  await requireRuntime(env)
  if ((env.ENVIRONMENT!=='staging'&&!(env.ENVIRONMENT==='production'&&env.PRODUCTION_CUTOVER_ENABLED==='true')) || env.CATALOG_SYNC_ENABLED!=='true' || !env.DB || !env.SUPPLIER_ENCRYPTION_KEY) throw new HttpError(503,'D1 catalog synchronization is not enabled/configured.')
  const db=env.DB; const now=Date.now(); const owner=crypto.randomUUID()
  const c=await db.prepare(`UPDATE staging_supplier_connections SET lease_owner=?,lease_until=?
    WHERE id=(SELECT id FROM staging_supplier_connections WHERE enabled=1 AND (? IS NULL OR id=?)
      AND next_attempt<=? AND (lease_until IS NULL OR lease_until<=?)
      ORDER BY COALESCE(last_verified_scan_at,0),id LIMIT 1)
    RETURNING id,revision,encrypted_key,key_nonce,authorized_products`)
    .bind(owner,now+300000,connectionId??null,connectionId??null,now,now).first<Connection>()
  if (!c) return {done:false,skipped:'busy_or_cooling_down'}
  try {
    const approved=resaleAllowlist(JSON.parse(c.authorized_products))
    if (!Object.keys(approved).length) throw new HttpError(409,'Supplier-wide or product-specific resale authorization reference is required before ingestion.')
    let job=await db.prepare('SELECT * FROM supplier_sync_jobs WHERE connection_id=?').bind(c.id).first<Job>()
    if (!job || job.phase==='complete' || job.revision!==c.revision || now-job.started_at>3600000) {
      const id=crypto.randomUUID()
      await commit(env,c,owner,[
        db.prepare('DELETE FROM supplier_sync_jobs WHERE connection_id=?').bind(c.id),
        db.prepare("INSERT INTO supplier_sync_jobs(id,connection_id,revision,phase,started_at) VALUES(?,?,?,'categories',?)").bind(id,c.id,c.revision,now),
      ])
      job=(await db.prepare('SELECT * FROM supplier_sync_jobs WHERE id=?').bind(id).first<Job>())!
    }
    const key=await openCredential(c.encrypted_key,c.key_nonce,c.id,env.SUPPLIER_ENCRYPTION_KEY)
    let categories=JSON.parse(job.categories) as Category[]
    const statements:Statement[]=[]; let next=job.phase; let page=job.page; let sub=job.subcategory_index; let scanned=job.scanned
    let total=job.total; let last=job.last_page
    const get=(resource:Parameters<typeof youngpgGet>[2],p=1)=>youngpgGet(YOUNGPG_ORIGIN,key,resource,p)
    if (job.phase==='categories') {
      categories=categoriesFrom(await get('categories')); next=categories.length?'subcategories':'listings'
    } else if (job.phase==='subcategories') {
      const category=categories[sub]
      if (!category) throw new HttpError(409,'Category checkpoint is invalid.')
      const children=subcategoriesFrom(await get(`categories/${identifier(category.id)}/subcategories`),category.id)
      statements.push(db.prepare(`INSERT INTO supplier_sync_subcategories(job_id,external_id,parent_id,slug,name)
        SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.parent_id'),json_extract(value,'$.slug'),json_extract(value,'$.name') FROM json_each(?)`)
        .bind(job.id,JSON.stringify(children)))
      sub++; if (sub===categories.length) next='listings'
    } else if (job.phase==='listings') {
      const response=await get('listings',page); const values=collection(response); const meta=record(values.meta)
      const complete=pageIsComplete(response,page,values.rows.length)
      const declaredTotal=Number(meta.total);const declaredLast=Number(meta.last_page)
      if (!Number.isSafeInteger(declaredTotal)||declaredTotal<0||declaredTotal>100000||!Number.isSafeInteger(declaredLast)||declaredLast<1||declaredLast>1000 ||
        (total!==null&&total!==declaredTotal)||(last!==null&&last!==declaredLast)) throw new HttpError(502,'Supplier snapshot pagination changed. Retry a new snapshot.')
      total=declaredTotal;last=declaredLast
      const ids=values.rows.map(v=>identifier(record(v).id)); const mapped=listingsFrom(values.rows,categories,approved)
      categories=mapped.categories;scanned+=ids.length
      if (complete&&scanned!==total) throw new HttpError(502,'Supplier snapshot count mismatch; nothing published.')
      statements.push(db.prepare('INSERT INTO supplier_sync_seen(job_id,external_id) SELECT ?,value FROM json_each(?)').bind(job.id,JSON.stringify(ids)))
      statements.push(db.prepare(`INSERT INTO supplier_sync_items(job_id,external_id,metadata,detail_done)
        SELECT ?,json_extract(value,'$.id'),value,CASE WHEN json_extract(value,'$.slug') IS NULL THEN 1 ELSE 0 END FROM json_each(?)`)
        .bind(job.id,JSON.stringify(mapped.products)))
      if (complete) next='details'; else page++
    } else if (job.phase==='details') {
      const pending=await db.prepare('SELECT external_id,metadata FROM supplier_sync_items WHERE job_id=? AND detail_done=0 ORDER BY external_id LIMIT 1').bind(job.id).first<{external_id:string;metadata:string}>()
      if (!pending) next='finalize'
      else {
        const product=JSON.parse(pending.metadata) as Product
        const detail=record((await get(`listings/${identifier(product.slug)}`)).data)
        if (identifier(detail.id)!==product.id) throw new HttpError(502,'Supplier detail identifier mismatch.')
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
          :db.prepare('DELETE FROM supplier_sync_items WHERE job_id=? AND external_id=?').bind(job.id,pending.external_id))
      }
    } else if (job.phase==='finalize') {
      const check=await db.prepare(`SELECT (SELECT count(*) FROM supplier_sync_seen WHERE job_id=?) scanned,
        (SELECT count(*) FROM supplier_sync_items WHERE job_id=?) eligible,
        (SELECT count(*) FROM supplier_sync_items WHERE job_id=? AND detail_done=0) pending`).bind(job.id,job.id,job.id).first<{scanned:number;eligible:number;pending:number}>()
      if (!check||check.scanned!==total||check.pending||check.eligible>500||now-job.started_at>3600000) throw new HttpError(409,'Complete, current supplier snapshot required; nothing published.')
      statements.push(db.prepare(`INSERT INTO supplier_source_categories(connection_id,kind,external_id,slug,name,snapshot_id)
        SELECT ?,'category',json_extract(value,'$.id'),json_extract(value,'$.slug'),json_extract(value,'$.name'),? FROM json_each(?) WHERE 1
        ON CONFLICT(connection_id,kind,external_id) DO UPDATE SET slug=excluded.slug,name=excluded.name,snapshot_id=excluded.snapshot_id`).bind(c.id,job.id,JSON.stringify(categories)))
      statements.push(db.prepare(`INSERT INTO supplier_source_categories(connection_id,kind,external_id,parent_id,slug,name,snapshot_id)
        SELECT ?,'subcategory',external_id,parent_id,slug,name,? FROM supplier_sync_subcategories WHERE job_id=? AND 1
        ON CONFLICT(connection_id,kind,external_id) DO UPDATE SET parent_id=excluded.parent_id,slug=excluded.slug,name=excluded.name,snapshot_id=excluded.snapshot_id`).bind(c.id,job.id,job.id))
      statements.push(db.prepare(`INSERT INTO staging_supplier_feed_items(connection_id,external_id,name,source_category,supplier_cost_minor,stock_quantity,authorization_verified,evidence_reference,source_checked_at,supplier_description,supplier_image_urls,supplier_category_id,supplier_subcategory_id,snapshot_id)
        SELECT ?,external_id,json_extract(metadata,'$.name'),'permitted_digital_good',json_extract(metadata,'$.cost_minor'),json_extract(metadata,'$.stock'),1,json_extract(metadata,'$.authorization_ref'),?,json_extract(metadata,'$.description'),COALESCE(json_extract(metadata,'$.image_urls'),'[]'),json_extract(metadata,'$.category_id'),json_extract(metadata,'$.subcategory_id'),?
        FROM supplier_sync_items WHERE job_id=? AND 1
        ON CONFLICT(connection_id,external_id) DO UPDATE SET name=excluded.name,supplier_cost_minor=excluded.supplier_cost_minor,
          stock_quantity=CASE WHEN staging_supplier_feed_items.evidence_reference=excluded.evidence_reference THEN excluded.stock_quantity ELSE 0 END,
          source_checked_at=CASE WHEN staging_supplier_feed_items.evidence_reference=excluded.evidence_reference THEN excluded.source_checked_at ELSE staging_supplier_feed_items.source_checked_at END,
          supplier_description=excluded.supplier_description,supplier_image_urls=excluded.supplier_image_urls,
          supplier_category_id=excluded.supplier_category_id,supplier_subcategory_id=excluded.supplier_subcategory_id,snapshot_id=excluded.snapshot_id`)
        .bind(c.id,job.started_at,job.id,job.id))
      statements.push(db.prepare('UPDATE staging_supplier_feed_items SET stock_quantity=0 WHERE connection_id=? AND (snapshot_id IS NULL OR snapshot_id<>?)').bind(c.id,job.id))
      statements.push(db.prepare('INSERT OR IGNORE INTO supplier_snapshots(id,connection_id,revision,started_at,completed_at) VALUES(?,?,?,?,?)').bind(job.id,c.id,c.revision,job.started_at,now))
      statements.push(db.prepare("UPDATE supplier_sync_jobs SET phase='complete',completed_at=? WHERE id=?").bind(now,job.id))
      statements.push(db.prepare('UPDATE staging_supplier_connections SET last_verified_scan_at=? WHERE id=?').bind(now,c.id))
      next='complete'
    } else throw new HttpError(409,'Unsupported catalog checkpoint.')
    if (next!=='complete') statements.push(db.prepare('UPDATE supplier_sync_jobs SET phase=?,page=?,subcategory_index=?,categories=?,scanned=?,total=?,last_page=? WHERE id=?')
      .bind(next,page,sub,JSON.stringify(categories),scanned,total,last,job.id))
    statements.push(db.prepare('UPDATE staging_supplier_connections SET lease_owner=NULL,lease_until=NULL,last_status=?,next_attempt=? WHERE id=? AND lease_owner=?')
      .bind(next==='complete'?'Verified snapshot stored; review required':`Catalog ${next}; ${scanned} scanned`,Date.now()+1500,c.id,owner))
    await commit(env,c,owner,statements)
    return {done:next==='complete',connection_id:c.id,job_id:job.id,phase:next,scanned,publicationEnabled:false}
  } catch(error) {
    const delay=error instanceof SupplierReadError?Math.max(30000,error.retryAfterMs):60000
    // Expiry does not prevent cleanup, but a changed owner always does.
    await db.prepare('UPDATE staging_supplier_connections SET lease_owner=NULL,lease_until=NULL,next_attempt=?,last_status=? WHERE id=? AND lease_owner=?')
      .bind(Date.now()+delay,'Batch failed; checkpoint retained. No publication.',c.id,owner).run()
    if (error instanceof HttpError) throw error
    if (error instanceof SupplierReadError) throw new HttpError(error.status,error.message)
    throw new HttpError(503,'Catalog batch rejected or unavailable; checkpoint retained. No partial snapshot published.')
  }
}

export async function catalogAdmin(request:Request,env:ApiEnv) {
  if (!env.DB) throw new HttpError(503,'D1 unavailable.')
  const actor=await identity(request,env)
  if (actor.role!=='admin') throw new HttpError(403,'Administrator access required.')
  if (request.method==='GET') {
    const result=await env.DB.prepare(`SELECT c.id,c.name,c.enabled,c.revision,c.last_status,c.last_verified_scan_at,
      j.phase,j.page,j.scanned,j.total,
      CASE WHEN json_type(c.authorized_products,'$."*"')='text' THEN 1 ELSE 0 END AS supplier_wide_authorized
      FROM staging_supplier_connections c LEFT JOIN supplier_sync_jobs j ON j.connection_id=c.id ORDER BY c.name`).all()
    return json({suppliers:result.results,publicationEnabled:false})
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
  if (body.action==='sync') return json(await syncCatalogBatch(env,id))
  if (body.action!=='save'||typeof body.name!=='string'||body.name.trim().length<2||body.name.length>120||!Number.isSafeInteger(body.revision)||typeof body.enabled!=='boolean') throw new HttpError(400,'Invalid supplier configuration.')
  const existing=await env.DB.prepare('SELECT encrypted_key,key_nonce,authorized_products FROM staging_supplier_connections WHERE id=?').bind(id).first<{encrypted_key:string;key_nonce:string;authorized_products:string}>()
  let approved:Record<string,string>
  try{approved=resaleAllowlist(body.authorized_products??JSON.parse(existing?.authorized_products??'{}'))}catch{throw new HttpError(400,'Valid supplier-wide or product-specific resale authorization reference required.')}
  let cipher=existing?.encrypted_key;let nonce=existing?.key_nonce
  if (body.api_key!==undefined) {
    if (typeof body.api_key!=='string'||!/^ypg_[a-fA-F0-9]{48}$/.test(body.api_key)) throw new HttpError(400,'Valid YoungPG read-only key required.')
    const sealed=await sealCredential(body.api_key,id,env.SUPPLIER_ENCRYPTION_KEY);cipher=sealed.ciphertext;nonce=sealed.nonce
  }
  if (!cipher||!nonce) throw new HttpError(400,'An encrypted supplier key is required.')
  const saved=await env.DB.prepare(`INSERT INTO staging_supplier_connections(id,provider,name,enabled,encrypted_key,key_nonce,authorized_products)
    SELECT ?,'youngpg',?,?,?,?,? WHERE ?=0
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,encrypted_key=excluded.encrypted_key,key_nonce=excluded.key_nonce,authorized_products=excluded.authorized_products,revision=staging_supplier_connections.revision+1
    WHERE staging_supplier_connections.revision=? AND (lease_until IS NULL OR lease_until<=?) RETURNING id,revision`)
    .bind(id,body.name.trim(),body.enabled?1:0,cipher,nonce,JSON.stringify(approved),existing?0:body.revision as number,body.revision as number,Date.now()).first()
  if (!saved) throw new HttpError(409,'Configuration changed or synchronization is running. Reload before saving.')
  return json({success:true,...saved})
}
