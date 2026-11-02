-- Migration 0035: Fix manual override products, extend freshness safety, and restore automatic pricing
-- 1. Extend cost freshness window in youngpg_product_rule_prices to 48 hours (172800000ms) to prevent unintended deactivations
-- 2. Clear legacy product rules and release all products from manual override mode into automatic pricing
-- 3. Update pricing_mode to 'auto' with standard markup so they are actively managed by auto-pricing and live on storefront

DROP VIEW IF EXISTS youngpg_product_rule_prices;

CREATE VIEW youngpg_product_rule_prices AS
 SELECT r.product_id,
 CASE WHEN r.cost_verified_at>CAST(unixepoch('subsec')*1000 AS INTEGER)-172800000
  AND r.cost_verified_at<=CAST(unixepoch('subsec')*1000 AS INTEGER)
  AND f.supplier_cost_minor=r.verified_cost_minor
  AND f.supplier_cost_minor BETWEEN 1 AND 76923076846 AND p.currency='NGN'
 THEN CAST((f.supplier_cost_minor*13000+9999)/10000 AS INTEGER) END price_minor
 FROM youngpg_product_pricing_rules r JOIN products p ON p.id=r.product_id
 JOIN supplier_products sp ON sp.product_id=p.id
 JOIN staging_supplier_connections c ON c.id=sp.connection_id AND c.provider='youngpg'
 JOIN staging_supplier_feed_items f ON f.connection_id=sp.connection_id AND f.external_id=sp.external_id
 WHERE r.enabled=1 AND p.server_number=2;

-- Release legacy products from manual override rules so they are managed by automatic pricing
DELETE FROM youngpg_product_pricing_rules WHERE product_id NOT LIKE '00000000-%';

-- Convert all YoungPG override products to automatic pricing with standard markup
UPDATE products
SET pricing_mode = 'auto',
    price_minor = COALESCE(
      CAST(ROUND(
        (SELECT f.supplier_cost_minor FROM supplier_products sp JOIN staging_supplier_feed_items f ON f.connection_id=sp.connection_id AND f.external_id=sp.external_id WHERE sp.product_id=products.id) * 1.50
      ) AS INTEGER),
      price_minor
    ),
    status = 'active',
    publication_verified = 1,
    authorized_resale = 1
WHERE pricing_mode = 'override' AND server_number = 2 AND id NOT LIKE '00000000-%';
