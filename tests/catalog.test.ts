import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFilters, catalogHref, formatPrice } from "../src/lib/catalog.ts";
import { categories } from "../src/lib/categories.ts";
test("filters normalize malformed input, new category slugs and legacy bookmarks", () => {
  assert.equal(categories.length, 10);
  const filters = parseFilters({
    q: ["  VPN  ", "ignored"],
    min: "-1",
    max: "Infinity",
    page: "NaN",
    category: "fake",
    availability: "other",
    sort: "DROP TABLE",
  });
  assert.deepEqual(filters, {
    q: "VPN",
    min: "",
    max: "",
    page: 1,
    category: "",
    availability: "",
    sort: "featured",
  });
  assert.equal(parseFilters({ q: "x".repeat(200) }).q.length, 120);
  assert.equal(
    parseFilters({ category: "new-tools" }, ["new-tools"]).category,
    "new-tools",
  );
  assert.equal(
    parseFilters({ category: "vpn-privacy" }).category,
    "vpn-services",
  );
  assert.equal(parseFilters({ page: "999999" }).page, 10000);
});
test("filter URLs round-trip special characters and currency preserves minor units", () => {
  const filters = parseFilters({
    q: "A & B + C",
    category: "vpn-services",
    min: "0",
    max: "9000",
    sort: "price-asc",
    availability: "in-stock",
    page: "2",
  });
  assert.deepEqual(
    parseFilters(
      Object.fromEntries(
        new URL(catalogHref(filters), "https://example.com").searchParams,
      ),
    ),
    filters,
  );
  assert.equal(catalogHref({ page: 1, sort: "featured" }), "/marketplace");
  assert.match(formatPrice(1234.56), /1,234\.56/);
  assert.match(formatPrice(8500), /8,500$/);
});
