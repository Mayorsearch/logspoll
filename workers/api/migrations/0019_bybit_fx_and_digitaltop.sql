-- Migration 0019: Bybit P2P Dynamic FX Rates and DigitalTop (Server 4) Supplier

ALTER TABLE global_pricing_config ADD COLUMN fx_source TEXT NOT NULL DEFAULT 'bybit_p2p';
ALTER TABLE global_pricing_config ADD COLUMN fx_updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE global_pricing_config ADD COLUMN fx_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE global_pricing_config ADD COLUMN fx_override_active INTEGER NOT NULL DEFAULT 0;
ALTER TABLE global_pricing_config ADD COLUMN fx_override_rate REAL;
ALTER TABLE global_pricing_config ADD COLUMN bybit_api_key TEXT;
ALTER TABLE global_pricing_config ADD COLUMN bybit_api_secret TEXT;

CREATE TABLE IF NOT EXISTS exchange_rate_history (
  id TEXT PRIMARY KEY,
  rate REAL NOT NULL,
  source TEXT NOT NULL,
  sample_size INTEGER NOT NULL DEFAULT 0,
  raw_median REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error_detail TEXT,
  recorded_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_exchange_rate_history_recorded ON exchange_rate_history(recorded_at DESC);

CREATE TABLE IF NOT EXISTS digitaltop_connection (
  id TEXT PRIMARY KEY CHECK(id='digitaltop'),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
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
  last_status TEXT NOT NULL DEFAULT 'Not configured',
  base_url TEXT NOT NULL DEFAULT 'https://api.digitaltop.core'
) STRICT;

CREATE TABLE IF NOT EXISTS digitaltop_catalog_items (
  external_id TEXT PRIMARY KEY,
  category_id TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  plan_options TEXT NOT NULL DEFAULT '[]',
  cost_minor INTEGER NOT NULL,
  selling_price_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  stock INTEGER NOT NULL DEFAULT 0,
  approval_status TEXT NOT NULL DEFAULT 'pending',
  product_id TEXT,
  raw_metadata TEXT NOT NULL DEFAULT '{}',
  snapshot_id TEXT,
  checked_at INTEGER NOT NULL,
  reviewed_at INTEGER
) STRICT;

INSERT INTO categories(id, name, slug, short_name, description, sort_order, active)
VALUES('c8402d52-37ef-4dfb-df2f-47cd20cd7004', 'AI Tools', 'server4', 'AI Tools', 'Authorized AI software, tools, licenses and subscriptions', 40, 1)
ON CONFLICT(slug) DO UPDATE SET name=excluded.name, active=1;

DROP VIEW IF EXISTS storefront_products;
DROP VIEW IF EXISTS verified_product_stock;

CREATE VIEW verified_product_stock AS
 SELECT p.id, CASE
  WHEN s4.external_id IS NOT NULL THEN
    CASE WHEN s4.approval_status='approved' AND sc4.enabled=1 AND s4.stock>0
      AND s4.checked_at > (CAST(unixepoch('now') AS INTEGER) - 86400) * 1000
    THEN s4.stock ELSE 0 END
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
 LEFT JOIN shopviaclone22_connection sc ON sc.id='shopviaclone22'
 LEFT JOIN digitaltop_catalog_items s4 ON s4.product_id=p.id
 LEFT JOIN digitaltop_connection sc4 ON sc4.id='digitaltop';

CREATE VIEW storefront_products AS
 SELECT p.id,p.category_id,p.slug,p.name,p.brand,p.description,p.price_minor,p.currency,p.delivery_type,p.image_path,p.term,p.features,p.supplier_image_urls,p.featured,v.available_quantity,p.server_number,p.supplier_name
 FROM products p JOIN categories c ON c.id=p.category_id JOIN verified_product_stock v ON v.id=p.id
 WHERE p.status='active' AND p.authorized_resale=1 AND p.publication_verified=1 AND c.active=1;

