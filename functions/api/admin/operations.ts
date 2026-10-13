import { apiFetch } from '../../../workers/api/index.ts'
import type { ApiEnv } from '../../../workers/api/types.ts'
export const onRequest = ({request,env,waitUntil}:{request:Request;env:ApiEnv;waitUntil:(p:Promise<unknown>)=>void}) => apiFetch(request,env,{waitUntil})
