import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync,readdirSync} from 'node:fs'

function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON')
 const directory=new URL('../workers/api/migrations/',import.meta.url)
 for(const name of readdirSync(directory).filter(n=>/^00\d{2}_.*\.sql$/.test(n)).sort())db.exec(readFileSync(new URL(name,directory),'utf8'))
 const now=Date.now()
 db.exec("INSERT INTO users(id) VALUES('00000000-0000-4000-8000-000000000001'); INSERT INTO user_roles(user_id,role) VALUES('00000000-0000-4000-8000-000000000001','admin'); INSERT INTO categories(id,slug,name,short_name) VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','VPN','VPN'); INSERT INTO staging_supplier_connections(id,provider,name,enabled) VALUES('00000000-0000-4000-8000-000000000003','youngpg','YoungPG',1)")
 db.prepare("INSERT INTO supplier_snapshots VALUES('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000003',1,?,?)").run(now-10,now)
 for(const id of ['00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006']){
  db.prepare("INSERT INTO products(id,category_id,slug,name,description,price_minor,supplier_name,delivery_type,authorized_resale,status,publication_verified,pricing_mode,server_number) VALUES(?,'00000000-0000-4000-8000-000000000002',?,'VPN subscription','Licensed VPN subscription description',2000,'YoungPG','Subscription activation',1,'active',1,'override',2)").run(id,id)
  db.prepare("INSERT INTO staging_supplier_feed_items(connection_id,external_id,name,source_category,supplier_cost_minor,stock_quantity,authorization_verified,evidence_reference,source_checked_at,approval,category_id,snapshot_id,selling_price_minor,delivery_type,reviewed_description,reviewed_by,reviewed_at) VALUES('00000000-0000-4000-8000-000000000003',?,'VPN subscription','permitted_digital_good',1001,5,1,'verified-license',?,'approved','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004',2000,'Subscription activation','Licensed VPN subscription description','00000000-0000-4000-8000-000000000001',?)").run(id,now,now)
  db.prepare("INSERT INTO supplier_products VALUES('00000000-0000-4000-8000-000000000003',?,?)").run(id,id)
 }
 db.prepare("INSERT INTO youngpg_product_pricing_rules VALUES('00000000-0000-4000-8000-000000000005',3000,1,?,1001,?,'00000000-0000-4000-8000-000000000001')").run(now,now)
 return {db,now,product:()=>db.prepare("SELECT price_minor,pricing_mode,status,publication_verified FROM products WHERE id='00000000-0000-4000-8000-000000000005'").get()!}
}
test('product rule wins over category/default writes; integer rounding and unrelated overrides preserved',()=>{
 const {db,product}=fixture();db.exec("UPDATE products SET price_minor=1452,pricing_mode='auto' WHERE id='00000000-0000-4000-8000-000000000005'")
 assert.equal(product().price_minor,1302);assert.equal(product().pricing_mode,'override')
 db.exec("UPDATE products SET price_minor=1502 WHERE id='00000000-0000-4000-8000-000000000005'");assert.equal(product().price_minor,1302)
 assert.equal(db.prepare("SELECT price_minor FROM products WHERE id='00000000-0000-4000-8000-000000000006'").get()!.price_minor,2000)
 db.exec("UPDATE staging_supplier_feed_items SET supplier_cost_minor=2001 WHERE external_id='00000000-0000-4000-8000-000000000005'");assert.equal(product().price_minor,2602)
 db.exec("UPDATE staging_supplier_feed_items SET supplier_cost_minor=1001 WHERE external_id='00000000-0000-4000-8000-000000000005'");assert.equal(product().price_minor,1302)
})
test('stock-only refresh cannot certify stale costs or publish stale prices',()=>{
 const {db,now,product}=fixture();db.exec("UPDATE youngpg_product_pricing_rules SET cost_verified_at=NULL")
 db.prepare("UPDATE staging_supplier_feed_items SET source_checked_at=? WHERE external_id='00000000-0000-4000-8000-000000000005'").run(now+1)
 assert.equal(db.prepare("SELECT cost_verified_at FROM youngpg_product_pricing_rules").get()!.cost_verified_at,null)
 assert.equal(product().publication_verified,0)
 db.exec("UPDATE products SET status='active',publication_verified=1 WHERE id='00000000-0000-4000-8000-000000000005'")
 assert.equal(product().publication_verified,0);assert.equal(product().price_minor,2000)
})
test('new verified snapshot refreshes unchanged costs; snapshot mismatch does not certify costs',()=>{
 const {db,now,product}=fixture();db.exec("UPDATE youngpg_product_pricing_rules SET cost_verified_at=NULL")
 db.prepare("INSERT INTO supplier_snapshots VALUES('00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000003',1,?,?)").run(now-10,now)
 db.exec("UPDATE staging_supplier_feed_items SET snapshot_id='00000000-0000-4000-8000-000000000007' WHERE external_id='00000000-0000-4000-8000-000000000005'")
 assert.equal(product().price_minor,1302)
 db.exec("UPDATE youngpg_product_pricing_rules SET cost_verified_at=NULL; UPDATE staging_supplier_connections SET revision=2")
 db.exec("UPDATE staging_supplier_feed_items SET supplier_cost_minor=3000 WHERE external_id='00000000-0000-4000-8000-000000000005'")
 assert.equal(db.prepare("SELECT cost_verified_at FROM youngpg_product_pricing_rules").get()!.cost_verified_at,null)
 assert.equal(product().publication_verified,0)
})

test('finalization certifies costs when feed rows precede the completed snapshot',()=>{
 const {db,now,product}=fixture()
 db.exec("BEGIN; PRAGMA defer_foreign_keys=ON; UPDATE youngpg_product_pricing_rules SET cost_verified_at=NULL; UPDATE staging_supplier_feed_items SET supplier_cost_minor=4001,snapshot_id='00000000-0000-4000-8000-000000000007' WHERE external_id='00000000-0000-4000-8000-000000000005'")
 assert.equal(product().price_minor,2000)
 db.prepare("INSERT INTO supplier_snapshots VALUES('00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000003',1,?,?)").run(now-10,now)
 db.exec('COMMIT')
 assert.equal(product().price_minor,5202)
 assert.equal(db.prepare('SELECT verified_cost_minor FROM youngpg_product_pricing_rules').get()!.verified_cost_minor,4001)
})
