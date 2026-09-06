import { expect, test, type Page } from "@playwright/test";

const RUN_ID = "30925196627";

function trail(page: Page) {
  return page.getByRole("navigation", {
    name: "Current location",
    exact: true,
  });
}

async function jumpToDimension(page: Page, label: string) {
  const jump = page.getByRole("combobox", {
    name: "Jump within this run",
    exact: true,
  });
  const option = jump
    .locator("option")
    .filter({ hasText: new RegExp(`^${label} ·`) });
  await expect(option).toHaveCount(1);
  await jump.selectOption((await option.getAttribute("value"))!);
}

test("the run hierarchy provides direct dimension jumps and filter-aware ancestors", async ({
  page,
}) => {
  await page.goto(
    `/workflows/${RUN_ID}?dimension=chart&max=45&sort=highest&page=2`,
  );
  await expect(page.locator(".report-dimension-row")).toHaveCount(5);
  await expect(
    trail(page).getByRole("link", { name: "Run library", exact: true }),
  ).toBeVisible();
  await expect(
    trail(page).getByRole("link", { name: "Run report", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  await jumpToDimension(page, "Formatting");
  await expect(page).toHaveURL(
    new RegExp(
      `/workflows/${RUN_ID}/triage\\?dimension=text_formatting&max=45&sort=highest$`,
    ),
  );
  await expect(
    trail(page).getByRole("link", { name: "Formatting results", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("slider", { name: "Maximum score", exact: true }),
  ).toHaveValue("45");
  const resultsUrl = page.url();
  await page.locator(".triage-card").first().click();
  await expect(trail(page).locator('[aria-current="page"]')).toHaveText(
    "Document",
  );
  await expect(
    trail(page).getByRole("link", {
      name: "Back to Formatting results",
      exact: true,
    }),
  ).toHaveAttribute(
    "href",
    new URL(resultsUrl).pathname + new URL(resultsUrl).search,
  );

  await trail(page)
    .getByRole("link", { name: "Run report", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(
      `/workflows/${RUN_ID}\\?dimension=text_formatting&max=45&sort=highest$`,
    ),
  );
  await expect(
    page.getByRole("slider", { name: "Maximum score", exact: true }),
  ).toHaveValue("45");
  await trail(page)
    .getByRole("link", { name: "Run library", exact: true })
    .click();
  await expect(page).toHaveURL(/\/workflows$/);
  await expect(
    trail(page).getByRole("link", { name: "Run library", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("returning from a document opened in the report restores its queue position", async ({
  page,
}) => {
  const reportUrl = `/workflows/${RUN_ID}?dimension=text_formatting&sort=highest&page=2`;
  await page.goto(reportUrl);
  const firstCase = page.locator(".triage-card-copy strong").first();
  await expect(firstCase).toBeVisible();
  const caseName = await firstCase.textContent();
  await page.locator(".triage-card").first().click();
  await expect(page).toHaveURL(
    /dimension=text_formatting.*sort=highest.*page=2.*from=overview/,
  );
  await trail(page)
    .getByRole("link", { name: "Run report", exact: true })
    .click();
  await expect(page).toHaveURL(reportUrl);
  await expect(firstCase).toHaveText(caseName!);
  await expect(
    page.getByRole("navigation", { name: "Triage result pages" }),
  ).toContainText("Page 2 of");
});

test("mobile navigation keeps the library and run jump visible at document depth", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    `/workflows/${RUN_ID}/triage/38105?dimension=text_formatting&sort=highest&page=2&from=triage`,
  );
  await expect(page.locator(".inspection-title h2")).toBeVisible();
  await expect(
    trail(page).getByRole("link", { name: "Run library", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("combobox", { name: "Jump within this run", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("link", { name: "Source repository", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      trail(page).evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBeLessThanOrEqual(42);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);

  await jumpToDimension(page, "Charts");
  await expect(page).toHaveURL(
    new RegExp(`/workflows/${RUN_ID}/triage\\?dimension=chart&sort=highest$`),
  );
  await expect(
    trail(page).getByRole("link", { name: "Charts results", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    trail(page).getByRole("link", { name: "Run library", exact: true }),
  ).toBeInViewport();
});
