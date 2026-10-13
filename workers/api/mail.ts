import { renderEmail } from '../../src/lib/email-templates.ts'
import type { EmailKind } from '../../src/lib/email-templates.ts'
import type { ApiEnv } from './types.ts'

export const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('')
async function key(env: ApiEnv) {
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.AUTH_SECRET)), 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function enqueueMail(env: ApiEnv, event: string, kind: EmailKind, user: { email: string; name: string }, url?: string) {
  const message = renderEmail(kind, { firstName: user.name, ...(url ? { confirmationUrl: url, confirmationOrigin: env.AUTH_ORIGIN, confirmationProvider: 'cloudflare' as const } : {}) })
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(JSON.stringify({ from: 'LOGSPOLL <no-reply@logspoll.com>', to: [user.email], ...message })))
  const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
  const id = await digest(event)
  await env.DB!.prepare('INSERT OR IGNORE INTO auth_mail_outbox(id,payload,iv,created_at,next_attempt) VALUES(?,?,?,?,?)').bind(id, encode(new Uint8Array(ciphertext)), encode(iv), Date.now(), Date.now()).run()
}
// D1 claims prevent overlapping deliveries. Resend deduplicates retries after an uncertain response.
// Never retry beyond its 24h idempotency retention, or send an expired authentication link.
export async function drainMail(env: ApiEnv) {
  if (!env.DB || !env.AUTH_SECRET || !env.RESEND_API_KEY) return
  // Two bounded deliveries stay below the background execution window, including retries.
  for (let batch = 0; batch < 2; batch++) {
    const now = Date.now(); const owner = crypto.randomUUID()
    const row = await env.DB.prepare(`UPDATE auth_mail_outbox SET lease_owner=?,lease_until=? WHERE id=(
      SELECT id FROM auth_mail_outbox WHERE delivered_at IS NULL AND attempts<6 AND next_attempt<=?
      AND created_at>? AND (lease_until IS NULL OR lease_until<?) ORDER BY created_at LIMIT 1
    ) RETURNING id,payload,iv,created_at,attempts`).bind(owner, now + 30000, now, now - 15 * 60000, now).first<{ id: string; payload: string; iv: string; created_at: number; attempts: number }>()
    if (!row) break
    let failure = 'mail_decryption_failed'
    try {
      const decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0))
      const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(row.iv) }, await key(env), decode(row.payload))
      failure = 'provider_key_invalid'
      const apiKey = env.RESEND_API_KEY.trim()
      if (!/^re_[A-Za-z0-9_-]{10,}$/.test(apiKey)) throw new Error('Invalid email key binding')
      failure = 'provider_network_error'
      // Workers supports manual/follow only. Reject 3xx below without forwarding credentials.
      const response = await fetch('https://api.resend.com/emails', { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000), headers: {
        Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `logspoll-auth/${row.id}`,
      }, body: new TextDecoder().decode(clear) })
      failure = `provider_http_${response.status}`
      if (!response.ok) { await response.body?.cancel(); throw new Error('Email provider rejected delivery') }
      failure = 'provider_invalid_response'
      const accepted = await response.json() as { id?: unknown }
      if (typeof accepted.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(accepted.id)) throw new Error('Invalid provider receipt')
      // Provider acceptance is not proof of inbox delivery.
      failure = 'receipt_persistence_failed'
      await env.DB.prepare('UPDATE auth_mail_outbox SET delivered_at=?,provider_message_id=?,last_error=NULL,payload=\'\',iv=\'\',lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?').bind(Date.now(), accepted.id, row.id, owner).run()
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') failure = 'provider_timeout'
      else if (failure === 'provider_network_error' && error instanceof TypeError) failure = 'provider_transport_type_error'
      await env.DB.prepare('UPDATE auth_mail_outbox SET attempts=attempts+1,next_attempt=?,last_error=?,lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?').bind(Date.now() + Math.min(300000, 30000 * 2 ** row.attempts), failure, row.id, owner).run()
    }
  }
  const now = Date.now()
  await env.DB.prepare('DELETE FROM auth_mail_outbox WHERE created_at<?').bind(now - 86400000).run()
  await env.DB.prepare('DELETE FROM auth_email_tokens WHERE expires_at<?').bind(now).run()
}
