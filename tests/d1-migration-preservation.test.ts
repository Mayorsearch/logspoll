import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
test('D1 publication migration preserves every old product field and price; existing products default to manual pricing',()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON')
 for(const name of ['0001_staging_foundation','0002_cloudflare_auth','0003_auth_mail_diagnostics','0004_supplier_review','0005_supplier_sync'])db.exec(readFileSync(new URL('../workers/api/migrations/'+name+'.sql',import.meta.url),'utf8'))
 db.exec(readFileSync(new URL('../workers/api/fixtures.sql',import.meta.url),'utf8'))
 const tables=['users','profiles','user_roles','categories','products','inventory','orders','order_items'];const before=new Map(tables.map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY 1').all()]))
 const columns=db.prepare('PRAGMA table_info(products)').all().map(r=>r.name).join(',')
 db.exec(readFileSync(new URL('../workers/api/migrations/0006_admin_publication.sql',import.meta.url),'utf8'))
 for(const t of tables)assert.deepEqual(db.prepare('SELECT '+(t==='products'?columns:'*')+' FROM '+t+' ORDER BY 1').all(),before.get(t))
 assert.equal(db.prepare('SELECT pricing_mode FROM products').get()!.pricing_mode,'override')
 assert.equal(db.prepare('SELECT available_quantity FROM storefront_products').get()!.available_quantity,0)
 const snapshot=new Map(tables.map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY 1').all()]))
 db.exec(readFileSync(new URL('../workers/api/migrations/0007_supplier_wide_authorization.sql',import.meta.url),'utf8'))
 for(const t of tables)assert.deepEqual(db.prepare('SELECT * FROM '+t+' ORDER BY 1').all(),snapshot.get(t))
 db.exec("INSERT INTO staging_supplier_connections(id,provider,name) VALUES('50000000-0000-4000-8000-000000000001','youngpg','Licensed supplier'); INSERT INTO supplier_sync_jobs(id,connection_id,revision,phase,page,scanned,total,started_at) VALUES('checkpoint','50000000-0000-4000-8000-000000000001',1,'listings',10,864,1512,1000)")
 const job=db.prepare('SELECT * FROM supplier_sync_jobs').get()!
 db.exec(readFileSync(new URL('../workers/api/migrations/0008_sync_snapshot_retry.sql',import.meta.url),'utf8'))
 const after=db.prepare('SELECT * FROM supplier_sync_jobs').get()!
 assert.equal(after.restart_required,0)
 for(const [key,value] of Object.entries(job))assert.deepEqual(after[key],value)
 for(const t of tables)assert.deepEqual(db.prepare('SELECT * FROM '+t+' ORDER BY 1').all(),snapshot.get(t))
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
})
