import { NextResponse, type NextRequest } from "next/server";
import { createAuthClient } from "@/lib/supabase/server";
import { authCallbackDestination } from "@/lib/auth-policy";
import { site } from "@/lib/site";
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code"),
    token_hash = params.get("token_hash"),
    type = params.get("type");
  try {
    const client = await createAuthClient();
    if (client) {
      // Token-hash links also work for invitations opened in a different browser.
      const result = code
        ? await client.auth.exchangeCodeForSession(code)
        : token_hash &&
            (type === "signup" || type === "recovery" || type === "invite")
          ? await client.auth.verifyOtp({ token_hash, type })
          : null;
      if (result && !result.error) {
        const response = NextResponse.redirect(
          new URL(
            authCallbackDestination(code ? null : type, params.get("next")),
            site.url,
          ),
        );
        response.headers.set("Cache-Control", "private, no-store");
        return response;
      }
    }
  } catch {
    /* Never expose provider errors or one-time verification tokens. */
  }
  const response = NextResponse.redirect(
    new URL("/login?error=verification", site.url),
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
