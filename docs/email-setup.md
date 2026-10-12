# LOGSPOLL email setup — safe checkpoint

Implemented: one shared kit-based layout; 22 HTML/plain-text templates; escaped customer fields; admin desktop/mobile/text previews at `/admin/settings/email-notifications`; authenticated Pages Function test sender. Text wordmark remains readable with images blocked; the supplied optional PNG is at `/email/logspoll-email-logo.png` after deployment. Nunito Sans is used when available; clients that cannot load it use Arial/Helvetica. No external fonts, tracking pixels, or sensitive fulfillment data.

**No provider account, DNS, SMTP, production settings, database, or deployment was changed. No real emails were sent.** Automatic business-event email is deliberately not enabled. Current signup/resend/reset calls still use Supabase Auth. Authentication templates become active only after installing them in Supabase.

## Provider and sender

Use Resend's native HTTPS API from Pages Functions; no SDK/dependencies are needed. Its published free allowance is currently 3,000 emails/month and 100/day; confirm limits before signup: [pricing](https://resend.com/pricing). Cloudflare Email Routing can receive/forward mail; it is not this outbound transactional transport.

1. Register a Resend account and add `logspoll.com`. Verify domain ownership before sending as `no-reply@logspoll.com`. Use a sending-only API key restricted to this domain. `support@logspoll.com` and `billing@logspoll.com` remain proposed addresses; configure actual receiving/forwarding before advertising replies to them. Templates currently link to the existing support page.
2. In Cloudflare DNS, copy the **exact generated** Resend SPF, DKIM and return-path/MX records. Keep DNS-only records where required. Do not replace existing root mail MX or create a second SPF record at the same hostname; merge authorized senders if necessary. Record values depend on the verified domain/region; none are invented here. [Domain verification](https://resend.com/docs/dashboard/domains/introduction).
3. Add/review `_dmarc.logspoll.com` with `v=DMARC1; p=none` initially; use a monitored reporting mailbox only after creating it. Verify SPF/DKIM alignment with test headers, then deliberately raise policy after reviewing legitimate mail. Preserve existing stricter policy if already configured. [DMARC](https://resend.com/docs/dashboard/domains/dmarc).
4. Keep auth click tracking disabled; provider rewriting and email link prefetching can consume one-time links. [Supabase template guidance](https://supabase.com/docs/guides/auth/auth-email-templates).

## Supabase Auth (manual, staging first)

Configure **Authentication → Email → SMTP** only after the domain is verified: host `smtp.resend.com`, TLS port `465`, username `resend`, password = server-only sending API key, sender name `LOGSPOLL`, sender email `no-reply@logspoll.com`. [Resend SMTP](https://resend.com/docs/send-with-smtp), [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

Install `emails/supabase/verification.html` as Confirm signup and `password_reset.html` as Reset password, with subjects in `manifest.json`. They use Supabase's native `{{ .ConfirmationURL }}`; do not paste preview links or generate tokens yourself. Set/review OTP expiration, email confirmation and rate limits in staging. Leave existing production Auth settings unchanged until approved. Auth greetings use “Hi there” to avoid unsafe rendering of untrusted user metadata. The plain-text files are companion artifacts; Supabase's dashboard manages the HTML body, so verify actual MIME parts in a test inbox.

Install `password_changed.html` and `email_changed.html` in the corresponding Supabase security notification templates and enable those native notifications in staging. They trigger from genuine Supabase events, not frontend sessions. These files notify of a completed change; keep Supabase's separate email-change **confirmation** workflow intact. No welcome/new-device event has been connected.

Preserve existing Site URL and approved redirect allowlist; verify `/auth/callback` and `/reset-password` for each approved staging/production origin. Test signup → confirmation → protected dashboard, resend/expired link, reset → new password → login, and native change notifications using synthetic users only.

## Cloudflare admin test sender (manual enable)

In the **preview** Pages environment, store `RESEND_API_KEY` as an encrypted secret. Configure `EMAIL_TEST_TO` as a dedicated, explicitly approved test inbox (server-only), `EMAIL_FROM=no-reply@logspoll.com`, and finally `EMAIL_TEST_ENABLED=true` only after verification. Defaults fail closed. Never put these values in `VITE_*`, the browser, Git or logs. Local placeholders are in `.dev.vars.example`; real values belong in ignored `.dev.vars`.

Open `/admin/settings/email-notifications` using a verified Supabase administrator. Preview any template and send synthetic data to the configured recipient; the browser cannot supply recipients or content. No customer lookup or business event occurs. Every test is labeled `[TEST]` and “SAMPLE EMAIL”. Provider **accepted** does not mean delivered; confirm delivery/bounce in Resend logs and the approved inbox.

Failed/uncertain requests retry with the same request ID and body. Resend deduplicates that key for 24 hours; this test path refuses retries after 23 hours and keeps year stable across midnight/year changes. Do not reload to start a new test after a timeout until checking provider logs. Changed content/config under the same key conflicts rather than silently duplicating. This is **not durable production event deduplication**. [Idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Remaining production work

- Transactional outbox migration (separate review/approval), unique server event/recipient key, transactionally enqueue only after verified committed business states. Private RLS, no credentials, encrypted/minimized recipient data, durable attempt/status logs, ownership/lease-safe retries, and retry horizon compatible with provider idempotency. Never roll back financial records because email fails.
- Connect welcome after verified activation, purchases/receipts after verified payment, delivery after confirmed fulfillment, support after committed updates; optional preferences must not disable mandatory security/transactional events. Wallet/refund/new-device/account-moderation features need reliable events first; templates alone do not implement them.
- Verify signed delivery/bounce webhooks and persist status before exposing delivery histories/retry queues in admin. Test duplicate/reordered events and crashes between provider acceptance and database acknowledgment in staging.
- Actual Gmail, Outlook and Apple Mail inbox testing, native plain-text MIME verification, domain deliverability and approved-recipient end-to-end tests remain. Browser previews are not proof of email-client compatibility.

Regenerate artifacts: `node --experimental-strip-types scripts/export-email-templates.mjs`. Open `emails/preview/index.html` locally (generated previews are ignored and excluded from the production bundle). Run `npm test && npm run build`. Deployment remains gated by the existing unapproved supplier checkpoint migration; this email slice adds **no SQL**.

## Verified locally

71 tests passed; production build and Wrangler Functions compilation passed. All 22 synthetic previews fit actual 375 px frames without horizontal overflow; representative desktop/mobile renders were visually inspected. New email code passes focused ESLint. `src/admin/Admin.tsx` retains its pre-existing `react-hooks/set-state-in-effect` finding in the database-loading effect; this email change does not modify that effect. Existing bundle-size warning remains. No live provider or mailbox delivery was tested.
