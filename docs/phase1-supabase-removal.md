# Phase 1 status: staging API authentication verified, production cutover blocked

Cloudflare authentication already uses Better Auth, D1-backed sessions/roles and
Resend verification/reset mail. Existing production remains unchanged. This phase
does not modify Bachs or YoungPG synchronization. The existing staging Worker was
updated on 2026-10-13; production was not deployed.

## Completed locally

- Customer marketplace search, category counts, product details/images, cart price
  reads, support submissions, moderated reviews and delivered purchase instructions
  now use D1 endpoints when `VITE_AUTH_PROVIDER=cloudflare`.
- All private reads bind the authenticated D1 UUID. Delivery instructions require
  an owned, paid, delivered order. Reviews require that same eligibility, remain
  pending until moderation, and cannot be submitted twice for one item.
- Authenticated profile changes also update the corresponding D1 profile. Existing
  auth tests exercise registration, single-use verification, persistent HttpOnly
  sessions, reset/session revocation, logout, roles and account restrictions.
- Cloudflare builds alias the legacy browser database module to a null adapter.
  The Cloudflare browser bundle contains no Supabase SDK or Supabase configuration.
  Legacy production builds retain their old adapter for rollback until cutover.
- Access login HTML or malformed JSON cannot appear as a successful customer write.

## Safe existing-customer enrollment

`scripts/prepare-d1-customers.mjs` accepts only a trusted, private JSON array with
`id,email,full_name,role,status,created_at`. Never export passwords, password hashes,
refresh tokens or sessions. The tool writes owner-only SQL and a hash/count manifest
under ignored `.migration-private/`; it makes no network/database calls.

    node scripts/prepare-d1-customers.mjs /private/path/customers.json

Administrator records require separately reviewed `--allow-admin-import`; public
signup never assigns administrator roles. Review original roles against a trusted
source. Duplicate IDs/emails, identity collisions or profile/role/status drift fail
closed. Review generated statements and execute as ONE atomic D1 `batch`, first in
staging; do not split the SQL into independently committed commands. A checked
constraint deliberately aborts a mismatched import. No production migration was executed.

Imported users reserve their ORIGINAL application UUID and email in `auth_user`
with no password or credential account. Public signup cannot take that email.
The normal Resend reset flow consumes an expiring, single-use token, creates a
Better Auth hashed password and verifies the reserved inbox. The enrollment marker
is cleared atomically and existing restrictions/roles/orders stay attached to the
original UUID. Replaying an unchanged import does not reset an enrolled password.
Staging tests cover this transition and administrator access, with synthetic data.

Do not import into a database where a newly registered account already has the
same email under another UUID. Resolve that collision privately, with verified
ownership and reviewed record reconciliation; never automatically merge by email.

## Remaining gates before disconnecting Supabase

1. Production Worker remains `ENVIRONMENT=locked`, without a production D1 binding.
   Identify and approve the intended production database, secrets and same-origin
   routing. Staging D1 is not the production target and still contains synthetic fixtures.
2. No actual customer export/import or full business-data migration was performed.
   Rehearse importing original customers, roles, products, approvals, overrides,
   inventory, orders/items, entitlements and related records. Compare exact IDs,
   prices, counts/hashes, restrictions, foreign keys and ownership before cutover.
   The customer import tool is not a full business-data importer.
3. Full same-origin Pages browser verification through Cloudflare Access and actual
   imported-customer enrollment remain required. Staging Worker API auth/reset
   enrollment and real Resend delivery passed on 2026-10-13 (details below).
   That does not prove production migration or every browser/business route.
4. Legacy source dependencies remain in `src/lib/supabase.ts`, legacy branches of
   auth/customer/admin components, `server/auth.ts`, `server/catalog-sync.ts`,
   `server/bachs-auth.ts` and legacy Pages endpoints. `@supabase/supabase-js`, legacy
   environment settings, SQL and operational scripts remain for the unchanged
   production deployment. Removing the SDK now would break those paths. Payment
   and supplier backend retirement require their separately scoped phases.
5. D1 administrator business-management parity, transaction history and remaining
   business writes are unfinished. Payments and automatic fulfillment remain disabled.
6. Obtain production cutover approval after staging proof. Then switch all readers
   and writers together, remove legacy modules/dependencies/configuration and rerun
   the runtime reference scan/build. Keep archived migration history as documentation.

Supabase cannot safely be disconnected yet. Rollback requires no SQL: retain the
existing production deployment and its provider configuration. Local additive
code changes do not disable or delete the existing service or its customer data.

## Changed files

- `.gitignore`
- `docs/cloudflare-auth-cutover.md`
- `functions/api/_middleware.ts`
- `src/components/Reviews.tsx`
- `src/components/useCatalogCategories.ts`
- `src/lib/cloudflare-auth.ts`
- `src/pages/Cart.tsx`
- `src/pages/Dashboard.tsx`
- `src/pages/ExtraPages.tsx`
- `src/pages/Marketplace.tsx`
- `tests/workers-api.test.ts`
- `vite.config.ts`
- `workers/api/auth.ts`
- `workers/api/index.ts`
- `docs/phase1-supabase-removal.md`
- `functions/api/account.ts`
- `functions/api/categories.ts`
- `functions/api/notifications.ts`
- `functions/api/products.ts`
- `functions/api/reviews.ts`
- `functions/api/support.ts`
- `scripts/prepare-d1-customers.mjs`
- `src/lib/supabase-cloudflare.ts`
- `tests/cloudflare-client.test.ts`
- `workers/api/customer.ts`

## Local verification

90 tests passed. Legacy production build and Cloudflare production build passed.
Focused lint and diff whitespace checks passed. Cloudflare browser bundle scan
found no Supabase SDK or configuration. These are local checks, not a production
cutover or staging browser/inbox enrollment test. At that local checkpoint, no SQL
or deployment had been executed; the staging-only follow-up is recorded below.

## Actual staging verification — 2026-10-13

- Verified deployed Worker and Pages preview both bind `DB` to
  `logspoll-d1-staging-20261012` (`d337160c-36e3-4a1d-9908-76a6873b4188`).
  Both have their own authentication and Resend secret bindings. No key was exposed
  or rotated. Authentication origins match each runtime's own hostname.
- Migrations `0001` through `0005` are already installed. Wrangler reports no pending
  migrations, so no schema changes or production SQL were needed.
- Deployed only the existing `logspoll-api-staging` Worker, version
  `19dfd6b6-677d-4e3e-8641-5c59fc397779`. Existing cron and supplier flags were
  preserved. Production remained locked and payments remained disabled.
- After explicit approval, created one new staging account at the approved inbox;
  refused to proceed if the address already existed. Fresh registration passed;
  unverified login and foreign-origin authentication returned 403. The owner
  received and successfully used the real Resend verification email.
- Verified login returned Secure/HttpOnly/SameSite=Lax cookies. Independent session
  reads succeeded. A customer received 403 at the admin endpoint. A temporary admin
  role on ONLY the new test account returned 200; restoring its customer role again
  returned 403. Existing roles and accounts were not altered.
- Simulated pending import enrollment on that same new test UUID, without deleting
  records. A real reset request, single-use reset consumption and the enrollment
  hook verified the account and cleared its private marker. Original UUID remained
  unchanged. This is a staging simulation, not a real customer import.
- Reset revoked the old session; replaying the reset token returned 400. Login with
  the new password succeeded. Logout succeeded and the logged-out cookie returned
  401. Test passwords/tokens were never printed; the private temporary password
  was removed after testing. The test account remains a customer; use normal reset
  enrollment for later access. No existing user record was deleted.
- Real D1 executed an unchanged customer import replay for the test account without
  resetting its password, roles or enrollment state. Local tests also cover fresh
  no-password imports, collision rejection and trusted administrator import gates.
  A full real-data atomic import and rollback rehearsal remain unperformed.
- Resend accepted four authentication messages with no pending/error entries.
  The owner confirmed verification, reset and password-change email arrival.
- Every original row in users, profiles, roles, categories, products, inventory,
  orders/items and entitlements matched the before-test snapshot. Foreign-key
  checks passed; D1 `quick_check` returned `ok`.
- Nine focused auth/client tests and the Cloudflare production build passed.
  Existing Pages preview remains behind Cloudflare Access (HTTP 302); its binding
  configuration is verified, but this follow-up did not deploy Pages or claim a
  complete browser-flow test through Access.

## Remaining administrator dependencies

D1 now independently verifies authenticated administrators for overview and supplier
review/catalog endpoints. The legacy `src/admin/Admin.tsx` and
`src/admin/live-config.ts` still use Supabase for customer administration, general
product/category/inventory management, orders/delivery, support, review moderation,
website settings and related audit views. Legacy email/readiness panels also use
Supabase administrator checks. Cloudflare admin provides only its currently ported
screens; it does not silently fall back to those legacy operations. SDK removal
must wait for these replacements and the separately scoped payment/supplier backend
retirement. No live payment or automatic supplier fulfillment test occurred.
