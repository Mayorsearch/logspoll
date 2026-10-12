# Supplier sync stabilization — 2026-10-12

Read-only live audit: YoungPG categories/authentication succeeded; the sync lease was expired with `running_operation=sync`. There were 30 feed records (1 approved, 29 pending), 2 linked product records, and 1 storefront record with zero stock. Staging a feed item does not approve or create a public product; pending items must remain unpublished.

Confirmed code defect: `finish_supplier_connection` rejects an expired lease **before** its failure-cleanup branch. The runner previously ignored that cleanup RPC's returned error. It now reports the precise failing operation and an allowlisted database error category; the admin status identifies expired progress without modifying records or weakening token protection. An expired lease can already be reclaimed atomically by the existing claim RPC.

The initiating interruption remains unconfirmed. All pages, optional details, retries and progress writes currently share one HTTP invocation; there is no persisted catalog checkpoint. [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/) allow cancellation after client disconnect and limit Free invocations to 50 subrequests. The account plan and runtime logs were not verified; neither limit exhaustion nor a universal HTTP duration limit is asserted.

This is a diagnostic stabilization, not a durable-sync implementation. Next: build and validate bounded, resumable batches in isolated staging, with private checkpoints and deduplication, token-checked leases, an atomic complete-snapshot finalizer, and fail-closed stale inventory. Do not deploy a partial-snapshot publisher or clear another operation's lease. Production SQL approval is still required.

`202610120001_catalog_refresh_pricing.sql` was inspected but not applied or staging-validated. Its `publication_enabled` column is absent live (42703). Its wrapper still delegates lease validation to the old finalizer, so this pricing migration does not fix expired cleanup or add durable checkpoints. Existing price overrides, public descriptions and approvals remain untouched by this patch.

No production records, SQL, authentication, payments, purchasing, font or design were changed. A complete live sync was not run; diagnostic regression tests and the production build passed.
