import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, Zap, Headphones } from "lucide-react";
import { AuthForm } from "@/components/auth-form";
import { authConfigured } from "@/lib/supabase/server";
export const metadata: Metadata = {
  title: "Account Access",
  robots: { index: false, follow: false },
};
export default async function Account({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; error?: string }>;
}) {
  const params = await searchParams,
    mode = ["register", "forgot", "reset"].includes(params.mode || "")
      ? params.mode!
      : "login";
  return (
    <section className="reference-page auth-page">
      <div className="auth-heading">
        <h1>
          {mode === "register"
            ? "Create Your Account"
            : mode === "forgot"
              ? "Reset Your Password"
              : mode === "reset"
                ? "Choose a New Password"
                : "Welcome Back"}
        </h1>
        <p>
          {mode === "register"
            ? "Sign up to access the private catalog and start ordering digital services."
            : mode === "forgot"
              ? "Enter your email address to request a password recovery link."
              : mode === "reset"
                ? "Choose a strong password for your verified account."
                : "Sign in to manage your account and access the private catalog."}
        </p>
      </div>
      <div className="auth-tabs" aria-label="Account access">
        <Link
          href="/signup"
          className={mode === "register" ? "selected" : ""}
          aria-current={mode === "register" ? "page" : undefined}
        >
          Sign Up
        </Link>
        <Link
          href="/login"
          className={mode === "login" ? "selected" : ""}
          aria-current={mode === "login" ? "page" : undefined}
        >
          Login
        </Link>
      </div>
      <div className="auth-card">
        {params.error && (
          <p role="alert" className="form-error">
            The verification link could not be completed. Please request a new
            link.
          </p>
        )}
        <AuthForm mode={mode} configured={authConfigured()} />
      </div>
      <div className="auth-benefits">
        {[
          [Zap, "Fast Access", "Get started quickly"],
          [ShieldCheck, "Secure & Private", "Account-only catalog"],
          [Headphones, "Support", "We're here to help"],
        ].map(([Icon, label, description]) => {
          const Component = Icon as typeof Zap;
          return (
            <div key={String(label)}>
              <Component size={21} />
              <strong>{String(label)}</strong>
              <span>{String(description)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
