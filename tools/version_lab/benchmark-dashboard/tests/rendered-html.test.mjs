import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("defines the ParseBench application shell", async () => {
  const [layout, page] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /ParseBench Run Observatory/);
  assert.match(page, /ParseBench/);
  assert.match(page, /Run Observatory/);
  assert.match(page, /Workflow run ID/);
  assert.doesNotMatch(`${layout}\n${page}`, /codex-preview|react-loading-skeleton/i);
});

test("keeps the standard Next.js dashboard client-only and publishable-key based", async () => {
  const [page, data, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/data.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /^"use client";/);
  assert.match(page, /hasReference \? \(/);
  assert.doesNotMatch(page, /No reference markdown exists/);
  assert.match(page, /URL\.createObjectURL/);
  assert.doesNotMatch(page, /<iframe src=\{selectedPdf\}/);
  assert.match(data, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(data, /service_role|SUPABASE_SECRET_KEY/);
  assert.match(packageJson, /"next": "16\.3\.0"/);
  assert.doesNotMatch(packageJson, /vinext|wrangler|cloudflare/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
