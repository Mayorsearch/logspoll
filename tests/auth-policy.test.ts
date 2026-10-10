import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAuthInput,
  authCookieOptions,
  authCallbackDestination,
  authErrorMessage,
} from "../src/lib/auth-policy.ts";
function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
test("recovery uses the verified session identity; login permits existing short passwords", () => {
  assert.ok(
    !(
      "error" in
      parseAuthInput(
        form({
          mode: "reset",
          password: "New secure password!",
          confirmPassword: "New secure password!",
        }),
      )
    ),
  );
  assert.ok(
    !(
      "error" in
      parseAuthInput(
        form({ mode: "login", email: "test@example.com", password: "old123" }),
      )
    ),
  );
  const invalidInputs: Record<string, string>[] = [
    { mode: "login", email: "test@example.com", password: "" },
    { mode: "forgot", email: "invalid" },
    {
      mode: "register",
      email: "test@example.com",
      fullName: "Test User",
      password: "old123",
      confirmPassword: "old123",
    },
    {
      mode: "reset",
      password: "New secure password!",
      confirmPassword: "Different password!",
    },
    {
      mode: "admin",
      email: "test@example.com",
      password: "New secure password!",
    },
  ];
  for (const input of invalidInputs)
    assert.ok("error" in parseAuthInput(form(input)));
});
test("HTTPS cookies stay secure and HTTP exceptions are limited to explicit loopback origins", () => {
  for (const production of [true, false]) {
    assert.deepEqual(
      authCookieOptions("https://staging.example.com", production),
      { httpOnly: true, sameSite: "lax", secure: true },
    );
    assert.equal(
      authCookieOptions("http://127.0.0.1:3000", production).secure,
      false,
    );
  }
  for (const url of [
    "http://example.com",
    "http://localhost.example.com",
    "invalid",
  ])
    assert.equal(authCookieOptions(url, true).secure, true);
});
test("callback redirects only to internal dashboard or password setup paths", () => {
  for (const next of ["https://evil.example", "//evil.example", "/admin", null])
    assert.equal(authCallbackDestination(null, next), "/dashboard");
  assert.equal(authCallbackDestination("invite", null), "/account?mode=reset");
  assert.equal(
    authCallbackDestination("recovery", null),
    "/account?mode=reset",
  );
  assert.equal(
    authCallbackDestination(null, "/account?mode=reset"),
    "/account?mode=reset",
  );
});
test("provider errors explain confirmation and rate limits without exposing raw details", () => {
  assert.match(authErrorMessage({ status: 429 }), /Too many/);
  assert.match(
    authErrorMessage({ code: "email_not_confirmed" }),
    /Confirm your email/,
  );
  assert.match(
    authErrorMessage({ code: "weak_password" }),
    /stronger password/,
  );
  assert.equal(
    authErrorMessage({ code: "private-provider-detail" }),
    "Account access could not be completed. Please try again later.",
  );
});
