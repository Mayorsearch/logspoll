import { getIdentity } from "@/lib/supabase/server";
import { PrivateCatalog } from "@/components/private-catalog";
import { Workspace } from "@/components/workspace";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { loadCategory } from "@/lib/storefront";
import { CategoryIcon } from "@/components/category-icon";
import { CatalogView } from "@/components/catalog-view";
import { publicMetadata } from "@/lib/site";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  if (!(await getIdentity()))
    return {
      title: "Private Catalog",
      robots: { index: false, follow: false },
    };
  const category = await loadCategory((await params).slug);
  return category
    ? {
        ...publicMetadata(
          category.name,
          category.description,
          `/categories/${category.slug}`,
        ),
        robots: { index: false, follow: false },
      }
    : { title: "Category not found" };
}
export default async function CategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const identity = await getIdentity();
  if (!identity) return <PrivateCatalog />;
  const category = await loadCategory((await params).slug);
  if (!category) notFound();
  return (
    <Workspace title="Products" user={identity.user}>
      <section className="page-heading">
        <div className="container">
          <div className="breadcrumb">
            <Link href="/">Home</Link>
            <ArrowRight size={12} />
            <Link href="/categories">Categories</Link>
            <ArrowRight size={12} />
            <span>{category.name}</span>
          </div>
          <span className={`category-icon color-${category.color}`}>
            <CategoryIcon icon={category.icon} size={26} />
          </span>
          <h1>{category.name}</h1>
          <p>{category.description}</p>
        </div>
      </section>
      <CatalogView params={{ category: category.slug }} />
    </Workspace>
  );
}
