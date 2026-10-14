-- Additive OTP abuse controls. Existing accounts, credentials and sessions are unchanged.
CREATE TABLE auth_otp_cooldowns(subject TEXT PRIMARY KEY,next_send_at INTEGER NOT NULL) STRICT;
-- One active code per email/purpose, including across Worker instances.
CREATE UNIQUE INDEX auth_email_otp_identifier_unique ON auth_verification(identifier)
 WHERE identifier LIKE 'email-verification-otp-%' OR identifier LIKE 'forget-password-otp-%';
ALTER TABLE auth_mail_outbox ADD COLUMN expires_at INTEGER;
ALTER TABLE auth_mail_outbox ADD COLUMN otp_subject TEXT;
CREATE INDEX auth_mail_otp_subject ON auth_mail_outbox(otp_subject);
