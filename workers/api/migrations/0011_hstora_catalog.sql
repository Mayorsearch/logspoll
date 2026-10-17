-- Independent HStora storage; no changes to YoungPG, prices or published products.
CREATE TABLE IF NOT EXISTS hstora_connection (
 id TEXT PRIMARY KEY CHECK(id='hstora'), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 ciphertext TEXT NOT NULL, nonce TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 requested INTEGER NOT NULL DEFAULT 0, job_id TEXT, page INTEGER NOT NULL DEFAULT 1,
 total INTEGER, scanned INTEGER NOT NULL DEFAULT 0, phase TEXT NOT NULL DEFAULT 'idle',
 lease_owner TEXT, lease_until INTEGER, next_attempt INTEGER NOT NULL DEFAULT 0,
 fx_rate_minor INTEGER CHECK(fx_rate_minor>0), last_success INTEGER, last_status TEXT NOT NULL DEFAULT 'Not synchronized'
) STRICT;
CREATE TABLE IF NOT EXISTS hstora_snapshot_items (
 job_id TEXT NOT NULL, external_id TEXT NOT NULL, metadata TEXT NOT NULL CHECK(json_valid(metadata)),
 detail_done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(job_id,external_id)
) STRICT;
CREATE TABLE IF NOT EXISTS hstora_catalog_items (
 external_id TEXT PRIMARY KEY, supplier TEXT NOT NULL DEFAULT 'hstora' CHECK(supplier='hstora'),
 storefront_category TEXT NOT NULL DEFAULT 'server1' CHECK(storefront_category='server1'),
 metadata TEXT NOT NULL CHECK(json_valid(metadata)), snapshot_id TEXT NOT NULL, checked_at INTEGER NOT NULL,
 approval_status TEXT NOT NULL DEFAULT 'pending' CHECK(approval_status IN('pending','approved','rejected')),
 selling_price_minor INTEGER CHECK(selling_price_minor>=0), manual_description TEXT,
 published INTEGER NOT NULL DEFAULT 0 CHECK(published IN(0,1)), product_id TEXT UNIQUE REFERENCES products(id), evidence_reference TEXT, reviewed_revision INTEGER, reviewed_at INTEGER, reviewed_by TEXT REFERENCES users(id)
) STRICT;
CREATE TABLE IF NOT EXISTS hstora_sync_fences(owner TEXT PRIMARY KEY,valid INTEGER NOT NULL CHECK(valid=1)) STRICT;

INSERT INTO categories(id,slug,name,short_name,description) VALUES('a5784b30-15cf-4bfb-bf0f-25ac18bc5e91','server1','server1','server1','HStora catalog') ON CONFLICT(slug) DO NOTHING;
CREATE TRIGGER IF NOT EXISTS hstora_fixed_category BEFORE UPDATE OF category_id ON products
 WHEN EXISTS(SELECT 1 FROM hstora_catalog_items h WHERE h.product_id=OLD.id) AND NEW.category_id<>(SELECT id FROM categories WHERE slug='server1')
 BEGIN SELECT RAISE(ABORT,'HStora products must remain under server1'); END;

CREATE VIEW IF NOT EXISTS youngpg_verified_product_stock AS
 SELECT p.id,CASE
 WHEN sp.product_id IS NOT NULL AND f.approval='approved' AND f.authorization_verified=1 AND f.source_category='permitted_digital_good'
  AND c.enabled=1 AND s.revision=c.revision AND s.completed_at<=CAST(unixepoch('subsec')*1000 AS INTEGER)
  AND f.source_checked_at<=CAST(unixepoch('subsec')*1000 AS INTEGER) AND f.source_checked_at>(unixepoch('now')-3600)*1000
  AND EXISTS(SELECT 1 FROM json_each(c.authorized_products) a WHERE a.value=f.evidence_reference AND (a.key=f.external_id OR (a.key='*' AND NOT EXISTS(SELECT 1 FROM json_each(c.authorized_products) specific WHERE specific.key=f.external_id))))
 THEN f.stock_quantity
 WHEN sp.product_id IS NULL AND i.source_mode='manual' AND a.product_id IS NOT NULL
  AND julianday(i.verified_at)<=julianday('now') AND julianday(i.verified_at)>julianday('now','-1 hour') THEN i.available_quantity
 ELSE 0 END available_quantity
 FROM products p LEFT JOIN supplier_products sp ON sp.product_id=p.id
 LEFT JOIN staging_supplier_feed_items f ON f.connection_id=sp.connection_id AND f.external_id=sp.external_id
 LEFT JOIN staging_supplier_connections c ON c.id=f.connection_id LEFT JOIN supplier_snapshots s ON s.id=f.snapshot_id AND s.connection_id=f.connection_id
 LEFT JOIN inventory i ON i.product_id=p.id LEFT JOIN product_authorizations a ON a.product_id=p.id;
DROP VIEW IF EXISTS verified_product_stock;
CREATE VIEW verified_product_stock AS
SELECT p.id,CASE WHEN h.external_id IS NULL THEN y.available_quantity
 WHEN h.approval_status='approved' AND c.enabled=1 AND h.reviewed_revision=c.revision
 AND length(trim(h.evidence_reference))>=5 AND h.checked_at<=CAST(unixepoch('subsec')*1000 AS INTEGER)
 AND h.checked_at>CAST(unixepoch('subsec')*1000 AS INTEGER)-3600000
 AND json_valid(a.evidence) AND json_extract(a.evidence,'$.delivery')=1
 AND json_extract(a.evidence,'$.privacy')=1 AND json_extract(a.evidence,'$.provider')=1
 AND json_extract(a.evidence,'$.reference')=h.evidence_reference
 THEN CAST(json_extract(h.metadata,'$.stock') AS INTEGER) ELSE 0 END available_quantity
FROM products p LEFT JOIN youngpg_verified_product_stock y ON y.id=p.id
LEFT JOIN hstora_catalog_items h ON h.product_id=p.id
LEFT JOIN hstora_connection c ON c.id='hstora'
LEFT JOIN product_authorizations a ON a.product_id=p.id;
