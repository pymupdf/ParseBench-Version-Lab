import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("defines the ParseBench application shell", async () => {
  const [layout, page, dashboard] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /ParseBench Workflow Benchmark Observatory/);
  assert.match(dashboard, /ParseBench/);
  assert.match(dashboard, /Run Observatory/);
  assert.match(dashboard, /Workflow run ID/);
  assert.match(dashboard, /Search ID, commit, branch, pipeline, name/);
  assert.match(dashboard, /Highest scores by benchmark dimension/);
  assert.match(dashboard, /runs\.filter\(\(run\) => run\.leaderboard_eligible\)/);
  assert.match(dashboard, /Show run IDs/);
  assert.match(dashboard, /workflow-dimension-scores/);
  assert.match(page, /redirect\("\/workflows"\)/);
  assert.doesNotMatch(dashboard, /Indexed runs<\/span>|Commits<\/span>|Branches<\/span>|Pipelines<\/span>/);
  assert.doesNotMatch(`${layout}\n${page}\n${dashboard}`, /codex-preview|react-loading-skeleton/i);
});

test("keeps the standard Next.js dashboard client-only and publishable-key based", async () => {
  const [dashboard, pdfPreview, data, packageJson] = await Promise.all([
    readFile(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/pdf-preview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/data.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, /^"use client";/);
  assert.match(dashboard, /hasReference \? \(/);
  assert.doesNotMatch(dashboard, /No reference markdown exists/);
  assert.match(dashboard, /dynamic\(\(\) => import\("\.\/pdf-preview"\)/);
  assert.doesNotMatch(`${dashboard}\n${pdfPreview}`, /URL\.createObjectURL|<iframe/);
  assert.match(pdfPreview, /rangeChunkSize: 65_536/);
  assert.match(data, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(data, /service_role|SUPABASE_SECRET_KEY/);
  assert.match(packageJson, /"next": "16\.3\.0"/);
  assert.doesNotMatch(packageJson, /vinext|wrangler|cloudflare/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("uses native App Router pages for workflow navigation", async () => {
  const [dashboard, workflowLayout, workflows, overview, documents] = await Promise.all([
    readFile(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/workflows/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/workflows/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/workflows/[runId]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/workflows/[runId]/documents/page.tsx", import.meta.url), "utf8"),
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
