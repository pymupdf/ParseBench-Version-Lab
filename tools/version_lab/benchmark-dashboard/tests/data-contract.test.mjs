import assert from "node:assert/strict";
import test from "node:test";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const dashboardOrigin = "https://parsebench-dashboard.vercel.app";

async function query(table, params) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/${table}?${params.toString()}`,
    { headers: { apikey: publishableKey } },
  );
  if (!response.ok) {
    assert.fail(`Supabase ${table} returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

test(
  "the public dashboard contract resolves run, document, and artifact data",
  { skip: !supabaseUrl || !publishableKey },
  async () => {
    const [run] = await query(
      "benchmark_runs",
      new URLSearchParams({
        select:
          "id,github_run_id,gcs_bucket,gcs_prefix,dataset_versions(repository,resolved_sha)",
        artifact_state: "eq.complete",
        order: "source_created_at.desc.nullslast,id.desc",
        limit: "1",
      }),
    );
    assert.ok(run?.id);
    assert.ok(run?.github_run_id);
    assert.ok(run?.gcs_bucket);

    const dimensions = await query(
      "run_dimensions",
      new URLSearchParams({
        select: "id,run_id,dimension",
        run_id: `eq.${run.id}`,
      }),
    );
    assert.ok(dimensions.length > 0);

    const [result] = await query(
      "case_results",
      new URLSearchParams({
        select:
          "id,primary_metric_name,primary_score,result_relative_path,diagnostic_relative_path,diagnostic_schema_version,run_dimensions!inner(run_id,dimension),benchmark_cases!inner(test_id,pdf_relative_path,dataset_versions!inner(repository,resolved_sha))",
        "run_dimensions.run_id": `eq.${run.id}`,
        result_relative_path: "not.is.null",
        order: "primary_score.asc.nullslast,id.asc",
        limit: "1",
      }),
    );
    assert.ok(result?.result_relative_path);
    assert.ok(result?.diagnostic_relative_path);
    assert.equal(result?.diagnostic_schema_version, 3);
    assert.ok(result?.benchmark_cases?.pdf_relative_path);

    const objectPath = `${run.gcs_prefix}/${result.result_relative_path}`
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const artifactResponse = await fetch(
      `https://storage.googleapis.com/${run.gcs_bucket}/${objectPath}`,
      { headers: { Origin: "http://localhost:3000" } },
    );
    assert.equal(artifactResponse.status, 200);
    assert.equal(artifactResponse.headers.get("access-control-allow-origin"), "*");
    const artifact = await artifactResponse.json();
    assert.equal(typeof artifact?.output?.markdown, "string");

    const diagnosticPath = `${run.gcs_prefix}/${result.diagnostic_relative_path}`
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const diagnosticResponse = await fetch(
      `https://storage.googleapis.com/${run.gcs_bucket}/${diagnosticPath}`,
      { headers: { Origin: "http://localhost:3000" } },
    );
    assert.equal(diagnosticResponse.status, 200);
    assert.equal(diagnosticResponse.headers.get("access-control-allow-origin"), "*");
    const diagnostic = await diagnosticResponse.json();
    assert.equal(diagnostic.schema_version, 3);
    assert.equal(diagnostic.test_id, result.benchmark_cases.test_id);
    assert.equal(diagnostic.dimension, result.run_dimensions.dimension);
    assert.ok(Array.isArray(diagnostic.metrics));
    assert.ok(diagnostic.metrics.length > 0);
    assert.equal(diagnostic.primary_metric?.name, result.primary_metric_name);
    assert.ok(Math.abs(diagnostic.primary_metric?.value - result.primary_score) < 1e-12);

    const dataset = result.benchmark_cases.dataset_versions;
    const datasetPath = result.benchmark_cases.pdf_relative_path
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const pdfResponse = await fetch(
      `https://huggingface.co/datasets/${dataset.repository}/resolve/${dataset.resolved_sha}/${datasetPath}`,
      {
        headers: {
          Origin: dashboardOrigin,
          Range: "bytes=0-65535",
        },
      },
    );
    assert.equal(pdfResponse.status, 206);
    assert.match(pdfResponse.headers.get("content-type") ?? "", /application\/pdf/);
    assert.match(pdfResponse.headers.get("content-range") ?? "", /^bytes 0-65535\//);
    assert.ok(
      ["*", dashboardOrigin].includes(
        pdfResponse.headers.get("access-control-allow-origin"),
      ),
    );
    await pdfResponse.body?.cancel();
  },
);
