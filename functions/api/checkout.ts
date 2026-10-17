import {bachsCheckout} from '../../workers/api/bachs-checkout.ts'
import type {ApiEnv} from '../../workers/api/types.ts'
export const onRequestPost=({request,env}:{request?:Request;env?:ApiEnv}={})=>request&&env?bachsCheckout(request,env):new Response(JSON.stringify({error:'Unavailable'}),{status:503,headers:{'content-type':'application/json'}})
export const onRequest=onRequestPost
