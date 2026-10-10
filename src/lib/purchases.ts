import "server-only";
import { requireIdentity } from "./supabase/server";
export type PurchaseItem = {
  id: string;
  product_name: string;
  category_name: string;
  quantity: number;
  unit_price_minor: number;
};
export type Purchase = {
  id: string;
  reference: string;
  payment_status: "pending" | "paid" | "failed" | "refunded";
  fulfillment_status: "pending" | "processing" | "delivered";
  total_minor: number;
  currency: string;
  created_at: string;
  order_items: PurchaseItem[];
};
export const purchaseFields =
  "id,reference,payment_status,fulfillment_status,total_minor,currency,created_at,order_items(id,product_name,category_name,quantity,unit_price_minor)";
export const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
export async function getPurchases(page = 1) {
  const { client, user } = await requireIdentity();
  const { data, error } = await client
    .from("orders")
    .select(purchaseFields)
    .eq("customer_id", user.id)
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * 20, page * 20);
  if (error) throw new Error("Purchase history is unavailable.");
  return {
    purchases: (data || []).slice(0, 20) as unknown as Purchase[],
    hasMore: (data?.length || 0) > 20,
  };
}
export function purchaseDate(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(date));
}
