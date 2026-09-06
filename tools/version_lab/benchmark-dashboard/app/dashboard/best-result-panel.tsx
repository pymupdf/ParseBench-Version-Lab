import { type CaseResult, humanize } from "../lib/data";
import type { DiagnosticArtifact } from "../diagnostics/types";
import { DiagnosticInspector, GroundTruthInspector } from "../diagnostics/lazy-inspectors";
import type { ArtifactState, HistoricalBestState } from "./types";
import {
  alignedPrimaryMetric,
  formatShortDate,
  scorePercent,
  shortSha,
} from "./format";
import { EmptyState, EmptyMarkdownArtifact } from "./shared";
import { MarkdownPanel } from "./markdown-panel";
import { useState, useId, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";

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
  const primary = alignedPrimaryMetric(result, diagnostic);
  return (
    <section className="best-result-evidence" aria-label={`${label} scoring evidence`}>
      <header className="best-result-evidence-heading">
        <div>
          <span className="diagnostic-eyebrow">{label}</span>
          <h3>{humanize(primary.name)}</h3>
        </div>
        <strong>{scorePercent(primary.score)}</strong>
      </header>
      {diagnostic ? (
        <DiagnosticInspector
          diagnostic={diagnostic}
          actualMarkdown={artifact.markdown}
          actualMarkdownState={artifact.markdownState}
        />
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
        ) : artifact.markdownState === "present" ? (
          <MarkdownPanel markdown={artifact.markdown} />
        ) : (
          <EmptyMarkdownArtifact state={artifact.markdownState} />
        )}
      </section>
    </section>
  );
}

export function BestResultPanel({
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
  const currentPrimary = alignedPrimaryMetric(current, currentDiagnostic);
  const bestPrimary = alignedPrimaryMetric(result, best.diagnostic);
  const improvement = (bestPrimary.score ?? 0) - (currentPrimary.score ?? 0);
  const groundTruthDiagnostic = currentDiagnostic ?? best.diagnostic;
  const bestHref = `/workflows/${run.github_run_id}/triage/${result.id}?dimension=${encodeURIComponent(result.run_dimensions.dimension)}&from=triage`;
  const views: Array<{ value: BestComparisonView; label: string; score?: string }> = [
    { value: "ground-truth", label: "Ground truth" },
    { value: "current", label: "Current", score: scorePercent(currentPrimary.score) },
    { value: "best", label: "Best", score: scorePercent(bestPrimary.score) },
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
            <h2 id="best-result-heading">{scorePercent(bestPrimary.score)}</h2>
            <strong>+{(improvement * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })} points</strong>
          </div>
          <p>Compared with the current {scorePercent(currentPrimary.score)} headline score.</p>
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
