import { expect, test } from "@playwright/test";

const RUN_ID = "30925196627";

test("finds workflows by commit and opens a selected run", async ({ page }) => {
  await page.goto(`/?run=${RUN_ID}&view=runs`);

  await expect(page.getByRole("heading", { name: "Find the benchmark run you need" })).toBeVisible();
  await page.getByLabel("Dataset", { exact: true }).selectOption("v1");
  await expect(page.locator(".score-leader-card")).toHaveCount(6);
  await expect(
    page.getByText("Quick runs are excluded. Full-dataset runs compete only in the dimensions they completely evaluated."),
  ).toBeVisible();
  await expect(page.getByLabel("Result").locator("option")).toHaveText([
    "All results",
    "Cancelled",
    "Failure",
    "Success",
  ]);
  await page.getByLabel("Result").selectOption("success");
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
  await page.getByLabel("Result").selectOption("success");
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

test("opens an unsupported v2 dimension with its pinned thumbnail and raw output", async ({ page }) => {
  const revision = "a".repeat(40);
  const dataset = { repository: "llamaindex/ParseBench-2", resolved_sha: revision };
  const dimension = { id: 2, run_id: 1, dimension: "forms", total_examples: 1 };
  const run = {
    id: 1, github_run_id: 123, artifact_state: "complete", dataset_versions: dataset,
    gcs_bucket: "test-results", gcs_prefix: "run", summary: {},
  };
  const result = {
    id: 3, success: true, primary_metric_name: "forms_v2", primary_score: 0.5,
    run_dimensions: dimension, result_relative_path: "case.result.json",
    benchmark_cases: {
      id: 4, test_id: "forms/case #1", source_media_type: "image/jpeg",
      source_relative_path: "forms/case #1.jpg", dataset_versions: dataset,
    },
  };
  const tables: Record<string, unknown[]> = {
    benchmark_runs: [run], run_dimensions: [dimension], case_results: [result],
  };
  await page.route("**/rest/v1/**", (route) => {
    const table = new URL(route.request().url()).pathname.split("/").at(-1)!;
    return route.fulfill({ json: tables[table] ?? [] });
  });
  const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2kAAAAASUVORK5CYII=", "base64");
  await page.route("https://storage.googleapis.com/parsebench-v2-thumbnails-457820/**", (route) =>
    route.fulfill({ contentType: "image/png", body: pixel }));
  await page.route("https://huggingface.co/**", (route) =>
    route.fulfill({ contentType: "image/png", body: pixel }));
  const markdown = "  # Original indentation\n\n<table><tr><td>A</td></tr></table>\n";
  await page.route("https://storage.googleapis.com/test-results/run/case.result.json", (route) =>
    route.fulfill({ json: { output: { markdown } } }));

  await page.goto("/workflows/123/triage?dimension=forms");
  const card = page.locator(".triage-card").first();
  await expect(card.locator("img")).toHaveAttribute("src",
    `https://storage.googleapis.com/parsebench-v2-thumbnails-457820/${revision}/forms/case%20%231.webp`);
  await card.click();
  await expect(page.getByRole("tab")).toHaveText(["Raw Markdown"]);
  await expect(page.locator(".inspection-score")).toContainText("50%");
  await expect(page.locator(".image-preview img")).toHaveAttribute("src",
    `https://huggingface.co/datasets/llamaindex/ParseBench-2/resolve/${revision}/forms/case%20%231.jpg`);
  await expect.poll(() => page.locator(".markdown-source code").textContent()).toBe(markdown);
});
