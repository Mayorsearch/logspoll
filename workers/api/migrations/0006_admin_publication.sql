-- Additive D1 admin/publication support. No users, products, prices or approvals deleted.
ALTER TABLE products ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'override' CHECK(pricing_mode IN ('auto','override'));
CREATE TABLE product_authorizations(product_id TEXT PRIMARY KEY REFERENCES products(id),evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 5 AND 1000),reviewer_id TEXT NOT NULL REFERENCES users(id),verified_at INTEGER NOT NULL) STRICT;
CREATE TABLE supplier_products(connection_id TEXT NOT NULL,external_id TEXT NOT NULL,product_id TEXT NOT NULL UNIQUE REFERENCES products(id),PRIMARY KEY(connection_id,external_id),FOREIGN KEY(connection_id,external_id) REFERENCES staging_supplier_feed_items(connection_id,external_id)) STRICT;
CREATE TABLE supplier_snapshots(id TEXT PRIMARY KEY,connection_id TEXT NOT NULL REFERENCES staging_supplier_connections(id),revision INTEGER NOT NULL,started_at INTEGER NOT NULL,completed_at INTEGER NOT NULL) STRICT;
INSERT INTO supplier_snapshots SELECT id,connection_id,revision,started_at,completed_at FROM supplier_sync_jobs WHERE phase='complete' AND scanned=total AND completed_at IS NOT NULL;
CREATE TABLE admin_invitations(user_id TEXT PRIMARY KEY REFERENCES users(id),invited_by TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL,accepted_at INTEGER) STRICT;
CREATE TABLE admin_write_fences(id TEXT PRIMARY KEY,valid INTEGER NOT NULL CHECK(valid=1)) STRICT;
CREATE VIEW verified_product_stock AS
 SELECT p.id,CASE
 WHEN sp.product_id IS NOT NULL AND f.approval='approved' AND f.authorization_verified=1 AND f.source_category='permitted_digital_good'
  AND c.enabled=1 AND s.revision=c.revision AND s.completed_at<=CAST(unixepoch('subsec')*1000 AS INTEGER)
  AND f.source_checked_at<=CAST(unixepoch('subsec')*1000 AS INTEGER) AND f.source_checked_at>(unixepoch('now')-3600)*1000
  AND EXISTS(SELECT 1 FROM json_each(c.authorized_products) a WHERE a.key=f.external_id AND a.value=f.evidence_reference)
 THEN f.stock_quantity
 WHEN sp.product_id IS NULL AND i.source_mode='manual' AND a.product_id IS NOT NULL
  AND julianday(i.verified_at)<=julianday('now') AND julianday(i.verified_at)>julianday('now','-1 hour') THEN i.available_quantity
 ELSE 0 END available_quantity
 FROM products p LEFT JOIN supplier_products sp ON sp.product_id=p.id
 LEFT JOIN staging_supplier_feed_items f ON f.connection_id=sp.connection_id AND f.external_id=sp.external_id
 LEFT JOIN staging_supplier_connections c ON c.id=f.connection_id LEFT JOIN supplier_snapshots s ON s.id=f.snapshot_id AND s.connection_id=f.connection_id
 LEFT JOIN inventory i ON i.product_id=p.id LEFT JOIN product_authorizations a ON a.product_id=p.id;
CREATE VIEW storefront_products AS
 SELECT p.id,p.category_id,p.slug,p.name,p.brand,p.description,p.price_minor,p.currency,p.delivery_type,p.image_path,p.term,p.features,p.supplier_image_urls,p.featured,v.available_quantity
 FROM products p JOIN categories c ON c.id=p.category_id JOIN verified_product_stock v ON v.id=p.id
 WHERE p.status='active' AND p.authorized_resale=1 AND p.publication_verified=1 AND c.active=1;
CREATE TRIGGER supplier_product_refresh AFTER UPDATE ON staging_supplier_feed_items BEGIN
 UPDATE products SET price_minor=CASE WHEN pricing_mode='auto' THEN NEW.supplier_cost_minor ELSE price_minor END,
 supplier_image_urls=NEW.supplier_image_urls,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id=(SELECT product_id FROM supplier_products WHERE connection_id=NEW.connection_id AND external_id=NEW.external_id);
 UPDATE products SET status='inactive',publication_verified=0 WHERE NEW.approval<>'approved'
 AND id=(SELECT product_id FROM supplier_products WHERE connection_id=NEW.connection_id AND external_id=NEW.external_id);
END;
CREATE TABLE business_mail_events(id TEXT PRIMARY KEY,kind TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,queued_at INTEGER) STRICT;
CREATE TRIGGER administrator_role_audit AFTER UPDATE OF role ON user_roles WHEN NEW.role='admin' AND OLD.role<>'admin' BEGIN
 INSERT INTO audit_logs(id,actor_id,table_name,record_id,action) VALUES(lower(hex(randomblob(16))),NULL,'user_roles',NEW.user_id,'UPDATE');
 INSERT INTO business_mail_events(id,kind,user_id,created_at) VALUES(lower(hex(randomblob(16))),'security_alert',NEW.user_id,CAST(unixepoch('subsec')*1000 AS INTEGER));
END;
