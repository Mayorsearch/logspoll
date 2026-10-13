import { apiFetch } from '../../../workers/api/index.ts'
import type { ApiEnv, Execution } from '../../../workers/api/types.ts'
export const onRequest = ({ request, env, waitUntil }: { request: Request; env: ApiEnv } & Execution) => apiFetch(request, env, { waitUntil })
