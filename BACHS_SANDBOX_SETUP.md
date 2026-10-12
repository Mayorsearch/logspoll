# LOGSPOLL Bachs payment groundwork — NOT LIVE CHECKOUT

This patch adds **only** a sandbox Bachs client and signed-webhook verifier with offline tests. It intentionally does not modify `functions/api/checkout.ts` or the customer checkout page, which MUST remain disabled until end-to-end order and inventory safety are implemented and verified. It changes no Supabase tables.

## Install on Mac

1. Keep a backup of your `~/logs` project.
2. Extract the ZIP over `~/logs`, maintaining paths. It creates `server/bachs.ts` and `tests/bachs.test.ts`, plus this README.
3. Run `cd ~/logs && npm test && npm run build`.

## Config

Your existing `.dev.vars` should already contain a *sandbox* `BACHS_API_KEY` beginning `sk_sandbox_`. Never put it in `VITE_` variables or commit `.dev.vars`.

Bachs signs webhooks using a different **endpoint signing secret**. In the Bachs sandbox dashboard, visit **Developer Portal → Webhooks**, register a new endpoint when a safe webhook handler is available, then put the separate signing secret in `.dev.vars` as `BACHS_WEBHOOK_SECRET`. Do not invent a webhook URL and do not point one at the disabled checkout route. You can also use Bachs's official local forwarding workflow later. Never share the key or signing secret.

## Remaining before payments may be accepted

- A durable Supabase payment-attempt and event ledger with a unique Bachs checkout ID and event ID, idempotent writes and replay handling.
- Server-authoritative customer identity and checkout totals; stock reservation and recovery/expiration rules; only permitted authorized listings.
- Create a hosted checkout session from a trusted order amount, and link its checkout ID transactionally to the pending order.
- A Cloudflare Pages webhook handler: raw-body HMAC verification, 5-minute clock skew, payment status/amount/currency matching, dedupe by Bachs event ID, and order state transition inside a database transaction.
- Manual authorized fulfillment (the existing orders table supports this); refund/dispute handling; sandbox tests including duplicates, retries, mismatch, underpayment, insufficient stock and checkout expiry.
- A publicly reachable HTTPS endpoint, or Bachs official local forwarding, to exercise webhook delivery.
- Independent confirmation the merchant account and individual goods comply with both Bachs and supplier permitted-business/resale policies.

Official docs: https://docs.bachs.io/guides/checkout/checkout-sessions and https://docs.bachs.io/guides/webhooks/overview
