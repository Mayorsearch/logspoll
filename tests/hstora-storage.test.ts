import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {sealCredential,openCredential} from '../server/supplier-crypto.ts'
import {syncHstoraBatch} from '../workers/api/hstora-manager.ts'
import type {Database,Statement,ApiEnv} from '../workers/api/types.ts'
function setup(){
 const sqlite=new DatabaseSync(':memory:');
 for(const file of ['0001_staging_foundation.sql','0002_cloudflare_auth.sql','0003_auth_mail_diagnostics.sql','0004_supplier_review.sql','0005_supplier_sync.sql','0006_admin_publication.sql','0007_supplier_wide_authorization.sql','0008_sync_snapshot_retry.sql','0009_auth_email_otp.sql'])sqlite.exec(readFileSync(new URL('../workers/api/migrations/'+file,import.meta.url),'utf8'));
 sqlite.exec(readFileSync(new URL('../workers/api/migrations/0011_hstora_catalog.sql',import.meta.url),'utf8'))
 const db={prepare(sql:string){let args:unknown[]=[];const s={bind(...values:unknown[]){args=values;return s},async all(){return {results:sqlite.prepare(sql).all(...args as never[]),success:true}},async first(){return (await s.all()).results[0]??null},async run(){return s.all()}};return s},async batch(statements:Statement[]){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results}catch(error){sqlite.exec('ROLLBACK');throw error}},async exec(sql:string){sqlite.exec(sql)}} as Database
 const env:ApiEnv={ENVIRONMENT:'staging',DB:db,CATALOG_SYNC_ENABLED:'true',SUPPLIER_ENCRYPTION_KEY:btoa('x'.repeat(32))};return {sqlite,env}
}
test('encrypted credentials bind to supplier and disabled supplier performs no fetch',async()=>{
 const {sqlite,env}=setup(),sealed=await sealCredential('{"key":"private"}','hstora',env.SUPPLIER_ENCRYPTION_KEY)
 assert.equal(await openCredential(sealed.ciphertext,sealed.nonce,'hstora',env.SUPPLIER_ENCRYPTION_KEY),'{"key":"private"}')
 await assert.rejects(openCredential(sealed.ciphertext,sealed.nonce,'youngpg',env.SUPPLIER_ENCRYPTION_KEY))
 sqlite.prepare("INSERT INTO hstora_connection(id,ciphertext,nonce,requested) VALUES('hstora',?,?,1)").run(sealed.ciphertext,sealed.nonce)
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Must not fetch')};try{await syncHstoraBatch(env);assert.equal(sqlite.prepare('SELECT lease_owner FROM hstora_connection').get()!.lease_owner,null)}finally{globalThis.fetch=old}
})
test('bounded checkpoint resumes and publishes only a complete private snapshot, preserving edits',async()=>{
 const {sqlite,env}=setup(),sealed=await sealCredential(JSON.stringify({key:'hs_pk_test',secret:'hs_sk_test'}),'hstora',env.SUPPLIER_ENCRYPTION_KEY)
 sqlite.prepare("INSERT INTO hstora_connection(id,ciphertext,nonce,enabled,requested) VALUES('hstora',?,?,1,1)").run(sealed.ciphertext,sealed.nonce)
 const product={id:1,name:'VPN subscription',description:'Genuine supplier description',price:2,currency:'USD',stock_available:9}
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async input=>{calls++;return Response.json({success:true,data:String(input).includes('/catalog?')?{items:[product],pagination:{page:1,limit:25,total:1,pages:1}}:product})}
 try{
  await syncHstoraBatch(env);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM hstora_catalog_items').get()!.n,0)
  await syncHstoraBatch(env);await syncHstoraBatch(env);await syncHstoraBatch(env)
  const row=sqlite.prepare('SELECT * FROM hstora_catalog_items').get()!;assert.equal(row.storefront_category,'server1');assert.equal(row.approval_status,'pending');assert.equal(row.published,0)
  sqlite.exec("UPDATE hstora_catalog_items SET selling_price_minor=1200,manual_description='Admin edit';UPDATE hstora_connection SET requested=1")
  for(let i=0;i<4;i++)await syncHstoraBatch(env)
  const edited=sqlite.prepare('SELECT * FROM hstora_catalog_items').get()!;assert.equal(edited.selling_price_minor,1200);assert.equal(edited.manual_description,'Admin edit')
  const before=calls;await syncHstoraBatch(env);assert.equal(calls,before)
 }finally{globalThis.fetch=old}
})

test('snapshot finalization handles deduplicated pagination drift without blocking publication',async()=>{
 const {sqlite,env}=setup(),sealed=await sealCredential(JSON.stringify({key:'hs_pk_test',secret:'hs_sk_test'}),'hstora',env.SUPPLIER_ENCRYPTION_KEY)
 sqlite.prepare("INSERT INTO hstora_connection(id,ciphertext,nonce,enabled,phase,job_id,page,total,scanned) VALUES('hstora',?,?,1,'finalize','drift-job-1',128,3169,3169)").run(sealed.ciphertext,sealed.nonce)
 for(let i=1;i<=3148;i++){
   sqlite.prepare("INSERT INTO hstora_snapshot_items(job_id,external_id,metadata,detail_done) VALUES('drift-job-1',?,?,1)")
     .run(String(i),JSON.stringify({id:String(i),name:'Item '+i,price:'0.50',currency:'USD',stock:10,description:'Valid description',stock_checked_at:Date.now()}))
 }
 await syncHstoraBatch(env)
 const count=sqlite.prepare("SELECT count(*) n FROM hstora_catalog_items").get()!.n
 assert.equal(count,3148)
 const conn=sqlite.prepare("SELECT phase,last_status FROM hstora_connection WHERE id='hstora'").get()!
 assert.equal(conn.phase,'complete')
 assert.match(conn.last_status,/3148 products imported/)
})

async function stockFixture(now:number){
 const ctx=setup(),sealed=await sealCredential(JSON.stringify({key:'hs_pk_test',secret:'hs_sk_test'}),'hstora',ctx.env.SUPPLIER_ENCRYPTION_KEY)
 ctx.sqlite.prepare("INSERT INTO hstora_connection(id,ciphertext,nonce,enabled,last_success) VALUES('hstora',?,?,1,?)").run(sealed.ciphertext,sealed.nonce,now)
 for(const id of ['1','2'])ctx.sqlite.prepare("INSERT INTO hstora_catalog_items(external_id,metadata,snapshot_id,checked_at,approval_status,selling_price_minor,manual_description) VALUES(?,?,'old',?,'approved',7000,'Admin description')").run(id,JSON.stringify({id,name:'Verified VPN subscription',stock:29,price:'2',currency:'USD',description:'Original licensed subscription description',images:[]}),now-90000000)
 return ctx
}
test('deleted HStora detail cannot block valid stock refresh or change manual prices',async t=>{
 const now=Date.now(),{sqlite,env}=await stockFixture(now)
 t.mock.method(globalThis,'fetch',async input=>String(input).endsWith('/1')?Response.json({error:{code:'product_unavailable'}},{status:404}):Response.json({success:true,data:{id:2,name:'Verified VPN subscription',description:'Current licensed subscription description',price:'3',currency:'USD',stock_available:37}}))
 await syncHstoraBatch(env)
 const gone=sqlite.prepare("SELECT * FROM hstora_catalog_items WHERE external_id='1'").get()!,live=sqlite.prepare("SELECT * FROM hstora_catalog_items WHERE external_id='2'").get()!
 assert.equal(JSON.parse(gone.metadata as string).supplier_available,false)
 assert.equal(JSON.parse(gone.metadata as string).stock,0)
 assert.equal(JSON.parse(live.metadata as string).stock,37)
 assert.ok(Number(live.checked_at)>=now)
 for(const row of [gone,live]){assert.equal(row.selling_price_minor,7000);assert.equal(row.manual_description,'Admin description')}
 assert.equal(sqlite.prepare('SELECT lease_owner FROM hstora_connection').get()!.lease_owner,null)
})
test('provider rejection retains failed stock timestamp while committing independently verified peers',async t=>{
 const now=Date.now(),{sqlite,env}=await stockFixture(now)
 t.mock.method(globalThis,'fetch',async input=>String(input).endsWith('/1')?new Response('gateway denial',{status:403}):Response.json({success:true,data:{id:2,name:'Verified VPN subscription',description:'Current licensed subscription description',price:'3',currency:'USD',stock_available:37}}))
 await syncHstoraBatch(env)
 const failed=sqlite.prepare("SELECT * FROM hstora_catalog_items WHERE external_id='1'").get()!,live=sqlite.prepare("SELECT * FROM hstora_catalog_items WHERE external_id='2'").get()!
 assert.equal(failed.checked_at,now-90000000);assert.equal(JSON.parse(failed.metadata as string).stock,29)
 assert.equal(JSON.parse(live.metadata as string).stock,37)
 const connection=sqlite.prepare('SELECT next_attempt,last_status,lease_owner FROM hstora_connection').get()!
 assert.ok(Number(connection.next_attempt)>=now+600000);assert.match(String(connection.last_status),/403/);assert.equal(connection.lease_owner,null)
})
test('due stock refresh cannot starve an incomplete full-catalog snapshot',async t=>{
 const now=Math.floor(Date.now()/120000)*120000+60000,{sqlite,env}=await stockFixture(now),paths:string[]=[]
 t.mock.method(Date,'now',()=>now)
 sqlite.exec("UPDATE hstora_connection SET phase='listings',job_id='active-job',page=1,total=1")
 t.mock.method(globalThis,'fetch',async input=>{paths.push(String(input));return Response.json({success:true,data:{items:[{id:2,name:'Verified VPN subscription',description:'Current licensed subscription description',price:'3',currency:'USD',stock_available:37}],pagination:{page:1,limit:25,total:1,pages:1}}})})
 await syncHstoraBatch(env)
 assert.equal(paths.length,1);assert.match(paths[0],/\/catalog\?/)
 assert.equal(sqlite.prepare('SELECT phase FROM hstora_connection').get()!.phase,'finalize')
})

test('changing catalog totals retain job identity, checkpoints and deduplicated products',async t=>{
 const now=Math.floor(Date.now()/120000)*120000+60000,{sqlite,env}=await stockFixture(now)
 t.mock.method(Date,'now',()=>now)
 sqlite.exec("UPDATE hstora_connection SET phase='listings',job_id='moving-catalog',page=2,total=50,scanned=25")
 for(let id=1;id<=25;id++)sqlite.prepare("INSERT INTO hstora_snapshot_items VALUES('moving-catalog',?,?,1)").run(String(id),JSON.stringify({id:String(id),name:'Licensed subscription '+id,description:'Genuine supplier description',price:'2',currency:'USD',stock:9,stock_checked_at:now}))
 t.mock.method(globalThis,'fetch',async input=>{const page=Number(new URL(String(input)).searchParams.get('page'));const ids=page===1?Array.from({length:25},(_,i)=>i+1):page===2?Array.from({length:25},(_,i)=>i+25):[50];return Response.json({success:true,data:{items:ids.map(id=>({id,name:'Licensed subscription '+id,description:'Genuine supplier description',price:'2',currency:'USD',stock_available:9})),pagination:{page,limit:25,total:page===1?52:51,pages:3}}})})
 await syncHstoraBatch(env)
 const state=sqlite.prepare('SELECT job_id,phase,scanned FROM hstora_connection').get()!
 assert.equal(state.job_id,'moving-catalog');assert.equal(state.phase,'finalize');assert.equal(state.scanned,50)
 assert.equal(sqlite.prepare("SELECT count(*) n FROM hstora_snapshot_items WHERE job_id='moving-catalog'").get()!.n,50)
 await syncHstoraBatch(env)
 assert.equal(sqlite.prepare('SELECT phase FROM hstora_connection').get()!.phase,'complete')
 assert.equal(sqlite.prepare('SELECT count(*) n FROM hstora_catalog_items').get()!.n,50)
 assert.equal(sqlite.prepare("SELECT selling_price_minor FROM hstora_catalog_items WHERE external_id='2'").get()!.selling_price_minor,7000)
})
test('last-page missing descriptions enter detail processing instead of premature finalization',async t=>{
 const {sqlite,env}=await stockFixture(Date.now());sqlite.exec("UPDATE hstora_catalog_items SET checked_at=9999999999999;UPDATE hstora_connection SET requested=1")
 t.mock.method(globalThis,'fetch',async()=>Response.json({success:true,data:{items:[{id:3,name:'Licensed subscription',price:'2',currency:'USD',stock_available:9}],pagination:{page:1,limit:25,total:1,pages:1}}}))
 await syncHstoraBatch(env)
 assert.equal(sqlite.prepare('SELECT phase FROM hstora_connection').get()!.phase,'details')
 await syncHstoraBatch(env)
 const privateItem=sqlite.prepare("SELECT approval_status,published FROM hstora_catalog_items WHERE external_id='3'").get()!
 assert.equal(privateItem.approval_status,'pending');assert.equal(privateItem.published,0)
})
test('detail failures preserve successful peers, quarantine after bounded retries and never erase existing stock',async t=>{
 let now=Date.now();const {sqlite,env}=await stockFixture(now);t.mock.method(Date,'now',()=>now)
 sqlite.prepare('UPDATE hstora_catalog_items SET checked_at=?').run(now)
 sqlite.exec("UPDATE hstora_connection SET phase='details',job_id='detail-retry',total=3")
 for(const id of ['1','2','3'])sqlite.prepare("INSERT INTO hstora_snapshot_items VALUES('detail-retry',?,?,0)").run(id,JSON.stringify({id,name:'Licensed subscription',description:'',price:'2',currency:'USD',stock:29,images:[],stock_checked_at:now}))
 t.mock.method(globalThis,'fetch',async input=>String(input).endsWith('/1')?Response.json({error:{code:'product_unavailable'}},{status:404}):String(input).endsWith('/3')?Response.json({error:{code:'temporarily_unavailable'}},{status:503}):Response.json({success:true,data:{id:2,name:'Licensed subscription',description:'Genuine supplier description',price:'2',currency:'USD',stock_available:37}}))
 await syncHstoraBatch(env)
 assert.equal(sqlite.prepare("SELECT detail_done FROM hstora_snapshot_items WHERE external_id='2'").get()!.detail_done,1)
 assert.equal(sqlite.prepare("SELECT detail_done FROM hstora_snapshot_items WHERE external_id='1'").get()!.detail_done,3)
 now+=31000;await syncHstoraBatch(env);now+=61000;await syncHstoraBatch(env)
 assert.equal(sqlite.prepare("SELECT detail_done FROM hstora_snapshot_items WHERE external_id='3'").get()!.detail_done,2)
 await syncHstoraBatch(env);await syncHstoraBatch(env)
 assert.equal(sqlite.prepare('SELECT phase FROM hstora_connection').get()!.phase,'complete')
 const live=sqlite.prepare("SELECT * FROM hstora_catalog_items WHERE external_id='2'").get()!
 assert.equal(JSON.parse(live.metadata as string).stock,37);assert.equal(live.selling_price_minor,7000)
 assert.equal(sqlite.prepare("SELECT approval_status FROM hstora_catalog_items WHERE external_id='3'").get()!.approval_status,'pending')
})

test('a later page failure preserves saved pages; absent IDs never imply zero stock',async t=>{
 const now=Date.now(),{sqlite,env}=await stockFixture(now);sqlite.prepare('UPDATE hstora_catalog_items SET checked_at=?').run(now)
 sqlite.exec("UPDATE hstora_connection SET requested=1;INSERT INTO hstora_catalog_items(external_id,metadata,snapshot_id,checked_at,approval_status,selling_price_minor) VALUES('9999','{\"id\":\"9999\",\"stock\":17}','older',1,'approved',8000)")
 sqlite.exec("UPDATE hstora_catalog_items SET approval_status='pending' WHERE external_id='9999'")
 let fail=true
 t.mock.method(globalThis,'fetch',async input=>{const page=Number(new URL(String(input)).searchParams.get('page'));if(page===2&&fail)return Response.json({error:{code:'temporarily_unavailable'}},{status:503});return Response.json({success:true,data:{items:Array.from({length:25},(_,i)=>({id:(page-1)*25+i+1,name:'Licensed subscription',description:'Genuine supplier description',price:'2',currency:'USD',stock_available:9})),pagination:{page,limit:25,total:50,pages:2}}})})
 await syncHstoraBatch(env)
 const checkpoint=sqlite.prepare('SELECT job_id,page FROM hstora_connection').get()!
 assert.equal(checkpoint.page,2);assert.equal(sqlite.prepare('SELECT count(*) n FROM hstora_snapshot_items').get()!.n,25)
 fail=false;sqlite.exec('UPDATE hstora_connection SET next_attempt=0');await syncHstoraBatch(env);await syncHstoraBatch(env)
 assert.equal(sqlite.prepare('SELECT job_id FROM hstora_connection').get()!.job_id,checkpoint.job_id)
 const absent=sqlite.prepare("SELECT * FROM hstora_catalog_items WHERE external_id='9999'").get()!
 assert.equal(JSON.parse(absent.metadata as string).stock,17);assert.equal(absent.checked_at,1);assert.equal(absent.selling_price_minor,8000)
})

test('catalog and finalization cannot overwrite a newer stock check after an older webhook',async()=>{
 const now=Date.now(),{sqlite,env}=await stockFixture(now)
 sqlite.prepare("UPDATE hstora_catalog_items SET checked_at=?,metadata=json_set(metadata,'$.webhook_checked_at',?)").run(now,now-60000)
 sqlite.exec("UPDATE hstora_connection SET phase='details',job_id='newer-stock',total=1")
 sqlite.prepare("INSERT INTO hstora_snapshot_items VALUES('newer-stock','2',?,1)").run(JSON.stringify({id:'2',name:'Licensed subscription',description:'Genuine supplier description',price:'2',currency:'USD',stock:1,images:[],stock_checked_at:now-30000}))
 await syncHstoraBatch(env);await syncHstoraBatch(env)
 const live=sqlite.prepare("SELECT metadata,checked_at FROM hstora_catalog_items WHERE external_id='2'").get()!
 assert.equal(live.checked_at,now);assert.equal(JSON.parse(live.metadata as string).stock,29)
})
