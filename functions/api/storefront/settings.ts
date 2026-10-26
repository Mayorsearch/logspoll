import { apiFetch } from '../../../workers/api/index.ts'
import type { ApiEnv, Execution } from '../../../workers/api/types.ts'

export const onRequest = (context: { request: Request; env: ApiEnv } & Execution) =>
  apiFetch(context.request, context.env, context)

