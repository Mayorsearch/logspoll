import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { syncCatalogBatch } from '../workers/api/catalog-sync.ts'
import { sealCredential } from '../server/supplier-crypto.ts'
import type { ApiEnv,Database,Statement } from '../workers/api/types.ts'

const connection='50000000-0000-4000-8000-000000000001'
async function fixture(t: TestContext) {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON')
  for(const file of ['0001_staging_foundation.sql','0002_cloudflare_auth.sql','0003_auth_mail_diagnostics.sql','0004_supplier_review.sql','0005_supplier_sync.sql','0006_admin_publication.sql','0007_supplier_wide_authorization.sql','0008_sync_snapshot_retry.sql'])sqlite.exec(readFileSync(new URL('../workers/api/migrations/'+file,import.meta.url),'utf8'))
  sqlite.exec(readFileSync(new URL('../workers/api/fixtures.sql',import.meta.url),'utf8'))
  const db={prepare(sql:string){let values:unknown[]=[];const stmt={bind(...args:unknown[]){values=args;return stmt},async all(){return{results:sqlite.prepare(sql).all(...values as never[]),success:true}},async first(){return(await stmt.all()).results[0]??null},async run(){return stmt.all()}};return stmt},async batch(statements:Statement[]){sqlite.exec('BEGIN');try{const rows=[];for(const stmt of statements)rows.push(await stmt.all());sqlite.exec('COMMIT');return rows}catch(error){sqlite.exec('ROLLBACK');throw error}},async exec(sql:string){sqlite.exec(sql)}} as Database
  const env:ApiEnv={ENVIRONMENT:'staging',DB:db,CATALOG_SYNC_ENABLED:'true',SUPPLIER_ENCRYPTION_KEY:btoa('s'.repeat(32))}
  const sealed=await sealCredential('ypg_'+'a'.repeat(48),connection,env.SUPPLIER_ENCRYPTION_KEY)
  sqlite.prepare(`INSERT INTO staging_supplier_connections(id,provider,name,enabled,encrypted_key,key_nonce,authorized_products) VALUES(?,'youngpg','Test licensed supplier',1,?,?,?)`).run(connection,sealed.ciphertext,sealed.nonce,JSON.stringify({'1':'LICENSE-EVIDENCE-1','2':'LICENSE-EVIDENCE-2'}))
  let now=Date.now();t.mock.method(Date,'now',()=>now)
  return{sqlite,env,db,async step(){now+=6000;return syncCatalogBatch(env,connection)},advance(ms:number){now+=ms}}
}
const listing=(id:string)=>({id,title:'Licensed utility '+id,slug:'utility-'+id,category:{slug:'utilities',title:'Utilities'},price_ngn:'20.05',available_stock:4})
const categories=()=>Response.json({success:true,data:[{id:1,slug:'utilities',title:'Utilities'}]})
const subcategories=()=>Response.json({success:true,data:{category:{id:1},subcategories:[{id:5,slug:'security',title:'Security'}]}})
const page=(p:number,ids:string[])=>Response.json({success:true,data:ids.map(listing),meta:{current_page:p,last_page:2,total:2,per_page:1}})

test('D1 sync resumes failed details, validates the full snapshot and preserves approvals, prices, descriptions and orders',async t=>{
  const f=await fixture(t)
  const baseline=f.sqlite.prepare('SELECT * FROM products').all();const orders=f.sqlite.prepare('SELECT * FROM orders').all()
  const category='20000000-0000-4000-8000-000000000001';const reviewer='10000000-0000-4000-8000-000000000001'
  f.sqlite.prepare(`INSERT INTO staging_supplier_feed_items(connection_id,external_id,name,source_category,supplier_cost_minor,stock_quantity,authorization_verified,evidence_reference,source_checked_at,approval,category_id,selling_price_minor,delivery_type,reviewed_description,reviewed_by,reviewed_at)
    VALUES(?,'1','Existing reviewed product','permitted_digital_good',1000,2,1,'LICENSE-EVIDENCE-1',?,'approved',?,7777,'Manual fulfillment','Administrator verified description, unchanged.',?,?)`).run(connection,Date.now(),category,reviewer,Date.now())
  f.sqlite.prepare(`INSERT INTO staging_supplier_feed_items(connection_id,external_id,name,supplier_cost_minor,stock_quantity,source_checked_at) VALUES(?,'missing','Legacy pending',200,9,?)`).run(connection,Date.now())
  let fail=true
  t.mock.method(globalThis,'fetch',async input=>{
    const u=new URL(String(input))
    if(u.pathname.endsWith('/subcategories'))return subcategories()
    if(u.pathname.endsWith('/categories'))return categories()
    if(u.pathname.endsWith('/listings'))return page(Number(u.searchParams.get('page')),u.searchParams.get('page')==='1'?['1']:['2'])
    if(fail)throw new TypeError('secret supplier response must never escape')
    return Response.json({success:true,data:{id:u.pathname.endsWith('utility-1')?'1':'2',description:'Verified public licensed utility description.',image_url:'https://cdn.example.test/product.png',price_ngn:'0.01',available_stock:999}})
  })
  for(let i=0;i<3;i++)await f.step()
  assert.equal(f.sqlite.prepare("SELECT supplier_cost_minor FROM staging_supplier_feed_items WHERE external_id='1'").get()!.supplier_cost_minor,1000)
  await assert.rejects(f.step(),error=>error instanceof Error&&!error.message.includes('secret supplier response'))
  assert.equal(f.sqlite.prepare('SELECT phase FROM supplier_sync_jobs').get()!.phase,'details')
  fail=false;f.advance(60000)
  for(let i=0;i<4;i++)await f.step()
  assert.equal(f.sqlite.prepare('SELECT phase FROM supplier_sync_jobs').get()!.phase,'complete')
  const approved=f.sqlite.prepare("SELECT * FROM staging_supplier_feed_items WHERE external_id='1'").get()!
  assert.equal(approved.approval,'approved');assert.equal(approved.selling_price_minor,7777)
  assert.equal(approved.reviewed_description,'Administrator verified description, unchanged.')
  assert.equal(approved.supplier_cost_minor,2005);assert.equal(approved.stock_quantity,4)
  assert.equal(JSON.parse(approved.supplier_image_urls as string).length,1)
  assert.equal(f.sqlite.prepare("SELECT approval FROM staging_supplier_feed_items WHERE external_id='2'").get()!.approval,'pending')
  const missing=f.sqlite.prepare("SELECT approval,stock_quantity FROM staging_supplier_feed_items WHERE external_id='missing'").get()!
  assert.equal(missing.approval,'pending');assert.equal(missing.stock_quantity,0)
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM products').all(),baseline);assert.deepEqual(f.sqlite.prepare('SELECT * FROM orders').all(),orders)
  assert.equal(f.sqlite.prepare('PRAGMA foreign_key_check').all().length,0)
})
test('duplicate listing IDs abort the batch without partial imports or checkpoint advancement',async t=>{
  const f=await fixture(t)
  t.mock.method(globalThis,'fetch',async input=>{const u=new URL(String(input));if(u.pathname.endsWith('/subcategories'))return subcategories();if(u.pathname.endsWith('/categories'))return categories();return page(Number(u.searchParams.get('page')),['1'])})
  for(let i=0;i<2;i++)await f.step()
  await assert.rejects(f.step(),/checkpoint retained/)
  assert.equal(f.sqlite.prepare('SELECT page FROM supplier_sync_jobs').get()!.page,2)
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM staging_supplier_feed_items').get()!.n,0)
})
test('an expired or stolen lease cannot commit and failure cleanup cannot clear a new owner',async t=>{
  const f=await fixture(t)
  t.mock.method(globalThis,'fetch',async()=>{f.sqlite.prepare("UPDATE staging_supplier_connections SET lease_owner='new-owner',lease_until=?").run(Date.now()+300000);return categories()})
  await assert.rejects(f.step(),/checkpoint retained/)
  assert.equal(f.sqlite.prepare('SELECT lease_owner FROM staging_supplier_connections').get()!.lease_owner,'new-owner')
  assert.equal(f.sqlite.prepare('SELECT phase FROM supplier_sync_jobs').get()!.phase,'categories')
  assert.equal((await f.step()).skipped,'busy_or_cooling_down')
})


test('D1 catalog skips optional supplier subcategory calls and resumes older checkpoints', async t => {
  const f=await fixture(t)
  const paths:string[]=[]
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(String(input))
    paths.push(url.pathname)
    if(url.pathname.endsWith('/categories'))return categories()
    if(url.pathname.endsWith('/subcategories'))throw new Error('Unexpected subcategory request')
    throw new Error('Unexpected API route')
  })
  await f.step()
  assert.equal(f.sqlite.prepare('SELECT phase FROM supplier_sync_jobs').get()!.phase,'listings')
  assert.equal(paths.length,1)
  f.sqlite.prepare("UPDATE supplier_sync_jobs SET phase='subcategories',subcategory_index=0").run()
  await f.step()
  assert.equal(f.sqlite.prepare('SELECT phase FROM supplier_sync_jobs').get()!.phase,'listings')
  assert.equal(paths.length,1) // resumed without a network request
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM supplier_sync_jobs').get()!.n,1)
})

test('listing failures persist redacted phase diagnostics, retain checkpoints and respect Retry-After',async t=>{
  const f=await fixture(t)
  t.mock.method(globalThis,'fetch',async input=>String(input).endsWith('/categories')?categories():Response.json({}, {status:429,headers:{'Retry-After':'120'}}))
  await f.step()
  await assert.rejects(f.step(),/Listing page 1: supplier rate limit/)
  const job=f.sqlite.prepare('SELECT phase,page,scanned FROM supplier_sync_jobs').get()!
  assert.equal(job.phase,'listings');assert.equal(job.page,1);assert.equal(job.scanned,0)
  const c=f.sqlite.prepare('SELECT last_status,next_attempt,lease_owner FROM staging_supplier_connections').get()!
  assert.match(String(c.last_status),/listings page 1: HTTP 429/)
  assert.doesNotMatch(String(c.last_status),/ypg_|encrypted_key/)
  assert.equal(c.next_attempt,Date.now()+120000);assert.equal(c.lease_owner,null)
  assert.equal(f.sqlite.prepare('SELECT restart_required FROM supplier_sync_jobs').get()!.restart_required,0)
  f.advance(60000);assert.equal((await f.step()).skipped,'busy_or_cooling_down')
})

test('scheduled synchronization resumes four bounded resources with pacing and a D1 heartbeat',async t=>{
 const f=await fixture(t);const {default:worker}=await import('../workers/api/index.ts')
 let reads=0
 t.mock.method(globalThis,'fetch',async input=>{reads++;const u=new URL(String(input));if(u.pathname.endsWith('/categories'))return categories();if(u.pathname.endsWith('/listings'))return page(Number(u.searchParams.get('page')),u.searchParams.get('page')==='1'?['1']:['2']);return Response.json({success:true,data:{id:'1',description:'A licensed resource with public metadata.'}})})
 t.mock.method(globalThis,'setTimeout',((callback:()=>void,ms:number)=>{assert.equal(ms,5500);f.advance(ms);callback();return 0}) as typeof setTimeout)
 const tasks:Promise<unknown>[]=[]
 worker.scheduled(null,f.env,{waitUntil(p){tasks.push(p)}});await Promise.all(tasks)
 assert.equal(reads,4)
 const job=f.sqlite.prepare('SELECT phase,scanned FROM supplier_sync_jobs').get()!
 assert.equal(job.phase,'details');assert.equal(job.scanned,2)
 assert.ok(f.sqlite.prepare("SELECT value FROM migration_metadata WHERE key='catalog_scheduler_heartbeat'").get())
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM staging_supplier_feed_items').get()!.n,0)
})

test('changed supplier totals restart only the invalid private snapshot after cooldown; transient failures do not',async t=>{
 const f=await fixture(t)
 t.mock.method(globalThis,'fetch',async input=>{const u=new URL(String(input));if(u.pathname.endsWith('/categories'))return categories();const p=Number(u.searchParams.get('page'));return Response.json({success:true,data:[listing(String(p))],meta:{current_page:p,last_page:p===1?2:3,total:p===1?2:3}})})
 const before=f.sqlite.prepare('SELECT * FROM products').all()
 await f.step();await f.step()
 const old=f.sqlite.prepare('SELECT id FROM supplier_sync_jobs').get()!.id
 await assert.rejects(f.step(),/snapshot changed/)
 const held=f.sqlite.prepare('SELECT page,scanned,restart_required FROM supplier_sync_jobs').get()!
 assert.equal(held.page,2);assert.equal(held.scanned,1);assert.equal(held.restart_required,1)
 assert.equal((await f.step()).skipped,'busy_or_cooling_down')
 f.advance(60000);await f.step()
 const fresh=f.sqlite.prepare('SELECT id,page,scanned,restart_required FROM supplier_sync_jobs').get()!
 assert.notEqual(fresh.id,old);assert.equal(fresh.page,1);assert.equal(fresh.scanned,0);assert.equal(fresh.restart_required,0)
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM products').all(),before)
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM staging_supplier_feed_items').get()!.n,0)
})

test('scheduler skips fresh completed snapshots but resumes incomplete checkpoints despite recent success',async t=>{
 const f=await fixture(t);const {default:worker}=await import('../workers/api/index.ts')
 const completed=Date.now()
 f.sqlite.prepare('UPDATE staging_supplier_connections SET last_verified_scan_at=?').run(completed)
 f.sqlite.prepare("INSERT INTO supplier_sync_jobs(id,connection_id,revision,phase,started_at,completed_at,categories,scanned,total,last_page) VALUES('held',?,1,'complete',?,?,?,0,0,1)").run(connection,completed,completed,JSON.stringify([{id:'1',slug:'utilities',name:'Utilities'}]))
 f.sqlite.prepare('INSERT INTO migration_metadata(key,value) VALUES(?,?)').run('catalog_taxonomy:'+connection,JSON.stringify({job_id:'held',index:1,done:1}))
 let reads=0
 t.mock.method(globalThis,'fetch',async()=>{reads++;return Response.json({success:true,data:[],meta:{current_page:1,last_page:1,total:0}})})
 t.mock.method(globalThis,'setTimeout',((callback:()=>void,ms:number)=>{f.advance(ms);callback();return 0}) as typeof setTimeout)
 const tick=async()=>{const tasks:Promise<unknown>[]=[];worker.scheduled(null,f.env,{waitUntil(p){tasks.push(p)}});await Promise.all(tasks)}
 const held=f.sqlite.prepare('SELECT * FROM supplier_sync_jobs').get()
 await tick();f.advance(12*60*60*1000-1);await tick()
 assert.equal(reads,0);assert.deepEqual(f.sqlite.prepare('SELECT * FROM supplier_sync_jobs').get(),held)
 assert.equal(f.sqlite.prepare('SELECT lease_owner FROM staging_supplier_connections').get()!.lease_owner,null)
 // An incomplete job must resume, rather than wait for the last success interval.
 f.sqlite.prepare("UPDATE supplier_sync_jobs SET phase='listings',completed_at=NULL,started_at=?").run(Date.now())
 await tick()
 const resumed=f.sqlite.prepare('SELECT id,phase FROM supplier_sync_jobs').get()!
 assert.equal(reads,1);assert.equal(resumed.id,'held');assert.equal(resumed.phase,'complete')
})

test('automatic starts allow the exact 12-hour boundary; explicit refresh still honors cooldowns and leases',async t=>{
 const f=await fixture(t);const completed=Date.now()
 f.sqlite.prepare('UPDATE staging_supplier_connections SET last_verified_scan_at=?').run(completed)
 f.sqlite.prepare("INSERT INTO supplier_sync_jobs(id,connection_id,revision,phase,started_at,completed_at) VALUES('held',?,1,'complete',?,?)").run(connection,completed,completed)
 t.mock.method(globalThis,'fetch',async()=>categories())
 assert.equal((await syncCatalogBatch(f.env)).skipped,'busy_or_cooling_down')
 f.sqlite.prepare('UPDATE staging_supplier_connections SET next_attempt=?').run(Date.now()+1000)
 assert.equal((await syncCatalogBatch(f.env,connection)).skipped,'busy_or_cooling_down')
 f.sqlite.prepare('UPDATE staging_supplier_connections SET next_attempt=0,lease_owner=?,lease_until=?').run('other-owner',Date.now()+1000)
 assert.equal((await syncCatalogBatch(f.env,connection)).skipped,'busy_or_cooling_down')
 f.sqlite.prepare('UPDATE staging_supplier_connections SET lease_owner=NULL,lease_until=NULL').run()
 assert.equal((await syncCatalogBatch(f.env,connection)).phase,'listings')
 // Simulate another successful completed scan, retaining the same test checkpoint.
 f.sqlite.prepare("UPDATE supplier_sync_jobs SET phase='complete'").run()
 f.sqlite.prepare('UPDATE staging_supplier_connections SET next_attempt=0,last_verified_scan_at=?').run(completed)
 f.advance(12*60*60*1000)
 assert.equal((await syncCatalogBatch(f.env)).phase,'listings')
})

test('private discovery retains restricted categories without approving them; safe categories map once',async t=>{
 const f=await fixture(t)
 t.mock.method(globalThis,'fetch',async input=>{
  const u=new URL(String(input))
  if(u.pathname.endsWith('/categories'))return categories()
  if(u.pathname.endsWith('/listings'))return Response.json({success:true,data:[listing('1'),{...listing('restricted'),title:'Instagram account',category:{slug:'instagram',title:'Instagram'},subcategory:{id:'s1',slug:'aged',title:'Aged'},password:'NEVER-COPY',fulfillment:{secret:'NEVER-COPY'}}],meta:{current_page:1,last_page:1,total:2}})
  return Response.json({success:true,data:{id:'1',description:'Verified licensed utility with full public details.'}})
 })
 for(let i=0;i<5;i++)await f.step()
 assert.equal(f.sqlite.prepare('SELECT phase FROM supplier_sync_jobs').get()!.phase,'complete')
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM supplier_sync_items').get()!.n,2)
 const blocked=f.sqlite.prepare("SELECT metadata FROM supplier_sync_items WHERE external_id='restricted'").get()!.metadata as string
 assert.match(blocked,/Configure supplier-wide/);assert.doesNotMatch(blocked,/NEVER-COPY|fulfillment|password/)
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM staging_supplier_feed_items').get()!.n,1)
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM supplier_source_categories WHERE slug='instagram'").get()!.n,1)
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM supplier_source_categories WHERE kind='subcategory'").get()!.n,1)
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM categories WHERE slug='ypg-utilities'").get()!.n,1)
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM categories WHERE slug='ypg-instagram'").get()!.n,0)
 assert.ok(f.sqlite.prepare("SELECT category_id FROM staging_supplier_feed_items WHERE external_id='1'").get()!.category_id)
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM storefront_products WHERE slug LIKE ?').get('ypg-%')!.n,0)
 const {categoryMappingStatements}=await import('../workers/api/catalog-sync.ts')
 const counts=f.sqlite.prepare('SELECT count(*) n FROM categories').get()!.n
 await f.db.batch(categoryMappingStatements(f.db,connection,[{id:'1',slug:'utilities',name:'Utilities'}]))
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM categories').get()!.n,counts)
 assert.equal(f.sqlite.prepare('SELECT changes() n').get()!.n,0)
})

test('published stock refresh is bounded, preserves overrides/descriptions and never extends stale stock on errors',async t=>{
 const f=await fixture(t)
 t.mock.method(globalThis,'fetch',async input=>{
  const u=new URL(String(input))
  if(u.pathname.endsWith('/categories'))return categories()
  if(u.pathname.endsWith('/listings'))return Response.json({success:true,data:[listing('1')],meta:{current_page:1,last_page:1,total:1}})
  return Response.json({success:true,data:{id:'1',description:'Licensed public utility with verified delivery.',price_ngn:'30.05',available_stock:7}})
 })
 for(let i=0;i<5;i++)await f.step()
 const product='60000000-0000-4000-8000-000000000001'
 f.sqlite.prepare("UPDATE staging_supplier_feed_items SET approval='approved',selling_price_minor=8888,delivery_type='Redemption code',reviewed_description='Admin description must survive.',reviewed_by='10000000-0000-4000-8000-000000000001',reviewed_at=? WHERE external_id='1'").run(Date.now())
 f.sqlite.prepare(`INSERT INTO products(id,category_id,slug,name,description,price_minor,supplier_name,authorized_resale,status,delivery_type,publication_verified,pricing_mode) SELECT ?,category_id,'published-test',name,'Admin description must survive.',8888,'YoungPG',1,'active','Redemption code',1,'override' FROM staging_supplier_feed_items WHERE external_id='1'`).run(product)
 f.sqlite.prepare("INSERT INTO supplier_products VALUES(?,'1',?)").run(connection,product)
 const {refreshPublishedStock}=await import('../workers/api/catalog-sync.ts')
 const snapshot=f.sqlite.prepare("SELECT metadata FROM supplier_sync_items WHERE external_id='1'").get()!.metadata as string
 f.advance(31*60*1000)
 f.sqlite.prepare("UPDATE supplier_sync_items SET metadata=json_remove(metadata,'$.authorization_ref') WHERE external_id='1'").run()
 assert.equal((await refreshPublishedStock(f.env)).skipped,true)
 f.sqlite.prepare("UPDATE supplier_sync_items SET metadata=json_set(?,'$.review_block','Independent delivery review required') WHERE external_id='1'").run(snapshot)
 assert.equal((await refreshPublishedStock(f.env)).skipped,true)
 f.sqlite.prepare("UPDATE supplier_sync_items SET metadata=? WHERE external_id='1'").run(snapshot)
 f.advance(31*60*1000)
 assert.equal((await refreshPublishedStock(f.env)).skipped,false)
 const feed=f.sqlite.prepare("SELECT supplier_cost_minor,stock_quantity,source_checked_at FROM staging_supplier_feed_items WHERE external_id='1'").get()!
 assert.equal(feed.supplier_cost_minor,3005);assert.equal(feed.stock_quantity,7);assert.equal(feed.source_checked_at,Date.now())
 const p=f.sqlite.prepare('SELECT price_minor,description FROM products WHERE id=?').get(product)!
 assert.equal(p.price_minor,8888);assert.equal(p.description,'Admin description must survive.')
 f.advance(31*60*1000)
 t.mock.method(globalThis,'fetch',async()=>Response.json({}, {status:429,headers:{'Retry-After':'120'}}))
 assert.equal((await refreshPublishedStock(f.env)).skipped,true)
 assert.equal(f.sqlite.prepare("SELECT source_checked_at FROM staging_supplier_feed_items WHERE external_id='1'").get()!.source_checked_at,feed.source_checked_at)
 assert.equal(f.sqlite.prepare('SELECT next_attempt FROM staging_supplier_connections').get()!.next_attempt,Date.now()+120000)
})

test('quota hold performs no catalog database operations, preserves checkpoints and expires at the exact UTC boundary',async t=>{
 const f=await fixture(t)
 const {catalogWritesReady,refreshPublishedStock}=await import('../workers/api/catalog-sync.ts')
 const resume=Date.now()+60000;f.env.CATALOG_RESUME_AT=new Date(resume).toISOString()
 const held=f.sqlite.prepare('SELECT * FROM staging_supplier_connections').get()
 const prepare=t.mock.method(f.db,'prepare',()=>{throw new Error('Catalog must not touch D1 during quota hold')})
 assert.equal(catalogWritesReady(f.env),false)
 assert.equal((await syncCatalogBatch(f.env,connection)).skipped,'quota_reset_pending')
 assert.equal((await refreshPublishedStock(f.env)).skipped,true)
 assert.equal(prepare.mock.callCount(),0)
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM staging_supplier_connections').get(),held)
 f.advance(60000);assert.equal(catalogWritesReady(f.env),true)
 f.env.CATALOG_RESUME_AT='invalid';assert.equal(catalogWritesReady(f.env),false)
 f.env.CATALOG_RESUME_AT=undefined;f.env.CATALOG_SYNC_ENABLED='false';assert.equal(catalogWritesReady(f.env),false)
})

test('held catalog scheduler leaves its heartbeat untouched and starts no supplier requests',async t=>{
 const f=await fixture(t),{default:worker}=await import('../workers/api/index.ts')
 f.env.CATALOG_RESUME_AT=new Date(Date.now()+60000).toISOString()
 const fetch=t.mock.method(globalThis,'fetch',async()=>{throw new Error('No supplier requests during quota hold')})
 const tasks:Promise<unknown>[]=[];worker.scheduled(null,f.env,{waitUntil(p){tasks.push(p)}});await Promise.all(tasks)
 assert.equal(fetch.mock.callCount(),0)
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM migration_metadata WHERE key='catalog_scheduler_heartbeat'").get()!.n,0)
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM supplier_sync_jobs').get()!.n,0)
})

test('supplier omission cannot erase saved images or useful descriptions',async t=>{
 const f=await fixture(t)
 f.sqlite.prepare(`INSERT INTO staging_supplier_feed_items(connection_id,external_id,name,supplier_cost_minor,stock_quantity,authorization_verified,evidence_reference,source_checked_at,supplier_description,supplier_image_urls)
 VALUES(?,'1','Licensed utility',1000,1,1,'LICENSE-EVIDENCE-1',?,'Previously verified supplier details.',?)`).run(connection,Date.now(),JSON.stringify(['https://cdn.example.com/saved.png']))
 t.mock.method(globalThis,'fetch',async input=>{
  const url=new URL(String(input))
  if(url.pathname.endsWith('/categories'))return categories()
  if(url.pathname.endsWith('/listings'))return Response.json({success:true,data:[listing('1')],meta:{current_page:1,last_page:1,total:1}})
  return Response.json({success:true,data:{id:'1'}})
 })
 for(let i=0;i<5;i++)await f.step()
 assert.equal(f.sqlite.prepare('SELECT phase FROM supplier_sync_jobs').get()!.phase,'complete')
 const row=f.sqlite.prepare('SELECT supplier_description,supplier_image_urls,supplier_cost_minor FROM staging_supplier_feed_items').get()!
 assert.equal(row.supplier_description,'Previously verified supplier details.')
 assert.deepEqual(JSON.parse(String(row.supplier_image_urls)),['https://cdn.example.com/saved.png'])
 assert.equal(row.supplier_cost_minor,2005)
})

test('automatic full-scan pause still resumes an incomplete job',async t=>{
 const f=await fixture(t)
 f.sqlite.prepare("INSERT INTO migration_metadata(key,value) VALUES(?,'false')").run('catalog_auto_sync:'+connection)
 t.mock.method(globalThis,'fetch',async input=>String(input).endsWith('/categories')?categories():page(1,['1']))
 assert.equal((await syncCatalogBatch(f.env)).skipped,'busy_or_cooling_down')
 await f.step() // Explicit admin job remains permitted.
 f.advance(6000)
 const resumed=await syncCatalogBatch(f.env)
 assert.notEqual(resumed.skipped,'busy_or_cooling_down')
})

test('subcategory enrichment is independently checkpointed, bounded and rate-limit-aware without restarting product scans',async t=>{
 const f=await fixture(t),{refreshSupplierTaxonomy}=await import('../workers/api/catalog-sync.ts')
 f.sqlite.prepare("INSERT INTO supplier_sync_jobs(id,connection_id,revision,phase,started_at,completed_at,categories) VALUES('complete-products',?,1,'complete',?,?,?)").run(connection,Date.now(),Date.now(),JSON.stringify([{id:'1',name:'Utilities',slug:'utilities'}]))
 const products=f.sqlite.prepare('SELECT * FROM products').all(),job=f.sqlite.prepare('SELECT * FROM supplier_sync_jobs').get()
 let limited=false
 const calls=t.mock.method(globalThis,'fetch',async input=>{assert.match(String(input),/categories\/1\/subcategories$/);return limited?Response.json({},{status:429,headers:{'Retry-After':'120'}}):subcategories()})
 assert.equal((await refreshSupplierTaxonomy(f.env)).skipped,false)
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM supplier_source_categories WHERE kind='subcategory'").get()!.n,1)
 f.advance(6000);assert.equal((await refreshSupplierTaxonomy(f.env)).skipped,true);assert.equal(calls.mock.callCount(),1)
 f.sqlite.prepare('UPDATE migration_metadata SET value=? WHERE key=?').run(JSON.stringify({job_id:'complete-products',index:0,done:0}),'catalog_taxonomy:'+connection)
 const cursor=f.sqlite.prepare('SELECT value FROM migration_metadata').get()!.value
 limited=true;assert.equal((await refreshSupplierTaxonomy(f.env)).skipped,true)
 assert.equal(f.sqlite.prepare('SELECT next_attempt FROM staging_supplier_connections').get()!.next_attempt,Date.now()+120000)
 assert.equal(f.sqlite.prepare('SELECT value FROM migration_metadata').get()!.value,cursor)
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM supplier_sync_jobs').get(),job)
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM products').all(),products)
})
