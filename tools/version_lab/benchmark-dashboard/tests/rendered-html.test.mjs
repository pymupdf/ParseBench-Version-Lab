import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const appFile = (path) => readFile(new URL(`../app/${path}`, import.meta.url), "utf8");

async function dashboardSources() {
  const modules = await readdir(new URL("../app/dashboard/", import.meta.url));
  const sources = await Promise.all([
    appFile("dashboard-client.tsx"),
    appFile("dashboard-navigation.tsx"),
    ...modules.filter((name) => /\.tsx?$/.test(name)).map((name) => appFile(`dashboard/${name}`)),
  ]);
  return sources.join("\n");
}

test("composes the ParseBench shell with the complete workflow catalog", async () => {
  const [layout, page, dashboard, catalog] = await Promise.all([
    appFile("layout.tsx"),
    appFile("page.tsx"),
    appFile("dashboard-client.tsx"),
    appFile("dashboard/workflow-browser.tsx"),
  ]);
  assert.match(layout, /applicationName: "ParseBench"/);
  assert.match(dashboard, /<WorkflowBrowser\b/);
  assert.match(dashboard, /<Overview\b/);
  assert.match(dashboard, /<TriageGrid\b/);
  assert.match(dashboard, /<DocumentExplorer\b/);
  assert.match(catalog, /completeRuns\.filter\(\(run\) => run\.leaderboard_eligible\)/);
  assert.doesNotMatch(catalog, /const filtered = completeRuns\.filter/);
  assert.match(page, /redirect\("\/workflows"\)/);
  assert.doesNotMatch(`${layout}\n${page}\n${dashboard}\n${catalog}`, /codex-preview|react-loading-skeleton/i);
});

test("keeps the client boundary, streamed PDF preview, and publishable-key data access", async () => {
  const [entry, dashboard, inspector, pdfPreview, data, packageText] = await Promise.all([
    appFile("dashboard-client.tsx"),
    dashboardSources(),
    appFile("dashboard/document-explorer.tsx"),
    appFile("pdf-preview.tsx"),
    appFile("lib/data.ts"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(entry, /^"use client";/);
  assert.match(inspector, /diagnostic\.data\?\.metrics/);
  assert.doesNotMatch(dashboard, /No reference markdown exists/);
  assert.match(inspector, /dynamic\(\(\) => import\("\.\.\/pdf-preview"\)/);
  assert.doesNotMatch(`${dashboard}\n${pdfPreview}`, /URL\.createObjectURL|<iframe/);
  assert.match(pdfPreview, /rangeChunkSize: 65_536/);
  assert.match(data, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(`${dashboard}\n${data}`, /case_metrics|loadCaseMetrics|CaseMetric/);
  assert.doesNotMatch(data, /table\.jsonl/);
  assert.doesNotMatch(data, /pipeline_name: "not\.is\.null"/);
  assert.doesNotMatch(data, /service_role|SUPABASE_SECRET_KEY/);
  const packageJson = JSON.parse(packageText);
  assert.equal(packageJson.dependencies.next, "16.3.0");
  assert.doesNotMatch(packageText, /vinext|wrangler|cloudflare|react-loading-skeleton/i);
});

test("uses native App Router pages and shareable workflow navigation", async () => {
  const [dashboard, workflowLayout, workflows, overview, documents] = await Promise.all([
    dashboardSources(),
    appFile("workflows/layout.tsx"),
    appFile("workflows/page.tsx"),
    appFile("workflows/[runId]/page.tsx"),
    appFile("workflows/[runId]/documents/page.tsx"),
  ]);
  assert.match(workflowLayout, /<DashboardClient>\{children\}<\/DashboardClient>/);
  assert.match(dashboard, /usePathname\(\)/);
  assert.match(dashboard, /useParams<\{ runId\?: string \}>\(\)/);
  assert.match(dashboard, /useSearchParams\(\)/);
  assert.match(workflows, /return null/);
  assert.match(overview, /validateGithubRunId\(runId\)/);
  assert.match(documents, /validateGithubRunId\(runId\)/);
  assert.match(dashboard, /href="\/workflows"/);
  assert.match(dashboard, /router\.push\(`\/workflows\/\$\{candidate\.github_run_id\}`\)/);
  assert.doesNotMatch(dashboard, /initialResultId|query\.set\("result"/);
  assert.doesNotMatch(dashboard, /window\.history|replaceState/);
});
