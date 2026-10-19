-- Migration 0025: Add structured_data to product_entitlements
-- Stores normalized structured representation alongside original supplier instructions
ALTER TABLE product_entitlements ADD COLUMN structured_data TEXT;
