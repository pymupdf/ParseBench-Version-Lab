import { expect, test } from "@playwright/test";

const formattingCase =
  "/workflows/30925196627/triage/38105?dimension=text_formatting&from=triage";
const layoutCase =
  "/workflows/30925196627/triage/37099?dimension=layout&from=triage";

test("the recorded score remains visible when detailed diagnostics are unavailable", async ({
  page,
}) => {
  await page.route("**/_diagnostics/v3/*.json", async (route) => {
    await route.fulfill({
      status: 404,
      body: "Diagnostic artifact unavailable",
    });
  });
  await page.goto(formattingCase);
  await expect(page.locator(".recorded-score-fallback")).toHaveText(
    "Recorded score 100%",
  );
  await expect(page.locator(".score-explanation")).toHaveCount(0);
  await page.getByRole("tab", { name: "Output", exact: true }).click();
  await expect(page.locator(".recorded-score-fallback")).toHaveText(
    "Recorded score 100%",
  );
});

test("the inspector resizes the source and gives analysis the full canvas", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(formattingCase);
  await expect(page.locator(".diagnostic-rule-row").first()).toBeVisible();
  const initialWidth = (await page.locator(".pdf-card").boundingBox())!.width;
  await page
    .getByRole("slider", { name: "Source width", exact: true })
    .press("End");
  await expect(
    page.getByRole("slider", { name: "Source width", exact: true }),
  ).toHaveValue("60");
  expect(
    (await page.locator(".pdf-card").boundingBox())!.width,
  ).toBeGreaterThan(initialWidth);
  await page
    .getByRole("button", { name: "Focus analysis", exact: true })
    .click();
  await expect(page.locator(".pdf-card")).toBeHidden();
  expect(
    (await page.locator(".output-card").boundingBox())!.width,
  ).toBeGreaterThan(1200);
  await page.getByRole("button", { name: "Split view", exact: true }).click();
  await expect(page.locator(".pdf-card")).toBeVisible();
  await page.locator(".scoring-method > summary").click();
  await expect(
    page.locator(".scoring-method .diagnostic-components"),
  ).toBeVisible();
});

test("selecting layout evidence on a phone preserves keyboard focus in the source view", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(layoutCase);
  await page.getByRole("button", { name: "Analysis", exact: true }).click();
  const element = page.locator(".layout-element-select").first();
  await expect(element).toBeVisible();
  await element.focus();
  await element.press("Enter");
  const source = page.getByRole("button", { name: "Source", exact: true });
  await expect(source).toBeFocused();
  await expect(source).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".pdf-card")).toBeVisible();
  await expect(page.locator(".output-card")).toBeHidden();
});

test("the record browser searches metrics and switches to reference and manifest records", async ({
  page,
}) => {
  await page.goto(layoutCase);
  await expect(page.locator(".diagnostic-inspector")).toBeVisible();
  await page.getByRole("tab", { name: "JSON", exact: true }).click();
  await page
    .getByLabel("Find a metric", { exact: true })
    .fill("num predictions");
  await expect(page.locator(".diagnostic-json-metric")).toHaveCount(1);
  await page
    .getByLabel("Find a metric", { exact: true })
    .fill("num_predictions");
  await expect(page.locator(".diagnostic-json-metric")).toHaveCount(1);
  await expect(page.locator(".diagnostic-json-metric summary code")).toHaveText(
    "7",
  );
  await page
    .getByRole("navigation", { name: "Diagnostic record sections" })
    .getByRole("button", { name: /Expectations/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Expected evidence", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".record-section .expectation-row").first(),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Diagnostic record sections" })
    .getByRole("button", { name: /Manifest/ })
    .click();
  await page.getByText("Run and source metadata", { exact: true }).click();
  await expect(page.locator(".record-section pre")).toContainText("layout");
});

test("secondary metadata and evidence labels maintain readable contrast", async ({
  page,
}) => {
  await page.goto(formattingCase);
  await expect(page.locator(".score-explanation")).toBeVisible();
  const samples = await page
    .locator(
      ".run-meta, .document-locator, .result-score-value .diagnostic-eyebrow, .result-outcomes dt, .scoring-method > summary",
    )
    .evaluateAll((elements) => {
      const color = (value: string) =>
        value
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number) ?? [255, 255, 255];
      const luminance = (rgb: number[]) =>
        rgb
          .map((channel) => {
            const normalized = channel / 255;
            return normalized <= 0.04045
              ? normalized / 12.92
              : ((normalized + 0.055) / 1.055) ** 2.4;
          })
          .reduce(
            (sum, channel, index) =>
              sum + channel * [0.2126, 0.7152, 0.0722][index],
            0,
          );
      return elements.map((element) => {
        const style = getComputedStyle(element);
        let ancestor: Element | null = element;
        let background = "rgb(255, 255, 255)";
        while (ancestor) {
          const candidate = getComputedStyle(ancestor).backgroundColor;
          if (candidate !== "rgba(0, 0, 0, 0)" && candidate !== "transparent") {
            background = candidate;
            break;
          }
          ancestor = ancestor.parentElement;
        }
        const foregroundLuminance = luminance(color(style.color));
        const backgroundLuminance = luminance(color(background));
        return {
          text: element.textContent?.trim().slice(0, 50),
          fontSize: Number.parseFloat(style.fontSize),
          contrast:
            (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
            (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
        };
      });
    });
  expect(samples.length).toBeGreaterThan(5);
  for (const sample of samples) {
    expect(
      sample.contrast,
      `Contrast for ${sample.text}`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      sample.fontSize,
      `Type size for ${sample.text}`,
    ).toBeGreaterThanOrEqual(11);
  }
});
