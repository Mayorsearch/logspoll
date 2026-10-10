import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LockKeyhole, ArrowLeft } from "lucide-react";
import { Workspace } from "@/components/workspace";
import { CopyAccess } from "@/components/copy-access";
import { ReviewForm } from "@/components/review-form";
import { requireIdentity } from "@/lib/supabase/server";
import {
  purchaseFields,
  purchaseDate,
  isUuid,
  type Purchase,
} from "@/lib/purchases";
import { formatPrice } from "@/lib/catalog";
export const metadata: Metadata = {
  title: "Private Order Details",
  robots: { index: false, follow: false },
};
export default async function PurchaseDetails({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { client, user } = await requireIdentity();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { data, error } = await client
    .from("orders")
    .select(purchaseFields)
    .eq("id", id)
    .eq("customer_id", user.id)
    .maybeSingle();
  if (error) throw new Error("Order details are unavailable.");
  if (!data) notFound();
  const order = data as unknown as Purchase;
  const ready =
    order.payment_status === "paid" && order.fulfillment_status === "delivered";
  const entitlements =
    ready && order.order_items.length
      ? await client
          .from("product_entitlements")
          .select("order_item_id,instructions")
          .in(
            "order_item_id",
            order.order_items.map((item) => item.id),
          )
      : { data: [], error: null };
  if (entitlements.error) throw new Error("Delivery details are unavailable.");
  const reviews =
    ready && order.order_items.length
      ? await client
          .from("reviews")
          .select("order_item_id,status")
          .in(
            "order_item_id",
            order.order_items.map((item) => item.id),
          )
      : { data: [], error: null };
  return (
    <Workspace title="Order details" user={user}>
      <section className="purchase-panel order-details">
        <Link href="/dashboard/purchases" className="text-link">
          <ArrowLeft size={15} />
          Purchase history
        </Link>
        <div className="panel-heading">
          <div>
            <h1>Order details</h1>
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
        {order.order_items.map((item) => {
          const entitlement = entitlements.data?.find(
            (row) => row.order_item_id === item.id,
          );
          return (
            <article className="access-item" key={item.id}>
              <h2>{item.product_name}</h2>
              <p>
                {item.category_name} · Quantity {item.quantity}
              </p>
              {entitlement ? (
                <>
                  <div className="access-label">
                    <LockKeyhole size={13} /> PRIVATE DELIVERY INSTRUCTIONS
                  </div>
                  <pre>{entitlement.instructions}</pre>
                  <CopyAccess text={entitlement.instructions} />
                </>
              ) : (
                <p className="form-message">
                  {ready
                    ? "Delivery instructions are not available. Please contact support."
                    : "Access details become available only after verified payment and completed delivery."}
                </p>
              )}
              {ready &&
                (reviews.error ? (
                  <p className="form-message">
                    Reviews are temporarily unavailable.
                  </p>
                ) : reviews.data?.some(
                    (review) => review.order_item_id === item.id,
                  ) ? (
                  <p className="form-message">
                    Your review:{" "}
                    {
                      reviews.data.find(
                        (review) => review.order_item_id === item.id,
                      )?.status
                    }
                    . Thank you for your feedback.
                  </p>
                ) : (
                  <ReviewForm itemId={item.id} />
                ))}
            </article>
          );
        })}
        <Link href="/support" className="text-link">
          Get help with your order
        </Link>
      </section>
    </Workspace>
  );
}
