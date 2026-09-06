import {
  humanize,
  primaryMetricForDimension,
  type BenchmarkRun,
  type CaseResult,
  type RunBundle,
  type RunDimension,
  type TriageCaseResult,
} from "../lib/data";
import { DIMENSION_ORDER } from "./constants";
import type { DiagnosticMetric, DiagnosticArtifact } from "../diagnostics";

export function orderRunDimensions(dimensions: RunDimension[]) {
  const rank = new Map<string, number>(
    DIMENSION_ORDER.map((dimension, index) => [dimension, index]),
  );
  return [...dimensions].sort(
    (left, right) =>
      (rank.get(left.dimension) ?? Number.POSITIVE_INFINITY) -
      (rank.get(right.dimension) ?? Number.POSITIVE_INFINITY),
  );
}

export function documentName(result: CaseResult | TriageCaseResult) {
  return result.benchmark_cases.test_id.split("/").at(-1) ?? result.benchmark_cases.test_id;
}

export function scorePercent(value: number | null | undefined) {
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

export function diagnosticMetricDisplay(metric: DiagnosticMetric) {
  return metricDisplay(metric.metric_name, metric.value);
}

export function scoreTone(value: number | null | undefined) {
  if (value == null) return "neutral";
  if (value < 0.45) return "critical";
  if (value < 0.75) return "warning";
  return "good";
}

export function alignedPrimaryMetric(
  result: Pick<CaseResult, "primary_metric_name" | "primary_score">,
  diagnostic: DiagnosticArtifact | null,
) {
  const diagnosticPrimary = diagnostic?.primary_metric;
  if (
    diagnosticPrimary &&
    diagnosticPrimary.name.trim() &&
    diagnosticPrimary.value != null &&
    Number.isFinite(diagnosticPrimary.value)
  ) {
    return { name: diagnosticPrimary.name, score: diagnosticPrimary.value };
  }
  return { name: result.primary_metric_name, score: result.primary_score };
}

export function formatDate(value: string | null) {
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

export function formatShortDate(value: string | null) {
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

export function shortSha(value: string | null | undefined) {
  return value ? value.slice(0, 8) : "unknown";
}

export function scopeLabel(value: string | null | undefined) {
  if (value === "full") return "Full dataset";
  if (value === "test") return "Quick test";
  return humanize(value);
}

export function summaryNumber(run: BenchmarkRun, key: string) {
  const value = run.summary?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function formatCompact(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatLatency(value: number | null | undefined) {
  if (value == null) return "—";
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`;
}

export function durationMinutes(run: BenchmarkRun) {
  if (!run.source_created_at || !run.completed_at) return null;
  const started = new Date(run.source_created_at).getTime();
  const completed = new Date(run.completed_at).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return null;
  return Math.round((completed - started) / 60_000);
}

export function formatDuration(minutes: number | null) {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function uniqueValues(runs: BenchmarkRun[], field: keyof BenchmarkRun) {
  return [...new Set(runs.map((run) => run[field]).filter((value): value is string => typeof value === "string" && Boolean(value)))];
}

export function countDocuments(bundle: RunBundle) {
  return bundle.dimensions.reduce(
    (total, dimension) => total + (dimension.total_examples ?? 0),
    0,
  );
}

export function overallScore(bundle: RunBundle) {
  const scores = bundle.dimensions
    .map(
      (dimension) =>
        primaryMetricForDimension(dimension, bundle.metrics)?.metric_value,
    )
    .filter((value): value is number => typeof value === "number");
  if (!scores.length) return null;
  return scores.reduce((total, value) => total + value, 0) / scores.length;
}

export function scoreWidth(value: number | null | undefined) {
  return `${Math.max(0, Math.min(100, (value ?? 0) * 100))}%`;
}
