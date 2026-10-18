-- Migration 0017: ShopViaClone22 Server 3 Storage & Verified Stock Projection

CREATE TABLE IF NOT EXISTS shopviaclone22_connection (
  id TEXT PRIMARY KEY CHECK(id='shopviaclone22'),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  requested INTEGER NOT NULL DEFAULT 0,
  job_id TEXT,
  page INTEGER NOT NULL DEFAULT 1,
  total INTEGER,
  scanned INTEGER NOT NULL DEFAULT 0,
  phase TEXT NOT NULL DEFAULT 'idle',
  lease_owner TEXT,
  lease_until INTEGER,
  next_attempt INTEGER NOT NULL DEFAULT 0,
  last_success INTEGER,
  last_status TEXT NOT NULL DEFAULT 'Not synchronized',
  base_url TEXT NOT NULL DEFAULT 'https://shopviaclone22.com/api'
) STRICT;

CREATE TABLE IF NOT EXISTS shopviaclone22_catalog_items (
  external_id TEXT PRIMARY KEY,
  supplier TEXT NOT NULL DEFAULT 'shopviaclone22' CHECK(supplier='shopviaclone22'),
  category_id TEXT REFERENCES categories(id),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '',
  cost_minor INTEGER NOT NULL CHECK(cost_minor >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
  raw_metadata TEXT NOT NULL CHECK(json_valid(raw_metadata)),
  snapshot_id TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'pending' CHECK(approval_status IN('pending','approved','rejected')),
  selling_price_minor INTEGER CHECK(selling_price_minor >= 0),
  manual_description TEXT,
  product_id TEXT UNIQUE REFERENCES products(id),
  reviewed_revision INTEGER,
  reviewed_at INTEGER,
  reviewed_by TEXT REFERENCES users(id)
) STRICT;

CREATE TABLE IF NOT EXISTS shopviaclone22_sync_fences (
  owner TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK(valid=1)
) STRICT;

-- Default category for Server 3
INSERT INTO categories(id, slug, name, short_name, description)
VALUES('b7391c41-26df-4cfb-cf1f-36bc19bc6f92', 'server3', 'Server 3', 'Server 3', 'Server 3 Catalog')
ON CONFLICT(slug) DO NOTHING;

-- Recreate verified_product_stock to include Server 3 (ShopViaClone22)
DROP VIEW IF EXISTS storefront_products;
DROP VIEW IF EXISTS verified_product_stock;

CREATE VIEW verified_product_stock AS
 SELECT p.id, CASE
  WHEN s3.external_id IS NOT NULL THEN
    CASE WHEN s3.approval_status='approved' AND sc.enabled=1 AND s3.stock>0
      AND s3.checked_at > (CAST(unixepoch('now') AS INTEGER) - 86400) * 1000
    THEN s3.stock ELSE 0 END
  WHEN h.external_id IS NOT NULL THEN
    CASE WHEN h.approval_status='approved' AND c.enabled=1
      AND CAST(json_extract(h.metadata,'$.stock') AS INTEGER)>0
      AND COALESCE(json_extract(h.metadata,'$.supplier_available'),1)<>0
      AND h.checked_at > (CAST(unixepoch('now') AS INTEGER) - 86400) * 1000
    THEN CAST(json_extract(h.metadata,'$.stock') AS INTEGER) ELSE 0 END
  ELSE y.available_quantity END available_quantity
 FROM products p
 LEFT JOIN youngpg_verified_product_stock y ON y.id=p.id
 LEFT JOIN hstora_catalog_items h ON h.product_id=p.id
 LEFT JOIN hstora_connection c ON c.id='hstora'
 LEFT JOIN shopviaclone22_catalog_items s3 ON s3.product_id=p.id
 LEFT JOIN shopviaclone22_connection sc ON sc.id='shopviaclone22';

CREATE VIEW storefront_products AS
 SELECT p.id,p.category_id,p.slug,p.name,p.brand,p.description,p.price_minor,p.currency,p.delivery_type,p.image_path,p.term,p.features,p.supplier_image_urls,p.featured,v.available_quantity,p.server_number,p.supplier_name
 FROM products p JOIN categories c ON c.id=p.category_id JOIN verified_product_stock v ON v.id=p.id
 WHERE p.status='active' AND p.authorized_resale=1 AND p.publication_verified=1 AND c.active=1;

