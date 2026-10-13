# Staging-only D1 supplier review foundation

This increment adds **review storage and a verified-admin staging API**, not a full
YoungPG sync, not a Supabase migration and not live checkout. Existing Supabase
pending approvals are untouched; they are **not** copied into D1 automatically.

## What exists

- `0004_supplier_review.sql` is additive and contains no supplier credentials.
- `GET /api/admin/supplier-review` gives a limited, non-secret review summary.
- `POST /api/admin/supplier-review` accepts `action: approve|reject`, with a connection
  UUID and external product ID. Approval additionally needs an active category UUID,
  nonnegative integer `price_minor` in **NGN kobo**, a reviewed description (20–10000
  characters), and a permitted `delivery_type`.
- Only independently verified, fresh (under 24 hours), non-account-access staged
  products with a recorded evidence reference can be marked approved. Customer
  accounts cannot use either action, and POST requires a same-origin browser request.
- Every review change is audited. **Approvals never create products, alter stock,
  publish the storefront, bill customers, or deliver products.**

## Deliberate limitations

There is no D1 supplier credential vault, API ingestion, resumable synchronization,
image uploader, historic Supabase approval import, or Bachs transaction port yet.
These must be implemented and reviewed separately. The admin React screen still
uses Supabase; this API is isolated for explicit staging verification. Do not
advertise it as a working admin dashboard or migrate production based on it.

## Before any staging migration

Verify the exact target database ID and make a remote database backup. Only after
approval, apply `0004_supplier_review.sql` to **staging D1** once (after 0001–0003),
using Wrangler migrations or explicitly reviewed D1 execution. Never execute the
PostgreSQL `supabase/migrations/*.sql` files against D1.

Keep all production settings, Supabase records, 29 pending legacy approvals,
customer identities, supplier credentials, and Bachs live settings unchanged.
No migration or deployment is performed by this patch.

## Review gates for later increments

1. Design verifiable product-specific resale evidence and exclude account/session
   credentials and other unauthorized listings before writing any feed records.
2. Introduce an encrypted server-side YoungPG credential vault and bounded,
   resumable read-only ingestion with immutable source IDs and duplicate checks.
3. Import existing approved/pending records with count and checksum comparison,
   not guessed IDs, and test rollback before any production cutover.
4. Add an independent publication and current-stock gate, legitimate manually
   supplied product images, and authorized customer views.
5. Only then integrate Bachs sandbox and independently test webhook, order state,
   stock reservation and payment/fulfillment idempotency. Keep live mode off.
