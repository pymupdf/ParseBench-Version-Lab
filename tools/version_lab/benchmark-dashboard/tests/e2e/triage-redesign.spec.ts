import { expect, test } from "@playwright/test";

const RUN_ID = "30925196627";

test("case list mode preserves results and opens the same inspection context", async ({
  page,
}) => {
  await page.goto(
    `/workflows/${RUN_ID}/triage?dimension=text_formatting&sort=highest`,
  );
  const cases = page.locator(".triage-card");
  await expect(cases.first()).toBeVisible();
  const firstDocument = await cases
    .first()
    .locator(".triage-card-copy strong")
    .textContent();
  const count = await cases.count();

  await page.getByRole("button", { name: "List view", exact: true }).click();
  await expect(page.locator(".case-list-view")).toBeVisible();
  await expect(cases).toHaveCount(count);
  await expect(cases.first().locator(".triage-card-copy strong")).toHaveText(
    firstDocument!,
  );
  await expect(
    page.getByRole("button", { name: "List view", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await cases.first().click();
  await expect(page).toHaveURL(
    /\/triage\/\d+\?.*dimension=text_formatting.*sort=highest/,
  );
});

test("score shortcuts reset pagination, preserve run aggregates, and reset cleanly", async ({
  page,
}) => {
  await page.goto(
    `/workflows/${RUN_ID}/triage?dimension=text_formatting&page=2`,
  );
  await expect(page.locator(".triage-card").first()).toBeVisible();
  const aggregate = await page
    .locator(".dimension-primary-score > strong")
    .textContent();
  const coverage = await page.locator(".dimension-coverage").textContent();

  await page.getByRole("button", { name: "75–100%", exact: true }).click();
  await expect(page).toHaveURL(/dimension=text_formatting&min=75$/);
  await expect(
    page.getByRole("slider", { name: "Minimum score", exact: true }),
  ).toHaveValue("75");
  await expect(
    page.getByRole("button", { name: "75–100%", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".dimension-primary-score > strong")).toHaveText(
    aggregate!,
  );
  await expect(page.locator(".dimension-coverage")).toHaveText(coverage!);
  await expect(page.locator(".triage-card").first()).toBeVisible();
  const scores = await page.locator(".case-score").allTextContents();
  expect(scores.every((score) => Number.parseFloat(score) >= 75)).toBe(true);

  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page).not.toHaveURL(/[?&](?:min|max|page)=/);
  await expect(
    page.getByRole("slider", { name: "Minimum score", exact: true }),
  ).toHaveValue("0");
  await expect(
    page.getByRole("slider", { name: "Maximum score", exact: true }),
  ).toHaveValue("100");
  await expect(
    page.getByRole("button", { name: "All scores", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("the run record reveals execution details while dimension rows navigate to cases", async ({
  page,
}) => {
  await page.goto(`/workflows/${RUN_ID}`);
  await expect(page.locator(".report-dimension-row")).toHaveCount(5);
  const record = page.locator(".run-record-details");
  await expect(
    record.getByRole("heading", { name: "Source stack", exact: true }),
  ).toBeHidden();
  await record.locator("summary").click();
  await expect(
    record.getByRole("heading", { name: "Source stack", exact: true }),
  ).toBeVisible();
  await expect(
    record.getByRole("heading", {
      name: "Execution configuration",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    record.getByRole("heading", { name: "Run errors", exact: true }),
  ).toBeVisible();
  await record.locator("summary").click();
  await expect(
    record.getByRole("heading", { name: "Source stack", exact: true }),
  ).toBeHidden();

  await page
    .locator(".report-dimension-row")
    .filter({ hasText: "Formatting" })
    .click();
  await expect(page).toHaveURL(/\/triage\?dimension=text_formatting$/);
  await expect(page.locator(".dimension-introduction h1")).toContainText(
    "Formatting",
  );
});

test("every dimension workspace and its list layout fit a narrow mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/workflows/${RUN_ID}/triage?dimension=chart`);
  const navigation = page.locator(".dimension-pills");
  await expect(
    navigation.getByRole("button", { name: /^Charts/ }),
  ).toBeInViewport();

  for (const label of [
    "Tables",
    "Text content",
    "Formatting",
    "Layout",
    "Charts",
  ]) {
    await navigation
      .getByRole("button", { name: new RegExp(`^${label}`) })
      .click();
    await expect(page.locator(".dimension-introduction h1")).toContainText(
      label,
    );
    await expect(page.locator(".triage-card").first()).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(1);
  }

  await page.getByRole("button", { name: "List view", exact: true }).click();
  await expect(page.locator(".case-list-view")).toBeVisible();
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
