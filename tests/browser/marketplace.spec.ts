import { test, expect } from "@playwright/test";
test("public homepage matches the private signup flow without exposing inventory", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Access a Private",
  );
  await expect(page.locator(".category-card")).toHaveCount(4);
  await expect(page.locator(".reference-art")).toBeVisible();
  await expect(page.locator(".reference-art")).toHaveJSProperty(
    "complete",
    true,
  );
  expect(
    await page
      .locator(".reference-art")
      .evaluate((image: HTMLImageElement) => image.naturalWidth > 0),
  ).toBe(true);
  await expect(page.locator(".product-card")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "What Our Customers Are Saying" }),
  ).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".reference-art")
      .evaluate((element) => ({
        motion: getComputedStyle(element).animationName,
        pointerEvents: getComputedStyle(element).pointerEvents,
      })),
  ).toEqual({ motion: "none", pointerEvents: "none" });
  expect(await page.locator("body").textContent()).not.toMatch(
    /₦|PrivateLink|Sample catalog/,
  );
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `/tmp/logspoll-home-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("link", {
      name: "Create Account to Access Catalog",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Create Your Account" }),
  ).toBeVisible();
  await expect(page.getByLabel("Full Name")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign Up", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: `/tmp/logspoll-signup-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test("guests cannot access product details, prices or private dashboards", async ({
  page,
  request,
}) => {
  for (const path of [
    "/marketplace",
    "/products/privatelink-vpn",
    "/products/anything",
    "/categories/vpn-services",
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "Private Catalog", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".product-card")).toHaveCount(0);
    expect(await page.locator("body").textContent()).not.toMatch(
      /₦|8,500|PrivateLink/,
    );
  }
  await page.screenshot({
    path: `/tmp/logspoll-locked-${test.info().project.name}.png`,
    fullPage: true,
  });
  for (const path of ["/dashboard", "/admin"]) {
    const r = await request.get(path, { maxRedirects: 0 });
    expect(r.status()).toBe(307);
    expect(r.headers().location).toContain("/login");
  }
  const response = await request.get("/products/anything");
  expect(await response.text()).toContain("noindex");
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Welcome Back" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Login", exact: true }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(
    page.getByRole("heading", { name: "Reset Your Password" }),
  ).toBeVisible();
});
test("public pages fit tablet and phone widths; sitemap contains no private listings", async ({
  page,
  request,
}, info) => {
  test.skip(info.project.name !== "desktop", "Viewport matrix runs once.");
  for (const width of [360, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/signup", "/login", "/marketplace"]) {
      await page.goto(path);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
        `${path} at ${width}`,
      ).toBe(true);
    }
  }
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).not.toContain("/products/");
  expect(sitemap).not.toContain("/marketplace");
});
