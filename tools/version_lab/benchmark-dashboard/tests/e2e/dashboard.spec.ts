import { expect, test } from "@playwright/test";

const RUN_ID = "30925196627";

test("finds workflows by commit and opens a selected run", async ({ page }) => {
  await page.goto(`/?run=${RUN_ID}&view=runs`);

  await expect(page.getByRole("heading", { name: "Find the benchmark run you need" })).toBeVisible();
  await page.getByPlaceholder("Search ID, commit, branch, pipeline, name…").fill("754c3ca2");
  await expect(page.locator(".workflow-row").first()).toContainText("754c3ca2");

  await page.locator(".workflow-row").first().click();
  await expect(page).toHaveURL(/view=overview/);
  await expect(page.getByRole("heading", { name: /Pymupdf4llm/i }).first()).toBeVisible();
});

test("mobile document browsing uses a focused list-to-detail flow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?run=${RUN_ID}&view=documents`);

  const firstDocument = page.locator(".document-row").first();
  await expect(firstDocument).toBeVisible();
  await firstDocument.click();

  await expect(page.getByRole("button", { name: "Back to documents" })).toBeVisible();
  await expect(page.locator(".pdf-card")).toBeVisible();
  await page.getByRole("button", { name: "Parsed output" }).click();
  await expect(page.locator(".output-card")).toBeVisible();
  await expect(page.locator(".pdf-card")).toBeHidden();
});
