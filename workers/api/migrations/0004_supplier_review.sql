-- Additive and STAGING-ONLY. Does not import, overwrite or delete any Supabase data.
-- No supplier credentials, customer login records, purchases or payment state live here.
CREATE TABLE staging_supplier_connections (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
  provider TEXT NOT NULL CHECK(provider='youngpg'),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 120),
  last_verified_scan_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
) STRICT;

-- An ingestion process must create *review-required* rows only after validating
-- supplier response shape and independently checking product-specific resale rights.
-- This migration deliberately does NOT implement that ingestion process.
CREATE TABLE staging_supplier_feed_items (
  connection_id TEXT NOT NULL REFERENCES staging_supplier_connections(id) ON DELETE RESTRICT,
  external_id TEXT NOT NULL CHECK(length(trim(external_id)) BETWEEN 1 AND 100),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
  source_category TEXT NOT NULL DEFAULT 'unclassified' CHECK(source_category IN ('unclassified','account_access','permitted_digital_good')),
  supplier_cost_minor INTEGER NOT NULL CHECK(supplier_cost_minor BETWEEN 0 AND 99999999900),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK(stock_quantity BETWEEN 0 AND 1000000),
  authorization_verified INTEGER NOT NULL DEFAULT 0 CHECK(authorization_verified IN (0,1)),
  evidence_reference TEXT NOT NULL DEFAULT '' CHECK(length(evidence_reference)<=1000),
  source_checked_at INTEGER NOT NULL,
  approval TEXT NOT NULL DEFAULT 'pending' CHECK(approval IN ('pending','approved','rejected')),
  category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  selling_price_minor INTEGER CHECK(selling_price_minor BETWEEN 0 AND 99999999900),
  delivery_type TEXT CHECK(delivery_type IN ('Licensed digital download','Redemption code','Subscription activation','Manual fulfillment')),
  reviewed_description TEXT CHECK(length(reviewed_description)<=10000),
  reviewed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at INTEGER,
  PRIMARY KEY(connection_id,external_id),
  CHECK(approval<>'approved' OR (
    authorization_verified=1 AND source_category='permitted_digital_good'
    AND length(trim(evidence_reference))>=5 AND category_id IS NOT NULL
    AND selling_price_minor IS NOT NULL AND delivery_type IS NOT NULL
    AND length(trim(reviewed_description)) BETWEEN 20 AND 10000
    AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
  ))
) STRICT;
CREATE INDEX staging_supplier_feed_approvals ON staging_supplier_feed_items(approval,source_checked_at);

-- Durable audit of review state transitions; no secrets, raw supplier payloads or tokens.
CREATE TABLE staging_supplier_review_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  previous_approval TEXT NOT NULL,
  new_approval TEXT NOT NULL,
  reviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER staging_supplier_review_audit
AFTER UPDATE OF approval ON staging_supplier_feed_items
WHEN NEW.approval <> OLD.approval
BEGIN
  INSERT INTO staging_supplier_review_events(connection_id,external_id,previous_approval,new_approval,reviewer_id,reviewed_at)
  VALUES (NEW.connection_id,NEW.external_id,OLD.approval,NEW.approval,NEW.reviewed_by,NEW.reviewed_at);
END;
