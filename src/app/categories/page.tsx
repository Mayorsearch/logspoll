import Link from "next/link";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { CategoryGrid } from "@/components/category-grid";
import { PublicPage } from "@/components/public-page";
import { publicMetadata } from "@/lib/site";
export const metadata = publicMetadata(
  "Service categories",
  "Explore VPN, Facebook, Instagram, Google Voice, USA Email, TextNow, TextPlus, Talkatone, TikTok and other authorized digital services.",
  "/categories",
);
export default function Categories() {
  return (
    <PublicPage
      title="Find your next digital essential."
      eyebrow="SERVICE CATEGORIES"
      description="Explore the services LOGSPOLL supports. Sign in to view available products, pricing and fulfillment details."
    >
      <section
        className="public-category-section"
        aria-label="Service categories"
      >
        <CategoryGrid detailed />
      </section>
      <section className="public-callout">
        <LockKeyhole size={24} />
        <div>
          <h2>A private catalog, built around you.</h2>
          <p>
            Category previews describe our service areas. Current listings and
            stock are available inside your account.
          </p>
        </div>
        <Link href="/marketplace" className="text-link">
          Explore the catalog <ArrowRight size={16} />
        </Link>
      </section>
    </PublicPage>
  );
}
