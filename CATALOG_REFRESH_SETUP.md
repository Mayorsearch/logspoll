# Catalog refresh and phone-preview setup

Implemented locally; not deployed or applied to the hosted database.
Admin screen: `/admin/settings/supplier-api`.

## Existing boundaries

YoungPG is read-only: categories, subcategories, listings and listing details. Only
product IDs with existing verified resale evidence may enter the feed (maximum
500 authorized products). Account-access and credential inventory remains excluded.
Missing descriptions remain explicitly marked for administrator review. Private detail
fields are discarded; unknown attributes and image URLs with query credentials are not imported.

Reference: https://youngpgmedia.com.ng/docs/api-authentication

Pages are processed in batches of 100, up to 1,000 validated pages, with a four-minute
safe window under the existing five-minute database lease. Each read is spaced at
least 1.2 seconds apart. Transient reads retry twice; 429 respects Retry-After.
Any incomplete traversal fails without committing a partial inventory snapshot.
Existing fail-closed behavior clears sellable inventory on failed sync; missing
products become inactive and require approval before republishing. A catalog that
exceeds the safe window needs a future durable resumable job implementation.

## Reviewed additive migration — manual approval/application required

Apply `supabase/migrations/202610120001_catalog_refresh_pricing.sql` after supplier
migrations 002 and 003. No hosted migration was executed by this task.
Run the read-only `supabase/verify_catalog_refresh_preservation.sql` before AND after
application with sync/admin writes paused; compare every returned fingerprint. Run
`supabase/verify_catalog_refresh.sql` afterward. No local PostgreSQL runtime was
available, so SQL execution and database-backed pricing writes remain unverified.

The migration preserves existing product prices as explicit overrides, including zero.
Future supplier costs update separately. New approvals default to automatic pricing:
leave the optional price override blank. Existing products retain their override until
Reset to automatic is used. Automatic prices use supplier-category percentage markup
(default 0%); integer kobo rounds upward. Explicit overrides, including zero, survive sync.
The existing product editor also captures manual price changes. Approval, reviewed
public descriptions, local category activation, inventory and publication remain separate.
No payment minimum is invented and no Bachs code is changed.

The page falls back to existing feed fields until the migration is applied. Existing
connection, sync and approval continue to work; advanced controls show a migration notice.

For rollback: first stop the scheduler, then restore the previous application version.
Keep the new columns/data. If reverting the SQL behavior, in a reviewed transaction
remove the wrapper `finish_supplier_connection(uuid,uuid,jsonb,text)` and rename
`finish_supplier_connection_v1` back; revoke authenticated execution on
`admin_supplier_catalog` and remove the two newly named override-capture triggers.
Also remove the new approval wrapper and rename `approve_supplier_feed_item_v1`
back to `approve_supplier_feed_item`, restoring authenticated EXECUTE only on that
six-argument approval entry point. Keep its five-argument predecessor revoked.
Preserve the existing service-role-only grants. Do not drop feed data or overwrite
retail prices. Automatic prices already calculated remain stored retail prices.

## Preview deployment gate

Live read-only catalog preflight succeeded: 54 categories, 105 subcategories,
1,632 listings across 17 pages, 26 eligible products. All 26 eligible detail
responses lacked descriptions, so publication still requires verified admin text.
No inventory writes were performed.

Read-only Cloudflare audit: existing `logspoll` Pages project, production branch `main`.
**Preview bindings have now been configured and verified; production configuration
was unchanged.** Public variables are pinned under env.preview in Wrangler, while
service-role and encryption keys are encrypted Cloudflare secrets. Scheduling and
payments remain disabled. The hosted database
also lacks the new pricing columns and subcategory table. Deployment is withheld
until the hosted migration and authenticated checks are resolved.

Configure **Preview only**, using existing backend secrets without exposing them:
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`, `SUPPLIER_ENCRYPTION_KEY` (secret bindings)
- `SUPPLIER_SYNC_ENABLED=true` and a new random `SCHEDULER_SHARED_SECRET`
  of at least 32 characters (secret binding), only when the scheduler is ready.
  After database and preview verification, change `env.preview.vars.SUPPLIER_SYNC_ENABLED`
  in `wrangler.jsonc` to `true` and redeploy the preview; keep payments disabled.
- Preserve the existing Bachs sandbox configuration if sandbox testing is wanted;
  do not enable live payments or supplier fulfillment.

Frontend build variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` only.
Keep supplier keys, scheduler secrets and service-role credentials out of all VITE
variables and out of dist. Existing `.env.local` and `.dev.vars` stay ignored.

After tests, SQL verification, verified admin/customer checks and Preview bindings pass:

```sh
npm test
npm run build
npx wrangler pages deploy dist --project-name logspoll --branch mobile-preview
```

This uploads dist and existing `/functions`; do not upload local environment files.
Test the actual returned HTTPS deployment URL, `/login`, `/register`, protected
`/dashboard`, `/marketplace`, `/admin/settings/supplier-api`, and API authorization.
Native Pages SPA fallback is retained for nested-route refreshes.

In Supabase Authentication → URL Configuration, allow the actual preview origin's
`/auth/callback` and `/reset-password` URLs (and the mobile-preview alias when used).
Keep the production Site URL unchanged. Verify email links and PKCE flow in the same
phone browser that initiated signup/reset. Real login, redirects, persistence, role
isolation and mobile layout still need authenticated/browser testing.

## Scheduler — prepared, not deployed

Configure the identical `SCHEDULER_SHARED_SECRET` as a Worker secret:

```sh
npx wrangler secret put SCHEDULER_SHARED_SECRET --config workers/catalog-scheduler/wrangler.jsonc
npx wrangler deploy --config workers/catalog-scheduler/wrangler.jsonc
```

Run these only after the preview deployment and its bindings are verified. The Worker
runs every 30 minutes, targets only `mobile-preview.*.pages.dev`, follows no redirects,
and POSTs to `/api/internal/catalog-sync`. The endpoint is disabled by default,
rejects browser Origin requests, and authenticates a dedicated machine secret with
a constant-length digest comparison before accessing storage. It rotates one enabled
YoungPG connection per invocation, using the same DB lock and sync implementation as
admin Sync Catalog. If multiple suppliers are configured, each refresh interval is
30 minutes multiplied by the number of connections. Never use this secret in a browser.

Reference: https://developers.cloudflare.com/workers/configuration/cron-triggers/

## Product images

Sync reads each eligible product detail even when its list description exists.
All safe public URLs in image_url, image, image_urls or images are deduplicated
and staged; raw responses, URL credentials and private signed URLs are discarded.
The migration stores approved images separately from existing manual image_path
values, preserving manually supplied artwork. Marketplace and product detail
render the approved API image with fallbacks; the admin feed exposes all staged
images. Existing databases without the image view retain their current artwork.
The API must actually supply image URLs: none are inferred from category names,
scraped from the supplier website or presented as genuine supplier images.

Live image audit: 1,651 listing rows across every API page and all 30 authorized
product-detail responses supplied zero image URLs. This is a supplier API data
limitation, not an image download failure. No private fulfillment endpoints were
called and no supplier inventory was written. YoungPG must provide public image
URLs before genuine supplier images can appear.

Validation: 48 automated tests pass, production build passes (existing large-bundle
warning), focused lint passes, Pages Functions compile and local nested-route/API
authorization HTTP checks pass, scheduler Worker dry-run build passes, and known
server-secret/frontend key-pattern scans pass. Browser/mobile, email redirects,
database SQL execution and authenticated live pricing writes remain unverified.

## Review of pricing migration (2026-10-12)

- Existing prices, public descriptions, approvals, inventory, orders, payments and
  authentication are not rewritten during application. Only existing feed price
  overrides/publication flags are backfilled once. All database changes are transactional.
- Automatic approved prices follow cost changes; manual overrides are captured by the
  existing authenticated admin product editor. Reapproval preserves pricing mode when
  no override is supplied. Older clients supplying a price still select a manual override.
- Synchronization updates supplier staging descriptions only; public descriptions remain
  administrator-managed. Supplier metadata changes still require renewed approval.
- Existing `storefront_categories` retains its RLS. New `storefront_subcategories` exposes
  only local category ID/slug, subcategory slug/name and an approved product count to
  signed-in users. Its intentionally owner-evaluated, security-barrier projection filters
  approved, publication-enabled, active authorized products in active local categories.
  Raw source categories/subcategories/items remain admin-only under RLS; credential
  storage remains inaccessible to browser roles. The shop currently reads categories;
  subcategory filter UI is a separate follow-up, not implemented by this migration.
- Images are stored as public HTTPS URL strings, NOT downloaded into Supabase Storage.
  Rendering requests the supplier/CDN URL; there is no asset-copy job or bucket migration.
- Separate Cloudflare Worker Cron (`*/30 * * * *`) calls the authenticated Pages endpoint.
  Once deployed/enabled with matching machine secrets, it runs without a local computer.
  It is currently undeployed/disabled; live scheduled runs are NOT verified.
- Apply after 202610110002 and 202610110003 with the original catalog/role migrations.
  Migration 202610110004 payment ledger is untouched. Reapplying this file does not
  backfill overrides again. No production SQL or deployment was performed in this review.
