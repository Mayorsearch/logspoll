-- Migration 0028: Temporary Bank Transfer Details for Live Wallet Funding
ALTER TABLE wallet_funding_attempts ADD COLUMN bank_details TEXT;
