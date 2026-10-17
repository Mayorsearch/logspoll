# YoungPG synchronization repair — 2026-10-14

## Evidence and scope

- Production D1 was inspected read-only: migrations 0001–0006, zero supplier feed/storefront rows, and a retained listings/page-1 checkpoint. No production data, secrets or deployments were changed.
- The existing production key successfully fetched YoungPG categories and listings. Four restricted first-page titles exceeded the adapter's 200-character display limit before exclusion ran. Exclusion now precedes that limit; eligible oversized metadata still fails closed.
- A later eligible listing had a valid 120-character slug. Listing slugs now allow 255 route-safe characters; IDs remain limited to 100. The real detail request succeeded and its ID matched.
- A complete, paced read-only traversal validated 1,512 unique listings, 54 categories and 103 eligible listings. This proves supplier reads/normalization, not production D1 ingestion or publication. Images remain safe supplier URL references; no image binaries are downloaded.
- Production `/api/products` returned HTTP 200 JSON; unauthenticated POST `/api/admin/catalog` returned HTTP 401 JSON. Domain routing points to the existing Pages project, with no overriding Worker routes. `/api/health` is Worker-only and falls back to frontend HTML on Pages.
- Historical Cloudflare logs API returned HTTP 403. The reported HTML 502 cannot be attributed conclusively. Normal adapter failures return JSON; diagnostics now retain phase/page/status without upstream bodies or credentials.
- Staging revealed another real blocker: a retained page-10 snapshot declared 1,511 listings, while the supplier now declared 1,512. Repeated retries could never advance. Migration 0008 adds an owner-checked restart marker for a proven changed snapshot. The invalid private snapshot is replaced only on the next cooldown-respecting retry; transient failures retain their checkpoint. Published products, approvals, prices, descriptions, customers and orders are untouched.
- Production has no D1 catalog cron Worker. The existing cron binds staging only. A separate, non-public `catalog-production` Worker configuration is prepared against the verified production D1 ID. Four paced batches per minute keep the observed catalog within the existing one-hour snapshot window. Leases remain five minutes, with unchanged ownership fences and complete-snapshot publication requirements.
- A fresh scheduler heartbeat in the same D1 database lets the admin sync request return HTTP 202 without keeping the browser open. Without that heartbeat, existing manual synchronization remains available. Approval and publication remain separate.

## Changed files

`server/youngpg.ts`, `server/catalog-sync.ts`, `workers/api/catalog-sync.ts`,
`workers/api/supplier-review.ts`, `workers/api/index.ts`, `workers/api/wrangler.jsonc`,
`src/admin/CloudflareCatalog.tsx`, `src/lib/cloudflare-auth.ts`,
`workers/api/migrations/0007_supplier_wide_authorization.sql`,
`workers/api/migrations/0008_sync_snapshot_retry.sql`,
and focused tests in `tests/{dynamic-supplier,workers-catalog,workers-supplier-review,d1-migration-preservation,cloudflare-client}.test.ts`.

## Verification

72 tests passed; production build, focused ESLint and diff whitespace checks passed.
Tests cover restricted oversized titles, long slug routes, transient-error checkpoints,
Retry-After, stale owners, bounded scheduled batches, changed-snapshot recovery,
supplier-wide evidence with product-specific precedence, and row/price preservation.
Staging migrations and deployment results are recorded below. No production sync success is claimed.

## Remaining production steps — approval required

Do not run these production commands until approved. First verify staging checkpoint progression and completion.

```sh
npx wrangler d1 migrations list logspoll-d1-production --remote --config workers/api/wrangler.jsonc --env catalog-production
npx wrangler d1 migrations apply logspoll-d1-production --remote --config workers/api/wrangler.jsonc --env catalog-production
npx wrangler secret put SUPPLIER_ENCRYPTION_KEY --config workers/api/wrangler.jsonc --env catalog-production
npx wrangler deploy --config workers/api/wrangler.jsonc --env catalog-production
```

The secret must be the existing production Pages encryption key, entered securely at
Wrangler's prompt. A standalone Worker does not inherit Pages secrets. No authentication,
Resend or payment secrets are needed for this catalog-only Worker. Deploy the reviewed
Pages build only after approval (`npx wrangler pages deploy dist --project-name logspoll --branch rebuild/react-vite`, the verified production branch); inspect its
JSON catalog status for a fresh heartbeat. Verify complete D1 ingestion before reviewing
individual listings, then approve and publish only authorized, freshly verified stock.

Read-only SQL checks:

```sql
SELECT name FROM d1_migrations ORDER BY id;
SELECT phase,page,scanned,total,restart_required FROM supplier_sync_jobs;
SELECT value FROM migration_metadata WHERE key='catalog_scheduler_heartbeat';
SELECT approval,count(*) FROM staging_supplier_feed_items GROUP BY approval;
SELECT count(*) FROM storefront_products WHERE available_quantity>0;
PRAGMA foreign_key_check;
```

Rollback: restore the previous runtime first; it ignores the additive retry column.
Restore only the two view definitions from migration 0006 if needed, preserving every
table and row. This intentionally disables wildcard stock authorization until a corrected
forward migration. Do not rerun all of 0006 or delete checkpoints/records manually.

OTP authentication and premium email templates are deferred. No partial authentication
changes were made. Bachs and automatic supplier purchasing remain untouched.

## Actual staging result

Migrations 0007 and 0008 were applied only to `logspoll-d1-staging-20261012`.
The final staging Worker version is `4607c2f1-9620-490e-95be-e755ccd68871`.
Its real scheduled handler marked the stale 1,511-item snapshot for restart, honored
cooldown, then created a fresh 1,512-item checkpoint and advanced to page 6 / 480
scanned with no browser sync requests. The lease was released and the restart marker
was clear. Existing 25 feed records remained; no products were approved or published.
This verifies real staging background recovery and listing progression, not complete
final ingestion or production synchronization. Staging health returned 200 JSON and
unauthenticated catalog access returned 401 JSON. The full scheduled scan remains
in progress; verify its final state before any production rollout.
