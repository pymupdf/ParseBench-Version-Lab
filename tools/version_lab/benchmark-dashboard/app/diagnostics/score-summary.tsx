"use client";

import { useId } from "react";

import {
  asNumber,
  asString,
  formulaDetails,
  humanize,
  isTableRecordSummary,
  metricComponents,
  metricContract,
  scalarDisplay,
  scorePercent,
  statusCounts,
  type EvidenceItem,
} from "./model";
import { MetricComponent } from "./primitives";
import { tableScoreBreakdown } from "./table-model";
import type { DiagnosticArtifact } from "./types";

export function PrimaryMetricSummary({
  diagnostic,
  items,
}: {
  diagnostic: DiagnosticArtifact;
  items: EvidenceItem[];
}) {
  const headingId = useId();
  const primary = diagnostic.primary_metric;
  const formula = formulaDetails(primary?.formula);
  const components = metricComponents(primary?.components).length
    ? metricComponents(primary?.components)
    : formula.components;
  const inferredCounts = statusCounts(items);
  const hasSummaryCounts = ["passed", "partial", "failed"].some(
    (key) => asNumber(diagnostic.summary[key]) != null,
  );
  const counts = {
    passed: asNumber(diagnostic.summary.passed) ?? inferredCounts.passed,
    partial: asNumber(diagnostic.summary.partial) ?? inferredCounts.partial,
    failed: asNumber(diagnostic.summary.failed) ?? inferredCounts.failed,
    unknown: hasSummaryCounts ? 0 : inferredCounts.unknown,
  };
  const summaryScalars = Object.entries(diagnostic.summary)
    .filter(
      ([key, value]) =>
        !["passed", "partial", "failed", "total", "source"].includes(key) &&
        (value == null ||
          ["string", "number", "boolean"].includes(typeof value)),
    )
    .slice(0, 4);
  const contract = metricContract(diagnostic);
  const tableBreakdown =
    diagnostic.dimension === "table" ? tableScoreBreakdown(diagnostic) : null;
  const showOutcomeCounts = tableBreakdown?.mode !== "grits_only";
  const recordSummary = isTableRecordSummary(diagnostic);
  const summaryMetricName =
    asString(diagnostic.summary.source)?.split(".", 1)[0] ?? null;
  const summaryContributes =
    diagnostic.summary.headline_contribution.contributes;

  return (
    <section
      className="diagnostic-score-summary score-explanation"
      aria-labelledby={headingId}
    >
      <div className="result-scorecard">
        <div className="result-score-value">
          <span className="diagnostic-eyebrow">Headline score</span>
          <strong>{scorePercent(primary?.value)}</strong>
          <h2 id={headingId}>
            {primary ? humanize(primary.name) : "Primary score"}
          </h2>
        </div>
        {showOutcomeCounts && (
          <div className="result-outcomes">
            <span className="diagnostic-eyebrow">
              {recordSummary
                ? "Table-record pairings"
                : summaryContributes
                  ? "Evaluation outcomes"
                  : "Supporting rule outcomes"}
            </span>
            <dl
              className="diagnostic-outcome-counts"
              aria-label={
                recordSummary
                  ? "Table-record-match pairing outcomes"
                  : summaryContributes
                    ? "Headline evaluation outcomes"
                    : "Supporting diagnostic outcomes"
              }
            >
              <div className="outcome-passed">
                <dt>Passed</dt>
                <dd>{counts.passed.toLocaleString()}</dd>
              </div>
              <div className="outcome-partial">
                <dt>Partial</dt>
                <dd>{counts.partial.toLocaleString()}</dd>
              </div>
              <div className="outcome-failed">
                <dt>Failed</dt>
                <dd>{counts.failed.toLocaleString()}</dd>
              </div>
              {counts.unknown > 0 && (
                <div>
                  <dt>Not explained</dt>
                  <dd>{counts.unknown.toLocaleString()}</dd>
                </div>
              )}
            </dl>
            {recordSummary && (
              <p>
                Pairing outcomes explain the TRM component of the composite
                score.
              </p>
            )}
            {!recordSummary && !summaryContributes && summaryMetricName && (
              <p>
                {humanize(summaryMetricName)} outcomes support the analysis;
                they do not directly determine the headline score.
              </p>
            )}
          </div>
        )}
      </div>
      <details className="scoring-method">
        <summary>
          <span>How this score is calculated</span>
          <span>
            {components.length
              ? `${components.length} component${components.length === 1 ? "" : "s"}`
              : "Scoring definition"}
          </span>
        </summary>
        <div className="scoring-method-body">
          {formula.description && (
            <p className="diagnostic-formula">{formula.description}</p>
          )}
          {contract && <p className="diagnostic-metric-contract">{contract}</p>}
          {components.length > 0 && (
            <div
              className="diagnostic-components"
              aria-label="Score components"
            >
              {components.map((component, index) => (
                <MetricComponent
                  component={component}
                  key={`${component.name ?? component.metric_name ?? "component"}-${index}`}
                />
              ))}
            </div>
          )}
          {summaryScalars.length > 0 && (
            <dl className="score-extra-values">
              {summaryScalars.map(([key, value]) => (
                <div key={key}>
                  <dt>{humanize(key)}</dt>
                  <dd>{scalarDisplay(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </details>
    </section>
  );
}
