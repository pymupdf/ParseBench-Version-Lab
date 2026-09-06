import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Compile the real TypeScript modules without a Next server or external services.
async function moduleUrl(relativePath, imports = {}) {
  let source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  for (const [specifier, replacement] of Object.entries(imports)) {
    source = source.replaceAll(`"${specifier}"`, JSON.stringify(replacement));
  }
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
}

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||= "test-publishable-key";
const data = await import(await moduleUrl("../app/lib/data.ts", {
  "../diagnostics/types": await moduleUrl("../app/diagnostics/types.ts"),
}));
const pdf = await import(await moduleUrl("../app/api/source-pdf/route.ts"));

function pdfRequest(overrides = {}, init) {
  const query = new URLSearchParams({
    repository: "org/benchmark-data",
    revision: "abcdef0123456789",
    path: "docs/report.pdf",
    ...overrides,
  });
  return new Request(`https://dashboard.test/api/source-pdf?${query}`, init);
}

const artifactRun = { gcs_bucket: "artifacts", gcs_prefix: "run/42" };
function artifactResult(pageNumber = 2) {
  return {
    result_relative_path: "results/report.json",
    benchmark_cases: { page_number: pageNumber },
  };
}

test("document ordering uses the document name across paginated results", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get("order"), "benchmark_cases(test_id).asc,id.asc");
    assert.equal(params.get("offset"), "120");
    assert.equal(init.headers.get("Prefer"), "count=exact");
    assert.equal(init.signal, controller.signal);
    return Response.json([{ id: 1 }], { headers: { "content-range": "120-120/121" } });
  });
  assert.deepEqual(await data.loadDocuments(42, { sort: "document", offset: 120 }, controller.signal), {
    documents: [{ id: 1 }], total: 121,
  });
});

test("an expired document page keeps the server count instead of showing an error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Out of range", {
    status: 416, headers: { "content-range": "*/3" },
  }));
  assert.deepEqual(await data.loadDocuments(42, { offset: 120 }), { documents: [], total: 3 });
});

test("document filtering ignores non-finite bounds and retains literal search characters", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    const params = new URL(url).searchParams;
    assert.deepEqual(params.getAll("primary_score"), ["lte.1"]);
    assert.equal(params.get("benchmark_cases.test_id"), "ilike.*text\\_100\\%*");
    return Response.json([{ id: 1 }], { headers: { "content-range": "0-0/invalid" } });
  });
  assert.deepEqual(await data.loadDocuments(42, {
    floor: Number.NaN, ceiling: 20, search: " text_100% ",
  }), { documents: [{ id: 1 }], total: 1 });
});

test("data failures preserve their table and HTTP context", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Service unavailable", { status: 503 }));
  await assert.rejects(data.loadDocuments(42), /Could not load case_results \(503\): Service unavailable/);
});

function comparisonFixture(currentScore = 0.8, candidateScore = 0.82) {
  const current = {
    id: 101,
    primary_metric_name: "content_faithfulness",
    primary_score: currentScore,
    result_relative_path: "current/report.result.json",
    run_dimensions: { id: 11, run_id: 42, dimension: "text_content" },
    benchmark_cases: {
      id: 201,
      test_id: "text/report_p2",
      page_number: 2,
      dataset_versions: { repository: "org/dataset", resolved_sha: "abcdef0123456789" },
    },
  };
  const run = {
    id: 39,
    github_run_id: 987654321,
    github_run_url: "https://github.com/org/repo/actions/runs/987654321",
    pipeline_name: "historical-parser",
    gcs_bucket: "historical-artifacts",
    gcs_prefix: "runs/987654321",
    head_sha: "123456789abcdef0",
  };
  const result = {
    ...current,
    id: 99,
    primary_score: candidateScore,
    result_relative_path: "historical/report.result.json",
    diagnostic_relative_path: "historical/report.diagnostic.json",
    run_dimensions: { id: 9, run_id: run.id, dimension: "text_content" },
  };
  const row = { ...result, run_dimensions: { ...result.run_dimensions, benchmark_runs: run } };
  return { current, result, run, row };
}

test("historical comparison requests another result for the exact case and metric and retains its provenance", async (t) => {
  const fixture = comparisonFixture();
  t.mock.method(globalThis, "fetch", async (url) => {
    const { pathname, searchParams: params } = new URL(url);
    assert.equal(pathname, "/rest/v1/case_results");
    assert.equal(params.get("id"), `neq.${fixture.current.id}`);
    assert.equal(params.get("benchmark_case_id"), `eq.${fixture.current.benchmark_cases.id}`);
    assert.equal(params.get("run_dimensions.dimension"), "eq.text_content");
    assert.equal(params.get("run_dimensions.run_id"), `neq.${fixture.current.run_dimensions.run_id}`);
    assert.equal(params.get("primary_metric_name"), "eq.content_faithfulness");
    assert.deepEqual(params.getAll("primary_score"), ["not.is.null"]);
    assert.equal(params.get("order"), "primary_score.desc.nullslast,id.desc");
    assert.equal(params.get("limit"), "1");
    return Response.json([fixture.row]);
  });
  const best = await data.loadHistoricalBestResult(fixture.current);
  assert.deepEqual(best, { result: fixture.result, run: fixture.run });
  assert.equal(
    data.artifactUrl(best.run, best.result.result_relative_path),
    "https://storage.googleapis.com/historical-artifacts/runs/987654321/historical/report.result.json",
  );
});

test("historical comparisons remain available without a substantial score improvement", async (t) => {
  for (const [label, currentScore, candidateScore] of [
    ["an improvement under ten percentage points", 0.8, 0.82],
    ["a tied score", 0.8, 0.8],
    ["a perfect current score", 1, 1],
    ["a current result ahead of other runs", 0.8, 0.7],
    ["an unscored current result", null, 0.8],
  ]) {
    await t.test(label, async (t) => {
      const fixture = comparisonFixture(currentScore, candidateScore);
      const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json([fixture.row]));
      const best = await data.loadHistoricalBestResult(fixture.current);
      assert.equal(fetchMock.mock.callCount(), 1);
      assert.equal(best?.result.id, fixture.result.id);
      assert.equal(best?.result.primary_score, candidateScore);
    });
  }
});

test("a missing comparison metric never broadens the historical lookup", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("A result with no metric must not query unrelated scores");
  });
  for (const primary_metric_name of [null, "", "   "]) {
    const { current } = comparisonFixture();
    assert.equal(await data.loadHistoricalBestResult({ ...current, primary_metric_name }), null);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("an empty comparison is distinct from a failed historical lookup", async (t) => {
  const { current } = comparisonFixture();
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json([]));
  assert.equal(await data.loadHistoricalBestResult(current), null);
  fetchMock.mock.mockImplementation(async () => new Response("History unavailable", { status: 503 }));
  await assert.rejects(
    data.loadHistoricalBestResult(current),
    /Could not load case_results \(503\): History unavailable/,
  );
});

test("leaving a case cancels its in-flight historical lookup", async (t) => {
  const { current } = comparisonFixture();
  const controller = new AbortController();
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  t.mock.method(globalThis, "fetch", (_url, init) => new Promise((_resolve, reject) => {
    markStarted();
    assert.equal(init.signal, controller.signal);
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  }));
  const request = data.loadHistoricalBestResult(current, controller.signal);
  await started;
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
});

test("run scores average only each dimension's finite headline metric", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json([
    { run_id: 1, dimension: "chart", run_dimension_metrics: [
      { metric_name: "avg_rule_pass_rate", metric_value: 0.8 },
      { metric_name: "avg_content_faithfulness", metric_value: 0.1 },
    ] },
    { run_id: 1, dimension: "text_content", run_dimension_metrics: [
      { metric_name: "avg_content_faithfulness", metric_value: 0.6 },
    ] },
    { run_id: 2, dimension: "table", run_dimension_metrics: [
      { metric_name: "avg_grits_trm_composite", metric_value: null },
    ] },
  ]));
  assert.deepEqual(await data.loadRunScores([1, 2]), {
    1: { aggregate: 0.7, dimensions: { chart: 0.8, text_content: 0.6 } },
    2: { aggregate: null, dimensions: {} },
  });
});

test("layout overlays select the requested page when artifacts use zero-based page indexes", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    output: { markdown: "Page two" },
    raw_output: { pages: [0, 1].map((page_index) => ({
      page_index, width: 100, height: 200,
      page_boxes: [{ class: "text", bbox: [page_index * 10, 20, 50, 60] }],
    })) },
  }));
  const result = await data.loadArtifact(artifactRun, artifactResult());
  assert.equal(result.markdownState, "present");
  assert.deepEqual(result.layoutBoxes, [{
    id: "1-0", label: "Text", sourceIndex: 0, x: 0.1, y: 0.1, width: 0.4, height: 0.2,
  }]);
  const missingPage = await data.loadArtifact(artifactRun, artifactResult(3));
  assert.deepEqual(missingPage.layoutBoxes, []);
});

test("empty retained markdown stays distinct from missing output", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ output: { markdown: "" } }));
  assert.equal((await data.loadArtifact(artifactRun, artifactResult())).markdownState, "empty");
  fetchMock.mock.mockImplementation(async () => Response.json({}));
  assert.equal((await data.loadArtifact(artifactRun, artifactResult())).markdownState, "not_retained");
});

test("PDF proxy rejects repository traversal and invalid PDF locators before fetching", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected upstream request"); });
  for (const overrides of [
    { repository: "../dataset" }, { repository: "org/.." },
    { repository: "org/" }, { repository: "/dataset" },
    { repository: "org\\owner/dataset" }, { path: "../report.pdf" },
    { path: "docs/./report.pdf" }, { path: "docs/report.html" },
    { revision: "main" },
  ]) {
    assert.equal((await pdf.GET(pdfRequest(overrides))).status, 400);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("PDF proxy preserves byte ranges, caching and request cancellation", async (t) => {
  const request = pdfRequest({ path: "docs/report résumé.pdf" }, {
    headers: { Range: "bytes=0-3", "If-Range": "revision-etag" },
  });
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://huggingface.co/datasets/org/benchmark-data/resolve/abcdef0123456789/docs/report%20r%C3%A9sum%C3%A9.pdf");
    assert.equal(init.headers.get("range"), "bytes=0-3");
    assert.equal(init.headers.get("if-range"), "revision-etag");
    assert.equal(init.signal, request.signal);
    return new Response("%PDF", { status: 206, headers: {
      "content-range": "bytes 0-3/100", "content-length": "4", etag: "revision-etag",
    } });
  });
  const response = await pdf.GET(request);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 0-3/100");
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.match(response.headers.get("content-disposition"), /filename="report r_sum_\.pdf"/);
  assert.equal(await response.text(), "%PDF");
});

test("PDF HEAD requests omit bodies for valid requests and every error path", async (t) => {
  assert.equal((await pdf.HEAD(pdfRequest({ repository: "invalid" }))).body, null);
  const fetchMock = t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.method, "HEAD");
    return new Response(null, { headers: { "content-length": "42" } });
  });
  const response = await pdf.HEAD(pdfRequest());
  assert.equal(response.body, null);
  assert.equal(response.headers.get("content-length"), "42");
  fetchMock.mock.mockImplementation(async () => { throw new Error("Offline"); });
  const failed = await pdf.HEAD(pdfRequest());
  assert.equal(failed.status, 502);
  assert.equal(failed.body, null);
});

test("PDF upstream errors are inert text with the original HTTP status", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<h1>Missing</h1>", {
    status: 404, headers: { "content-type": "text/html" },
  }));
  const response = await pdf.GET(pdfRequest());
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-disposition"), null);
  assert.equal(await response.text(), "<h1>Missing</h1>");
});

test("PDF conditional requests preserve a bodyless not-modified response", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 304, headers: { etag: "cached" } }));
  const response = await pdf.GET(pdfRequest());
  assert.equal(response.status, 304);
  assert.equal(response.headers.get("etag"), "cached");
  assert.equal(response.body, null);
});
