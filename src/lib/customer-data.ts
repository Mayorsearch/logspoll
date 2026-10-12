import type { SupabaseClient } from '@supabase/supabase-js'

export interface Order {
  id: string
  reference: string
  payment_status: string
  fulfillment_status: string
  total_minor: number
  currency: string
  created_at: string
  order_items?: { id: string; product_name: string; quantity: number; product_entitlements: { instructions: string } | null }[]
}
export async function loadOrders(client: SupabaseClient, customerId: string, purchases = false): Promise<Order[]> {
  const fields = 'id,reference,payment_status,fulfillment_status,total_minor,currency,created_at'
  let query = client.from('orders').select(purchases ? `${fields},order_items(id,product_name,quantity,product_entitlements(instructions))` : fields).eq('customer_id', customerId)
  if (purchases) query = query.eq('payment_status', 'paid').eq('fulfillment_status', 'delivered')
  const { data, error } = await query.order('created_at', { ascending: false }).limit(50)
  if (error) throw new Error('Your records could not be loaded. Please retry. If this continues, contact support to check the database configuration.')
  return (data ?? []) as unknown as Order[]
}
