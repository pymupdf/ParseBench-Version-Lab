import { expect, test, type Page } from "@playwright/test";

const runId = "30925196627";
test.use({ viewport: { width: 1440, height: 1000 } });

async function openResult(page: Page, caseId: number, dimension: string) {
  await page.goto(
    `/workflows/${runId}/triage/${caseId}?dimension=${dimension}&from=triage`,
  );
  await expect(
    page.getByRole("button", { name: "Browse queue", exact: true }),
  ).toBeVisible();
  const mobileAnalysis = page.getByRole("button", {
    name: "Analysis",
    exact: true,
  });
  if (await mobileAnalysis.isVisible()) await mobileAnalysis.click();
}

async function expectNoOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport + 1);
}

test("layout evidence filters matching cards and locates an element on the source", async ({
  page,
}) => {
  await openResult(page, 37099, "layout");
  await expect(
    page.getByRole("heading", { name: "Locate. Classify. Attribute." }),
  ).toBeVisible();
  await expect(
    page.getByRole("definition").filter({ hasText: "%" }).first(),
  ).toBeVisible();
  const cards = page.locator(".layout-element-card");
  await expect(cards.first()).toBeVisible();
  const total = await cards.count();
  await cards.first().locator(".layout-element-select").click();
  await expect(cards.first().locator(".layout-element-select")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".layout-element-selected")).toHaveCount(1);

  const search = page.getByRole("searchbox", {
    name: "Search layout elements",
  });
  await search.fill("there-is-no-such-layout-region");
  await expect(
    page.getByText("No matching elements", { exact: true }),
  ).toBeVisible();
  await search.clear();
  await expect(cards).toHaveCount(total);
  await page
    .getByRole("group", { name: "Layout element status filter" })
    .getByRole("button", { name: "Needs attention", exact: true })
    .click();
  await expect(page.locator(".layout-element-passed")).toHaveCount(0);
  await page
    .getByRole("group", { name: "Layout element status filter" })
    .getByRole("button", { name: "All", exact: true })
    .click();
  await expect(cards).toHaveCount(total);
  await page.screenshot({
    path: "/tmp/parsebench-layout-evidence-redesign.png",
    fullPage: true,
  });
  await expectNoOverflow(page);
});

test("text content exposes retained comparisons and category selection", async ({
  page,
}) => {
  await openResult(page, 37800, "text_content");
  await expect(
    page.getByRole("heading", { name: "Completeness, accuracy and order" }),
  ).toBeVisible();
  const browser = page.locator(".evidence-check-browser");
  await browser.getByRole("button", { name: "All", exact: true }).click();
  const comparison = page.locator(".diagnostic-text-comparison").first();
  await expect(comparison).toBeVisible();
  if ((await comparison.getAttribute("open")) == null)
    await comparison.locator("summary").first().click();
  await expect(
    comparison.locator(".evidence-content-card").first(),
  ).toBeVisible();
  await expect(
    comparison.locator(".evidence-content-counts").first(),
  ).toContainText("Found in output");

  const category = page
    .getByRole("group", { name: "Evaluation check categories" })
    .getByRole("button")
    .nth(1);
  await category.click();
  await expect(category).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".evidence-check-section")).toHaveCount(1);
  await page.locator(".diagnostic-rule-row").first().click();
  await expect(page.locator(".diagnostic-rule-row").first()).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.screenshot({
    path: "/tmp/parsebench-text-evidence-redesign.png",
    fullPage: true,
  });
  await expectNoOverflow(page);
});

test("formatting keeps all compact checks and displays structured reference cards", async ({
  page,
}) => {
  await openResult(page, 38105, "text_formatting");
  await expect(
    page.getByRole("heading", { name: "Semantic formatting checks" }),
  ).toBeVisible();
  await expect(page.locator(".diagnostic-rule-row")).toHaveCount(8);
  await page.locator(".diagnostic-rule-row").first().click();
  await expect(page.locator(".evidence-check-selected")).toHaveCount(1);
  await page.screenshot({
    path: "/tmp/parsebench-formatting-evidence-redesign.png",
    fullPage: true,
  });

  await page.getByRole("tab", { name: "Ground truth", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Expected semantic formatting" }),
  ).toBeVisible();
  await expect(page.locator(".evidence-reference-rule")).toHaveCount(8);
  await expect(page.locator(".evidence-reference-rule").first()).toContainText(
    "Headline input",
  );
  await page.screenshot({
    path: "/tmp/parsebench-formatting-reference-redesign.png",
    fullPage: true,
  });
  await expectNoOverflow(page);
});

test("layout references retain coordinates and reading order on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openResult(page, 37099, "layout");
  await expect(
    page.getByRole("heading", { name: "Locate. Classify. Attribute." }),
  ).toBeVisible();
  await expectNoOverflow(page);
  await page.getByRole("tab", { name: "Ground truth", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Expected elements and reading order" }),
  ).toBeVisible();
  await expect(page.locator(".evidence-region-card").first()).toBeVisible();
  await expect(page.locator(".reference-region-map").first()).toHaveAttribute(
    "aria-label",
    /Expected region: x/,
  );
  await expect(
    page.locator(".reference-reading-position").first(),
  ).toContainText("Reading order");
  await expect(
    page.locator(".evidence-region-content code").first(),
  ).toContainText(/x .*y .*w .*h /);
  await page.screenshot({
    path: "/tmp/parsebench-layout-reference-mobile-redesign.png",
    fullPage: true,
  });
  await expectNoOverflow(page);
});
