import type { Metadata } from "next";
import Link from "next/link";
import { Workspace } from "@/components/workspace";
import { PurchaseList } from "@/components/purchase-list";
import { requireIdentity } from "@/lib/supabase/server";
import { getPurchases } from "@/lib/purchases";
export const metadata: Metadata = {
  title: "Purchase History",
  robots: { index: false, follow: false },
};
export default async function Purchases({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { user } = await requireIdentity();
  const requested = Number((await searchParams).page || 1);
  const page =
    Number.isSafeInteger(requested) && requested > 0
      ? Math.min(requested, 10000)
      : 1;
  const { purchases, hasMore } = await getPurchases(page);
  return (
    <Workspace title="Purchase History" user={user}>
      <section className="purchase-panel">
        <h1>All Purchases</h1>
        <PurchaseList purchases={purchases} />
        {(page > 1 || hasMore) && (
          <nav className="panel-pagination" aria-label="Purchase pages">
            {page > 1 && (
              <Link href={`/dashboard/purchases?page=${page - 1}`}>
                Previous
              </Link>
            )}
            <span>Page {page}</span>
            {hasMore && (
              <Link href={`/dashboard/purchases?page=${page + 1}`}>Next</Link>
            )}
          </nav>
        )}
      </section>
    </Workspace>
  );
}
