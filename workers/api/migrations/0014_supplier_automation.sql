-- Additive, disabled by default; no existing prices, approvals or orders change.
CREATE TABLE supplier_automation (
 provider TEXT PRIMARY KEY CHECK(provider IN('youngpg','hstora','shopviaclone22')),
 auto_approve INTEGER NOT NULL DEFAULT 0 CHECK(auto_approve IN(0,1)),
 review_reference TEXT NOT NULL DEFAULT '',delivery_type TEXT NOT NULL DEFAULT 'Manual fulfillment',approval_cursor TEXT NOT NULL DEFAULT '',
 markup_bps INTEGER NOT NULL DEFAULT 0 CHECK(markup_bps BETWEEN 0 AND 1000000),
 automatic_pricing INTEGER NOT NULL DEFAULT 0 CHECK(automatic_pricing IN(0,1)),
 auto_publish INTEGER NOT NULL DEFAULT 0 CHECK(auto_publish IN(0,1)),
 updated_by TEXT NOT NULL REFERENCES users(id),revision INTEGER NOT NULL DEFAULT 1,
 restore_pending INTEGER NOT NULL DEFAULT 0 CHECK(restore_pending IN(0,1)),run_requested INTEGER NOT NULL DEFAULT 0 CHECK(run_requested IN(0,1)),
 cursor TEXT NOT NULL DEFAULT '',lease_owner TEXT,lease_until INTEGER,
 last_run INTEGER,last_status TEXT NOT NULL DEFAULT 'Not run',processed INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE supplier_automation_log (
 id TEXT PRIMARY KEY,provider TEXT NOT NULL,product_id TEXT NOT NULL REFERENCES products(id),
 actor_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,
 old_price_minor INTEGER,new_price_minor INTEGER,cost_minor INTEGER,markup_bps INTEGER,
 created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX supplier_automation_log_latest ON supplier_automation_log(created_at);
-- Keep legacy automatic-cost pricing unchanged until this supplier is configured.
-- Configured markups are calculated by the bounded Worker, not overwritten by raw cost.
DROP TRIGGER supplier_product_refresh;
CREATE TRIGGER supplier_product_refresh AFTER UPDATE ON staging_supplier_feed_items BEGIN
 UPDATE products SET price_minor=CASE WHEN pricing_mode='auto' AND NOT EXISTS(SELECT 1 FROM supplier_automation WHERE provider='youngpg' AND automatic_pricing=1) THEN NEW.supplier_cost_minor ELSE price_minor END,
 supplier_image_urls=NEW.supplier_image_urls,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id=(SELECT product_id FROM supplier_products WHERE connection_id=NEW.connection_id AND external_id=NEW.external_id);
 UPDATE products SET status='inactive',publication_verified=0 WHERE NEW.approval<>'approved'
 AND id=(SELECT product_id FROM supplier_products WHERE connection_id=NEW.connection_id AND external_id=NEW.external_id);
END;
