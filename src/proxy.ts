import { validateCatalogConfig } from "@/lib/catalog-api";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authCookieOptions } from "@/lib/auth-policy";
import { site } from "@/lib/site";
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;
  try {
    validateCatalogConfig({ url, key });
  } catch {
    return response;
  }
  const client = createServerClient(url, key, {
    cookieOptions: authCookieOptions(
      site.url,
      process.env.NODE_ENV === "production",
    ),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  await client.auth.getUser();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: [
    "/account",
    "/login",
    "/signup",
    "/auth/:path*",
    "/dashboard/:path*",
    "/admin/:path*",
    "/marketplace/:path*",
    "/products/:path*",
    "/categories/:path*",
  ],
};
