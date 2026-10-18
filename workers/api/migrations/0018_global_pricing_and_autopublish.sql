-- Migration 0018: Global 50% Pricing and Auto-Publishing System

CREATE TABLE IF NOT EXISTS global_pricing_config (
  id TEXT PRIMARY KEY CHECK(id='global'),
  markup_bps INTEGER NOT NULL DEFAULT 5000 CHECK(markup_bps BETWEEN 0 AND 1000000),
  auto_publish INTEGER NOT NULL DEFAULT 0 CHECK(auto_publish IN(0,1)),
  automatic_pricing INTEGER NOT NULL DEFAULT 0 CHECK(automatic_pricing IN(0,1)),
  auto_approve INTEGER NOT NULL DEFAULT 0 CHECK(auto_approve IN(0,1)),
  usd_to_ngn_rate REAL NOT NULL DEFAULT 1500.0 CHECK(usd_to_ngn_rate > 0),
  delivery_type TEXT NOT NULL DEFAULT 'Subscription activation',
  updated_by TEXT REFERENCES users(id),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
) STRICT;

INSERT INTO global_pricing_config (id, markup_bps, auto_publish, automatic_pricing, auto_approve, usd_to_ngn_rate, delivery_type, updated_at)
VALUES ('global', 5000, 0, 0, 0, 1500.0, 'Subscription activation', CAST(unixepoch('subsec')*1000 AS INTEGER))
ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS global_publishing_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  markup_bps INTEGER NOT NULL,
  items_count INTEGER NOT NULL DEFAULT 0,
  actor_id TEXT REFERENCES users(id),
  status TEXT NOT NULL,
  details TEXT,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_global_publishing_events_created ON global_publishing_events(created_at DESC);
