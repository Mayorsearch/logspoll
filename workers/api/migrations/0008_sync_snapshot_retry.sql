-- Additive retry marker. Never changes customer, product, approval, price or order rows.
-- Network failures retain their checkpoint. Only a proven changed snapshot is
-- marked for a fresh scan on the next owner-checked, cooldown-respecting retry.
ALTER TABLE supplier_sync_jobs ADD COLUMN restart_required INTEGER NOT NULL DEFAULT 0 CHECK(restart_required IN (0,1));
