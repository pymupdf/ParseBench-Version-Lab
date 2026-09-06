import Link from "next/link";
import { humanize, type BenchmarkRun, type RunDimension } from "./lib/data";
import { BrandMark, Icon } from "./ui/icons";
import { DIMENSION_LABELS } from "./dashboard/constants";
import { hrefWithTriageFilters } from "./dashboard/filters";
import { formatDate, shortSha } from "./dashboard/format";
import { StatusBadge } from "./dashboard/shared";
import type { TriageFilters, View } from "./dashboard/types";

export function DashboardNavigation({
  view,
  runId,
  caseResultId,
  dimensions,
  filters,
  runCount,
  loading,
  onJump,
}: {
  view: View;
  runId?: number;
  caseResultId: number | null;
  dimensions: RunDimension[];
  filters: TriageFilters;
  runCount: number | null;
  loading: boolean;
  onJump: (href: string) => void;
}) {
  const reportHref =
    runId == null
      ? "/workflows"
      : hrefWithTriageFilters(`/workflows/${runId}`, filters);
  const resultsHref =
    runId == null
      ? "/workflows"
      : hrefWithTriageFilters(`/workflows/${runId}/triage`, filters);
  const dimensionLabel =
    DIMENSION_LABELS[filters.dimension] ?? humanize(filters.dimension);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="topbar location-bar">
        <Link
          className="brand"
          href="/workflows"
          aria-label="ParseBench run observatory home"
        >
          <BrandMark />
          <strong>
            ParseBench<span className="brand-period">.</span>
          </strong>
        </Link>

        <nav className="location-trail" aria-label="Current location">
          <ol>
            <li className="location-library">
              <Link
                href="/workflows"
                aria-label="Run library"
                aria-current={view === "runs" ? "page" : undefined}
              >
                <Icon name="grid" size={15} />
                <span>Run library</span>
              </Link>
            </li>
            {runId != null && (
              <li className="location-run">
                <Link
                  href={reportHref}
                  aria-label="Run report"
                  aria-current={view === "overview" ? "page" : undefined}
                  title={`Run #${runId} report`}
                >
                  <span className="location-run-prefix">Run </span>
                  <span>#{runId}</span>
                </Link>
              </li>
            )}
            {(view === "triage" || view === "inspect") && (
              <li className="location-dimension">
                <Link
                  href={resultsHref}
                  aria-label={
                    view === "inspect"
                      ? `Back to ${dimensionLabel} results`
                      : `${dimensionLabel} results`
                  }
                  aria-current={view === "triage" ? "page" : undefined}
                >
                  {dimensionLabel}
                </Link>
              </li>
            )}
            {view === "inspect" && (
              <li className="location-document">
                <span
                  aria-current="page"
                  title={`Document result #${caseResultId ?? "—"}`}
                >
                  Document
                </span>
              </li>
            )}
          </ol>
        </nav>

        <div className="location-actions">
          {runId != null ? (
            <label className="run-jump-control">
              <Icon name="layers" size={15} />
              <select
                aria-label="Jump within this run"
                value=""
                onChange={(event) => onJump(event.target.value)}
              >
                <option value="" disabled>
                  Jump within this run
                </option>
                <option value={reportHref}>Run report</option>
                <optgroup label="Dimension results">
                  {dimensions.map((dimension) => (
                    <option
                      key={dimension.id}
                      value={hrefWithTriageFilters(
                        `/workflows/${runId}/triage`,
                        {
                          ...filters,
                          dimension: dimension.dimension,
                          page:
                            dimension.dimension === filters.dimension
                              ? filters.page
                              : 0,
                        },
                      )}
                    >
                      {DIMENSION_LABELS[dimension.dimension] ??
                        humanize(dimension.dimension)}{" "}
                      · {dimension.total_examples?.toLocaleString() ?? "—"}{" "}
                      cases
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
          ) : (
            <span className="library-index-status" role="status">
              {loading
                ? "Loading run index…"
                : `${runCount?.toLocaleString() ?? "—"} indexed runs`}
            </span>
          )}
          <a
            className="repository-link"
            href="https://github.com/pymupdf/ParseBench-Version-Lab"
            target="_blank"
            rel="noreferrer"
            aria-label="Source repository"
            title="Source repository"
          >
            <Icon name="branch" size={16} />
            <span>Source</span>
            <Icon name="external" size={12} />
          </a>
        </div>
      </header>
    </>
  );
}

export function RunContextBar({
  run,
  runId,
  loading,
  view,
}: {
  run: BenchmarkRun | null;
  runId?: number;
  loading: boolean;
  view: View;
}) {
  if (view === "runs") return null;
  const compact = view !== "overview";
  return (
    <section
      className={`run-context-bar${compact ? " run-context-bar-compact" : ""}`}
      aria-label="Selected run"
    >
      <div className="run-context-identity">
        {run ? (
          <>
            <div className="run-record-title">
              <h1 title={humanize(run.pipeline_name ?? run.run_name)}>
                {humanize(run.pipeline_name ?? run.run_name)}
              </h1>
              <StatusBadge value={run.conclusion ?? run.status} />
              {!compact && (
                <span
                  className={`artifact-badge artifact-${run.artifact_state}`}
                >
                  {humanize(run.artifact_state)} artifacts
                </span>
              )}
            </div>
            <div className="run-meta">
              {!compact && <span>{formatDate(run.source_created_at)}</span>}
              <span>
                {run.head_branch ?? "Unknown branch"} ·{" "}
                <code>{shortSha(run.head_sha)}</code>
              </span>
              <span>
                {humanize(run.effective_scope)} ·{" "}
                {humanize(run.effective_group)}
              </span>
              {!compact && <span>Attempt #{run.github_run_attempt}</span>}
            </div>
          </>
        ) : (
          <h1>
            {loading ? `Loading run #${runId ?? "—"}…` : `Run #${runId ?? "—"}`}
          </h1>
        )}
      </div>
      {run?.github_run_url && (
        <a
          className="run-log-link"
          href={run.github_run_url}
          target="_blank"
          rel="noreferrer"
        >
          <Icon name="external" size={13} />
          <span>Workflow logs</span>
        </a>
      )}
    </section>
  );
}
