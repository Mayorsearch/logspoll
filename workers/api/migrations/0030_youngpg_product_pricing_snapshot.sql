-- Catalog finalization writes feed rows before inserting the verified snapshot.
-- Certify and reprice selected products only after that snapshot is committed.
CREATE TRIGGER youngpg_product_rule_snapshot AFTER INSERT ON supplier_snapshots
 WHEN NEW.completed_at<=CAST(unixepoch('subsec')*1000 AS INTEGER)
 AND EXISTS(SELECT 1 FROM staging_supplier_connections c WHERE c.id=NEW.connection_id AND c.provider='youngpg' AND c.revision=NEW.revision)
 BEGIN
 UPDATE youngpg_product_pricing_rules SET
 cost_verified_at=(SELECT f.source_checked_at FROM supplier_products sp JOIN staging_supplier_feed_items f ON f.connection_id=sp.connection_id AND f.external_id=sp.external_id WHERE sp.product_id=youngpg_product_pricing_rules.product_id),
 verified_cost_minor=(SELECT f.supplier_cost_minor FROM supplier_products sp JOIN staging_supplier_feed_items f ON f.connection_id=sp.connection_id AND f.external_id=sp.external_id WHERE sp.product_id=youngpg_product_pricing_rules.product_id)
 WHERE enabled=1 AND product_id IN (
 SELECT sp.product_id FROM supplier_products sp JOIN staging_supplier_feed_items f ON f.connection_id=sp.connection_id AND f.external_id=sp.external_id
 WHERE f.connection_id=NEW.connection_id AND f.snapshot_id=NEW.id
 AND f.supplier_cost_minor BETWEEN 1 AND 76923076846
 AND f.source_checked_at>CAST(unixepoch('subsec')*1000 AS INTEGER)-86400000
 AND f.source_checked_at<=CAST(unixepoch('subsec')*1000 AS INTEGER));
 UPDATE products SET pricing_mode='override',price_minor=(SELECT r.price_minor FROM youngpg_product_rule_prices r WHERE r.product_id=products.id)
 WHERE id IN (SELECT sp.product_id FROM supplier_products sp JOIN staging_supplier_feed_items f ON f.connection_id=sp.connection_id AND f.external_id=sp.external_id WHERE f.connection_id=NEW.connection_id AND f.snapshot_id=NEW.id)
 AND EXISTS(SELECT 1 FROM youngpg_product_rule_prices r WHERE r.product_id=products.id AND r.price_minor IS NOT NULL);
 END;
