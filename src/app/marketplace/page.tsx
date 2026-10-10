import type { Metadata } from "next";
import { Store } from "lucide-react";
import { getIdentity } from "@/lib/supabase/server";
import { PrivateCatalog } from "@/components/private-catalog";
import { Workspace } from "@/components/workspace";
import { CatalogView } from "@/components/catalog-view";
import type { SearchParams } from "@/lib/catalog";
import { publicMetadata } from "@/lib/site";
export const metadata: Metadata = {
  ...publicMetadata(
    "Explore the Marketplace",
    "Search the LOGSPOLL catalog. Filter software, subscriptions, and digital tools by category, price, and availability.",
    "/marketplace",
  ),
  robots: { index: false, follow: false },
};
export default async function Marketplace({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const identity = await getIdentity();
  if (!identity) return <PrivateCatalog />;
  return (
    <Workspace title="Products" user={identity.user}>
      <section className="page-heading">
        <div className="container">
          <h1>
            <Store size={24} /> Products Store
          </h1>
          <p>Browse authorized digital services, subscriptions and tools.</p>
        </div>
      </section>
      <CatalogView params={await searchParams} />
    </Workspace>
  );
}
