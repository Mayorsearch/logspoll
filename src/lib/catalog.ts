import { getCategory } from "./categories.ts";
export { categories, getCategory, type CategorySlug } from "./categories.ts";

export type DeliveryType =
  | "Licensed digital download"
  | "Redemption code"
  | "Subscription activation"
  | "Manual fulfillment";
export type Product = {
  id: string;
  slug: string;
  name: string;
  brand: string;
  category: string;
  categoryName?: string;
  description: string;
  price: number;
  currency: "NGN";
  authorizedSupplier: string | null;
  availableQuantity: number;
  deliveryType: DeliveryType;
  status: "active";
  image: string;
  term: string;
  features: readonly string[];
  createdAt: string;
  featured: boolean;
};

export function formatPrice(price: number, currency: "NGN" = "NGN") {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(price);
}
export type SearchParams = Record<string, string | string[] | undefined>;
export type CatalogFilters = {
  q: string;
  category: string;
  min: string;
  max: string;
  availability: string;
  sort: string;
  page: number;
};
export const pageSize = 9;
function first(value: string | string[] | undefined) {
  return typeof value === "string" ? value : value?.[0] || "";
}
function priceValue(value: string) {
  return /^\d{1,9}$/.test(value) ? String(Number(value)) : "";
}
export function parseFilters(
  params: SearchParams,
  categorySlugs?: readonly string[],
): CatalogFilters {
  const category = first(params.category);
  const availability = first(params.availability);
  const sort = first(params.sort);
  const page = Number(first(params.page));
  return {
    q: first(params.q).trim().slice(0, 120),
    category:
      getCategory(category)?.slug ||
      (categorySlugs?.includes(category) ? category : ""),
    min: priceValue(first(params.min)),
    max: priceValue(first(params.max)),
    availability: ["in-stock", "out-of-stock"].includes(availability)
      ? availability
      : "",
    sort: ["featured", "price-asc", "price-desc", "newest", "name"].includes(
      sort,
    )
      ? sort
      : "featured",
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 10000) : 1,
  };
}
export function catalogHref(filters: Partial<CatalogFilters> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (
      value !== "" &&
      value !== undefined &&
      !(key === "page" && value === 1) &&
      !(key === "sort" && value === "featured")
    )
      params.set(key, String(value));
  }
  return `/marketplace${params.size ? `?${params}` : ""}`;
}
