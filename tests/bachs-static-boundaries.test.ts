import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const file = (path: string) => readFileSync(new URL(path,import.meta.url),'utf8')
test('sandbox webhook cannot call the YoungPG purchase endpoint', () => {
  const checkout = file('../functions/api/checkout.ts')
  const webhook = file('../functions/api/webhooks/bachs.ts')
  assert.ok(!checkout.includes('/api/v1/purchase'))
  assert.ok(!webhook.includes('/api/v1/purchase'))
  assert.ok(webhook.includes('verifyBachsWebhook'))
  assert.ok(webhook.includes('getSandboxSession'))
})
test('sandbox database requires isolated ledger and blocked fulfillment', () => {
  const sql = file('../supabase/migrations/202610110004_bachs_sandbox_payment_ledger.sql')
  assert.ok(sql.includes('bachs_sandbox_events'))
  assert.ok(sql.includes("state text not null default 'blocked'"))
  assert.ok(sql.includes('grant execute on function public.prepare_bachs_sandbox_checkout'))
  assert.ok(!sql.includes('update public.orders set payment_status'))
})
