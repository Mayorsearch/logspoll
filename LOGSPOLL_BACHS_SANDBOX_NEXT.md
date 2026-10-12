# LOGSPOLL Bachs sandbox checkout — payment verified, supplier purchasing BLOCKED

**Stage:** offline code patch; uninstalled, un-migrated, and not connected to your personal Bachs or YoungPG accounts. Do **not** deploy or enable live payments. Source ZIP supplied by the user was the basis for these changes, plus the two earlier patches they installed locally.

## What this patch includes

- Server-side Bachs **sandbox only** checkout using the authenticated customer's identity and server-side prices for **one eligible approved product per test**.
- Durable, isolated `bachs_sandbox_orders` table; stable Bachs `reference` and `Idempotency-Key` tied to the order ID.
- An isolated webhook event ledger, signature checks against the **raw request body**, an authoritative **GET** from Bachs, amount and currency matching, and transactional event deduplication. `checkout.completed` without `payment_status=paid` does not count.
- A customer-only sandbox order status route: `GET /api/bachs/order?id=<order UUID>`.
- An **optional** UI test button, controlled by a build-time flag, which is OFF by default. Existing live checkout remains unavailable.
- A blocked fulfillment job after successful sandbox payment. The code **never calls YoungPG's purchase endpoint**, never spends supplier wallet funds, never stores/displays supplier credentials and never marks real `public.orders` paid. The next phase must implement permitted, fully reviewed supplier fulfillment and reconciliation before any live payment.

## Important supplier blocker

YoungPG's current API (`https://youngpgmedia.com.ng/docs/api-authentication`) documents `POST /api/v1/purchase` with `orders:write` and a `{slug,quantity}` request. It returns account credentials, and says a POST is **not safe to retry** after timeouts/502s; callers must reconcile with `GET /api/v1/orders`. Your existing catalog key has `listings:read` only. **Do not upgrade or share it in this patch**. An independent purchase key and vetted eligible product types/transfer permissions are prerequisites to automatic supplier fulfillment. Bachs may disallow certain types of goods, so verify provider acceptance.

## Install into your existing Mac project

1. Back up your current `~/logs` folder. The prior backup you created covers only selected files, so back up the **whole project** before overwriting additional files.
2. Locate the downloaded ZIP using Finder (Chrome previously downloaded ZIPs into `/Users/mayowacnc` rather than Downloads).
3. Unzip into `~/logs`, retaining the directory structure. It intentionally replaces:
   - `server/bachs.ts` (adds safe local sandbox URL handling, stable checkout reference, verified session retrieval)
   - `functions/api/checkout.ts` (still fail-closed unless enabled, preserving old no-context test)
   - `src/pages/Cart.tsx` (optional test-only UI)
   Creates: `server/bachs-flow.ts`, `server/bachs-auth.ts`, `functions/api/webhooks/bachs.ts`, `functions/api/bachs/order.ts`, SQL migration, tests, README.
4. Run `cd ~/logs && npm test && npm run build`. Your existing 32 tests plus four new pure-helper tests should be evaluated, but **do not assume** they pass until verified on your Mac. Do not proceed to database changes on failed tests.

## Database migration — REVIEW, BACK UP, APPLY ONCE

New SQL: `supabase/migrations/202610110004_bachs_sandbox_payment_ledger.sql`.

Review for compatibility with the Supabase tables already installed; then back up the database and apply this new migration ONCE in Supabase SQL Editor. **Never rerun the bootstrap or previous migrations.** It creates three separate sandbox-only tables and three service-role-only RPCs. It does **not** modify `public.orders`, `public.order_items`, `public.product_entitlements`, existing inventory or supplier keys. It does not reserve inventory; payment is sandbox-only and stock must be rechecked before any future real charge.

## Set up Bachs local webhook testing *after* verifying code and migration

Bachs [CLI local forwarding](https://docs.bachs.io/developer-portal/local-testing) is the recommended option. Install its CLI by the current official instructions, sign in to **sandbox**, then in a second Terminal:

```bash
bachs listen --forward-to localhost:8788/api/webhooks/bachs --events checkout.completed,collection.succeeded
```

The CLI prints a per-session `whsec_...` signing secret. Add **only to ignored `.dev.vars`**:

```dotenv
BACHS_API_KEY=YOUR_EXISTING_SANDBOX_KEY
BACHS_WEBHOOK_SECRET=YOUR_LOCAL_BACHS_CLI_SIGNING_SECRET
BACHS_SANDBOX_ENABLED=true
```

When restarting CLI forwarding you may need to replace that session secret and restart Wrangler. Do not send it to chat or commit it. For the optional browser button, add this non-secret flag to **ignored `.env.local`**:

```dotenv
VITE_BACHS_SANDBOX_TEST_UI=true
```

Then `npm run build` and `npx wrangler pages dev dist --port 8788`. Open `http://localhost:8788/cart` while signed in. Your Bachs sandbox key must allow `payments:write` (create checkout) and `payments:read` (verify checkout). A one-item eligible, approved supplier-backed listing is required; the test will refuse excluded account-access inventory, unapproved products, missing authorization, or missing stock.

Bachs disallows `localhost` in its `success_url`/`cancel_url`, even in sandbox. The new session helper intentionally **omits them** for local testing. Manually return to your site and press **Check test order status**. The `order_id` stays in your browser's session storage; it is not sufficient to change paid state. See [Bachs checkout](https://docs.bachs.io/guides/checkout/checkout-sessions).

## Verify before any more changes

- Success: `checkout.completed` + `collection.succeeded` in either order => one sandbox payment record, one **blocked** fulfillment job, no purchase/delivery.
- Duplicate event deliveries => no additional order or job.
- Invalid signature, stale timestamp, wrong amount/currency, unpaid checkout, invalid customer => reject/hold; never deliver.
- Do not enable production keys or create webhook destinations for live money.
- Refunds, disputes, delayed payments, supplier wallet balance, purchase idempotency, actual delivery, and complete stock reservation/recovery still need production-grade implementation and tests.

## Data and security boundaries

No supplier account-password or session-token delivery is implemented. The original YoungPG catalog exclusion filter remains intact. Sandbox payment verification is a separate step from authorized product delivery.
