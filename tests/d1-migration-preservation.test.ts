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
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
})
