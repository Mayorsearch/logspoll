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
