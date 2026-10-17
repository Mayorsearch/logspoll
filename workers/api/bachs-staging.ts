import {bachsWebhook} from './bachs-webhook.ts'
import {json} from './http.ts'
import type {ApiEnv} from './types.ts'

/** A sandbox key, staging environment and staging dataset are all mandatory. */
export async function stagingBachsWebhook(request:Request,env:ApiEnv){
 if(request.method!=='POST')return json({error:'POST required.'},405)
 if(env.ENVIRONMENT!=='staging'||!env.BACHS_API_KEY?.trim().startsWith('sk_sandbox_'))return json({error:'Sandbox payment credentials are not configured for staging.'},503)
 if(!env.BACHS_WEBHOOK_SECRET||!env.DB)return json({error:'Sandbox signing secret or staging database is missing.'},503)
 try{
  const marker=await env.DB.prepare("SELECT value FROM migration_metadata WHERE key='dataset'").first<{value:string}>()
  if(marker?.value!=='synthetic-staging')return json({error:'Sandbox database isolation could not be verified.'},503)
  return await bachsWebhook(request,env)
 }catch{return json({error:'Sandbox webhook unavailable; retry delivery.'},503)}
}
