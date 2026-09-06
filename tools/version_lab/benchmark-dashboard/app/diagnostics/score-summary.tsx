"use client";

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
    .filter(([key, value]) =>
      !["passed", "partial", "failed", "total", "source"].includes(key) &&
      (value == null || ["string", "number", "boolean"].includes(typeof value)),
    )
    .slice(0, 4);
  const contract = metricContract(diagnostic);
  const tableBreakdown = diagnostic.dimension === "table"
    ? tableScoreBreakdown(diagnostic)
    : null;
  const showOutcomeCounts = tableBreakdown?.mode !== "grits_only";
  const recordSummary = isTableRecordSummary(diagnostic);
  const summaryMetricName = asString(diagnostic.summary.source)?.split(".", 1)[0] ?? null;
  const summaryContributes = diagnostic.summary.headline_contribution.contributes;

  return (
    <section className="diagnostic-score-summary" aria-labelledby="diagnostic-score-heading">
      <div className="diagnostic-primary-score">
        <span className="diagnostic-eyebrow">Why this score</span>
        <div className="diagnostic-score-line">
          <h2 id="diagnostic-score-heading">{primary ? humanize(primary.name) : "Primary score"}</h2>
          <strong>{scorePercent(primary?.value)}</strong>
        </div>
        {formula.description && <p className="diagnostic-formula">{formula.description}</p>}
        {contract && <p className="diagnostic-metric-contract">{contract}</p>}
      </div>
      {components.length > 0 && (
        <div className="diagnostic-components" aria-label="Score components">
          {components.map((component, index) => (
            <MetricComponent component={component} key={`${component.name ?? component.metric_name ?? "component"}-${index}`} />
          ))}
        </div>
      )}
      {showOutcomeCounts && (
        <div className="diagnostic-count-summary">
          {recordSummary && (
            <p>
              <strong>Table-record-match pairings</strong>
              These counts explain the TRM component, not the composite headline score.
            </p>
          )}
          {!recordSummary && !summaryContributes && summaryMetricName && (
            <p>
              <strong>Supporting rule outcomes</strong>
              These counts summarize {humanize(summaryMetricName)}, a diagnostic metric that does not directly determine the {humanize(primary?.name)} headline score.
            </p>
          )}
          <dl className="diagnostic-outcome-counts" aria-label={recordSummary
            ? "Table-record-match pairing outcomes"
            : summaryContributes
              ? "Headline evaluation outcomes"
              : "Supporting diagnostic outcomes"}
          >
            <div><dt>Passed</dt><dd>{counts.passed.toLocaleString()}</dd></div>
            <div><dt>Partial</dt><dd>{counts.partial.toLocaleString()}</dd></div>
            <div><dt>Failed</dt><dd>{counts.failed.toLocaleString()}</dd></div>
            {counts.unknown > 0 && <div><dt>Not explained</dt><dd>{counts.unknown.toLocaleString()}</dd></div>}
            {summaryScalars.map(([key, value]) => (
              <div key={key}><dt>{humanize(key)}</dt><dd>{scalarDisplay(value)}</dd></div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
