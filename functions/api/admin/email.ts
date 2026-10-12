import { HttpError, json, requireAdmin } from '../../../server/auth.ts'
import type { Env } from '../../../server/auth.ts'
import { emailTestReady, sendTestEmail } from '../../../server/email.ts'
import type { EmailEnv } from '../../../server/email.ts'
type Context = { request: Request; env: Env & EmailEnv }
const failure = (error: unknown) => json({ error: error instanceof HttpError ? error.message : 'Email operation unavailable. No delivery was assumed.' }, error instanceof HttpError ? error.status : 503)
export async function onRequestGet({ request, env }: Context) {
  try { await requireAdmin(request, env); return json({ testReady: emailTestReady(env), automaticDelivery: false, provider: 'Resend' }) } catch (error) { return failure(error) }
}
export async function onRequestPost({ request, env }: Context) {
  try {
    await requireAdmin(request, env)
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'Use JSON.')
    const reader = request.body?.getReader()
    if (!reader) throw new HttpError(400, 'Request body required.')
    let size = 0; let value = ''; const decoder = new TextDecoder()
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 2048) { await reader.cancel(); throw new HttpError(413, 'Test request too large.') }; value += decoder.decode(part.value, { stream: true }) }
    let body: unknown
    try { body = JSON.parse(value + decoder.decode()) } catch { throw new HttpError(400, 'Invalid JSON.') }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid test request.')
    const { template, requestId, startedAt } = body as Record<string, unknown>
    return json(await sendTestEmail(env, { template, requestId, startedAt }))
  } catch (error) { return failure(error) }
}
