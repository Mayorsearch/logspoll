import { korastoreAdmin } from '../../../workers/api/korastore-manager.ts'
import { requireRuntime } from '../../../workers/api/runtime.ts'
import { HttpError, json } from '../../../workers/api/http.ts'
import type { ApiEnv } from '../../../workers/api/types.ts'

export async function onRequest({ request, env }: { request: Request; env: ApiEnv }) {
  let response: Response
  try {
    await requireRuntime(env)
    response = await korastoreAdmin(request, env)
  } catch (error) {
    response = json(
      { error: error instanceof HttpError ? error.message : 'Kora Store operation failed.' },
      error instanceof HttpError ? error.status : 503
    )
  }
  const headers = new Headers(response.headers)
  headers.set('X-LogsPoll-Handler', 'korastore-direct-v1')
  return new Response(response.body, { status: response.status, headers })
}
