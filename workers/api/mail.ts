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
  const now = Date.now(); const owner = crypto.randomUUID()
  const row = await env.DB.prepare(`UPDATE auth_mail_outbox SET lease_owner=?,lease_until=? WHERE id=(
    SELECT id FROM auth_mail_outbox WHERE delivered_at IS NULL AND attempts<6 AND next_attempt<=?
    AND created_at>? AND (lease_until IS NULL OR lease_until<?) ORDER BY created_at LIMIT 1
  ) RETURNING id,payload,iv,created_at,attempts`).bind(owner, now + 30000, now, now - 15 * 60000, now).first<{ id: string; payload: string; iv: string; created_at: number; attempts: number }>()
  if (!row) return
  try {
    const decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0))
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(row.iv) }, await key(env), decode(row.payload))
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `logspoll-auth/${row.id}`,
    }, body: new TextDecoder().decode(clear) })
    if (!response.ok) throw new Error('Email provider rejected delivery')
    await env.DB.prepare('UPDATE auth_mail_outbox SET delivered_at=?,payload=\'\',iv=\'\',lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?').bind(Date.now(), row.id, owner).run()
  } catch {
    await env.DB.prepare('UPDATE auth_mail_outbox SET attempts=attempts+1,next_attempt=?,lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?').bind(now + Math.min(300000, 30000 * 2 ** row.attempts), row.id, owner).run()
  }
  await env.DB.prepare('DELETE FROM auth_mail_outbox WHERE created_at<?').bind(now - 86400000).run()
  await env.DB.prepare('DELETE FROM auth_email_tokens WHERE expires_at<?').bind(now).run()
}
