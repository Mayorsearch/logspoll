import { test, expect } from "@playwright/test";
test.skip(
  process.env.CATALOG_DATABASE_TEST === "1",
  "This checks the real app's unconfigured state, without simulated authentication.",
);
test("authentication forms and invalid email links fail safely without a configured backend", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "minlength",
    "1",
  );
  await expect(
    page.getByRole("button", { name: "Login", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Account access is not configured yet.", { exact: false }),
  ).toBeVisible();
  await page.goto("/signup");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "minlength",
    "12",
  );
  await expect(page.getByLabel("Full Name")).toBeVisible();
  await page.goto("/account?mode=reset");
  await expect(
    page.getByRole("heading", { name: "Choose a New Password" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email Address")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Update password" }),
  ).toBeDisabled();
  // Prevent following the configured canonical redirect onto another test-server port.
  const response = await page.request.get(
    "/auth/callback?token_hash=invalid&type=invite&next=https://evil.example",
    { maxRedirects: 0 },
  );
  expect(response.status()).toBe(307);
  expect(response.headers().location).toMatch(
    /^http:\/\/127\.0\.0\.1:3000\/login\?error=verification$/,
  );
  expect(response.headers()["cache-control"]).toContain("no-store");
});
