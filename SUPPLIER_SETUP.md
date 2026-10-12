# YoungPG supplier settings (not deployed)

Admin → Settings → Supplier API: `/admin/settings/supplier-api`.
`/admin/integrations` opens the same page. Existing customer/manual product flows remain.

## Required one-time setup

1. In the existing, working Supabase project, review and manually apply only
   `supabase/migrations/202610110002_configurable_suppliers.sql` after confirming
   the existing catalog/roles/inventory schema matches its dependencies. **Do not
   run the previous empty-database bootstrap against your working database.**
   This migration adds separate connection/feed tables and RPCs; it does not
   modify ShopViaClone22 constraints, existing records or manually added products.
   Execution and PostgreSQL compatibility have not been tested in this session.
2. Set Pages Functions runtime values for the intended environment:
   `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, server-only secret
   `SUPABASE_SERVICE_ROLE_KEY`, and server-only secret `SUPPLIER_ENCRYPTION_KEY`.
   Generate the latter locally using `openssl rand -base64 32`. Preserve it across
   deployments; changing it makes existing encrypted credentials unreadable.
   Never use a `VITE_` prefix for privileged/encryption/supplier secrets. Build-time
   variables remain only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. For local full-stack use, copy `.dev.vars.example` to ignored `.dev.vars`, fill
   values privately, run `npm run build`, then `npx wrangler pages dev dist --port 8788`.
   Use `http://localhost:8788/admin/login`, then `/admin/settings/supplier-api`.
   Add that origin's auth callback/reset URLs in Supabase as described in LAUNCH_SETUP.
   Plain Vite serves the frontend only and cannot save/test credentials.
4. In YoungPG mint a key with **listings:read only**. Do not enable purchase,
   profile, orders or wallet scopes. Enter the key into the password input, enable
   the supplier and save. Saved keys are never fetched back into the input. Blank
   retains a key; Save / Replace API Key replaces it without source edits/redeployment.
5. Click Test Connection and then Fetch Categories. Wait at least ten seconds
   between read operations; sync has a one-minute cooldown. A running operation
   holds a five-minute database lease. HTTP 429 requires waiting at least one minute.
   No automatic network retry can duplicate a sync. Configuration revisions prevent
   concurrent key replacements from silently overwriting each other.
6. Independently verify product-specific license/transfer/resale authorization and
   add the supplier listing **ID** → evidence reference JSON mapping. Empty `{}`
   blocks imports. Account/session/cookie/login credential inventory is excluded
   even when accidentally allowlisted. Metadata is not evidence of transfer rights.
7. Sync Products, inspect staged eligible records, then approve each using a local
   category, manual NGN selling price in integer kobo, and permitted delivery method.
   Approved products use the existing private storefront and ordinary product editor.
   Rejected/missing/changed listings are unpublished. Supplier cost updates never
   overwrite independently configured selling prices. Failed connections and saved
   configuration changes zero stock; manually added products are unaffected.

## Verified documentation and remaining live verification

[Official YoungPG documentation](https://youngpgmedia.com.ng/docs/api-authentication)
confirms the origin `https://youngpgmedia.com.ng`, `X-API-Key` authentication,
`GET /api/v1/categories`, paginated `GET /api/v1/listings`, NGN `price_ngn`,
`available_stock`, `listings:read` scope and `ypg_` + 48 hex character key format.
The adapter does not infer a provider from a key prefix or use ShopVia query auth.

Live credentials were not supplied or used. The adapter strictly accepts the
documented success envelope with a `data` collection (or nested `data.data`),
category `id/name` and listing `id/title/description/category_id/price_ngn/available_stock`.
The complete listing JSON shape and pagination metadata need a real read-only test;
unsupported shapes fail explicitly instead of importing guesses. Pagination is
bounded to 20 pages, 100 requested rows/page, 2 MB/response and 500 eligible products.
Every listings page requires validated `current_page/last_page` metadata. No partial snapshot
is committed. Imports are transactional and keyed by connection UUID + supplier ID.

Only the documented HTTPS origin and fixed read-only paths are allowed, with
redirects refused. Other provider URLs require a reviewed adapter, preventing the
admin URL field from becoming an arbitrary network proxy. The schema supports
multiple independent connections without altering legacy provider constraints.

Each credential uses AES-256-GCM, a random nonce and connection-ID authenticated
data. Config/key storage has RLS enabled, no browser policies and no grants to
anon/authenticated, including admins. Every Function verifies the Supabase identity,
confirmed email and database admin role before accessing service-role storage.
Metadata responses explicitly exclude key, ciphertext and nonce. Errors/logs never
include upstream responses, submitted keys or decrypted credentials. Approval RPCs
also enforce database admin roles, fresh sync and stored resale evidence.

## Payment and rollout limits

No sandbox/live payment gateway, credentials or verified webhook is configured.
Server-authoritative order totals, stock reservation, ledger, payment/purchase
idempotency and authorized fulfillment are unfinished. Checkout stays HTTP 503;
no purchase/order-delivery endpoint is called. YoungPG's documented account delivery
does not establish permission to resell that inventory or enable this checkout.

No SQL, imports, pushes or deployments were executed. After reviewing/applying the
additive migration and secrets, verify real admin/customer role denial, secret
replacement, supplier responses, complete sync, approval, retail price preservation
and private catalog visibility before approving deployment. Roll back the application
and disable the new connector while retaining new tables/data; do not drop tables or
replay old migrations. Verify credentials remain inaccessible to both browser roles
using `supabase/verify_suppliers.sql`.

Cloudflare's [native SPA fallback](https://developers.cloudflare.com/pages/configuration/serving-pages/#single-page-application-spa-rendering)
handles deep links without a top-level `404.html`; the previous looping redirect
rule was removed. Deploy only through Pages Git integration or Wrangler including
Functions, and only after approval.
