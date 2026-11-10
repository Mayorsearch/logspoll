-- Migration 0036: Customer & Reseller API Keys
-- Allows verified customers to generate cryptographically random API keys (lp_live_...)
-- for automated reseller integration, catalog querying, and order placement.
-- Only the high-entropy SHA-256 hash is stored in D1.

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Reseller API Key',
  scopes TEXT NOT NULL DEFAULT '["read:catalog","orders:create","orders:read"]',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash, status);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id, status);
