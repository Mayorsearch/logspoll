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
