import type { DiagnosticArtifact } from "../diagnostics";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const PRIMARY_METRIC_BY_DIMENSION: Record<string, string> = {
  chart: "avg_rule_pass_rate",
  layout: "avg_layout_element_rule_pass_rate",
  table: "avg_grits_trm_composite",
  text_content: "avg_content_faithfulness",
  text_formatting: "avg_semantic_formatting",
};

const PRIMARY_METRICS = [...new Set(Object.values(PRIMARY_METRIC_BY_DIMENSION))];

const RUN_SELECT =
  "id,github_run_id,github_run_attempt,github_run_url,run_name,event,status,conclusion,artifact_state,pipeline_name,pipeline_config,run_scope,selected_group,requested_scope,requested_group,effective_scope,effective_group,observed_document_count,observed_dimension_counts,coverage_status,leaderboard_eligible,eligibility_reasons,gcs_bucket,gcs_prefix,head_branch,head_sha,source_created_at,completed_at,summary,dataset_versions(repository,resolved_sha,profile,document_count,dimension_counts)";

export type DatasetVersion = {
  repository: string;
  resolved_sha: string;
  profile: string | null;
  document_count: number | null;
  dimension_counts: Record<string, number>;
};

export type BenchmarkRun = {
  id: number;
  github_run_id: number;
  github_run_attempt: number;
  github_run_url: string | null;
  run_name: string | null;
  event: string | null;
  status: string;
  conclusion: string | null;
  artifact_state: string;
  pipeline_name: string | null;
  pipeline_config: Record<string, unknown>;
  run_scope: string | null;
  selected_group: string | null;
  requested_scope: string | null;
  requested_group: string | null;
  effective_scope: string | null;
  effective_group: string | null;
  observed_document_count: number | null;
  observed_dimension_counts: Record<string, number>;
  coverage_status: string;
  leaderboard_eligible: boolean;
  eligibility_reasons: string[];
  gcs_bucket: string | null;
  gcs_prefix: string | null;
  head_branch: string | null;
  head_sha: string | null;
  source_created_at: string | null;
  completed_at: string | null;
  summary: Record<string, unknown>;
  dataset_versions: DatasetVersion | null;
};

export type RunDimension = {
  id: number;
  run_id: number;
  dimension: string;
  status: string;
  total_examples: number | null;
  successful: number | null;
  failed: number | null;
  skipped: number | null;
  report_relative_path: string | null;
};

export type DimensionMetric = {
  id: number;
  run_dimension_id: number;
  metric_name: string;
  metric_value: number;
};

export type RunComponent = {
  id: number;
  component: string;
  repository: string | null;
  requested_ref: string | null;
  resolved_sha: string | null;
  installed_version: string | null;
};

export type RunError = {
  id: number;
  stage: string;
  test_id: string | null;
  error_type: string | null;
  message: string;
  occurred_at: string | null;
};

export type BenchmarkCase = {
  id: number;
  test_id: string;
  pdf_relative_path: string | null;
  source_relative_path: string | null;
  source_media_type: string | null;
  page_number: number | null;
  inference_group: string | null;
  tags: string[];
  ground_truth_locator: Record<string, unknown>;
  dataset_versions: DatasetVersion;
};

export type CaseResult = {
  id: number;
  success: boolean;
  error: string | null;
  primary_metric_name: string | null;
  primary_score: number | null;
  result_relative_path: string | null;
  raw_relative_path: string | null;
  diagnostic_relative_path: string | null;
  diagnostic_schema_version: number | null;
  stats: Record<string, { value?: number | string; unit?: string }>;
  tags: string[];
  run_dimensions: Pick<RunDimension, "id" | "run_id" | "dimension">;
  benchmark_cases: BenchmarkCase;
};

export type HistoricalBestRun = Pick<
  BenchmarkRun,
  | "id"
  | "github_run_id"
  | "github_run_url"
  | "run_name"
  | "pipeline_name"
  | "gcs_bucket"
  | "gcs_prefix"
  | "head_branch"
  | "head_sha"
  | "source_created_at"
>;

export type HistoricalBestResult = {
  result: CaseResult;
  run: HistoricalBestRun;
};

export type CaseMetric = {
  id: number;
  metric_name: string;
  metric_value: number;
  passed_count: number | null;
  total_count: number | null;
};

export type RunBundle = {
  dimensions: RunDimension[];
  metrics: DimensionMetric[];
  components: RunComponent[];
  errors: RunError[];
};

export type RunScoreSummary = {
  aggregate: number | null;
  dimensions: Record<string, number>;
};

export type RunScoreIndex = Record<number, RunScoreSummary>;

export type DocumentSort = "lowest" | "highest" | "document";

const CASE_RESULT_SELECT =
  "id,success,error,primary_metric_name,primary_score,result_relative_path,raw_relative_path,diagnostic_relative_path,diagnostic_schema_version,stats,tags,run_dimensions!inner(id,run_id,dimension),benchmark_cases!inner(id,test_id,pdf_relative_path,source_relative_path,source_media_type,page_number,inference_group,tags,ground_truth_locator,dataset_versions!inner(repository,resolved_sha))";

const HISTORICAL_BEST_SELECT =
  "id,success,error,primary_metric_name,primary_score,result_relative_path,raw_relative_path,diagnostic_relative_path,diagnostic_schema_version,stats,tags,run_dimensions!inner(id,run_id,dimension,benchmark_runs!inner(id,github_run_id,github_run_url,run_name,pipeline_name,gcs_bucket,gcs_prefix,head_branch,head_sha,source_created_at)),benchmark_cases!inner(id,test_id,pdf_relative_path,source_relative_path,source_media_type,page_number,inference_group,tags,ground_truth_locator,dataset_versions!inner(repository,resolved_sha))";

function configurationError() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }
}

async function apiFetch<T>(
  table: string,
  params: URLSearchParams,
  signal?: AbortSignal,
): Promise<T> {
  configurationError();
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?${params.toString()}`,
    {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY!,
      },
      signal,
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Could not load ${table} (${response.status}): ${detail}`);
  }
  return (await response.json()) as T;
}

const RUN_CATALOG_PAGE_SIZE = 500;

export async function loadRuns(signal?: AbortSignal) {
  const runs: BenchmarkRun[] = [];

  for (let offset = 0; ;) {
    const page = await apiFetch<BenchmarkRun[]>(
      "benchmark_runs",
      new URLSearchParams({
        select: RUN_SELECT,
        order: "source_created_at.desc.nullslast,id.desc",
        limit: String(RUN_CATALOG_PAGE_SIZE),
        offset: String(offset),
      }),
      signal,
    );
    if (!page.length) return runs;
    runs.push(...page);
    offset += page.length;
  }
}

export async function loadRun(githubRunId: number, signal?: AbortSignal) {
  const rows = await apiFetch<BenchmarkRun[]>(
    "benchmark_runs",
    new URLSearchParams({
      select: RUN_SELECT,
      github_run_id: `eq.${githubRunId}`,
      order: "github_run_attempt.desc,id.desc",
      limit: "1",
    }),
    signal,
  );
  return rows[0] ?? null;
}

export async function loadRunScores(
  runIds: number[],
  signal?: AbortSignal,
): Promise<RunScoreIndex> {
  if (!runIds.length) return {};

  type ScoredDimension = {
    run_id: number;
    dimension: string;
    run_dimension_metrics: Array<Pick<DimensionMetric, "metric_name" | "metric_value">>;
  };

  const batchSize = 100;
  const batches: number[][] = [];
  for (let index = 0; index < runIds.length; index += batchSize) {
    batches.push(runIds.slice(index, index + batchSize));
  }

  const rows = (
    await Promise.all(
      batches.map((batch) =>
        apiFetch<ScoredDimension[]>(
          "run_dimensions",
          new URLSearchParams({
            select:
              "run_id,dimension,run_dimension_metrics(metric_name,metric_value)",
            run_id: `in.(${batch.join(",")})`,
            "run_dimension_metrics.metric_name": `in.(${PRIMARY_METRICS.join(",")})`,
            limit: String(batch.length * Object.keys(PRIMARY_METRIC_BY_DIMENSION).length),
          }),
          signal,
        ),
      ),
    )
  ).flat();

  const scoreIndex: RunScoreIndex = Object.fromEntries(
    runIds.map((runId) => [runId, { aggregate: null, dimensions: {} }]),
  );
  for (const row of rows) {
    const metricName = PRIMARY_METRIC_BY_DIMENSION[row.dimension];
    const metric = row.run_dimension_metrics.find(
      (candidate) => candidate.metric_name === metricName,
    );
    if (metric && Number.isFinite(metric.metric_value)) {
      scoreIndex[row.run_id].dimensions[row.dimension] = metric.metric_value;
    }
  }
  for (const summary of Object.values(scoreIndex)) {
    const values = Object.values(summary.dimensions);
    summary.aggregate = values.length
      ? values.reduce((total, value) => total + value, 0) / values.length
      : null;
  }
  return scoreIndex;
}

export async function loadRunBundle(
  runId: number,
  signal?: AbortSignal,
): Promise<RunBundle> {
  const dimensions = await apiFetch<RunDimension[]>(
    "run_dimensions",
    new URLSearchParams({
      select:
        "id,run_id,dimension,status,total_examples,successful,failed,skipped,report_relative_path",
      run_id: `eq.${runId}`,
      order: "dimension.asc",
    }),
    signal,
  );
  const dimensionIds = dimensions.map((dimension) => dimension.id);
  const [metrics, components, errors] = await Promise.all([
    dimensionIds.length
      ? apiFetch<DimensionMetric[]>(
          "run_dimension_metrics",
          new URLSearchParams({
            select: "id,run_dimension_id,metric_name,metric_value",
            run_dimension_id: `in.(${dimensionIds.join(",")})`,
            metric_name: `in.(${PRIMARY_METRICS.join(",")})`,
          }),
          signal,
        )
      : Promise.resolve([]),
    apiFetch<RunComponent[]>(
      "run_components",
      new URLSearchParams({
        select:
          "id,component,repository,requested_ref,resolved_sha,installed_version",
        run_id: `eq.${runId}`,
        order: "component.asc",
      }),
      signal,
    ),
    apiFetch<RunError[]>(
      "run_errors",
      new URLSearchParams({
        select: "id,stage,test_id,error_type,message,occurred_at",
        run_id: `eq.${runId}`,
        order: "occurred_at.desc.nullslast,id.desc",
        limit: "24",
      }),
      signal,
    ),
  ]);
  return { dimensions, metrics, components, errors };
}

export function loadDocuments(
  runId: number,
  options: {
    dimension?: string;
    search?: string;
    floor?: number;
    ceiling?: number;
    sort?: DocumentSort;
    limit?: number;
    offset?: number;
  } = {},
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    select: CASE_RESULT_SELECT,
    "run_dimensions.run_id": `eq.${runId}`,
    order: options.sort === "highest"
      ? "primary_score.desc.nullslast,id.asc"
      : options.sort === "document"
        ? "benchmark_cases(id).asc,id.asc"
        : "primary_score.asc.nullslast,id.asc",
    limit: String(options.limit ?? 120),
    offset: String(options.offset ?? 0),
  });
  if (options.dimension && options.dimension !== "all") {
    params.set("run_dimensions.dimension", `eq.${options.dimension}`);
  }
  if (options.floor != null) {
    params.append("primary_score", `gte.${Math.max(0, Math.min(1, options.floor))}`);
  }
  if (options.ceiling != null) {
    params.append("primary_score", `lte.${Math.max(0, Math.min(1, options.ceiling))}`);
  }
  if (options.search?.trim()) {
    const escapedSearch = options.search
      .trim()
      .replaceAll("\\", "\\\\")
      .replaceAll("%", "\\%")
      .replaceAll("_", "\\_")
      .replaceAll("*", "\\*");
    params.set(
      "benchmark_cases.test_id",
      `ilike.*${escapedSearch}*`,
    );
  }
  configurationError();
  return fetch(
    `${SUPABASE_URL}/rest/v1/case_results?${params.toString()}`,
    {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY!,
        Prefer: "count=exact",
      },
      signal,
    },
  ).then(async (response) => {
    const contentRange = response.headers.get("content-range");
    const totalValue = contentRange?.split("/").at(-1);
    const rangedTotal = totalValue && totalValue !== "*" ? Number(totalValue) : null;
    if (response.status === 416 && rangedTotal != null && Number.isFinite(rangedTotal)) {
      await response.body?.cancel();
      return { documents: [], total: rangedTotal };
    }
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Could not load case_results (${response.status}): ${detail}`);
    }
    const documents = (await response.json()) as CaseResult[];
    const total = rangedTotal ?? documents.length;
    return { documents, total: Number.isFinite(total) ? total : documents.length };
  });
}

export async function loadDocument(
  runId: number,
  caseResultId: number,
  signal?: AbortSignal,
) {
  const documents = await apiFetch<CaseResult[]>(
    "case_results",
    new URLSearchParams({
      select: CASE_RESULT_SELECT,
      id: `eq.${caseResultId}`,
      "run_dimensions.run_id": `eq.${runId}`,
      limit: "1",
    }),
    signal,
  );
  return documents[0] ?? null;
}

export async function loadHistoricalBestResult(
  current: CaseResult,
  minimumImprovement = 0.1,
  signal?: AbortSignal,
): Promise<HistoricalBestResult | null> {
  const currentScore = current.primary_score;
  if (currentScore == null || !Number.isFinite(currentScore)) return null;
  const minimumScore = Math.round((currentScore + minimumImprovement) * 1e12) / 1e12;
  if (minimumScore > 1) return null;

  type HistoricalBestRow = Omit<CaseResult, "run_dimensions"> & {
    run_dimensions: CaseResult["run_dimensions"] & {
      benchmark_runs: HistoricalBestRun;
    };
  };

  const params = new URLSearchParams({
    select: HISTORICAL_BEST_SELECT,
    benchmark_case_id: `eq.${current.benchmark_cases.id}`,
    "run_dimensions.dimension": `eq.${current.run_dimensions.dimension}`,
    primary_score: `gte.${minimumScore}`,
    order: "primary_score.desc.nullslast,id.desc",
    limit: "1",
  });
  if (current.primary_metric_name) {
    params.set("primary_metric_name", `eq.${current.primary_metric_name}`);
  }

  const rows = await apiFetch<HistoricalBestRow[]>("case_results", params, signal);
  const candidate = rows[0];
  if (!candidate) return null;
  const { benchmark_runs: run, ...runDimension } = candidate.run_dimensions;
  return {
    result: {
      ...candidate,
      run_dimensions: runDimension,
    },
    run,
  };
}

export function loadCaseMetrics(caseResultId: number, signal?: AbortSignal) {
  return apiFetch<CaseMetric[]>(
    "case_metrics",
    new URLSearchParams({
      select: "id,metric_name,metric_value,passed_count,total_count",
      case_result_id: `eq.${caseResultId}`,
      order: "metric_name.asc",
      limit: "120",
    }),
    signal,
  );
}

function encodePath(path: string) {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function artifactUrl(
  run: Pick<BenchmarkRun, "gcs_bucket" | "gcs_prefix">,
  relativePath: string | null,
) {
  if (!run.gcs_bucket || !run.gcs_prefix || !relativePath) return null;
  return `https://storage.googleapis.com/${encodeURIComponent(run.gcs_bucket)}/${encodePath(`${run.gcs_prefix}/${relativePath}`)}`;
}

export function datasetFileUrl(
  dataset: DatasetVersion,
  relativePath: string,
) {
  return `https://huggingface.co/datasets/${encodePath(dataset.repository)}/resolve/${encodeURIComponent(dataset.resolved_sha)}/${encodePath(relativePath)}`;
}

export function sourceAssetUrl(result: CaseResult) {
  const path = result.benchmark_cases.source_relative_path;
  return path
    ? datasetFileUrl(result.benchmark_cases.dataset_versions, path)
    : null;
}

export function sourceAssetKind(result: CaseResult) {
  const { source_media_type: mediaType, source_relative_path: path } =
    result.benchmark_cases;
  const suffix = path?.split(".").at(-1)?.toLowerCase();
  if (mediaType === "application/pdf" || suffix === "pdf") return "pdf";
  if (mediaType?.startsWith("image/") || ["png", "jpg", "jpeg", "jfif"].includes(suffix ?? "")) {
    return "image";
  }
  return "unsupported";
}

const THUMBNAIL_BUCKET =
  process.env.NEXT_PUBLIC_THUMBNAIL_BUCKET ?? "parsebench-thumbnails-457820";

export function thumbnailUrl(result: CaseResult) {
  const revision = result.benchmark_cases.dataset_versions.resolved_sha;
  const testId = result.benchmark_cases.test_id;
  if (!revision || !testId) return null;
  return `https://storage.googleapis.com/${encodeURIComponent(THUMBNAIL_BUCKET)}/${encodePath(`${revision}/docs/${testId}.webp`)}`;
}

export async function loadArtifact(
  run: Pick<BenchmarkRun, "gcs_bucket" | "gcs_prefix">,
  result: CaseResult,
  signal?: AbortSignal,
) {
  const url = artifactUrl(run, result.result_relative_path);
  if (!url) return { url: null, markdown: "" };
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Artifact returned ${response.status}`);
  }
  const artifact = (await response.json()) as {
    output?: {
      markdown?: string;
      pages?: Array<{ markdown?: string }>;
    };
  };
  const markdown =
    artifact.output?.markdown ??
    artifact.output?.pages
      ?.map((page) => page.markdown ?? "")
      .filter(Boolean)
      .join("\n\n") ??
    "";
  return { url, markdown };
}

export async function loadDiagnostic(
  run: Pick<BenchmarkRun, "gcs_bucket" | "gcs_prefix">,
  result: CaseResult,
  signal?: AbortSignal,
) {
  const url = artifactUrl(run, result.diagnostic_relative_path);
  if (!url || result.diagnostic_schema_version == null) {
    return { url: null, diagnostic: null };
  }
  if (![1, 2].includes(result.diagnostic_schema_version)) {
    throw new Error(
      `Diagnostic schema ${result.diagnostic_schema_version} is not supported by this dashboard.`,
    );
  }

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Diagnostic artifact returned ${response.status}`);
  }
  const diagnostic = (await response.json()) as DiagnosticArtifact;
  if (
    Number(diagnostic.schema_version) !== result.diagnostic_schema_version ||
    diagnostic.test_id !== result.benchmark_cases.test_id ||
    diagnostic.dimension !== result.run_dimensions.dimension
  ) {
    throw new Error("Diagnostic artifact does not match this benchmark case.");
  }
  return { url, diagnostic };
}

const tableGroundTruthCache = new Map<string, Promise<Map<string, string>>>();

async function tableGroundTruthIndex(dataset: DatasetVersion) {
  const cacheKey = `${dataset.repository}@${dataset.resolved_sha}`;
  const existing = tableGroundTruthCache.get(cacheKey);
  if (existing) return existing;
  const pending = fetch(datasetFileUrl(dataset, "table.jsonl"))
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Ground truth returned ${response.status}`);
      }
      const text = await response.text();
      const index = new Map<string, string>();
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        const record = JSON.parse(line) as {
          pdf?: string;
          expected_markdown?: string;
        };
        if (record.pdf && record.expected_markdown) {
          index.set(record.pdf, record.expected_markdown);
        }
      }
      return index;
    })
    .catch((error) => {
      tableGroundTruthCache.delete(cacheKey);
      throw error;
    });
  tableGroundTruthCache.set(cacheKey, pending);
  return pending;
}

export async function loadGroundTruth(result: CaseResult) {
  if (result.run_dimensions.dimension !== "table") return null;
  const sourcePath = result.benchmark_cases.source_relative_path;
  if (!sourcePath) return null;
  const index = await tableGroundTruthIndex(
    result.benchmark_cases.dataset_versions,
  );
  return index.get(sourcePath) ?? null;
}

export function primaryMetricForDimension(
  dimension: RunDimension,
  metrics: DimensionMetric[],
) {
  return metrics.find(
    (metric) =>
      metric.run_dimension_id === dimension.id &&
      metric.metric_name === PRIMARY_METRIC_BY_DIMENSION[dimension.dimension],
  );
}

export function humanize(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value
    .replace(/^avg_/, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
