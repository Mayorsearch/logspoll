import { betterAuth } from 'better-auth'
import type { BetterAuthOptions } from 'better-auth'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { enqueueMail } from './mail.ts'
import { HttpError } from './http.ts'
import type { ApiEnv } from './types.ts'

export function getAuthSecret(env: ApiEnv): string {
  if (env.AUTH_SECRET && env.AUTH_SECRET.length >= 32) return env.AUTH_SECRET
  return ''
}

export function authReady(env: ApiEnv) {
  const secret = getAuthSecret(env)
  return env.AUTH_ENABLED === 'true' && Boolean(env.DB && secret && secret.length >= 32 && (env.AUTH_ORIGIN || 'https://logspoll.com'))
}
export function createAuth(env: ApiEnv) {
  if (!authReady(env)) throw new HttpError(503, 'Cloudflare authentication/email bindings are not configured.')
  const secret = getAuthSecret(env)
  const origin = env.AUTH_ORIGIN || 'https://logspoll.com'
  return betterAuth({
    database: env.DB as BetterAuthOptions['database'], secret,
    baseURL: origin, basePath: '/api/auth', trustedOrigins: [origin, 'https://logspoll.com'],
    logger: { disabled: true }, // Never log authentication URLs or provider responses.
    user: { modelName: 'auth_user', changeEmail: { enabled: false }, deleteUser: { enabled: false } },
    session: { modelName: 'auth_session', expiresIn: 86400 * 7, updateAge: 86400, freshAge: 900, cookieCache: { enabled: false } },
    account: { modelName: 'auth_account', accountLinking: { enabled: false } },
    verification: { modelName: 'auth_verification' },
    advanced: { database: { generateId: 'uuid' }, useSecureCookies: true, cookiePrefix: 'logspoll',
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    rateLimit: { enabled: true, storage: 'database', modelName: 'auth_rate_limit', window: 60, max: 30,
      customRules: { '/sign-in/email': { window: 60, max: 5 }, '/sign-up/email': { window: 60, max: 3 },
        '/request-password-reset': { window: 60, max: 3 }, '/send-verification-email': { window: 60, max: 3 } } },
    plugins: [emailOTP({ otpLength:6, expiresIn:600, allowedAttempts:5, storeOTP:{hash:code=>otpDigest(env,code)},
      resendStrategy:'rotate', overrideDefaultEmailVerification:true, sendVerificationOnSignUp:true, disableSignUp:true, rateLimit:{window:60,max:10},
      sendVerificationOTP:async({email,otp,type})=>{
        if(!env.RESEND_API_KEY)throw new HttpError(503,'Email service is not configured. Verification code cannot be sent.')
        if(type!=='email-verification'&&type!=='forget-password')throw new HttpError(400,'Unsupported verification purpose.')
        const user=await env.DB!.prepare('SELECT email,name FROM auth_user WHERE email=?').bind(email).first<{email:string;name:string}>()
        if(user)await enqueueMail(env,`otp:${type}:${crypto.randomUUID()}`,type==='email-verification'?'verification':'password_reset',user,otp,await otpDigest(env,`${type}:${email}`))
      } })],
    emailAndPassword: { enabled: true, requireEmailVerification: true, autoSignIn: false, minPasswordLength: 12, maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 900, revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => {
        // Revoke before any mail operation that might fail; the library also revokes afterward.
        await env.DB!.prepare('DELETE FROM auth_session WHERE userId=?').bind(user.id).run()
        // Only a trusted offline import can reserve an original application UUID.
        // A consumed reset token proves inbox ownership; public signup cannot link old records.
        await env.DB!.batch([
          env.DB!.prepare("UPDATE auth_user SET emailVerified=1 WHERE id=? AND EXISTS(SELECT 1 FROM external_identities WHERE issuer='cloudflare-reset-enrollment:v1' AND user_id=auth_user.id AND subject=lower(auth_user.email))").bind(user.id),
          env.DB!.prepare("DELETE FROM external_identities WHERE issuer='cloudflare-reset-enrollment:v1' AND user_id=?").bind(user.id),
        ])
        await enqueueMail(env, `password-reset:${user.id}:${Date.now()}`, 'password_changed', user)
      } },
    emailVerification: { sendOnSignUp: true, sendOnSignIn: false, autoSignInAfterVerification: false, expiresIn: 900,
      afterEmailVerification: async user => enqueueMail(env, `welcome:${user.id}`, 'welcome', user) },
  })
}
// HMAC prevents offline enumeration of a six-digit code from a database-only leak.
export async function otpDigest(env:ApiEnv,value:string) {
  const secret = getAuthSecret(env)
  if (!secret) throw new HttpError(503, 'Authentication secret is not configured.')
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('')
}
// Existing request boundary calls this before Better Auth. No OTPs are logged.
export async function consumeVerification(request:Request,env:ApiEnv) {
  const path=decodeURIComponent(new URL(request.url).pathname).replace('/api/auth','')
  const allowed=new Set(['/email-otp/send-verification-otp','/email-otp/verify-email','/email-otp/request-password-reset','/email-otp/reset-password'])
  if((path.startsWith('/email-otp/')&&!allowed.has(path))||path==='/sign-in/email-otp'||path==='/forget-password/email-otp'||path==='/verify-email'||path==='/request-password-reset'||path==='/send-verification-email'||path.startsWith('/reset-password'))throw new HttpError(400,'Use the six-digit code on the verification or password recovery screen.')
  if(!allowed.has(path)&&path!=='/sign-up/email')return
  if(request.method!=='POST')throw new HttpError(405,'POST required.')
  let body:Record<string,unknown>
  try{body=await request.clone().json()}catch{throw new HttpError(400,'Invalid authentication request.')}
  if(typeof body.email!=='string'||body.email.length>254||!/^\S+@\S+\.\S+$/.test(body.email))throw new HttpError(400,'Enter a valid email address.')
  const email=body.email.trim().toLowerCase()
  if(path==='/email-otp/send-verification-otp'&&body.type!=='email-verification')throw new HttpError(400,'Unsupported verification purpose.')
  const sending=path==='/sign-up/email'||path==='/email-otp/send-verification-otp'||path==='/email-otp/request-password-reset'
  if(!sending){if(typeof body.otp!=='string'||!/^\d{6}$/.test(body.otp))throw new HttpError(400,'Enter the six-digit code.');return}
  const now=Date.now(),purpose=path==='/email-otp/request-password-reset'?'forget-password':'email-verification'
  const ip=await otpDigest(env,'otp-send-ip:'+request.headers.get('cf-connecting-ip'))
  const limit=await env.DB!.prepare('INSERT INTO request_limits(subject,window,hits) VALUES(?,?,1) ON CONFLICT(subject,window) DO UPDATE SET hits=hits+1 RETURNING hits').bind(ip,Math.floor(now/60000)).first<{hits:number}>()
  if(!limit||limit.hits>10)throw new HttpError(429,'Too many code requests. Please wait and retry.')
  const subject=await otpDigest(env,`${purpose}:${email}`)
  const claimed=await env.DB!.prepare('INSERT INTO auth_otp_cooldowns(subject,next_send_at) VALUES(?,?) ON CONFLICT(subject) DO UPDATE SET next_send_at=excluded.next_send_at WHERE next_send_at<=? RETURNING subject').bind(subject,now+60000,now).first()
  if(!claimed)throw new HttpError(429,'Please wait 60 seconds before requesting another code.')
  await env.DB!.prepare('DELETE FROM auth_otp_cooldowns WHERE next_send_at<?').bind(now-86400000).run()
}
export async function identity(request: Request, env: ApiEnv) {
  const result = await createAuth(env).api.getSession({ headers: request.headers })
  if (!result?.user.emailVerified) throw new HttpError(401, 'Verified sign-in required.')
  // Provision by authenticated UUID only. Never join an imported customer/admin by email.
  // These inserts preserve pre-existing restrictions and roles. Public signup grants customer only.
  await env.DB!.batch([
    env.DB!.prepare('INSERT OR IGNORE INTO users(id) VALUES(?)').bind(result.user.id),
    env.DB!.prepare('INSERT OR IGNORE INTO profiles(id,full_name) VALUES(?,?)').bind(result.user.id, result.user.name.slice(0,120)),
    env.DB!.prepare("INSERT OR IGNORE INTO user_roles(user_id,role) VALUES(?,'customer')").bind(result.user.id),
  ])
  const user = await env.DB!.prepare("SELECT u.id,r.role FROM users u JOIN user_roles r ON r.user_id=u.id WHERE u.id=? AND u.status='active'").bind(result.user.id).first<{ id: string; role: string }>()
  if (!user) throw new HttpError(403, 'Account access unavailable.')
  const window = Math.floor(Date.now() / 60000)
  const limit = await env.DB!.prepare('INSERT INTO request_limits(subject,window,hits) VALUES(?,?,1) ON CONFLICT(subject,window) DO UPDATE SET hits=hits+1 RETURNING hits').bind(user.id, window).first<{ hits: number }>()
  if (!limit || limit.hits > 60) throw new HttpError(429, 'Request limit reached. Retry later.')
  await env.DB!.prepare('DELETE FROM request_limits WHERE window < ?').bind(window - 15).run()
  return { ...user, email: result.user.email, name: result.user.name }
}
