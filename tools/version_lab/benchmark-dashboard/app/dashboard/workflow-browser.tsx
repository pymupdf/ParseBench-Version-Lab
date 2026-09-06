import { RunHistory } from "../run-history";
import { Icon } from "../ui/icons";
import {
  type BenchmarkRun,
  type RunScoreIndex,
  type RunScoreSummary,
  humanize,
} from "../lib/data";
import { useState, useMemo, type FormEvent } from "react";
import {
  ANY_GROUP,
  DIMENSION_LABELS,
  DIMENSION_ORDER,
  DIMENSION_SHORT_LABELS,
} from "./constants";
import type { RunSort } from "./types";
import {
  durationMinutes,
  formatCompact,
  formatDuration,
  formatLatency,
  formatShortDate,
  scorePercent,
  scoreTone,
  shortSha,
  summaryNumber,
  uniqueValues,
} from "./format";
import { runOutcome, unscoredRunDescription } from "./run-outcome";

function usesOutcomeLayout(
  run: BenchmarkRun,
  scores: RunScoreSummary | undefined,
  scoresLoading: boolean,
) {
  const hasScores =
    scores?.aggregate != null ||
    Object.values(scores?.dimensions ?? {}).some((value) => value != null);
  return (
    run.conclusion !== "success" ||
    run.artifact_state !== "complete" ||
    (!scoresLoading && !hasScores)
  );
}

function WorkflowIdentity({
  run,
  showIds,
  showSource = false,
}: {
  run: BenchmarkRun;
  showIds: boolean;
  showSource?: boolean;
}) {
  const title = run.pipeline_name ?? run.run_name;
  return (
    <span className="workflow-identity">
      <span className="workflow-title-line">
        <strong>{title ? humanize(title) : `Run #${run.github_run_id}`}</strong>
        {showIds && (
          <code className="workflow-run-id">#{run.github_run_id}</code>
        )}
        {run.github_run_attempt > 1 && (
          <em>Attempt {run.github_run_attempt}</em>
        )}
      </span>
      {run.run_name && <small>{run.run_name}</small>}
      {showSource && (run.head_branch || run.head_sha) && (
        <small className="workflow-outcome-source">
          {[run.head_branch, run.head_sha ? shortSha(run.head_sha) : null]
            .filter(Boolean)
            .join(" · ")}
        </small>
      )}
    </span>
  );
}

function WorkflowOutcomeRow({
  run,
  scores,
  scoresLoading,
  showIds,
  onSelect,
}: {
  run: BenchmarkRun;
  scores?: RunScoreSummary;
  scoresLoading: boolean;
  showIds: boolean;
  onSelect: (run: BenchmarkRun) => void;
}) {
  const outcome = runOutcome(run);
  const retainedDimensions = DIMENSION_ORDER.filter(
    (dimension) => scores?.dimensions[dimension] != null,
  );
  const duration = durationMinutes(run);
  const action = retainedDimensions.length
    ? "View retained results"
    : outcome.action;
  return (
    <button
      type="button"
      className="workflow-row workflow-outcome-row"
      data-outcome={outcome.tone}
      onClick={() => onSelect(run)}
      aria-label={`Open workflow run ${run.github_run_id}: ${action}`}
    >
      <WorkflowIdentity run={run} showIds={showIds} showSource />
      <span className="workflow-outcome-lane">
        <span className="workflow-outcome-symbol" aria-hidden="true">
          {outcome.tone === "failed"
            ? "!"
            : outcome.tone === "cancelled"
              ? "×"
              : "·"}
        </span>
        <span className="workflow-outcome-copy">
          <strong>{outcome.label}</strong>
          {scoresLoading ? (
            <span>Checking for retained benchmark scores…</span>
          ) : retainedDimensions.length ? (
            <>
              <span className="workflow-retained-label">
                {run.artifact_state === "complete"
                  ? "Benchmark results retained"
                  : "Partial results retained"}
              </span>
              <span
                className="workflow-retained-scores"
                aria-label="Retained dimension scores"
              >
                {retainedDimensions.map((dimension) => (
                  <span key={dimension}>
                    <span>{DIMENSION_LABELS[dimension]}</span>
                    <strong>
                      {scorePercent(scores?.dimensions[dimension])}
                    </strong>
                  </span>
                ))}
              </span>
            </>
          ) : (
            <span>{unscoredRunDescription(run)}</span>
          )}
        </span>
        <span className="workflow-outcome-action">
          {action}
          <Icon name="arrow" size={15} />
        </span>
      </span>
      <span className="workflow-created">
        {run.source_created_at && (
          <strong>{formatShortDate(run.source_created_at)}</strong>
        )}
        {duration != null && <small>{formatDuration(duration)} duration</small>}
      </span>
    </button>
  );
}

export function WorkflowBrowser({
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
  const [periodReferenceTime, setPeriodReferenceTime] = useState<number | null>(
    null,
  );
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
  const pipelines = useMemo(
    () => uniqueValues(runs, "pipeline_name").sort(),
    [runs],
  );
  const branches = useMemo(
    () => uniqueValues(runs, "head_branch").sort(),
    [runs],
  );
  const conclusions = useMemo(
    () => uniqueValues(runs, "conclusion").sort(),
    [runs],
  );
  const scopes = useMemo(
    () => uniqueValues(runs, "effective_scope").sort(),
    [runs],
  );
  const groups = useMemo(
    () => uniqueValues(runs, "effective_group").sort(),
    [runs],
  );

  const scoreLeaders = useMemo(() => {
    const comparableRuns = completeRuns.filter(
      (run) => run.leaderboard_eligible,
    );
    const metrics: Array<{
      key: "aggregate" | (typeof DIMENSION_ORDER)[number];
      label: string;
    }> = [
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
        const groupMatches =
          metric.key === "aggregate"
            ? run.effective_group === "all"
            : run.effective_group === "all" ||
              run.effective_group === metric.key;
        if (!groupMatches) continue;
        const runScores = scores[run.id];
        const candidate =
          metric.key === "aggregate"
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
      if (normalizedQuery && !searchable.includes(normalizedQuery))
        return false;
      if (pipeline !== "all" && run.pipeline_name !== pipeline) return false;
      if (branch !== "all" && run.head_branch !== branch) return false;
      if (conclusion !== "all" && run.conclusion !== conclusion) return false;
      if (scope !== "all" && run.effective_scope !== scope) return false;
      if (group !== ANY_GROUP && run.effective_group !== group) return false;
      if (period !== "all") {
        const created = run.source_created_at
          ? new Date(run.source_created_at).getTime()
          : 0;
        if (
          !created ||
          periodReferenceTime == null ||
          periodReferenceTime - created > periodMs[period]
        )
          return false;
      }
      return true;
    });
    return filtered.sort((a, b) => {
      if (sort === "oldest") {
        return (
          new Date(a.source_created_at ?? 0).getTime() -
          new Date(b.source_created_at ?? 0).getTime()
        );
      }
      if (sort === "largest") {
        return (
          (summaryNumber(b, "total") ?? -1) - (summaryNumber(a, "total") ?? -1)
        );
      }
      if (sort === "fastest") {
        return (
          (summaryNumber(a, "avg_latency_ms") ?? Number.POSITIVE_INFINITY) -
          (summaryNumber(b, "avg_latency_ms") ?? Number.POSITIVE_INFINITY)
        );
      }
      return (
        new Date(b.source_created_at ?? 0).getTime() -
        new Date(a.source_created_at ?? 0).getTime()
      );
    });
  }, [
    branch,
    conclusion,
    group,
    period,
    periodReferenceTime,
    pipeline,
    query,
    runs,
    scope,
    sort,
  ]);

  const pageCount = Math.max(1, Math.ceil(filteredRuns.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visibleRuns = filteredRuns.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize,
  );
  const allVisibleOutcomes = visibleRuns.every((run) =>
    usesOutcomeLayout(run, scores[run.id], scoresLoading),
  );
  const hasFilters = Boolean(
    query ||
    pipeline !== "all" ||
    branch !== "all" ||
    conclusion !== "all" ||
    scope !== "all" ||
    group !== ANY_GROUP ||
    period !== "all",
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
    const match = runs.find(
      (run) =>
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
    <main id="main-content" tabIndex={-1} className="content-shell runs-shell">
      <section className="catalog-hero">
        <div>
          <span className="eyebrow hero-eyebrow">
            <span /> The parsing performance workspace
          </span>
          <h1>
            Benchmark
            <br />
            <span>intelligence.</span>
          </h1>
          <p>
            Track every run. Find the gaps. Get closer to the source.
            <br className="desktop-break" /> Your document parsing performance,
            in focus.
          </p>
        </div>
        <RunHistory
          runs={runs}
          scores={scores}
          loading={scoresLoading}
          onSelect={onSelect}
        />
      </section>

      <div className="catalog-quick-access">
        <div>
          <Icon name="search" />
          <span>Have a specific run in mind?</span>
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
      </div>

      <section className="score-leaders" aria-label="Highest workflow scores">
        <div className="score-leaders-heading">
          <div>
            <span className="eyebrow">01 / Personal bests</span>
            <h2>The benchmark ceiling</h2>
          </div>
          <p>
            Quick runs are excluded. Full-dataset runs compete only in the
            dimensions they completely evaluated.
          </p>
        </div>
        <div className="score-leader-grid">
          {scoreLeaders.map((leader) => (
            <button
              className={`score-leader-card ${leader.key === "aggregate" ? "score-leader-primary" : ""}`}
              disabled={!leader.run}
              key={leader.key}
              onClick={() => leader.run && onSelect(leader.run)}
              type="button"
              aria-label={
                leader.run
                  ? `Open ${leader.label} leader, workflow run ${leader.run.github_run_id}`
                  : `${leader.label} score unavailable`
              }
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
              <div className="leader-score-track" aria-hidden="true">
                <span
                  style={{
                    width: `${Math.max(0, Math.min(100, (leader.score ?? 0) * 100))}%`,
                  }}
                />
              </div>
              <em aria-hidden="true">
                Explore run <Icon name="arrow" size={14} />
              </em>
            </button>
          ))}
        </div>
      </section>

      <section className="catalog-panel" aria-label="Workflow catalog">
        <div className="catalog-section-heading">
          <div>
            <span className="eyebrow">02 / The run library</span>
            <h2>Every run tells a story.</h2>
          </div>
          <span>Search. Filter. Investigate.</span>
        </div>
        <div className="catalog-toolbar">
          <label className="catalog-search">
            <span>Search workflows</span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              placeholder="Search ID, commit, branch, pipeline, name…"
              type="search"
            />
          </label>
          <label className="sort-control">
            <span>Sort by</span>
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as RunSort);
                setPage(0);
              }}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="largest">Largest run</option>
              <option value="fastest">Lowest latency</option>
            </select>
          </label>
        </div>

        <div className="catalog-filter-disclosure">
          <button
            className="catalog-filter-toggle"
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((current) => !current)}
          >
            <span>Filters</span>
            <small>6 filter options</small>
          </button>
          <div
            className={`catalog-filters ${filtersOpen ? "catalog-filters-open" : ""}`}
          >
            <label>
              <span>Pipeline</span>
              <select
                value={pipeline}
                onChange={(event) => {
                  setPipeline(event.target.value);
                  setPage(0);
                }}
              >
                <option value="all">All pipelines</option>
                {pipelines.map((value) => (
                  <option value={value} key={value}>
                    {humanize(value)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Branch</span>
              <select
                value={branch}
                onChange={(event) => {
                  setBranch(event.target.value);
                  setPage(0);
                }}
              >
                <option value="all">All branches</option>
                {branches.map((value) => (
                  <option value={value} key={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Result</span>
              <select
                value={conclusion}
                onChange={(event) => {
                  setConclusion(event.target.value);
                  setPage(0);
                }}
              >
                <option value="all">All results</option>
                {conclusions.map((value) => (
                  <option value={value} key={value}>
                    {humanize(value)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Scope</span>
              <select
                value={scope}
                onChange={(event) => {
                  setScope(event.target.value);
                  setPage(0);
                }}
              >
                <option value="all">Any scope</option>
                {scopes.map((value) => (
                  <option value={value} key={value}>
                    {humanize(value)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Group</span>
              <select
                value={group}
                onChange={(event) => {
                  setGroup(event.target.value);
                  setPage(0);
                }}
              >
                <option value={ANY_GROUP}>Any group</option>
                {groups.map((value) => (
                  <option value={value} key={value}>
                    {humanize(value)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Created</span>
              <select
                value={period}
                onChange={(event) => {
                  const value = event.target.value;
                  setPeriod(value);
                  setPeriodReferenceTime(value === "all" ? null : Date.now());
                  setPage(0);
                }}
              >
                <option value="all">Any time</option>
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
            </label>
          </div>
        </div>

        <div className="catalog-results-bar" aria-live="polite">
          <p>
            <strong>{filteredRuns.length}</strong> matching{" "}
            {filteredRuns.length === 1 ? "workflow run" : "workflow runs"}
          </p>
          <div className="catalog-results-actions">
            <button
              type="button"
              className="id-toggle"
              aria-pressed={showIds}
              onClick={() => setShowIds((current) => !current)}
            >
              {showIds ? "Hide run IDs" : "Show run IDs"}
            </button>
            {hasFilters && (
              <button
                type="button"
                className="text-button"
                onClick={clearFilters}
              >
                Clear all filters
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="loading-panel">Loading workflow catalog…</div>
        ) : visibleRuns.length ? (
          <div className="workflow-table">
            <div className="workflow-table-head" aria-hidden="true">
              <span>Workflow</span>
              {allVisibleOutcomes ? (
                <span className="workflow-outcome-heading">
                  Execution outcome
                </span>
              ) : (
                <>
                  <span>Aggregate</span>
                  <span>Dimension scores</span>
                  <span>Source</span>
                  <span>Configuration</span>
                </>
              )}
              <span>Created</span>
              <span />
            </div>
            {visibleRuns.map((run) => {
              const runScores = scores[run.id];
              if (usesOutcomeLayout(run, runScores, scoresLoading))
                return (
                  <WorkflowOutcomeRow
                    key={run.id}
                    run={run}
                    scores={runScores}
                    scoresLoading={scoresLoading}
                    showIds={showIds}
                    onSelect={onSelect}
                  />
                );
              return (
                <button
                  type="button"
                  className="workflow-row"
                  key={run.id}
                  onClick={() => onSelect(run)}
                  aria-label={`Open workflow run ${run.github_run_id}`}
                >
                  <WorkflowIdentity run={run} showIds={showIds} />
                  <span className="workflow-aggregate">
                    <strong
                      className={`score-${scoreTone(runScores?.aggregate)}`}
                    >
                      {scoresLoading ? "…" : scorePercent(runScores?.aggregate)}
                    </strong>
                    <small>
                      {humanize(run.conclusion ?? run.status)} ·{" "}
                      {run.artifact_state === "complete"
                        ? `${humanize(run.coverage_status)} coverage`
                        : `${humanize(run.artifact_state)} artifacts`}
                    </small>
                  </span>
                  <span
                    className="workflow-dimension-scores"
                    aria-label="Dimension scores"
                  >
                    {DIMENSION_ORDER.filter(
                      (dimension) =>
                        scoresLoading ||
                        runScores?.dimensions[dimension] != null,
                    ).map((dimension) => (
                      <span
                        key={dimension}
                        title={`${DIMENSION_LABELS[dimension]}: ${scorePercent(runScores?.dimensions[dimension])}`}
                      >
                        <small>{DIMENSION_SHORT_LABELS[dimension]}</small>
                        <strong
                          className={`score-${scoreTone(runScores?.dimensions[dimension])}`}
                        >
                          {scoresLoading
                            ? "…"
                            : scorePercent(runScores?.dimensions[dimension])}
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
                    <small>
                      {humanize(run.effective_group)} ·{" "}
                      {formatCompact(run.observed_document_count)} docs ·{" "}
                      {formatLatency(summaryNumber(run, "avg_latency_ms"))}
                    </small>
                  </span>
                  <span className="workflow-created">
                    <strong>{formatShortDate(run.source_created_at)}</strong>
                    <small>
                      {formatDuration(durationMinutes(run))} duration
                    </small>
                  </span>
                  <span className="workflow-open" aria-hidden="true">
                    →
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="catalog-empty">
            <strong>No workflows match these filters</strong>
            <p>Try a broader search or clear the active filters.</p>
            <button type="button" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        )}

        {filteredRuns.length > pageSize && (
          <div className="pagination" aria-label="Workflow pages">
            <button
              type="button"
              disabled={safePage === 0}
              onClick={() => setPage(Math.max(0, safePage - 1))}
            >
              Previous
            </button>
            <span>
              Page {safePage + 1} of {pageCount}
            </span>
            <button
              type="button"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
            >
              Next
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
