import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { validateCatalogConfig } from "../catalog-api";
import { authCookieOptions } from "../auth-policy";
import { site } from "../site";
export function authConfigured() {
  try {
    validateCatalogConfig({
      url: process.env.SUPABASE_URL || "",
      key: process.env.SUPABASE_PUBLISHABLE_KEY || "",
    });
    return true;
  } catch {
    return false;
  }
}
export async function createAuthClient() {
  if (!authConfigured()) return null;
  const config = validateCatalogConfig({
    url: process.env.SUPABASE_URL!,
    key: process.env.SUPABASE_PUBLISHABLE_KEY!,
  });
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookieOptions: authCookieOptions(
      site.url,
      process.env.NODE_ENV === "production",
    ),
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          );
        } catch {
          /* Server Components: the proxy owns refresh cookies. */
        }
      },
    },
  });
}
export const getIdentity = cache(async () => {
  await connection();
  const client = await createAuthClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  return error || !data.user || !data.user.email_confirmed_at
    ? null
    : { client, user: data.user };
});
export async function requireIdentity() {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  return identity;
}
export async function requireAdmin() {
  const identity = await requireIdentity();
  const { data, error } = await identity.client
    .from("user_roles")
    .select("role")
    .eq("user_id", identity.user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) redirect("/dashboard?notice=admin-required");
  return identity;
}
