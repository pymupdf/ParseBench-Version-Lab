import { expect, test } from "@playwright/test";

const RUN_ID = "30925196627";

test("finds workflows by commit and opens a selected run", async ({ page }) => {
  await page.goto(`/?run=${RUN_ID}&view=runs`);

  await expect(page.getByRole("heading", { name: "Find the benchmark run you need" })).toBeVisible();
  await expect(page.locator(".score-leader-card")).toHaveCount(6);
  await expect(
    page.getByText("Quick runs are excluded. Full-dataset runs compete only in the dimensions they completely evaluated."),
  ).toBeVisible();
  await page.getByPlaceholder("Search ID, commit, branch, pipeline, name…").fill("754c3ca2");
  await expect(page.locator(".workflow-row").first()).toContainText("754c3ca2");
  await expect(page.locator(".workflow-aggregate").first()).toContainText("%");
  await expect(page.locator(".workflow-dimension-scores").first().locator(":scope > span")).toHaveCount(5);

  await page.locator(".workflow-row").first().click();
  await expect(page).toHaveURL(new RegExp(`/workflows/${RUN_ID}$`));
  await expect(page.getByRole("heading", { name: /Pymupdf4llm/i }).first()).toBeVisible();
});

test("reopening the selected workflow preserves its evaluation data", async ({ page }) => {
  await page.goto(`/?run=${RUN_ID}&view=overview`);

  await expect(page.locator(".score-profile-grid")).toBeVisible();
  const evaluationCount = await page.locator(".score-profile-grid > *").count();
  expect(evaluationCount).toBeGreaterThan(0);

  await page.getByRole("link", { name: "Workflows", exact: true }).click();
  await expect(page).toHaveURL(/\/workflows$/);
  await page.getByRole("button", { name: "Show run IDs" }).click();
  const workflow = page.locator(".workflow-row").filter({ hasText: `#${RUN_ID}` });
  await expect(workflow).toHaveCount(1);
  await workflow.click();

  await expect(page).toHaveURL(new RegExp(`/workflows/${RUN_ID}$`));
  await expect(page.locator(".score-profile-grid > *")).toHaveCount(evaluationCount);
  await expect(page.getByText("No evaluation reports")).toHaveCount(0);
});

test("opens the workflow behind a leading benchmark score", async ({ page }) => {
  await page.goto("/?view=runs");

  const aggregateLeader = page.getByRole("button", { name: /Open Aggregate leader/ });
  await expect(aggregateLeader).toContainText(/\d+(?:\.\d{1,2})?%/);
  await expect(aggregateLeader).toContainText(/Run #\d+/);
  await aggregateLeader.click();

  await expect(page).toHaveURL(/\/workflows\/\d+$/);
  await expect(page.locator(".run-meta")).toContainText("Full · All");
  await expect(page.locator(".score-profile-grid")).toBeVisible();
});

test("mobile triage browsing uses a focused grid-to-detail flow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?run=${RUN_ID}&view=documents`);

  await expect(page).toHaveURL(new RegExp(`/workflows/${RUN_ID}/triage`));
  const firstDocument = page.locator(".triage-card").first();
  await expect(firstDocument).toBeVisible();
  await firstDocument.click();

  await expect(page).toHaveURL(new RegExp(`/workflows/${RUN_ID}/triage/\\d+`));
  await expect(page.getByRole("link", { name: "Back to triage queue" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Browse queue" })).toBeVisible();
  await expect(page.locator(".pdf-card")).toBeVisible();
  await page.getByRole("button", { name: "Parsed output" }).click();
  await expect(page.locator(".output-card")).toBeVisible();
  await expect(page.locator(".pdf-card")).toBeHidden();
});
