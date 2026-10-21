import { renderPremiumEmail } from './premium-email.ts'
// Shared by Pages Functions, the admin preview, and the static Cloudflare export.
// Templates describe notifications; rendering never sends or changes business records.
export const emailTemplates = {
  welcome: ['Welcome to LogsPoll', 'Your account is ready.', 'Your email is verified. Welcome to your private digital marketplace.', 'Open marketplace', '/marketplace', 'Verified account activation', false],
  verification: ['Verify your email', 'Your account. Your next move.', 'Verify your email to activate your LogsPoll account.', 'Verify email address', '', 'Cloudflare signup confirmation', true],
  password_reset: ['Reset your password', 'Let’s get you back in.', 'Use the six-digit code on LogsPoll to choose a new password. If you did not request this, ignore this email.', 'Reset password', '', 'Cloudflare recovery request', true],
  password_changed: ['Your password was changed', 'Your security comes first.', 'Your LogsPoll password was changed. If this was not you, reset your password and contact support immediately.', 'Secure my account', '/forgot-password', 'Cloudflare password-changed notification', true],
  email_changed: ['Your email address was changed', 'Your account details changed.', 'Your LogsPoll email address was changed. If you did not authorize this, contact support immediately.', 'Contact support', '/support', 'Cloudflare email-changed notification', true],
  new_signin: ['New sign-in detected', 'Was this you?', 'A new or unusual sign-in was detected. Review your account security if you do not recognize this activity.', 'Review security', '/dashboard/settings', 'Reliable server-side sign-in detection; not yet implemented', true],
  wallet_funded: ['Wallet funding confirmed', 'Your funds are available.', 'Your funding payment was verified and your wallet balance has been credited.', 'View wallet', '/dashboard/wallet', 'Verified funding and committed wallet credit', true],
  wallet_payment: ['Wallet payment confirmed', 'Payment from wallet complete.', 'Your wallet was debited and your order is confirmed.', 'View order', '/dashboard/orders', 'Wallet debit for purchase', true],
  wallet_adjustment: ['Wallet balance adjustment', 'Your wallet balance was updated.', 'An authorized administrative adjustment was applied to your LogsPoll wallet.', 'View wallet', '/dashboard/wallet', 'Authorized wallet adjustment', true],
  funding_pending: ['Wallet funding pending', 'Your payment is processing.', 'Your funding request is pending. Funds are not available until payment verification and wallet credit are complete.', 'View wallet', '/dashboard/wallet', 'Persisted pending funding event', true],
  funding_failed: ['Wallet funding failed', 'Your funding did not complete.', 'Your funding attempt failed. This attempt has not credited your wallet. Contact support if your bank shows a debit.', 'Contact support', '/support', 'Confirmed failed funding event', true],
  refund_completed: ['Refund completed', 'Your refund has been confirmed.', 'Your refund was confirmed by the payment provider. Bank processing times may apply. See your account for the refund destination.', 'View transactions', '/dashboard/transactions', 'Verified, committed refund completion; not yet connected', true],
  purchase_success: ['Purchase confirmed', 'Thank you for your purchase.', 'Your payment was verified and your order is confirmed. Delivery status is available in your account.', 'View order', '/dashboard/orders', 'Verified payment AND committed order', true],
  order_placed: ['Order placed', 'Your order was placed.', 'Your order has been recorded. Complete payment to begin digital fulfillment.', 'View order', '/dashboard/orders', 'Committed order placement', true],
  order_processing: ['Your order is processing', 'We’re working on your order.', 'Your confirmed order is being processed. We will notify you when fulfillment is confirmed.', 'View order', '/dashboard/orders', 'Confirmed order transitioned to processing', true],
  order_delivered: ['Your digital product was delivered', 'Your digital product has been delivered successfully.', 'Fulfillment has been confirmed. Sign in to view your purchase securely in your Digital Delivery Vault. Sensitive access details are never included in this email.', 'View Credentials in Secure Vault', '/dashboard/purchases', 'Confirmed fulfillment AND persisted delivered state', true],
  purchase_failed: ['Purchase could not be completed', 'Your order needs attention.', 'Your purchase did not complete. Check the order’s payment and fulfillment status before retrying.', 'Review order', '/dashboard/orders', 'Persisted purchase failure with payment and refund state', true],
  transaction_failed: ['Transaction needs attention', 'Review your transaction.', 'A transaction step failed. A fulfillment failure does not mean payment failed. Review the separate payment, delivery, and refund statuses in your account.', 'View transactions', '/dashboard/transactions', 'Persisted failure; distinguish payment from fulfillment', true],
  order_cancelled: ['Your order was cancelled', 'Your order has been cancelled.', 'The cancellation is confirmed. Cancellation alone does not confirm a refund; check the refund status in your account.', 'View order', '/dashboard/orders', 'Committed cancellation with verified refund status', true],
  payment_receipt: ['Your LogsPoll payment receipt', 'Payment received.', 'Your payment was verified. Keep this receipt reference for your records.', 'View payment', '/dashboard/orders', 'Verified payment AND committed payment record', true],
  support_received: ['We received your support request', 'We’re here to help.', 'Your support ticket was received. Keep your ticket reference for follow-up.', 'Contact support', '/support', 'Committed support ticket creation', true],
  support_updated: ['Your support ticket was updated', 'There’s an update for you.', 'Our support team updated your ticket. Sign in and contact support with your ticket reference to continue securely.', 'Contact support', '/support', 'Committed support reply or status change', true],
  security_alert: ['LogsPoll security alert', 'Please review your security.', 'A security event requires your attention. Sign in directly to LogsPoll or contact support. We will never ask for your password or verification codes.', 'Review security', '/dashboard/settings', 'Verified server-side security event', true],
  account_status: ['Your account status changed', 'An account update for you.', 'Your account access status was updated. Contact support for the confirmed status and next steps.', 'Contact support', '/support', 'Committed restriction or restoration by authorized administrator', true],
  service_announcement: ['LogsPoll service update', 'An update from LogsPoll.', 'There is a service update for your account. Visit LogsPoll or contact support for details.', 'Visit LogsPoll', '/', 'Reviewed announcement with explicit recipients; not implemented', false],
} as const
export type EmailKind = keyof typeof emailTemplates
export interface OrderItemEmailData {
  name: string
  quantity: number
  priceMinor: number
}
export interface EmailData {
  verificationCode?: string
  firstName?: string
  reference?: string
  amountMinor?: number
  orderId?: string
  orderItems?: OrderItemEmailData[]
  paymentStatus?: string
  fulfillmentStatus?: string
  orderDetailsUrl?: string
  deliveryInstructions?: string
  // Supply only reliable server-recorded facts; omit unavailable fields.
  occurredAt?: string
  device?: string
  failureStage?: 'payment' | 'fulfillment'
  refundStatus?: 'not_required' | 'pending' | 'completed' | 'not_confirmed'
  accountStatus?: 'restricted' | 'restored'
  confirmationUrl?: string
  appOrigin?: string
  confirmationOrigin?: string
  confirmationProvider?: 'cloudflare'
  year?: number
  preview?: boolean
}
export const isEmailKind = (value: unknown): value is EmailKind => typeof value === 'string' && Object.hasOwn(emailTemplates, value)
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const clean = (value: string) => Array.from(value.slice(0, 200), char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char).join('')
const site = 'https://logspoll.com'
const authKinds = new Set<EmailKind>(['verification', 'password_reset'])
function confirmationLink(data: EmailData) {
  if (data.preview) return `${site}/verify-email#sample-only`
  if (!data.confirmationUrl || !data.confirmationOrigin) throw new Error('A Cloudflare-generated URL and trusted confirmation origin are required.')
  const url = new URL(data.confirmationUrl)
  const origin = new URL(data.confirmationOrigin)
  if (origin.protocol !== 'https:' || url.protocol !== 'https:' || url.origin !== origin.origin || url.username || url.password || !(/^\/api\/auth\/(verify-email|reset-password\/[A-Za-z0-9_-]+)$/.test(url.pathname))) throw new Error('Invalid Cloudflare confirmation URL.')
  return url.href
}
export function renderEmail(kind: EmailKind, data: EmailData = {}) {
  if (!isEmailKind(kind)) throw new Error('Unknown email template.')
  if (['verification','password_reset','welcome','password_changed'].includes(kind)) return renderPremiumEmail(kind, data)
  const [subject, title, message, action, path] = emailTemplates[kind]
  const app=new URL(data.appOrigin??site);if(app.protocol!=='https:'||app.username||app.password||app.pathname!=='/'||app.search||app.hash)throw new Error('Invalid application origin.')
  let url = authKinds.has(kind) ? confirmationLink(data) : app.origin + path
  if (data.orderDetailsUrl) {
    try {
      const parsed = new URL(data.orderDetailsUrl)
      if (parsed.origin === app.origin) url = parsed.href
    } catch { /* retain default url */ }
  }
  const name = clean(data.firstName?.trim() || 'there')
  const facts: [string, string][] = []
  if (data.orderId) facts.push(['Order ID', clean(data.orderId)])
  if (data.reference) facts.push(['Reference', clean(data.reference)])
  if (data.paymentStatus) facts.push(['Payment status', clean(data.paymentStatus).toUpperCase()])
  if (data.fulfillmentStatus) facts.push(['Fulfillment status', clean(data.fulfillmentStatus).toUpperCase()])
  if (data.amountMinor !== undefined) {
    if (!Number.isSafeInteger(data.amountMinor) || data.amountMinor < 0) throw new Error('Invalid payment amount.')
    facts.push(['Total amount', new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(data.amountMinor / 100)])
  }
  if (data.orderItems && Array.isArray(data.orderItems)) {
    for (const item of data.orderItems) {
      if (item && typeof item.name === 'string') {
        const qty = Number(item.quantity) || 1
        const price = typeof item.priceMinor === 'number' && item.priceMinor >= 0 ? new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(item.priceMinor / 100) : ''
        facts.push(['Item', `${clean(item.name)} (${qty}x${price ? ' @ ' + price : ''})`])
      }
    }
  }
  if (data.occurredAt) {
    const time = new Date(data.occurredAt)
    if (!Number.isFinite(time.getTime())) throw new Error('Invalid event timestamp.')
    facts.push(['Time (UTC)', time.toISOString()])
  }
  if (data.device) facts.push(['Device', clean(data.device)])
  if (data.failureStage) facts.push(['Failed step', data.failureStage === 'payment' ? 'Payment' : 'Supplier fulfillment (payment may have succeeded)'])
  if (data.refundStatus) facts.push(['Refund status', data.refundStatus.replaceAll('_', ' ')])
  if (data.accountStatus) facts.push(['Account status', data.accountStatus])
  if (kind === 'order_delivered' && data.deliveryInstructions) {
    if (data.paymentStatus !== 'paid' || data.fulfillmentStatus !== 'delivered' || data.deliveryInstructions.length > 200000) throw new Error('Verified delivered order required for delivery email.')
    facts.push(['Your delivery', data.deliveryInstructions])
  }
  const security = authKinds.has(kind) ? 'This secure link is single-use and expires according to your account security settings. If it has expired, request a new link on LogsPoll.' : 'For your security, sign in to view sensitive account information. Never share your password or verification codes.'
  const year = data.year ?? new Date().getUTCFullYear()
  if (!Number.isInteger(year) || year < 2026 || year > 9999) throw new Error('Invalid year.')
  const preview = data.preview ? 'SAMPLE EMAIL — synthetic data; no transaction or account action occurred.' : ''
  const rows = facts.map(([label, value]) => `<tr><td style="padding:10px 0;color:#64748b;font-size:13px;vertical-align:top;border-bottom:1px solid #f1f5f9">${escape(label)}</td><td align="right" style="padding:10px 0 10px 16px;color:#0e1219;font-size:13px;font-weight:600;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;border-bottom:1px solid #f1f5f9">${escape(value)}</td></tr>`).join('')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(subject)} | LogsPoll</title><style>@media(max-width:620px){.pad{padding-left:22px!important;padding-right:22px!important}.heading{font-size:28px!important}.label{display:none!important}.outer{padding:20px 8px!important}}a:focus{outline:2px solid #0e1219}</style></head><body style="margin:0;padding:0;background:#f4f5f3;color:#0e1219;font-family:'Nunito Sans',Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(subject)} — LogsPoll</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f3;border-collapse:collapse"><tr><td class="outer" align="center" style="padding:36px 12px"><!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;table-layout:fixed;background:#fff;border:1px solid #e2e8f0;border-radius:14px;border-spacing:0"><tr><td style="height:4px;line-height:4px;background:#fc4d01;border-radius:14px 14px 0 0;font-size:1px">&nbsp;</td></tr><tr><td class="pad" style="padding:26px 36px 22px;border-bottom:1px solid #f1f5f9"><table role="presentation" width="100%"><tr><td><a href="${site}" style="font-size:26px;font-weight:900;letter-spacing:-1.2px;text-decoration:none;white-space:nowrap;color:#0e1219"><img src="${site}/email/logspoll-email-logo.png" width="145" alt="LogsPoll" style="display:block;width:145px;max-width:100%;height:auto;border:0" /></a></td><td class="label" align="right" style="font-size:10px;color:#64748b;letter-spacing:1.4px;font-weight:700">${authKinds.has(kind) || kind.includes('password') || kind.includes('security') ? 'ACCOUNT SECURITY' : 'YOUR LOGSPOLL ACCOUNT'}</td></tr></table></td></tr><tr><td class="pad" style="padding:32px 36px 28px">${preview ? `<p style="margin:0 0 20px;padding:12px;background:#fff7ed;border:1px solid #ffedd5;border-radius:8px;color:#c2410c;font-size:12px;line-height:1.6">${preview}</p>` : ''}<h1 class="heading" style="margin:0 0 18px;font-size:30px;line-height:1.2;letter-spacing:-0.8px;color:#0e1219;font-weight:800">${escape(title)}</h1><p style="font-size:16px;line-height:30px;margin:0 0 10px;color:#475569">Hi <strong style="font-size:22px;font-weight:800;line-height:30px;color:#0e1219;overflow-wrap:anywhere;word-break:break-word">${escape(name)}</strong>,</p><p style="font-size:15px;line-height:1.75;color:#475569;margin:0 0 20px">${escape(message)}</p>${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;border-top:1px solid #f1f5f9;margin-bottom:22px">${rows}</table>` : ''}<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0"><tr><td bgcolor="#fc4d01" style="border-radius:8px;mso-padding-alt:14px 26px"><a href="${escape(url)}" style="display:inline-block;padding:14px 26px;font-size:14px;font-weight:700;border-radius:8px;background:#fc4d01;color:#ffffff;text-decoration:none">${escape(action)} &nbsp;→</a></td></tr></table><p style="font-size:12px;line-height:1.8;color:#64748b;margin:0 0 20px;overflow-wrap:anywhere;word-break:break-all">Button not working? Open this link:<br><a href="${escape(url)}" style="color:#fc4d01;text-decoration:none;font-weight:600">${escape(url)}</a></p><div style="border-top:1px solid #f1f5f9;padding-top:18px;font-size:12px;line-height:1.8;color:#64748b">${escape(security)}</div></td></tr></table><!--[if mso]></td></tr></table><![endif]--><table role="presentation" width="100%" style="max-width:600px"><tr><td align="center" style="padding:22px 16px;font-size:12px;line-height:1.8;color:#64748b"><strong>LogsPoll</strong><br>Digital products &amp; services, made simple.<br><a href="${site}" style="color:#fc4d01;text-decoration:none;font-weight:600">logspoll.com</a> &nbsp;·&nbsp; <a href="${site}/support" style="color:#fc4d01;text-decoration:none;font-weight:600">Contact support</a> &nbsp;·&nbsp; <a href="${site}/privacy" style="color:#fc4d01;text-decoration:none;font-weight:600">Privacy</a><br>© ${year} LogsPoll. All rights reserved.<br><span style="font-size:11px;color:#94a3b8">Built by SwiftNova Labs</span></td></tr></table></td></tr></table></body></html>`
  const text = [preview, `LogsPoll | ${subject}`, `Hi ${name},`, title, message, ...facts.map(([label, value]) => `${label}: ${value}`), `${action}: ${url}`, security, 'Support: https://logspoll.com/support', 'Privacy: https://logspoll.com/privacy', `© ${year} LogsPoll. https://logspoll.com`, 'Built by SwiftNova Labs'].filter(Boolean).join('\n\n')
  return { subject, html, text }
}
export function sampleEmail(kind: EmailKind, year?: number) {
  const isOrderKind = ['order_placed', 'purchase_success', 'order_delivered', 'purchase_failed', 'refund_completed', 'payment_receipt', 'wallet_funded'].includes(kind)
  return renderEmail(kind, {
    preview: true,
    firstName: 'Alex',
    reference: 'SAMPLE-0001',
    year,
    ...(isOrderKind ? {
      orderId: 'LP-SAMPLE-ORD1',
      amountMinor: 125000,
      paymentStatus: kind === 'purchase_failed' ? 'failed' : kind === 'refund_completed' ? 'refunded' : 'paid',
      fulfillmentStatus: kind === 'order_delivered' ? 'delivered' : 'processing',
      orderItems: [{ name: 'Sample Digital Account', quantity: 1, priceMinor: 125000 }]
    } : {})
  })
}
