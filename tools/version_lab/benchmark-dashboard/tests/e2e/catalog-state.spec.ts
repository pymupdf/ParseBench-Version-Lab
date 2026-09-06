import { expect, test, type Page } from "@playwright/test";
import type { BenchmarkRun } from "../../app/lib/data";

async function mockRunOutcomes(page: Page) {
  const base: BenchmarkRun = {
    id: 101,
    github_run_id: 900000001,
    github_run_attempt: 1,
    github_run_url:
      "https://github.com/pymupdf/ParseBench-Version-Lab/actions/runs/900000001",
    run_name: "Failed evaluation fixture",
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "failure",
    artifact_state: "unavailable",
    pipeline_name: "fixture_parser",
    pipeline_config: {},
    run_scope: null,
    selected_group: null,
    requested_scope: "full",
    requested_group: "all",
    effective_scope: null,
    effective_group: null,
    observed_document_count: null,
    observed_dimension_counts: {},
    coverage_status: "unknown",
    leaderboard_eligible: false,
    eligibility_reasons: [],
    gcs_bucket: null,
    gcs_prefix: null,
    head_branch: "main",
    head_sha: "12345678abcdef",
    source_created_at: "2026-09-06T12:00:00Z",
    completed_at: "2026-09-06T12:02:00Z",
    summary: {},
    dataset_versions: null,
  };
  const runs: BenchmarkRun[] = [
    base,
    {
      ...base,
      id: 102,
      github_run_id: 900000002,
      run_name: "Cancelled evaluation fixture",
      conclusion: "cancelled",
    },
    {
      ...base,
      id: 103,
      github_run_id: 900000003,
      run_name: "Partial evaluation fixture",
      artifact_state: "partial",
      observed_document_count: 2,
    },
    {
      ...base,
      id: 104,
      github_run_id: 900000004,
      run_name: "Completed zero-score fixture",
      conclusion: "success",
      artifact_state: "complete",
      effective_scope: "test",
      effective_group: "table",
      coverage_status: "complete",
      observed_document_count: 2,
    },
  ];
  const dimensions = [103, 104].map((runId) => ({
    id: runId * 10,
    run_id: runId,
    dimension: "table",
    status: "completed",
    total_examples: 2,
    successful: 2,
    failed: 0,
    skipped: 0,
    report_relative_path: null,
  }));

  await page.route("**/rest/v1/benchmark_runs?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const runId = params.get("github_run_id")?.slice(3);
    const offset = Number(params.get("offset") ?? "0");
    await route.fulfill({
      json: runId
        ? runs.filter((run) => String(run.github_run_id) === runId)
        : runs.slice(
            offset,
            offset + Number(params.get("limit") ?? runs.length),
          ),
    });
  });
  await page.route("**/rest/v1/run_dimensions?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("select")?.includes("run_dimension_metrics")) {
      await route.fulfill({
        json: dimensions.map((dimension) => ({
          run_id: dimension.run_id,
          dimension: dimension.dimension,
          run_dimension_metrics: [
            { metric_name: "avg_grits_trm_composite", metric_value: 0 },
          ],
        })),
      });
      return;
    }
    const runId = Number(params.get("run_id")?.slice(3));
    await route.fulfill({
      json: dimensions.filter((dimension) => dimension.run_id === runId),
    });
  });
  await page.route("**/rest/v1/run_dimension_metrics?**", async (route) => {
    const dimensionIds =
      new URL(route.request().url()).searchParams.get("run_dimension_id") ?? "";
    await route.fulfill({
      json: dimensions
        .filter((dimension) => dimensionIds.includes(String(dimension.id)))
        .map((dimension) => ({
          id: dimension.id,
          run_dimension_id: dimension.id,
          metric_name: "avg_grits_trm_composite",
          metric_value: 0,
        })),
    });
  });
  await page.route("**/rest/v1/run_components?**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/rest/v1/run_errors?**", (route) =>
    route.fulfill({
      json: [
        {
          id: 1,
          stage: "evaluation",
          message: "Retained error fixture for the failed-run test.",
          occurred_at: null,
          error_type: "test_fixture",
          test_id: null,
        },
      ],
    }),
  );
  await page.route("**/rest/v1/case_results?**", (route) =>
    route.fulfill({ json: [], headers: { "content-range": "0-0/0" } }),
  );
}

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

test("failed and cancelled runs show execution outcomes without empty score tiles", async ({
  page,
}) => {
  await mockRunOutcomes(page);
  await page.goto("/workflows");
  const failed = page.getByRole("button", {
    name: "Open workflow run 900000001: View failure details",
    exact: true,
  });
  await expect(failed).toContainText("Workflow failed");
  await expect(failed).toContainText(
    "Benchmark artifacts are unavailable. No scores are indexed.",
  );
  await expect(
    failed.locator(
      ".workflow-aggregate, .workflow-dimension-scores, .workflow-config",
    ),
  ).toHaveCount(0);
  await expect(failed).not.toContainText(/Unknown|—/);
  await expect(
    page.getByRole("button", {
      name: "Open workflow run 900000002: View run details",
      exact: true,
    }),
  ).toContainText("Workflow cancelled");

  await failed.click();
  await expect(
    page.getByRole("region", { name: "Run outcome", exact: true }),
  ).toContainText("Workflow failed");
  await expect(
    page.getByRole("link", { name: "Open workflow logs ↗", exact: true }),
  ).toHaveAttribute(
    "href",
    "https://github.com/pymupdf/ParseBench-Version-Lab/actions/runs/900000001",
  );
  await expect(page.locator(".run-record-details")).toHaveAttribute("open", "");
  await expect(
    page.getByText("Retained error fixture for the failed-run test.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator(
      ".report-coverage-label, .execution-notice, .report-composite",
    ),
  ).toHaveCount(0);
});

test("a real zero stays a score and partial results remain accessible on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockRunOutcomes(page);
  await page.goto("/workflows");
  const zero = page.getByRole("button", {
    name: "Open workflow run 900000004",
    exact: true,
  });
  await expect(zero.locator(".workflow-aggregate > strong")).toHaveText("0%");
  await expect(zero.locator(".workflow-dimension-scores > span")).toHaveCount(
    1,
  );
  await expect(zero.locator(".workflow-outcome-lane")).toHaveCount(0);

  const partial = page.getByRole("button", {
    name: "Open workflow run 900000003: View retained results",
    exact: true,
  });
  await expect(partial).toContainText("Workflow failed");
  await expect(partial).toContainText("Partial results retained");
  await expect(partial.locator(".workflow-retained-scores")).toContainText(
    "Tables0%",
  );
  await expect(
    partial.locator(".workflow-aggregate, .workflow-dimension-scores"),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
  await partial.click();
  await expect(page).toHaveURL(/\/workflows\/900000003$/);
  await expect(page.locator(".report-composite-value > strong")).toHaveText(
    "0%",
  );
  await expect(page.locator(".report-dimension-row")).toHaveCount(1);
});
