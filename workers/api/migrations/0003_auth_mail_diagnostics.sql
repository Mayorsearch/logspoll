-- Additive staging migration. No credential or message bodies enter diagnostics.
ALTER TABLE auth_mail_outbox ADD COLUMN last_error TEXT;
ALTER TABLE auth_mail_outbox ADD COLUMN provider_message_id TEXT;
