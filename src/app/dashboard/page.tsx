import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Package, History, UserRound } from "lucide-react";
import { requireIdentity } from "@/lib/supabase/server";
import { getPurchases } from "@/lib/purchases";
import { Workspace } from "@/components/workspace";
import { PurchaseList } from "@/components/purchase-list";
export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};
export default async function Dashboard() {
  const { user } = await requireIdentity();
  const { purchases } = await getPurchases();
  return (
    <Workspace title="Dashboard" user={user}>
      <section className="customer-dashboard">
        <div className="panel-heading">
          <div>
            <h1>Your dashboard</h1>
            <p>Your digital services and account, in one place.</p>
          </div>
          <Link href="/marketplace" className="button button-dark">
            Visit the store
            <ArrowRight size={16} />
          </Link>
        </div>
        <div className="customer-shortcuts">
          {[
            {
              href: "/marketplace",
              title: "Browse products",
              text: "Explore the private catalog",
              Icon: Package,
            },
            {
              href: "/dashboard/purchases",
              title: "Purchase history",
              text: "Orders and private access details",
              Icon: History,
            },
            {
              href: "/dashboard/profile",
              title: "Your profile",
              text: "Manage your account information",
              Icon: UserRound,
            },
          ].map(({ href, title, text, Icon }) => (
            <Link href={href} key={href}>
              <Icon size={22} />
              <div>
                <strong>{title}</strong>
                <span>{text}</span>
              </div>
              <ArrowRight size={16} />
            </Link>
          ))}
        </div>
        <section className="purchase-panel">
          <div className="panel-section-heading">
            <h2>Recent purchases</h2>
            <Link href="/dashboard/purchases">
              View all
              <ArrowRight size={14} />
            </Link>
          </div>
          <PurchaseList purchases={purchases.slice(0, 5)} />
        </section>
      </section>
    </Workspace>
  );
}
