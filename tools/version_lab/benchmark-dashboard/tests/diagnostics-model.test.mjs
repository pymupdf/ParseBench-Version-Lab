import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

// Exercise the same TypeScript models imported by the UI without requiring a
// browser, a production build, or access to historical benchmark data.
const compiledDirectory = await mkdtemp(join(tmpdir(), "parsebench-diagnostics-"));
let model;
let geometry;
let chart;
try {
  await Promise.all(["semantics", "model", "evidence-geometry", "chart-model"].map(async (name) => {
    const source = await readFile(new URL(`../app/diagnostics/${name}.ts`, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    await writeFile(join(compiledDirectory, `${name}.mjs`), outputText.replace(
      /from "\.\/([\w-]+)"/g,
      'from "./$1.mjs"',
    ));
  }));
  [model, geometry, chart] = await Promise.all(["model", "evidence-geometry", "chart-model"].map(
    (name) => import(pathToFileURL(join(compiledDirectory, `${name}.mjs`)).href),
  ));
} finally {
  await rm(compiledDirectory, { recursive: true, force: true });
}

function artifact(expectations, outcomes, metrics = []) {
  return {
    schema_version: 3,
    evaluation_kind: "rules",
    test_id: "evidence-matching-regression",
    dimension: "text_content",
    source: null,
    primary_metric: null,
    expectations,
    outcomes,
    metrics,
    summary: {},
  };
}

function expectation(id, page = 1) {
  return { id, page, type: "is_bold", rule: { text: id } };
}

test("missing outcomes cannot borrow another expectation's identified result", () => {
  const retained = { id: "second", type: "is_bold", passed: true };
  const items = model.buildEvidenceItems(artifact(
    [expectation("first"), expectation("second")],
    [retained],
  ));
  assert.equal(items.length, 2);
  assert.equal(items[0].outcome, null);
  assert.equal(items[1].outcome, retained);
  assert.deepEqual(model.statusCounts(items), { passed: 1, partial: 0, failed: 0, unknown: 1 });
});

test("rule and element identifiers match independently of an outcome's own id or order", () => {
  const second = { id: "event-2", rule_id: "second", type: "is_bold", passed: false };
  const first = { id: "event-1", element_id: "first", type: "is_bold", passed: true };
  const items = model.buildEvidenceItems(artifact(
    [expectation("first"), expectation("second")],
    [second, first],
  ));
  assert.deepEqual(items.map((item) => item.outcome), [first, second]);
});

test("historical anonymous outcomes still match by position, type and page", () => {
  const anonymous = { type: "is_bold", page: 1, passed: true };
  const items = model.buildEvidenceItems(artifact([expectation("first")], [anonymous]));
  assert.equal(items.length, 1);
  assert.equal(items[0].outcome, anonymous);

  const wrongPage = model.buildEvidenceItems(artifact([expectation("first", 2)], [anonymous]));
  assert.equal(wrongPage[0].outcome, null);
  assert.equal(wrongPage[1].expectation, null);
  assert.equal(wrongPage[1].outcome, anonymous);
});

test("unmatched identified outcomes remain available as separate evidence", () => {
  const unmatched = { id: "other", type: "is_bold", passed: false };
  const items = model.buildEvidenceItems(artifact([expectation("first")], [unmatched]));
  assert.equal(items[0].outcome, null);
  assert.equal(items[1].id, "other");
  assert.equal(items[1].outcome, unmatched);
});

test("historical metric rule results are available when outcomes were not retained", () => {
  const retained = { rule_id: "first", type: "is_bold", score: 0.5, passed: false };
  const items = model.buildEvidenceItems(artifact([expectation("first")], null, [{
    metric_name: "rule_pass_rate",
    value: 0.5,
    metadata: { rule_results: [retained, { type: "formatting_judge", score: 1 }] },
  }]));
  assert.equal(items.length, 1);
  assert.equal(items[0].outcome, retained);
  assert.equal(model.evidenceStatus(items[0].outcome), "partial");
});

test("layout headline status requires every applicable stage to pass", () => {
  assert.equal(model.evidenceStatus({
    localization_pass: true,
    classification_pass: false,
    attribution_applicable: false,
    score: 0.75,
  }), "failed");
  assert.equal(model.evidenceStatus({
    localization_pass: true,
    classification_pass: true,
    attribution_applicable: true,
  }), "unknown");
});

test("evidence boxes are intersected with the page instead of shifting clipped regions", () => {
  const bounds = geometry.normalizedEvidenceBounds({ x: -0.25, y: -0.125, width: 0.5, height: 0.25 });
  assert.deepEqual(bounds, { left: 0, top: 0, width: 0.25, height: 0.125 });
  assert.deepEqual(geometry.normalizedEvidenceBounds({ x: 0.75, y: 0.75, width: 0.5, height: 0.5 }), {
    left: 0.75, top: 0.75, width: 0.25, height: 0.25,
  });
});

test("invisible and invalid evidence boxes do not create keyboard controls", () => {
  for (const box of [
    { x: 2, y: 0, width: 0.5, height: 0.5 },
    { x: -2, y: 0, width: 0.5, height: 0.5 },
    { x: 0, y: 0, width: -0.5, height: 0.5 },
    { x: Number.NaN, y: 0, width: 0.5, height: 0.5 },
    { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 0.5 },
  ]) assert.equal(geometry.normalizedEvidenceBounds(box), null);
});

test("chart summaries count the complete data even when the preview is truncated", () => {
  const data = Array.from({ length: 21 }, () => Array.from({ length: 15 }, (_, index) => index));
  const preview = chart.chartArrayPreview(data);
  assert.equal(preview.summary, "20 data rows × 15 columns");
  assert.equal(preview.truncated, true);
  assert.equal(preview.preview.length, 12);
  assert.equal(preview.preview[0].length, 12);
  assert.equal(data.length, 21);
  assert.equal(data[0].length, 15);
  assert.deepEqual(chart.chartArrayPreview(null), { preview: [], summary: "—", truncated: false });
});
