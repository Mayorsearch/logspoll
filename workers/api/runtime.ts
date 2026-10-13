import { HttpError } from './http.ts'
import type { ApiEnv } from './types.ts'
// A production flag cannot accidentally authorize a staging database binding.
export async function requireRuntime(env:ApiEnv){
 if(env.ENVIRONMENT==='staging')return
 if(env.ENVIRONMENT==='production'&&env.PRODUCTION_CUTOVER_ENABLED==='true'&&env.DB){
  const marker=await env.DB.prepare("SELECT value FROM migration_metadata WHERE key='dataset'").first<{value:string}>()
  if(marker?.value==='production')return
 }
 throw new HttpError(503,'Production migration is locked or its D1 target is unverified.')
}
