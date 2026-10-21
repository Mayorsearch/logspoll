-- Product-specific rules use the existing override boundary. Supplier/category
-- automation cannot replace them; only verified supplier costs change the price.
CREATE TABLE youngpg_product_pricing_rules (
 product_id TEXT PRIMARY KEY REFERENCES products(id),
 markup_bps INTEGER NOT NULL CHECK(markup_bps=3000),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 cost_verified_at INTEGER,
 verified_cost_minor INTEGER CHECK(verified_cost_minor IS NULL OR verified_cost_minor BETWEEN 1 AND 76923076846),
 created_at INTEGER NOT NULL,
 updated_by TEXT NOT NULL REFERENCES users(id)
);
CREATE VIEW youngpg_product_rule_prices AS
 SELECT r.product_id,
 CASE WHEN r.cost_verified_at>CAST(unixepoch('subsec')*1000 AS INTEGER)-86400000
  AND r.cost_verified_at<=CAST(unixepoch('subsec')*1000 AS INTEGER)
  AND f.supplier_cost_minor=r.verified_cost_minor
  AND f.supplier_cost_minor BETWEEN 1 AND 76923076846 AND p.currency='NGN'
 THEN CAST((f.supplier_cost_minor*13000+9999)/10000 AS INTEGER) END price_minor
 FROM youngpg_product_pricing_rules r JOIN products p ON p.id=r.product_id
 JOIN supplier_products sp ON sp.product_id=p.id
 JOIN staging_supplier_connections c ON c.id=sp.connection_id AND c.provider='youngpg'
 JOIN staging_supplier_feed_items f ON f.connection_id=sp.connection_id AND f.external_id=sp.external_id
 WHERE r.enabled=1 AND p.server_number=2;

CREATE TRIGGER youngpg_product_rule_priority AFTER UPDATE OF price_minor,pricing_mode ON products
 WHEN EXISTS(SELECT 1 FROM youngpg_product_rule_prices r WHERE r.product_id=NEW.id
  AND (NEW.pricing_mode<>'override' OR NEW.price_minor<>COALESCE(r.price_minor,OLD.price_minor)))
 BEGIN
 UPDATE products SET pricing_mode='override',
 price_minor=COALESCE((SELECT price_minor FROM youngpg_product_rule_prices WHERE product_id=NEW.id),OLD.price_minor)
 WHERE id=NEW.id;
 END;

-- Stock-only freshness updates cannot certify a previously stale cost. A changed
-- cost or new verified full snapshot supplies fresh cost evidence.
CREATE TRIGGER youngpg_product_rule_cost AFTER UPDATE OF supplier_cost_minor,snapshot_id ON staging_supplier_feed_items
 WHEN NEW.supplier_cost_minor IS NOT OLD.supplier_cost_minor OR NEW.snapshot_id IS NOT OLD.snapshot_id
 BEGIN
 UPDATE youngpg_product_pricing_rules SET cost_verified_at=NEW.source_checked_at,verified_cost_minor=NEW.supplier_cost_minor
 WHERE enabled=1 AND product_id IN (SELECT product_id FROM supplier_products
  WHERE connection_id=NEW.connection_id AND external_id=NEW.external_id)
 AND NEW.supplier_cost_minor BETWEEN 1 AND 76923076846
 AND NEW.source_checked_at>CAST(unixepoch('subsec')*1000 AS INTEGER)-86400000
 AND NEW.source_checked_at<=CAST(unixepoch('subsec')*1000 AS INTEGER)
 AND EXISTS(SELECT 1 FROM supplier_snapshots s JOIN staging_supplier_connections c ON c.id=s.connection_id
  WHERE s.id=NEW.snapshot_id AND s.connection_id=NEW.connection_id AND c.provider='youngpg'
  AND s.revision=c.revision AND s.completed_at<=NEW.source_checked_at);
 UPDATE products SET price_minor=(SELECT price_minor FROM youngpg_product_rule_prices WHERE product_id=products.id),
 pricing_mode='override'
 WHERE id IN (SELECT product_id FROM supplier_products WHERE connection_id=NEW.connection_id AND external_id=NEW.external_id)
 AND EXISTS(SELECT 1 FROM youngpg_product_rule_prices r WHERE r.product_id=products.id AND r.price_minor IS NOT NULL);
 END;

CREATE TRIGGER youngpg_product_rule_stale AFTER UPDATE ON staging_supplier_feed_items
 BEGIN
 UPDATE products SET status='inactive',publication_verified=0
 WHERE id IN (SELECT product_id FROM supplier_products WHERE connection_id=NEW.connection_id AND external_id=NEW.external_id)
 AND EXISTS(SELECT 1 FROM youngpg_product_rule_prices r WHERE r.product_id=products.id AND r.price_minor IS NULL);
 END;

CREATE TRIGGER youngpg_product_rule_publication AFTER UPDATE OF status,publication_verified ON products
 WHEN (NEW.status='active' OR NEW.publication_verified=1)
 AND EXISTS(SELECT 1 FROM youngpg_product_rule_prices r WHERE r.product_id=NEW.id AND r.price_minor IS NULL)
 BEGIN
 UPDATE products SET status='inactive',publication_verified=0 WHERE id=NEW.id;
 END;
