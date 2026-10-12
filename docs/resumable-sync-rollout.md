# Resumable sync: approval gate

**Not deployed. No production SQL executed. LOGSPOLL-STAGING access was unavailable.**

The original runner combined every listing page, detail read and progress write in one request. Its five-minute lease could expire, and the finalizer rejected expired tokens before failure cleanup. The new runner checkpoints one category read, listing page or optional detail per request (at most three supplier reads, bounded by existing 10/20/15-second timeouts). Database fetches have a 10-second bound. Closing the admin tab preserves progress; clicking Sync Catalog resumes. Completed job receipts make final-response retries idempotent.

Private job/row tables have RLS and no browser grants. Only server-admin or scheduler endpoints can reach service-role RPCs. Every batch locks the connection before its job, checks the current token/revision/expiry, and commits rows plus cursor atomically. Duplicate IDs, changed pagination/totals, invalid prices/stock, authorization changes and incomplete snapshots prevent publication. Jobs older than 15 minutes restart safely. Old stock is zeroed during sync, approval freshness is invalidated, and customer inventory RLS hides stale supplier stock even after a killed request. Existing approvals and public prices/descriptions survive complete refreshes; new items still require explicit administrator review.

Optional detail network failures retain independently validated listing metadata and skip remaining enrichment; authentication, invalid metadata and ID mismatches remain fatal. Only permitted public image URLs are stored; no image files or fulfillment data are downloaded. Subcategory traversal remains the separate Fetch Categories action.

The retained finalizer preserves installed pricing behavior. `202610120001_catalog_refresh_pricing.sql` remains optional for batching: it backfills existing prices as explicit overrides, defaults new approvals to automatic pricing, and keeps admin overrides/public descriptions. Offline PostgreSQL tests cover installing pricing before batching, after batching, and not installing pricing. This does not substitute for staging validation against the actual schema and authenticated identities.

## Exact next steps

1. In **LOGSPOLL-STAGING**, confirm `202610110002_configurable_suppliers.sql` and `202610110003_youngpg_reviewed_approvals.sql` are installed. Capture the read-only preservation baseline using `supabase/verify_catalog_refresh_preservation.sql` where applicable. Review/apply only missing migrations: optional `202610120001_catalog_refresh_pricing.sql`, then **`202610120002_resumable_supplier_sync.sql`**. The new migration does not modify existing product prices/descriptions/orders/payments or delete existing product/feed records.
2. Run `supabase/verify_resumable_sync.sql`. With staging-only configuration, test two simultaneous admins, interruption after a saved page, expiration/reclaim and an obsolete worker attempting cleanup, invalid/duplicate pages, authorization revocation, actual YoungPG completion, customer visibility and price/description preservation. Do not copy production credentials or real customers into fixtures. Separate browser profiles must prove admin denial and customer RLS.
3. Only after staging passes, obtain explicit production SQL approval; apply the reviewed migration to the intended database. Then deploy this branch to `mobile-preview` (never production). The existing preview is intentionally unchanged until that approval.
4. For computer-independent continuation, deploy `workers/catalog-scheduler` separately after migration verification, configure its server-only `SCHEDULER_SHARED_SECRET` and matching Pages secret, and explicitly enable `SUPPLIER_SYNC_ENABLED`. It runs every five minutes and issues at most 40 batch requests per invocation; later invocations resume. Scheduler/payment flags remain disabled in the existing Pages configuration. Neither automatic purchases nor payments are enabled.

Rollback: revert the application to `35913d6` first, leaving the additive schema installed. The wrapper retains compatibility with the old finalizer and fixes expired-owner cleanup. Keep private checkpoint tables; do not drop data or undo pricing automatically. A separate reviewed schema rollback is required if later requested.

Offline SQL regression command (temporary test dependency, not an application dependency):

```sh
LOGSPOLL_PGLITE_MODULE=/private/tmp/logspoll-sql-check/node_modules/@electric-sql/pglite/dist/index.js node scripts/verify-resumable-sync.mjs
```

PGlite runs an isolated [in-memory PostgreSQL database](https://pglite.dev/docs/); this verifier has no Supabase/network access and uses synthetic data only. It exercises real migrations and RPC transactions; single-connection lease interleavings are covered, while concurrent multi-connection staging tests remain mandatory.
