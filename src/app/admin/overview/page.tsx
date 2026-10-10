import type { Metadata } from "next";
import Link from "next/link";
import { Package, Tags, ClipboardList, Truck, ArrowRight } from "lucide-react";
import { requireAdmin } from "@/lib/supabase/server";
import { Workspace } from "@/components/workspace";
import { formatPrice } from "@/lib/catalog";
export const metadata: Metadata = {
  title: "Admin Overview",
  robots: { index: false, follow: false },
};
export default async function Overview() {
  const { client, user } = await requireAdmin();
  const { data, error } = await client.rpc("panel_admin_overview");
  if (error || !data)
    throw new Error("Administration overview is unavailable.");
  const stats = data as {
    products: number;
    active_products: number;
    categories: number;
    orders: number;
    awaiting_delivery: number;
    revenue_minor: number;
  };
  return (
    <Workspace title="Overview" user={user} admin>
      <section className="workspace-content">
        <div className="panel-heading">
          <div>
            <h1>Admin overview</h1>
            <p>Catalog and order information from your database.</p>
          </div>
          <Link className="button button-orange" href="/admin#product-form">
            Add product
            <ArrowRight size={16} />
          </Link>
        </div>
        <div className="admin-summary-grid">
          {[
            {
              label: "Products",
              value: stats.products,
              Icon: Package,
              href: "/admin",
            },
            {
              label: "Categories",
              value: stats.categories,
              Icon: Tags,
              href: "/admin/categories",
            },
            {
              label: "Orders",
              value: stats.orders,
              Icon: ClipboardList,
              href: "/admin/orders",
            },
            {
              label: "Awaiting delivery",
              value: stats.awaiting_delivery,
              Icon: Truck,
              href: "/admin/orders",
            },
          ].map(({ label, value, Icon, href }) => (
            <Link key={label} href={href}>
              <Icon size={23} />
              <span>{label}</span>
              <strong>{value}</strong>
            </Link>
          ))}
        </div>
        <div className="dashboard-panels">
          <article className="surface-panel">
            <h2>Verified paid sales</h2>
            <strong className="admin-revenue">
              {formatPrice(stats.revenue_minor / 100)}
            </strong>
            <p>
              Totals from paid orders. Refunded and unpaid orders are excluded.
            </p>
          </article>
          <article className="surface-panel">
            <h2>Catalog status</h2>
            <p>
              {stats.active_products} active listings out of {stats.products}{" "}
              products.
            </p>
            <Link href="/admin" className="quick-action">
              Manage products
              <ArrowRight size={16} />
            </Link>
            <Link href="/admin/audit" className="quick-action">
              Review audit log
              <ArrowRight size={16} />
            </Link>
          </article>
        </div>
        <p className="form-message">
          Live checkout is not connected. Payment status cannot be changed from
          this panel; it must come from verified backend payment processing.
        </p>
      </section>
    </Workspace>
  );
}
