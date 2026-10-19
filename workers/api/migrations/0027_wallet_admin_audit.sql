-- Additive audit history. Existing wallet balances and transactions are unchanged.
CREATE TABLE wallet_admin_actions (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN ('freeze','unfreeze','credit','debit')),
  amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(amount_minor >= 0),
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 1000),
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX wallet_admin_actions_wallet ON wallet_admin_actions(wallet_id,created_at DESC);
CREATE TRIGGER wallet_admin_actions_no_update BEFORE UPDATE ON wallet_admin_actions
BEGIN SELECT RAISE(ABORT,'Wallet audit history is append-only'); END;
CREATE TRIGGER wallet_admin_actions_no_delete BEFORE DELETE ON wallet_admin_actions
BEGIN SELECT RAISE(ABORT,'Wallet audit history is append-only'); END;
