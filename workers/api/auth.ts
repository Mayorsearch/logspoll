import { betterAuth } from 'better-auth'
import type { BetterAuthOptions } from 'better-auth'
import { digest, enqueueMail } from './mail.ts'
import { HttpError } from './http.ts'
import type { ApiEnv } from './types.ts'

export function authReady(env: ApiEnv) {
  return env.AUTH_ENABLED === 'true' && Boolean(env.DB && env.AUTH_SECRET && env.AUTH_SECRET.length >= 32 && env.RESEND_API_KEY && env.AUTH_ORIGIN)
}
export function createAuth(env: ApiEnv) {
  if (!authReady(env)) throw new HttpError(503, 'Cloudflare authentication/email bindings are not configured.')
  return betterAuth({
    database: env.DB as BetterAuthOptions['database'], secret: env.AUTH_SECRET,
    baseURL: env.AUTH_ORIGIN, basePath: '/api/auth', trustedOrigins: [env.AUTH_ORIGIN!],
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
    emailAndPassword: { enabled: true, requireEmailVerification: true, autoSignIn: false, minPasswordLength: 12, maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 900, revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => enqueueMail(env, `reset:${url}`, 'password_reset', user, url),
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
      sendVerificationEmail: async ({ user, url, token }) => {
        await env.DB!.prepare('INSERT OR IGNORE INTO auth_email_tokens(token_hash,expires_at) VALUES(?,?)').bind(await digest(token), Date.now() + 900000).run()
        await enqueueMail(env, `verify:${token}`, 'verification', user, url)
      },
      afterEmailVerification: async user => enqueueMail(env, `welcome:${user.id}`, 'welcome', user) },
  })
}
// Library JWT validation plus a D1 atomic claim makes verification links single use.
export async function consumeVerification(request: Request, env: ApiEnv) {
  const url = new URL(request.url)
  if (url.pathname !== '/api/auth/verify-email') return
  const token = url.searchParams.get('token') ?? ''
  if (!token || token.length > 4000) throw new HttpError(400, 'Invalid verification link.')
  const row = await env.DB!.prepare('DELETE FROM auth_email_tokens WHERE token_hash=? AND expires_at>? RETURNING token_hash').bind(await digest(token), Date.now()).first()
  if (!row) throw new HttpError(400, 'Verification link expired or already used. Request another link.')
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
