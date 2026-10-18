import {supplierAutomation} from '../../../workers/api/supplier-automation.ts'
import {requireRuntime} from '../../../workers/api/runtime.ts'
import {HttpError,json} from '../../../workers/api/http.ts'
import type {ApiEnv} from '../../../workers/api/types.ts'
export async function onRequest({request,env}:{request:Request;env:ApiEnv}){
  try{
    await requireRuntime(env);
    return await supplierAutomation(request,env)
  }catch(error){
    const isHttp = error instanceof HttpError;
    const status = isHttp ? error.status : 500;
    const message = isHttp
      ? error.message
      : (error instanceof Error && error.message ? error.message : 'Supplier automation temporarily unavailable due to an internal server error. Please retry or check server logs.');
    console.error('supplier-automation diagnostic:', {
      status,
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
      timestamp: new Date().toISOString()
    });
    return json({error: message}, status);
  }
}
