import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCatalogApi,
  decodeProduct,
  validateCatalogConfig,
  CatalogConnectionError,
} from "../src/lib/catalog-api.ts";
import { parseFilters } from "../src/lib/catalog.ts";
const config = {
  url: "https://example.supabase.co",
  key: "sb_publishable_test",
};
const row = {
  id: "test-id",
  slug: "real-tool",
  name: "Real Tool",
  brand: "Supplier",
  category: "new-tools",
  category_name: "New Tools",
  description: "Licensed tool",
  price_minor: 123456,
  currency: "NGN",
  supplier_name: "Authorized supplier",
  available_quantity: 4,
  delivery_type: "Manual fulfillment",
  image_path: null,
  term: "Annual",
  features: ["Licensed use"],
  created_at: "2026-10-09T00:00:00Z",
  featured: true,
  secret: "must not escape",
};
test("public catalog mapper handles integer money, images and strips extra fields", () => {
  const product = decodeProduct(row, config.url);
  assert.equal(product.price, 1234.56);
  assert.equal(product.status, "active");
  assert.equal(product.categoryName, "New Tools");
  assert.equal("secret" in product, false);
  assert.equal(product.image, "/products/catalog-default.svg");
  assert.equal(
    decodeProduct({ ...row, image_path: "products/tool.webp" }, config.url)
      .image,
    `${config.url}/storage/v1/object/public/product-images/products/tool.webp`,
  );
  for (const patch of [
    { price_minor: -1 },
    { price_minor: 1.2 },
    { currency: "USD" },
    { image_path: "../secret.png" },
    { available_quantity: -1 },
    { delivery_type: "Credentials" },
  ])
    assert.throws(
      () => decodeProduct({ ...row, ...patch }, config.url),
      CatalogConnectionError,
    );
});
test("configuration rejects privileged keys, unsafe hosts and credentials", () => {
  for (const key of ["sb_secret_test", "eyJhbGciOiJIUzI1NiJ9.fake", ""])
    assert.throws(
      () => validateCatalogConfig({ ...config, key }),
      CatalogConnectionError,
    );
  for (const url of [
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com/path",
    "https://example.com/?key=bad",
  ])
    assert.throws(
      () => validateCatalogConfig({ ...config, url }),
      CatalogConnectionError,
    );
  assert.equal(
    validateCatalogConfig({ ...config, url: "http://127.0.0.1:3101" }).url,
    "http://127.0.0.1:3101",
  );
});
test("catalog API sends bounded validated filters and never falls back on failures", async () => {
  let sent: RequestInit | undefined;
  const api = createCatalogApi(config, (async (url, init) => {
    assert.equal(url, `${config.url}/rest/v1/rpc/storefront_search`);
    sent = init;
    return Response.json({ products: [row], total: 1, page: 1, pages: 1 });
  }) as typeof fetch);
  const result = await api.search(
    parseFilters({ category: "new-tools", min: "1200", q: "licensed" }, [
      "new-tools",
    ]),
  );
  assert.equal(result.products[0].name, "Real Tool");
  assert.equal(sent?.cache, "no-store");
  assert.deepEqual(JSON.parse(sent?.body as string), {
    q: "licensed",
    category_slug: "new-tools",
    min_minor: 120000,
    max_minor: null,
    availability: "",
    sort_by: "featured",
    requested_page: 1,
  });
  for (const fetcher of [
    async () => new Response("private provider details", { status: 500 }),
    async () => {
      throw new Error("secret in network error");
    },
    async () => Response.json({ products: [], total: 12, page: 1, pages: 2 }),
  ]) {
    await assert.rejects(
      createCatalogApi(config, fetcher as typeof fetch).search(
        parseFilters({}),
      ),
      (error) =>
        error instanceof CatalogConnectionError &&
        !error.message.includes("secret") &&
        !error.message.includes("private"),
    );
  }
});
test("new categories and product lookup support records beyond sample slugs", async () => {
  const api = createCatalogApi(config, (async (url) =>
    Response.json(
      String(url).includes("storefront_categories")
        ? [
            {
              slug: "new-tools",
              name: "New Tools",
              short_name: "New Tools",
              description: "Licensed tools",
              icon: "grid",
              color: "orange",
              product_count: 1,
            },
          ]
        : [row],
    )) as typeof fetch);
  assert.equal((await api.categories())[0].slug, "new-tools");
  assert.equal((await api.product("real-tool"))?.name, "Real Tool");
  assert.equal(await api.product("../secret"), undefined);
});
