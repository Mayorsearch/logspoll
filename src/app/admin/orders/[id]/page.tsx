import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/supabase/server";
import { Workspace } from "@/components/workspace";
import {
  purchaseFields,
  isUuid,
  purchaseDate,
  type Purchase,
} from "@/lib/purchases";
import { formatPrice } from "@/lib/catalog";
import { fulfillOrder } from "../actions";
export const metadata: Metadata = {
  title: "Order Review",
  robots: { index: false, follow: false },
};
export default async function OrderReview({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; delivered?: string }>;
}) {
  const { client, user } = await requireAdmin();
  const { id } = await params,
    query = await searchParams;
  if (!isUuid(id)) notFound();
  const { data, error } = await client
    .from("orders")
    .select(purchaseFields)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Order review is unavailable.");
  if (!data) notFound();
  const order = data as unknown as Purchase;
  const canDeliver =
    order.payment_status === "paid" && order.fulfillment_status !== "delivered";
  return (
    <Workspace title="Order review" user={user} admin>
      <section className="workspace-content">
        <Link href="/admin/orders" className="text-link">
          Back to orders
        </Link>
        <div className="panel-heading">
          <div>
            <h1>Review order</h1>
            <p>
              {order.reference} · {purchaseDate(order.created_at)}
            </p>
          </div>
          <strong>{formatPrice(order.total_minor / 100)}</strong>
        </div>
        <div className="order-state">
          <span className={`purchase-status status-${order.payment_status}`}>
            Payment: {order.payment_status}
          </span>
          <span
            className={`purchase-status status-${order.fulfillment_status}`}
          >
            Delivery: {order.fulfillment_status}
          </span>
        </div>
        {query.error && (
          <p className="form-error" role="alert">
            Delivery could not be saved. Verify payment status and provide
            instructions for every item.
          </p>
        )}
        {query.delivered && order.fulfillment_status === "delivered" && (
          <p className="form-message" role="status">
            Order delivered. The customer can now view their private
            instructions.
          </p>
        )}
        <form action={fulfillOrder} className="surface-panel admin-form">
          <input type="hidden" name="order_id" value={id} />
          <h2>{canDeliver ? "Manual fulfillment" : "Order items"}</h2>
          {order.order_items.map((item) => (
            <div key={item.id} className="admin-delivery-item">
              <h3>{item.product_name}</h3>
              <p>
                {item.category_name} · Quantity {item.quantity}
              </p>
              {canDeliver && (
                <label>
                  Authorized license / activation instructions
                  <textarea
                    name={`item:${item.id}`}
                    rows={5}
                    required
                    maxLength={20000}
                    placeholder="Provide the licensed redemption code, download or approved activation instructions. Do not enter third-party account passwords or session tokens."
                  />
                </label>
              )}
            </div>
          ))}
          {canDeliver ? (
            <>
              <p className="form-hint">
                This action delivers the order once and notifies the customer.
                Use authorized inventory only. Existing private entitlements are
                never displayed to administrators.
              </p>
              <button className="button button-orange">Deliver order</button>
            </>
          ) : (
            <p className="form-message">
              {order.fulfillment_status === "delivered"
                ? "This order has already been fulfilled. Duplicate delivery is prevented."
                : "Delivery is disabled until the backend verifies payment."}
            </p>
          )}
        </form>
      </section>
    </Workspace>
  );
}
