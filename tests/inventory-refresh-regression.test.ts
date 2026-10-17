import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { refreshPublishedStock } from '../workers/api/catalog-sync.ts'
import { sealCredential } from '../server/supplier-crypto.ts'
import type { ApiEnv, Database, Statement } from '../workers/api/types.ts'

const id = '50000000-0000-4000-8000-000000000001'
const evidence = 'LICENSE-EVIDENCE-TEST-123'

async function fixture(t: TestContext, name = 'Licensed VPN subscription') {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE staging_supplier_connections(
      id TEXT PRIMARY KEY, revision INTEGER, enabled INTEGER,
      next_attempt INTEGER, lease_until INTEGER, lease_owner TEXT,
      encrypted_key TEXT, key_nonce TEXT, authorized_products TEXT, last_status TEXT
    );
    CREATE TABLE supplier_snapshots(id TEXT PRIMARY KEY,connection_id TEXT,revision INTEGER,completed_at INTEGER);
    CREATE TABLE supplier_sync_jobs(
      id TEXT PRIMARY KEY, connection_id TEXT, revision INTEGER,
      phase TEXT, restart_required INTEGER, categories TEXT
    );
    CREATE TABLE staging_supplier_feed_items(
      connection_id TEXT, external_id TEXT, snapshot_id TEXT,
      evidence_reference TEXT, approval TEXT, authorization_verified INTEGER,
      source_category TEXT, supplier_description TEXT, source_checked_at INTEGER,
      stock_quantity INTEGER, PRIMARY KEY(connection_id, external_id)
    );
    CREATE TABLE supplier_products(connection_id TEXT, external_id TEXT, product_id TEXT);
    CREATE TABLE products(id TEXT PRIMARY KEY, name TEXT, status TEXT, publication_verified INTEGER);
    CREATE TABLE supplier_sync_items(job_id TEXT, external_id TEXT, metadata TEXT);
    CREATE TABLE product_authorizations(product_id TEXT PRIMARY KEY,evidence TEXT);
    CREATE TABLE supplier_sync_fences(owner TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1));
  `)
  sqlite.exec(`
    CREATE TABLE migration_metadata(
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    ALTER TABLE staging_supplier_feed_items
      ADD COLUMN supplier_cost_minor INTEGER NOT NULL DEFAULT 0;
  `)
  const db = {
    prepare(sql: string) {
      let params: unknown[] = []
      const stmt = {
        bind(...args: unknown[]) { params = args; return stmt },
        async all() { return {results: sqlite.prepare(sql).all(...params as never[]),success:true} },
        async first() { return (await stmt.all()).results[0] ?? null },
        async run() { return stmt.all() },
      }
      return stmt
    },
    async batch(statements: Statement[]) {
      sqlite.exec('BEGIN')
      try {
        const output = []
        for (const statement of statements) output.push(await statement.all())
        sqlite.exec('COMMIT')
        return output
      } catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
    async exec(sql: string) { sqlite.exec(sql) },
  } as Database
  const env = {
    ENVIRONMENT:'staging', DB:db, CATALOG_SYNC_ENABLED:'true',
    SUPPLIER_ENCRYPTION_KEY:btoa('s'.repeat(32)),
  } as ApiEnv
  const sealed=await sealCredential('ypg_'+'a'.repeat(48),id,env.SUPPLIER_ENCRYPTION_KEY)
  sqlite.prepare("INSERT INTO supplier_snapshots VALUES('job-1',?,1,?)").run(id,Date.now()-1000)
  const clock = Date.now()
  t.mock.method(Date,'now',()=>clock)
  sqlite.prepare(`INSERT INTO staging_supplier_connections
    VALUES(?,1,1,0,NULL,NULL,?,?,?,'Ready')`)
    .run(id,sealed.ciphertext,sealed.nonce,JSON.stringify({good:evidence}))
  sqlite.prepare(`INSERT INTO supplier_sync_jobs VALUES('job-1',?,1,'complete',0,?)`)
    .run(id,JSON.stringify([{id:'1',slug:'utilities',name:'Utilities'}]))
  sqlite.prepare(`INSERT INTO staging_supplier_feed_items
    (connection_id,external_id,snapshot_id,evidence_reference,
     approval,authorization_verified,source_category,
     supplier_description,source_checked_at,stock_quantity)
    VALUES(?,'good','job-1',?,'approved',1,'permitted_digital_good','Licensed software',?,0)`)
    .run(id,evidence,clock-7200000)
  sqlite.prepare(`INSERT INTO supplier_products VALUES(?,'good','product-1')`).run(id)
  sqlite.prepare(`INSERT INTO products VALUES('product-1',?,'active',1)`).run(name)
  sqlite.prepare(`INSERT INTO supplier_sync_items VALUES('job-1','good',?)`)
    .run(JSON.stringify({id:'good',name,description:'Licensed VPN subscription',category_id:'1',slug:'licensed-vpn',cost_minor:1000,stock:8,supplier_status:'active',authorization_ref:evidence,
        ...(name.includes('HACKED') ? {
          review_block:'Credential inventory requires separate verification.'
        } : {})}))
  return {env,sqlite,clock,read:()=>sqlite.prepare(`SELECT stock_quantity,source_checked_at,approval,evidence_reference FROM staging_supplier_feed_items WHERE external_id='good'`).get()!}
}

test('approved licensed inventory refreshes from a live detail, preserving approval and evidence',async t=>{
  const f=await fixture(t)
  let requested=0
  t.mock.method(globalThis,'fetch',async (input:RequestInfo|URL)=>{
    requested++
    assert.match(String(input),/listings\/licensed-vpn/)
    return Response.json({success:true,data:{id:'good',available_stock:7}})
  })
  assert.deepEqual(await refreshPublishedStock(f.env),{skipped:false})
  assert.equal(requested,1)
  assert.equal(f.read().stock_quantity,7)
  assert.ok(Number(f.read().source_checked_at)>=f.clock)
  assert.equal(f.read().approval,'approved')
  assert.equal(f.read().evidence_reference,evidence)
})

test('missing live available_stock cannot be replaced with snapshot quantity',async t=>{
  const f=await fixture(t)
  t.mock.method(globalThis,'fetch',async()=>Response.json({success:true,data:{id:'good'}}))
  assert.deepEqual(await refreshPublishedStock(f.env),{skipped:true})
  assert.equal(f.read().stock_quantity,0)
  assert.equal(f.read().source_checked_at,f.clock-7200000)
})

test('revoked evidence cannot refresh previously published product',async t=>{
  const f=await fixture(t)
  f.sqlite.prepare(`UPDATE staging_supplier_connections SET authorized_products='{}' WHERE id=?`).run(id)
  let requested=0
  t.mock.method(globalThis,'fetch',async()=>{requested++;throw Error('Unexpected request')})
  assert.deepEqual(await refreshPublishedStock(f.env),{skipped:true})
  assert.equal(requested,0)
  assert.equal(f.read().stock_quantity,0)
})

test('credential-bearing listings are never fetched or refreshed',async t=>{
  const f=await fixture(t,'HACKED TIKTOK account with password')
  let requested=0
  t.mock.method(globalThis,'fetch',async()=>{requested++;throw Error('Unexpected request')})
  assert.deepEqual(await refreshPublishedStock(f.env),{skipped:true})
  assert.equal(requested,0)
  assert.equal(f.read().stock_quantity,0)
})


test('changed detail identity must not be written as fresh zero inventory',async t=>{
  const f=await fixture(t)
  t.mock.method(globalThis,'fetch',async()=>Response.json({
    success:true,data:{id:'good',title:'Different public listing',available_stock:9}
  }))
  assert.deepEqual(await refreshPublishedStock(f.env),{skipped:true})
  assert.equal(f.read().stock_quantity,0)
  assert.equal(f.read().source_checked_at,f.clock-7200000)
})

const legacyDetailBlock='Restricted detail metadata; manual investigation required.'
test('HMA legacy detail error retries only with existing independent review and writes actual live stock',async t=>{
 const f=await fixture(t,'HMA VPN FOR LAPTOP 1 MONTH SUB')
 f.sqlite.prepare("UPDATE supplier_sync_items SET metadata=json_set(metadata,'$.review_block',?)").run(legacyDetailBlock)
 f.sqlite.prepare('INSERT INTO product_authorizations VALUES(?,?)').run('product-1',JSON.stringify({delivery:true,privacy:true,provider:true,reference:'existing-admin-review'}))
 t.mock.method(globalThis,'fetch',async()=>Response.json({success:true,data:{id:'good',available_stock:29}}))
 assert.deepEqual(await refreshPublishedStock(f.env),{skipped:false})
 assert.equal(f.read().stock_quantity,29)
 assert.equal(f.read().source_checked_at,f.clock)
 assert.equal(f.sqlite.prepare("SELECT json_extract(metadata,'$.review_block') blocker FROM supplier_sync_items").get()!.blocker,null)
 assert.equal(f.read().approval,'approved')
})
test('legacy errors without independent review stay blocked without supplier requests',async t=>{
 const f=await fixture(t)
 f.sqlite.prepare("UPDATE supplier_sync_items SET metadata=json_set(metadata,'$.review_block',?)").run(legacyDetailBlock)
 t.mock.method(globalThis,'fetch',async()=>{throw Error('Must not fetch without review')})
 assert.deepEqual(await refreshPublishedStock(f.env),{skipped:true})
 assert.equal(f.read().stock_quantity,0)
})
test('failed re-verification retains the legacy blocker and stale timestamp',async t=>{
 const f=await fixture(t)
 f.sqlite.prepare("UPDATE supplier_sync_items SET metadata=json_set(metadata,'$.review_block',?)").run(legacyDetailBlock)
 f.sqlite.prepare('INSERT INTO product_authorizations VALUES(?,?)').run('product-1',JSON.stringify({delivery:true,privacy:true,provider:true,reference:'existing-admin-review'}))
 t.mock.method(globalThis,'fetch',async()=>Response.json({success:true,data:{id:'different',available_stock:29}}))
 assert.deepEqual(await refreshPublishedStock(f.env),{skipped:true})
 assert.equal(f.read().source_checked_at,f.clock-7200000)
 assert.equal(f.sqlite.prepare("SELECT json_extract(metadata,'$.review_block') blocker FROM supplier_sync_items").get()!.blocker,legacyDetailBlock)
})

test('obsolete keyword/title flags with missing snapshot evidence recover through existing review and live identity',async t=>{
 for(const block of ['Restricted account/access, financial or personal-data inventory; independent transfer and delivery review required.','Public title exceeds storefront limit; manual review required.']){
  const f=await fixture(t,block.startsWith('Public')?'Licensed '+ 'utility '.repeat(40):'Facebook authorized account')
  f.sqlite.prepare("UPDATE supplier_sync_items SET metadata=json_remove(json_set(metadata,'$.review_block',?),'$.authorization_ref')").run(block)
  f.sqlite.prepare('INSERT INTO product_authorizations VALUES(?,?)').run('product-1',JSON.stringify({delivery:true,privacy:true,provider:true,reference:'existing-independent-review'}))
  t.mock.method(globalThis,'fetch',async()=>Response.json({success:true,data:{id:'good',available_stock:17}}))
  assert.deepEqual(await refreshPublishedStock(f.env),{skipped:false})
  assert.equal(f.read().stock_quantity,17)
  const meta=JSON.parse(String(f.sqlite.prepare('SELECT metadata FROM supplier_sync_items').get()!.metadata))
  assert.equal(meta.authorization_ref,evidence);assert.equal(meta.review_block,undefined)
 }
})
test('revoked independent review during the supplier request cannot restore stock',async t=>{
 const f=await fixture(t)
 f.sqlite.prepare("UPDATE supplier_sync_items SET metadata=json_set(metadata,'$.review_block',?)").run(legacyDetailBlock)
 f.sqlite.prepare('INSERT INTO product_authorizations VALUES(?,?)').run('product-1',JSON.stringify({delivery:true,privacy:true,provider:true,reference:'existing-independent-review'}))
 t.mock.method(globalThis,'fetch',async()=>{f.sqlite.prepare("UPDATE product_authorizations SET evidence='{}'").run();return Response.json({success:true,data:{id:'good',available_stock:29}})})
 await refreshPublishedStock(f.env)
 assert.equal(f.read().stock_quantity,0);assert.equal(f.read().source_checked_at,f.clock-7200000)
})

test('live stock refresh continues during discovery while retaining the prior verified snapshot',async t=>{
 const f=await fixture(t)
 f.sqlite.exec("UPDATE supplier_sync_jobs SET id='new-scan',phase='details';UPDATE supplier_sync_items SET job_id='new-scan'")
 t.mock.method(globalThis,'fetch',async()=>Response.json({success:true,data:{id:'good',available_stock:7}}))
 assert.deepEqual(await refreshPublishedStock(f.env),{skipped:false})
 assert.equal(f.read().stock_quantity,7);assert.equal(f.sqlite.prepare('SELECT snapshot_id FROM staging_supplier_feed_items').get()!.snapshot_id,'job-1')
 assert.equal(f.sqlite.prepare('SELECT phase FROM supplier_sync_jobs').get()!.phase,'details')
})
test('incomplete discovery cannot replace an invalid verified snapshot',async t=>{
 const f=await fixture(t);f.sqlite.exec("UPDATE supplier_sync_jobs SET phase='details';UPDATE supplier_snapshots SET revision=2")
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Unexpected fetch')})
 assert.deepEqual(await refreshPublishedStock(f.env),{skipped:true});assert.equal(calls,0);assert.equal(f.read().stock_quantity,0)
})
