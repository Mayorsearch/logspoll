/** Customer-visible sandbox-only payment state. No supplier secrets or entitlements. */
import { HttpError, json } from '../../../server/auth.ts'
import { sandboxEnabled, serviceDatabase, verifiedBuyer, safeBachsError } from '../../../server/bachs-auth.ts'
import type { BachsEnv } from '../../../server/bachs-auth.ts'
export async function onRequestGet({request,env}: {request: Request, env: BachsEnv}) {
  try {
    if (!sandboxEnabled(env)) throw new HttpError(503, 'Bachs sandbox is disabled.')
    const buyer = await verifiedBuyer(request,env)
    const orderId = new URL(request.url).searchParams.get('id')
    if (!orderId || !/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(orderId)) throw new HttpError(400, 'Invalid order ID.')
    const db = serviceDatabase(env)
    const result = await db.from('bachs_sandbox_orders').select('id,product_name,total_minor,currency,state,created_at')
      .eq('id',orderId).eq('customer_id',buyer.id).maybeSingle()
    if (result.error) throw new HttpError(503,'Sandbox order unavailable.')
    if (!result.data) throw new HttpError(404,'Order not found.')
    return json({sandbox:true,order:result.data})
  } catch(error) {return safeBachsError(error)}
}
