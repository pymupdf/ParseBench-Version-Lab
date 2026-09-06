import {
  humanize,
  primaryMetricForDimension,
  type BenchmarkRun,
  type DimensionMetric,
  type RunBundle,
  type RunDimension,
  type TriageCaseResult,
} from "../lib/data";
import {
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
import { DimensionIcon, dimensionPresentation } from "./dimension-presentation";

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
  const presentation = dimensionPresentation(dimension.dimension);
  const coverageLabel = `${evaluatedCount?.toLocaleString() ?? "—"} / ${totalCount?.toLocaleString() ?? "—"} scored`;
  return (
    <button
      className="dimension-card report-dimension-row dimension-context"
      data-dimension={dimension.dimension}
      onClick={onInspect}
      type="button"
    >
      <span className="dimension-row-icon">
        <DimensionIcon dimension={dimension.dimension} />
      </span>
      <span className="dimension-row-name">
        <strong>{presentation.label}</strong>
        <small>{presentation.focus}</small>
      </span>
      <span className="dimension-row-score">
        <strong>{scorePercent(metric?.metric_value)}</strong>
        <ScoreBar score={metric?.metric_value} />
      </span>
      <span className="dimension-row-coverage">
        {coverageLabel}
        <small>
          {dimension.failed
            ? `${dimension.failed.toLocaleString()} evaluation errors`
            : metric
              ? humanize(metric.metric_name)
              : "No aggregate score"}
        </small>
      </span>
      <span className="dimension-row-arrow" aria-hidden="true">
        ↗
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
  inspectDocument: (
    result: TriageCaseResult,
    navigationFilters?: TriageFilters,
  ) => void;
}) {
  const overall = overallScore(bundle);
  const failedFromDimensions = bundle.dimensions.some(
    (dimension) => dimension.failed != null,
  )
    ? bundle.dimensions.reduce(
        (total, dimension) => total + (dimension.failed ?? 0),
        0,
      )
    : null;
  const failed = summaryNumber(run, "failed") ?? failedFromDimensions;
  const total = run.observed_document_count ?? summaryNumber(run, "total");
  const successRate = summaryNumber(run, "success_rate");
  const latency = summaryNumber(run, "avg_latency_ms");
  const scoredDimensions = bundle.dimensions.filter(
    (dimension) => primaryMetricForDimension(dimension, bundle.metrics) != null,
  ).length;
  const selectionMismatch =
    (run.requested_scope != null &&
      run.requested_scope !== run.effective_scope) ||
    (run.requested_group != null &&
      run.requested_group !== run.effective_group);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="content-shell overview-shell report-workspace"
    >
      <section
        className="benchmark-report"
        aria-labelledby="benchmark-result-heading"
      >
        <div className="section-heading benchmark-summary-heading">
          <div>
            <span className="eyebrow">
              Benchmark result · {scopeLabel(run.effective_scope)}
            </span>
            <h2 id="benchmark-result-heading">Evaluation report</h2>
          </div>
          <span className="report-coverage-label">
            {humanize(run.coverage_status)} coverage
          </span>
        </div>

        {loading ? (
          <div className="loading-panel">Loading score profile…</div>
        ) : bundle.dimensions.length ? (
          <div className="report-score-layout">
            <article className="report-composite">
              <span className="eyebrow">Composite score</span>
              <div className="report-composite-value">
                <strong>{scorePercent(overall)}</strong>
              </div>
              <ScoreBar score={overall} />
              <p>
                Mean of {scoredDimensions} scored{" "}
                {scoredDimensions === 1 ? "dimension" : "dimensions"}
              </p>
              <dl className="report-headline-facts">
                <div>
                  <dt>Documents</dt>
                  <dd>{total?.toLocaleString() ?? "—"}</dd>
                </div>
                <div>
                  <dt>Average latency</dt>
                  <dd>{formatLatency(latency)}</dd>
                </div>
                <div>
                  <dt>Evaluation errors</dt>
                  <dd>{failed?.toLocaleString() ?? "—"}</dd>
                </div>
                {successRate != null ? (
                  <div>
                    <dt>Success rate</dt>
                    <dd>{Math.round(successRate)}%</dd>
                  </div>
                ) : null}
              </dl>
            </article>
            <div className="report-dimension-profile">
              <div className="report-profile-heading">
                <h3>Dimension scorecard</h3>
                <span>
                  Select a dimension to inspect its cases{" "}
                  <span aria-hidden="true">↗</span>
                </span>
              </div>
              <div className="score-profile-grid">
                {bundle.dimensions.map((dimension) => (
                  <DimensionCard
                    key={dimension.id}
                    dimension={dimension}
                    metrics={bundle.metrics}
                    onInspect={() => inspectDimension(dimension.dimension)}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            title="No completed benchmark result"
            body={`This ${humanize(run.conclusion ?? run.status).toLowerCase()} workflow attempt is indexed, but it did not produce dimension reports.`}
          />
        )}
      </section>

      {selectionMismatch && (
        <section
          className="execution-notice"
          aria-label="Requested and observed benchmark configuration differ"
        >
          <strong>
            GitHub selection differed from the executed benchmark.
          </strong>
          <p>
            Requested {humanize(run.requested_scope)} ·{" "}
            {humanize(run.requested_group)}; artifacts show{" "}
            {humanize(run.effective_scope)} · {humanize(run.effective_group)}.
            Scores and leaderboard eligibility use the artifact-derived values.
          </p>
        </section>
      )}

      <details className="run-record-details">
        <summary>
          <span>Run record</span>
          <span className="run-record-caption">
            Configuration, source versions & diagnostics
          </span>
          <span className="run-record-expander" aria-hidden="true">
            +
          </span>
        </summary>
        <div className="run-record-content">
          <section
            className="run-details"
            aria-labelledby="run-details-heading"
          >
            <div className="run-details-heading">
              <h3 id="run-details-heading">Execution configuration</h3>
            </div>
            <div className="run-facts">
              <div>
                <span>Pipeline</span>
                <strong>{humanize(run.pipeline_name)}</strong>
              </div>
              <div>
                <span>Evaluation group</span>
                <strong>{humanize(run.effective_group)}</strong>
              </div>
              <div>
                <span>Coverage</span>
                <strong>{humanize(run.coverage_status)}</strong>
              </div>
              <div>
                <span>Trigger</span>
                <strong>{humanize(run.event)}</strong>
              </div>
              <div>
                <span>Attempt</span>
                <strong>#{run.github_run_attempt}</strong>
              </div>
              <div>
                <span>Leaderboard eligible</span>
                <strong>{run.leaderboard_eligible ? "Yes" : "No"}</strong>
              </div>
              {Object.entries(run.pipeline_config ?? {}).map(([key, value]) => (
                <div key={key}>
                  <span>{humanize(key)}</span>
                  <strong>
                    {typeof value === "object"
                      ? JSON.stringify(value)
                      : String(value)}
                  </strong>
                </div>
              ))}
            </div>
          </section>

          <div className="overview-support-grid">
            <section className="section-block compact-block provenance-block">
              <div className="section-heading compact-heading">
                <div>
                  <span className="eyebrow">Provenance</span>
                  <h3>Source stack</h3>
                </div>
                <span className="section-hint commit-help">
                  Hover for the message · click to open the commit
                </span>
              </div>
              <div className="component-list">
                {bundle.components.length ? (
                  bundle.components.map((component) => (
                    <div className="component-row" key={component.id}>
                      <div>
                        <strong>{humanize(component.component)}</strong>
                        <span>
                          {component.installed_version ??
                            component.requested_ref ??
                            "Unversioned"}
                        </span>
                      </div>
                      <CommitLink
                        repository={component.repository}
                        sha={component.resolved_sha}
                      />
                    </div>
                  ))
                ) : (
                  <p className="muted-copy">
                    No component metadata was available.
                  </p>
                )}
              </div>
            </section>

            <section className="section-block compact-block diagnostics-block">
              <div className="section-heading compact-heading">
                <div>
                  <span className="eyebrow">Diagnostics</span>
                  <h3>Run errors</h3>
                </div>
              </div>
              {bundle.errors.length ? (
                <div className="error-list">
                  {bundle.errors.map((error) => (
                    <div className="error-row" key={error.id}>
                      <span>{humanize(error.stage)}</span>
                      <p>{error.message}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  className={
                    run.artifact_state === "complete"
                      ? "clean-run"
                      : "incomplete-run-diagnostic"
                  }
                >
                  {run.artifact_state === "complete"
                    ? "No indexed errors for this run"
                    : "No structured errors were retained for this incomplete run; open GitHub to inspect its logs."}
                </div>
              )}
            </section>
          </div>
        </div>
      </details>

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
