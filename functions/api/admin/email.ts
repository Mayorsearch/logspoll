import { apiFetch } from '../../../workers/api/index.ts'
import type { ApiEnv } from '../../../workers/api/types.ts'
export const onRequest = ({ request, env }: { request: Request; env: ApiEnv }) => apiFetch(new Request(new URL('/api/admin/email', request.url), request), env)
export const onRequestGet = onRequest
export const onRequestPost = onRequest
