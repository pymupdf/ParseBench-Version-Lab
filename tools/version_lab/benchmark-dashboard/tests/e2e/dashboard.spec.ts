import { expect, test, type Page } from "@playwright/test";

const RUN_ID = "30925196627";

async function openCatalogFilters(page: Page) {
  const toggle = page.locator(".catalog-filter-toggle");
  if (await toggle.isVisible() && await toggle.getAttribute("aria-expanded") === "false") {
    await toggle.click();
  }
}

function workflowNavigation(page: Page) {
  return page.getByRole("navigation", { name: "Dashboard sections" })
    .getByRole("link", { name: /^Workflows/ });
}

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport + 1);
}

test("finds workflows by commit and opens a selected run", async ({ page }) => {
  await page.goto(`/?run=${RUN_ID}&view=runs`);

  await expect(page.getByRole("heading", { name: "Benchmark intelligence." })).toBeVisible();
  await expect(page.locator(".score-leader-card")).toHaveCount(6);
  await expect(
    page.getByText("Quick runs are excluded. Full-dataset runs compete only in the dimensions they completely evaluated."),
  ).toBeVisible();
  await openCatalogFilters(page);
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

  const firstWorkflow = page.locator(".workflow-row").first();
  const selectedRunId = (await firstWorkflow.getAttribute("aria-label"))?.match(/\d+/)?.[0];
  expect(selectedRunId).toBeTruthy();
  await firstWorkflow.click();
  await expect(page).toHaveURL(new RegExp(`/workflows/${selectedRunId}$`));
  await expect(page.getByRole("heading", { name: /Pymupdf4llm/i }).first()).toBeVisible();
});

test("reopening the selected workflow preserves its evaluation data", async ({ page }) => {
  await page.goto(`/?run=${RUN_ID}&view=overview`);

  await expect(page.locator(".score-profile-grid")).toBeVisible();
  const evaluationCount = await page.locator(".score-profile-grid > *").count();
  expect(evaluationCount).toBeGreaterThan(0);

  await workflowNavigation(page).click();
  await expect(page).toHaveURL(/\/workflows$/);
  await page.getByRole("searchbox", { name: "Search workflows" }).fill(RUN_ID);
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
  await expectNoHorizontalOverflow(page);
  await firstDocument.click();

  await expect(page).toHaveURL(new RegExp(`/workflows/${RUN_ID}/triage/\\d+`));
  await expect(page.getByRole("link", { name: "Back to triage queue" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Browse queue" })).toBeVisible();
  await expect(page.locator(".pdf-card")).toBeVisible();
  await page.getByRole("button", { name: "Analysis" }).click();
  await expect(page.locator(".output-card")).toBeVisible();
  await expect(page.locator(".pdf-card")).toBeHidden();
  await expectNoHorizontalOverflow(page);
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
  await openCatalogFilters(page);
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

  await workflowNavigation(page).click();
  await expect(page).toHaveURL(/\/workflows$/);
  await expect(page.locator(".workflow-row")).toHaveCount(12);
  expect(runRequests).toHaveLength(initialRunRequestCount);
});


test("clears an empty workflow search and restores the catalog", async ({ page }) => {
  await page.goto("/workflows");
  await expect(page.locator(".workflow-row").first()).toBeVisible();
  const initialCount = await page.locator(".workflow-row").count();
  const search = page.getByRole("searchbox", { name: "Search workflows" });
  await search.fill("__parsebench_no_such_workflow_e2e__");

  await expect(page.locator(".workflow-row")).toHaveCount(0);
  await expect(page.getByText("No workflows match these filters")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();

  await expect(search).toHaveValue("");
  await expect(page.locator(".workflow-row")).toHaveCount(initialCount);
});

test("paginates workflow results without losing the active filter", async ({ page }) => {
  await page.goto("/workflows");
  const search = page.getByRole("searchbox", { name: "Search workflows" });
  await search.fill("pymupdf4llm");
  await expect(page.locator(".workflow-row").first()).toBeVisible();
  const firstRun = await page.locator(".workflow-row").first().getAttribute("aria-label");
  const pagination = page.locator(".pagination");
  await pagination.getByRole("button", { name: "Next", exact: true }).click();
  await expect(pagination).toContainText("Page 2 of");
  await expect(page.locator(".workflow-row").first()).not.toHaveAttribute("aria-label", firstRun!);
  await expect(search).toHaveValue("pymupdf4llm");

  await pagination.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.locator(".workflow-row").first()).toHaveAttribute("aria-label", firstRun!);
});

test("restores triage filters and pagination after inspecting a shared result", async ({ page }) => {
  await page.goto(`/workflows/${RUN_ID}/triage?dimension=text_formatting&sort=highest&page=2`);
  await expect(page.locator(".triage-card").first()).toBeVisible();
  const pagination = page.getByRole("navigation", { name: "Triage result pages" });
  await expect(pagination).toContainText("Page 2 of");
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveValue("highest");
  await expect(page.locator(".dimension-pills").getByRole("button", { name: /^Formatting/ }))
    .toHaveAttribute("aria-pressed", "true");
  const firstCase = await page.locator(".triage-card-copy strong").first().textContent();

  await page.locator(".triage-card").first().click();
  await expect(page).toHaveURL(/\/triage\/\d+\?.*page=2/);
  await page.getByRole("link", { name: "Back to triage queue" }).click();
  await expect(page).toHaveURL(/dimension=text_formatting.*sort=highest.*page=2/);
  await expect(pagination).toContainText("Page 2 of");
  await expect(page.locator(".triage-card-copy strong").first()).toHaveText(firstCase!);

  await page.reload();
  await expect(pagination).toContainText("Page 2 of");
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveValue("highest");
  await pagination.getByRole("button", { name: /Previous/ }).click();
  await expect(pagination).toContainText("Page 1 of");
  await expect(page).not.toHaveURL(/[?&]page=/);
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveValue("highest");
});

test("traps keyboard focus in the queue and restores it on Escape", async ({ page }) => {
  await page.goto(`/workflows/${RUN_ID}/triage/38105?dimension=text_formatting&from=triage`);
  const browseQueue = page.getByRole("button", { name: "Browse queue" });
  await expect(browseQueue).toBeVisible();
  await browseQueue.click();
  const queue = page.getByRole("dialog", { name: "Browse triage queue" });
  const closeQueue = queue.getByRole("button", { name: "Close queue browser" });
  await expect(queue).toBeVisible();
  await expect(closeQueue).toBeFocused();
  await expect(queue.locator(".triage-card").first()).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => queue.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await expect(closeQueue).not.toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeQueue).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(queue).toBeHidden();
  await expect(browseQueue).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});

test("keeps catalog controls and results inside a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workflows");
  await expect(page.locator(".workflow-row").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await openCatalogFilters(page);
  await page.getByLabel("Result").selectOption("success");
  await expect(page.locator(".workflow-row").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("navigates inspector tabs with Arrow, Home, and End keys", async ({ page }) => {
  await page.goto(`/workflows/${RUN_ID}/triage/38105?dimension=text_formatting&from=triage`);
  const tabs = page.getByRole("tablist", { name: "Case inspection views" });
  const explain = tabs.getByRole("tab", { name: "Explain", exact: true });
  const output = tabs.getByRole("tab", { name: "Output", exact: true });
  const json = tabs.getByRole("tab", { name: "JSON", exact: true });
  await expect(explain).toHaveAttribute("tabindex", "0");
  await expect(output).toHaveAttribute("tabindex", "-1");
  await explain.focus();
  await page.keyboard.press("ArrowRight");
  await expect(output).toBeFocused();
  await expect(output).toHaveAttribute("aria-selected", "true");
  await expect(explain).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("End");
  await expect(json).toBeFocused();
  await expect(json).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(explain).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(json).toBeFocused();
  await page.keyboard.press("Home");
  await expect(explain).toBeFocused();
  await expect(explain).toHaveAttribute("aria-selected", "true");
  await expect(tabs.locator('[tabindex="0"]')).toHaveCount(1);
});

test("releases the queue scroll lock when browser history leaves the inspector", async ({ page }) => {
  await page.goto(`/workflows/${RUN_ID}/triage?dimension=text_formatting`);
  await page.locator(".triage-card").first().click();
  await expect(page).toHaveURL(/\/triage\/\d+\?/);
  const detailUrl = page.url();
  await page.getByRole("button", { name: "Browse queue" }).click();
  const queue = page.getByRole("dialog", { name: "Browse triage queue" });
  await expect(queue).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/workflows/${RUN_ID}/triage\\?dimension=text_formatting$`));
  await expect(queue).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await page.goForward();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByRole("button", { name: "Browse queue" })).toBeVisible();
  await expect(queue).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});

test("opens an indexed run by ID even when its artifacts are incomplete", async ({ page }) => {
  await page.goto("/workflows");
  await openCatalogFilters(page);
  await page.getByLabel("Result").selectOption("cancelled");
  const incompleteRun = page.locator(".workflow-row").filter({ hasText: /artifacts/ }).first();
  await expect(incompleteRun).toBeVisible();
  const runId = (await incompleteRun.getAttribute("aria-label"))?.match(/\d+/)?.[0];
  expect(runId).toBeTruthy();
  await page.getByRole("textbox", { name: "Workflow run ID or commit" }).fill(runId!);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/workflows/${runId}$`));
  await expect(page.locator(".run-title-row")).toContainText("Cancelled");
  await expect(page.locator(".artifact-badge")).not.toHaveText("Complete artifacts");
});
