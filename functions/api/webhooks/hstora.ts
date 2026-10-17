import {hstoraWebhook} from '../../../workers/api/hstora-webhook.ts'
import type {ApiEnv} from '../../../workers/api/types.ts'
export const onRequest=({request,env}:{request:Request;env:ApiEnv})=>hstoraWebhook(request,env)
