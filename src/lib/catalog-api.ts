import type { Category } from "./categories.ts";
import type { CatalogFilters, DeliveryType, Product } from "./catalog.ts";

export class CatalogConnectionError extends Error {
  constructor() {
    super("The marketplace could not load its catalog. Please try again.");
  }
}
export type CatalogConfig = { url: string; key: string };
export type CatalogResult = {
  products: Product[];
  total: number;
  pages: number;
  page: number;
};
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function validSlug(value: string) {
  return value.length <= 100 && slugPattern.test(value);
}
export function validateCatalogConfig(config: CatalogConfig): CatalogConfig {
  try {
    const url = new URL(config.url);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error();
    // New Supabase publishable keys only. Never accept a privileged or ambiguous JWT key.
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.key)) throw new Error();
    return { url: url.origin, key: config.key };
  } catch {
    throw new CatalogConnectionError();
  }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CatalogConnectionError();
  return value as Record<string, unknown>;
}
function str(value: unknown, max = 10000): string {
  if (typeof value !== "string" || value.length > max)
    throw new CatalogConnectionError();
  return value;
}
function integer(value: unknown, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > max
  )
    throw new CatalogConnectionError();
  return value;
}
function slug(value: unknown): string {
  const result = str(value, 100);
  if (!validSlug(result)) throw new CatalogConnectionError();
  return result;
}
export function decodeProduct(value: unknown, baseURL: string): Product {
  const row = record(value);
  const delivery = str(row.delivery_type);
  if (
    ![
      "Licensed digital download",
      "Redemption code",
      "Subscription activation",
      "Manual fulfillment",
    ].includes(delivery) ||
    row.currency !== "NGN" ||
    typeof row.featured !== "boolean" ||
    !Array.isArray(row.features) ||
    row.features.length > 30
  )
    throw new CatalogConnectionError();
  let image = "/products/catalog-default.svg";
  if (row.image_path !== null) {
    const path = str(row.image_path, 2048);
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.(png|jpg|jpeg|webp)$/.test(path) ||
      path.includes("//")
    )
      throw new CatalogConnectionError();
    image = `${baseURL}/storage/v1/object/public/product-images/${path}`;
  }
  return {
    id: str(row.id, 100),
    slug: slug(row.slug),
    name: str(row.name, 200),
    brand: str(row.brand, 120),
    category: slug(row.category),
    categoryName: str(row.category_name, 120),
    description: str(row.description),
    price: integer(row.price_minor, 99999999900) / 100,
    currency: "NGN",
    authorizedSupplier: str(row.supplier_name, 200),
    availableQuantity: integer(row.available_quantity, 1000000),
    deliveryType: delivery as DeliveryType,
    image,
    term: str(row.term, 200),
    features: row.features.map((v) => str(v, 2000)),
    createdAt: str(row.created_at, 100),
    featured: row.featured,
    status: "active",
  };
}
export function createCatalogApi(
  input: CatalogConfig,
  fetcher: typeof fetch = fetch,
  accessToken?: string,
) {
  const config = validateCatalogConfig(input);
  async function request(path: string, body?: object): Promise<unknown> {
    try {
      const response = await fetcher(`${config.url}/rest/v1/${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          apikey: config.key,
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new CatalogConnectionError();
      return await response.json();
    } catch {
      throw new CatalogConnectionError();
    }
  }
  return {
    async categories(): Promise<Category[]> {
      const rows = await request(
        "storefront_categories?select=slug,name,short_name,description,icon,color,product_count&order=sort_order.asc,slug.asc&limit=1000",
      );
      if (!Array.isArray(rows) || rows.length >= 1000)
        throw new CatalogConnectionError();
      return rows.map((value) => {
        const row = record(value);
        return {
          slug: slug(row.slug),
          name: str(row.name, 120),
          shortName: str(row.short_name, 120),
          description: str(row.description, 2000),
          icon: str(row.icon, 30),
          color: str(row.color, 30),
          productCount: integer(row.product_count, 2147483647),
        };
      });
    },
    async search(filters: CatalogFilters): Promise<CatalogResult> {
      const row = record(
        await request("rpc/storefront_search", {
          q: filters.q,
          category_slug: filters.category,
          min_minor: filters.min ? Number(filters.min) * 100 : null,
          max_minor: filters.max ? Number(filters.max) * 100 : null,
          availability: filters.availability,
          sort_by: filters.sort,
          requested_page: filters.page,
        }),
      );
      const total = integer(row.total, 2147483647),
        pages = integer(row.pages, 238609295),
        page = integer(row.page, 10000);
      if (
        pages !== Math.max(1, Math.ceil(total / 9)) ||
        page < 1 ||
        page > pages ||
        !Array.isArray(row.products) ||
        row.products.length > 9 ||
        row.products.length !== Math.min(9, Math.max(0, total - (page - 1) * 9))
      )
        throw new CatalogConnectionError();
      return {
        total,
        pages,
        page,
        products: row.products.map((value) => decodeProduct(value, config.url)),
      };
    },
    async product(productSlug: string): Promise<Product | undefined> {
      if (!validSlug(productSlug)) return undefined;
      const rows = await request(
        `storefront_products?select=*&slug=eq.${encodeURIComponent(productSlug)}&limit=1`,
      );
      if (!Array.isArray(rows) || rows.length > 1)
        throw new CatalogConnectionError();
      return rows[0] ? decodeProduct(rows[0], config.url) : undefined;
    },
  };
}
