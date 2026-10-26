import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import {
  DEFAULT_WHATSAPP_NUMBER,
  cleanWhatsAppNumber,
  buildWhatsAppMessage,
  buildWhatsAppUrl,
  sanitizeComplaint
} from '../src/lib/whatsapp.ts'
import { apiFetch } from '../workers/api/index.ts'

test('cleanWhatsAppNumber returns default number when undefined, null, or empty', () => {
  assert.equal(cleanWhatsAppNumber(), DEFAULT_WHATSAPP_NUMBER)
  assert.equal(cleanWhatsAppNumber(null), DEFAULT_WHATSAPP_NUMBER)
  assert.equal(cleanWhatsAppNumber(''), DEFAULT_WHATSAPP_NUMBER)
})

test('cleanWhatsAppNumber strips plus sign, spaces, dashes, and parentheses', () => {
  assert.equal(cleanWhatsAppNumber('+2348117472091'), '2348117472091')
  assert.equal(cleanWhatsAppNumber('+234 811 747 2091'), '2348117472091')
  assert.equal(cleanWhatsAppNumber('(+234) 811-747-2091'), '2348117472091')
})

test('cleanWhatsAppNumber falls back to default if number is invalid/too short', () => {
  assert.equal(cleanWhatsAppNumber('123'), DEFAULT_WHATSAPP_NUMBER)
  assert.equal(cleanWhatsAppNumber('abc'), DEFAULT_WHATSAPP_NUMBER)
})

test('buildWhatsAppMessage formats general complaint correctly', () => {
  const msg = buildWhatsAppMessage('I am unable to deposit funds.')
  assert.equal(
    msg,
    "I'm here from LogsPoll.\n\nMy complaint is: I am unable to deposit funds."
  )
})

test('buildWhatsAppMessage formats order-related complaint correctly with order reference', () => {
  const msg = buildWhatsAppMessage(
    'Product credentials were not received.',
    'ORD-20261026-99A1'
  )
  assert.equal(
    msg,
    "I'm here from LogsPoll.\n\nOrder Reference: ORD-20261026-99A1\n\nMy complaint is: Product credentials were not received."
  )
})

test('buildWhatsAppMessage trims whitespace from complaint and order reference', () => {
  const msg = buildWhatsAppMessage('   Payment debited twice   ', '   REF123   ')
  assert.equal(
    msg,
    "I'm here from LogsPoll.\n\nOrder Reference: REF123\n\nMy complaint is: Payment debited twice"
  )
})

test('buildWhatsAppUrl generates standard wa.me URL with encoded message', () => {
  const url = buildWhatsAppUrl({
    complaint: 'Need assistance with an account inquiry.'
  })
  assert.ok(url.startsWith('https://wa.me/2348117472091?text='))
  const encodedText = url.split('?text=')[1]
  assert.equal(
    decodeURIComponent(encodedText),
    "I'm here from LogsPoll.\n\nMy complaint is: Need assistance with an account inquiry."
  )
})

test('buildWhatsAppUrl generates wa.me URL with order reference', () => {
  const url = buildWhatsAppUrl({
    phone: '+234 811 747 2091',
    complaint: 'Delivered key invalid.',
    orderReference: 'ORD-77441'
  })
  assert.ok(url.startsWith('https://wa.me/2348117472091?text='))
  const encodedText = url.split('?text=')[1]
  assert.equal(
    decodeURIComponent(encodedText),
    "I'm here from LogsPoll.\n\nOrder Reference: ORD-77441\n\nMy complaint is: Delivered key invalid."
  )
})

test('sanitizeComplaint redacts tokens and password fields from message text', () => {
  const sanitized = sanitizeComplaint(
    'Hello, my password: supersecretpassword123 and session eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMCda8Yhe3iZaWbvV5XKSTbuAn0M'
  )
  assert.ok(!sanitized.includes('supersecretpassword123'))
  assert.ok(sanitized.includes('password: [REDACTED]'))
  assert.ok(sanitized.includes('[TOKEN_REDACTED]'))
})

test('public /api/config endpoint returns website_settings with WhatsApp support configuration', async () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec("CREATE TABLE website_settings (key TEXT PRIMARY KEY NOT NULL CHECK(key='general'), value TEXT NOT NULL CHECK(json_valid(value) AND json_type(value)='object')) STRICT;")
  sqlite.exec("INSERT INTO website_settings (key, value) VALUES ('general', '{\"whatsapp_number\":\"2348117472091\",\"support_email\":\"support@logspoll.com\"}')")
  const db = {
    prepare(sql: string) {
      let values: unknown[] = []
      const stmt = {
        bind(...args: unknown[]) { values = args; return stmt },
        async all() { const results = sqlite.prepare(sql).all(...values as never[]); return { results, success: true } },
        async first() { return (await stmt.all()).results[0] ?? null }
      }
      return stmt
    }
  } as any
  const env = { DB: db, ENVIRONMENT: 'staging' } as any

  const req = new Request('https://staging.test/api/config', { method: 'GET' })
  const res = await apiFetch(req, env)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=60')
  const body = (await res.json()) as { settings: { whatsapp_number: string; support_email: string } }
  assert.equal(body.settings.whatsapp_number, '2348117472091')
  assert.equal(body.settings.support_email, 'support@logspoll.com')
})
