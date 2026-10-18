-- Migration 0023: Allow digitalcore in supplier_automation and supplier_category_rules

-- 0. Temporarily drop trigger referencing supplier_automation
DROP TRIGGER IF EXISTS supplier_product_refresh;

-- 1. Upgrade supplier_automation table to include digitalcore
CREATE TABLE supplier_automation_new (
 provider TEXT PRIMARY KEY CHECK(provider IN('youngpg','hstora','shopviaclone22','digitalcore','digitaltop')),
 auto_approve INTEGER NOT NULL DEFAULT 0 CHECK(auto_approve IN(0,1)),
 review_reference TEXT NOT NULL DEFAULT '',
 delivery_type TEXT NOT NULL DEFAULT 'Manual fulfillment',
 approval_cursor TEXT NOT NULL DEFAULT '',
 markup_bps INTEGER NOT NULL DEFAULT 0 CHECK(markup_bps BETWEEN 0 AND 1000000),
 automatic_pricing INTEGER NOT NULL DEFAULT 0 CHECK(automatic_pricing IN(0,1)),
 auto_publish INTEGER NOT NULL DEFAULT 0 CHECK(auto_publish IN(0,1)),
 updated_by TEXT NOT NULL REFERENCES users(id),
 revision INTEGER NOT NULL DEFAULT 1,
 restore_pending INTEGER NOT NULL DEFAULT 0 CHECK(restore_pending IN(0,1)),
 run_requested INTEGER NOT NULL DEFAULT 0 CHECK(run_requested IN(0,1)),
 cursor TEXT NOT NULL DEFAULT '',
 lease_owner TEXT,
 lease_until INTEGER,
 last_run INTEGER,
 last_status TEXT NOT NULL DEFAULT 'Not run',
 processed INTEGER NOT NULL DEFAULT 0
) STRICT;

INSERT INTO supplier_automation_new (
 provider, auto_approve, review_reference, delivery_type, approval_cursor,
 markup_bps, automatic_pricing, auto_publish, updated_by, revision,
 restore_pending, run_requested, cursor, lease_owner, lease_until,
 last_run, last_status, processed
)
SELECT
 provider, auto_approve, review_reference, delivery_type, approval_cursor,
 markup_bps, automatic_pricing, auto_publish, updated_by, revision,
 restore_pending, run_requested, cursor, lease_owner, lease_until,
 last_run, last_status, processed
FROM supplier_automation;

DROP TABLE supplier_automation;
ALTER TABLE supplier_automation_new RENAME TO supplier_automation;

-- Recreate trigger
CREATE TRIGGER supplier_product_refresh AFTER UPDATE ON staging_supplier_feed_items BEGIN
 UPDATE products SET price_minor=CASE WHEN pricing_mode='auto' AND NOT EXISTS(SELECT 1 FROM supplier_automation WHERE provider='youngpg' AND automatic_pricing=1) THEN NEW.supplier_cost_minor ELSE price_minor END,
 supplier_image_urls=NEW.supplier_image_urls,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id=(SELECT product_id FROM supplier_products WHERE connection_id=NEW.connection_id AND external_id=NEW.external_id);
 UPDATE products SET status='inactive',publication_verified=0 WHERE NEW.approval<>'approved'
 AND id=(SELECT product_id FROM supplier_products WHERE connection_id=NEW.connection_id AND external_id=NEW.external_id);
END;

-- 2. Upgrade supplier_category_rules table to include digitalcore
CREATE TABLE supplier_category_rules_new (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('youngpg','hstora','shopviaclone22','digitalcore','digitaltop')),
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  markup_bps INTEGER NOT NULL DEFAULT 0 CHECK(markup_bps >= 0 AND markup_bps <= 1000000),
  trusted INTEGER NOT NULL DEFAULT 0 CHECK(trusted IN (0, 1)),
  authorization_reference TEXT NOT NULL DEFAULT '' CHECK(length(authorization_reference) <= 1000),
  delivery_type TEXT NOT NULL DEFAULT 'Manual fulfillment' CHECK(delivery_type IN ('Licensed digital download','Redemption code','Subscription activation','Manual fulfillment')),
  min_cost_minor INTEGER NOT NULL DEFAULT 1 CHECK(min_cost_minor >= 0),
  max_cost_minor INTEGER NOT NULL DEFAULT 99999999900 CHECK(max_cost_minor >= min_cost_minor),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, category_id)
) STRICT;

INSERT INTO supplier_category_rules_new
SELECT * FROM supplier_category_rules;

DROP TABLE supplier_category_rules;
ALTER TABLE supplier_category_rules_new RENAME TO supplier_category_rules;
CREATE INDEX IF NOT EXISTS idx_supplier_category_rules ON supplier_category_rules(provider, category_id);

-- 3. Ensure digitalcore exists in supplier_automation if an admin user exists
INSERT INTO supplier_automation (
  provider, auto_approve, review_reference, delivery_type, markup_bps,
  automatic_pricing, auto_publish, updated_by, revision
)
SELECT
  'digitalcore', 1, 'DigitalCore authorized partner', 'Subscription activation', 7000,
  1, 1, id, 1
FROM users LIMIT 1;

