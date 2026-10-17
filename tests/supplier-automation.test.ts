import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync,readdirSync} from 'node:fs'
import {automationDecision,runSupplierAutomation,runSupplierAutomationBatch,assertAutomationQuotes} from '../workers/api/supplier-automation.ts'
import type {ApiEnv,Database,Statement} from '../workers/api/types.ts'

const now=Date.now(),row:Parameters<typeof automationDecision>[0]={id:crypto.randomUUID(),category_id:'cat-vpn',price_minor:2000,pricing_mode:'override',description:'Verified VPN subscription description',status:'active',publication_verified:1,available_quantity:5,enabled:1,checked_at:now,stock:5,approval:'approved',authorized_resale:1,evidence:JSON.stringify({delivery:true,privacy:true,provider:true}),category_active:1,cost_minor:1000,native_price:null,native_currency:null}
const policy={markup_bps:5000,automatic_pricing:1,auto_publish:1}

test('supplier percentage never overwrites manual prices without explicit restoration',()=>{
 assert.equal(automationDecision(row,policy,now).price,2000)
 assert.equal(automationDecision(row,policy,now,true).price,1500)
 assert.equal(automationDecision({...row,pricing_mode:'auto',cost_minor:1200},policy,now).price,1800)
})

test('category-based markup applies specific rate without compounding',()=>{
 const catRule={id:'r1',provider:'youngpg',category_id:'cat-vpn',markup_bps:2500,trusted:1,authorization_reference:'ref',delivery_type:'Subscription activation',min_cost_minor:1,max_cost_minor:1000000,updated_by:'u1',updated_at:now}
 // With 25% category markup instead of 50% supplier markup: cost 1000 => price 1250
 assert.equal(automationDecision({...row,pricing_mode:'auto',cost_minor:1000},policy,now,false,[catRule]).price,1250)
 // Another category without rule falls back to supplier 50%: cost 1000 => price 1500
 assert.equal(automationDecision({...row,category_id:'cat-other',pricing_mode:'auto',cost_minor:1000},policy,now,false,[catRule]).price,1500)
})

test('unapproved, stale, missing-rights and unavailable listings cannot auto-publish',()=>{
 for(const change of [{approval:'pending'},{approval:'rejected'},{checked_at:now-86400001},{evidence:null},{available_quantity:0},{enabled:0},{description:'missing'}])assert.equal(automationDecision({...row,...change},policy,now).publish,false)
 assert.equal(automationDecision({...row,stock:0,available_quantity:0},policy,now).unpublish,true)
 assert.equal(automationDecision({...row,removed:1,checked_at:0},policy,now).unpublish,true)
 assert.equal(automationDecision({...row,enabled:0},policy,now).unpublish,false)
})

test('foreign currency never silently assumes USD or an invented exchange rate',()=>{
 const decision=automationDecision({...row,pricing_mode:'auto',native_price:'0.20',native_currency:'USD'},policy,now)
 assert.equal(decision.managed,false);assert.equal(decision.publish,false);assert.match(decision.reasons.join(' '),/currency conversion/)
})

function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON')
 const directory=new URL('../workers/api/migrations/',import.meta.url)
 for(const name of readdirSync(directory).filter(name=>/^00(?:0[1-9]|1[0-6])_.*\.sql$/.test(name)).sort())sql.exec(readFileSync(new URL(name,directory),'utf8'))
 const actor=crypto.randomUUID(),category=crypto.randomUUID(),connection=crypto.randomUUID(),snapshot=crypto.randomUUID(),product=crypto.randomUUID(),checked=Date.now()
 sql.prepare('INSERT INTO users(id) VALUES(?)').run(actor);sql.prepare("INSERT INTO user_roles(user_id,role) VALUES(?,'admin')").run(actor)
 sql.prepare("INSERT INTO categories(id,slug,name,short_name) VALUES(?,'fixture-vpn','VPN','VPN')").run(category)
 sql.prepare("INSERT INTO staging_supplier_connections(id,provider,name,enabled,authorized_products) VALUES(?,'youngpg','Test supplier',1,?)").run(connection,JSON.stringify({'*':'verified-reference'}))
 sql.prepare('INSERT INTO supplier_snapshots(id,connection_id,revision,started_at,completed_at) VALUES(?,?,1,?,?)').run(snapshot,connection,checked-100,checked)
 sql.prepare("INSERT INTO staging_supplier_feed_items(connection_id,external_id,name,source_category,supplier_cost_minor,stock_quantity,authorization_verified,evidence_reference,source_checked_at,approval,category_id,selling_price_minor,delivery_type,reviewed_description,reviewed_by,reviewed_at,snapshot_id) VALUES(?,'item','Test VPN','permitted_digital_good',1000,5,1,'verified-reference',?,'approved',?,2000,'Subscription activation','Verified VPN subscription description',?,?,?)").run(connection,checked,category,actor,checked,snapshot)
 sql.prepare("INSERT INTO products(id,category_id,slug,name,description,price_minor,supplier_name,delivery_type,authorized_resale,status,publication_verified,pricing_mode) VALUES(?,?,'fixture-product','Test VPN','Verified VPN subscription description',2000,'YoungPG','Subscription activation',1,'active',1,'override')").run(product,category)
 sql.prepare("INSERT INTO supplier_products VALUES(?,'item',?)").run(connection,product)
 sql.prepare('INSERT INTO product_authorizations VALUES(?,?,?,?)').run(product,JSON.stringify({delivery:true,privacy:true,provider:true,reference:'verified-reference'}),actor,checked)
 sql.prepare("INSERT INTO supplier_automation(provider,markup_bps,automatic_pricing,auto_publish,updated_by) VALUES('youngpg',5000,1,1,?)").run(actor)
 const db={prepare(query:string){let args:unknown[]=[];const statement={bind(...values:unknown[]){args=values;return statement},async first(){return sql.prepare(query).get(...args as never[])??null},async all(){return {success:true,results:sql.prepare(query).all(...args as never[])}},async run(){return sql.prepare(query).run(...args as never[])}};return statement},async batch(statements:Statement[]){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results}catch(error){sql.exec('ROLLBACK');throw error}}} as unknown as Database
 return {sql,product,connection,category,actor,env:{ENVIRONMENT:'staging',AUTOMATION_ENABLED:'true',CATALOG_SYNC_ENABLED:'false',DB:db} as ApiEnv}
}

test('real SQLite batches preserve overrides, refresh costs once, hide stock depletion and preserve records',async()=>{
 const {sql,product,connection,env}=fixture();try{
  const price=()=>Number(sql.prepare('SELECT price_minor FROM products WHERE id=?').get(product)!.price_minor)
  await runSupplierAutomation(env);assert.equal(price(),2000)
  sql.exec("UPDATE supplier_automation SET restore_pending=1,run_requested=1,cursor=''")
  await runSupplierAutomationBatch(env,'youngpg');assert.equal(price(),1500,JSON.stringify(sql.prepare('SELECT last_status FROM supplier_automation').get()))
  await runSupplierAutomation(env);assert.equal(sql.prepare('SELECT count(*) n FROM supplier_automation_log').get()!.n,1)
  sql.prepare('UPDATE staging_supplier_feed_items SET supplier_cost_minor=1200,source_checked_at=?').run(Date.now());assert.equal(price(),1500);await assert.rejects(assertAutomationQuotes(env,[product]),/pricing refresh/)
  await runSupplierAutomation(env);assert.equal(price(),1800)
  sql.prepare('UPDATE staging_supplier_feed_items SET stock_quantity=0,source_checked_at=?').run(Date.now())
  await runSupplierAutomation(env);assert.equal(sql.prepare('SELECT publication_verified FROM products').get()!.publication_verified,0)
  assert.equal(sql.prepare('SELECT count(*) n FROM products').get()!.n,1)
  sql.prepare('UPDATE staging_supplier_feed_items SET stock_quantity=5,source_checked_at=?').run(Date.now());await runSupplierAutomation(env)
  sql.prepare('UPDATE staging_supplier_connections SET enabled=0 WHERE id=?').run(connection);await runSupplierAutomation(env)
  assert.equal(sql.prepare('SELECT publication_verified FROM products').get()!.publication_verified,1);assert.equal(price(),1800)
 }finally{sql.close()}
})

test('configured auto-approval reuses review gates; rejected and unmapped listings remain private',async()=>{
 const {sql,env}=fixture();try{
  sql.exec("UPDATE supplier_automation SET auto_approve=1,review_reference='catalog-evidence-reference',delivery_type='Subscription activation'")
  const insert=(id:string,approval:string,mapped:boolean)=>sql.prepare(`INSERT INTO staging_supplier_feed_items(connection_id,external_id,name,source_category,supplier_cost_minor,stock_quantity,authorization_verified,evidence_reference,source_checked_at,approval,category_id,supplier_description,snapshot_id) SELECT connection_id,?,'Licensed VPN subscription','permitted_digital_good',1000,5,1,evidence_reference,?,?,CASE WHEN ? THEN category_id ELSE NULL END,'Verified supplier subscription details for licensed VPN',snapshot_id FROM staging_supplier_feed_items WHERE external_id='item'`).run(id,Date.now(),approval,mapped?1:0)
  insert('new','pending',true);insert('unmapped','pending',false);insert('rejected','rejected',true)
  const result=await runSupplierAutomationBatch(env,'youngpg');assert.equal(result.approved,1)
  assert.equal(sql.prepare("SELECT approval FROM staging_supplier_feed_items WHERE external_id='new'").get()!.approval,'approved')
  assert.equal(sql.prepare("SELECT approval FROM staging_supplier_feed_items WHERE external_id='unmapped'").get()!.approval,'pending')
  assert.equal(sql.prepare("SELECT approval FROM staging_supplier_feed_items WHERE external_id='rejected'").get()!.approval,'rejected')
  assert.equal(sql.prepare("SELECT count(*) n FROM products WHERE publication_verified=1").get()!.n,2)
  assert.equal(sql.prepare("SELECT p.pricing_mode FROM products p JOIN supplier_products s ON s.product_id=p.id WHERE s.external_id='new'").get()!.pricing_mode,'auto')
 }finally{sql.close()}
})

test('trusted category rule auto-approves matching candidate while untrusted remains in quarantine',async()=>{
 const {sql,category,actor,env}=fixture();try{
  const otherCat=crypto.randomUUID()
  sql.prepare("INSERT INTO categories(id,slug,name,short_name) VALUES(?,'other-cat','Other','Other')").run(otherCat)
  // Configure category rule: fixture-vpn is trusted with 30% markup; other-cat has no rule
  sql.prepare("INSERT INTO supplier_category_rules(id,provider,category_id,markup_bps,trusted,authorization_reference,delivery_type,min_cost_minor,max_cost_minor,updated_by,updated_at) VALUES('rule-1','youngpg',?,3000,1,'YoungPG resale verified licence','Subscription activation',100,500000,?,?)").run(category,actor,Date.now())
  sql.exec("UPDATE supplier_automation SET auto_approve=1,review_reference='catalog-evidence-reference'")

  const insert=(id:string,catId:string)=>sql.prepare(`INSERT INTO staging_supplier_feed_items(connection_id,external_id,name,source_category,supplier_cost_minor,stock_quantity,authorization_verified,evidence_reference,source_checked_at,approval,category_id,supplier_description,snapshot_id) SELECT connection_id,?,'Licensed VPN subscription','permitted_digital_good',1000,5,1,evidence_reference,?,'pending',?,'Verified supplier subscription details for licensed VPN',snapshot_id FROM staging_supplier_feed_items WHERE external_id='item'`).run(id,Date.now(),catId)
  insert('trusted-item',category)
  insert('untrusted-item',otherCat)

  const result=await runSupplierAutomationBatch(env,'youngpg')
  assert.equal(result.approved,1)
  assert.equal(sql.prepare("SELECT approval FROM staging_supplier_feed_items WHERE external_id='trusted-item'").get()!.approval,'approved')
  // Untrusted item remains safely in pending quarantine
  assert.equal(sql.prepare("SELECT approval FROM staging_supplier_feed_items WHERE external_id='untrusted-item'").get()!.approval,'pending')

  // Verified price reflects category markup (30% on 1000 = 1300)
  const trustedProduct=sql.prepare("SELECT p.price_minor FROM products p JOIN supplier_products s ON s.product_id=p.id WHERE s.external_id='trusted-item'").get() as {price_minor:number}
  assert.equal(trustedProduct.price_minor,1300)
 }finally{sql.close()}
})

test('revoked policy administrator cannot approve or publish',async()=>{
 const {sql,env}=fixture();try{sql.exec("UPDATE user_roles SET role='customer'");await assert.rejects(runSupplierAutomationBatch(env,'youngpg'));assert.equal(sql.prepare('SELECT count(*) n FROM supplier_automation_log').get()!.n,0)}finally{sql.close()}
})
