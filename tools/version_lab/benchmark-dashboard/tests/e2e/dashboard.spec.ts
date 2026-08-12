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
  await page.getByRole("button", { name: "Analysis" }).click();
  await expect(page.locator(".output-card")).toBeVisible();
  await expect(page.locator(".pdf-card")).toBeHidden();
});

test("keeps passed checks visible for compact diagnostic rule sets", async ({ page }) => {
  await page.goto(`/workflows/${RUN_ID}/triage/38105?dimension=text_formatting&from=triage`);

  const allChecks = page.getByRole("button", { name: "All", exact: true });
  await expect(allChecks).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".diagnostic-rule-row")).toHaveCount(8);
  await expect(page.locator(".diagnostic-rule-row").first()).toBeVisible();
  await expect(page.locator(".diagnostic-status-passed")).toHaveCount(8);
});

test("renders diagnostic count metrics as numbers", async ({ page }) => {
  await page.goto(`/workflows/${RUN_ID}/triage/37099?dimension=layout&from=triage`);
  await page.getByRole("tab", { name: "JSON" }).click();

  const countMetric = page.locator(".diagnostic-json-metric").filter({ hasText: "Num Predictions" });
  await expect(countMetric.locator("summary code")).toHaveText("7");
});

test("reuses the workflow catalog and selected run across navigation", async ({ page }) => {
  const runRequests: string[] = [];
  const dimensionRequests: string[] = [];
  const caseResultRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/rest/v1/benchmark_runs")) {
      runRequests.push(request.url());
    } else if (path.endsWith("/rest/v1/run_dimensions")) {
      dimensionRequests.push(request.url());
    } else if (path.endsWith("/rest/v1/case_results")) {
      caseResultRequests.push(request.url());
    }
  });

  await page.goto("/workflows");
  const firstWorkflow = page.locator(".workflow-row").first();
  await expect(firstWorkflow).toBeVisible();
  await expect(firstWorkflow.locator(".workflow-aggregate strong")).not.toHaveText("…");
  const initialRunRequestCount = runRequests.length;
  const initialDimensionRequestCount = dimensionRequests.length;
  const initialCaseResultRequestCount = caseResultRequests.length;
  await firstWorkflow.click();
  await expect(page).toHaveURL(/\/workflows\/\d+$/);
  await expect(page.locator(".score-profile-grid")).toBeVisible();
  await expect(page.locator(".triage-card").first()).toBeVisible();
  expect(dimensionRequests).toHaveLength(initialDimensionRequestCount + 1);
  expect(caseResultRequests).toHaveLength(initialCaseResultRequestCount + 1);

  await page.getByRole("link", { name: "Workflows", exact: true }).click();
  await expect(page).toHaveURL(/\/workflows$/);
  await expect(page.locator(".workflow-row")).toHaveCount(12);
  expect(runRequests).toHaveLength(initialRunRequestCount);
});
