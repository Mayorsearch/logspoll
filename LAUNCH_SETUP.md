# LOGSPOLL connection, accounts and deployment checklist

Status: implementation prepared; **not production ready**. No database migrations, account creation, supplier imports, payments, pushes or deployments were executed.

**Latest supplier update:** you report existing login/database/manual products working. Follow [SUPPLIER_SETUP.md](SUPPLIER_SETUP.md) for the new YoungPG Settings page, encrypted key storage, additive migration and required server secrets. The older database repair notes and fixed ShopViaClone22 instructions below are historical; do not bootstrap or replay migrations against your working database. The new connector requires a service-role secret only in Pages Functions, unlike the legacy connector.

## Observed connection

The existing matching public Supabase configuration was recovered from the backup into ignored `.env.local` without changing the backup. Auth settings responded HTTP 200. Anonymous `GET /rest/v1/products?select=id&limit=0` returned HTTP 404 / `PGRST205` (table unavailable in API schema). This does not establish the full live schema or validate any login, RLS policy or administrator access.

## Database review and rollout

**Repair gate (2026-10-11):** a fresh read-only probe now finds all nine checked application resources unavailable (HTTP 404 / PGRST205), including categories, roles, profiles, orders and reviews. Follow [supabase/manual/README.md](supabase/manual/README.md) first. It provides read-only diagnostics and a guarded, atomic empty-schema bootstrap generated from the existing migrations. No SQL was executed. Dynamic supplier management is deferred until this database gate is resolved, per the latest request.

Open the existing project `hdxihldwkugboqrsxokh` in Supabase. In SQL Editor, inspect schema and applied migration history before applying anything:

```sql
select to_regclass('public.products'), to_regclass('public.categories'),
       to_regclass('public.user_roles'), to_regclass('public.orders'),
       to_regclass('public.profiles'), to_regclass('public.reviews');
select * from pg_policies where schemaname='public';
```

Review all retained migrations in timestamp order against the actual database. They are **not** idempotent scripts and must not be replayed blindly. The new `202610110001_live_marketplace.sql` depends on the earlier catalog/roles/orders/reviews schema. It proposes additive support/settings/supplier tables and role-checked RPCs; it is not applied automatically. Earlier private-catalog migration replaces public read policies to lock the catalog, so coordinate that security change explicitly. Preserve existing records and take a backup before approved rollout. Use `supabase/verify_phase2.sql` and inspect the new supplier/support/settings policies as well.

Rollback: revert the application commit to the prior compatible version while retaining the additive tables and their data. Do not automatically drop tables or erase imports to roll back. Disable the supplier action until schema compatibility is verified. Wholesale costs remain in admin-only `supplier_catalog`; storefront views project selling price only.

## Create two genuine accounts without hardcoded passwords

No privileged Supabase access or account email addresses were supplied, so accounts were not created.

1. Configure Supabase Authentication: Email/password enabled, Confirm Email enabled, reliable SMTP, and password policy. Add these redirect URLs for each actual local or hosted origin: `/auth/callback` and `/reset-password`. Keep default email confirmation URLs (`{{ .ConfirmationURL }}`) so Supabase processes verification before redirect. PKCE email links must open in the browser/profile that requested them.
2. At `http://127.0.0.1:5173/signup`, register your chosen REAL customer email with a unique strong password and confirm the email. Customer login: `http://127.0.0.1:5173/login`.
3. Register your chosen REAL administrator email through the same customer signup and confirm it. Public signup never grants administrator privileges. In the trusted Supabase SQL Editor, after verifying schema and that this is the intended account, replace the placeholder below and execute:

```sql
-- Operator-only role assignment; never run from browser code.
insert into public.user_roles(user_id,role)
select id,'admin' from auth.users
where email='REPLACE_WITH_YOUR_VERIFIED_ADMIN_EMAIL' and email_confirmed_at is not null
on conflict(user_id) do update set role='admin';
```

Confirm exactly the intended verified user has `role='admin'`. Admin login: `http://127.0.0.1:5173/admin/login`; panel: `/admin`. Set/reset passwords yourself through `/forgot-password`; no passwords are generated or recorded by this rebuild. Supabase identities and database roles persist across frontend deployments. No public administrator signup exists. Managing/deleting Auth users remains an operator task in Supabase; the in-app Customers section reads profiles, not the privileged Auth administration API.

## Supplier: required configuration and documentation

No supplier key was used. Configure the **replacement**, rotated key only in Cloudflare Pages secrets as `SUPPLIER_API_KEY`. For local Pages Functions, use ignored `.dev.vars`, following `.dev.vars.example`. Never use a `VITE_` name or commit secrets. Also configure server `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (public key; no service-role key is required for this implementation).

The supplier's public documentation link redirects to login. Only the endpoint paths supplied by you were available. Before enabling sync, provide verified official JSON response examples, units/currency and written resale authorization. The prepared adapter currently accepts **only**:

```json
{"categories":[{"id":"1","name":"Digital resources","products":[{"id":"3","name":"Licensed design resource","description":"Authorized resale description","price":"12.30","amount":"4"}]}]}
```

This is an **unverified adapter contract**, not a claim about the supplier's actual response. Confirm/adapt it to the official examples first. Only then set `SUPPLIER_SCHEMA_VERIFIED=shopviaclone22-v1` and `SUPPLIER_COST_CURRENCY` to the documented `USD` or `NGN`. Do not guess currency or assume the example product ID is eligible.

Set server `SUPPLIER_AUTHORIZED_PRODUCTS` to a JSON mapping of specifically verified product IDs to their license/resale evidence references. Empty/unconfigured blocks sync. Blocked account/cookie/session/credential inventory is excluded even if accidentally allowlisted. No unverified account logs are imported. Never bulk-allowlist the supplier catalog without individual resale verification.

The admin Sync action invokes an authenticated Pages Function. It verifies the Supabase user and database role, claims a database cooldown, fetches only fixed HTTPS endpoints with redirect refusal/timeouts/body limits, validates metadata, and upserts staged categories/listings transactionally by supplier ID. Only allowlisted metadata is stored; costs remain separate from retail prices. Operator approval requires a fresh sync, category, selling price and resale evidence. Rejected listings are disabled. Listings absent from the latest eligible snapshot are disabled, lose stock and return to pending approval. Refresh updates supplier costs and inventory; it does not silently overwrite the independently set customer selling price. Price unit conversions are explicit minor units. Imports are bounded to 500 eligible products, a 2 MB response, and no implicit pagination; larger/paginated catalogs require documented pagination support.

`/api/product.php` has a fixed-endpoint server helper but its response adapter/live use is still pending documentation. Account-profile data is not fetched. `/api/order.php` and purchases are not called. No purchase endpoint is guessed. Supplier fulfillment stays disabled until the documented purchase URL, authorization, payment verification, idempotency and legitimate order mapping are implemented and tested.

## Payments, cart and reviews

The private catalog, details and cart require verified authentication. Cart storage contains only product IDs/quantities, scoped by user; displayed estimates are refreshed from catalog data. The cart is not order/payment authority. Checkout returns unavailable and creates no order or charge. There was no existing payment provider in this checkout. Sandbox totals/reference generation, webhook idempotency, ledger, refunds, stock reservation and supplier purchase idempotency are unfinished and must be verified before enabling checkout. Live payments require your approval.

Review submission uses the existing `submit_review` RPC, which verifies paid/delivered ownership, enforces one review per item and rate limits. Admin moderation uses `moderate_review`; homepage publication uses the projected `published_reviews` RPC. The five exact illustrative Nigerian testimonials were recovered from the backup and are local-development-only, clearly labeled and excluded from production builds. These flows need live database testing.

## Cloudflare Pages configuration (NOT deployed)

- Git integration: repository `Mayorsearch/logspoll`, reviewed branch `rebuild/react-vite`. Do not switch/overwrite production automatically.
- Build: `npm run build`; output: `dist`; repository root as build root. Use Node 22.12+ (or compatible newer supported runtime).
- Configure frontend `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in Pages build environment. They are public. Configure supplier/backend secrets in Pages Function runtime settings for each intended environment.
- `wrangler.jsonc` configures the Pages output and runtime; compare its project name/configuration with your existing Pages project before any approved deployment. No account IDs or secret values are tracked.
- `functions/` is compiled through Git integration or Wrangler. Folder drag-and-drop of `dist` alone cannot deploy the secure backend. `_routes.json` limits function invocation to `/api/*`; `_redirects` handles frontend SPA refreshes.
- For frontend-only development: `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`.
- For full Pages runtime locally after a build: `npx wrangler pages dev dist --port 8788`. Supply `.dev.vars` and allow `http://localhost:8788/auth/callback` and `http://localhost:8788/reset-password` if using that origin. Use one consistent actual origin for signup/reset; configure Supabase redirects accordingly. Plain Vite does not execute Pages Functions.

Before deployment, test actual signup/confirmation/login/recovery/logout, real admin/customer identities, direct API cross-user isolation, role denial, blocked anonymous catalog access, supplier allowlisting/error states, stock refresh and genuine reviews. Browser responsive/click QA, live RLS and provider/payment end-to-end tests are unverified. Legal drafts need review. No demo login routes remain.

Primary references: [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/), [Wrangler Pages configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/), [Supabase user management](https://supabase.com/docs/guides/auth/managing-user-data).
