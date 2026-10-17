# Bachs D1 payment blockers — 2026-10-14

Checkout remains disabled. This is not a completed payment integration.

## Confirmed evidence

- Production Pages has `BACHS_API_KEY` and `BACHS_WEBHOOK_SECRET` secret bindings.
  Cloudflare does not return their values; their contents are not assumed valid.
- The locally configured key is a sandbox key. Documented read-only balance and
  webhook-list requests both returned HTTP 200. No matching
  `https://logspoll.com/api/webhooks/bachs` destination appeared in that response.
  This proves only the local sandbox configuration, not the production secret.
- Production D1 has no payment-attempt, webhook-event or inventory-reservation
  tables. Checkout and webhook Functions are deliberately disabled HTTP 503 stubs.
  Existing sandbox helpers do not record real D1 orders or authorize fulfillment.
- Admin → Payments now offers authenticated, read-only readiness checks. Errors
  distinguish authentication, permissions, rate limits and timeouts. No provider
  response bodies, keys or signing secrets are returned. A readable webhook list
  never enables checkout or proves payment permissions/signature ownership.

## Documented protocol

- [Authentication](https://docs.bachs.io/authentication): separate `sk_sandbox_`
  and `sk_live_` keys; live origin `https://api.bachs.io`; live merchant approval
  required. Keep environments separate.
- [Checkout](https://docs.bachs.io/api-reference/payments/create-checkout-session):
  `POST /v1/checkout-sessions`; trusted server-calculated NGN raw pricing;
  provider idempotency key; retrieve checkout before accepting paid status.
- [Webhooks](https://docs.bachs.io/guides/webhooks/overview): raw-body
  HMAC-SHA256 over `timestamp.raw_body`, timestamp tolerance, signing-secret
  rotation support, replay protection and durable event deduplication.
- [Webhook configuration](https://docs.bachs.io/api-reference/webhooks/list-webhook-endpoints):
  `GET /v1/webhooks/endpoints`, `webhooks:read` scope. Diagnostics request at most
  one bounded page and report an incomplete page as unverified.
- [Permitted businesses](https://docs.bachs.io/for-you/supported-businesses):
  do not assume a supplier's product listing establishes merchant permission or
  resale/delivery rights. Unauthorized access and customer-data sales are prohibited.

## Required implementation before activation

1. Add and stage-test additive D1 payment-attempt, signed-webhook-event and
   inventory-reservation tables, uniqueness/fence constraints and supporting indexes.
   Preserve existing orders and product freshness/authorization checks.
2. Port checkout into a D1 backend: customer/session/CSRF checks, server prices,
   fresh verified stock, atomic reservations, immutable order-item snapshots and
   durable idempotency. An ambiguous timeout must reuse the same attempt.
3. Port webhook handling: bounded raw body, signature verification, authenticated
   provider retrieval, exact reference/currency/amount matching, atomic once-only
   payment/order transitions, reservation accounting, pending/failure/cancellation
   recovery and duplicate-proof notification/fulfillment events.
4. Connect customer order/payment history and administrator transaction management.
   Keep delivery behind confirmed paid status and separately verified fulfillment.
5. Use a provider sandbox key and matching registered sandbox webhook to test the
   full flow, retries, races, stale stock, incorrect amounts and replay attacks.
   Verify production key scopes, merchant approval and the live webhook separately.
6. Activate only after those tests pass and the required live approval is recorded.
   No real charge or supplier purchase was initiated by this recovery.

Primary files: `server/bachs.ts`, `server/bachs-flow.ts`,
`functions/api/checkout.ts`, `functions/api/webhooks/bachs.ts`,
`workers/api/index.ts`, a new D1 payment backend and additive migration,
`src/admin/CloudflarePayments.tsx`, and existing cart/order screens.
