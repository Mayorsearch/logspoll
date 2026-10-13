# Cloudflare authentication milestone — staging only

Better Auth 1.7.7 uses its native D1 adapter, maintained scrypt password hashing,
Secure/HttpOnly/SameSite=Lax signed cookies, origin/CSRF checks, database-backed
atomic rate limits, 15-minute verification/reset links and reset session revocation.
Verification JWTs additionally require a single-use atomic D1 token-hash claim.
Email ownership does not grant administrator access. The API independently reads
D1 roles and account restrictions. Public registration can only become a customer.
Password changes require the existing password or verified reset enrollment.
Email changes/account deletion are disabled for this migration milestone.

Official references: https://better-auth.com/docs/concepts/database and
https://better-auth.com/docs/authentication/email-password .

## Runtime and deployment

The existing Worker module is shared with same-origin Pages Functions, so existing
React pages use secure cookies without cross-origin token storage. Only the
mobile-preview build sets VITE_AUTH_PROVIDER=cloudflare. In this mode the browser
does not initialize Supabase. Production retains its old provider until cutover.
There is no separate demo login and no invented customer purchase activity.

Apply workers/api/migrations/0002_cloudflare_auth.sql only after 0001, staging first.
The new auth tables do not alter existing products, prices, approvals, users or
orders. Tests compare product records and foreign keys before/after auth operations.
New authenticated UUIDs are mapped to new customer records, never matched to
existing records by browser-supplied ID or email alone.

Pages preview needs DB, ENVIRONMENT=staging, AUTH_ENABLED=true,
AUTH_ORIGIN=https://mobile-preview.logspoll.pages.dev, a generated AUTH_SECRET,
and its already configured RESEND_API_KEY. The standalone staging Worker needs
its own AUTH_SECRET and RESEND_API_KEY: Pages secrets are NOT inherited. Both
runtimes sharing this staging D1 must use the same AUTH_SECRET for queued mail.
Set a missing Worker key interactively (never put it in source or shell arguments):

    npx wrangler secret put RESEND_API_KEY --config workers/api/wrangler.jsonc --env staging

The 5-minute Worker cron drains an encrypted D1 outbox without a running computer,
but cannot send until the standalone Resend key is bound. Each auth request also
attempts one delivery through Pages waitUntil. Provider idempotency keys and atomic
lease ownership make uncertain delivery retries safe; attempts are bounded to six
and 15 minutes, and encrypted payloads are deleted after acceptance or after a day.
Resend acceptance is not proof of inbox delivery. Resend outages leave pending
mail; users can request fresh links. Do not rotate AUTH_SECRET with pending outbox
entries without an explicit rotation plan. Expired/outstanding links are not logged.

Real verification, welcome, reset and password-change events use the existing
branded template renderer. No sample email function is used. Purchase, payment,
wallet and support notification triggers remain disconnected until those D1
business operations exist and their verified state transitions are tested.

## Verification and rollback

    npm test
    npm run build
    python3 scripts/verify-d1-staging.py
    npx wrangler d1 execute logspoll-d1-staging-20261012 --config workers/api/wrangler.jsonc --env staging --remote --command="SELECT count(*) AS users FROM auth_user; SELECT count(*) AS sessions FROM auth_session; SELECT count(*) AS pending_mail FROM auth_mail_outbox WHERE delivered_at IS NULL; PRAGMA foreign_key_check; PRAGMA quick_check;"

Do not SELECT tokens, password hashes or encrypted credential payloads for reports.
Test staging signup → inbox verification → login → profile → reset → old-session
revocation → logout; a customer must receive 403 at /api/admin/overview. Verify
cross-origin POST rejection and rate limiting. Cloudflare Access may require an
existing authorized browser session before Pages routes are reachable.

Rollback frontend by restoring the prior preview deployment/provider flag. Disable
AUTH_ENABLED on the staging Worker to lock auth. Preserve auth tables/outbox for
investigation; no destructive rollback SQL is necessary. Production is unaffected.

## Explicit remaining cutover gates

- Export/import actual customers, private identity mapping, existing roles, products,
  approval evidence, pricing overrides, orders, transactions and inventory, with
  counts, checksums, foreign keys and authorization checks. No password import.
- Reserve imported customer identities privately. Enroll via expiring single-use
  verified-email reset tokens into the ORIGINAL app UUID; admin assignment requires
  a separate trusted migration/owner action. Never attach old records during public
  registration solely because an email string matches.
- Port storefront, supplier credentials/resumable synchronization, support, reviews,
  and business writes to D1. Unported pages fail closed in Cloudflare mode; existing
  Supabase code remains solely for the unchanged legacy deployment/rollback.
- Verify auth/email end-to-end in staging with real Resend delivery and Free-plan
  CPU/subrequest limits. Local runtime success alone is not a live capacity test.
- Restore approved logspoll.com DNS/hosting before relying on production links or
  the existing hosted email logo. Pages preview remains behind Cloudflare Access.
- Keep payments and automatic supplier fulfillment disabled. Obtain explicit final
  production cutover approval, then switch all runtime readers/writers and remove
  the remaining Supabase runtime dependency. Do not uninstall it prematurely.
