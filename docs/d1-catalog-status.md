# D1 catalog ingestion — verified staging milestone

Applied additive migrations `0004_supplier_review.sql` and `0005_supplier_sync.sql`
to the existing staging D1 only. Production schema and data were not changed.

Real integration on 2026-10-13 scanned **1,507** listings across all pages and stored
**25** eligible products in D1, with **25** in-stock source records, **25** pending
reviews, and **0** usable supplier image URLs. No product was published or purchased.
The legacy feed's original IDs, approvals, prices and descriptions were compared
before/after and remained unchanged, including the original 29 pending approvals.
Existing D1 products, inventory and orders also remained unchanged. Legacy records
have NOT been migrated into the new review queue; the new 25 rows are verified ingestion.

The backend uses encrypted credentials, server-side admin checks, revision checks,
five-minute ownership leases, private checkpoints, bounded requests, duplicate-ID
rejection and atomic finalization. Supplier details cannot change listing cost or
stock. Synchronization preserves review decisions, selling prices and reviewed
descriptions. Removed listings become out of stock in the review feed.

The operator integration test first proves REST batch rollback and checks record
preservation. It respects management-API HTTP 429 responses. Deployed Workers use
native D1 bindings, not this operator REST adapter:

    node --experimental-strip-types scripts/check-youngpg-d1.ts --staging-write-test

## Gates still closed

- Deployment requires explicit approval. The prepared minute cron remains disabled
  by `CATALOG_SYNC_ENABLED=false`. Set the backend-only `SUPPLIER_ENCRYPTION_KEY`
  consistently on the Worker and Pages before enabling the approved staging build.
- Native deployed-Worker synchronization and Free-plan execution limits still need
  end-to-end verification. Node/REST integration is not proof of deployed execution.
- Complete customer/role/product/order migration, original approval import,
  fixture cleanup and real category mappings remain unfinished. Preserve legacy
  production and its records until counts, ownership and authorization are verified.
- Publication, R2 image uploads, checkout, D1 payment/fulfillment and business-event
  emails remain locked/unimplemented. Existing Resend authentication emails remain
  intact. No Bachs live readiness, merchant approval or live payment test is claimed.

Rollback: keep the previous deployment and disable catalog synchronization. Preserve
new review/checkpoint tables for inspection; no destructive rollback SQL is needed.

REST reference: https://developers.cloudflare.com/api/typescript/resources/d1/subresources/database/methods/query/
