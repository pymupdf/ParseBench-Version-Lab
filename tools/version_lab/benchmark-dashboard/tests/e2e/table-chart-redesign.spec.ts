import { expect, test } from "@playwright/test";
import type { DiagnosticArtifact } from "../../app/diagnostics/types";

const tableCase =
  "/workflows/30925196627/triage/36964?dimension=table&from=triage";
const chartCase =
  "/workflows/30925196627/triage/36170?dimension=chart&from=triage";

test("table evidence switches between comparison and complete individual previews", async ({
  page,
}) => {
  await page.goto(tableCase);
  const workspace = page.locator(".diagnostic-table-view");
  await expect(workspace.locator(".diagnostic-table-alignment dd")).toHaveText([
    "1",
    "1",
    "1",
    "0",
    "0",
  ]);
  const previews = workspace.locator(
    ".diagnostic-table-pair-preview > section",
  );
  await expect(previews).toHaveCount(2);
  await expect(previews.first()).toContainText("EFT Total");
  const mode = workspace.getByRole("group", { name: "Table preview mode" });
  await mode.getByRole("button", { name: "Expected", exact: true }).click();
  await expect(previews).toHaveCount(1);
  await expect(previews).toContainText("EFT Total");
  await mode.getByRole("button", { name: "Output", exact: true }).click();
  await expect(previews).toHaveCount(1);
  await expect(previews).toContainText("Output table 1");
  await expect(previews).toContainText("183330408");
  await mode.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(previews).toHaveCount(2);
  await workspace.locator(".table-scoring-guide > summary").click();
  await expect(
    workspace.locator(".diagnostic-table-score-components"),
  ).toBeVisible();
  await workspace.locator(".table-supporting-details > summary").click();
  await expect(workspace.locator(".diagnostic-table-detail")).toContainText(
    "Structurally consistent",
  );
});

test("table match navigation preserves missing-table evidence and paginates field differences", async ({
  page,
}) => {
  await page.route("**/table/_diagnostics/v3/*.json", async (route) => {
    const response = await route.fetch();
    const artifact = (await response.json()) as DiagnosticArtifact;
    artifact.expectations[0].expected_markdown +=
      "\n\n<table><tr><th>Second table</th></tr><tr><td>Missing source value</td></tr></table>";
    for (const metric of artifact.metrics) {
      if (metric.metric_name === "tables_expected") metric.value = 2;
      if (metric.metric_name === "tables_unmatched_expected") metric.value = 1;
      if (metric.metric_name === "grits_con") {
        metric.metadata!.tables_found_expected = 2;
        metric.metadata!.pairing = [
          [0, 0],
          [1, null],
        ];
        (
          metric.metadata!.per_table_details as Array<Record<string, unknown>>
        ).push({ gt_table_index: 1, pred_table_index: null, grits_con: 0 });
      }
      if (metric.metric_name === "table_record_match") {
        metric.metadata!.n_gt_tables = 2;
        const details = metric.metadata!.per_table_details as Array<
          Record<string, unknown>
        >;
        delete details[0].reason;
        details[0].record_details = [
          {
            type: "matched",
            gt_index: 0,
            pred_index: 0,
            score: 0,
            cells: Array.from({ length: 61 }, (_, index) => ({
              column: `Field ${index + 1}`,
              expected: `Expected ${index + 1}`,
              actual: `Output ${index + 1}`,
              score: 0,
            })),
          },
        ];
        details.push({
          gt_table_index: 1,
          pred_table_index: null,
          score: 0,
          reason: "no prediction",
        });
      }
    }
    await route.fulfill({ response, json: artifact });
  });
  await page.goto(tableCase);
  const workspace = page.locator(".diagnostic-table-view");
  const matches = workspace.getByRole("group", {
    name: "Table comparisons",
    exact: true,
  });
  await expect(matches.getByRole("button")).toHaveCount(2);
  await expect(
    workspace.getByRole("button", { name: "Needs review 2", exact: true }),
  ).toBeVisible();
  await workspace.locator(".diagnostic-differences > summary").click();
  await expect(workspace.locator(".table-field-differences > li")).toHaveCount(
    60,
  );
  await workspace.getByRole("button", { name: /Show 1 more/ }).click();
  await expect(workspace.locator(".table-field-differences > li")).toHaveCount(
    61,
  );
  await expect(
    workspace.locator(".table-field-differences > li").last(),
  ).toContainText("Expected 61");
  await matches.getByRole("button").nth(1).click();
  await expect(matches.getByRole("button").nth(1)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(workspace.locator(".diagnostic-table-pair")).toContainText(
    "Expected table is missing",
  );
  await expect(workspace.locator(".diagnostic-table-pair")).toContainText(
    "Missing source value",
  );
  await expect(workspace.locator(".diagnostic-table-pair")).toContainText(
    "The evaluator did not pair an output table",
  );
  await expect(workspace.locator(".diagnostic-table-alignment dd")).toHaveText([
    "2",
    "1",
    "1",
    "1",
    "0",
  ]);
});

test("chart outcome filters select the right expected data and explain missing results", async ({
  page,
}) => {
  await page.goto(chartCase);
  const workspace = page.locator(".diagnostic-chart-view");
  await expect(workspace.locator(".chart-check-option")).toHaveCount(4);
  await workspace
    .getByRole("button", { name: "Passed 1", exact: true })
    .click();
  await expect(workspace.locator(".chart-check-option")).toHaveCount(1);
  await expect(workspace.locator(".chart-expected-value strong")).toHaveText(
    "125",
  );
  await expect(
    workspace.getByRole("heading", { name: "This check passed", exact: true }),
  ).toBeVisible();
  await workspace
    .getByRole("button", { name: "Needs review 3", exact: true })
    .click();
  await expect(workspace.locator(".chart-check-option")).toHaveCount(3);
  await workspace.locator(".chart-check-option").nth(1).click();
  await expect(workspace.locator(".chart-expected-value strong")).toHaveText(
    "370",
  );
  await expect(workspace.locator(".chart-check-option").nth(1)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await workspace.locator(".chart-matching-criteria > summary").click();
  await expect(workspace.locator(".chart-matching-criteria li")).toContainText([
    "Value and every label must be associated in one table",
    "number normalization on",
    "numeric tolerance 1%",
    "text edit allowance 0",
  ]);
  await workspace
    .getByRole("button", { name: "Unknown 0", exact: true })
    .click();
  await expect(
    workspace.getByText("No checks in this view", { exact: true }),
  ).toBeVisible();
  await expect(workspace.locator(".chart-check-detail")).toHaveCount(0);
  await workspace
    .getByRole("button", { name: "All checks 4", exact: true })
    .click();
  await expect(workspace.locator(".chart-check-option")).toHaveCount(4);
});

test("large chart matrices disclose the preview limit and retain all expected data", async ({
  page,
}) => {
  await page.route("**/chart/_diagnostics/v3/*.json", async (route) => {
    const response = await route.fetch();
    const artifact = (await response.json()) as DiagnosticArtifact;
    const rule = artifact.expectations[0];
    rule.type = "chart_data_array_data";
    rule.rule = {
      data: [
        Array.from({ length: 14 }, (_, index) => `Column ${index + 1}`),
        ...Array.from({ length: 13 }, (_, row) =>
          Array.from(
            { length: 14 },
            (_, column) => `R${row + 1} C${column + 1}`,
          ),
        ),
      ],
    };
    await route.fulfill({ response, json: artifact });
  });
  await page.goto(chartCase);
  const workspace = page.locator(".diagnostic-chart-view");
  await expect(
    workspace.locator(".chart-expected-data > header"),
  ).toContainText("13 data rows × 14 columns");
  await expect(workspace.locator(".chart-expected-matrix tr")).toHaveCount(12);
  await expect(workspace.locator(".chart-expected-matrix th")).toHaveCount(12);
  await workspace.locator(".chart-complete-data > summary").click();
  await expect(workspace.locator(".chart-complete-data pre")).toContainText(
    "R13 C14",
  );
  await page.getByRole("tab", { name: "Ground truth", exact: true }).click();
  const completeReference = page.locator(".chart-ground-truth-complete-data");
  await completeReference
    .getByText("View complete expected data", { exact: true })
    .click();
  await expect(completeReference.locator("pre")).toContainText("R13 C14");
});

test("table and chart analysis remain usable on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const url of [tableCase, chartCase]) {
    await page.goto(url);
    await page.getByRole("button", { name: "Analysis", exact: true }).click();
    const workspace = page.locator(
      ".diagnostic-table-view, .diagnostic-chart-view",
    );
    await expect(workspace).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    expect((await workspace.boundingBox())!.width).toBeLessThanOrEqual(390);
  }
});
