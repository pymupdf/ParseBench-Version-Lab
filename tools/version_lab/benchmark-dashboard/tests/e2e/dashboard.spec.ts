import { expect, test } from "@playwright/test";

const RUN_ID = "30925196627";

test("finds workflows by commit and opens a selected run", async ({ page }) => {
  await page.goto(`/?run=${RUN_ID}&view=runs`);

  await expect(page.getByRole("heading", { name: "Find the benchmark run you need" })).toBeVisible();
  await expect(page.locator(".score-leader-card")).toHaveCount(6);
  await expect(page.getByText("Only full runs across all document groups are eligible.")).toBeVisible();
  await page.getByPlaceholder("Search ID, commit, branch, pipeline, name…").fill("754c3ca2");
  await expect(page.locator(".workflow-row").first()).toContainText("754c3ca2");
  await expect(page.locator(".workflow-aggregate").first()).toContainText("%");
  await expect(page.locator(".workflow-dimension-scores").first().locator(":scope > span")).toHaveCount(5);

  await page.locator(".workflow-row").first().click();
  await expect(page).toHaveURL(/view=overview/);
  await expect(page.getByRole("heading", { name: /Pymupdf4llm/i }).first()).toBeVisible();
});

test("reopening the selected workflow preserves its evaluation data", async ({ page }) => {
  await page.goto(`/?run=${RUN_ID}&view=overview`);

  await expect(page.locator(".dimension-grid")).toBeVisible();
  const evaluationCount = await page.locator(".dimension-grid > *").count();
  expect(evaluationCount).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  const selectedWorkflow = page.locator(".workflow-row-selected");
  await expect(selectedWorkflow.locator(".workflow-run-id")).toHaveCount(0);
  await page.getByRole("button", { name: "Show run IDs" }).click();
  await expect(selectedWorkflow).toContainText(`#${RUN_ID}`);
  await selectedWorkflow.click();

  await expect(page).toHaveURL(/view=overview/);
  await expect(page.locator(".dimension-grid > *")).toHaveCount(evaluationCount);
  await expect(page.getByText("No evaluation reports")).toHaveCount(0);
});

test("opens the workflow behind a leading benchmark score", async ({ page }) => {
  await page.goto("/?view=runs");

  const aggregateLeader = page.getByRole("button", { name: /Open Aggregate leader/ });
  await expect(aggregateLeader).toContainText(/\d+\.\d%/);
  await expect(aggregateLeader).toContainText(/Run #\d+/);
  await aggregateLeader.click();

  await expect(page).toHaveURL(/view=overview/);
  await expect(page.locator(".run-meta")).toContainText("Full · All");
  await expect(page.locator(".dimension-grid")).toBeVisible();
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
