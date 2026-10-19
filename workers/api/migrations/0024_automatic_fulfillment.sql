-- Additive delivery queue. Only Bachs-verified paid orders can enter it.
CREATE TABLE fulfillment_jobs (
 order_item_id TEXT PRIMARY KEY REFERENCES order_items(id) ON DELETE RESTRICT,
 order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
 request_id TEXT NOT NULL UNIQUE,
 provider TEXT, external_id TEXT, receipt TEXT,
 state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN('queued','preparing','dispatched','waiting','retry','blocked','uncertain','delivered')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
 lease_owner TEXT, lease_until INTEGER, last_error TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX fulfillment_jobs_ready ON fulfillment_jobs(state,next_attempt,created_at);
CREATE INDEX fulfillment_jobs_order ON fulfillment_jobs(order_id,state);
CREATE TRIGGER queue_verified_paid_order AFTER UPDATE OF payment_status ON orders
 WHEN NEW.payment_status='paid' AND OLD.payment_status<>'paid'
 AND EXISTS(SELECT 1 FROM bachs_payment_attempts a WHERE a.order_id=NEW.id AND a.status='paid' AND a.currency=NEW.currency AND a.amount_minor=NEW.total_minor)
 BEGIN
 INSERT OR IGNORE INTO fulfillment_jobs(order_item_id,order_id,request_id,created_at,updated_at)
 SELECT i.id,i.order_id,'delivery_'||i.id,CAST(unixepoch('subsec')*1000 AS INTEGER),CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM order_items i WHERE i.order_id=NEW.id AND NOT EXISTS(SELECT 1 FROM product_entitlements e WHERE e.order_item_id=i.id);
 END;
-- Recover existing genuinely paid but undelivered items without touching orders or inventory.
INSERT OR IGNORE INTO fulfillment_jobs(order_item_id,order_id,request_id,created_at,updated_at)
SELECT i.id,i.order_id,'delivery_'||i.id,CAST(unixepoch('subsec')*1000 AS INTEGER),CAST(unixepoch('subsec')*1000 AS INTEGER)
FROM order_items i JOIN orders o ON o.id=i.order_id
WHERE o.payment_status='paid' AND o.fulfillment_status<>'delivered'
AND EXISTS(SELECT 1 FROM bachs_payment_attempts a WHERE a.order_id=o.id AND a.status='paid' AND a.currency=o.currency AND a.amount_minor=o.total_minor)
AND NOT EXISTS(SELECT 1 FROM product_entitlements e WHERE e.order_item_id=i.id);
