import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("defines the ParseBench application shell", async () => {
  const [layout, page] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /ParseBench Workflow Benchmark Observatory/);
  assert.match(page, /ParseBench/);
  assert.match(page, /Run Observatory/);
  assert.match(page, /Workflow run ID/);
  assert.match(page, /Search ID, commit, branch, pipeline, name/);
  assert.match(page, /Highest scores by benchmark dimension/);
  assert.match(page, /run\.run_scope === "full" && run\.selected_group === "all"/);
  assert.match(page, /Show run IDs/);
  assert.match(page, /workflow-dimension-scores/);
  assert.doesNotMatch(page, /Indexed runs<\/span>|Commits<\/span>|Branches<\/span>|Pipelines<\/span>/);
  assert.doesNotMatch(`${layout}\n${page}`, /codex-preview|react-loading-skeleton/i);
});

test("keeps the standard Next.js dashboard client-only and publishable-key based", async () => {
  const [page, pdfPreview, data, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/pdf-preview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/data.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /^"use client";/);
  assert.match(page, /hasReference \? \(/);
  assert.doesNotMatch(page, /No reference markdown exists/);
  assert.match(page, /dynamic\(\(\) => import\("\.\/pdf-preview"\)/);
  assert.doesNotMatch(`${page}\n${pdfPreview}`, /URL\.createObjectURL|<iframe/);
  assert.match(pdfPreview, /rangeChunkSize: 65_536/);
  assert.match(data, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(data, /service_role|SUPABASE_SECRET_KEY/);
  assert.match(packageJson, /"next": "16\.3\.0"/);
  assert.doesNotMatch(packageJson, /vinext|wrangler|cloudflare/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
