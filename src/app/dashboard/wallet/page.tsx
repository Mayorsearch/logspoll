import type { Metadata } from "next";
import Link from "next/link";
import { Wallet, ArrowRight } from "lucide-react";
import { requireIdentity } from "@/lib/supabase/server";
import { Workspace } from "@/components/workspace";
export const metadata: Metadata = {
  title: "Wallet",
  robots: { index: false, follow: false },
};
export default async function WalletPage() {
  const { user } = await requireIdentity();
  return (
    <Workspace title="Wallet" user={user}>
      <section className="purchase-panel">
        <h1>Your wallet</h1>
        <div className="honest-empty">
          <Wallet size={36} />
          <h2>Wallet services are not enabled</h2>
          <p>
            Deposits, withdrawals and wallet purchases are unavailable. No funds
            are held by this website. Funding will require approved payment
            processing and a transactional ledger.
          </p>
          <button disabled className="button button-outline">
            Funding unavailable
          </button>
          <Link href="/dashboard/purchases" className="text-link">
            View purchase history
            <ArrowRight size={15} />
          </Link>
        </div>
      </section>
    </Workspace>
  );
}
