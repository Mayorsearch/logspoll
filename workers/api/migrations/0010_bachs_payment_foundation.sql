-- LogsPoll: additive Bachs payment-ledger foundation.
-- Safe to prepare before enabling checkout. Does NOT charge, pay, reserve, or fulfill orders.
-- Deploy with Wrangler D1 migrations only after verified production backup and preflight.
CREATE TABLE bachs_payment_attempts (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_request_id TEXT NOT NULL CHECK(length(client_request_id)=36),
  idempotency_key TEXT NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 12 AND 100),
  checkout_id TEXT UNIQUE CHECK(checkout_id IS NULL OR (length(checkout_id) BETWEEN 10 AND 104 AND checkout_id LIKE 'chk_%')),
  provider_mode TEXT NOT NULL CHECK(provider_mode IN ('sandbox','live')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 99999999900),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK(currency='NGN'),
  status TEXT NOT NULL DEFAULT 'initiating' CHECK(status IN ('initiating','open','paid','failed','expired','needs_review')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(customer_id, client_request_id)
) STRICT;
CREATE INDEX bachs_attempts_order_idx ON bachs_payment_attempts(order_id,created_at);
CREATE INDEX bachs_attempts_status_idx ON bachs_payment_attempts(status,updated_at);

-- Metadata only; NEVER store raw webhook payloads, bank details or supplier secrets.
CREATE TABLE bachs_webhook_events (
  event_id TEXT PRIMARY KEY NOT NULL CHECK(length(event_id) BETWEEN 9 AND 160),
  event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 3 AND 80),
  checkout_id TEXT CHECK(checkout_id IS NULL OR length(checkout_id) <= 104),
  attempt_id TEXT REFERENCES bachs_payment_attempts(id),
  processing_status TEXT NOT NULL DEFAULT 'received' CHECK(processing_status IN ('received','processed','ignored','needs_review')),
  received_at INTEGER NOT NULL,
  processed_at INTEGER
) STRICT;
CREATE INDEX bachs_events_attempt_idx ON bachs_webhook_events(attempt_id,received_at);

-- Future checkout code MUST atomically enforce available inventory minus other active holds.
-- Creating a reservation row by itself never authorizes fulfillment.
CREATE TABLE bachs_reservations (
  attempt_id TEXT NOT NULL REFERENCES bachs_payment_attempts(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000),
  state TEXT NOT NULL DEFAULT 'held' CHECK(state IN ('held','consumed','released')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(attempt_id, product_id)
) STRICT;
CREATE INDEX bachs_reservations_active_idx ON bachs_reservations(product_id,state,expires_at);
