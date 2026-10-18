import { handleStorefrontDiscovery } from '../../../workers/api/storefront-discovery.ts'
import { requireRuntime } from '../../../workers/api/runtime.ts'
import { HttpError, json } from '../../../workers/api/http.ts'
import type { ApiEnv } from '../../../workers/api/types.ts'

export async function onRequest({ request, env }: { request: Request; env: ApiEnv }) {
  let response: Response
  try {
    await requireRuntime(env)
    response = await handleStorefrontDiscovery(request, env)
  } catch (error) {
    response = json(
      { error: error instanceof HttpError ? error.message : 'Storefront discovery failed.' },
      error instanceof HttpError ? error.status : 503
    )
  }
  const headers = new Headers(response.headers)
  headers.set('X-LogsPoll-Handler', 'storefront-discovery-direct-v1')
  headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate')
  return new Response(response.body, { status: response.status, headers })
}

