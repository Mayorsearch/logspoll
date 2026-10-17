import {bachsWebhook} from '../../../workers/api/bachs-webhook.ts'
import {stagingBachsWebhook} from '../../../workers/api/bachs-staging.ts'
import type {ApiEnv} from '../../../workers/api/types.ts'
export const onRequest=({request,env}:{request:Request;env:ApiEnv})=>env.ENVIRONMENT==='staging'?stagingBachsWebhook(request,env):bachsWebhook(request,env)
