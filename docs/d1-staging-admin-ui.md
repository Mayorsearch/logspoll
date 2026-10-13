# LOGSPOLL D1 staging administrator UI — integration milestone

This patch adds a staging-only React administrator interface to the existing verified Cloudflare D1 supplier-review foundation. It does not replace production Supabase administration, import 29 existing pending approvals, perform YoungPG synchronization, or activate payments.

The `VITE_AUTH_PROVIDER=cloudflare` build now renders `CloudflareAdmin` from the existing protected `/admin` route. It uses authenticated same-origin D1 `/api/admin/overview` and `/api/admin/supplier-review` calls, never Supabase. The old admin panel remains unchanged for the production Supabase build. The new interface displays actual D1 counts and existing D1 supplier-review records; it never invents customers, purchases, stock, or listings.

GET `/api/admin/supplier-review` now returns active D1 category ID/name pairs for the review form. GET and POST require verified admin role. POST approval requires independently verified resale evidence, eligible digital goods, a recent source scan, active category, integer-kobo NGN price, and a reviewed description. Successful review records remain in review-only staging tables. It does not change products, inventory, pricing in the live storefront, or payments.

## Important gates

- The owner/admin account is not automatically created or promoted by frontend access or public signup. Admin role provisioning must be performed through an explicit trusted operator action, separately reviewed and audited.
- The D1 catalog migration `0004_supplier_review.sql` must be tested and explicitly approved for the **staging** D1 instance, after confirming the exact database binding and backup. This patch does not run it.
- YoungPG ingestion is not connected; the review page may legitimately show zero staged listings. The original 29 Supabase pending approvals must be exported and mapped through a separate verified migration, not quietly interpreted as D1 approvals.
- Bachs sandbox/production payments remain disabled in D1, as does automatic supplier fulfillment.
- Do not deploy this patch until `npm test`, `npm run build`, and `python3 scripts/verify-d1-staging.py` pass, and the D1 admin security gates are reviewed.
