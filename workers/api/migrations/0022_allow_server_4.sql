-- Migration 0022: Update server_number constraint on products to allow Server 4 (DigitalCore)
ALTER TABLE products ADD COLUMN server_number_backup INTEGER;

UPDATE products SET server_number_backup = server_number;

DROP VIEW IF EXISTS storefront_products;

ALTER TABLE products DROP COLUMN server_number;

ALTER TABLE products ADD COLUMN server_number INTEGER NOT NULL DEFAULT 2 CHECK(server_number IN (1, 2, 3, 4));

UPDATE products SET server_number = server_number_backup;

ALTER TABLE products DROP COLUMN server_number_backup;

CREATE VIEW storefront_products AS
 SELECT p.id,p.category_id,p.slug,p.name,p.brand,p.description,p.price_minor,p.currency,p.delivery_type,p.image_path,p.term,p.features,p.supplier_image_urls,p.featured,v.available_quantity,p.server_number,p.supplier_name,p.created_at
 FROM products p JOIN categories c ON c.id=p.category_id JOIN verified_product_stock v ON v.id=p.id
 WHERE p.status='active' AND p.authorized_resale=1 AND p.publication_verified=1 AND c.active=1;

