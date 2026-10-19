-- Migration 0026: Complete Customer Wallet System & Financial Ledger

ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'bachs';

CREATE TABLE wallets (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
  customer_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK(currency='NGN'),
  balance_minor INTEGER NOT NULL DEFAULT 0 CHECK(balance_minor >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'frozen', 'closed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX wallets_customer ON wallets(customer_id);
CREATE INDEX wallets_status ON wallets(status);

CREATE TABLE wallet_funding_attempts (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
  customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  reference TEXT NOT NULL UNIQUE CHECK(reference LIKE 'WF-%'),
  checkout_id TEXT UNIQUE CHECK(checkout_id IS NULL OR checkout_id LIKE 'chk_%'),
  provider_mode TEXT NOT NULL CHECK(provider_mode IN ('sandbox', 'live')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 10000 AND 1000000000),
  fee_minor INTEGER NOT NULL DEFAULT 0 CHECK(fee_minor >= 0),
  credited_minor INTEGER NOT NULL CHECK(credited_minor > 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'initiating' CHECK(status IN ('initiating', 'open', 'paid', 'failed', 'expired', 'cancelled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX wallet_funding_customer ON wallet_funding_attempts(customer_id, created_at DESC);
CREATE INDEX wallet_funding_checkout ON wallet_funding_attempts(checkout_id);
CREATE INDEX wallet_funding_reference ON wallet_funding_attempts(reference);

CREATE TABLE wallet_transactions (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
  wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reference TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK(type IN ('funding', 'purchase', 'refund', 'admin_adjustment', 'reversal')),
  direction TEXT NOT NULL CHECK(direction IN ('credit', 'debit')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  balance_before_minor INTEGER NOT NULL DEFAULT 0 CHECK(balance_before_minor >= 0),
  balance_after_minor INTEGER NOT NULL CHECK(balance_after_minor >= 0),
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('pending', 'completed', 'failed', 'reversed', 'refunded')),
  order_id TEXT REFERENCES orders(id) ON DELETE RESTRICT,
  funding_attempt_id TEXT REFERENCES wallet_funding_attempts(id) ON DELETE RESTRICT,
  actor_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX wallet_tx_customer ON wallet_transactions(customer_id, created_at DESC);
CREATE INDEX wallet_tx_wallet ON wallet_transactions(wallet_id, created_at DESC);
CREATE INDEX wallet_tx_order ON wallet_transactions(order_id);
CREATE INDEX wallet_tx_reference ON wallet_transactions(reference);

-- Queue fulfillment jobs for orders paid via wallet transaction
CREATE TRIGGER queue_verified_wallet_order AFTER UPDATE OF payment_status ON orders
 WHEN NEW.payment_status='paid' AND OLD.payment_status<>'paid'
 AND EXISTS(SELECT 1 FROM wallet_transactions w WHERE w.order_id=NEW.id AND w.type='purchase' AND w.direction='debit' AND w.status='completed' AND w.amount_minor=NEW.total_minor)
 BEGIN
 INSERT OR IGNORE INTO fulfillment_jobs(order_item_id,order_id,request_id,created_at,updated_at)
 SELECT i.id,i.order_id,'delivery_'||i.id,CAST(unixepoch('subsec')*1000 AS INTEGER),CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM order_items i WHERE i.order_id=NEW.id AND NOT EXISTS(SELECT 1 FROM product_entitlements e WHERE e.order_item_id=i.id);
 END;

-- Backfill wallets for existing users (with ₦0.00 balance)
INSERT OR IGNORE INTO wallets (id, customer_id, currency, balance_minor, status, created_at, updated_at)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
  id,
  'NGN',
  0,
  'active',
  CAST(unixepoch('subsec')*1000 AS INTEGER),
  CAST(unixepoch('subsec')*1000 AS INTEGER)
FROM users;

