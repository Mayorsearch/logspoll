import {identity} from '../../../workers/api/auth.ts'
import {requireRuntime} from '../../../workers/api/runtime.ts'
import {reconcileBachsAttempt} from '../../../workers/api/bachs-webhook.ts'
import {HttpError,json} from '../../../workers/api/http.ts'
import type {ApiEnv} from '../../../workers/api/types.ts'

export async function onRequest({request,env}:{request:Request;env:ApiEnv}){
 try{
  if(request.method!=='GET')throw new HttpError(405,'GET required.')
  await requireRuntime(env);const user=await identity(request,env),id=new URL(request.url).searchParams.get('id')
  const attempt=await env.DB!.prepare('SELECT a.* FROM bachs_payment_attempts a WHERE a.order_id=? AND a.customer_id=? ORDER BY a.created_at DESC LIMIT 1').bind(id,user.id).first<{id:string;order_id:string;checkout_id:string;provider_mode:string;amount_minor:number;status:string}>()
  if(!attempt)throw new HttpError(404,'Order not found.')
  if(attempt.checkout_id&&['initiating','open'].includes(attempt.status))await reconcileBachsAttempt(env,attempt)
  const order=await env.DB!.prepare('SELECT id,reference,payment_status,fulfillment_status,total_minor,currency,created_at FROM orders WHERE id=? AND customer_id=?').bind(id,user.id).first()
  return json({order})
 }catch(error){return json({error:error instanceof HttpError?error.message:'Payment status could not be verified.'},error instanceof HttpError?error.status:503)}
}
