-- Add server_number column to distinguish products by supplier server origin.
ALTER TABLE products ADD COLUMN server_number INTEGER NOT NULL DEFAULT 2 CHECK(server_number IN(1,2,3));
UPDATE products SET server_number=1 WHERE id IN (SELECT product_id FROM hstora_catalog_items WHERE product_id IS NOT NULL);
DROP VIEW IF EXISTS storefront_products;
DROP VIEW IF EXISTS verified_product_stock;
DROP VIEW IF EXISTS youngpg_verified_product_stock;
CREATE VIEW youngpg_verified_product_stock AS
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
CREATE VIEW storefront_products AS
 SELECT p.id,p.category_id,p.slug,p.name,p.brand,p.description,p.price_minor,p.currency,p.delivery_type,p.image_path,p.term,p.features,p.supplier_image_urls,p.featured,v.available_quantity,p.server_number,p.supplier_name
 FROM products p JOIN categories c ON c.id=p.category_id JOIN verified_product_stock v ON v.id=p.id
 WHERE p.status='active' AND p.authorized_resale=1 AND p.publication_verified=1 AND c.active=1;
