import {
  humanize,
  primaryMetricForDimension,
  type BenchmarkRun,
  type DimensionMetric,
  type RunBundle,
  type RunDimension,
  type TriageCaseResult,
} from "../lib/data";
import { DIMENSION_LABELS } from "./constants";
import {
  countDocuments,
  formatLatency,
  overallScore,
  scopeLabel,
  scorePercent,
  summaryNumber,
} from "./format";
import { ScoreBar, EmptyState } from "./shared";
import type { TriageFilters } from "./types";
import { CommitLink } from "./commit-link";
import { TriageGrid } from "./triage-grid";

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
  const evaluatedCount = metric?.evaluated_count;
  const totalCount = dimension.total_examples;
  const coverageLabel = evaluatedCount != null && totalCount != null && evaluatedCount !== totalCount
    ? `${evaluatedCount.toLocaleString()} of ${totalCount.toLocaleString()} scored`
    : `${(evaluatedCount ?? totalCount ?? 0).toLocaleString()} records`;
  return (
    <button className="dimension-card" onClick={onInspect} type="button">
      <p>{DIMENSION_LABELS[dimension.dimension] ?? humanize(dimension.dimension)}</p>
      <div className="dimension-score-row">
        <strong>{scorePercent(metric?.metric_value)}</strong>
        <span>{coverageLabel}</span>
      </div>
      <ScoreBar score={metric?.metric_value} />
      <span className="metric-caption">
        {metric ? humanize(metric.metric_name) : "No aggregate score"}
      </span>
    </button>
  );
}

export function Overview({
  run,
  bundle,
  documents,
  documentTotal,
  loading,
  documentsLoading,
  documentsError,
  filters,
  updateFilters,
  resetFilters,
  fullPageHref,
  inspectDimension,
  inspectDocument,
}: {
  run: BenchmarkRun;
  bundle: RunBundle;
  documents: TriageCaseResult[];
  documentTotal: number;
  loading: boolean;
  documentsLoading: boolean;
  documentsError: string | null;
  filters: TriageFilters;
  updateFilters: (updates: Partial<TriageFilters>) => void;
  resetFilters: () => void;
  fullPageHref: string;
  inspectDimension: (dimension: string) => void;
  inspectDocument: (result: TriageCaseResult, navigationFilters?: TriageFilters) => void;
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
    <main id="main-content" tabIndex={-1} className="content-shell overview-shell">
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
          error={documentsError}
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
