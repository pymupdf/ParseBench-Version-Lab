"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import {
  artifactUrl,
  BenchmarkRun,
  CaseMetric,
  CaseResult,
  DimensionMetric,
  humanize,
  loadArtifact,
  loadCaseMetrics,
  loadDocuments,
  loadGroundTruth,
  loadRunBundle,
  loadRunScores,
  loadRuns,
  primaryMetricForDimension,
  RunBundle,
  RunDimension,
  RunScoreIndex,
  sourceAssetKind,
  sourceAssetUrl,
} from "./lib/data";

type View = "runs" | "overview" | "documents";

type MarkdownMode = "preview" | "source";
type RunSort = "newest" | "oldest" | "largest" | "fastest";
type ArtifactState = {
  loading: boolean;
  markdown: string;
  reference: string | null;
  url: string | null;
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

const DIMENSION_LABELS: Record<string, string> = {
  chart: "Charts",
  layout: "Layout",
  table: "Tables",
  text_content: "Text content",
  text_formatting: "Formatting",
};

const DIMENSION_ORDER = [
  "chart",
  "layout",
  "table",
  "text_content",
  "text_formatting",
] as const;

const DIMENSION_SHORT_LABELS: Record<(typeof DIMENSION_ORDER)[number], string> = {
  chart: "Chart",
  layout: "Layout",
  table: "Table",
  text_content: "Text",
  text_formatting: "Format",
};

function scorePercent(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en", {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(value);
}

function scoreTone(value: number | null | undefined) {
  if (value == null) return "neutral";
  if (value < 0.45) return "critical";
  if (value < 0.75) return "warning";
  return "good";
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
  const [commit, setCommit] = useState("all");
  const [conclusion, setConclusion] = useState("all");
  const [artifactState, setArtifactState] = useState("all");
  const [scope, setScope] = useState("all");
  const [group, setGroup] = useState("all");
  const [period, setPeriod] = useState("all");
  const [sort, setSort] = useState<RunSort>("newest");
  const [page, setPage] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showIds, setShowIds] = useState(false);
  const [jumpValue, setJumpValue] = useState("");
  const [jumpError, setJumpError] = useState<string | null>(null);
  const pageSize = 12;

  const pipelines = useMemo(() => uniqueValues(runs, "pipeline_name").sort(), [runs]);
  const branches = useMemo(() => uniqueValues(runs, "head_branch").sort(), [runs]);
  const conclusions = useMemo(() => uniqueValues(runs, "conclusion").sort(), [runs]);
  const artifactStates = useMemo(() => uniqueValues(runs, "artifact_state").sort(), [runs]);
  const scopes = useMemo(() => uniqueValues(runs, "effective_scope").sort(), [runs]);
  const groups = useMemo(() => uniqueValues(runs, "effective_group").sort(), [runs]);
  const commits = useMemo(() => {
    const seen = new Set<string>();
    return runs.filter((run) => {
      if (!run.head_sha || seen.has(run.head_sha)) return false;
      seen.add(run.head_sha);
      return true;
    });
  }, [runs]);

  const scoreLeaders = useMemo(() => {
    const comparableRuns = runs.filter((run) => run.leaderboard_eligible);
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
  }, [runs, scores]);

  const filteredRuns = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const newestIndexedTime = runs.reduce((latest, run) => {
      const created = run.source_created_at ? new Date(run.source_created_at).getTime() : 0;
      return Math.max(latest, created);
    }, 0);
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
      if (commit !== "all" && run.head_sha !== commit) return false;
      if (conclusion !== "all" && run.conclusion !== conclusion) return false;
      if (artifactState !== "all" && run.artifact_state !== artifactState) return false;
      if (scope !== "all" && run.effective_scope !== scope) return false;
      if (group !== "all" && run.effective_group !== group) return false;
      if (period !== "all") {
        const created = run.source_created_at ? new Date(run.source_created_at).getTime() : 0;
        if (!created || newestIndexedTime - created > periodMs[period]) return false;
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
  }, [artifactState, branch, commit, conclusion, group, period, pipeline, query, runs, scope, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredRuns.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visibleRuns = filteredRuns.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const hasFilters = Boolean(
    query || pipeline !== "all" || branch !== "all" || commit !== "all" ||
    conclusion !== "all" || artifactState !== "all" || scope !== "all" ||
    group !== "all" || period !== "all",
  );

  function clearFilters() {
    setQuery("");
    setPipeline("all");
    setBranch("all");
    setCommit("all");
    setConclusion("all");
    setArtifactState("all");
    setScope("all");
    setGroup("all");
    setPeriod("all");
    setPage(0);
  }

  function jumpToRun(event: FormEvent) {
    event.preventDefault();
    const candidate = jumpValue.trim().replace(/^#/, "").toLowerCase();
    const match = runs.find((run) =>
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
            <span>Filters</span><small>8 filter options</small>
          </button>
          <div className={`catalog-filters ${filtersOpen ? "catalog-filters-open" : ""}`}>
            <label><span>Pipeline</span><select value={pipeline} onChange={(event) => { setPipeline(event.target.value); setPage(0); }}><option value="all">All pipelines</option>{pipelines.map((value) => <option value={value} key={value}>{humanize(value)}</option>)}</select></label>
            <label><span>Branch</span><select value={branch} onChange={(event) => { setBranch(event.target.value); setPage(0); }}><option value="all">All branches</option>{branches.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
            <label><span>Commit</span><select value={commit} onChange={(event) => { setCommit(event.target.value); setPage(0); }}><option value="all">All commits</option>{commits.map((run) => <option value={run.head_sha ?? ""} key={run.head_sha}>{shortSha(run.head_sha)} · {run.head_branch ?? "unknown"}</option>)}</select></label>
            <label><span>Result</span><select value={conclusion} onChange={(event) => { setConclusion(event.target.value); setPage(0); }}><option value="all">All results</option>{conclusions.map((value) => <option value={value} key={value}>{humanize(value)}</option>)}</select></label>
            <label><span>Artifacts</span><select value={artifactState} onChange={(event) => { setArtifactState(event.target.value); setPage(0); }}><option value="all">Any artifact state</option>{artifactStates.map((value) => <option value={value} key={value}>{humanize(value)}</option>)}</select></label>
            <label><span>Scope</span><select value={scope} onChange={(event) => { setScope(event.target.value); setPage(0); }}><option value="all">Any scope</option>{scopes.map((value) => <option value={value} key={value}>{humanize(value)}</option>)}</select></label>
            <label><span>Group</span><select value={group} onChange={(event) => { setGroup(event.target.value); setPage(0); }}><option value="all">Any group</option>{groups.map((value) => <option value={value} key={value}>{humanize(value)}</option>)}</select></label>
            <label><span>Created</span><select value={period} onChange={(event) => { setPeriod(event.target.value); setPage(0); }}><option value="all">Any time</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label>
          </div>
        </div>

        <div className="catalog-results-bar">
          <p><strong>{filteredRuns.length}</strong> matching {filteredRuns.length === 1 ? "workflow" : "workflows"}</p>
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
                    <small>{humanize(run.conclusion ?? run.status)} · {humanize(run.coverage_status)} coverage</small>
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
  loading,
  inspectDimension,
  inspectDocument,
}: {
  run: BenchmarkRun;
  bundle: RunBundle;
  documents: CaseResult[];
  loading: boolean;
  inspectDimension: (dimension: string) => void;
  inspectDocument: (result: CaseResult) => void;
}) {
  const overall = overallScore(bundle);
  const failedFromDimensions = bundle.dimensions.reduce(
    (total, dimension) => total + (dimension.failed ?? 0),
    0,
  );
  const failed = summaryNumber(run, "failed") ?? failedFromDimensions;
  const total = summaryNumber(run, "total") ?? countDocuments(bundle);
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
            title="No evaluation reports"
            body="This run has workflow metadata, but no dimension reports were indexed."
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
          <div><span>Documents</span><strong>{total.toLocaleString()}</strong></div>
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
            <div className="clean-run">No indexed errors for this run</div>
          )}
        </section>
      </div>

      <section className="section-block low-score-section">
          <div className="section-heading compact-heading">
            <div>
              <span className="eyebrow">Triage queue</span>
              <h2>Lowest-scoring documents</h2>
            </div>
            <button className="text-button" onClick={() => inspectDimension("all")} type="button">
              Open explorer ↗
            </button>
          </div>
          {documents.length ? (
            <div className="score-table">
              <div className="score-table-head">
                <span>Document</span><span>Dimension</span><span>Score</span>
              </div>
              {documents.slice(0, 8).map((result) => (
                <button
                  type="button"
                  className="score-table-row"
                  key={result.id}
                  onClick={() => inspectDocument(result)}
                >
                  <span className="document-cell">
                    <span>{result.benchmark_cases.test_id.split("/").at(-1)}</span>
                  </span>
                  <span className="dimension-pill">
                    {DIMENSION_LABELS[result.run_dimensions.dimension] ?? humanize(result.run_dimensions.dimension)}
                  </span>
                  <span className={`score-number score-${scoreTone(result.primary_score)}`}>
                    {scorePercent(result.primary_score)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title="No document scores" body="There are no granular results attached to this run." />
          )}
      </section>
    </main>
  );
}

function DocumentExplorer({
  bundle,
  documents,
  documentTotal,
  documentPage,
  setDocumentPage,
  documentsLoading,
  selected,
  selectDocument,
  dimension,
  setDimension,
  search,
  setSearch,
  ceiling,
  setCeiling,
  artifact,
  caseMetrics,
}: {
  bundle: RunBundle;
  documents: CaseResult[];
  documentTotal: number;
  documentPage: number;
  setDocumentPage: (page: number) => void;
  documentsLoading: boolean;
  selected: CaseResult | null;
  selectDocument: (result: CaseResult) => void;
  dimension: string;
  setDimension: (dimension: string) => void;
  search: string;
  setSearch: (search: string) => void;
  ceiling: number;
  setCeiling: (ceiling: number) => void;
  artifact: ArtifactState;
  caseMetrics: CaseMetric[];
}) {
  const [referenceSelectionFor, setReferenceSelectionFor] = useState<number | null>(null);
  const [markdownMode, setMarkdownMode] = useState<MarkdownMode>("preview");
  const [mobileInspecting, setMobileInspecting] = useState(false);
  const [mobileViewer, setMobileViewer] = useState<"source" | "output">("source");
  const pageCount = Math.max(1, Math.ceil(documentTotal / 120));
  const selectedSource = selected ? sourceAssetUrl(selected) : null;
  const selectedSourceKind = selected ? sourceAssetKind(selected) : "unsupported";
  const selectedSourceLabel = selectedSourceKind === "pdf" ? "PDF preview" :
    selectedSourceKind === "image" ? "Image preview" : "Source asset";
  const hasReference = Boolean(artifact.reference?.trim());
  const showingReference = hasReference && referenceSelectionFor === selected?.id;
  const shownMarkdown = showingReference ? artifact.reference ?? "" : artifact.markdown;

  return (
    <main className={`explorer-shell ${mobileInspecting ? "mobile-inspecting" : ""}`}>
      <aside className="document-browser">
        <div className="browser-heading">
          <div>
            <span className="eyebrow">Low-score finder</span>
            <h2>Documents</h2>
          </div>
          <span className="result-count" title={`${documentTotal.toLocaleString()} matching documents`}>{formatCompact(documentTotal)}</span>
        </div>
        <label className="search-field compact-search">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search document name"
            aria-label="Search document name"
          />
        </label>
        <div className="filter-row">
          <label>
            <span>Dimension</span>
            <select value={dimension} onChange={(event) => setDimension(event.target.value)}>
              <option value="all">All dimensions</option>
              {bundle.dimensions.map((item) => (
                <option value={item.dimension} key={item.id}>
                  {DIMENSION_LABELS[item.dimension] ?? humanize(item.dimension)}
                </option>
              ))}
            </select>
          </label>
          <label className="ceiling-filter">
            <span>Score ≤ <strong>{ceiling}%</strong></span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={ceiling}
              onChange={(event) => setCeiling(Number(event.target.value))}
            />
          </label>
        </div>
        <div className="document-list" aria-live="polite">
          {documentsLoading ? (
            <div className="loading-list" role="status">Finding low scores…</div>
          ) : documents.length ? (
            documents.map((result) => (
              <button
                type="button"
                key={result.id}
                className={`document-row ${selected?.id === result.id ? "document-row-selected" : ""}`}
                aria-pressed={selected?.id === result.id}
                onClick={() => { selectDocument(result); setMobileViewer("source"); setMobileInspecting(true); }}
              >
                <div className="document-row-main">
                  <div>
                    <strong>{result.benchmark_cases.test_id.split("/").at(-1)}</strong>
                    <span>{DIMENSION_LABELS[result.run_dimensions.dimension] ?? humanize(result.run_dimensions.dimension)}</span>
                  </div>
                </div>
                <span className={`document-score score-${scoreTone(result.primary_score)}`}>
                  {scorePercent(result.primary_score)}
                </span>
              </button>
            ))
          ) : (
            <EmptyState
              title="No matching low scores"
              body="Raise the score ceiling or change the dimension filter."
            />
          )}
        </div>
        {documentTotal > 120 && (
          <div className="document-pagination" aria-label="Document result pages">
            <button type="button" disabled={documentPage === 0} onClick={() => setDocumentPage(Math.max(0, documentPage - 1))} aria-label="Previous document page">←</button>
            <span>{documentPage + 1} / {pageCount}</span>
            <button type="button" disabled={documentPage >= pageCount - 1} onClick={() => setDocumentPage(Math.min(pageCount - 1, documentPage + 1))} aria-label="Next document page">→</button>
          </div>
        )}
      </aside>

      <section className="inspection-workspace">
        {selected ? (
          <>
            <button className="mobile-back-button" type="button" onClick={() => setMobileInspecting(false)}>← Back to documents</button>
            <header className="inspection-header">
              <div className="inspection-title">
                <div className="breadcrumb">
                  <span>{DIMENSION_LABELS[selected.run_dimensions.dimension] ?? humanize(selected.run_dimensions.dimension)}</span>
                  <span>/</span>
                  <span>{selected.benchmark_cases.inference_group ?? "document"}</span>
                </div>
                <h2>{selected.benchmark_cases.test_id.split("/").at(-1)}</h2>
              </div>
              <div className="inspection-score">
                <span>Primary score</span>
                <strong className={`score-${scoreTone(selected.primary_score)}`}>
                  {scorePercent(selected.primary_score)}
                </strong>
                <small>{humanize(selected.primary_metric_name)}</small>
              </div>
              <div className="metric-strip">
                {caseMetrics.slice(0, 4).map((metric) => (
                  <div className="metric-chip" key={metric.id}>
                    <span>{humanize(metric.metric_name)}</span>
                    <strong>{scorePercent(metric.metric_value)}</strong>
                  </div>
                ))}
              </div>
            </header>

            <div className="mobile-viewer-tabs" aria-label="Document comparison panels">
              <button type="button" aria-pressed={mobileViewer === "source"} className={mobileViewer === "source" ? "mobile-viewer-active" : ""} onClick={() => setMobileViewer("source")}>Source</button>
              <button type="button" aria-pressed={mobileViewer === "output"} className={mobileViewer === "output" ? "mobile-viewer-active" : ""} onClick={() => setMobileViewer("output")}>Parsed output</button>
            </div>

            <div className={`comparison-grid mobile-view-${mobileViewer}`}>
              <article className="viewer-card pdf-card">
                <div className="viewer-toolbar">
                  <div>
                    <span className="viewer-kicker">Source document</span>
                    <strong>{selectedSourceLabel}</strong>
                  </div>
                  {selectedSource && <a className="simple-link" href={selectedSource} target="_blank" rel="noreferrer">Open source ↗</a>}
                </div>
                <div className="pdf-stage">
                  {selectedSource && selectedSourceKind === "pdf" ? (
                    <PdfPreview
                      source={selectedSource}
                      page={selected.benchmark_cases.page_number ?? 1}
                      title={`PDF preview for ${selected.benchmark_cases.test_id}`}
                    />
                  ) : selectedSource && selectedSourceKind === "image" ? (
                    <div
                      className="image-preview"
                      aria-label={`Image preview for ${selected.benchmark_cases.test_id}`}
                    >
                      <Image
                        src={selectedSource}
                        alt={`Source document ${selected.benchmark_cases.test_id}`}
                        fill
                        sizes="(max-width: 760px) 100vw, 50vw"
                        unoptimized
                      />
                    </div>
                  ) : selectedSource ? (
                    <EmptyState title="Preview unavailable" body="Open the source asset to inspect this file type." />
                  ) : (
                    <EmptyState title="Source unavailable" body="This case does not include a dataset source locator." />
                  )}
                </div>
              </article>

              <article className="viewer-card output-card">
                <div className="viewer-toolbar output-toolbar">
                  {hasReference ? (
                    <div className="content-tabs" role="tablist" aria-label="Output comparison">
                      <button
                        id="rendered-output-tab"
                        role="tab"
                        aria-selected={!showingReference}
                        aria-controls="output-panel"
                        className={!showingReference ? "content-tab-active" : ""}
                        onClick={() => setReferenceSelectionFor(null)}
                        type="button"
                      >
                        Rendered output
                      </button>
                      <button
                        id="ground-truth-tab"
                        role="tab"
                        aria-selected={showingReference}
                        aria-controls="output-panel"
                        className={showingReference ? "content-tab-active" : ""}
                        onClick={() => setReferenceSelectionFor(selected.id)}
                        type="button"
                      >
                        Ground truth
                      </button>
                    </div>
                  ) : (
                    <div className="output-heading">
                      <span className="viewer-kicker">Evaluation result</span>
                      <strong>Rendered output</strong>
                    </div>
                  )}
                  <div className="viewer-actions">
                    <div className="mode-toggle" aria-label="Markdown display mode">
                      <button
                        aria-pressed={markdownMode === "preview"}
                        className={markdownMode === "preview" ? "mode-active" : ""}
                        onClick={() => setMarkdownMode("preview")}
                        type="button"
                      >
                        Preview
                      </button>
                      <button
                        aria-pressed={markdownMode === "source"}
                        className={markdownMode === "source" ? "mode-active" : ""}
                        onClick={() => setMarkdownMode("source")}
                        type="button"
                      >
                        Source
                      </button>
                    </div>
                    {artifact.url && (
                      <a href={artifact.url} target="_blank" rel="noreferrer" className="simple-link" aria-label="Open result JSON">
                        JSON ↗
                      </a>
                    )}
                  </div>
                </div>
                <div
                  className="markdown-stage"
                  id="output-panel"
                  role={hasReference ? "tabpanel" : undefined}
                  aria-labelledby={hasReference ? (showingReference ? "ground-truth-tab" : "rendered-output-tab") : undefined}
                >
                  {artifact.loading ? (
                    <div className="artifact-loading">Loading rendered artifact…</div>
                  ) : artifact.error ? (
                    <EmptyState title="Output unavailable" body={artifact.error} />
                  ) : shownMarkdown ? (
                    markdownMode === "preview" ? (
                      <MarkdownPanel markdown={shownMarkdown} />
                    ) : (
                      <pre className="markdown-source"><code>{shownMarkdown}</code></pre>
                    )
                  ) : (
                    <EmptyState title="No rendered markdown" body="The indexed result does not contain a markdown payload." />
                  )}
                </div>
              </article>
            </div>
          </>
        ) : (
          <EmptyState title="Select a document" body="Choose a low-scoring document to inspect its PDF and parser output." />
        )}
      </section>
    </main>
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
  const view: View = pathname.endsWith("/documents")
    ? "documents"
    : githubRunId == null ? "runs" : "overview";
  const routeDimension = searchParams.get("dimension") || "all";
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runScores, setRunScores] = useState<RunScoreIndex>({});
  const [runScoresLoading, setRunScoresLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<RunBundle>(EMPTY_BUNDLE);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [documents, setDocuments] = useState<CaseResult[]>([]);
  const [documentTotal, setDocumentTotal] = useState(0);
  const [documentPage, setDocumentPage] = useState(0);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<CaseResult | null>(null);
  const [dimension, setDimension] = useState(routeDimension);
  const [search, setSearch] = useState("");
  const [ceiling, setCeiling] = useState(65);
  const [caseMetrics, setCaseMetrics] = useState<CaseMetric[]>([]);
  const [artifact, setArtifact] = useState<ArtifactState>(EMPTY_ARTIFACT);

  const selectedRun = githubRunId == null
    ? null
    : runs.find((run) => run.github_run_id === githubRunId) ?? null;

  useEffect(() => {
    const controller = new AbortController();
    loadRuns(controller.signal)
      .then((loadedRuns) => {
        setRuns(loadedRuns);
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRunsLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    // Route changes intentionally reset the view-specific document filters.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDocumentPage(0);
    setSearch("");
    setDimension(view === "documents" ? routeDimension : "all");
  }, [githubRunId, routeDimension, view]);

  useEffect(() => {
    if (!runs.length) return;
    const controller = new AbortController();
    // This loading state follows the catalog score request lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRunScoresLoading(true);
    loadRunScores(runs.map((run) => run.id), controller.signal)
      .then(setRunScores)
      .catch((error: Error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRunScoresLoading(false);
      });
    return () => controller.abort();
  }, [runs]);

  useEffect(() => {
    if (!selectedRun) return;
    const controller = new AbortController();
    // This reset intentionally belongs to the selected-run synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBundleLoading(true);
    setBundle(EMPTY_BUNDLE);
    loadRunBundle(selectedRun.id, controller.signal)
      .then(setBundle)
      .catch((error: Error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBundleLoading(false);
      });
    return () => controller.abort();
  }, [selectedRun]);

  useEffect(() => {
    if (!selectedRun) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setDocumentsLoading(true);
      loadDocuments(
        selectedRun.id,
        {
          dimension,
          search,
          ceiling: ceiling / 100,
          limit: 120,
          offset: documentPage * 120,
        },
        controller.signal,
      )
        .then(({ documents: loadedDocuments, total }) => {
          setDocuments(loadedDocuments);
          setDocumentTotal(total);
          setSelectedDocument((current) =>
            loadedDocuments.find((document) => document.id === current?.id) ??
            loadedDocuments.find((document) => document.primary_score != null) ??
            null,
          );
        })
        .catch((error: Error) => {
          if (error.name !== "AbortError") setLoadError(error.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setDocumentsLoading(false);
        });
    }, search ? 280 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [ceiling, documentPage, selectedRun, dimension, search]);

  useEffect(() => {
    if (!selectedRun || !selectedDocument) {
      return;
    }
    const controller = new AbortController();
    // This reset intentionally belongs to the selected-document synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCaseMetrics([]);
    setArtifact({
      loading: true,
      markdown: "",
      reference: null,
      url: artifactUrl(selectedRun, selectedDocument.result_relative_path),
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
    loadGroundTruth(selectedDocument)
      .then((reference) => {
        if (!controller.signal.aborted && reference) {
          setArtifact((current) => ({ ...current, reference }));
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [selectedRun, selectedDocument]);

  function selectWorkflow(candidate: BenchmarkRun) {
    setLoadError(null);
    if (candidate.id !== selectedRun?.id) {
      setBundle(EMPTY_BUNDLE);
      setDocuments([]);
      setDocumentTotal(0);
      setSelectedDocument(null);
      setCaseMetrics([]);
      setArtifact(EMPTY_ARTIFACT);
    }
    setDocumentPage(0);
    setDimension("all");
    setSearch("");
    setCeiling(65);
    router.push(`/workflows/${candidate.github_run_id}`);
  }

  function inspectDimension(nextDimension: string) {
    setDimension(nextDimension);
    setSearch("");
    setDocumentPage(0);
    if (!selectedRun) return;
    const query = nextDimension === "all" ? "" : `?dimension=${encodeURIComponent(nextDimension)}`;
    router.push(`/workflows/${selectedRun.github_run_id}/documents${query}`);
  }

  function inspectDocument(result: CaseResult) {
    setDimension(result.run_dimensions.dimension);
    setDocumentPage(0);
    setSelectedDocument(result);
    if (!selectedRun) return;
    const query = new URLSearchParams({ dimension: result.run_dimensions.dimension });
    router.push(`/workflows/${selectedRun.github_run_id}/documents?${query.toString()}`);
  }

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
            <Link href={`/workflows/${selectedRun.github_run_id}`} aria-current={view === "overview" ? "page" : undefined} className={view === "overview" ? "view-nav-active" : ""}>
              Overview
            </Link>
          ) : <span aria-disabled="true">Overview</span>}
          {selectedRun ? (
            <Link href={`/workflows/${selectedRun.github_run_id}/documents`} aria-current={view === "documents" ? "page" : undefined} className={view === "documents" ? "view-nav-active" : ""}>
              Documents
            </Link>
          ) : <span aria-disabled="true">Documents</span>}
        </nav>
      </header>

      {view !== "runs" && (
        <section className="run-command-bar">
          <div className="run-context">
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
              <h1>{runsLoading ? "Loading latest workflow…" : "No workflow selected"}</h1>
            )}
          </div>
          <div className="run-toolbar-actions">
            <Link className="primary-action" href="/workflows">Browse workflows</Link>
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
          runs={runs}
          scores={runScores}
          loading={runsLoading}
          scoresLoading={runScoresLoading}
          onSelect={selectWorkflow}
        />
      ) : selectedRun ? (
        view === "overview" ? (
          <Overview
            run={selectedRun}
            bundle={bundle}
            documents={documents}
            loading={bundleLoading}
            inspectDimension={inspectDimension}
            inspectDocument={inspectDocument}
          />
        ) : (
          <DocumentExplorer
            bundle={bundle}
            documents={documents}
            documentTotal={documentTotal}
            documentPage={documentPage}
            setDocumentPage={setDocumentPage}
            documentsLoading={documentsLoading}
            selected={selectedDocument}
            selectDocument={setSelectedDocument}
            dimension={dimension}
            setDimension={(nextDimension) => { setDimension(nextDimension); setDocumentPage(0); }}
            search={search}
            setSearch={(nextSearch) => { setSearch(nextSearch); setDocumentPage(0); }}
            ceiling={ceiling}
            setCeiling={(nextCeiling) => { setCeiling(nextCeiling); setDocumentPage(0); }}
            artifact={artifact}
            caseMetrics={caseMetrics}
          />
        )
      ) : (
        <main className="content-shell">
          <EmptyState
            title={runsLoading ? "Loading workflow" : "Workflow not found"}
            body={runsLoading
              ? "Loading the selected workflow from the benchmark index."
              : `Workflow run #${githubRunId} is not in the benchmark index.`}
          />
        </main>
      )}
      {children}
    </div>
  );
}
