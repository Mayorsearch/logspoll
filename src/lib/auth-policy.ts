export type AuthMode = "login" | "register" | "forgot" | "reset";
export type AuthInput = {
  mode: AuthMode;
  email: string;
  password: string;
  name: string;
};
export function parseAuthInput(form: FormData): AuthInput | { error: string } {
  const mode = String(form.get("mode"));
  if (!["login", "register", "forgot", "reset"].includes(mode))
    return { error: "Choose a valid account action." };
  const email = String(form.get("email") || "").trim();
  const password = String(form.get("password") || "");
  const name = String(form.get("fullName") || "").trim();
  if (
    mode !== "reset" &&
    (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
  )
    return { error: "Enter a valid email address." };
  if (mode !== "forgot") {
    const minimum = mode === "login" ? 1 : 12;
    if (password.length < minimum || password.length > 128)
      return {
        error:
          mode === "login"
            ? "Enter your password (up to 128 characters)."
            : "Use a password between 12 and 128 characters.",
      };
    if (
      (mode === "register" || mode === "reset") &&
      password !== String(form.get("confirmPassword"))
    )
      return { error: "Passwords must match." };
  }
  if (mode === "register" && (name.length < 2 || name.length > 120))
    return { error: "Enter your full name (2–120 characters)." };
  return { mode: mode as AuthMode, email, password, name };
}
export function authErrorMessage(error: { code?: string; status?: number }) {
  if (
    error.status === 429 ||
    ["over_request_rate_limit", "over_email_send_rate_limit"].includes(
      error.code || "",
    )
  )
    return "Too many attempts. Wait a few minutes before trying again.";
  if (error.code === "email_not_confirmed")
    return "Confirm your email address before signing in. Check your inbox and spam folder.";
  if (error.code === "weak_password")
    return "Choose a stronger password with at least 12 characters.";
  if (error.code === "signup_disabled")
    return "Registration is currently closed. Please contact support.";
  if (error.code === "email_provider_disabled")
    return "Email sign-in is unavailable. Please contact support.";
  if (error.code === "invalid_credentials")
    return "Unable to sign in. Check your email and password.";
  return "Account access could not be completed. Please try again later.";
}
export function authCookieOptions(siteUrl: string, production: boolean) {
  let localHttp = false;
  try {
    const url = new URL(siteUrl);
    localHttp =
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (url.protocol === "https:")
      return { httpOnly: true, sameSite: "lax" as const, secure: true };
  } catch {
    /* Invalid production configuration must not weaken cookies. */
  }
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: production && !localHttp,
  };
}
export function authCallbackDestination(
  type: string | null,
  next: string | null,
) {
  return type === "recovery" ||
    type === "invite" ||
    next === "/account?mode=reset"
    ? "/account?mode=reset"
    : "/dashboard";
}
