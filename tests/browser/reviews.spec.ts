import {
  test,
  expect,
  type BrowserContext,
  type APIRequestContext,
} from "@playwright/test";
test.skip(
  process.env.CATALOG_DATABASE_TEST !== "1",
  "Requires isolated real SQL/RLS test infrastructure.",
);
async function session(
  context: BrowserContext,
  request: APIRequestContext,
  role = "customer",
) {
  const response = await request.get(
    `http://127.0.0.1:3101/__test/session?role=${role}`,
  );
  const cookie = await response.json();
  await context.addCookies([{ ...cookie, url: "http://127.0.0.1:3100" }]);
}
test("completed purchase review is private until approval and can be rejected again", async ({
  page,
  context,
  request,
}) => {
  test.skip(test.info().project.name !== "desktop", "Mutation flow runs once.");
  await session(context, request);
  await page.goto("/dashboard/purchases/20000000-0000-4000-8000-000000000003");
  await expect(page.getByRole("button", { name: "Submit review" })).toHaveCount(
    0,
  );
  await page.goto("/dashboard/purchases/20000000-0000-4000-8000-000000000001");
  await page
    .getByLabel("Public display name")
    .fill("Isolated SQL Test Reviewer");
  await page.getByLabel("City or state in Nigeria (optional)").fill("Lagos");
  await page.getByLabel("Star rating").selectOption("4");
  await page
    .getByLabel("Your feedback")
    .fill(
      "Isolated browser test feedback; this is never a real customer testimonial.",
    );
  await page.getByRole("button", { name: "Submit review" }).click();
  await expect(page.locator(".access-item")).toContainText(
    /awaiting moderation|Your review: pending/,
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Submit review" })).toHaveCount(
    0,
  );
  await page.goto("/");
  await expect(page.locator(".review-card")).toHaveCount(0);
  await page.goto("/admin/reviews");
  await expect(page).toHaveURL(/\/dashboard/);
  await session(context, request, "admin");
  await page.goto("/admin/reviews");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    page.getByText("Review moderation saved.", { exact: true }),
  ).toBeVisible();
  await context.clearCookies();
  await page.goto("/");
  await expect(page.locator(".review-card")).toHaveCount(1);
  await expect(page.locator(".review-card")).toContainText(
    "Isolated SQL Test Reviewer",
  );
  await expect(page.locator(".review-card")).toContainText("Verified Purchase");
  await expect(page.locator(".review-card")).toContainText("Lagos");
  await expect(page.locator(".review-stars")).toHaveAttribute(
    "aria-label",
    "4 out of 5 stars",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/logspoll-reviews-mobile.png",
    fullPage: true,
    scale: "css",
  });
  await session(context, request, "admin");
  await page.goto("/admin/reviews?status=approved");
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(
    page.getByText("Review moderation saved.", { exact: true }),
  ).toBeVisible();
  await context.clearCookies();
  await page.goto("/");
  await expect(page.locator(".review-card")).toHaveCount(0);
});
