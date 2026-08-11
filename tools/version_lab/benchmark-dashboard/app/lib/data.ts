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

export type DatasetVersion = {
  repository: string;
  resolved_sha: string;
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
  stats: Record<string, { value?: number | string; unit?: string }>;
  tags: string[];
  run_dimensions: Pick<RunDimension, "id" | "run_id" | "dimension">;
  benchmark_cases: BenchmarkCase;
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

export function loadRuns(signal?: AbortSignal) {
  return apiFetch<BenchmarkRun[]>(
    "benchmark_runs",
    new URLSearchParams({
      select:
        "id,github_run_id,github_run_attempt,github_run_url,run_name,event,status,conclusion,artifact_state,pipeline_name,pipeline_config,run_scope,selected_group,gcs_bucket,gcs_prefix,head_branch,head_sha,source_created_at,completed_at,summary,dataset_versions(repository,resolved_sha)",
      order: "source_created_at.desc.nullslast,id.desc",
      limit: "500",
    }),
    signal,
  );
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
    ceiling?: number;
    limit?: number;
    offset?: number;
  } = {},
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    select:
      "id,success,error,primary_metric_name,primary_score,result_relative_path,raw_relative_path,stats,tags,run_dimensions!inner(id,run_id,dimension),benchmark_cases!inner(id,test_id,pdf_relative_path,page_number,inference_group,tags,ground_truth_locator,dataset_versions!inner(repository,resolved_sha))",
    "run_dimensions.run_id": `eq.${runId}`,
    order: "primary_score.asc.nullslast,id.asc",
    limit: String(options.limit ?? 120),
    offset: String(options.offset ?? 0),
  });
  if (options.dimension && options.dimension !== "all") {
    params.set("run_dimensions.dimension", `eq.${options.dimension}`);
  }
  if (options.ceiling != null) {
    params.set("primary_score", `lte.${Math.max(0, Math.min(1, options.ceiling))}`);
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
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Could not load case_results (${response.status}): ${detail}`);
    }
    const contentRange = response.headers.get("content-range");
    const totalValue = contentRange?.split("/").at(-1);
    const documents = (await response.json()) as CaseResult[];
    const total = totalValue && totalValue !== "*" ? Number(totalValue) : documents.length;
    return { documents, total: Number.isFinite(total) ? total : documents.length };
  });
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

export function artifactUrl(run: BenchmarkRun, relativePath: string | null) {
  if (!run.gcs_bucket || !run.gcs_prefix || !relativePath) return null;
  return `https://storage.googleapis.com/${encodeURIComponent(run.gcs_bucket)}/${encodePath(`${run.gcs_prefix}/${relativePath}`)}`;
}

export function datasetFileUrl(
  dataset: DatasetVersion,
  relativePath: string,
) {
  return `https://huggingface.co/datasets/${encodePath(dataset.repository)}/resolve/${encodeURIComponent(dataset.resolved_sha)}/${encodePath(relativePath)}`;
}

export function pdfUrl(result: CaseResult) {
  const path = result.benchmark_cases.pdf_relative_path;
  return path
    ? datasetFileUrl(result.benchmark_cases.dataset_versions, path)
    : null;
}

export async function loadArtifact(
  run: BenchmarkRun,
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
  const pdf = result.benchmark_cases.pdf_relative_path;
  if (!pdf) return null;
  const index = await tableGroundTruthIndex(
    result.benchmark_cases.dataset_versions,
  );
  return index.get(pdf) ?? null;
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
