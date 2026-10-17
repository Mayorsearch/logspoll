# YoungPG production catalog — 2026-10-14

## Full production snapshot verified

At 14:52:28 UTC, production committed the complete 1,537-listing snapshot with
zero pending detail reads. The private catalog retains all 1,537 safe metadata
records, including 1,478 blocked/review-restricted records. The existing 101 review
feed records remain pending; 59 report current stock and 42 now correctly report
zero stock. Approvals, manual selling prices and administrator descriptions were preserved.

At 14:53 UTC there were 84 retained source-category records (including historical
and unmatched mappings), seven storefront categories and zero published products.
Independent enrichment had successfully read subcategories for one of 54 actual
supplier category IDs and stored one subcategory; its cloud checkpoint continues
without the browser. It does not trigger a new product scan. Zero valid image URLs
and seven useful descriptions were recorded in the review feed. Missing assets are
not represented as genuine supplier images or invented descriptions.

No products were approved automatically. Administrator review of actual resale
and delivery rights, a selling price and usable description is still required.
Production checkout and webhook endpoints remain disabled HTTP 503. Bachs D1
payment processing, production merchant/key verification and end-to-end sandbox
testing remain unfinished; the website is not ready for real customer purchases.

## Mobile management update

Production Pages: `6902cb36-7230-4f7d-b4de-2e65104bdc71`.
Catalog Worker: `93195000-b8b5-4354-80f3-d01fe3e5bdbd`.

- Product management now shows supplier cost, NGN selling price and estimated
  gross profit. Selected batches of at most 25 support fixed selling prices,
  fixed markups and percentage markups rounded upward to whole kobo. Saved prices
  become explicit overrides and survive subsequent supplier cost changes.
- Bulk publication uses the existing verified-stock and authorization views,
  additionally requires positive prices and useful descriptions, rejects restricted
  product/category text, and commits atomically. Invalid selection rolls back the
  entire batch. It does not approve products or initiate payments/fulfillment.
- Fetch Categories queues separately checkpointed, paced subcategory enrichment
  after product snapshot completion. It uses the same five-minute ownership fence,
  supplier cooldown and Retry-After handling. Product checkpoints are untouched;
  unchanged subcategory rows are skipped. Stock checks retain scheduler priority.
- 92 tests passed, including real SQLite bulk rollback/override tests and bounded
  taxonomy/rate-limit recovery; TypeScript/build and focused lint passed. The
  isolated release excludes unrelated email edits. No schema migration required.
- At 14:49 UTC, production held 1,537 discovery records, 1,478 privately blocked
  metadata records, 13 outstanding detail reads, 101 legacy pending feed records,
  seven supplied descriptions and zero supplied image URLs. Seven storefront
  categories and zero published products were verified through production APIs.
  These are progress counts, not a completed-snapshot or live-purchase claim.

Production rollback deployment and D1 bookmark are saved privately in
`.migration-private/backups/final-before-deployment.json`. Staging synchronization
remains paused. New admin writes/mobile interaction require an authenticated
production administrator for end-to-end verification; local regression tests are
not represented as live administrator actions. Payment completion remains the
next implementation task in `bachs-d1-readiness.md`; no live capability was unlocked.

## Paid recovery update (supersedes the quota hold below)

At 14:25 UTC, a production metadata-only probe succeeded (two reported row writes).
The old midnight hold was removed. Staging catalog remains paused; staging
authentication and the shared cron remain enabled. One recovery pass was queued
because the old completed scan had discarded 1,429 discovery records. Incomplete
checkpoints, lease ownership, retry times, approvals and prices were preserved.

Production now reports 1,537 current supplier listings and has reached the details
phase after scanning all listing pages. Final enrichment/publication is not assumed
complete. The 101 existing feed records remain pending approval, with zero published
products. Seven conservative storefront categories were created and 45 existing
feed records mapped; 63 private source categories remain available for review.

Deployment: Pages `6fd73ead.logspoll.pages.dev`; catalog Worker version
`34026d42-ad9f-44df-b477-301e716c3f25`. The deployed phone controls enqueue durable
jobs without browser batch loops, preserve incomplete progress, support stock-only
requests and expose automatic-full-scan settings. Supplier omissions no longer
erase useful descriptions or images. Private discovery has cursor pagination,
filters and mobile cards. Explicit selling prices remain administrator overrides;
supplier-cost automatic pricing requires explicit opt-in during new approval.

Checks: 91 tests passed in the workspace and isolated release, production build
and focused lint passed. Unrelated local email changes were excluded from deployment.
No new SQL migration, automatic approval, supplier purchase or charge occurred.

Public production checks: seven categories, zero products; authenticated routes
remain protected. No live purchase, mobile visual test or completed recovery
snapshot is claimed. Bachs remains locked; see `bachs-d1-readiness.md` for the
confirmed missing D1 payment backend and local sandbox webhook configuration.

The older sections below record the earlier Free-quota failure and deployment.

## Verified production state

- Production Pages deployment: `7e50b7ca-43f6-4fda-9955-77d3ee97cf4c`.
- Production catalog Worker version: `15ee18a1-055b-4d17-baac-0c36f7c41e0a`.
- Both retain D1 `f0be42ec-fbae-4134-9eef-19ef26098e33`.
- Installed migrations: 0001–0009. This patch requires no schema migration.
- Latest completed checkpoint discovered 1,530 listing IDs; 101 product metadata
  records exist, all pending approval. No products are eligible for publication
  without administrator review; none are published.
- 63 private source categories, zero stored subcategories and zero storefront
  categories. The previous importer discarded the other 1,429 listings before
  recording their public metadata. The next scan will retain safe discovery
  metadata privately; this has not yet been verified against live production.
- Of 101 feed records, seven have supplied descriptions and zero have image URLs.
  Missing product images/descriptions have not been invented.
- `/api/products` and `/api/categories`: HTTP 200 JSON, both empty.
  Unauthenticated supplier-review/session requests: HTTP 401 JSON.

## Confirmed blocker

Cloudflare management API returned code 7500: account exceeded the Free-tier daily
row-write limit. No retry was attempted after that confirmed failure. The bounded
category backfill could not create its seven conservative categories or fill
empty mappings. Its first write failed; existing records remain intact.

Earlier daily analytics: staging 74,242 writes; production 27,387 writes. Reads
were 147,010 and 128,668 respectively. Staging consumes most of the shared budget.

## Changes and checks

- Automatic full scans wait 12 hours; explicit refresh, incomplete checkpoints,
  cooldowns, lease fences and failed-snapshot recovery retain their existing gates.
- Published approved products receive bounded stock/price checks after 30 minutes.
  The one-hour stock cutoff is unchanged; failed checks never extend freshness.
- Private discovery retains whitelisted public metadata from restricted categories;
  no credentials or fulfillment payloads are copied. Restricted account, financial
  and personal-data inventory cannot use the goods approval workflow.
- Embedded subcategory labels are retained when supplied, without restoring the
  optional per-category request fan-out that caused rate limits.
- Conservative category mapping preserves existing administrator mappings. Prices,
  descriptions, approvals and publication decisions remain administrator-owned.
- Unchanged taxonomy updates, redundant detail-job writes and repeated zero-stock
  writes are skipped. Public category responses use a 30-second cache; stock and
  private responses remain uncached. No documented YoungPG incremental filter was
  available, so no unsupported API parameter was introduced.
- Full suite: 82 passed. Isolated deployment catalog/security suite: 32 passed.
  Additional legacy financial-category regression: passed (six review tests).
  Production build and focused lint passed. No authentication, OTP, email,
  payment, supplier-purchase or unrelated local changes were deployed.

## Remaining steps

1. Restore write capacity: wait until 2026-10-15 00:00 UTC (01:00 Lagos), or upgrade
   the Cloudflare plan. The user approved a temporary staging catalog pause;
   it is now applied and verified. Its authentication and shared cron remain enabled.
2. The production cron will retry automatically when writes become available.
   Let its full snapshot finish; do not repeatedly start full scans. Existing
   stale-snapshot recovery applies if the retained checkpoint is too old.
3. Verify complete discovery, subcategory coverage and category creation in
   `/admin/integrations`. New discovery/stock-refresh behavior is regression-tested
   but not end-to-end verified in production because write capacity is exhausted.
4. Independently review resale evidence, permitted delivery, descriptions and
   current stock. Approve legitimate goods, then publish them in `/admin/products`.
   Fresh full verification is required for approval. Missing descriptions/images
   require genuine supplier assets or administrator-supplied verified content.
5. Verify `/api/products` and `/api/categories` again after those gates pass.

The one-off mapping script remains available locally, if needed after quota reset:

    NODE_OPTIONS=--dns-result-order=ipv4first node --experimental-strip-types .migration-private/map-production-categories.mjs --apply

## Preservation and rollback

Unrelated local email edits remain untouched and were excluded using an isolated
build from HEAD plus catalog changes. No Git push, destructive SQL, database reset,
automatic approval, payment or purchase occurred.

Private backups and read-only evidence: `.migration-private/backups/`.
Prior Pages deployment: `1c1613ec-eb39-4726-8ab5-165cf89f6dd8`.
D1 Time Travel bookmark is saved privately; no data rollback is currently needed.
If rollback is required, restore that Pages deployment and the previous catalog
Worker version together. Keep all D1 records and private checkpoints.


## Approved quota recovery

- Staging `CATALOG_SYNC_ENABLED=false` was applied through the documented Worker
  settings API. Every other binding and its shared cron were verified unchanged.
  Local staging configuration matches the temporary pause. Authentication stays enabled.
- Production sync remains enabled. `CATALOG_RESUME_AT=2026-10-15T00:00:00.000Z`
  prevents catalog database operations before reset, including heartbeat writes.
  Invalid resume timestamps fail closed. The existing minute cron resumes bounded
  batches automatically after the hold; no browser or online computer is required.
- The existing 12-hour full-scan interval, 30-minute bounded published-stock checks,
  one-hour freshness cutoff, leases, checkpoints and manual overrides remain intact.
- Focused catalog tests: 13 passed, including zero catalog database operations
  during the hold, checkpoint preservation and exact reset-boundary readiness.
  Production build, focused lint and whitespace checks passed.
- No D1 writes or manual sync were triggered during recovery configuration.
  Post-reset full private discovery, category creation and live stock refresh still
  require real production verification. No product is claimed live.
- Evidence: `.migration-private/backups/staging-catalog-pause-proof.json` and
  `.migration-private/backups/production-recovery-config-proof.json`.
- Restore staging catalog only after budget review, by explicitly restoring its
  catalog flag. Do not disable the shared authentication/email cron.
