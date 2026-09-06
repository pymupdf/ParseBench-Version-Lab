"use client";

import {
  asRecord,
  buildEvidenceItems,
  evidenceStatus,
  humanize,
  outcomeExplanation,
  scalarDisplay,
  scorePercent,
  type DiagnosticInspectorProps,
} from "./model";
import { chartArrayPreview, chartScoringDescription } from "./chart-model";
import { EmptyDiagnostics, EvidenceButton, StatusPill } from "./primitives";

export function ChartScoringContract() {
  return (
    <aside className="diagnostic-contract-note">
      <strong>What the chart score measures</strong>
      <p>
        The evaluator looks only inside structured Markdown or HTML tables. A label or value that appears
        elsewhere in ordinary page text does not satisfy a chart check. The headline is the mean of the
        per-rule scores below, so array rules can earn partial credit.
      </p>
    </aside>
  );
}

export function ChartDiagnostic({
  diagnostic,
  selectedEvidenceId,
  onSelectEvidence,
}: DiagnosticInspectorProps) {
  const items = buildEvidenceItems(diagnostic);
  if (!items.length) return <EmptyDiagnostics message="No chart expectations were retained for this result." />;
  return (
    <section className="diagnostic-dimension-view diagnostic-chart-view" aria-labelledby="diagnostic-chart-heading">
      <div className="diagnostic-section-heading">
        <div><span className="diagnostic-eyebrow">Chart extraction</span><h3 id="diagnostic-chart-heading">Expected data and outcomes</h3></div>
        <span>{items.length.toLocaleString()} checks</span>
      </div>
      <ChartScoringContract />
      <div className="diagnostic-table-scroll">
        <table className="diagnostic-chart-table">
          <thead><tr><th>Check</th><th>Labels</th><th>Expected</th><th>Matching rule</th><th>Result</th></tr></thead>
          <tbody>
            {items.map((item) => {
              const rule = asRecord(item.expectation?.rule) ?? {};
              const { preview: matrix, summary, truncated } = chartArrayPreview(rule.data);
              const labels = Array.isArray(rule.labels)
                ? rule.labels.map((label) => scalarDisplay(label)).join(" · ")
                : matrix[0]?.map((label) => scalarDisplay(label)).join(" · ") ?? "—";
              const value = rule.value ?? summary;
              const status = evidenceStatus(item.outcome);
              return (
                <tr key={item.id}>
                  <th scope="row">
                    <EvidenceButton
                      id={item.id}
                      selected={selectedEvidenceId === item.id}
                      onSelect={onSelectEvidence}
                      className="diagnostic-evidence-trigger"
                    >
                      <span>{humanize(item.type)}</span>
                      {item.page != null && <small>Page {item.page}</small>}
                    </EvidenceButton>
                  </th>
                  <td>{labels}</td>
                  <td>
                    <span>{scalarDisplay(value)}</span>
                    {matrix.length > 0 && (
                      <details className="diagnostic-matrix-details">
                        <summary>View expected data{truncated ? " · first 12 rows and columns" : ""}</summary>
                        <div className="diagnostic-table-scroll">
                          <table>
                            <tbody>{matrix.map((row, rowIndex) => (
                              <tr key={rowIndex}>{row.map((cell, cellIndex) => (
                                rowIndex === 0
                                  ? <th scope="col" key={cellIndex}>{scalarDisplay(cell)}</th>
                                  : <td key={cellIndex}>{scalarDisplay(cell)}</td>
                              ))}</tr>
                            ))}</tbody>
                          </table>
                        </div>
                      </details>
                    )}
                  </td>
                  <td className="diagnostic-method-cell">{chartScoringDescription(item.type, rule)}</td>
                  <td>
                    <div className="diagnostic-result-cell">
                      <StatusPill status={status} />
                      {item.outcome?.score != null && <strong>{scorePercent(item.outcome.score)}</strong>}
                      {outcomeExplanation(item.outcome) && <small>{outcomeExplanation(item.outcome)}</small>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
