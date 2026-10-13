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
  for(const file of ['0001_staging_foundation.sql','0002_cloudflare_auth.sql','0003_auth_mail_diagnostics.sql','0004_supplier_review.sql','0005_supplier_sync.sql','0006_admin_publication.sql'])sqlite.exec(readFileSync(new URL('../workers/api/migrations/'+file,import.meta.url),'utf8'))
  sqlite.exec(readFileSync(new URL('../workers/api/fixtures.sql',import.meta.url),'utf8'))
  const db={prepare(sql:string){let values:unknown[]=[];const stmt={bind(...args:unknown[]){values=args;return stmt},async all(){return{results:sqlite.prepare(sql).all(...values as never[]),success:true}},async first(){return(await stmt.all()).results[0]??null},async run(){return stmt.all()}};return stmt},async batch(statements:Statement[]){sqlite.exec('BEGIN');try{const rows=[];for(const stmt of statements)rows.push(await stmt.all());sqlite.exec('COMMIT');return rows}catch(error){sqlite.exec('ROLLBACK');throw error}},async exec(sql:string){sqlite.exec(sql)}} as Database
  const env:ApiEnv={ENVIRONMENT:'staging',DB:db,CATALOG_SYNC_ENABLED:'true',SUPPLIER_ENCRYPTION_KEY:btoa('s'.repeat(32))}
  const sealed=await sealCredential('ypg_'+'a'.repeat(48),connection,env.SUPPLIER_ENCRYPTION_KEY)
  sqlite.prepare(`INSERT INTO staging_supplier_connections(id,provider,name,enabled,encrypted_key,key_nonce,authorized_products) VALUES(?,'youngpg','Test licensed supplier',1,?,?,?)`).run(connection,sealed.ciphertext,sealed.nonce,JSON.stringify({'1':'LICENSE-EVIDENCE-1','2':'LICENSE-EVIDENCE-2'}))
  let now=Date.now();t.mock.method(Date,'now',()=>now)
  return{sqlite,env,db,async step(){now+=2000;return syncCatalogBatch(env,connection)},advance(ms:number){now+=ms}}
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
  for(let i=0;i<4;i++)await f.step()
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
  for(let i=0;i<3;i++)await f.step()
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
