-- Migration 0016: Category-based automatic pricing & trusted supplier authorization

CREATE TABLE IF NOT EXISTS supplier_category_rules (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('youngpg','hstora','shopviaclone22')),
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  markup_bps INTEGER NOT NULL DEFAULT 0 CHECK(markup_bps >= 0 AND markup_bps <= 1000000),
  trusted INTEGER NOT NULL DEFAULT 0 CHECK(trusted IN (0, 1)),
  authorization_reference TEXT NOT NULL DEFAULT '' CHECK(length(authorization_reference) <= 1000),
  delivery_type TEXT NOT NULL DEFAULT 'Manual fulfillment' CHECK(delivery_type IN ('Licensed digital download','Redemption code','Subscription activation','Manual fulfillment')),
  min_cost_minor INTEGER NOT NULL DEFAULT 1 CHECK(min_cost_minor >= 0),
  max_cost_minor INTEGER NOT NULL DEFAULT 99999999900 CHECK(max_cost_minor >= min_cost_minor),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, category_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_supplier_category_rules ON supplier_category_rules(provider, category_id);

-- Restore safe stock freshness policy (24-hour grace window)
DROP VIEW IF EXISTS storefront_products;
DROP VIEW IF EXISTS verified_product_stock;
DROP VIEW IF EXISTS youngpg_verified_product_stock;

CREATE VIEW youngpg_verified_product_stock AS
 SELECT p.id, CASE
  WHEN sp.product_id IS NOT NULL AND f.approval='approved'
   AND c.enabled=1 AND f.stock_quantity>0
   AND f.source_checked_at > (CAST(unixepoch('now') AS INTEGER) - 86400) * 1000
  THEN f.stock_quantity
  WHEN sp.product_id IS NULL AND i.source_mode='manual' THEN i.available_quantity
  ELSE 0 END available_quantity
 FROM products p LEFT JOIN supplier_products sp ON sp.product_id=p.id
 LEFT JOIN staging_supplier_feed_items f ON f.connection_id=sp.connection_id AND f.external_id=sp.external_id
 LEFT JOIN staging_supplier_connections c ON c.id=f.connection_id
 LEFT JOIN inventory i ON i.product_id=p.id;

CREATE VIEW verified_product_stock AS
 SELECT p.id, CASE
  WHEN h.external_id IS NULL THEN y.available_quantity
  WHEN h.approval_status='approved' AND c.enabled=1
   AND CAST(json_extract(h.metadata,'$.stock') AS INTEGER)>0
   AND COALESCE(json_extract(h.metadata,'$.supplier_available'),1)<>0
   AND h.checked_at > (CAST(unixepoch('now') AS INTEGER) - 86400) * 1000
  THEN CAST(json_extract(h.metadata,'$.stock') AS INTEGER) ELSE 0 END available_quantity
 FROM products p LEFT JOIN youngpg_verified_product_stock y ON y.id=p.id
 LEFT JOIN hstora_catalog_items h ON h.product_id=p.id
 LEFT JOIN hstora_connection c ON c.id='hstora';

CREATE VIEW storefront_products AS
 SELECT p.id,p.category_id,p.slug,p.name,p.brand,p.description,p.price_minor,p.currency,p.delivery_type,p.image_path,p.term,p.features,p.supplier_image_urls,p.featured,v.available_quantity,p.server_number,p.supplier_name
 FROM products p JOIN categories c ON c.id=p.category_id JOIN verified_product_stock v ON v.id=p.id
 WHERE p.status='active' AND p.authorized_resale=1 AND p.publication_verified=1 AND c.active=1;

