import { HttpError, json, requireAdmin } from '../../../server/auth.ts'
import type { BachsEnv } from '../../../server/bachs-auth.ts'
import type { EmailEnv } from '../../../server/email.ts'
import { launchReadiness } from '../../../server/launch-readiness.ts'
export async function onRequestGet({ request, env }: { request: Request; env: BachsEnv & EmailEnv }) {
  try { await requireAdmin(request, env); return json(await launchReadiness(env)) }
  catch (error) { return json({ error: error instanceof HttpError ? error.message : 'Readiness could not be verified.' }, error instanceof HttpError ? error.status : 503) }
}
export const onRequestPost = () => json({ error: 'Read-only verification. Configuration is not changed.' }, 405)
