import Link from "next/link";
import { Package, ArrowRight, ShoppingBag } from "lucide-react";
import { formatPrice } from "@/lib/catalog";
import { purchaseDate, type Purchase } from "@/lib/purchases";
export function PurchaseList({ purchases }: { purchases: Purchase[] }) {
  if (!purchases.length)
    return (
      <div className="honest-empty">
        <ShoppingBag size={33} />
        <h3>No purchases yet</h3>
        <p>
          Your verified orders and delivery instructions will appear here.
          Purchasing is not available yet.
        </p>
        <Link className="button button-dark" href="/marketplace">
          Browse the store
          <ArrowRight size={15} />
        </Link>
      </div>
    );
  return (
    <div className="purchase-list">
      {purchases.map((order) => (
        <article className="purchase-card" key={order.id}>
          <span className="purchase-icon">
            <Package size={25} />
          </span>
          <div className="purchase-description">
            <div className="purchase-tags">
              <span>
                {order.order_items[0]?.category_name || "Digital service"}
              </span>
              <span
                className={`purchase-status status-${order.fulfillment_status}`}
              >
                {order.fulfillment_status}
              </span>
            </div>
            <h3>
              {order.order_items[0]?.product_name || "Digital order"}
              {order.order_items.length > 1
                ? ` + ${order.order_items.length - 1} more`
                : ""}
            </h3>
            <p>Purchased on {purchaseDate(order.created_at)}</p>
            <Link
              className="button button-dark"
              href={`/dashboard/purchases/${order.id}`}
            >
              {order.payment_status === "paid" &&
              order.fulfillment_status === "delivered"
                ? "View Access Details"
                : "View Order"}
              <ArrowRight size={14} />
            </Link>
          </div>
          <div className="purchase-amount">
            <span>{order.payment_status}</span>
            <strong>{formatPrice(order.total_minor / 100)}</strong>
            <small>Order: {order.reference}</small>
          </div>
        </article>
      ))}
    </div>
  );
}
