import test from 'node:test'
import assert from 'node:assert/strict'
import { youngpgGet, SupplierReadError } from '../server/youngpg.ts'
const base = 'https://youngpgmedia.com.ng'
const key = `ypg_${'a'.repeat(48)}`

test('catalog reads use bounded listing/detail timeouts', async t => {
  const limits: number[] = []
  t.mock.method(AbortSignal, 'timeout', (ms: number) => { limits.push(ms); return new AbortController().signal })
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, data: [] }))
  await youngpgGet(base, key, 'listings', 4)
  await youngpgGet(base, key, 'listings/private-slug')
  await youngpgGet(base, key, 'categories')
  assert.deepEqual(limits, [20000, 15000, 10000])
})

test('listing and detail network failures expose safe context without upstream secrets', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError(`${key} private upstream URL`, { cause: { code: 'ENOTFOUND' } }) })
  for (const [resource, context] of [['listings', 'Listing page 4'], ['listings/private-slug', 'Product detail']] as const) {
    await assert.rejects(youngpgGet(base, key, resource, 4), error => {
      assert.ok(error instanceof SupplierReadError)
      assert.match(error.message, new RegExp(context))
      assert.match(error.message, /DNS lookup failed/)
      assert.ok(!error.message.includes(key) && !error.message.includes('private'))
      return true
    })
  }
})

test('fetch and response-body timeouts retain retryable safe diagnostics', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new DOMException(key, 'TimeoutError') })
  await assert.rejects(youngpgGet(base, key, 'listings', 2), error => error instanceof SupplierReadError && error.status === 504 && /Listing page 2.*20s limit/.test(error.message) && !error.message.includes(key))
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) { controller.error(new DOMException(key, 'TimeoutError')) } }), { headers: { 'Content-Type': 'application/json' } }))
  await assert.rejects(youngpgGet(base, key, 'listings/private-slug'), error => error instanceof SupplierReadError && error.status === 504 && /Product detail.*15s limit/.test(error.message) && !error.message.includes(key))
})
