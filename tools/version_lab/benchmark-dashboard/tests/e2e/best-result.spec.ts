import { expect, test, type Page } from "@playwright/test";
import type { CaseResult, HistoricalBestRun } from "../../app/lib/data";

const CURRENT_RUN = "30925196627";
const CURRENT_CASE = 36144;
const CASE_URL = `/workflows/${CURRENT_RUN}/triage/${CURRENT_CASE}?dimension=chart&from=triage`;

type HistoricalRow = CaseResult & {
  run_dimensions: CaseResult["run_dimensions"] & {
    benchmark_runs: HistoricalBestRun;
  };
};

function isHistoricalLookup(url: URL) {
  return (
    url.pathname.endsWith("/rest/v1/case_results") &&
    url.searchParams.has("benchmark_case_id") &&
    Boolean(url.searchParams.get("select")?.includes("benchmark_runs"))
  );
}

async function openComparison(
  page: Page,
  { caseId = CURRENT_CASE, dimension = "chart" } = {},
) {
  const currentResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith("/rest/v1/case_results") &&
      url.searchParams.get("id") === `eq.${caseId}`
    );
  });
  const bestResponse = page.waitForResponse((response) => {
    return isHistoricalLookup(new URL(response.url()));
  });
  await page.goto(
    `/workflows/${CURRENT_RUN}/triage/${caseId}?dimension=${dimension}&from=triage`,
  );
  const [current] = (await (await currentResponse).json()) as CaseResult[];
  const comparisonResponse = await bestResponse;
  const [best] = (await comparisonResponse.json()) as HistoricalRow[];
  expect(best).toBeTruthy();
  await expect(
    page.getByRole("button", { name: "Browse queue", exact: true }),
  ).toBeVisible();
  const analysis = page.getByRole("button", { name: "Analysis", exact: true });
  if (await analysis.isVisible()) await analysis.click();
  await page
    .getByRole("tablist", { name: "Case inspection views" })
    .getByRole("tab", { name: "Best result", exact: true })
    .click();
  await expect(
    page.getByRole("region", {
      name: "Best historical result scoring evidence",
      exact: true,
    }),
  ).toBeVisible();
  return { current, best, lookupUrl: new URL(comparisonResponse.url()) };
}

test("historical comparison keeps scores, provenance, and extracted output tied to the correct run", async ({
  page,
}) => {
  const { current, best } = await openComparison(page);
  expect(best.benchmark_cases.id).toBe(current.benchmark_cases.id);
  expect(best.run_dimensions.dimension).toBe(current.run_dimensions.dimension);
  expect(best.primary_metric_name).toBe(current.primary_metric_name);
  expect(best.benchmark_cases.dataset_versions.resolved_sha).toBe(
    current.benchmark_cases.dataset_versions.resolved_sha,
  );

  const scores = page.locator(".best-score-comparison > div > strong");
  await expect(scores).toHaveCount(2);
  expect(Number.parseFloat((await scores.nth(0).textContent())!)).toBeCloseTo(
    current.primary_score! * 100,
    2,
  );
  expect(Number.parseFloat((await scores.nth(1).textContent())!)).toBeCloseTo(
    best.primary_score! * 100,
    2,
  );
  await expect(page.locator(".best-score-comparison")).toContainText(
    "percentage points",
  );

  const provenance = page.locator(".best-provenance-disclosure");
  await provenance.locator("summary").click();
  await expect(
    provenance.getByRole("link", {
      name: `Open workflow ${best.run_dimensions.benchmark_runs.github_run_id} overview`,
    }),
  ).toHaveAttribute(
    "href",
    `/workflows/${best.run_dimensions.benchmark_runs.github_run_id}`,
  );

  const sourceLink = page.getByRole("link", {
    name: "Open source ↗",
    exact: true,
  });
  const sourceHref = await sourceLink.getAttribute("href");
  const bestOutput = page.getByRole("region", {
    name: "Best historical result extracted output",
    exact: true,
  });
  await expect(bestOutput.locator(".markdown-body")).toBeVisible();
  const bestMarkdown = await bestOutput.locator(".markdown-body").textContent();
  const bestJson = await bestOutput
    .getByRole("link", { name: "Open JSON ↗", exact: true })
    .getAttribute("href");
  expect(decodeURIComponent(new URL(bestJson!).pathname)).toContain(
    `/${best.run_dimensions.benchmark_runs.gcs_prefix}/${best.result_relative_path}`,
  );

  const tabs = page.getByRole("tablist", {
    name: "Historical best comparison views",
  });
  await tabs.getByRole("tab", { name: /^Current / }).click();
  const currentOutput = page.getByRole("region", {
    name: "Current page result extracted output",
    exact: true,
  });
  await expect(currentOutput.locator(".markdown-body")).toBeVisible();
  expect(await currentOutput.locator(".markdown-body").textContent()).not.toBe(
    bestMarkdown,
  );
  const currentJson = await currentOutput
    .getByRole("link", { name: "Open JSON ↗", exact: true })
    .getAttribute("href");
  expect(currentJson).not.toBe(bestJson);
  expect(decodeURIComponent(new URL(currentJson!).pathname)).toContain(
    `/${current.result_relative_path}`,
  );
  await expect(sourceLink).toHaveAttribute("href", sourceHref!);
  await expect(
    page
      .getByRole("region", {
        name: "Current page result scoring evidence",
        exact: true,
      })
      .locator(".best-result-evidence-heading > strong"),
  ).toHaveText("0%");

  await tabs.getByRole("tab", { name: "Ground truth", exact: true }).click();
  await expect(
    page.locator(".best-result-comparison-panel .evidence-chart-reference"),
  ).toHaveCount(10);
  await expect(sourceLink).toHaveAttribute("href", sourceHref!);

  await page
    .getByRole("link", { name: "Open best result", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(
      `/workflows/${best.run_dimensions.benchmark_runs.github_run_id}/triage/${best.id}\\?dimension=chart&from=triage$`,
    ),
  );
  await expect(page.locator(".inspection-title h2")).toContainText(
    current.benchmark_cases.test_id.split("/").at(-1)!,
  );
});

test("historical comparison tabs support keyboard navigation and fit on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openComparison(page);
  const tabs = page.getByRole("tablist", {
    name: "Historical best comparison views",
  });
  const bestTab = tabs.getByRole("tab", { name: /^Best / });
  await bestTab.focus();
  await page.keyboard.press("Home");
  const groundTruthTab = tabs.getByRole("tab", {
    name: "Ground truth",
    exact: true,
  });
  await expect(groundTruthTab).toBeFocused();
  await expect(groundTruthTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: /^Current / })).toBeFocused();
  await expect(
    page.getByRole("region", {
      name: "Current page result scoring evidence",
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("End");
  await expect(bestTab).toBeFocused();
  await expect(bestTab).toHaveAttribute("aria-selected", "true");
  await expect(tabs.locator('[tabindex="0"]')).toHaveCount(1);
  await expect(
    page
      .getByRole("region", {
        name: "Best historical result extracted output",
        exact: true,
      })
      .locator(".markdown-body"),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
});

for (const [dimension, caseId] of [
  ["table", 36964],
  ["text_content", 37800],
  ["layout", 37099],
  ["text_formatting", 38105],
  ["chart", 36144],
] as const) {
  test(`${dimension} always offers Best result as the second tab and opens a matching comparison`, async ({
    page,
  }) => {
    const { current, best, lookupUrl } = await openComparison(page, {
      caseId,
      dimension,
    });
    const inspectionTabs = page.getByRole("tablist", {
      name: "Case inspection views",
    });
    await expect(inspectionTabs.getByRole("tab").nth(0)).toHaveText("Explain");
    await expect(inspectionTabs.getByRole("tab").nth(1)).toHaveText(
      "Best result",
    );
    await expect(inspectionTabs.getByRole("tab").nth(1)).toHaveAttribute(
      "aria-selected",
      "true",
    );

    expect(best.run_dimensions.run_id).not.toBe(current.run_dimensions.run_id);
    expect(best.benchmark_cases.id).toBe(current.benchmark_cases.id);
    expect(best.run_dimensions.dimension).toBe(dimension);
    expect(best.primary_metric_name).toBe(current.primary_metric_name);
    expect(lookupUrl.searchParams.get("run_dimensions.run_id")).toBe(
      `neq.${current.run_dimensions.run_id}`,
    );
    expect(lookupUrl.searchParams.get("primary_metric_name")).toBe(
      `eq.${current.primary_metric_name}`,
    );
    expect(lookupUrl.searchParams.get("primary_score")).toBe("not.is.null");
    await expect(page.locator("#best-result-heading")).toHaveText(
      /Same document\. A better result\.|This result ties the best score\.|This result leads the other runs\./,
    );
    const evidence = page.getByRole("region", {
      name: "Best historical result scoring evidence",
      exact: true,
    });
    await expect(evidence.locator(".diagnostic-inspector")).toBeVisible();
    await expect(
      page
        .getByRole("region", {
          name: "Best historical result extracted output",
          exact: true,
        })
        .locator(".markdown-body"),
    ).toBeVisible();
    if (current.primary_score === 1 && best.primary_score === 1) {
      await expect(page.locator("#best-result-heading")).toHaveText(
        "This result ties the best score.",
      );
    }
  });
}

test("an early Best result click remembers the selection while its lookup is pending", async ({
  page,
}) => {
  let releaseLookup = () => {};
  const lookupGate = new Promise<void>((resolve) => {
    releaseLookup = resolve;
  });
  await page.route(isHistoricalLookup, async (route) => {
    const response = await route.fetch();
    await lookupGate;
    await route.fulfill({ response });
  });
  try {
    await page.goto(CASE_URL);
    const bestTab = page
      .getByRole("tablist", { name: "Case inspection views" })
      .getByRole("tab", { name: "Best result", exact: true });
    await expect(bestTab).toBeVisible();
    await bestTab.click();
    await expect(bestTab).toHaveAttribute("aria-selected", "true");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Finding the best matching result across runs" }),
    ).toBeVisible();
    await expect(page.locator(".best-result-summary")).toHaveCount(0);
    releaseLookup();
    await expect(
      page
        .getByRole("region", {
          name: "Best historical result scoring evidence",
          exact: true,
        })
        .locator(".diagnostic-inspector"),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", {
          name: "Best historical result extracted output",
          exact: true,
        })
        .locator(".markdown-body"),
    ).toBeVisible();
    await expect(bestTab).toHaveAttribute("aria-selected", "true");
  } finally {
    releaseLookup();
  }
});

test("Best result remains available when no comparable result exists", async ({
  page,
}) => {
  await page.route(isHistoricalLookup, (route) => route.fulfill({ json: [] }));
  await page.goto(CASE_URL);
  const inspectionTabs = page.getByRole("tablist", {
    name: "Case inspection views",
  });
  const bestTab = inspectionTabs.getByRole("tab", {
    name: "Best result",
    exact: true,
  });
  await bestTab.click();
  await expect(
    page.getByText("No matching result in another run", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".best-result-summary")).toHaveCount(0);
  await inspectionTabs
    .getByRole("tab", { name: "Output", exact: true })
    .click();
  await expect(page.locator(".inspector-stage .markdown-body")).toBeVisible();
  await bestTab.click();
  await expect(bestTab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByText("No matching result in another run", { exact: true }),
  ).toBeVisible();
});

test("a failed best-result lookup explains the error and retry loads the comparison", async ({
  page,
}) => {
  let attempts = 0;
  await page.route(isHistoricalLookup, async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        json: { message: "Comparison lookup temporarily unavailable" },
      });
      return;
    }
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  await page.goto(CASE_URL);
  const bestTab = page
    .getByRole("tablist", { name: "Case inspection views" })
    .getByRole("tab", { name: "Best result", exact: true });
  await bestTab.click();
  await expect(
    page.getByText("Could not load the comparison", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".best-result-unavailable")).toContainText(
    "Comparison lookup temporarily unavailable",
  );
  await page
    .getByRole("button", { name: "Retry comparison", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", {
        name: "Best historical result scoring evidence",
        exact: true,
      })
      .locator(".diagnostic-inspector"),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", {
        name: "Best historical result extracted output",
        exact: true,
      })
      .locator(".markdown-body"),
  ).toBeVisible();
  expect(attempts).toBe(2);
  await expect(bestTab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("button", { name: "Retry comparison", exact: true }),
  ).toHaveCount(0);
});

test("a result with no indexed score still looks up comparable runs", async ({
  page,
}) => {
  await page.route(
    (url) =>
      url.pathname.endsWith("/rest/v1/case_results") &&
      url.searchParams.get("id") === `eq.${CURRENT_CASE}`,
    async (route) => {
      const response = await route.fetch();
      const rows = (await response.json()) as CaseResult[];
      await route.fulfill({
        response,
        json: rows.map((result) => ({ ...result, primary_score: null })),
      });
    },
  );
  const { current, best, lookupUrl } = await openComparison(page);
  expect(current.primary_score).toBeNull();
  expect(best.primary_score).not.toBeNull();
  expect(lookupUrl.searchParams.get("primary_score")).toBe("not.is.null");
  await expect(
    page
      .getByRole("region", {
        name: "Best historical result extracted output",
        exact: true,
      })
      .locator(".markdown-body"),
  ).toBeVisible();
});
