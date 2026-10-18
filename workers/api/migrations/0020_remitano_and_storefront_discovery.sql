-- Migration 0020: Remitano P2P Dynamic FX, Quidax Spot Proxy Backup, and Storefront Discovery Configuration

ALTER TABLE global_pricing_config ADD COLUMN remitano_access_key TEXT;
ALTER TABLE global_pricing_config ADD COLUMN remitano_secret_key TEXT;
ALTER TABLE global_pricing_config ADD COLUMN remitano_base_url TEXT NOT NULL DEFAULT 'https://api.remitano.com';
ALTER TABLE global_pricing_config ADD COLUMN fx_backup_source TEXT NOT NULL DEFAULT 'none';
ALTER TABLE global_pricing_config ADD COLUMN quidax_backup_enabled INTEGER NOT NULL DEFAULT 0;

UPDATE global_pricing_config SET fx_source = 'remitano_p2p' WHERE fx_source = 'bybit_p2p';

CREATE TABLE IF NOT EXISTS storefront_discovery_config (
  id TEXT PRIMARY KEY CHECK(id='global'),
  rotation_enabled INTEGER NOT NULL DEFAULT 1 CHECK(rotation_enabled IN (0,1)),
  affordable_priority_enabled INTEGER NOT NULL DEFAULT 1 CHECK(affordable_priority_enabled IN (0,1)),
  affordable_max_minor INTEGER NOT NULL DEFAULT 1500000,
  affordable_weight INTEGER NOT NULL DEFAULT 65,
  featured_weight INTEGER NOT NULL DEFAULT 20,
  new_weight INTEGER NOT NULL DEFAULT 15,
  products_per_page INTEGER NOT NULL DEFAULT 20,
  updated_at INTEGER NOT NULL DEFAULT 0
) STRICT;

INSERT INTO storefront_discovery_config(
  id, rotation_enabled, affordable_priority_enabled, affordable_max_minor,
  affordable_weight, featured_weight, new_weight, products_per_page, updated_at
)
VALUES('global', 1, 1, 1500000, 65, 20, 15, 20, CAST(unixepoch('now') AS INTEGER) * 1000)
ON CONFLICT(id) DO NOTHING;

DROP VIEW IF EXISTS storefront_products;

CREATE VIEW storefront_products AS
 SELECT p.id,p.category_id,p.slug,p.name,p.brand,p.description,p.price_minor,p.currency,p.delivery_type,p.image_path,p.term,p.features,p.supplier_image_urls,p.featured,v.available_quantity,p.server_number,p.supplier_name,p.created_at
 FROM products p JOIN categories c ON c.id=p.category_id JOIN verified_product_stock v ON v.id=p.id
 WHERE p.status='active' AND p.authorized_resale=1 AND p.publication_verified=1 AND c.active=1;
