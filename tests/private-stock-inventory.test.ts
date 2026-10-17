import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'

// Test the actual SQL templates in the private administrator inventory endpoint.
const source = readFileSync(new URL('../workers/api/catalog-sync.ts', import.meta.url), 'utf8')
const statement = (pattern: RegExp) => {
  const match = source.match(pattern)
  assert.ok(match, 'Expected private-inventory query to exist')
  return match[1]
}
const totalsSQL = statement(/env\.DB\.prepare\(`(SELECT COUNT\(\*\) total,[\s\S]*?)`\)\.first\(\)/)
const inventorySQL = statement(/env\.DB\.prepare\(`(SELECT i\.external_id externalId,[\s\S]*?)`\)\.bind\(pageSize,offset\)\.all\(\)/)

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE staging_supplier_connections(id TEXT PRIMARY KEY,name TEXT,revision INTEGER);
    CREATE TABLE supplier_sync_jobs(id TEXT PRIMARY KEY,connection_id TEXT,phase TEXT,revision INTEGER,completed_at INTEGER);
    CREATE TABLE supplier_sync_items(job_id TEXT,external_id TEXT,metadata TEXT);
    CREATE TABLE staging_supplier_feed_items(connection_id TEXT,external_id TEXT,source_checked_at INTEGER);
    CREATE TABLE supplier_products(connection_id TEXT,external_id TEXT,product_id TEXT);
    CREATE TABLE products(id TEXT,category_id TEXT,status TEXT,authorized_resale INTEGER,publication_verified INTEGER);
    CREATE TABLE categories(id TEXT,active INTEGER);
    CREATE TABLE verified_product_stock(id TEXT,available_quantity INTEGER);
    INSERT INTO staging_supplier_connections VALUES('c','Synthetic supplier',1);
    INSERT INTO supplier_sync_jobs VALUES('j','c','complete',1,1000);
    INSERT INTO supplier_sync_items VALUES('j','review','{"stock":42,"review_block":"manual review"}');
    INSERT INTO supplier_sync_items VALUES('j','licensed','{"stock":7}');
    INSERT INTO supplier_sync_items VALUES('j','invalid','{"review_block":"invalid data"}');
    INSERT INTO categories VALUES('cat',1);
    INSERT INTO products VALUES('p','cat','active',1,1);
    INSERT INTO supplier_products VALUES('c','licensed','p');
    INSERT INTO verified_product_stock VALUES('p',6);
  `)
  return db
}

test('private supplier stock includes all listings, without promoting review-pending goods', () => {
  const db = fixture()
  const stats = db.prepare(totalsSQL).get() as {total:number;reportedPositive:number;sellablePositive:number}
  assert.equal(stats.total,3)
  assert.equal(stats.reportedPositive,2)
  assert.equal(stats.sellablePositive,1)
  const rows = db.prepare(inventorySQL).all(50,0) as Record<string,unknown>[]
  assert.equal(rows.length,3)
  const row = (id:string) => rows.find(r => r.externalId===id)!
  assert.equal(row('review').supplierReportedStock,42)
  assert.equal(row('review').verifiedSellableStock,0)
  assert.equal(row('review').reviewStatus,'requires_review')
  assert.equal(row('licensed').supplierReportedStock,7)
  assert.equal(row('licensed').verifiedSellableStock,6)
  assert.equal(row('invalid').supplierReportedStock,null)
})

test('inactive storefront category prevents sellable inventory, not private stock', () => {
  const db=fixture()
  db.exec('UPDATE categories SET active=0')
  const rows=db.prepare(inventorySQL).all(50,0) as Record<string,unknown>[]
  const licensed=rows.find(r=>r.externalId==='licensed')!
  assert.equal(licensed.supplierReportedStock,7)
  assert.equal(licensed.verifiedSellableStock,0)
})
