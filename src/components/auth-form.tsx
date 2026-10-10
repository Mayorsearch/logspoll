"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, UserRound, Mail, LockKeyhole } from "lucide-react";
import { authenticate, type AuthState } from "@/app/account/actions";
export function AuthForm({
  mode,
  configured,
}: {
  mode: string;
  configured: boolean;
}) {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    authenticate,
    {},
  );
  const [visible, setVisible] = useState(false);
  const register = mode === "register",
    forgot = mode === "forgot",
    reset = mode === "reset";
  return (
    <form action={action} className="auth-form">
      <input type="hidden" name="mode" value={mode} />
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {state.message && (
        <p className="form-message" role="status">
          {state.message}
        </p>
      )}
      <fieldset disabled={!configured || pending}>
        {register && (
          <label>
            Full Name
            <span className="auth-input">
              <UserRound size={17} />
              <input
                name="fullName"
                autoComplete="name"
                placeholder="Enter your full name"
                required
                minLength={2}
                maxLength={120}
              />
            </span>
          </label>
        )}
        {!reset && (
          <label>
            Email Address
            <span className="auth-input">
              <Mail size={17} />
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
                maxLength={254}
              />
            </span>
          </label>
        )}
        {!forgot && (
          <>
            <label>
              Password
              <span className="auth-input">
                <LockKeyhole size={17} />
                <input
                  name="password"
                  type={visible ? "text" : "password"}
                  autoComplete={
                    register || reset ? "new-password" : "current-password"
                  }
                  placeholder={
                    register ? "Create a password" : "Enter your password"
                  }
                  required
                  minLength={register || reset ? 12 : 1}
                  maxLength={128}
                />
                <button
                  type="button"
                  aria-label={visible ? "Hide password" : "Show password"}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </label>
            {(register || reset) && (
              <label>
                Confirm Password
                <span className="auth-input">
                  <LockKeyhole size={17} />
                  <input
                    name="confirmPassword"
                    type={visible ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Confirm your password"
                    required
                    minLength={12}
                    maxLength={128}
                  />
                  <button
                    type="button"
                    aria-label={
                      visible
                        ? "Hide confirmed password"
                        : "Show confirmed password"
                    }
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </span>
              </label>
            )}
          </>
        )}
        <button className="button button-orange" type="submit">
          {pending
            ? "Please wait…"
            : register
              ? "Sign Up"
              : forgot
                ? "Send recovery email"
                : reset
                  ? "Update password"
                  : "Login"}
        </button>
      </fieldset>
      {!register && !forgot && !reset && (
        <Link href="/account?mode=forgot" className="text-link">
          Forgot password?
        </Link>
      )}
      <div className="auth-divider">
        <span>OR</span>
      </div>
      <p className="auth-switch">
        {register ? "Already have an account?" : "New to LOGSPOLL?"}{" "}
        <Link href={register ? "/login" : "/signup"}>
          {register ? "Login" : "Create an account"}
        </Link>
      </p>
      {!configured && (
        <p className="form-message configuration-notice" role="status">
          Account access is not configured yet. Registration and login will be
          available once Supabase is connected.
        </p>
      )}
    </form>
  );
}
