"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import {
  artifactUrl,
  BenchmarkRun,
  CaseMetric,
  CaseResult,
  DocumentSort,
  DimensionMetric,
  HistoricalBestResult,
  humanize,
  loadArtifact,
  loadCaseMetrics,
  loadDiagnostic,
  loadDocument,
  loadDocuments,
  loadGroundTruth,
  loadHistoricalBestResult,
  loadRun,
  loadRunBundle,
  loadRunScores,
  loadRuns,
  primaryMetricForDimension,
  RunBundle,
  RunDimension,
  RunScoreIndex,
  sourceAssetKind,
  sourceAssetUrl,
  thumbnailUrl,
} from "./lib/data";
import {
  DiagnosticInspector,
  GroundTruthInspector,
  type DiagnosticArtifact,
  type DiagnosticMetric,
} from "./diagnostics";
import { EvidenceOverlay, type EvidenceOverlayBox } from "./evidence-overlay";

type View = "runs" | "overview" | "triage" | "inspect";

type MarkdownMode = "preview" | "source";
type InspectorTab = "explain" | "output" | "expectations" | "best" | "json";
type RunSort = "newest" | "oldest" | "largest" | "fastest";
const ANY_GROUP = "__any_group__";
type ArtifactState = {
  loading: boolean;
  markdown: string;
  reference: string | null;
  url: string | null;
  error: string | null;
};

type DiagnosticState = {
  loading: boolean;
  data: DiagnosticArtifact | null;
  url: string | null;
  error: string | null;
};

type HistoricalBestState = {
  data: HistoricalBestResult | null;
  evidenceStatus: "idle" | "loading" | "loaded";
  diagnostic: DiagnosticArtifact | null;
  diagnosticError: string | null;
  artifact: ArtifactState;
  error: string | null;
};

const PdfPreview = dynamic(() => import("./pdf-preview"), {
  ssr: false,
  loading: () => <div className="artifact-loading">Loading PDF viewer…</div>,
});

const EMPTY_BUNDLE: RunBundle = {
  dimensions: [],
  metrics: [],
  components: [],
  errors: [],
};

const EMPTY_ARTIFACT: ArtifactState = {
  loading: false,
  markdown: "",
  reference: null,
  url: null,
  error: null,
};

const EMPTY_DIAGNOSTIC: DiagnosticState = {
  loading: false,
  data: null,
  url: null,
  error: null,
};

const EMPTY_HISTORICAL_BEST: HistoricalBestState = {
  data: null,
  evidenceStatus: "idle",
  diagnostic: null,
  diagnosticError: null,
  artifact: EMPTY_ARTIFACT,
  error: null,
};

const BEST_SCORE_MINIMUM_IMPROVEMENT = 0.1;

const DIMENSION_LABELS: Record<string, string> = {
  chart: "Charts",
  layout: "Layout",
  table: "Tables",
  text_content: "Text content",
  text_formatting: "Formatting",
};

const DIMENSION_ORDER = [
  "table",
  "text_content",
  "text_formatting",
  "layout",
  "chart",
] as const;

const DIMENSION_SHORT_LABELS: Record<(typeof DIMENSION_ORDER)[number], string> = {
  chart: "Chart",
  layout: "Layout",
  table: "Table",
  text_content: "Text",
  text_formatting: "Format",
};

const TRIAGE_PAGE_SIZE = 60;
const DIAGNOSTIC_LIST_PAGE_SIZE = 60;

function orderRunDimensions(dimensions: RunDimension[]) {
  const rank = new Map<string, number>(
    DIMENSION_ORDER.map((dimension, index) => [dimension, index]),
  );
  return [...dimensions].sort(
    (left, right) =>
      (rank.get(left.dimension) ?? Number.POSITIVE_INFINITY) -
      (rank.get(right.dimension) ?? Number.POSITIVE_INFINITY),
  );
}

type TriageFilters = {
  dimension: string;
  search: string;
  minimum: number;
  maximum: number;
  sort: DocumentSort;
  page: number;
};

function documentName(result: CaseResult) {
  return result.benchmark_cases.test_id.split("/").at(-1) ?? result.benchmark_cases.test_id;
}

function parsePercent(value: string | null, fallback: number) {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : fallback;
}

function parsePage(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed - 1 : 0;
}

function normalizeTriageFilters(filters: TriageFilters): TriageFilters {
  const firstBound = Math.max(0, Math.min(100, filters.minimum));
  const secondBound = Math.max(0, Math.min(100, filters.maximum));
  return {
    ...filters,
    minimum: Math.min(firstBound, secondBound),
    maximum: Math.max(firstBound, secondBound),
    page: Number.isInteger(filters.page) ? Math.max(0, filters.page) : 0,
  };
}

function triageQuery(filters: TriageFilters) {
  const query = new URLSearchParams();
  query.set("dimension", filters.dimension);
  if (filters.search.trim()) query.set("q", filters.search.trim());
  if (filters.minimum > 0) query.set("min", String(filters.minimum));
  if (filters.maximum < 100) query.set("max", String(filters.maximum));
  if (filters.sort !== "lowest") query.set("sort", filters.sort);
  if (filters.page > 0) query.set("page", String(filters.page + 1));
  return query;
}

function hrefWithTriageFilters(path: string, filters: TriageFilters) {
  const query = triageQuery(filters);
  return query.size ? `${path}?${query.toString()}` : path;
}

function scorePercent(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en", {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(value);
}

function isCountMetric(metricName: string) {
  const normalizedName = metricName.toLowerCase();
  return normalizedName.startsWith("num_") ||
    /^n_(?:gt|pred|ground_truth|predictions?)(?:_|$)/.test(normalizedName) ||
    /^tables_(?:expected|actual|paired|unparseable|unmatched)(?:_|$)/.test(normalizedName) ||
    /^unmatched_(?:gt|pred)(?:_|$)/.test(normalizedName) ||
    /_(?:count|counts)$/.test(normalizedName);
}

function metricDisplay(metricName: string, value: number | null | undefined) {
  if (!isCountMetric(metricName)) return scorePercent(value);
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function diagnosticMetricDisplay(metric: DiagnosticMetric) {
  return metricDisplay(metric.metric_name, metric.value);
}

function scoreTone(value: number | null | undefined) {
  if (value == null) return "neutral";
  if (value < 0.45) return "critical";
  if (value < 0.75) return "warning";
  return "good";
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizedBox(value: unknown) {
  if (!Array.isArray(value) || value.length < 4) return null;
  const coordinates = value.slice(0, 4).map(finiteNumber);
  if (coordinates.some((coordinate) => coordinate == null)) return null;
  const [x, y, width, height] = coordinates as [number, number, number, number];
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function normalizedCornerBox(value: unknown) {
  if (!Array.isArray(value) || value.length < 4) return null;
  const coordinates = value.slice(0, 4).map(finiteNumber);
  if (coordinates.some((coordinate) => coordinate == null)) return null;
  const [x1, y1, x2, y2] = coordinates as [number, number, number, number];
  return normalizedBox([x1, y1, x2 - x1, y2 - y1]);
}

function layoutEvidenceStatus(outcome: Record<string, unknown>) {
  const applicable = [
    outcome.localization_pass,
    outcome.classification_pass,
    outcome.attribution_applicable === true ? outcome.attribution_pass : undefined,
  ].filter((value): value is boolean => typeof value === "boolean");
  if (!applicable.length) return "neutral" as const;
  if (applicable.every(Boolean)) return "passed" as const;
  if (applicable.some(Boolean)) return "partial" as const;
  return "failed" as const;
}

function layoutOverlayBoxes(
  diagnostic: DiagnosticArtifact | null,
  layers: { expected: boolean; predicted: boolean },
) {
  if (!diagnostic || diagnostic.dimension !== "layout") return [];
  const boxes: EvidenceOverlayBox[] = [];
  const compactOutcomes = (diagnostic.outcomes ?? [])
    .map(objectValue)
    .filter((value): value is Record<string, unknown> => value != null);
  const metricOutcomes = diagnostic.metrics
    .flatMap((metric) => {
      const results = objectValue(metric.metadata)?.rule_results;
      return Array.isArray(results)
        ? results.map(objectValue).filter((value): value is Record<string, unknown> => value != null)
        : [];
    });
  const outcomes = compactOutcomes.length ? compactOutcomes : metricOutcomes;
  const outcomesById = new Map<string, Record<string, unknown>>();
  for (const outcome of outcomes) {
    const id = [outcome.element_id, outcome.id, outcome.rule_id]
      .find((value): value is string => typeof value === "string");
    if (id) outcomesById.set(id, outcome);
  }

  for (const expectation of diagnostic.expectations) {
    const rule = objectValue(expectation.rule);
    const outcome = outcomesById.get(expectation.id);
    const expectedClass = typeof rule?.canonical_class === "string"
      ? rule.canonical_class
      : "Expected element";
    const status = outcome ? layoutEvidenceStatus(outcome) : "neutral";
    if (layers.expected) {
      const box = normalizedBox(rule?.bbox);
      if (box) {
        boxes.push({
          ...box,
          id: expectation.id,
          kind: "ground-truth",
          label: expectedClass,
          status,
        });
      }
    }
    if (layers.predicted && outcome) {
      const box = normalizedCornerBox(outcome.best_pred_bbox);
      if (box) {
        boxes.push({
          ...box,
          id: expectation.id,
          kind: "prediction",
          label: typeof outcome.best_pred_class === "string"
            ? outcome.best_pred_class
            : "Predicted element",
          status,
        });
      }
    }
  }
  return boxes;
}

function formatDate(value: string | null) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatShortDate(value: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function shortSha(value: string | null | undefined) {
  return value ? value.slice(0, 8) : "unknown";
}

function scopeLabel(value: string | null | undefined) {
  if (value === "full") return "Full dataset";
  if (value === "test") return "Quick test";
  return humanize(value);
}

type GitHubCommitReference = {
  apiUrl: string;
  webUrl: string;
};

const commitMessageCache = new Map<string, Promise<string>>();

function githubCommitReference(
  repository: string | null,
  sha: string | null,
): GitHubCommitReference | null {
  const normalizedRepository = repository
    ?.trim()
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "");
  if (
    !normalizedRepository ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalizedRepository) ||
    !sha ||
    !/^[a-f0-9]{7,40}$/i.test(sha)
  ) {
    return null;
  }
  const [owner, name] = normalizedRepository.split("/");
  return {
    apiUrl: `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(sha)}`,
    webUrl: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commit/${encodeURIComponent(sha)}`,
  };
}

function loadGitHubCommitMessage(reference: GitHubCommitReference) {
  const cached = commitMessageCache.get(reference.apiUrl);
  if (cached) return cached;
  const request = fetch(reference.apiUrl, {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`GitHub returned ${response.status}`);
      }
      const payload = (await response.json()) as {
        commit?: { message?: string };
      };
      const message = payload.commit?.message?.trim();
      if (!message) throw new Error("GitHub did not return a commit message");
      return message;
    })
    .catch((error) => {
      commitMessageCache.delete(reference.apiUrl);
      throw error;
    });
  commitMessageCache.set(reference.apiUrl, request);
  return request;
}

function CommitLink({
  repository,
  sha,
}: {
  repository: string | null;
  sha: string | null;
}) {
  const reference = githubCommitReference(repository, sha);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const tooltipId = useId();

  if (!reference) return <code>{shortSha(sha)}</code>;

  function requestMessage() {
    if (message || loading || unavailable) return;
    setLoading(true);
    setUnavailable(false);
    loadGitHubCommitMessage(reference!)
      .then(setMessage)
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false));
  }

  const tooltip = message ??
    (unavailable ? "Commit message unavailable from GitHub" : "Loading commit message…");

  return (
    <span
      className="commit-link-wrap"
      onMouseEnter={requestMessage}
      onFocus={requestMessage}
    >
      <a
        className="commit-link"
        href={reference.webUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open commit ${shortSha(sha)} in ${repository} on GitHub`}
        aria-describedby={tooltipId}
      >
        <code>{shortSha(sha)}</code>
        <span className="commit-link-icon" aria-hidden="true">↗</span>
      </a>
      <span
        className="commit-tooltip"
        id={tooltipId}
        role="tooltip"
        aria-live="polite"
      >
        {tooltip}
      </span>
    </span>
  );
}

function summaryNumber(run: BenchmarkRun, key: string) {
  const value = run.summary?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatCompact(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatLatency(value: number | null | undefined) {
  if (value == null) return "—";
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`;
}

function durationMinutes(run: BenchmarkRun) {
  if (!run.source_created_at || !run.completed_at) return null;
  const started = new Date(run.source_created_at).getTime();
  const completed = new Date(run.completed_at).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return null;
  return Math.round((completed - started) / 60_000);
}

function formatDuration(minutes: number | null) {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function uniqueValues(runs: BenchmarkRun[], field: keyof BenchmarkRun) {
  return [...new Set(runs.map((run) => run[field]).filter((value): value is string => typeof value === "string" && Boolean(value)))];
}

function countDocuments(bundle: RunBundle) {
  return bundle.dimensions.reduce(
    (total, dimension) => total + (dimension.total_examples ?? 0),
    0,
  );
}

function overallScore(bundle: RunBundle) {
  const scores = bundle.dimensions
    .map(
      (dimension) =>
        primaryMetricForDimension(dimension, bundle.metrics)?.metric_value,
    )
    .filter((value): value is number => typeof value === "number");
  if (!scores.length) return null;
  return scores.reduce((total, value) => total + value, 0) / scores.length;
}

function scoreWidth(value: number | null | undefined) {
  return `${Math.max(0, Math.min(100, (value ?? 0) * 100))}%`;
}

function StatusBadge({ value }: { value: string | null }) {
  const normalized = value ?? "unknown";
  return (
    <span className={`status-badge status-${normalized}`}>
      <span className="status-dot" />
      {humanize(normalized)}
    </span>
  );
}

function ScoreBar({ score }: { score: number | null | undefined }) {
  return (
    <div className="score-track" aria-label={`Score ${scorePercent(score)}`}>
      <span
        className={`score-fill score-fill-${scoreTone(score)}`}
        style={{ width: scoreWidth(score) }}
      />
    </div>
  );
}

function MarkdownPanel({ markdown }: { markdown: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function EmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function LazyJsonDetails({
  label,
  code,
  value,
  className = "expectation-row",
}: {
  label: ReactNode;
  code?: string;
  value: unknown;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details className={className} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {label}
        {code && <code>{code}</code>}
      </summary>
      {open && <pre><code>{JSON.stringify(value, null, 2)}</code></pre>}
    </details>
  );
}

function PaginatedJsonList<T>({
  items,
  labelFor,
  codeFor,
}: {
  items: T[];
  labelFor: (item: T, index: number) => ReactNode;
  codeFor?: (item: T, index: number) => string | undefined;
}) {
  const [visible, setVisible] = useState(DIAGNOSTIC_LIST_PAGE_SIZE);
  const rendered = items.slice(0, visible);
  return (
    <div className="expectation-list diagnostic-json-items">
      {rendered.map((item, index) => (
        <LazyJsonDetails
          key={`${codeFor?.(item, index) ?? "item"}-${index}`}
          label={labelFor(item, index)}
          code={codeFor?.(item, index)}
          value={item}
        />
      ))}
      {rendered.length < items.length && (
        <button
          className="diagnostic-load-more"
          type="button"
          onClick={() => setVisible((current) => current + DIAGNOSTIC_LIST_PAGE_SIZE)}
        >
          Show {Math.min(DIAGNOSTIC_LIST_PAGE_SIZE, items.length - rendered.length)} more · {(items.length - rendered.length).toLocaleString()} remaining
        </button>
      )}
    </div>
  );
}

function DiagnosticMetricJson({ metric }: { metric: DiagnosticMetric }) {
  const [open, setOpen] = useState(false);
  const metadata = metric.metadata ?? {};
  const rawRuleResults = metadata.rule_results;
  const ruleResults = Array.isArray(rawRuleResults) ? rawRuleResults : [];
  const metadataWithoutRuleResults = { ...metadata };
  delete metadataWithoutRuleResults.rule_results;
  const compactMetric = {
    ...metric,
    metadata: {
      ...metadataWithoutRuleResults,
      ...(ruleResults.length ? { rule_results: `${ruleResults.length.toLocaleString()} entries shown below` } : {}),
    },
  };
  return (
    <details className="expectation-row diagnostic-json-metric" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <strong>{humanize(metric.metric_name)}</strong>
        <code>{diagnosticMetricDisplay(metric)}</code>
      </summary>
      {open && (
        <>
          <pre><code>{JSON.stringify(compactMetric, null, 2)}</code></pre>
          {ruleResults.length > 0 && (
            <PaginatedJsonList
              items={ruleResults}
              labelFor={(outcome, index) => {
                const record = typeof outcome === "object" && outcome !== null && !Array.isArray(outcome)
                  ? outcome as Record<string, unknown>
                  : null;
                return <strong>{humanize(String(record?.type ?? `Outcome ${index + 1}`))}</strong>;
              }}
              codeFor={(outcome, index) => {
                const record = typeof outcome === "object" && outcome !== null && !Array.isArray(outcome)
                  ? outcome as Record<string, unknown>
                  : null;
                return String(record?.id ?? index + 1);
              }}
            />
          )}
        </>
      )}
    </details>
  );
}

function DiagnosticJsonBrowser({ diagnostic }: { diagnostic: DiagnosticArtifact }) {
  const { metrics, expectations, outcomes, ...manifest } = diagnostic;
  return (
    <div className="diagnostic-json-browser">
      <dl className="diagnostic-json-summary">
        <div><dt>Schema</dt><dd>v{diagnostic.schema_version}</dd></div>
        <div><dt>Metrics</dt><dd>{metrics.length.toLocaleString()}</dd></div>
        <div><dt>Expectations</dt><dd>{expectations.length.toLocaleString()}</dd></div>
        <div><dt>Outcomes</dt><dd>{outcomes?.length.toLocaleString() ?? "In metrics"}</dd></div>
      </dl>
      <section className="diagnostic-json-section">
        <h3>Manifest</h3>
        <LazyJsonDetails label={<strong>Run and source metadata</strong>} value={manifest} />
      </section>
      <section className="diagnostic-json-section">
        <h3>Metrics</h3>
        <div className="expectation-list diagnostic-json-items">
          {metrics.map((metric, index) => (
            <DiagnosticMetricJson key={`${metric.metric_name}-${index}`} metric={metric} />
          ))}
        </div>
      </section>
      <section className="diagnostic-json-section">
        <h3>Expectations</h3>
        <PaginatedJsonList
          items={expectations}
          labelFor={(expectation) => <strong>{humanize(expectation.type)}</strong>}
          codeFor={(expectation) => expectation.id}
        />
      </section>
      {outcomes && outcomes.length > 0 && (
        <section className="diagnostic-json-section">
          <h3>Top-level outcomes</h3>
          <PaginatedJsonList
            items={outcomes}
            labelFor={(outcome, index) => <strong>{humanize(String(outcome.type ?? `Outcome ${index + 1}`))}</strong>}
            codeFor={(outcome, index) => String(outcome.id ?? outcome.rule_id ?? index + 1)}
          />
        </section>
      )}
    </div>
  );
}

function DimensionCard({
  dimension,
  metrics,
  onInspect,
}: {
  dimension: RunDimension;
  metrics: DimensionMetric[];
  onInspect: () => void;
}) {
  const metric = primaryMetricForDimension(dimension, metrics);
  return (
    <button className="dimension-card" onClick={onInspect} type="button">
      <p>{DIMENSION_LABELS[dimension.dimension] ?? humanize(dimension.dimension)}</p>
      <div className="dimension-score-row">
        <strong>{scorePercent(metric?.metric_value)}</strong>
        <span>{dimension.total_examples?.toLocaleString() ?? 0} records</span>
      </div>
      <ScoreBar score={metric?.metric_value} />
      <span className="metric-caption">
        {metric ? humanize(metric.metric_name) : "No aggregate score"}
      </span>
    </button>
  );
}

function WorkflowBrowser({
  runs,
  scores,
  loading,
  scoresLoading,
  onSelect,
}: {
  runs: BenchmarkRun[];
  scores: RunScoreIndex;
  loading: boolean;
  scoresLoading: boolean;
  onSelect: (run: BenchmarkRun) => void;
}) {
  const [query, setQuery] = useState("");
  const [pipeline, setPipeline] = useState("all");
  const [branch, setBranch] = useState("all");
  const [conclusion, setConclusion] = useState("all");
  const [scope, setScope] = useState("all");
  const [group, setGroup] = useState(ANY_GROUP);
  const [period, setPeriod] = useState("all");
  const [periodReferenceTime, setPeriodReferenceTime] = useState<number | null>(null);
  const [sort, setSort] = useState<RunSort>("newest");
  const [page, setPage] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showIds, setShowIds] = useState(false);
  const [jumpValue, setJumpValue] = useState("");
  const [jumpError, setJumpError] = useState<string | null>(null);
  const pageSize = 12;

  const completeRuns = useMemo(
    () => runs.filter((run) => run.artifact_state === "complete"),
    [runs],
  );
  const pipelines = useMemo(() => uniqueValues(runs, "pipeline_name").sort(), [runs]);
  const branches = useMemo(() => uniqueValues(runs, "head_branch").sort(), [runs]);
  const conclusions = useMemo(() => uniqueValues(runs, "conclusion").sort(), [runs]);
  const scopes = useMemo(() => uniqueValues(runs, "effective_scope").sort(), [runs]);
  const groups = useMemo(() => uniqueValues(runs, "effective_group").sort(), [runs]);

  const scoreLeaders = useMemo(() => {
    const comparableRuns = completeRuns.filter((run) => run.leaderboard_eligible);
    const metrics: Array<{ key: "aggregate" | (typeof DIMENSION_ORDER)[number]; label: string }> = [
      { key: "aggregate", label: "Aggregate" },
      ...DIMENSION_ORDER.map((dimension) => ({
        key: dimension,
        label: DIMENSION_LABELS[dimension],
      })),
    ];
    return metrics.map((metric) => {
      let leader: BenchmarkRun | null = null;
      let bestScore: number | null = null;
      for (const run of comparableRuns) {
        const groupMatches = metric.key === "aggregate"
          ? run.effective_group === "all"
          : run.effective_group === "all" || run.effective_group === metric.key;
        if (!groupMatches) continue;
        const runScores = scores[run.id];
        const candidate = metric.key === "aggregate"
          ? runScores?.aggregate
          : runScores?.dimensions[metric.key];
        if (candidate != null && (bestScore == null || candidate > bestScore)) {
          leader = run;
          bestScore = candidate;
        }
      }
      return { ...metric, run: leader, score: bestScore };
    });
  }, [completeRuns, scores]);

  const filteredRuns = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const periodMs: Record<string, number> = {
      "24h": 24 * 60 * 60 * 1_000,
      "7d": 7 * 24 * 60 * 60 * 1_000,
      "30d": 30 * 24 * 60 * 60 * 1_000,
    };
    const filtered = runs.filter((run) => {
      const searchable = [
        run.github_run_id,
        run.run_name,
        run.pipeline_name,
        run.head_branch,
        run.head_sha,
        run.requested_scope,
        run.requested_group,
        run.effective_scope,
        run.effective_group,
        run.coverage_status,
        JSON.stringify(run.pipeline_config ?? {}),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (normalizedQuery && !searchable.includes(normalizedQuery)) return false;
      if (pipeline !== "all" && run.pipeline_name !== pipeline) return false;
      if (branch !== "all" && run.head_branch !== branch) return false;
      if (conclusion !== "all" && run.conclusion !== conclusion) return false;
      if (scope !== "all" && run.effective_scope !== scope) return false;
      if (group !== ANY_GROUP && run.effective_group !== group) return false;
      if (period !== "all") {
        const created = run.source_created_at ? new Date(run.source_created_at).getTime() : 0;
        if (
          !created ||
          periodReferenceTime == null ||
          periodReferenceTime - created > periodMs[period]
        ) return false;
      }
      return true;
    });
    return filtered.sort((a, b) => {
      if (sort === "oldest") {
        return new Date(a.source_created_at ?? 0).getTime() - new Date(b.source_created_at ?? 0).getTime();
      }
      if (sort === "largest") {
        return (summaryNumber(b, "total") ?? -1) - (summaryNumber(a, "total") ?? -1);
      }
      if (sort === "fastest") {
        return (summaryNumber(a, "avg_latency_ms") ?? Number.POSITIVE_INFINITY) -
          (summaryNumber(b, "avg_latency_ms") ?? Number.POSITIVE_INFINITY);
      }
      return new Date(b.source_created_at ?? 0).getTime() - new Date(a.source_created_at ?? 0).getTime();
    });
  }, [branch, conclusion, group, period, periodReferenceTime, pipeline, query, runs, scope, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredRuns.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visibleRuns = filteredRuns.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const hasFilters = Boolean(
    query || pipeline !== "all" || branch !== "all" || conclusion !== "all" ||
    scope !== "all" || group !== ANY_GROUP || period !== "all",
  );

  function clearFilters() {
    setQuery("");
    setPipeline("all");
    setBranch("all");
    setConclusion("all");
    setScope("all");
    setGroup(ANY_GROUP);
    setPeriod("all");
    setPeriodReferenceTime(null);
    setPage(0);
  }

  function jumpToRun(event: FormEvent) {
    event.preventDefault();
    const candidate = jumpValue.trim().replace(/^#/, "").toLowerCase();
    const match = completeRuns.find((run) =>
      String(run.github_run_id) === candidate ||
      Boolean(run.head_sha?.toLowerCase().startsWith(candidate)),
    );
    if (!candidate || !match) {
      setJumpError("No indexed run or commit matches that value.");
      return;
    }
    setJumpError(null);
    onSelect(match);
  }

  return (
    <main className="content-shell runs-shell">
      <section className="catalog-hero">
        <div>
          <span className="eyebrow">Workflow catalog</span>
          <h1>Find the benchmark run you need</h1>
          <p>Search across workflow names, commits, branches, pipelines, configurations, and run IDs—all in one place.</p>
        </div>
        <form className="jump-form" onSubmit={jumpToRun}>
          <label htmlFor="jump-run">Workflow run ID or commit</label>
          <div>
            <input
              id="jump-run"
              value={jumpValue}
              onChange={(event) => setJumpValue(event.target.value)}
              placeholder="Run ID or commit SHA"
              spellCheck={false}
            />
            <button type="submit">Open</button>
          </div>
          <span className={jumpError ? "field-error" : "field-help"}>
            {jumpError ?? "A short commit prefix opens its newest indexed run."}
          </span>
        </form>
      </section>

      <section className="score-leaders" aria-label="Highest workflow scores">
        <div className="score-leaders-heading">
          <div>
            <span className="eyebrow">Full benchmark leaders</span>
            <h2>Highest scores by benchmark dimension</h2>
          </div>
          <p>Quick runs are excluded. Full-dataset runs compete only in the dimensions they completely evaluated.</p>
        </div>
        <div className="score-leader-grid">
          {scoreLeaders.map((leader) => (
            <button
              className={`score-leader-card ${leader.key === "aggregate" ? "score-leader-primary" : ""}`}
              disabled={!leader.run}
              key={leader.key}
              onClick={() => leader.run && onSelect(leader.run)}
              type="button"
              aria-label={leader.run ? `Open ${leader.label} leader, workflow run ${leader.run.github_run_id}` : `${leader.label} score unavailable`}
            >
              <span>{leader.label}</span>
              <strong className={`score-${scoreTone(leader.score)}`}>
                {scoresLoading ? "…" : scorePercent(leader.score)}
              </strong>
              <small>
                {scoresLoading
                  ? "Loading scores"
                  : leader.run
                    ? `${humanize(leader.run.pipeline_name)} · Run #${leader.run.github_run_id}`
                    : "No scored workflow"}
              </small>
              <em aria-hidden="true">Open →</em>
            </button>
          ))}
        </div>
      </section>

      <section className="catalog-panel">
        <div className="catalog-toolbar">
          <label className="catalog-search">
            <span>Search workflows</span>
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(0); }}
              placeholder="Search ID, commit, branch, pipeline, name…"
              type="search"
            />
          </label>
          <label className="sort-control">
            <span>Sort by</span>
            <select value={sort} onChange={(event) => { setSort(event.target.value as RunSort); setPage(0); }}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="largest">Largest run</option>
              <option value="fastest">Lowest latency</option>
            </select>
          </label>
        </div>

        <div className="catalog-filter-disclosure">
          <button className="catalog-filter-toggle" type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((current) => !current)}>
            <span>Filters</span><small>6 filter options</small>
          </button>
          <div className={`catalog-filters ${filtersOpen ? "catalog-filters-open" : ""}`}>
            <label><span>Pipeline</span><select value={pipeline} onChange={(event) => { setPipeline(event.target.value); setPage(0); }}><option value="all">All pipelines</option>{pipelines.map((value) => <option value={value} key={value}>{humanize(value)}</option>)}</select></label>
            <label><span>Branch</span><select value={branch} onChange={(event) => { setBranch(event.target.value); setPage(0); }}><option value="all">All branches</option>{branches.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
            <label><span>Result</span><select value={conclusion} onChange={(event) => { setConclusion(event.target.value); setPage(0); }}><option value="all">All results</option>{conclusions.map((value) => <option value={value} key={value}>{humanize(value)}</option>)}</select></label>
            <label><span>Scope</span><select value={scope} onChange={(event) => { setScope(event.target.value); setPage(0); }}><option value="all">Any scope</option>{scopes.map((value) => <option value={value} key={value}>{humanize(value)}</option>)}</select></label>
            <label><span>Group</span><select value={group} onChange={(event) => { setGroup(event.target.value); setPage(0); }}><option value={ANY_GROUP}>Any group</option>{groups.map((value) => <option value={value} key={value}>{humanize(value)}</option>)}</select></label>
            <label><span>Created</span><select value={period} onChange={(event) => { const value = event.target.value; setPeriod(value); setPeriodReferenceTime(value === "all" ? null : Date.now()); setPage(0); }}><option value="all">Any time</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label>
          </div>
        </div>

        <div className="catalog-results-bar">
          <p><strong>{filteredRuns.length}</strong> matching {filteredRuns.length === 1 ? "workflow run" : "workflow runs"}</p>
          <div className="catalog-results-actions">
            <button type="button" className="id-toggle" aria-pressed={showIds} onClick={() => setShowIds((current) => !current)}>
              {showIds ? "Hide run IDs" : "Show run IDs"}
            </button>
            {hasFilters && <button type="button" className="text-button" onClick={clearFilters}>Clear all filters</button>}
          </div>
        </div>

        {loading ? (
          <div className="loading-panel">Loading workflow catalog…</div>
        ) : visibleRuns.length ? (
          <div className="workflow-table">
            <div className="workflow-table-head" aria-hidden="true">
              <span>Workflow</span><span>Aggregate</span><span>Dimension scores</span><span>Source</span><span>Configuration</span><span>Created</span><span />
            </div>
            {visibleRuns.map((run) => {
              const runScores = scores[run.id];
              return (
                <button
                  type="button"
                  className="workflow-row"
                  key={run.id}
                  onClick={() => onSelect(run)}
                  aria-label={`Open workflow run ${run.github_run_id}`}
                >
                  <span className="workflow-identity">
                    <span className="workflow-title-line">
                      <strong>{humanize(run.pipeline_name ?? run.run_name)}</strong>
                      {showIds && <code className="workflow-run-id">#{run.github_run_id}</code>}
                      {run.github_run_attempt > 1 && <em>Attempt {run.github_run_attempt}</em>}
                    </span>
                    <small>{run.run_name ?? "Unnamed workflow"}</small>
                  </span>
                  <span className="workflow-aggregate">
                    <strong className={`score-${scoreTone(runScores?.aggregate)}`}>{scoresLoading ? "…" : scorePercent(runScores?.aggregate)}</strong>
                    <small>
                      {humanize(run.conclusion ?? run.status)} · {run.artifact_state === "complete"
                        ? `${humanize(run.coverage_status)} coverage`
                        : `${humanize(run.artifact_state)} artifacts`}
                    </small>
                  </span>
                  <span className="workflow-dimension-scores" aria-label="Dimension scores">
                    {DIMENSION_ORDER.map((dimension) => (
                      <span key={dimension} title={`${DIMENSION_LABELS[dimension]}: ${scorePercent(runScores?.dimensions[dimension])}`}>
                        <small>{DIMENSION_SHORT_LABELS[dimension]}</small>
                        <strong className={`score-${scoreTone(runScores?.dimensions[dimension])}`}>
                          {scoresLoading ? "…" : scorePercent(runScores?.dimensions[dimension])}
                        </strong>
                      </span>
                    ))}
                  </span>
                  <span className="workflow-source">
                    <strong>{run.head_branch ?? "Unknown branch"}</strong>
                    <code>{shortSha(run.head_sha)}</code>
                  </span>
                  <span className="workflow-config">
                    <strong>{humanize(run.effective_scope)}</strong>
                    <small>{humanize(run.effective_group)} · {formatCompact(run.observed_document_count)} docs · {formatLatency(summaryNumber(run, "avg_latency_ms"))}</small>
                  </span>
                  <span className="workflow-created">
                    <strong>{formatShortDate(run.source_created_at)}</strong>
                    <small>{formatDuration(durationMinutes(run))} duration</small>
                  </span>
                  <span className="workflow-open" aria-hidden="true">→</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="catalog-empty">
            <strong>No workflows match these filters</strong>
            <p>Try a broader search or clear the active filters.</p>
            <button type="button" onClick={clearFilters}>Clear filters</button>
          </div>
        )}

        {filteredRuns.length > pageSize && (
          <div className="pagination" aria-label="Workflow pages">
            <button type="button" disabled={safePage === 0} onClick={() => setPage(Math.max(0, safePage - 1))}>Previous</button>
            <span>Page {safePage + 1} of {pageCount}</span>
            <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}>Next</button>
          </div>
        )}
      </section>
    </main>
  );
}

function Overview({
  run,
  bundle,
  documents,
  documentTotal,
  loading,
  documentsLoading,
  filters,
  updateFilters,
  resetFilters,
  fullPageHref,
  inspectDimension,
  inspectDocument,
}: {
  run: BenchmarkRun;
  bundle: RunBundle;
  documents: CaseResult[];
  documentTotal: number;
  loading: boolean;
  documentsLoading: boolean;
  filters: TriageFilters;
  updateFilters: (updates: Partial<TriageFilters>) => void;
  resetFilters: () => void;
  fullPageHref: string;
  inspectDimension: (dimension: string) => void;
  inspectDocument: (result: CaseResult, navigationFilters?: TriageFilters) => void;
}) {
  const overall = overallScore(bundle);
  const failedFromDimensions = bundle.dimensions.reduce(
    (total, dimension) => total + (dimension.failed ?? 0),
    0,
  );
  const failed = summaryNumber(run, "failed") ?? failedFromDimensions;
  const total = summaryNumber(run, "total") ?? (bundle.dimensions.length ? countDocuments(bundle) : null);
  const successRate = summaryNumber(run, "success_rate");
  const latency = summaryNumber(run, "avg_latency_ms");
  const selectionMismatch =
    (run.requested_scope != null && run.requested_scope !== run.effective_scope) ||
    (run.requested_group != null && run.requested_group !== run.effective_group);

  return (
    <main className="content-shell overview-shell">
      <section className="section-block benchmark-summary" aria-labelledby="benchmark-result-heading">
        <div className="section-heading benchmark-summary-heading">
          <div>
            <span className="eyebrow">Benchmark result</span>
            <h2 id="benchmark-result-heading">Score profile</h2>
          </div>
          <span className="section-hint">Select a dimension to inspect its lowest documents</span>
        </div>

        {loading ? (
          <div className="loading-panel">Loading score profile…</div>
        ) : bundle.dimensions.length ? (
          <div className="score-profile-grid">
            <article className="dimension-card composite-score-card">
              <p>Composite</p>
              <div className="dimension-score-row">
                <strong>{scorePercent(overall)}</strong>
              </div>
              <ScoreBar score={overall} />
              <span className="composite-meta">
                <span>{scopeLabel(run.effective_scope)}</span>
                <span>{successRate == null ? (failed ? "—" : "100%") : `${Math.round(successRate)}%`} success</span>
              </span>
            </article>
            {bundle.dimensions.map((dimension) => (
              <DimensionCard
                key={dimension.id}
                dimension={dimension}
                metrics={bundle.metrics}
                onInspect={() => inspectDimension(dimension.dimension)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No completed benchmark result"
            body={`This ${humanize(run.conclusion ?? run.status).toLowerCase()} workflow attempt is indexed, but it did not produce dimension reports.`}
          />
        )}
      </section>

      {selectionMismatch && (
        <section className="execution-notice" aria-label="Requested and observed benchmark configuration differ">
          <strong>GitHub selection differed from the executed benchmark.</strong>
          <p>
            Requested {humanize(run.requested_scope)} · {humanize(run.requested_group)};
            artifacts show {humanize(run.effective_scope)} · {humanize(run.effective_group)}.
            Scores and leaderboard eligibility use the artifact-derived values.
          </p>
        </section>
      )}

      <section className="run-details" aria-labelledby="run-details-heading">
        <div className="run-details-heading">
          <span className="eyebrow" id="run-details-heading">Supporting run details</span>
          <span>Operational metadata and configuration</span>
        </div>
        <div className="run-facts">
          <div><span>Documents</span><strong>{total == null ? "—" : total.toLocaleString()}</strong></div>
          <div><span>Average latency</span><strong>{formatLatency(latency)}</strong></div>
          <div><span>Pipeline</span><strong>{humanize(run.pipeline_name)}</strong></div>
          <div><span>Evaluation group</span><strong>{humanize(run.effective_group)}</strong></div>
          <div><span>Coverage</span><strong>{humanize(run.coverage_status)}</strong></div>
          <div><span>Trigger</span><strong>{humanize(run.event)}</strong></div>
          <div><span>Attempt</span><strong>#{run.github_run_attempt}</strong></div>
          {Object.entries(run.pipeline_config ?? {}).slice(0, 4).map(([key, value]) => (
            <div key={key}><span>{humanize(key)}</span><strong>{String(value)}</strong></div>
          ))}
        </div>
      </section>

      <div className="overview-support-grid">
        <section className="section-block compact-block provenance-block">
          <div className="section-heading compact-heading">
            <div>
              <span className="eyebrow">Provenance</span>
              <h2>Source stack</h2>
            </div>
            <span className="section-hint commit-help">
              Hover for the message · click to open the commit
            </span>
          </div>
          <div className="component-list">
            {bundle.components.length ? bundle.components.map((component) => (
              <div className="component-row" key={component.id}>
                <div>
                  <strong>{humanize(component.component)}</strong>
                  <span>{component.installed_version ?? component.requested_ref ?? "Unversioned"}</span>
                </div>
                <CommitLink
                  repository={component.repository}
                  sha={component.resolved_sha}
                />
              </div>
            )) : <p className="muted-copy">No component metadata was available.</p>}
          </div>
        </section>

        <section className="section-block compact-block diagnostics-block">
          <div className="section-heading compact-heading">
            <div>
              <span className="eyebrow">Diagnostics</span>
              <h2>Run errors</h2>
            </div>
          </div>
          {bundle.errors.length ? (
            <div className="error-list">
              {bundle.errors.slice(0, 5).map((error) => (
                <div className="error-row" key={error.id}>
                  <span>{humanize(error.stage)}</span>
                  <p>{error.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className={run.artifact_state === "complete" ? "clean-run" : "incomplete-run-diagnostic"}>
              {run.artifact_state === "complete"
                ? "No indexed errors for this run"
                : "No structured errors were retained for this incomplete run; open GitHub to inspect its logs."}
            </div>
          )}
        </section>
      </div>

      {bundle.dimensions.length ? (
        <TriageGrid
          bundle={bundle}
          documents={documents}
          total={documentTotal}
          loading={documentsLoading || loading}
          filters={filters}
          updateFilters={updateFilters}
          resetFilters={resetFilters}
          onSelect={inspectDocument}
          embedded
          fullPageHref={fullPageHref}
        />
      ) : null}
    </main>
  );
}

function DiagnosticImagePreview({
  source,
  title,
  boxes,
  selectedId,
  onSelect,
}: {
  source: string;
  title: string;
  boxes: EvidenceOverlayBox[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [aspectRatio, setAspectRatio] = useState(1);
  return (
    <div className="image-preview" aria-label={title}>
      <div className="image-evidence-page" style={{ aspectRatio }}>
        <Image
          src={source}
          alt={title}
          fill
          sizes="(max-width: 760px) 100vw, 50vw"
          loading="eager"
          unoptimized
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            if (naturalWidth > 0 && naturalHeight > 0) setAspectRatio(naturalWidth / naturalHeight);
          }}
        />
        <EvidenceOverlay boxes={boxes} selectedId={selectedId} onSelect={onSelect} />
      </div>
    </div>
  );
}

type BestComparisonView = "ground-truth" | "current" | "best";

function ResultEvidencePanel({
  label,
  result,
  diagnostic,
  diagnosticError,
  artifact,
}: {
  label: string;
  result: CaseResult;
  diagnostic: DiagnosticArtifact | null;
  diagnosticError: string | null;
  artifact: ArtifactState;
}) {
  const dimension = result.run_dimensions.dimension;
  return (
    <section className="best-result-evidence" aria-label={`${label} scoring evidence`}>
      <header className="best-result-evidence-heading">
        <div>
          <span className="diagnostic-eyebrow">{label}</span>
          <h3>{humanize(result.primary_metric_name)}</h3>
        </div>
        <strong>{scorePercent(result.primary_score)}</strong>
      </header>
      {diagnostic ? (
        <DiagnosticInspector diagnostic={diagnostic} actualMarkdown={artifact.markdown} />
      ) : artifact.loading && !diagnosticError ? (
        <div className="artifact-loading">Loading score evidence…</div>
      ) : (
        <EmptyState
          title="Detailed score evidence unavailable"
          body={diagnosticError ?? "This result does not include a per-case diagnostic artifact."}
        />
      )}
      <section className="best-result-extracted-output" aria-label={`${label} extracted output`}>
        <div className="diagnostic-section-heading">
          <div>
            <span className="diagnostic-eyebrow">Extracted result</span>
            <h3>{dimension === "table" ? "Extracted table Markdown" : "Extracted Markdown"}</h3>
          </div>
          {artifact.url && <a href={artifact.url} target="_blank" rel="noreferrer">Open JSON ↗</a>}
        </div>
        {artifact.loading ? (
          <div className="artifact-loading">Loading extracted output…</div>
        ) : artifact.error ? (
          <EmptyState title="Extracted output unavailable" body={artifact.error} />
        ) : artifact.markdown ? (
          <MarkdownPanel markdown={artifact.markdown} />
        ) : (
          <EmptyState title="No extracted Markdown" body="This result does not contain a rendered Markdown payload." />
        )}
      </section>
    </section>
  );
}

function BestResultPanel({
  current,
  currentArtifact,
  currentDiagnostic,
  currentDiagnosticError,
  best,
}: {
  current: CaseResult;
  currentArtifact: ArtifactState;
  currentDiagnostic: DiagnosticArtifact | null;
  currentDiagnosticError: string | null;
  best: HistoricalBestState;
}) {
  const [comparisonView, setComparisonView] = useState<BestComparisonView>("best");
  const comparisonId = useId();
  if (!best.data) {
    return <EmptyState title="Best result unavailable" body={best.error ?? "No substantially better historical result was found."} />;
  }
  const { result, run } = best.data;
  const improvement = (result.primary_score ?? 0) - (current.primary_score ?? 0);
  const groundTruthDiagnostic = currentDiagnostic ?? best.diagnostic;
  const groundTruthReference = currentArtifact.reference ?? best.artifact.reference;
  const bestHref = `/workflows/${run.github_run_id}/triage/${result.id}?dimension=${encodeURIComponent(result.run_dimensions.dimension)}&from=triage`;
  const views: Array<{ value: BestComparisonView; label: string; score?: string }> = [
    { value: "ground-truth", label: "Ground truth" },
    { value: "current", label: "Current", score: scorePercent(current.primary_score) },
    { value: "best", label: "Best", score: scorePercent(result.primary_score) },
  ];
  function navigateComparisonTabs(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % views.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + views.length) % views.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = views.length - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    const nextView = views[nextIndex];
    setComparisonView(nextView.value);
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']");
    tabs?.[nextIndex]?.focus();
  }
  return (
    <div className="best-result-view">
      <section className="best-result-summary" aria-labelledby="best-result-heading">
        <div className="best-result-score">
          <span className="diagnostic-eyebrow">Best observed result</span>
          <div>
            <h2 id="best-result-heading">{scorePercent(result.primary_score)}</h2>
            <strong>+{(improvement * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })} points</strong>
          </div>
          <p>Compared with the current {scorePercent(current.primary_score)} headline score.</p>
        </div>
        <dl className="best-result-provenance">
          <div>
            <dt>Workflow</dt>
            <dd>
              <Link
                className="best-result-workflow-link"
                href={`/workflows/${run.github_run_id}`}
                aria-label={`Open workflow ${run.github_run_id} overview`}
              >
                #{run.github_run_id} <span aria-hidden="true">↗</span>
              </Link>
            </dd>
          </div>
          <div><dt>Pipeline</dt><dd>{humanize(run.pipeline_name ?? run.run_name)}</dd></div>
          <div><dt>Source</dt><dd>{run.head_branch ?? "Unknown branch"} · <code>{shortSha(run.head_sha)}</code></dd></div>
          <div><dt>Recorded</dt><dd>{formatShortDate(run.source_created_at)}</dd></div>
        </dl>
        <Link className="best-result-link" href={bestHref}>
          Open best result <span aria-hidden="true">→</span>
        </Link>
      </section>
      <div className="best-result-comparison-intro">
        <div>
          <strong>Compare the evidence behind both scores</strong>
          <span>The page, dataset revision, dimension, headline metric, and ground truth are identical.</span>
        </div>
        <div className="best-result-comparison-tabs" role="tablist" aria-label="Historical best comparison views">
          {views.map((view, index) => (
            <button
              id={`${comparisonId}-${view.value}-tab`}
              type="button"
              role="tab"
              aria-selected={comparisonView === view.value}
              aria-controls={`${comparisonId}-panel`}
              tabIndex={comparisonView === view.value ? 0 : -1}
              onClick={() => setComparisonView(view.value)}
              onKeyDown={(event) => navigateComparisonTabs(event, index)}
              key={view.value}
            >
              <span>{view.label}</span>
              {view.score && <strong>{view.score}</strong>}
            </button>
          ))}
        </div>
      </div>
      <div
        className="best-result-comparison-panel"
        id={`${comparisonId}-panel`}
        role="tabpanel"
        aria-labelledby={`${comparisonId}-${comparisonView}-tab`}
      >
        {comparisonView === "ground-truth" ? (
          <GroundTruthInspector
            dimension={result.run_dimensions.dimension}
            diagnostic={groundTruthDiagnostic}
            fallbackMarkdown={groundTruthReference}
          />
        ) : comparisonView === "current" ? (
          <ResultEvidencePanel
            label="Current page result"
            result={current}
            diagnostic={currentDiagnostic}
            diagnosticError={currentDiagnosticError}
            artifact={currentArtifact}
          />
        ) : (
          <ResultEvidencePanel
            label="Best historical result"
            result={result}
            diagnostic={best.diagnostic}
            diagnosticError={best.diagnosticError}
            artifact={best.artifact}
          />
        )}
      </div>
    </div>
  );
}

function DocumentExplorer({
  run,
  selected,
  loading,
  artifact,
  diagnostic,
  caseMetrics,
  historicalBest,
  onLoadHistoricalBest,
  onBrowseQueue,
  previous,
  next,
  onNavigate,
}: {
  run: BenchmarkRun;
  selected: CaseResult | null;
  loading: boolean;
  artifact: ArtifactState;
  diagnostic: DiagnosticState;
  caseMetrics: CaseMetric[];
  historicalBest: HistoricalBestState;
  onLoadHistoricalBest: () => void;
  onBrowseQueue: (trigger: HTMLButtonElement) => void;
  previous: CaseResult | null;
  next: CaseResult | null;
  onNavigate: (result: CaseResult) => void;
}) {
  const [markdownMode, setMarkdownMode] = useState<MarkdownMode>("preview");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("explain");
  const [mobileViewer, setMobileViewer] = useState<"source" | "output">("source");
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [layers, setLayers] = useState({ expected: true, predicted: true });
  const selectedSource = selected ? sourceAssetUrl(selected) : null;
  const selectedSourceKind = selected ? sourceAssetKind(selected) : "unsupported";
  const selectedSourceLabel = selectedSourceKind === "pdf" ? "PDF preview" :
    selectedSourceKind === "image" ? "Image preview" : "Source asset";
  const boxes = useMemo(
    () => layoutOverlayBoxes(diagnostic.data, layers),
    [diagnostic.data, layers],
  );
  const hasLayoutEvidence = diagnostic.data?.dimension === "layout";
  const hasHistoricalBest = historicalBest.data != null;

  return (
    <main className="workbench-shell">
      <section className="inspection-workspace">
        {selected ? (
          <>
            <header className="workbench-header">
              <div className="workbench-navigation">
                <button
                  className="queue-browser-button"
                  type="button"
                  onClick={(event) => onBrowseQueue(event.currentTarget)}
                >
                  Browse queue
                </button>
              </div>
              <div className="inspection-title">
                <div className="breadcrumb">
                  <span>{DIMENSION_LABELS[selected.run_dimensions.dimension] ?? humanize(selected.run_dimensions.dimension)}</span>
                  <span>/</span>
                  <span>{selected.benchmark_cases.inference_group ?? "document"}</span>
                </div>
                <h2>{documentName(selected)}</h2>
              </div>
              <div className="inspection-score">
                <span>Primary score</span>
                <strong className={`score-${scoreTone(selected.primary_score)}`}>
                  {scorePercent(selected.primary_score)}
                </strong>
                <small>{humanize(selected.primary_metric_name)}</small>
              </div>
              <div className="metric-strip">
                {caseMetrics
                  .filter((metric) => metric.metric_name !== selected.primary_metric_name)
                  .slice(0, 3)
                  .map((metric) => (
                    <div className="metric-chip" key={metric.id}>
                      <span title={humanize(metric.metric_name)}>{humanize(metric.metric_name)}</span>
                      <strong>{metricDisplay(metric.metric_name, metric.metric_value)}</strong>
                    </div>
                  ))}
              </div>
              <div className="case-navigation" aria-label="Cases in the current triage result page">
                <button type="button" disabled={!previous} onClick={() => previous && onNavigate(previous)} aria-label="Previous case">←</button>
                <button type="button" disabled={!next} onClick={() => next && onNavigate(next)} aria-label="Next case">→</button>
              </div>
            </header>

            <div className="mobile-viewer-tabs" aria-label="Document inspection panels">
              <button type="button" aria-pressed={mobileViewer === "source"} className={mobileViewer === "source" ? "mobile-viewer-active" : ""} onClick={() => setMobileViewer("source")}>Source</button>
              <button type="button" aria-pressed={mobileViewer === "output"} className={mobileViewer === "output" ? "mobile-viewer-active" : ""} onClick={() => setMobileViewer("output")}>Analysis</button>
            </div>

            <div className={`comparison-grid mobile-view-${mobileViewer}`}>
              <article className="viewer-card pdf-card">
                <div className="viewer-toolbar source-toolbar">
                  <div>
                    <span className="viewer-kicker">Source document</span>
                    <strong>{selectedSourceLabel}</strong>
                  </div>
                  <div className="source-toolbar-actions">
                    {hasLayoutEvidence && (
                      <div className="layer-toggle" aria-label="Layout evidence layers">
                        <button type="button" aria-pressed={layers.expected} onClick={() => setLayers((current) => ({ ...current, expected: !current.expected }))}>
                          <span className="layer-swatch layer-swatch-expected" aria-hidden="true" />Expected
                        </button>
                        <button type="button" aria-pressed={layers.predicted} onClick={() => setLayers((current) => ({ ...current, predicted: !current.predicted }))}>
                          <span className="layer-swatch layer-swatch-predicted" aria-hidden="true" />Output
                        </button>
                      </div>
                    )}
                    {selectedSource && <a className="simple-link" href={selectedSource} target="_blank" rel="noreferrer">Open source ↗</a>}
                  </div>
                </div>
                <div className="pdf-stage">
                  {selectedSource && selectedSourceKind === "pdf" ? (
                    <PdfPreview
                      source={selectedSource}
                      page={selected.benchmark_cases.page_number ?? diagnostic.data?.source?.page ?? 1}
                      title={`PDF preview for ${selected.benchmark_cases.test_id}`}
                      boxes={boxes}
                      selectedId={selectedEvidenceId}
                      onSelect={setSelectedEvidenceId}
                    />
                  ) : selectedSource && selectedSourceKind === "image" ? (
                    <DiagnosticImagePreview
                      source={selectedSource}
                      title={`Source document ${selected.benchmark_cases.test_id}`}
                      boxes={boxes}
                      selectedId={selectedEvidenceId}
                      onSelect={setSelectedEvidenceId}
                    />
                  ) : selectedSource ? (
                    <EmptyState title="Preview unavailable" body="Open the source asset to inspect this file type." />
                  ) : (
                    <EmptyState title="Source unavailable" body="This case does not include a dataset source locator." />
                  )}
                </div>
              </article>

              <article className="viewer-card output-card">
                <div className="viewer-toolbar output-toolbar">
                  <div className="content-tabs inspector-tabs" role="tablist" aria-label="Case inspection views">
                    {([
                      ["explain", "Explain"],
                      ["output", "Output"],
                      ["expectations", "Ground truth"],
                      ...(hasHistoricalBest ? [["best", "Best result"]] as const : []),
                      ["json", "JSON"],
                    ] as const).map(([value, label]) => (
                      <button
                        id={`inspector-${value}-tab`}
                        role="tab"
                        aria-selected={inspectorTab === value}
                        aria-controls="inspector-panel"
                        className={inspectorTab === value ? "content-tab-active" : ""}
                        onClick={() => {
                          setInspectorTab(value);
                          if (value === "best") onLoadHistoricalBest();
                        }}
                        type="button"
                        key={value}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {inspectorTab === "output" && (
                    <div className="mode-toggle" aria-label="Markdown display mode">
                      <button aria-pressed={markdownMode === "preview"} className={markdownMode === "preview" ? "mode-active" : ""} onClick={() => setMarkdownMode("preview")} type="button">Preview</button>
                      <button aria-pressed={markdownMode === "source"} className={markdownMode === "source" ? "mode-active" : ""} onClick={() => setMarkdownMode("source")} type="button">Source</button>
                    </div>
                  )}
                </div>
                <div className="markdown-stage inspector-stage" id="inspector-panel" role="tabpanel" aria-labelledby={`inspector-${inspectorTab}-tab`}>
                  {inspectorTab === "explain" ? (
                    diagnostic.loading ? (
                      <div className="artifact-loading">Loading score evidence…</div>
                    ) : diagnostic.data ? (
                      <DiagnosticInspector
                        diagnostic={diagnostic.data}
                        actualMarkdown={artifact.markdown}
                        selectedEvidenceId={selectedEvidenceId}
                        onSelectEvidence={setSelectedEvidenceId}
                      />
                    ) : (
                      <div className="diagnostic-unavailable">
                        <EmptyState
                          title="Detailed evidence unavailable"
                          body={diagnostic.error ?? "This historical result predates per-case diagnostic artifacts. The stored case metrics remain available below."}
                        />
                        {caseMetrics.length > 0 && (
                          <dl className="historical-metrics">
                            {caseMetrics.map((metric) => (
                              <div key={metric.id}><dt>{humanize(metric.metric_name)}</dt><dd>{metricDisplay(metric.metric_name, metric.metric_value)}</dd></div>
                            ))}
                          </dl>
                        )}
                      </div>
                    )
                  ) : inspectorTab === "output" ? (
                    artifact.loading ? (
                      <div className="artifact-loading">Loading rendered artifact…</div>
                    ) : artifact.error ? (
                      <EmptyState title="Output unavailable" body={artifact.error} />
                    ) : artifact.markdown ? (
                      markdownMode === "preview" ? <MarkdownPanel markdown={artifact.markdown} /> : <pre className="markdown-source"><code>{artifact.markdown}</code></pre>
                    ) : (
                      <EmptyState title="No rendered markdown" body="The indexed result does not contain a markdown payload." />
                    )
                  ) : inspectorTab === "expectations" ? (
                    diagnostic.loading ? (
                      <div className="artifact-loading">Loading ground truth…</div>
                    ) : (
                      <GroundTruthInspector
                        dimension={selected.run_dimensions.dimension}
                        diagnostic={diagnostic.data}
                        fallbackMarkdown={artifact.reference}
                      />
                    )
                  ) : inspectorTab === "best" ? (
                    <BestResultPanel
                      current={selected}
                      currentArtifact={artifact}
                      currentDiagnostic={diagnostic.data}
                      currentDiagnosticError={diagnostic.error}
                      best={historicalBest}
                    />
                  ) : (
                    <div className="raw-artifacts-view">
                      <div className="raw-artifact-links">
                        {artifact.url && <a href={artifact.url} target="_blank" rel="noreferrer">Open parser result JSON ↗</a>}
                        {diagnostic.url && <a href={diagnostic.url} target="_blank" rel="noreferrer">Open diagnostic JSON ↗</a>}
                      </div>
                      {diagnostic.data ? (
                        <DiagnosticJsonBrowser key={diagnostic.data.test_id} diagnostic={diagnostic.data} />
                      ) : (
                        <EmptyState title="Diagnostic JSON unavailable" body={diagnostic.error ?? "This result does not have a diagnostic artifact."} />
                      )}
                    </div>
                  )}
                </div>
              </article>
            </div>
          </>
        ) : loading ? (
          <div className="artifact-loading" role="status">Loading document details…</div>
        ) : (
          <EmptyState title="Case not found" body={`This result is not available for workflow #${run.github_run_id}.`} />
        )}
      </section>
    </main>
  );
}

function ThumbnailCard({
  result,
  selected,
  eager,
  onSelect,
}: {
  result: CaseResult;
  selected?: boolean;
  eager?: boolean;
  onSelect: (result: CaseResult) => void;
}) {
  const thumbnail = thumbnailUrl(result);
  const sourceFallback = sourceAssetKind(result) === "image" ? sourceAssetUrl(result) : null;
  const [imageSource, setImageSource] = useState(thumbnail ?? sourceFallback);
  const [imageFailed, setImageFailed] = useState(false);
  const label = DIMENSION_LABELS[result.run_dimensions.dimension] ?? humanize(result.run_dimensions.dimension);

  function recoverMissingThumbnail() {
    if (imageSource === thumbnail && sourceFallback) {
      setImageSource(sourceFallback);
    } else {
      setImageFailed(true);
    }
  }

  return (
    <button
      type="button"
      className={`triage-card ${selected ? "triage-card-selected" : ""}`}
      aria-pressed={selected}
      onClick={() => onSelect(result)}
    >
      <span className="triage-thumbnail">
        {imageSource && !imageFailed ? (
          <Image
            src={imageSource}
            alt={`Thumbnail of ${documentName(result)}`}
            fill
            loading={eager ? "eager" : "lazy"}
            sizes="(max-width: 620px) 50vw, (max-width: 1000px) 33vw, 20vw"
            unoptimized
            onError={recoverMissingThumbnail}
          />
        ) : (
          <span className="thumbnail-fallback" aria-hidden="true">
            <span>{label.slice(0, 1)}</span>
            Preview unavailable
          </span>
        )}
        <span className="triage-card-badges">
          <span className="triage-dimension-badge">{label}</span>
          <span className={`triage-score-badge score-${scoreTone(result.primary_score)}`}>
            {scorePercent(result.primary_score)}
          </span>
        </span>
      </span>
      <span className="triage-card-copy">
        <strong title={documentName(result)}>{documentName(result)}</strong>
        <span>{result.success ? humanize(result.primary_metric_name) : "Evaluation error"}</span>
      </span>
    </button>
  );
}

function TriageToolbar({
  bundle,
  filters,
  total,
  updateFilters,
  resetFilters,
  onDraftFiltersChange,
  navigationPendingRef,
  fullPageHref,
}: {
  bundle: RunBundle;
  filters: TriageFilters;
  total: number;
  updateFilters: (updates: Partial<TriageFilters>) => void;
  resetFilters: () => void;
  onDraftFiltersChange: (filters: TriageFilters) => void;
  navigationPendingRef: { current: boolean };
  fullPageHref?: string;
}) {
  const [draftSearch, setDraftSearch] = useState(filters.search);
  const [draftMinimum, setDraftMinimum] = useState(filters.minimum);
  const [draftMaximum, setDraftMaximum] = useState(filters.maximum);
  const draftFilters = normalizeTriageFilters({
    ...filters,
    search: draftSearch,
    minimum: draftMinimum,
    maximum: draftMaximum,
  });

  function reportDraft(updates: Partial<TriageFilters>) {
    const next = normalizeTriageFilters({ ...draftFilters, ...updates });
    onDraftFiltersChange(next);
    return next;
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!navigationPendingRef.current && draftSearch !== filters.search) {
        updateFilters({ search: draftSearch, page: 0 });
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [draftSearch, filters.search, navigationPendingRef, updateFilters]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!navigationPendingRef.current && (draftMinimum !== filters.minimum || draftMaximum !== filters.maximum)) {
        updateFilters({ minimum: draftMinimum, maximum: draftMaximum, page: 0 });
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [draftMaximum, draftMinimum, filters.maximum, filters.minimum, navigationPendingRef, updateFilters]);

  return (
    <section className="triage-toolbar" aria-label="Triage filters">
      <div className="triage-toolbar-topline">
        <div>
          <span className="eyebrow">Visual case finder</span>
          <h1>Triage queue</h1>
        </div>
        <div className="triage-toolbar-actions">
          <span className="triage-result-summary" aria-live="polite">
            <strong>{total.toLocaleString()}</strong> matching cases
          </span>
          {fullPageHref && (
            <Link
              className="triage-full-page-link"
              href={hrefWithTriageFilters(fullPageHref.split("?")[0], draftFilters)}
              onNavigate={() => {
                navigationPendingRef.current = true;
              }}
            >
              Open full page ↗
            </Link>
          )}
        </div>
      </div>

      <div className="dimension-pills" aria-label="Evaluation dimension">
        {bundle.dimensions.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={filters.dimension === item.dimension}
            onClick={() => updateFilters(reportDraft({ dimension: item.dimension, page: 0 }))}
          >
            {DIMENSION_LABELS[item.dimension] ?? humanize(item.dimension)}
            <span>{item.total_examples?.toLocaleString() ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="triage-controls">
        <label className="triage-search">
          <span>Search documents</span>
          <input
            type="search"
            value={draftSearch}
            onChange={(event) => {
              setDraftSearch(event.target.value);
              reportDraft({ search: event.target.value, page: 0 });
            }}
            placeholder="Name, identifier, or page"
          />
        </label>

        <fieldset className="score-range-control">
          <legend>Score range</legend>
          <div className="score-range-values">
            <output>{draftMinimum}%</output>
            <span>to</span>
            <output>{draftMaximum}%</output>
          </div>
          <div className="dual-range" style={{ "--range-start": `${draftMinimum}%`, "--range-end": `${draftMaximum}%` } as CSSProperties}>
            <span className="dual-range-track" />
            <input
              aria-label="Minimum score"
              type="range"
              min="0"
              max="100"
              step="1"
              value={draftMinimum}
              onChange={(event) => {
                const minimum = Math.min(Number(event.target.value), draftMaximum);
                setDraftMinimum(minimum);
                reportDraft({ minimum, page: 0 });
              }}
            />
            <input
              aria-label="Maximum score"
              type="range"
              min="0"
              max="100"
              step="1"
              value={draftMaximum}
              onChange={(event) => {
                const maximum = Math.max(Number(event.target.value), draftMinimum);
                setDraftMaximum(maximum);
                reportDraft({ maximum, page: 0 });
              }}
            />
          </div>
        </fieldset>

        <label className="triage-sort">
          <span>Sort by</span>
          <select
            value={filters.sort}
            onChange={(event) => updateFilters(reportDraft({ sort: event.target.value as DocumentSort, page: 0 }))}
          >
            <option value="lowest">Lowest score</option>
            <option value="highest">Highest score</option>
            <option value="document">Document order</option>
          </select>
        </label>

        <button
          className="reset-filters"
          type="button"
          onClick={() => {
            const next = normalizeTriageFilters({
              dimension: bundle.dimensions[0]?.dimension ?? DIMENSION_ORDER[0],
              search: "",
              minimum: 0,
              maximum: 100,
              sort: "lowest",
              page: 0,
            });
            setDraftSearch("");
            setDraftMinimum(0);
            setDraftMaximum(100);
            onDraftFiltersChange(next);
            resetFilters();
          }}
        >
          Reset
        </button>
      </div>
    </section>
  );
}

function TriageGrid({
  bundle,
  documents,
  total,
  loading,
  filters,
  updateFilters,
  resetFilters,
  onSelect,
  compact = false,
  embedded = false,
  fullPageHref,
  selectedId,
}: {
  bundle: RunBundle;
  documents: CaseResult[];
  total: number;
  loading: boolean;
  filters: TriageFilters;
  updateFilters: (updates: Partial<TriageFilters>) => void;
  resetFilters: () => void;
  onSelect: (result: CaseResult, navigationFilters?: TriageFilters) => void;
  compact?: boolean;
  embedded?: boolean;
  fullPageHref?: string;
  selectedId?: number;
}) {
  const pageCount = Math.max(1, Math.ceil(total / TRIAGE_PAGE_SIZE));
  const draftFiltersRef = useRef(filters);
  const navigationPendingRef = useRef(false);

  useEffect(() => {
    draftFiltersRef.current = filters;
  }, [filters]);

  return (
    <div className={compact ? "queue-overlay-body" : embedded ? "triage-embedded" : "triage-page"}>
      <TriageToolbar
        key={`${filters.search}:${filters.minimum}:${filters.maximum}`}
        bundle={bundle}
        filters={filters}
        total={total}
        updateFilters={updateFilters}
        resetFilters={resetFilters}
        onDraftFiltersChange={(draftFilters) => {
          navigationPendingRef.current = false;
          draftFiltersRef.current = draftFilters;
        }}
        navigationPendingRef={navigationPendingRef}
        fullPageHref={fullPageHref}
      />
      <section className="triage-results" aria-label="Matching benchmark cases">
        {loading ? (
          <div className="triage-grid-loading" role="status">Loading document thumbnails…</div>
        ) : documents.length ? (
          <div className="triage-grid">
            {documents.map((result, index) => (
              <ThumbnailCard
                key={result.id}
                result={result}
                selected={result.id === selectedId}
                eager={index < 6}
                onSelect={(selected) => {
                  navigationPendingRef.current = true;
                  onSelect(selected, draftFiltersRef.current);
                }}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No matching cases" body="Adjust the score range, dimension, or document search." />
        )}
      </section>
      {total > TRIAGE_PAGE_SIZE && (
        <nav className="triage-pagination" aria-label="Triage result pages">
          <button type="button" disabled={filters.page === 0} onClick={() => updateFilters({ page: Math.max(0, filters.page - 1) })}>← Previous</button>
          <span>Page {filters.page + 1} of {pageCount}</span>
          <button type="button" disabled={filters.page >= pageCount - 1} onClick={() => updateFilters({ page: Math.min(pageCount - 1, filters.page + 1) })}>Next →</button>
        </nav>
      )}
    </div>
  );
}

export default function DashboardClient({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const routeParams = useParams<{ runId?: string }>();
  const searchParams = useSearchParams();
  const routeRunId = routeParams.runId;
  const githubRunId = routeRunId && /^\d+$/.test(routeRunId) ? Number(routeRunId) : undefined;
  const routeCaseResultValue = pathname.match(/\/triage\/(\d+)\/?$/)?.[1];
  const routeCaseResultId = routeCaseResultValue && /^\d+$/.test(routeCaseResultValue)
    ? Number(routeCaseResultValue)
    : null;
  const view: View = githubRunId == null
    ? "runs"
    : pathname.includes("/triage/")
      ? "inspect"
      : pathname.endsWith("/triage")
        ? "triage"
        : "overview";
  const sortValue = searchParams.get("sort");
  const filters = useMemo<TriageFilters>(() => normalizeTriageFilters({
      dimension: DIMENSION_ORDER.includes(searchParams.get("dimension") as (typeof DIMENSION_ORDER)[number])
        ? searchParams.get("dimension")!
        : DIMENSION_ORDER[0],
      search: searchParams.get("q") || "",
      minimum: parsePercent(searchParams.get("min"), 0),
      maximum: parsePercent(searchParams.get("max"), 100),
      sort: sortValue === "highest" || sortValue === "document" ? sortValue : "lowest",
      page: parsePage(searchParams.get("page")),
    }), [searchParams, sortValue]);
  const inspectionOrigin = searchParams.get("from") === "overview" ? "overview" : "triage";
  const [catalogRuns, setCatalogRuns] = useState<BenchmarkRun[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(view === "runs");
  const [selectedRunRecord, setSelectedRunRecord] = useState<BenchmarkRun | null>(null);
  const [selectedRunLoading, setSelectedRunLoading] = useState(githubRunId != null);
  const [runScores, setRunScores] = useState<RunScoreIndex>({});
  const [runScoresLoading, setRunScoresLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<RunBundle>(EMPTY_BUNDLE);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [documents, setDocuments] = useState<CaseResult[]>([]);
  const [documentTotal, setDocumentTotal] = useState(0);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<CaseResult | null>(null);
  const [documentLoadState, setDocumentLoadState] = useState<{ id: number | null; loading: boolean }>({
    id: null,
    loading: false,
  });
  const [caseMetrics, setCaseMetrics] = useState<CaseMetric[]>([]);
  const [caseMetricsResultId, setCaseMetricsResultId] = useState<number | null>(null);
  const [artifact, setArtifact] = useState<ArtifactState>(EMPTY_ARTIFACT);
  const [artifactResultId, setArtifactResultId] = useState<number | null>(null);
  const [diagnostic, setDiagnostic] = useState<DiagnosticState>(EMPTY_DIAGNOSTIC);
  const [diagnosticResultId, setDiagnosticResultId] = useState<number | null>(null);
  const [historicalBest, setHistoricalBest] = useState<HistoricalBestState>(EMPTY_HISTORICAL_BEST);
  const [historicalBestResultId, setHistoricalBestResultId] = useState<number | null>(null);
  const [historicalBestEvidenceResultId, setHistoricalBestEvidenceResultId] = useState<number | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const queueOverlayRef = useRef<HTMLDivElement>(null);
  const queueCloseButtonRef = useRef<HTMLButtonElement>(null);
  const queueTriggerRef = useRef<HTMLButtonElement>(null);

  const selectedRun = githubRunId != null && selectedRunRecord?.github_run_id === githubRunId
    ? selectedRunRecord
    : null;
  const selectedRunId = selectedRun?.id ?? null;
  const activeDimension = bundle.dimensions.some((item) => item.dimension === filters.dimension)
    ? filters.dimension
    : bundle.dimensions[0]?.dimension ?? filters.dimension;

  const updateFilters = useCallback((updates: Partial<TriageFilters>) => {
    if (!selectedRun) return;
    const next = { ...filters, ...updates };
    if (next.minimum > next.maximum) {
      if (updates.minimum != null) next.maximum = next.minimum;
      else next.minimum = next.maximum;
    }
    const normalized = normalizeTriageFilters(next);
    const base = view === "inspect" && routeCaseResultId != null
      ? `/workflows/${selectedRun.github_run_id}/triage/${routeCaseResultId}`
      : view === "overview"
        ? `/workflows/${selectedRun.github_run_id}`
        : `/workflows/${selectedRun.github_run_id}/triage`;
    const query = triageQuery(normalized);
    if (view === "inspect") query.set("from", inspectionOrigin);
    router.replace(query.size ? `${base}?${query.toString()}` : base, { scroll: false });
  }, [filters, inspectionOrigin, routeCaseResultId, router, selectedRun, view]);

  const reconcileDocumentPage = useEffectEvent((total: number) => {
    const lastPage = Math.max(0, Math.ceil(total / TRIAGE_PAGE_SIZE) - 1);
    if (filters.page <= lastPage) return false;
    updateFilters({ page: lastPage });
    return true;
  });

  const defaultDetailDimension = useEffectEvent((document: CaseResult) => {
    const requestedDimension = searchParams.get("dimension");
    if (
      !DIMENSION_ORDER.includes(requestedDimension as (typeof DIMENSION_ORDER)[number]) &&
      DIMENSION_ORDER.includes(document.run_dimensions.dimension as (typeof DIMENSION_ORDER)[number])
    ) {
      updateFilters({ dimension: document.run_dimensions.dimension, page: 0 });
    }
  });

  useEffect(() => {
    if (!queueOpen) return;
    const trigger = queueTriggerRef.current;
    queueCloseButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setQueueOpen(false);
      if (event.key !== "Tab") return;
      const focusable = queueOverlayRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])",
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      if (trigger?.isConnected) trigger.focus();
    };
  }, [queueOpen]);

  useEffect(() => {
    if (view !== "runs" || catalogLoaded) return;
    const controller = new AbortController();
    // The catalog is loaded lazily and retained while detail routes are open.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCatalogLoading(true);
    loadRuns(controller.signal)
      .then((loadedRuns) => {
        setCatalogRuns(loadedRuns);
        setCatalogLoaded(true);
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatalogLoading(false);
      });
    return () => controller.abort();
  }, [catalogLoaded, view]);

  useEffect(() => {
    if (githubRunId == null) {
      // Keep the last record cached for a possible forward navigation, but do
      // not expose it as selected while the catalog route is active.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedRunLoading(false);
      return;
    }
    if (selectedRunRecord?.github_run_id === githubRunId) {
      setSelectedRunLoading(false);
      return;
    }
    const catalogMatch = catalogRuns.find((run) => run.github_run_id === githubRunId);
    if (catalogMatch) {
      setSelectedRunRecord(catalogMatch);
      setSelectedRunLoading(false);
      return;
    }
    const controller = new AbortController();
    setSelectedRunLoading(true);
    loadRun(githubRunId, controller.signal)
      .then(setSelectedRunRecord)
      .catch((error: Error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSelectedRunLoading(false);
      });
    return () => controller.abort();
  }, [catalogRuns, githubRunId, selectedRunRecord?.github_run_id]);

  useEffect(() => {
    if (view !== "runs" || !catalogRuns.length) return;
    const controller = new AbortController();
    // This loading state follows the catalog score request lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRunScoresLoading(true);
    loadRunScores(catalogRuns.map((run) => run.id), controller.signal)
      .then(setRunScores)
      .catch((error: Error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRunScoresLoading(false);
      });
    return () => controller.abort();
  }, [catalogRuns, view]);

  useEffect(() => {
    if (selectedRunId == null) return;
    const controller = new AbortController();
    // This reset intentionally belongs to the selected-run synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBundleLoading(true);
    setBundle(EMPTY_BUNDLE);
    loadRunBundle(selectedRunId, controller.signal)
      .then((loadedBundle) => {
        setBundle({
          ...loadedBundle,
          dimensions: orderRunDimensions(loadedBundle.dimensions),
        });
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBundleLoading(false);
      });
    return () => controller.abort();
  }, [selectedRunId]);

  useEffect(() => {
    if (selectedRunId == null || selectedRun?.artifact_state !== "complete") return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setDocumentsLoading(true);
      loadDocuments(
        selectedRunId,
        {
          dimension: activeDimension,
          search: filters.search,
          floor: filters.minimum / 100,
          ceiling: filters.maximum / 100,
          sort: filters.sort,
          limit: TRIAGE_PAGE_SIZE,
          offset: filters.page * TRIAGE_PAGE_SIZE,
        },
        controller.signal,
      )
        .then(({ documents: loadedDocuments, total }) => {
          if (reconcileDocumentPage(total)) {
            setDocuments([]);
            setDocumentTotal(total);
            return;
          }
          setDocuments(loadedDocuments);
          setDocumentTotal(total);
        })
        .catch((error: Error) => {
          if (error.name !== "AbortError") setLoadError(error.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setDocumentsLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    activeDimension,
    filters.maximum,
    filters.minimum,
    filters.page,
    filters.search,
    filters.sort,
    selectedRun?.artifact_state,
    selectedRunId,
  ]);

  useEffect(() => {
    if (selectedRunId == null || view !== "inspect" || routeCaseResultId == null) {
      // Route changes intentionally clear the case-specific workbench state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedDocument(null);
      setDocumentLoadState({ id: null, loading: false });
      return;
    }
    const controller = new AbortController();
    setDocumentLoadState({ id: routeCaseResultId, loading: true });
    loadDocument(selectedRunId, routeCaseResultId, controller.signal)
      .then((document) => {
        if (controller.signal.aborted) return;
        setSelectedDocument(document);
        setDocumentLoadState({ id: routeCaseResultId, loading: false });
        if (document) defaultDetailDimension(document);
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") {
          setSelectedDocument(null);
          setDocumentLoadState({ id: routeCaseResultId, loading: false });
          setLoadError(error.message);
        }
      });
    return () => controller.abort();
  }, [routeCaseResultId, selectedRunId, view]);

  useEffect(() => {
    if (!selectedRun || !selectedDocument) {
      return;
    }
    const controller = new AbortController();
    // This reset intentionally belongs to the selected-document synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCaseMetrics([]);
    setCaseMetricsResultId(selectedDocument.id);
    setArtifactResultId(selectedDocument.id);
    setDiagnosticResultId(selectedDocument.id);
    setArtifact({
      loading: true,
      markdown: "",
      reference: null,
      url: artifactUrl(selectedRun, selectedDocument.result_relative_path),
      error: null,
    });
    setDiagnostic({
      loading: true,
      data: null,
      url: artifactUrl(selectedRun, selectedDocument.diagnostic_relative_path),
      error: null,
    });
    loadArtifact(selectedRun, selectedDocument, controller.signal)
      .then((loadedArtifact) => {
        if (controller.signal.aborted) return;
        setArtifact({
          loading: false,
          markdown: loadedArtifact.markdown,
          reference: null,
          url: loadedArtifact.url,
          error: null,
        });
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") {
          setArtifact((current) => ({ ...current, loading: false, error: error.message }));
        }
      });
    loadCaseMetrics(selectedDocument.id, controller.signal)
      .then((metrics) => {
        if (!controller.signal.aborted) setCaseMetrics(metrics);
      })
      .catch(() => undefined);
    loadDiagnostic(selectedRun, selectedDocument, controller.signal)
      .then((loadedDiagnostic) => {
        if (controller.signal.aborted) return;
        setDiagnostic({
          loading: false,
          data: loadedDiagnostic.diagnostic,
          url: loadedDiagnostic.url,
          error: null,
        });
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") {
          setDiagnostic((current) => ({ ...current, loading: false, error: error.message }));
        }
      });
    if (!selectedDocument.diagnostic_relative_path) {
      loadGroundTruth(selectedDocument)
        .then((reference) => {
          if (!controller.signal.aborted && reference) {
            setArtifact((current) => ({ ...current, reference }));
          }
        })
        .catch(() => undefined);
    }
    return () => controller.abort();
  }, [selectedRun, selectedDocument]);

  useEffect(() => {
    if (!selectedDocument) return;
    const document = selectedDocument;
    const controller = new AbortController();
    // This state is keyed to the selected result so a previous page's best
    // result cannot appear while the next page is loading.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistoricalBestResultId(document.id);
    setHistoricalBestEvidenceResultId(null);
    setHistoricalBest(EMPTY_HISTORICAL_BEST);

    async function loadBest() {
      try {
        const candidate = await loadHistoricalBestResult(
          document,
          BEST_SCORE_MINIMUM_IMPROVEMENT,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (!candidate) {
          setHistoricalBest(EMPTY_HISTORICAL_BEST);
          return;
        }

        setHistoricalBest({
          ...EMPTY_HISTORICAL_BEST,
          data: candidate,
        });
      } catch (error) {
        if (!controller.signal.aborted && error instanceof Error && error.name !== "AbortError") {
          setHistoricalBest({ ...EMPTY_HISTORICAL_BEST, error: error.message });
        }
      }
    }

    void loadBest();
    return () => controller.abort();
  }, [selectedDocument]);

  useEffect(() => {
    const candidate = historicalBest.data;
    if (
      !selectedDocument ||
      !candidate ||
      historicalBest.evidenceStatus !== "loading" ||
      historicalBestEvidenceResultId !== selectedDocument.id
    ) return;
    const bestCandidate = candidate;
    const controller = new AbortController();
    // Historical artifacts can be large, so fetch them only after the user
    // opens the Best result tab. The candidate query remains eager because it
    // determines whether the tab should be shown.
    async function loadBestEvidence() {
      const [loadedDiagnostic, loadedArtifact, loadedReference] = await Promise.allSettled([
        loadDiagnostic(bestCandidate.run, bestCandidate.result, controller.signal),
        loadArtifact(bestCandidate.run, bestCandidate.result, controller.signal),
        loadGroundTruth(bestCandidate.result),
      ]);
      if (controller.signal.aborted) return;
      const diagnosticValue = loadedDiagnostic.status === "fulfilled"
        ? loadedDiagnostic.value.diagnostic
        : null;
      const referenceValue = loadedReference.status === "fulfilled"
        ? loadedReference.value
        : null;
      const diagnosticError = loadedDiagnostic.status === "rejected" &&
        loadedDiagnostic.reason instanceof Error
        ? loadedDiagnostic.reason.message
        : null;
      const artifactError = loadedArtifact.status === "rejected" &&
        loadedArtifact.reason instanceof Error
        ? loadedArtifact.reason.message
        : null;
      const artifactValue = loadedArtifact.status === "fulfilled"
        ? loadedArtifact.value
        : { url: artifactUrl(bestCandidate.run, bestCandidate.result.result_relative_path), markdown: "" };
      setHistoricalBest((current) => ({
        ...current,
        evidenceStatus: "loaded",
        diagnostic: diagnosticValue,
        diagnosticError,
        artifact: {
          loading: false,
          markdown: artifactValue.markdown,
          reference: referenceValue,
          url: artifactValue.url,
          error: artifactError,
        },
      }));
    }

    void loadBestEvidence();
    return () => controller.abort();
  }, [historicalBest.data, historicalBest.evidenceStatus, historicalBestEvidenceResultId, selectedDocument]);

  function selectWorkflow(candidate: BenchmarkRun) {
    setLoadError(null);
    if (candidate.id !== selectedRunId) {
      setBundle(EMPTY_BUNDLE);
      setDocuments([]);
      setDocumentTotal(0);
      setSelectedDocument(null);
      setCaseMetrics([]);
      setCaseMetricsResultId(null);
      setArtifact(EMPTY_ARTIFACT);
      setArtifactResultId(null);
      setDiagnostic(EMPTY_DIAGNOSTIC);
      setDiagnosticResultId(null);
      setHistoricalBest(EMPTY_HISTORICAL_BEST);
      setHistoricalBestResultId(null);
      setHistoricalBestEvidenceResultId(null);
    }
    setSelectedRunRecord(candidate);
    router.push(`/workflows/${candidate.github_run_id}`);
  }

  function inspectDimension(nextDimension: string) {
    if (!selectedRun) return;
    const resolvedDimension = nextDimension === "all"
      ? bundle.dimensions[0]?.dimension ?? DIMENSION_ORDER[0]
      : nextDimension;
    const query = `?dimension=${encodeURIComponent(resolvedDimension)}`;
    router.push(`/workflows/${selectedRun.github_run_id}/triage${query}`);
  }

  function inspectDocument(result: CaseResult, navigationFilters: TriageFilters = filters) {
    if (!selectedRun) return;
    setQueueOpen(false);
    setSelectedDocument(null);
    setDocumentLoadState({ id: result.id, loading: true });
    setCaseMetricsResultId(null);
    setArtifactResultId(null);
    setDiagnosticResultId(null);
    setHistoricalBestResultId(null);
    setHistoricalBestEvidenceResultId(null);
    const query = triageQuery(navigationFilters);
    const origin = view === "overview"
      ? "overview"
      : view === "triage"
        ? "triage"
        : inspectionOrigin;
    query.set("from", origin);
    const href = `/workflows/${selectedRun.github_run_id}/triage/${result.id}`;
    router.push(query.size ? `${href}?${query.toString()}` : href, { scroll: false });
  }

  const resetFilters = useCallback(() => {
    updateFilters({
      dimension: bundle.dimensions[0]?.dimension ?? DIMENSION_ORDER[0],
      search: "",
      minimum: 0,
      maximum: 100,
      sort: "lowest",
      page: 0,
    });
  }, [bundle.dimensions, updateFilters]);

  useEffect(() => {
    if (
      view !== "runs" &&
      bundle.dimensions.length &&
      !bundle.dimensions.some((item) => item.dimension === filters.dimension)
    ) {
      updateFilters({ dimension: bundle.dimensions[0].dimension, page: 0 });
    }
  }, [bundle.dimensions, filters.dimension, updateFilters, view]);

  const currentIndex = routeCaseResultId == null
    ? -1
    : documents.findIndex((document) => document.id === routeCaseResultId);
  const previousDocument = currentIndex > 0 ? documents[currentIndex - 1] : null;
  const nextDocument = currentIndex >= 0 && currentIndex < documents.length - 1
    ? documents[currentIndex + 1]
    : null;
  const queueHref = selectedRun
    ? hrefWithTriageFilters(`/workflows/${selectedRun.github_run_id}/triage`, filters)
    : "/workflows";
  const overviewHref = selectedRun
    ? hrefWithTriageFilters(`/workflows/${selectedRun.github_run_id}`, filters)
    : "/workflows";
  const inspectorBackHref = inspectionOrigin === "overview" ? overviewHref : queueHref;
  const pageBackHref = view === "overview"
    ? "/workflows"
    : view === "triage"
      ? overviewHref
      : inspectorBackHref;
  const pageBackLabel = view === "overview"
    ? "Back to workflows"
    : view === "triage"
      ? "Back to overview"
      : inspectionOrigin === "overview"
        ? "Back to overview"
        : "Back to triage queue";
  const displayedDocument = selectedDocument?.id === routeCaseResultId ? selectedDocument : null;
  const documentDetailsLoading = routeCaseResultId != null && (
    documentLoadState.id !== routeCaseResultId || documentLoadState.loading
  );
  const displayedArtifact = artifactResultId === routeCaseResultId
    ? artifact
    : { ...EMPTY_ARTIFACT, loading: documentDetailsLoading || displayedDocument != null };
  const displayedCaseMetrics = caseMetricsResultId === routeCaseResultId ? caseMetrics : [];
  const displayedDiagnostic = diagnosticResultId === routeCaseResultId
    ? diagnostic
    : { ...EMPTY_DIAGNOSTIC, loading: documentDetailsLoading || displayedDocument != null };
  const displayedHistoricalBest = historicalBestResultId === routeCaseResultId
    ? historicalBest
    : { ...EMPTY_HISTORICAL_BEST, loading: documentDetailsLoading || displayedDocument != null };

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/workflows" aria-label="ParseBench run observatory home">
          <span><strong>ParseBench</strong><small>Run Observatory</small></span>
        </Link>
        <nav className="view-nav" aria-label="Dashboard sections">
          <Link href="/workflows" aria-current={view === "runs" ? "page" : undefined} className={view === "runs" ? "view-nav-active" : ""}>
            Workflows
          </Link>
          {selectedRun ? (
            <Link href={`/workflows/${selectedRun.github_run_id}`} aria-current={view !== "runs" ? "page" : undefined} className={view !== "runs" ? "view-nav-active" : ""}>
              Overview
            </Link>
          ) : null}
        </nav>
      </header>

      {view !== "runs" && (
        <section className="run-command-bar">
          <div className="run-context">
            <Link className="run-back-link" href={pageBackHref} aria-label={pageBackLabel}>
              <span aria-hidden="true">←</span>
              {pageBackLabel}
            </Link>
            <span className="eyebrow">Selected workflow · #{selectedRun?.github_run_id ?? "—"}</span>
            {selectedRun ? (
              <>
                <div className="run-title-row">
                  <h1>{humanize(selectedRun.pipeline_name ?? selectedRun.run_name)}</h1>
                  <StatusBadge value={selectedRun.conclusion ?? selectedRun.status} />
                  <span className={`artifact-badge artifact-${selectedRun.artifact_state}`}>{humanize(selectedRun.artifact_state)} artifacts</span>
                </div>
                <div className="run-meta">
                  <span>{formatDate(selectedRun.source_created_at)}</span>
                  <span>{selectedRun.head_branch ?? "Unknown branch"} · <code>{shortSha(selectedRun.head_sha)}</code></span>
                  <span>{humanize(selectedRun.effective_scope)} · {humanize(selectedRun.effective_group)}</span>
                  <span>Attempt #{selectedRun.github_run_attempt}</span>
                </div>
              </>
            ) : (
              <h1>{selectedRunLoading ? "Loading latest workflow…" : "No workflow selected"}</h1>
            )}
          </div>
          <div className="run-toolbar-actions">
            {selectedRun?.github_run_url && (
              <a href={selectedRun.github_run_url} target="_blank" rel="noreferrer" className="secondary-action">Open in GitHub ↗</a>
            )}
          </div>
        </section>
      )}

      {loadError && (
        <div className="global-alert" role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={() => setLoadError(null)}>Dismiss</button>
        </div>
      )}

      {view === "runs" ? (
        <WorkflowBrowser
          runs={catalogRuns}
          scores={runScores}
          loading={catalogLoading}
          scoresLoading={runScoresLoading}
          onSelect={selectWorkflow}
        />
      ) : selectedRun ? (
        view === "overview" ? (
          <Overview
            run={selectedRun}
            bundle={bundle}
            documents={documents}
            documentTotal={documentTotal}
            loading={bundleLoading}
            documentsLoading={documentsLoading}
            filters={filters}
            updateFilters={updateFilters}
            resetFilters={resetFilters}
            fullPageHref={queueHref}
            inspectDimension={inspectDimension}
            inspectDocument={inspectDocument}
          />
        ) : view === "triage" ? (
          <TriageGrid
            bundle={bundle}
            documents={documents}
            total={documentTotal}
            loading={documentsLoading || bundleLoading}
            filters={filters}
            updateFilters={updateFilters}
            resetFilters={resetFilters}
            onSelect={inspectDocument}
          />
        ) : (
          <DocumentExplorer
            key={routeCaseResultId ?? "missing-case"}
            run={selectedRun}
            selected={displayedDocument}
            loading={documentDetailsLoading}
            artifact={displayedArtifact}
            diagnostic={displayedDiagnostic}
            caseMetrics={displayedCaseMetrics}
            historicalBest={displayedHistoricalBest}
            onLoadHistoricalBest={() => {
              if (!displayedDocument) return;
              setHistoricalBest((current) => {
                if (!current.data || current.evidenceStatus !== "idle") return current;
                return {
                  ...current,
                  evidenceStatus: "loading",
                  artifact: { ...EMPTY_ARTIFACT, loading: true },
                };
              });
              setHistoricalBestEvidenceResultId(displayedDocument.id);
            }}
            onBrowseQueue={(trigger) => {
              queueTriggerRef.current = trigger;
              setQueueOpen(true);
            }}
            previous={previousDocument}
            next={nextDocument}
            onNavigate={inspectDocument}
          />
        )
      ) : (
        <main className="content-shell">
          <EmptyState
            title={selectedRunLoading ? "Loading workflow" : "Workflow not found"}
            body={selectedRunLoading
              ? "Loading the selected workflow from the benchmark index."
              : `Workflow run #${githubRunId} is not in the benchmark index.`}
          />
        </main>
      )}
      {selectedRun && view === "inspect" && queueOpen && (
        <div ref={queueOverlayRef} className="queue-overlay" role="dialog" aria-modal="true" aria-label="Browse triage queue">
          <div className="queue-overlay-header">
            <div>
              <span className="eyebrow">Current filtered queue</span>
              <strong>Choose another case</strong>
            </div>
            <button ref={queueCloseButtonRef} type="button" onClick={() => setQueueOpen(false)} aria-label="Close queue browser">×</button>
          </div>
          <TriageGrid
            bundle={bundle}
            documents={documents}
            total={documentTotal}
            loading={documentsLoading}
            filters={filters}
            updateFilters={updateFilters}
            resetFilters={resetFilters}
            onSelect={inspectDocument}
            compact
            selectedId={routeCaseResultId ?? undefined}
          />
        </div>
      )}
      {children}
    </div>
  );
}
