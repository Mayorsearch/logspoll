import { hstoraInternalDiag } from '../../../workers/api/hstora-manager.ts'
import { json } from '../../../workers/api/http.ts'
import type { ApiEnv } from '../../../workers/api/types.ts'

export async function onRequest({ request, env }: { request: Request; env: ApiEnv }) {
  try {
    return await hstoraInternalDiag(request, env)
  } catch (err: unknown) {
    const error = err as { message?: string; status?: number; stack?: string }
    return json({
      error: error?.message || String(err),
      status: error?.status || 500,
      stack: error?.stack
    }, error?.status || 500)
  }
}
export const onRequestGet = onRequest
