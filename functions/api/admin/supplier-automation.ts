import {supplierAutomation} from '../../../workers/api/supplier-automation.ts'
import {requireRuntime} from '../../../workers/api/runtime.ts'
import {HttpError,json} from '../../../workers/api/http.ts'
import type {ApiEnv} from '../../../workers/api/types.ts'
export async function onRequest({request,env}:{request:Request;env:ApiEnv}){try{await requireRuntime(env);return await supplierAutomation(request,env)}catch(error){return json({error:error instanceof HttpError?error.message:'Supplier automation unavailable; no success was assumed.'},error instanceof HttpError?error.status:503)}}
