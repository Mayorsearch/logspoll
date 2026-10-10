import {
  test,
  expect,
  type BrowserContext,
  type APIRequestContext,
} from "@playwright/test";
test.skip(
  process.env.CATALOG_DATABASE_TEST !== "1",
  "Requires the isolated local PostgreSQL/Auth test bridge.",
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
test("verified customers see database products, filtering, prices, stock and details", async ({
  page,
  request,
  context,
}) => {
  await signIn(context, request);
  await page.goto("/marketplace");
  await expect(page.locator(".catalog-product-grid .product-card")).toHaveCount(
    9,
  );
  await page.getByRole("link", { name: "Page 2", exact: true }).click();
  await expect(page.locator(".catalog-product-grid .product-card")).toHaveCount(
    3,
  );
  await page.goto("/marketplace?category=business-suite&q=Business+Tool+01");
  await expect(page.locator(".catalog-product-grid .product-card")).toHaveCount(
    1,
  );
  await expect(page.locator(".product-price")).toContainText("1,234.56");
  await page.locator(".catalog-product-grid h3 a").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Business Tool 01",
  );
  await expect(page.getByText("Test supplier", { exact: true })).toBeVisible();
  await expect(page.getByText("2 available", { exact: true })).toBeVisible();
  await expect(page.locator(".related-grid .product-card")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "Purchases not available" }),
  ).toBeDisabled();
  await page.goto("/marketplace?availability=out-of-stock");
  await expect(page.locator(".catalog-product-grid h3")).toHaveText(
    "Business Tool 12",
  );
  await page.goto("/marketplace?sort=price-desc&min=3000&max=5000");
  await expect(page.locator(".catalog-product-grid .product-card")).toHaveCount(
    3,
  );
  await expect(page.locator(".catalog-product-grid h3").first()).toHaveText(
    "Business Tool 05",
  );
  const missingProduct = await page.goto("/products/not-in-database");
  await expect(
    page.getByRole("heading", { name: "Let’s find a better place." }),
  ).toBeVisible();
  expect(missingProduct?.status()).toBe(404);
  const missingCategory = await page.goto("/categories/not-in-database");
  expect(missingCategory?.status()).toBe(404);
  await page.goto("/marketplace?sort=price-desc&min=3000&max=5000");
  await expect(page.locator(".catalog-product-grid .product-card")).toHaveCount(
    3,
  );
  await expect(
    page.locator(".catalog-product-grid .product-card").first(),
  ).toBeVisible();
  const metrics = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll("main *")]
      .filter(
        (e) =>
          e.getBoundingClientRect().right >
          document.documentElement.clientWidth + 1,
      )
      .slice(0, 12)
      .map((e) => ({
        tag: e.tagName,
        cls: e.className,
        right: e.getBoundingClientRect().right,
        width: e.getBoundingClientRect().width,
      })),
  }));
  expect(metrics.scroll, JSON.stringify(metrics)).toBeLessThanOrEqual(
    metrics.width,
  );
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `/tmp/logspoll-marketplace-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.goto("/dashboard");
  await expect(page.locator(".account-summary strong")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recent purchases", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `/tmp/logspoll-dashboard-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
});
test("admin creates, edits, deactivates products and adds a category through real SQL", async ({
  page,
  request,
  context,
}) => {
  test.skip(test.info().project.name !== "desktop", "Mutation flow runs once.");
  await signIn(context, request, "admin");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Products");
  const form = page.locator("#product-form");
  await form
    .getByLabel("Product name", { exact: true })
    .fill("Licensed Test Tool");
  await form.getByLabel("Slug", { exact: true }).fill("licensed-test-tool");
  await form.getByLabel("Price (NGN)", { exact: true }).fill("1250.50");
  await form.getByLabel("Available quantity").fill("5");
  await form.getByLabel("Authorized supplier").fill("Approved Supplier");
  await form
    .getByLabel("Description", { exact: true })
    .fill("Licensed business software.");
  await form
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("active");
  await form.getByRole("checkbox").check();
  await form.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Changes saved.", { exact: true })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Licensed Test Tool" });
  await expect(row).toContainText("1,250.5");
  await row.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(
    form.getByRole("heading", { name: "Edit product", exact: true }),
  ).toBeVisible();
  await expect(form.locator('input[name="id"]')).not.toHaveValue("");
  await form.getByLabel("Available quantity").fill("0");
  await form
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("inactive");
  await form.getByRole("button", { name: "Save product" }).click();
  await expect(row).toContainText("inactive");
  const category = page.locator("form").filter({
    has: page.getByRole("heading", { name: "Add category", exact: true }),
  });
  await category.getByLabel("Name", { exact: true }).fill("Licensed Resources");
  await category.getByLabel("Slug", { exact: true }).fill("licensed-resources");
  await category
    .getByRole("button", { name: "Add category", exact: true })
    .click();
  await expect(
    page.locator("option").filter({ hasText: "Licensed Resources" }),
  ).toHaveCount(1);
  await page.screenshot({
    path: "/tmp/logspoll-admin-desktop.png",
    fullPage: true,
  });
});
test("forged sessions cannot unlock the catalog and database failures expose no inventory", async ({
  page,
  request,
  context,
}) => {
  test.skip(test.info().project.name !== "desktop", "Failure flow runs once.");
  await context.addCookies([
    {
      name: "sb-127-auth-token",
      value:
        "base64-" +
        Buffer.from(
          JSON.stringify({
            access_token: "forged",
            refresh_token: "forged",
            user: { id: "admin" },
          }),
        ).toString("base64url"),
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  await page.goto("/marketplace");
  await expect(
    page.getByRole("heading", { name: "Private Catalog", exact: true }),
  ).toBeVisible();
  await signIn(context, request);
  await request.get("http://127.0.0.1:3101/__test/failure?enabled=true");
  try {
    await page.goto("/marketplace");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.locator(".product-card")).toHaveCount(0);
    expect(await page.locator("body").textContent()).not.toContain(
      "private provider diagnostics",
    );
  } finally {
    await request.get("http://127.0.0.1:3101/__test/failure?enabled=false");
  }
});
