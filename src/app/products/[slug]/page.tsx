import { getIdentity } from "@/lib/supabase/server";
import { PrivateCatalog } from "@/components/private-catalog";
import { Workspace } from "@/components/workspace";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Info,
  Package,
  ShieldQuestion,
} from "lucide-react";
import { formatPrice } from "@/lib/catalog";
import { loadProduct, loadCatalog } from "@/lib/storefront";
import { site } from "@/lib/site";
import { CatalogNotice } from "@/components/catalog-notice";
import { ProductCard, DeliveryIcon } from "@/components/product-card";
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
  const product = await loadProduct((await params).slug);
  return product
    ? {
        title: product.name,
        description: product.description,
        alternates: { canonical: `/products/${product.slug}` },
        robots: { index: false, follow: true },
        openGraph: {
          title: product.name,
          description: product.description,
          url: `/products/${product.slug}`,
        },
      }
    : { title: "Product not found" };
}
export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const identity = await getIdentity();
  if (!identity) return <PrivateCatalog />;
  const product = await loadProduct((await params).slug);
  if (!product) notFound();
  const category = {
    slug: product.category,
    name: product.categoryName || "Digital products",
  };
  const { storefront, result } = await loadCatalog({
    category: product.category,
  });
  category.name =
    storefront.categories.find((c) => c.slug === category.slug)?.name ||
    category.name;
  const related = result.products
    .filter((item) => item.id !== product.id)
    .slice(0, 3);
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Marketplace",
        item: `${site.url}/marketplace`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: category.name,
        item: `${site.url}/categories/${category.slug}`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: product.name,
        item: `${site.url}/products/${product.slug}`,
      },
    ],
  };
  return (
    <Workspace title="Product details" user={identity.user}>
      <section className="container product-page">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(breadcrumb).replace(/</g, "\\u003c"),
          }}
        />
        <div className="breadcrumb">
          <Link href="/marketplace">Marketplace</Link>
          <ArrowRight size={12} />
          <Link href={`/categories/${category.slug}`}>{category.name}</Link>
          <ArrowRight size={12} />
          <span>{product.name}</span>
        </div>
        <CatalogNotice mode={storefront.mode} />
        <div className="product-detail-grid">
          <div>
            <div className="product-detail-art">
              <Image
                src={product.image}
                alt={product.name}
                unoptimized={product.image.startsWith("http")}
                width={640}
                height={420}
                priority
              />
            </div>
            <p className="art-caption">
              {product.image === "/products/catalog-default.svg"
                ? "Product image not provided."
                : "Product image supplied with the listing."}
            </p>
            <div className="product-included">
              <h2>What’s included</h2>
              <ul>
                {product.features.map((feature) => (
                  <li key={feature}>
                    <Check size={16} />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="product-detail-copy">
            <Link href={`/categories/${category.slug}`} className="eyebrow">
              {category.name} <ArrowUpRight size={12} />
            </Link>
            <h1>{product.name}</h1>
            <p className="product-detail-description">{product.description}</p>
            <div className="product-detail-price">
              <strong>{formatPrice(product.price)}</strong>
              <span>{product.term}</span>
            </div>
            <dl className="product-specs">
              <div>
                <dt>
                  <Package size={15} /> Availability
                </dt>
                <dd className={product.availableQuantity ? "text-green" : ""}>
                  {product.availableQuantity
                    ? `${product.availableQuantity} available`
                    : "Out of stock"}
                </dd>
              </div>
              <div>
                <dt>
                  <DeliveryIcon type={product.deliveryType} size={15} />{" "}
                  Delivery type
                </dt>
                <dd>{product.deliveryType}</dd>
              </div>
              <div>
                <dt>
                  <ShieldQuestion size={15} /> Authorized supplier
                </dt>
                <dd>
                  {product.authorizedSupplier || "Not connected / not verified"}
                </dd>
              </div>
              <div>
                <dt>Product ID</dt>
                <dd>{product.id}</dd>
              </div>
              <div>
                <dt>Product status</dt>
                <dd>Active listing · Checkout unavailable</dd>
              </div>
            </dl>
            <button className="button purchase-unavailable" disabled>
              Purchases not available
            </button>
            <p className="purchase-explanation">
              <Info size={15} />
              Verified checkout is required before this product can be
              purchased.
            </p>
            <Link href="/support" className="text-link">
              Questions? Visit the help center <ArrowUpRight size={15} />
            </Link>
          </div>
        </div>
        <div className="delivery-info">
          <span className="notice-icon">
            <DeliveryIcon type={product.deliveryType} size={24} />
          </span>
          <div>
            <h2>How delivery will work</h2>
            <p>
              This product uses{" "}
              <strong>{product.deliveryType.toLowerCase()}</strong>. For live
              products, delivery will begin only after server-side payment
              verification. Instructions and purchased entitlements will be
              available only to the customer who placed the order.
            </p>
          </div>
        </div>
        <section className="related-section" aria-labelledby="related-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">MORE POSSIBILITIES</p>
              <h2 id="related-title">Keep exploring.</h2>
            </div>
            <Link href="/marketplace" className="text-link">
              All products <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="product-grid related-grid">
            {related.map((item) => (
              <ProductCard key={item.id} product={item} />
            ))}
          </div>
        </section>
      </section>
    </Workspace>
  );
}
