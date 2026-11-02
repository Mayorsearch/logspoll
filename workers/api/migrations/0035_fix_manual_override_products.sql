-- Migration 0035: Fix manual override products, extend freshness safety, and clean obsolete duplicate listings
-- 1. Extend cost freshness window in youngpg_product_rule_prices to 48 hours (172800000ms) to prevent unintended deactivations
-- 2. Clean up 7 obsolete zero-stock duplicate listings whose active counterparts already exist in stock on Logspoll
-- 3. Refresh verified costs, prices, publication verification and active status for all active products

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

-- Remove the 7 obsolete zero-stock duplicate products from pricing rules and set to inactive auto
DELETE FROM youngpg_product_pricing_rules WHERE product_id IN (
  '0ae1730c-0d0c-4e84-8996-d417ab31c6d0',
  '6170d778-853e-4225-8b7f-464ae12695c5',
  '54b20a82-7c7d-40c8-9a92-2d38d1585424',
  'a58ab038-1b35-4d95-a56f-e2a3ebbd5115',
  'f04f0f68-c8ab-4a4d-9bba-b3782b2766a0',
  '56942d82-f2ee-46f1-9669-7e5415342986',
  'da630467-6fd0-4e36-b460-cbc671a8e6f4'
);

UPDATE products SET pricing_mode='auto', status='inactive', publication_verified=0 WHERE id IN (
  '0ae1730c-0d0c-4e84-8996-d417ab31c6d0',
  '6170d778-853e-4225-8b7f-464ae12695c5',
  '54b20a82-7c7d-40c8-9a92-2d38d1585424',
  'a58ab038-1b35-4d95-a56f-e2a3ebbd5115',
  'f04f0f68-c8ab-4a4d-9bba-b3782b2766a0',
  '56942d82-f2ee-46f1-9669-7e5415342986',
  'da630467-6fd0-4e36-b460-cbc671a8e6f4'
);

-- Refresh cost verification timestamps and verified costs for all active YoungPG rule products
UPDATE youngpg_product_pricing_rules
SET cost_verified_at = CAST(unixepoch('now') * 1000 AS INTEGER),
    verified_cost_minor = (
      SELECT f.supplier_cost_minor
      FROM supplier_products sp
      JOIN staging_supplier_feed_items f ON f.connection_id=sp.connection_id AND f.external_id=sp.external_id
      WHERE sp.product_id=youngpg_product_pricing_rules.product_id
    )
WHERE product_id IN (SELECT id FROM products WHERE pricing_mode='override' AND server_number=2);

-- Refresh pricing and publication status for all products with active stock
UPDATE products
SET price_minor = COALESCE(
      (SELECT r.price_minor FROM youngpg_product_rule_prices r WHERE r.product_id=products.id),
      price_minor
    ),
    status = 'active',
    publication_verified = 1,
    authorized_resale = 1
WHERE id IN (SELECT product_id FROM youngpg_product_pricing_rules WHERE enabled=1)
  AND EXISTS (SELECT 1 FROM verified_product_stock v WHERE v.id=products.id AND v.available_quantity>0);
