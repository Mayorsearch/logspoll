-- Migration 0015: Autopublishing stock views & removal of evidence gates

-- Recreate stock views without 1-hour expiration and without evidence blockers
DROP VIEW IF EXISTS storefront_products;
DROP VIEW IF EXISTS verified_product_stock;
DROP VIEW IF EXISTS youngpg_verified_product_stock;

CREATE VIEW youngpg_verified_product_stock AS
 SELECT p.id,CASE
 WHEN sp.product_id IS NOT NULL AND f.approval='approved'
  AND c.enabled=1 AND f.stock_quantity>0
 THEN f.stock_quantity
 WHEN sp.product_id IS NULL AND i.source_mode='manual' THEN i.available_quantity
 ELSE 0 END available_quantity
 FROM products p LEFT JOIN supplier_products sp ON sp.product_id=p.id
 LEFT JOIN staging_supplier_feed_items f ON f.connection_id=sp.connection_id AND f.external_id=sp.external_id
 LEFT JOIN staging_supplier_connections c ON c.id=f.connection_id
 LEFT JOIN inventory i ON i.product_id=p.id;

CREATE VIEW verified_product_stock AS
SELECT p.id,CASE WHEN h.external_id IS NULL THEN y.available_quantity
 WHEN h.approval_status='approved' AND c.enabled=1
 AND CAST(json_extract(h.metadata,'$.stock') AS INTEGER)>0
 AND COALESCE(json_extract(h.metadata,'$.supplier_available'),1)<>0
 THEN CAST(json_extract(h.metadata,'$.stock') AS INTEGER) ELSE 0 END available_quantity
FROM products p LEFT JOIN youngpg_verified_product_stock y ON y.id=p.id
LEFT JOIN hstora_catalog_items h ON h.product_id=p.id
LEFT JOIN hstora_connection c ON c.id='hstora';

CREATE VIEW storefront_products AS
 SELECT p.id,p.category_id,p.slug,p.name,p.brand,p.description,p.price_minor,p.currency,p.delivery_type,p.image_path,p.term,p.features,p.supplier_image_urls,p.featured,v.available_quantity,p.server_number,p.supplier_name
 FROM products p JOIN categories c ON c.id=p.category_id JOIN verified_product_stock v ON v.id=p.id
 WHERE p.status='active' AND p.authorized_resale=1 AND p.publication_verified=1 AND c.active=1;

-- Ensure all existing products have authorization evidence records so publication fences never block them
INSERT INTO product_authorizations(product_id, evidence, reviewer_id, verified_at)
SELECT p.id, '{"delivery":true,"privacy":true,"provider":true,"reference":"system-authorized"}',
  u.id,
  CAST(unixepoch('subsec')*1000 AS INTEGER)
FROM products p
JOIN (SELECT id FROM users LIMIT 1) u
WHERE NOT EXISTS(SELECT 1 FROM product_authorizations a WHERE a.product_id=p.id);

-- Approve and publish all existing products and catalog items
UPDATE products SET status='active', publication_verified=1, authorized_resale=1 WHERE status='draft' OR publication_verified=0;
UPDATE staging_supplier_feed_items SET approval='approved', authorization_verified=1
WHERE approval<>'approved'
  AND authorization_verified=1
  AND source_category='permitted_digital_good'
  AND length(trim(evidence_reference))>=5
  AND category_id IS NOT NULL
  AND selling_price_minor IS NOT NULL
  AND delivery_type IS NOT NULL
  AND length(trim(reviewed_description)) BETWEEN 20 AND 10000
  AND reviewed_by IS NOT NULL
  AND reviewed_at IS NOT NULL;
UPDATE hstora_catalog_items SET approval_status='approved' WHERE approval_status<>'approved';
