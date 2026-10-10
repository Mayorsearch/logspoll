import Image from "next/image";
import Link from "next/link";
import {
  ArrowUpRight,
  Download,
  KeyRound,
  UserRoundCheck,
  Settings2,
} from "lucide-react";
import {
  formatPrice,
  getCategory,
  type Product,
  type DeliveryType,
} from "@/lib/catalog";
const deliveryIcons = {
  "Licensed digital download": Download,
  "Redemption code": KeyRound,
  "Subscription activation": UserRoundCheck,
  "Manual fulfillment": Settings2,
};
export function DeliveryIcon({
  type,
  size = 13,
}: {
  type: DeliveryType;
  size?: number;
}) {
  const Icon = deliveryIcons[type];
  return <Icon size={size} aria-hidden="true" />;
}
export function ProductCard({
  product,
  priority = false,
}: {
  product: Product;
  priority?: boolean;
}) {
  const category = {
    slug: product.category,
    name:
      product.categoryName ||
      getCategory(product.category)?.name ||
      "Digital products",
  };
  return (
    <article className="product-card">
      <Link
        href={`/products/${product.slug}`}
        className="product-image-link"
        aria-label={`View ${product.name}`}
      >
        {product.image === "/products/catalog-default.svg" ? (
          <div
            className={`product-cover cover-${product.category.charCodeAt(0) % 3}`}
            aria-hidden="true"
          >
            <DeliveryIcon type={product.deliveryType} size={26} />
            <strong>{product.name}</strong>
            <span>{category.name}</span>
          </div>
        ) : (
          <Image
            src={product.image}
            alt={product.name}
            unoptimized={
              product.image.startsWith("https:") ||
              product.image.startsWith("http:")
            }
            width={640}
            height={420}
            priority={priority}
            className="product-image"
          />
        )}

        <span className="product-image-arrow">
          <ArrowUpRight size={18} />
        </span>
      </Link>
      <div className="product-card-body">
        <div className="product-meta">
          <Link href={`/categories/${category.slug}`}>{category.name}</Link>
          <span
            className={`stock ${!product.availableQuantity ? "stock-out" : ""}`}
          >
            <span />
            {product.availableQuantity
              ? `${product.availableQuantity} left`
              : "Out of stock"}
          </span>
        </div>
        <h3>
          <Link href={`/products/${product.slug}`}>{product.name}</Link>
        </h3>
        <p className="product-term">{product.term}</p>
        <div className="product-card-bottom">
          <span className="product-price">{formatPrice(product.price)}</span>
          <Link
            href={`/products/${product.slug}`}
            className="product-details-link"
          >
            View Details
          </Link>
        </div>
      </div>
    </article>
  );
}
