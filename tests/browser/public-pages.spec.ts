import { test, expect } from "@playwright/test";

test("footer links lead to complete public pages without revealing inventory", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer).toBeVisible();
  await expect(
    footer.getByRole("heading", { name: "Your digital world starts here." }),
  ).toBeVisible();
  const hrefs = await footer
    .locator("a")
    .evaluateAll((links) => [
      ...new Set(links.map((link) => link.getAttribute("href")!)),
    ]);
  for (const href of hrefs.filter(
    (href) => href.startsWith("/") && href !== "/marketplace",
  )) {
    const response = await request.get(href);
    expect(response.status(), href).toBe(200);
  }
  await footer.getByRole("link", { name: "How it works", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A simple start. More possibilities.",
  );
  await expect(page.locator(".guide-steps article")).toHaveCount(3);
  await page
    .getByRole("contentinfo")
    .getByRole("link", { name: "Service categories", exact: true })
    .click();
  await expect(
    page.locator(".public-category-section .category-card"),
  ).toHaveCount(10);
  await page.locator(".public-category-section .category-card").first().click();
  await expect(
    page.getByRole("heading", { name: "Private Catalog", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".product-card")).toHaveCount(0);
  await page
    .getByRole("contentinfo")
    .getByRole("link", { name: "Frequently asked questions", exact: true })
    .click();
  await page
    .getByText("How do I access the private catalog?", { exact: true })
    .click();
  await expect(
    page.getByText("Create an account with your own email address", {
      exact: false,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: `/tmp/logspoll-support-finished-${test.info().project.name}.png`,
    fullPage: true,
    scale: "css",
  });
  await page.goto("/");
  await expect(page.locator(".reference-art")).toHaveJSProperty(
    "complete",
    true,
  );
  await footer.screenshot({
    path: `/tmp/logspoll-footer-${test.info().project.name}.png`,
    scale: "css",
  });
  await footer.getByRole("link", { name: "Back to top" }).click();
  await expect(page).toHaveURL(/#main-content$/);
});

test("completed public pages and footer fit phone and tablet widths", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Viewport matrix runs once.");
  for (const width of [360, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      "/categories",
      "/support",
      "/how-it-works",
      "/privacy",
      "/guidelines",
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("contentinfo")).toBeVisible();
      const dimensions = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scroll, `${path} at ${width}px`).toBeLessThanOrEqual(
        dimensions.width,
      );
    }
  }
});
