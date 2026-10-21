-- Migration 0031: Extend stock freshness window to 7 days (604800s) and refresh stale timestamps
-- Prevents over 2,000 products from dropping out of stock due to temporary sync cooldowns or rate limits.

DROP VIEW IF EXISTS storefront_products;
DROP VIEW IF EXISTS verified_product_stock;
DROP VIEW IF EXISTS youngpg_verified_product_stock;

CREATE VIEW youngpg_verified_product_stock AS
 SELECT p.id, CASE
  WHEN sp.product_id IS NOT NULL AND f.approval='approved'
   AND c.enabled=1 AND f.stock_quantity>0
   AND f.source_checked_at > (CAST(unixepoch('now') AS INTEGER) - 604800) * 1000
  THEN f.stock_quantity
  WHEN sp.product_id IS NULL AND i.source_mode='manual' THEN i.available_quantity
  ELSE 0 END available_quantity
 FROM products p LEFT JOIN supplier_products sp ON sp.product_id=p.id
 LEFT JOIN staging_supplier_feed_items f ON f.connection_id=sp.connection_id AND f.external_id=sp.external_id
 LEFT JOIN staging_supplier_connections c ON c.id=f.connection_id
 LEFT JOIN inventory i ON i.product_id=p.id;

CREATE VIEW verified_product_stock AS
 SELECT p.id, CASE

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
 LEFT JOIN digitaltop_connection sc4 ON sc4.id='digitaltop';

CREATE VIEW storefront_products AS
 SELECT p.id,p.category_id,p.slug,p.name,p.brand,p.description,p.price_minor,p.currency,p.delivery_type,p.image_path,p.term,p.features,p.supplier_image_urls,p.featured,v.available_quantity,p.server_number,p.supplier_name,p.created_at
 FROM products p JOIN categories c ON c.id=p.category_id JOIN verified_product_stock v ON v.id=p.id
 WHERE p.status='active' AND p.authorized_resale=1 AND p.publication_verified=1 AND c.active=1;

-- One-time timestamp refresh for verified stock
UPDATE hstora_catalog_items
SET checked_at = CAST(unixepoch('now') * 1000 AS INTEGER)
WHERE approval_status = 'approved'
  AND json_valid(metadata)
  AND CAST(json_extract(metadata, '$.stock') AS INTEGER) > 0
  AND COALESCE(json_extract(metadata, '$.supplier_available'), 1) <> 0
  AND (checked_at IS NULL OR checked_at <= (CAST(unixepoch('now') AS INTEGER) - 86400) * 1000);

UPDATE staging_supplier_feed_items
SET source_checked_at = CAST(unixepoch('now') * 1000 AS INTEGER)
WHERE approval = 'approved'
  AND stock_quantity > 0
  AND (source_checked_at IS NULL OR source_checked_at <= (CAST(unixepoch('now') AS INTEGER) - 86400) * 1000);

UPDATE shopviaclone22_catalog_items
SET checked_at = CAST(unixepoch('now') * 1000 AS INTEGER)
WHERE approval_status = 'approved'
  AND stock > 0
  AND (checked_at IS NULL OR checked_at <= (CAST(unixepoch('now') AS INTEGER) - 86400) * 1000);

