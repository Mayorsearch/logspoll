import "server-only";
import { cache } from "react";
import { parseFilters, type SearchParams } from "./catalog";
import { createCatalogApi, CatalogConnectionError } from "./catalog-api";
import { requireIdentity } from "./supabase/server";
const privateApi = cache(async () => {
  const { client } = await requireIdentity();
  // getUser in requireIdentity verifies the user before reading its session token.
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new CatalogConnectionError();
  return createCatalogApi(
    {
      url: process.env.SUPABASE_URL!,
      key: process.env.SUPABASE_PUBLISHABLE_KEY!,
    },
    fetch,
    data.session.access_token,
  );
});
export const getStorefront = cache(async () => {
  const categories = await (await privateApi()).categories();
  return {
    mode: "supabase" as const,
    categories,
    total: categories.reduce((sum, c) => sum + c.productCount, 0),
  };
});
export async function loadCatalog(params: SearchParams) {
  const storefront = await getStorefront();
  const filters = parseFilters(
    params,
    storefront.categories.map((c) => c.slug),
  );
  return {
    storefront,
    filters,
    result: await (await privateApi()).search(filters),
  };
}
export const loadProduct = cache(async (slug: string) =>
  (await privateApi()).product(slug),
);
export async function loadCategory(slug: string) {
  return (await getStorefront()).categories.find((c) => c.slug === slug);
}
