import {
  test,
  expect,
  type BrowserContext,
  type APIRequestContext,
} from "@playwright/test";
test.skip(
  process.env.CATALOG_DATABASE_TEST !== "1",
  "Requires isolated local test database.",
);
async function signIn(
  context: BrowserContext,
  request: APIRequestContext,
  role = "customer",
) {
  const cookie = await (
    await request.get(`http://127.0.0.1:3101/__test/session?role=${role}`)
  ).json();
  await context.addCookies([
    { ...cookie, domain: "127.0.0.1", path: "/", httpOnly: true },
  ]);
}
const delivered = "20000000-0000-4000-8000-000000000001",
  pending = "20000000-0000-4000-8000-000000000002",
  unpaid = "20000000-0000-4000-8000-000000000003",
  foreign = "20000000-0000-4000-8000-000000000004";
test("customer panel has private purchase history, profile, wallet state and notifications", async ({
  page,
  context,
  request,
}) => {
  await signIn(context, request);
  await page.goto("/dashboard/purchases");
  await expect(
    page.getByRole("heading", { name: "All Purchases" }),
  ).toBeVisible();
  await expect(page.locator(".purchase-card")).toHaveCount(3);
  await expect(page.getByText("LOCAL-TEST-004", { exact: false })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: `/tmp/logspoll-purchases-${test.info().project.name}.png`,
    fullPage: true,
    scale: "css",
  });
  await page.goto(`/dashboard/purchases/${delivered}`);
  await expect(page.locator(".access-item pre")).toContainText(
    "TEST LICENSE ONLY",
  );
  await page.goto(`/dashboard/purchases/${unpaid}`);
  await expect(page.locator(".access-item pre")).toHaveCount(0);
  const denied = await page.goto(`/dashboard/purchases/${foreign}`);
  expect(denied?.status()).toBe(404);
  await page.goto("/dashboard/profile");
  await page
    .getByRole("textbox", { name: "Full Name", exact: true })
    .fill("Updated Test Customer");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText("Profile updated.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Full Name", exact: true }),
  ).toHaveValue("Updated Test Customer");
  await page.goto("/dashboard/wallet");
  await expect(
    page.getByRole("button", { name: "Funding unavailable" }),
  ).toBeDisabled();
  await expect(page.locator("body")).not.toContainText("₦48,782");
  await page.goto("/dashboard/notifications");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Notifications",
  );
  const metrics = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.width);
  for (const path of [
    "/admin/overview",
    "/admin/orders",
    "/admin/categories",
    "/admin/audit",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/dashboard/);
  }
});
test("admin reviews orders, delivers once, edits categories and audits changes", async ({
  page,
  context,
  request,
}) => {
  test.skip(test.info().project.name !== "desktop", "Mutation flow runs once.");
  await signIn(context, request, "admin");
  await page.goto("/admin/overview");
  await expect(
    page.getByRole("heading", { name: "Admin overview" }),
  ).toBeVisible();
  await page.goto(`/admin/orders/${unpaid}`);
  await expect(page.getByRole("button", { name: "Deliver order" })).toHaveCount(
    0,
  );
  await page.goto(`/admin/orders/${pending}`);
  await page
    .getByLabel("Authorized license / activation instructions")
    .fill("AUTHORIZED LOCAL TEST DELIVERY - not a real license");
  await page.getByRole("button", { name: "Deliver order" }).click();
  await expect(
    page.getByText(
      "Order delivered. The customer can now view their private instructions.",
    ),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Deliver order" })).toHaveCount(
    0,
  );
  await page.goto("/admin/categories");
  await page
    .getByRole("row")
    .filter({ hasText: "Business Tools" })
    .getByRole("link", { name: "Edit category" })
    .click();
  await page
    .locator("#category-form")
    .getByLabel("Name", { exact: true })
    .fill("Licensed Business Tools");
  await page.getByRole("button", { name: "Save category" }).click();
  await expect(
    page.getByText("Category saved.", { exact: true }),
  ).toBeVisible();
  await page.goto("/admin/audit");
  await expect(page.getByRole("table")).toContainText("UPDATE");
  await page.screenshot({
    path: "/tmp/logspoll-admin-panels.png",
    fullPage: true,
    scale: "css",
  });
  await signIn(context, request);
  await page.goto(`/dashboard/purchases/${pending}`);
  await expect(page.locator(".access-item pre")).toContainText(
    "AUTHORIZED LOCAL TEST DELIVERY",
  );
  await page.goto("/dashboard/notifications");
  await expect(
    page.getByRole("heading", { name: "Your order is ready" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(
    page.getByRole("button", { name: "Mark all as read" }),
  ).toHaveCount(0);
});
