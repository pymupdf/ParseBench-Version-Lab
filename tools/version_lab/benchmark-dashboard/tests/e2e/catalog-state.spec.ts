import { expect, test } from "@playwright/test";

test("an empty catalog resolves scores and reports its actual zero count", async ({
  page,
}) => {
  await page.route("**/rest/v1/benchmark_runs?**", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.goto("/workflows");

  await expect(page.locator(".catalog-empty")).toBeVisible();
  await expect(page.locator(".history-reading strong")).toHaveText("—");
  await expect(page.locator(".history-caption")).toContainText(
    "0 recent eligible runs",
  );
  await expect(page.locator(".library-index-status")).toContainText(
    "0 indexed runs",
  );
  await expect(page.getByText("Loading scores", { exact: true })).toHaveCount(
    0,
  );
});

test("a detail deep link does not claim that the unloaded catalog is empty", async ({
  page,
}) => {
  await page.goto("/workflows/30925196627");

  await expect(page.locator(".score-profile-grid")).toBeVisible();
  await expect(page.locator(".library-index-status")).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Current location" })
      .getByRole("link", { name: "Run library", exact: true }),
  ).toBeVisible();

  await page
    .getByRole("navigation", { name: "Current location" })
    .getByRole("link", { name: "Run library", exact: true })
    .click();
  await expect(page.locator(".workflow-row").first()).toBeVisible();
  await expect(page.locator(".library-index-status")).toHaveText(
    /[1-9][\d,]* indexed runs/,
  );
});
