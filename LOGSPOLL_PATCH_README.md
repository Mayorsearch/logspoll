# LOGSPOLL YoungPG listing mapping patch — 11 October 2026

This is a **source-code patch**, not a replacement for the whole `~/logs` project.

## Verified changes

- Parses `/categories` records with `id`, `slug`, `title`.
- Parses `/listings` records with nested `{ category: { slug, title } }`, rather than nonexistent `category_id`.
- Matches on exact normalized slug; otherwise, on a unique normalized title.
- Stages unmatched/ambiguous categories under a separate supplier-only ID. These are never silently assigned to a LOGSPOLL storefront category. An admin chooses the real local category at approval.
- Stages missing supplier descriptions with an internal review-required marker; an admin must provide a verified description (20–10,000 characters) to publish.
- Preserves independent LOGSPOLL selling prices on supplier cost updates.
- Retains the existing product authorization allowlist, credential-inventory exclusions, strict price/stock checks, supplier API secret encryption, and checkout HTTP 503 safety gate.
- Removes temporary error diagnostics from the supplier fetch handler.

## Installation

1. In your Mac Terminal, back up the current project: `cp -R ~/logs ~/logs-before-mapping-fix` (or back up the specific files).
2. Unzip **LOGSPOLL-mapping-patch.zip** into your `~/logs` project folder, preserving subfolders. Example from Downloads: `unzip -o ~/Downloads/LOGSPOLL-mapping-patch.zip -d ~/logs`.
3. **Review and apply only** `supabase/migrations/202610110003_youngpg_reviewed_approvals.sql` in your *existing* Supabase SQL Editor **after taking a suitable database backup**. It updates only the supplier approval RPC permissions and creates a new six-argument approval function. Do not rerun bootstrap or migration 002.
4. Run in `~/logs`: `npm test` and `npm run build` using your full local project (the uploaded ZIP omitted some build config and scripts).
5. Test with `npx wrangler pages dev dist --port 8788`, then the admin's supplier settings page. Use *read-only* supplier access, and authorized non-credential products only. Supply product-ID-to-resale-license references, sync, review descriptions, choose a local category, set an NGN-kobo selling price, and approve.
6. Confirm customer storefront visibility, manual price retention, and that authenticated customers cannot access admin or credential data.

## Payment integration: still needs provider identification

The uploaded `functions/api/checkout.ts` intentionally returns **503**. No payment gateway adapter, sandbox authentication configuration, webhook handler, verified callback or order-state machine was present. For safe implementation, provide the **actual gateway name and developer documentation**, which payment methods/currencies it supports, and whether you've configured a sandbox account. Do not share payment API keys in chat.

Do **not** enable live checkout until server-calculated totals, authorization, stock reservation, payment verification/webhook signatures, event idempotency, fulfillment and recovery paths are implemented and tested.

## Verification in this review environment

- Four isolated supplier-mapping unit tests passed using local fixtures and a stand-in `HttpError` class.
- Strict TypeScript check for the isolated adapter passed.
- **Not run:** full app production build, actual Supabase migration execution, live supplier sync, payment testing. The uploaded ZIP did not contain the app's full Vite/TypeScript configuration or tests and had no payment provider implementation.
