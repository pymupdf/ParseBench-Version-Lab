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

async function openComparison(page: Page) {
  const currentResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith("/rest/v1/case_results") &&
      url.searchParams.get("id") === `eq.${CURRENT_CASE}`
    );
  });
  const bestResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith("/rest/v1/case_results") &&
      url.searchParams.has("benchmark_case_id") &&
      Boolean(url.searchParams.get("select")?.includes("benchmark_runs"))
    );
  });
  await page.goto(CASE_URL);
  const [current] = (await (await currentResponse).json()) as CaseResult[];
  const [best] = (await (await bestResponse).json()) as HistoricalRow[];
  expect(best).toBeTruthy();
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
  return { current, best };
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
