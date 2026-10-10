"use server";
import { redirect } from "next/navigation";
import { createAuthClient } from "@/lib/supabase/server";
import { site } from "@/lib/site";
import { parseAuthInput, authErrorMessage } from "@/lib/auth-policy";
export type AuthState = { error?: string; message?: string };
export async function authenticate(
  _previous: AuthState,
  form: FormData,
): Promise<AuthState> {
  const input = parseAuthInput(form);
  if ("error" in input) return input;
  const { mode, email, password, name } = input;
  try {
    const client = await createAuthClient();
    if (!client)
      return {
        error:
          "Account access is unavailable until LOGSPOLL is connected to Supabase.",
      };
    if (mode === "forgot") {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: `${site.url}/auth/callback?next=/account?mode=reset`,
      });
      return error
        ? { error: authErrorMessage(error) }
        : {
            message:
              "If an account exists, you will receive a password reset email.",
          };
    }
    if (mode === "register") {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name },
          emailRedirectTo: `${site.url}/auth/callback`,
        },
      });
      if (error) return { error: authErrorMessage(error) };
      // Only confirmed sessions may continue to the private catalog.
      if (!data.session || !data.user?.email_confirmed_at)
        return {
          message: "Check your email to verify your account before signing in.",
        };
    } else if (mode === "reset") {
      const { data, error: identityError } = await client.auth.getUser();
      if (identityError || !data.user?.email_confirmed_at)
        return {
          error:
            "Open a valid password recovery or invitation link from your email first.",
        };
      const { error } = await client.auth.updateUser({ password });
      return error
        ? { error: authErrorMessage(error) }
        : {
            message: "Password updated. You can now open the private catalog.",
          };
    } else {
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error) return { error: authErrorMessage(error) };
      if (!data.user?.email_confirmed_at) {
        await client.auth.signOut();
        return { error: "Confirm your email address before signing in." };
      }
    }
  } catch {
    return {
      error: "Unable to reach account services. Please try again later.",
    };
  }
  // Next.js redirects throw; keep this outside the provider-error handler.
  redirect("/dashboard");
}
export async function logout() {
  const client = await createAuthClient();
  if (client) {
    const { error } = await client.auth.signOut();
    if (error) throw new Error("Unable to sign out. Please try again.");
  }
  redirect("/login");
}
