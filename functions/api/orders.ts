import { apiFetch } from '../../workers/api/index.ts'
import type { ApiEnv } from '../../workers/api/types.ts'
export const onRequest = ({ request, env }: { request: Request; env: ApiEnv }) => apiFetch(request, env)
