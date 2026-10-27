-- Migration 0033: Kora Store Supplier Integration (Server 4 AI Tools)

CREATE TABLE IF NOT EXISTS korastore_connection (
  id TEXT PRIMARY KEY CHECK(id='korastore'),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  requested INTEGER NOT NULL DEFAULT 0,
  auto_monitor INTEGER NOT NULL DEFAULT 0 CHECK(auto_monitor IN (0,1)),
  monitor_interval_hours INTEGER NOT NULL DEFAULT 6,
  job_id TEXT,
  total INTEGER,
  scanned INTEGER NOT NULL DEFAULT 0,
  phase TEXT NOT NULL DEFAULT 'idle',
  lease_owner TEXT,
  lease_until INTEGER,
  next_attempt INTEGER NOT NULL DEFAULT 0,
  last_success INTEGER,
  last_status TEXT NOT NULL DEFAULT 'Not configured',
  base_url TEXT NOT NULL DEFAULT 'https://korastore.cv/v1'
) STRICT;

CREATE TABLE IF NOT EXISTS korastore_catalog_items (
  external_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cost_minor INTEGER NOT NULL,          -- in kobo (NGN minor unit)
  previous_cost_minor INTEGER,          -- tracks wholesale price changes
  selling_price_minor INTEGER NOT NULL, -- calculated selling price in kobo
  currency TEXT NOT NULL DEFAULT 'NGN',
  stock INTEGER,                        -- NULL = unlimited, or integer
  available INTEGER NOT NULL DEFAULT 1,
  delivery_type TEXT NOT NULL DEFAULT 'instant', -- 'instant' or 'manual'
  pricing_mode TEXT NOT NULL DEFAULT 'markup' CHECK(pricing_mode IN ('markup', 'override')),
  markup_bps INTEGER NOT NULL DEFAULT 5000, -- e.g. 5000 = 50.00%
  approval_status TEXT NOT NULL DEFAULT 'pending' CHECK(approval_status IN ('pending', 'approved', 'rejected')),
  product_id TEXT,                      -- FK to products.id
  raw_metadata TEXT NOT NULL DEFAULT '{}',
  checked_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  price_updated_at INTEGER
) STRICT;

CREATE TABLE IF NOT EXISTS korastore_price_history (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL,
  old_cost_minor INTEGER NOT NULL,
  new_cost_minor INTEGER NOT NULL,
  old_price_minor INTEGER NOT NULL,
  new_price_minor INTEGER NOT NULL,
  markup_bps INTEGER NOT NULL,
  change_type TEXT NOT NULL, -- 'increase' | 'decrease' | 'manual'
  recorded_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_korastore_price_history_item ON korastore_price_history(external_id, recorded_at DESC);

-- Update verified stock view to include Kora Store alongside DigitalCore under Server 4
DROP VIEW IF EXISTS storefront_products;
DROP VIEW IF EXISTS verified_product_stock;

CREATE VIEW verified_product_stock AS
 SELECT p.id, CASE
  WHEN kora.external_id IS NOT NULL THEN
    CASE WHEN kora.approval_status='approved' AND kc.enabled=1 AND (kora.stock IS NULL OR kora.stock>0)
      AND kora.checked_at > (CAST(unixepoch('now') AS INTEGER) - 604800) * 1000
    THEN COALESCE(kora.stock, 999) ELSE 0 END
  WHEN dc.external_id IS NOT NULL THEN
    CASE WHEN dc.approval_status='approved' AND dcc.enabled=1 AND dc.stock>0
      AND dc.checked_at > (CAST(unixepoch('now') AS INTEGER) - 604800) * 1000
    THEN dc.stock ELSE 0 END
  WHEN s4.external_id IS NOT NULL THEN
    CASE WHEN s4.approval_status='approved' AND sc4.enabled=1 AND s4.stock>0
      AND s4.checked_at > (CAST(unixepoch('now') AS INTEGER) - 604800) * 1000
    THEN s4.stock ELSE 0 END
  WHEN s3.external_id IS NOT NULL THEN
    CASE WHEN s3.approval_status='approved' AND sc.enabled=1 AND s3.stock>0
      AND s3.checked_at > (CAST(unixepoch('now') AS INTEGER) - 604800) * 1000
    THEN s3.stock ELSE 0 END
  WHEN h.external_id IS NOT NULL THEN
    CASE WHEN h.approval_status='approved' AND c.enabled=1
      AND CAST(json_extract(h.metadata,'$.stock') AS INTEGER)>0
      AND COALESCE(json_extract(h.metadata,'$.supplier_available'),1)<>0
      AND h.checked_at > (CAST(unixepoch('now') AS INTEGER) - 604800) * 1000
    THEN CAST(json_extract(h.metadata,'$.stock') AS INTEGER) ELSE 0 END
  ELSE y.available_quantity END available_quantity
 FROM products p
 LEFT JOIN youngpg_verified_product_stock y ON y.id=p.id
 LEFT JOIN hstora_catalog_items h ON h.product_id=p.id
 LEFT JOIN hstora_connection c ON c.id='hstora'
 LEFT JOIN shopviaclone22_catalog_items s3 ON s3.product_id=p.id
 LEFT JOIN shopviaclone22_connection sc ON sc.id='shopviaclone22'
 LEFT JOIN digitalcore_catalog_items dc ON dc.product_id=p.id
 LEFT JOIN digitalcore_connection dcc ON dcc.id='digitalcore'
 LEFT JOIN digitaltop_catalog_items s4 ON s4.product_id=p.id
 LEFT JOIN digitaltop_connection sc4 ON sc4.id='digitaltop'
 LEFT JOIN korastore_catalog_items kora ON kora.product_id=p.id
 LEFT JOIN korastore_connection kc ON kc.id='korastore';

CREATE VIEW storefront_products AS
 SELECT p.id,p.category_id,p.slug,p.name,p.brand,p.description,p.price_minor,p.currency,p.delivery_type,p.image_path,p.term,p.features,p.supplier_image_urls,p.featured,v.available_quantity,p.server_number,p.supplier_name,p.created_at
 FROM products p JOIN categories c ON c.id=p.category_id JOIN verified_product_stock v ON v.id=p.id
 WHERE p.status='active' AND p.authorized_resale=1 AND p.publication_verified=1 AND c.active=1;
