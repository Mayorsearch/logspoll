import test from 'node:test'
import assert from 'node:assert/strict'
import { cloudflareRequest } from '../src/lib/cloudflare-auth.ts'

test('Cloudflare client sends cookie credentials and reports authentication errors', async t => {
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store')
    assert.equal((init.headers as Record<string, string> | undefined)?.Authorization, undefined)
    return Response.json({ error: 'Verified sign-in required.' }, { status: 401 })
  })
  await assert.rejects(cloudflareRequest('/api/orders'), /Verified sign-in required/)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Administrator access required.' }, { status: 403 }))
  await assert.rejects(cloudflareRequest('/api/admin/overview'), /Administrator access required/)
})
test('Cloudflare client never treats Access HTML or malformed JSON as successful writes', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>Access login</html>', { headers: { 'Content-Type': 'text/html' } }))
  await assert.rejects(cloudflareRequest('/api/support', { subject: 'Help' }), /unexpected response/)
  t.mock.method(globalThis, 'fetch', async () => new Response('{invalid', { headers: { 'Content-Type': 'application/json' } }))
  await assert.rejects(cloudflareRequest('/api/support', { subject: 'Help' }), /invalid response/)
})


test('redirects stay within allowed account routes',async()=>{
 const {safeReturnTo}=await import('../src/lib/auth-policy.ts')
 for(const path of ['https://evil.test','//evil.test','/dashboard/../../admin','/admin/users'])assert.equal(safeReturnTo(path),'/dashboard')
 assert.equal(safeReturnTo('/dashboard/orders'),'/dashboard/orders')
})

test('HTML gateway failures report HTTP status without displaying upstream HTML',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('<html>private upstream body</html>',{status:502,headers:{'Content-Type':'text/html'}}))
 await assert.rejects(cloudflareRequest('/api/admin/catalog',{action:'sync'}),e=>e instanceof Error&&e.message.includes('HTTP 502')&&!e.message.includes('private upstream'))
})
