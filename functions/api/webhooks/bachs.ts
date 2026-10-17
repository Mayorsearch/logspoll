import {stagingBachsWebhook} from '../../../workers/api/bachs-staging.ts'
import type {ApiEnv} from '../../../workers/api/types.ts'
export const onRequest=({request,env}:{request:Request;env:ApiEnv})=>stagingBachsWebhook(request,env)
