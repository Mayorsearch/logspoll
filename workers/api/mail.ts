import { renderEmail } from '../../src/lib/email-templates.ts'
import type { EmailKind, EmailData } from '../../src/lib/email-templates.ts'
import type { ApiEnv } from './types.ts'

export const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('')
async function key(env: ApiEnv) {
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.AUTH_SECRET)), 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function enqueueMail(env: ApiEnv, event: string, kind: EmailKind, user: { email: string; name: string }, otp?: string, otpSubject?: string, extraData?: Partial<EmailData>) {
  const message = renderEmail(kind, { firstName:user.name, appOrigin:env.APP_ORIGIN??env.AUTH_ORIGIN, ...(otp?{verificationCode:otp}:{}), ...(extraData??{}) })
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(JSON.stringify({ from: 'LogsPoll <no-reply@logspoll.com>', to: [user.email], ...message })))
  const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
  const id = await digest(event)
  const now = Date.now()
  const insert = env.DB!.prepare('INSERT OR IGNORE INTO auth_mail_outbox(id,payload,iv,created_at,next_attempt,expires_at,otp_subject) VALUES(?,?,?,?,?,?,?)')
    .bind(id, encode(new Uint8Array(ciphertext)), encode(iv), now, now, otp ? now + 600000 : null, otpSubject ?? null)
  if (otp && otpSubject) {
    await env.DB!.batch([
      env.DB!.prepare('UPDATE auth_mail_outbox SET expires_at=? WHERE otp_subject=? AND delivered_at IS NULL').bind(now, otpSubject),
      insert,
    ])
  } else {
    await insert.run()
  }
}
// D1 claims prevent overlapping deliveries. Resend deduplicates retries after an uncertain response.
// Never retry beyond its 24h idempotency retention, or send an expired authentication code.
export async function drainMail(env: ApiEnv) {
  if (!env.DB || !env.AUTH_SECRET || !env.RESEND_API_KEY) return
  // Two bounded deliveries stay below the background execution window, including retries.
  for (let batch = 0; batch < 2; batch++) {
    const now = Date.now(); const owner = crypto.randomUUID()
    const row = await env.DB.prepare(`UPDATE auth_mail_outbox SET lease_owner=?,lease_until=? WHERE id=(
      SELECT id FROM auth_mail_outbox WHERE delivered_at IS NULL AND attempts<6 AND next_attempt<=?
      AND created_at>? AND (expires_at IS NULL OR expires_at>?) AND (lease_until IS NULL OR lease_until<?) ORDER BY created_at LIMIT 1
    ) RETURNING id,payload,iv,created_at,attempts`).bind(owner, now + 30000, now, now - 15 * 60000, now, now).first<{ id: string; payload: string; iv: string; created_at: number; attempts: number }>()
    if (!row) break
    let failure = 'mail_decryption_failed'
    try {
      const decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0))
      const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(row.iv) }, await key(env), decode(row.payload))
      const body=new TextDecoder().decode(clear)
      // Retire queued link-based auth mail from before the OTP cutover. Other
      // notifications remain intact, and no encrypted payload is logged.
      if (/\/api\/auth\/(?:verify-email\?|reset-password\/)/.test(body)) {
        await env.DB.prepare("UPDATE auth_mail_outbox SET expires_at=?,last_error='legacy_auth_link_retired',lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?").bind(Date.now(),row.id,owner).run()
        continue
      }
      const current=await env.DB.prepare('SELECT id FROM auth_mail_outbox WHERE id=? AND lease_owner=? AND (expires_at IS NULL OR expires_at>?)').bind(row.id,owner,Date.now()).first()
      if(!current)continue
      failure = 'provider_key_invalid'
      const apiKey = env.RESEND_API_KEY.trim()
      if (!/^re_[A-Za-z0-9_-]{10,}$/.test(apiKey)) throw new Error('Invalid email key binding')
      failure = 'provider_network_error'
      // Workers supports manual/follow only. Reject 3xx below without forwarding credentials.
      const response = await fetch('https://api.resend.com/emails', { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000), headers: {
        Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `logspoll-auth/${row.id}`,
      }, body })
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

// Events are committed with their business mutation. Queue IDs make retries deduplicate.
export async function drainBusinessMail(env:ApiEnv) {
 if(!env.DB||!env.AUTH_SECRET)return
 let rows:{results:{id:string;kind:EmailKind;email:string;name:string}[]}
 try{rows=await env.DB.prepare("SELECT e.id,e.kind,a.email,a.name FROM business_mail_events e JOIN auth_user a ON a.id=e.user_id WHERE e.queued_at IS NULL AND a.emailVerified=1 ORDER BY e.created_at LIMIT 2").all()}catch{return}
 for(const row of rows.results){
  let orderId = row.id.includes(':') ? row.id.split(':')[0] : null
  if(!orderId){
   const audit = await env.DB.prepare("SELECT record_id FROM audit_logs WHERE id=? AND table_name='orders'").bind(row.id).first<{record_id:string}>().catch(()=>null)
   if(audit) orderId = audit.record_id
  }
  let extraData: Partial<EmailData> | undefined
  if(orderId){
   const order = await env.DB.prepare("SELECT id,reference,total_minor,currency,payment_status,fulfillment_status FROM orders WHERE id=?").bind(orderId).first<{id:string;reference:string;total_minor:number;currency:string;payment_status:string;fulfillment_status:string}>().catch(()=>null)
   if(order){
    const items = await env.DB.prepare("SELECT product_name,quantity,unit_price_minor FROM order_items WHERE order_id=?").bind(order.id).all<{product_name:string;quantity:number;unit_price_minor:number}>().catch(()=>({results:[]}))
    extraData = {
     orderId: order.id,
     reference: order.reference,
     amountMinor: order.total_minor,
     paymentStatus: order.payment_status,
     fulfillmentStatus: order.fulfillment_status,
     orderItems: items.results.map(i => ({ name: i.product_name, quantity: i.quantity, priceMinor: i.unit_price_minor })),
     orderDetailsUrl: `${env.APP_ORIGIN ?? env.AUTH_ORIGIN ?? 'https://logspoll.com'}/dashboard?tab=orders`
    }
   }
  }
  await enqueueMail(env,'business:'+row.id,row.kind,row,undefined,undefined,extraData)
  await env.DB.prepare('UPDATE business_mail_events SET queued_at=? WHERE id=? AND queued_at IS NULL').bind(Date.now(),row.id).run()
 }
}
