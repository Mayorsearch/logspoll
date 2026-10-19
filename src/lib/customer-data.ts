import type { StructuredProductDelivery } from './delivery-parser.ts'

export interface OrderItem {
  id: string
  product_id?: string
  product_name: string
  category_name?: string
  quantity: number
  unit_price_minor?: number
  server_number?: number | null
  product_slug?: string | null
  product_entitlements?: { instructions: string; structured?: StructuredProductDelivery | null } | null
}

export interface Order {
  id: string
  reference: string
  payment_status: string
  fulfillment_status: string
  total_minor: number
  currency: string
  created_at: string
  order_items?: OrderItem[]
}
