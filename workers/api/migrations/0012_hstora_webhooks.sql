-- Additive webhook configuration and safe receipt metadata; never stores raw event payloads.
CREATE TABLE IF NOT EXISTS hstora_webhook_config (
 id TEXT PRIMARY KEY CHECK(id='hstora'),ciphertext TEXT NOT NULL,nonce TEXT NOT NULL,updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS hstora_webhook_events (
 event_id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL UNIQUE,event_type TEXT NOT NULL,external_id TEXT,
 body_hash TEXT NOT NULL,received_at INTEGER NOT NULL,processed_at INTEGER,
 status TEXT NOT NULL CHECK(status IN('applied','unavailable','ignored_disabled','ignored_unsupported','ignored_test','retry')),
 attempts INTEGER NOT NULL DEFAULT 1,last_error TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS hstora_webhook_recent ON hstora_webhook_events(received_at DESC);
