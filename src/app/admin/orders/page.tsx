import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { requireAdmin } from "@/lib/supabase/server";
import { Workspace } from "@/components/workspace";
import { purchaseFields, purchaseDate, type Purchase } from "@/lib/purchases";
import { formatPrice } from "@/lib/catalog";
export const metadata: Metadata = {
  title: "Order Administration",
  robots: { index: false, follow: false },
};
export default async function Orders({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { client, user } = await requireAdmin();
  const requested = Number((await searchParams).page || 1);
  const page =
    Number.isSafeInteger(requested) && requested > 0
      ? Math.min(requested, 10000)
      : 1;
  const { data, error } = await client
    .from("orders")
    .select(purchaseFields)
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * 30, page * 30);
  if (error) throw new Error("Order administration is unavailable.");
  const orders = (data || []).slice(0, 30) as unknown as Purchase[];
  return (
    <Workspace title="Orders" user={user} admin>
      <section className="workspace-content">
        <h1>Orders</h1>
        <p>Review payment state and fulfill verified paid orders.</p>
        <div className="surface-panel admin-table">
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Product</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Payment</th>
                <th>Delivery</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.reference}</td>
                  <td>
                    {order.order_items[0]?.product_name || "Digital order"}
                  </td>
                  <td>{purchaseDate(order.created_at)}</td>
                  <td>{formatPrice(order.total_minor / 100)}</td>
                  <td>{order.payment_status}</td>
                  <td>{order.fulfillment_status}</td>
                  <td>
                    <Link href={`/admin/orders/${order.id}`}>Review order</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!orders.length && (
            <div className="honest-empty">
              <ClipboardList size={30} />
              <h2>No orders yet</h2>
              <p>Verified customer orders will appear here.</p>
            </div>
          )}
        </div>
        {(page > 1 || (data?.length || 0) > 30) && (
          <nav className="panel-pagination" aria-label="Admin order pages">
            {page > 1 && (
              <Link href={`/admin/orders?page=${page - 1}`}>Previous</Link>
            )}
            <span>Page {page}</span>
            {(data?.length || 0) > 30 && (
              <Link href={`/admin/orders?page=${page + 1}`}>Next</Link>
            )}
          </nav>
        )}
      </section>
    </Workspace>
  );
}
