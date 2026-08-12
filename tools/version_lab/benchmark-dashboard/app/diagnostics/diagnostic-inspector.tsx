"use client";

import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import type {
  DiagnosticArtifact,
  DiagnosticExpectation,
  DiagnosticMetric,
  DiagnosticMetricComponent,
  DiagnosticOutcome,
} from "./types";

export type DiagnosticInspectorProps = {
  diagnostic: DiagnosticArtifact;
  actualMarkdown: string;
  selectedEvidenceId?: string | null;
  onSelectEvidence?: (evidenceId: string) => void;
};

type EvidenceStatus = "passed" | "partial" | "failed" | "unknown";

type EvidenceItem = {
  id: string;
  type: string;
  page: number | null;
  expectation: DiagnosticExpectation | null;
  outcome: DiagnosticOutcome | null;
};

const TEXT_GROUPS = [
  { key: "completeness", label: "Completeness" },
  { key: "unexpected", label: "Unexpected content" },
  { key: "duplicates", label: "Duplicates" },
  { key: "digits", label: "Digits" },
  { key: "order", label: "Reading order" },
  { key: "other", label: "Other checks" },
] as const;

const FORMATTING_GROUPS = [
  { key: "titles", label: "Titles and hierarchy" },
  { key: "styling", label: "Text styling" },
  { key: "latex", label: "LaTeX" },
  { key: "code", label: "Code blocks" },
  { key: "other", label: "Other checks" },
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is Record<string, unknown> => item != null)
    : [];
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function humanize(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value
    .replace(/^avg_/, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function scorePercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en", {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(value);
}

function scalarDisplay(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => scalarDisplay(item)).join(", ");
  }
  return JSON.stringify(value);
}

function metricComponents(value: unknown): DiagnosticMetricComponent[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const record = asRecord(item);
      const componentValue = asNumber(record?.value);
      if (!record || componentValue == null) return [];
      return [{
        name: asString(record.name) ?? undefined,
        metric_name: asString(record.metric_name) ?? undefined,
        label: asString(record.label) ?? undefined,
        value: componentValue,
        weight: asNumber(record.weight) ?? undefined,
        contribution: asNumber(record.contribution) ?? undefined,
      }];
    });
  }
  const record = asRecord(value);
  if (!record) return [];
  return Object.entries(record).flatMap(([name, componentValue]) => {
    const number = asNumber(componentValue);
    return number == null ? [] : [{ name, value: number }];
  });
}

function formulaDetails(formula: unknown) {
  if (typeof formula === "string") {
    return { description: formula, components: [] as DiagnosticMetricComponent[] };
  }
  const record = asRecord(formula);
  if (!record) return { description: null, components: [] as DiagnosticMetricComponent[] };
  const components = metricComponents(record.components);
  const explicit = asString(record.description);
  if (explicit) return { description: explicit, components };
  const kind = asString(record.kind);
  if (kind === "weighted_mean" && components.length) {
    const terms = components.map((component) => {
      const name = humanize(component.label ?? component.name ?? component.metric_name);
      return component.weight == null ? name : `${name} × ${component.weight.toLocaleString()}`;
    });
    const weightSum = asNumber(record.weight_sum);
    return {
      description: `${terms.join(" + ")}${weightSum != null && weightSum !== 1 ? ` ÷ ${weightSum.toLocaleString()}` : ""}`,
      components,
    };
  }
  if (kind === "fallback") {
    const reason = asString(record.reason);
    return {
      description: reason ? `Fallback score: ${reason}` : "Fallback score",
      components,
    };
  }
  return { description: null, components };
}

function outcomeId(outcome: DiagnosticOutcome, index: number) {
  return asString(outcome.id) ?? asString(outcome.rule_id) ??
    asString(outcome.element_id) ?? `outcome-${index + 1}`;
}

function layoutStatus(outcome: DiagnosticOutcome): EvidenceStatus | null {
  const localization = outcome.localization_pass;
  const classification = outcome.classification_pass;
  const attributionApplicable = outcome.attribution_applicable;
  const attribution = outcome.attribution_pass;
  const checks = [localization, classification];
  if (attributionApplicable === true) checks.push(attribution);
  const booleanChecks = checks.filter((value): value is boolean => typeof value === "boolean");
  if (!booleanChecks.length) return null;
  if (booleanChecks.every(Boolean)) return "passed";
  if (booleanChecks.some(Boolean)) return "partial";
  return "failed";
}

function evidenceStatus(outcome: DiagnosticOutcome | null): EvidenceStatus {
  if (!outcome) return "unknown";
  const status = asString(outcome.status)?.toLowerCase();
  if (status === "pass" || status === "passed" || status === "success") return "passed";
  if (status === "partial" || status === "warning") return "partial";
  if (status === "fail" || status === "failed" || status === "error") return "failed";
  if (outcome.passed === true) return "passed";
  if (outcome.passed === false) {
    const score = asNumber(outcome.score);
    return score != null && score > 0 ? "partial" : "failed";
  }
  const layout = layoutStatus(outcome);
  if (layout) return layout;
  const score = asNumber(outcome.score);
  if (score == null) return "unknown";
  if (score >= 0.9995) return "passed";
  if (score > 0) return "partial";
  return "failed";
}

function outcomeExplanation(outcome: DiagnosticOutcome | null) {
  return asString(outcome?.explanation) ?? asString(outcome?.reason) ??
    asString(outcome?.note);
}

function metricRuleOutcomes(metrics: DiagnosticMetric[]): DiagnosticOutcome[] {
  let longest: DiagnosticOutcome[] = [];
  for (const metric of metrics) {
    const candidate = asRecordArray(metric.metadata?.rule_results)
      .map((item) => item as DiagnosticOutcome)
      .filter((item) => !asString(item.type)?.endsWith("_judge"));
    if (candidate.length > longest.length) longest = candidate;
  }
  return longest;
}

function diagnosticOutcomes(diagnostic: DiagnosticArtifact) {
  return diagnostic.outcomes?.length
    ? diagnostic.outcomes
    : metricRuleOutcomes(diagnostic.metrics);
}

function buildEvidenceItems(diagnostic: DiagnosticArtifact): EvidenceItem[] {
  const outcomes = diagnosticOutcomes(diagnostic);
  const outcomesById = new Map<string, DiagnosticOutcome>();
  outcomes.forEach((outcome, index) => {
    const id = outcomeId(outcome, index);
    outcomesById.set(id, outcome);
  });

  const used = new Set<DiagnosticOutcome>();
  const items: EvidenceItem[] = diagnostic.expectations.map((expectation, index) => {
    let outcome = outcomesById.get(expectation.id) ?? null;
    if (!outcome) {
      const samePosition = outcomes[index];
      if (samePosition && (!samePosition.type || samePosition.type === expectation.type)) {
        outcome = samePosition;
      }
    }
    if (outcome) used.add(outcome);
    return {
      id: expectation.id,
      type: expectation.type,
      page: expectation.page ?? null,
      expectation,
      outcome,
    };
  });

  outcomes.forEach((outcome, index) => {
    if (used.has(outcome)) return;
    items.push({
      id: outcomeId(outcome, index),
      type: asString(outcome.type) ?? "unknown",
      page: asNumber(outcome.page),
      expectation: null,
      outcome,
    });
  });
  return items;
}

function statusCounts(items: EvidenceItem[]) {
  return items.reduce(
    (counts, item) => {
      counts[evidenceStatus(item.outcome)] += 1;
      return counts;
    },
    { passed: 0, partial: 0, failed: 0, unknown: 0 } satisfies Record<EvidenceStatus, number>,
  );
}

function StatusPill({ status, label }: { status: EvidenceStatus; label?: string }) {
  return (
    <span className={`diagnostic-status diagnostic-status-${status}`}>
      {label ?? humanize(status)}
    </span>
  );
}

function MetricComponent({ component }: { component: DiagnosticMetricComponent }) {
  const name = component.label ?? component.name ?? component.metric_name ?? "Component";
  return (
    <div className="diagnostic-component">
      <span>{humanize(name)}</span>
      <strong>{scorePercent(component.value)}</strong>
      {component.weight != null && <small>{component.weight.toLocaleString()} weight</small>}
    </div>
  );
}

function PrimaryMetricSummary({
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

  return (
    <section className="diagnostic-score-summary" aria-labelledby="diagnostic-score-heading">
      <div className="diagnostic-primary-score">
        <span className="diagnostic-eyebrow">Why this score</span>
        <div className="diagnostic-score-line">
          <h2 id="diagnostic-score-heading">{primary ? humanize(primary.name) : "Primary score"}</h2>
          <strong>{scorePercent(primary?.value)}</strong>
        </div>
        {formula.description && <p className="diagnostic-formula">{formula.description}</p>}
      </div>
      {components.length > 0 && (
        <div className="diagnostic-components" aria-label="Score components">
          {components.map((component, index) => (
            <MetricComponent component={component} key={`${component.name ?? component.metric_name ?? "component"}-${index}`} />
          ))}
        </div>
      )}
      <dl className="diagnostic-outcome-counts" aria-label="Evaluation outcomes">
        <div><dt>Passed</dt><dd>{counts.passed.toLocaleString()}</dd></div>
        <div><dt>Partial</dt><dd>{counts.partial.toLocaleString()}</dd></div>
        <div><dt>Failed</dt><dd>{counts.failed.toLocaleString()}</dd></div>
        {counts.unknown > 0 && <div><dt>Not explained</dt><dd>{counts.unknown.toLocaleString()}</dd></div>}
        {summaryScalars.map(([key, value]) => (
          <div key={key}><dt>{humanize(key)}</dt><dd>{scalarDisplay(value)}</dd></div>
        ))}
      </dl>
    </section>
  );
}

function MarkdownEvidence({ markdown, empty }: { markdown: string; empty: string }) {
  if (!markdown.trim()) {
    return <p className="diagnostic-empty">{empty}</p>;
  }
  return (
    <div className="diagnostic-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function EvidenceButton({
  id,
  selected,
  onSelect,
  className,
  children,
}: {
  id: string;
  selected: boolean;
  onSelect?: (id: string) => void;
  className: string;
  children: ReactNode;
}) {
  if (!onSelect) {
    return <div className={`${className}${selected ? " diagnostic-evidence-selected" : ""}`}>{children}</div>;
  }
  return (
    <button
      type="button"
      className={`${className}${selected ? " diagnostic-evidence-selected" : ""}`}
      aria-pressed={selected}
      onClick={() => onSelect(id)}
    >
      {children}
    </button>
  );
}

const TABLE_DIFFERENCE_PAGE_SIZE = 60;

function isTableDifference(recordType: string, cell: Record<string, unknown>) {
  return (asNumber(cell.score) ?? 0) < 0.9995 || recordType !== "matched";
}

function tableDifferenceCount(table: Record<string, unknown>) {
  return asRecordArray(table.record_details).reduce((count, record) => {
    const recordType = asString(record.type) ?? "record";
    return count + asRecordArray(record.cells).filter((cell) => isTableDifference(recordType, cell)).length;
  }, 0);
}

function tableDifferenceRows(table: Record<string, unknown>, limit: number) {
  const differences = [];
  const records = asRecordArray(table.record_details);
  for (let recordIndex = 0; recordIndex < records.length && differences.length < limit; recordIndex += 1) {
    const record = records[recordIndex];
    const recordType = asString(record.type) ?? "record";
    const recordScore = asNumber(record.score);
    const cells = asRecordArray(record.cells);
    for (let cellIndex = 0; cellIndex < cells.length && differences.length < limit; cellIndex += 1) {
      const cell = cells[cellIndex];
      if (!isTableDifference(recordType, cell)) continue;
      differences.push({
        id: `${recordIndex}-${cellIndex}`,
        record: recordType === "matched"
          ? `GT ${scalarDisplay(record.gt_index)} ↔ output ${scalarDisplay(record.pred_index)}`
          : humanize(recordType),
        recordScore,
        column: asString(cell.column) ?? "Unknown field",
        expected: cell.expected,
        actual: cell.actual,
        score: asNumber(cell.score),
      });
    }
  }
  return differences;
}

function TableDifferences({
  table,
  differenceCount,
}: {
  table: Record<string, unknown>;
  differenceCount: number;
}) {
  const [open, setOpen] = useState(differenceCount <= 6);
  const [visible, setVisible] = useState(TABLE_DIFFERENCE_PAGE_SIZE);
  const differences = open ? tableDifferenceRows(table, visible) : [];
  return (
    <details
      className="diagnostic-differences"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{differenceCount.toLocaleString()} field {differenceCount === 1 ? "difference" : "differences"}</summary>
      {open && (
        <>
          <div className="diagnostic-table-scroll">
            <table>
              <thead><tr><th>Record</th><th>Field</th><th>Expected</th><th>Output</th><th>Match</th></tr></thead>
              <tbody>
                {differences.map((difference) => (
                  <tr key={difference.id}>
                    <th scope="row">{difference.record}</th>
                    <td>{difference.column}</td>
                    <td>{scalarDisplay(difference.expected)}</td>
                    <td>{scalarDisplay(difference.actual)}</td>
                    <td>{scorePercent(difference.score ?? difference.recordScore)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {differences.length < differenceCount && (
            <button
              className="diagnostic-load-more"
              type="button"
              onClick={() => setVisible((current) => current + TABLE_DIFFERENCE_PAGE_SIZE)}
            >
              Show {Math.min(TABLE_DIFFERENCE_PAGE_SIZE, differenceCount - differences.length)} more · {(differenceCount - differences.length).toLocaleString()} remaining
            </button>
          )}
        </>
      )}
    </details>
  );
}

function TableMetricDetails({
  metric,
  metricIndex,
  selectedEvidenceId,
  onSelectEvidence,
}: {
  metric: DiagnosticMetric;
  metricIndex: number;
  selectedEvidenceId?: string | null;
  onSelectEvidence?: (id: string) => void;
}) {
  const tables = asRecordArray(metric.metadata?.per_table_details);
  if (!tables.length) return null;
  return (
    <section className="diagnostic-table-metric">
      <div className="diagnostic-section-heading">
        <div><span className="diagnostic-eyebrow">Structured comparison</span><h3>{humanize(metric.metric_name)}</h3></div>
        <strong>{scorePercent(metric.value)}</strong>
      </div>
      <div className="diagnostic-table-detail-list">
        {tables.map((table, tableIndex) => {
          const gtIndex = asNumber(table.gt_table_index);
          const predictionIndex = asNumber(table.pred_table_index);
          const standaloneTableIndex = asNumber(table.table_index);
          const describesOutputStructure = gtIndex == null && predictionIndex == null && standaloneTableIndex != null;
          const differenceCount = tableDifferenceCount(table);
          const tableId = `table-${metricIndex}-${gtIndex ?? standaloneTableIndex ?? tableIndex}`;
          const metricValues = Object.entries(table)
            .filter(([key, value]) =>
              !key.startsWith("_") &&
              key !== "gt_table_index" && key !== "pred_table_index" &&
              key !== "table_index" &&
              key !== "record_details" &&
              typeof value === "number" &&
              (key.includes("score") || key.includes("grits") || key.includes("precision") || key.includes("recall") ||
                (describesOutputStructure && (key === "num_rows" || key === "num_cols"))),
            )
            .slice(0, 5);
          return (
            <article className="diagnostic-table-detail" key={tableId}>
              <EvidenceButton
                id={tableId}
                selected={selectedEvidenceId === tableId}
                onSelect={onSelectEvidence}
                className="diagnostic-table-title"
              >
                {describesOutputStructure ? (
                  <>
                    <span>Output table {(standaloneTableIndex ?? tableIndex) + 1}</span>
                    <span>{table.consistent === true ? "Structurally consistent" : "Structure issue detected"}</span>
                  </>
                ) : (
                  <>
                    <span>Expected table {(gtIndex ?? tableIndex) + 1}</span>
                    <span aria-hidden="true">↔</span>
                    <span>{predictionIndex == null ? "No output match" : `Output table ${predictionIndex + 1}`}</span>
                  </>
                )}
              </EvidenceButton>
              {(asString(table.reason) ?? asString(table.note)) && (
                <p className="diagnostic-failure-reason">{asString(table.reason) ?? asString(table.note)}</p>
              )}
              {metricValues.length > 0 && (
                <dl className="diagnostic-inline-metrics">
                  {metricValues.map(([key, value]) => (
                    <div key={key}>
                      <dt>{humanize(key)}</dt>
                      <dd>{key === "num_rows" || key === "num_cols"
                        ? Number(value).toLocaleString()
                        : scorePercent(asNumber(value))}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {differenceCount > 0 ? (
                <TableDifferences table={table} differenceCount={differenceCount} />
              ) : (
                <p className="diagnostic-empty diagnostic-empty-compact">
                  {describesOutputStructure
                    ? table.consistent === true
                      ? "Rows and columns are structurally consistent."
                      : `Structural consistency failed${table.row_inconsistency === true ? " for rows" : ""}${table.row_inconsistency === true && table.col_inconsistency === true ? " and" : ""}${table.col_inconsistency === true ? " for columns" : ""}.`
                    : "No field-level differences were reported for this table."}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function TableDiagnostic({
  diagnostic,
  actualMarkdown,
  selectedEvidenceId,
  onSelectEvidence,
}: DiagnosticInspectorProps) {
  const expectedMarkdown = diagnostic.expectations
    .map((expectation) => expectation.expected_markdown?.trim())
    .filter((markdown): markdown is string => Boolean(markdown))
    .join("\n\n");
  const structuredMetrics = diagnostic.metrics.filter(
    (metric) => asRecordArray(metric.metadata?.per_table_details).length > 0,
  );
  const tableMetric = diagnostic.metrics.find(
    (metric) => metric.metric_name === "table_record_match",
  );
  const predictedTables = asNumber(tableMetric?.metadata?.n_pred_tables) ??
    asNumber(diagnostic.summary.predicted);
  const expectedTables = asNumber(tableMetric?.metadata?.n_gt_tables) ??
    asNumber(diagnostic.summary.expected);
  const hasStructuredOutput = predictedTables == null || predictedTables > 0;
  return (
    <div className="diagnostic-dimension-view diagnostic-table-view">
      <section className="diagnostic-markdown-comparison" aria-label="Ground truth and output table comparison">
        <article>
          <div className="diagnostic-panel-heading"><span className="diagnostic-eyebrow">Expected</span><h3>Ground-truth tables</h3></div>
          <MarkdownEvidence markdown={expectedMarkdown} empty="No rendered table ground truth is available for this result." />
        </article>
        <article>
          <div className="diagnostic-panel-heading"><span className="diagnostic-eyebrow">Observed</span><h3>Structured table output</h3></div>
          <MarkdownEvidence
            markdown={hasStructuredOutput ? actualMarkdown : ""}
            empty={predictedTables === 0
              ? "The evaluator found no structured output table. Flattened page text, if any, remains available in the Output tab."
              : "The parser did not produce Markdown for this document."}
          />
        </article>
      </section>
      {structuredMetrics.length ? structuredMetrics.map((metric, index) => (
        <TableMetricDetails
          key={`${metric.metric_name}-${index}`}
          metric={metric}
          metricIndex={index}
          selectedEvidenceId={selectedEvidenceId}
          onSelectEvidence={onSelectEvidence}
        />
      )) : (
        <EmptyDiagnostics
          title={predictedTables === 0 ? "No structured table was detected" : "No table alignment available"}
          message={predictedTables === 0
            ? `The evaluator expected ${expectedTables ?? "at least one"} table but detected no structured output table, so GRITS/TRM had no pair to compare. Inspect the Output tab to see whether the content was flattened into ordinary text.`
            : "No expected/output table pair was retained for field-level comparison. Use the expected and predicted counts above to see whether a table was missing or extra."}
        />
      )}
    </div>
  );
}

function arrayPreview(value: unknown): unknown[][] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is unknown[] => Array.isArray(row))
    .slice(0, 12)
    .map((row) => row.slice(0, 12));
}

function ChartDiagnostic({
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
      <div className="diagnostic-table-scroll">
        <table className="diagnostic-chart-table">
          <thead><tr><th>Check</th><th>Labels</th><th>Expected</th><th>Result</th></tr></thead>
          <tbody>
            {items.map((item) => {
              const rule = asRecord(item.expectation?.rule) ?? {};
              const labels = Array.isArray(rule.labels)
                ? rule.labels.map((label) => scalarDisplay(label)).join(" · ")
                : arrayPreview(rule.data)[0]?.map((label) => scalarDisplay(label)).join(" · ") ?? "—";
              const matrix = arrayPreview(rule.data);
              const value = rule.value ?? (matrix.length
                ? `${Math.max(matrix.length - 1, 0)} data rows × ${matrix[0]?.length ?? 0} columns`
                : "—");
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
                        <summary>View expected data</summary>
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

function subcheckStatus(outcome: DiagnosticOutcome, key: string, applicable = true): EvidenceStatus {
  if (!applicable) return "unknown";
  const value = outcome[key];
  return value === true ? "passed" : value === false ? "failed" : "unknown";
}

function metricByName(metrics: DiagnosticMetric[], name: string) {
  return metrics.find((metric) => metric.metric_name === name) ?? null;
}

function LayoutDiagnostic({
  diagnostic,
  selectedEvidenceId,
  onSelectEvidence,
}: DiagnosticInspectorProps) {
  const outcomes = diagnosticOutcomes(diagnostic);
  const categoryMetrics = [
    ["Localization", "layout_localization_pass_rate"],
    ["Classification", "layout_classification_pass_rate"],
    ["Attribution", "layout_attribution_pass_rate"],
    ["Reading order", "layout_reading_order_pass_rate"],
  ] as const;
  return (
    <div className="diagnostic-dimension-view diagnostic-layout-view">
      <dl className="diagnostic-layout-summary" aria-label="Layout evaluation stages">
        {categoryMetrics.map(([label, name]) => {
          const metric = metricByName(diagnostic.metrics, name);
          return (
            <div key={name}>
              <dt>{label}</dt>
              <dd>{scorePercent(metric?.value)}</dd>
              {metric?.metadata?.passed != null && metric.metadata.total != null && (
                <small>{scalarDisplay(metric.metadata.passed)} of {scalarDisplay(metric.metadata.total)} passed</small>
              )}
            </div>
          );
        })}
      </dl>
      {outcomes.length ? (
        <section aria-labelledby="diagnostic-layout-elements-heading">
          <div className="diagnostic-section-heading">
            <div><span className="diagnostic-eyebrow">Element evidence</span><h3 id="diagnostic-layout-elements-heading">Ground truth matched to output</h3></div>
            <span>{outcomes.length.toLocaleString()} elements</span>
          </div>
          <div className="diagnostic-table-scroll">
            <table className="diagnostic-layout-table">
              <thead><tr><th>Element</th><th>Localization</th><th>Classification</th><th>Attribution</th><th>Order</th></tr></thead>
              <tbody>
                {outcomes.map((outcome, index) => {
                  const id = outcomeId(outcome, index);
                  const expectedClass = asString(outcome.gt_class) ?? asString(outcome.gt_class_norm) ?? "Element";
                  const predictedClass = asString(outcome.best_pred_class) ?? "No matched block";
                  const attributionApplicable = outcome.attribution_applicable === true;
                  return (
                    <tr key={id}>
                      <th scope="row">
                        <EvidenceButton
                          id={id}
                          selected={selectedEvidenceId === id}
                          onSelect={onSelectEvidence}
                          className="diagnostic-evidence-trigger"
                        >
                          <span>{humanize(expectedClass)}</span>
                          <small>{predictedClass === "No matched block" ? predictedClass : `Matched to ${humanize(predictedClass)}`}</small>
                        </EvidenceButton>
                      </th>
                      <td><StatusPill status={subcheckStatus(outcome, "localization_pass")} /><small>{humanize(asString(outcome.localization_reason))}</small></td>
                      <td><StatusPill status={subcheckStatus(outcome, "classification_pass")} /><small>{humanize(asString(outcome.classification_reason))}</small></td>
                      <td>
                        <StatusPill status={subcheckStatus(outcome, "attribution_pass", attributionApplicable)} label={attributionApplicable ? undefined : "Not scored"} />
                        {asNumber(outcome.token_f1) != null && <small>Token F1 {scorePercent(asNumber(outcome.token_f1))}</small>}
                      </td>
                      <td><StatusPill status={subcheckStatus(outcome, "reading_order_pass", outcome.reading_order_eligible === true)} label={outcome.reading_order_eligible === true ? undefined : "Not scored"} /><small>{humanize(asString(outcome.reading_order_reason))}</small></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : <EmptyDiagnostics message="No element-level layout evidence was retained for this result." />}
    </div>
  );
}

function textGroup(type: string) {
  if (type.includes("order")) return "order";
  if (type.includes("digit")) return "digits";
  if (type.includes("too_many") || type.includes("occurrence")) return "duplicates";
  if (type.includes("unexpected") || type.includes("extra_content")) return "unexpected";
  if (type.includes("missing") || type.includes("presence") || type.includes("baseline")) return "completeness";
  return "other";
}

function formattingGroup(type: string) {
  if (type.includes("title") || type.includes("hierarchy") || type.includes("page_section")) return "titles";
  if (type.includes("latex")) return "latex";
  if (type.includes("code_block")) return "code";
  if (["bold", "italic", "underline", "strikeout", "mark", "sup", "sub"].some((token) => type.includes(token))) {
    return "styling";
  }
  return "other";
}

function ruleValueSummary(value: unknown) {
  if (typeof value === "string") {
    return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  }
  if (Array.isArray(value)) {
    if (value.length <= 4) return value.map((item) => scalarDisplay(item)).join(", ");
    return `${value.length.toLocaleString()} items`;
  }
  const record = asRecord(value);
  if (record) {
    const text = asString(record.text);
    if (text) return text.length > 120 ? `${text.slice(0, 117)}…` : text;
    return `${Object.keys(record).length.toLocaleString()} entries`;
  }
  return scalarDisplay(value);
}

function expectedRuleSummary(value: unknown) {
  const rule = asRecord(value);
  if (!rule) return value == null
    ? "Expectation details unavailable"
    : `Expected: ${scalarDisplay(value)}`;
  const ignored = new Set([
    "id", "type", "page", "tags", "layout_id", "layout_ids", "layout_bindings",
    "max_diffs", "normalize_numbers",
  ]);
  const values = Object.entries(rule)
    .filter(([key, value]) => !ignored.has(key) && value != null)
    .slice(0, 4)
    .map(([key, value]) => `${humanize(key)}: ${ruleValueSummary(value)}`);
  return values.join(" · ") || "No additional expectation parameters";
}

function RuleGroups({
  items,
  groups,
  groupForType,
  selectedEvidenceId,
  onSelectEvidence,
}: {
  items: EvidenceItem[];
  groups: readonly { key: string; label: string }[];
  groupForType: (type: string) => string;
  selectedEvidenceId?: string | null;
  onSelectEvidence?: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(items.length <= 10);
  const [visibleLimits, setVisibleLimits] = useState<Record<string, number>>({});
  const normalizedQuery = query.trim().toLowerCase();
  const queryTerms = normalizedQuery.endsWith("s")
    ? [normalizedQuery, normalizedQuery.slice(0, -1)]
    : [normalizedQuery];
  const statusRank: Record<EvidenceStatus, number> = {
    failed: 0,
    partial: 1,
    unknown: 2,
    passed: 3,
  };
  const firstPopulatedGroup = groups.find((group) =>
    items.some((item) => groupForType(item.type) === group.key),
  )?.key;
  return (
    <div className="diagnostic-rule-groups">
      {items.length > 0 && (
        <div className="diagnostic-rule-toolbar">
          <input
            aria-label="Search evaluation checks"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search checks"
          />
          <div className="mode-toggle" aria-label="Evidence status filter">
            <button type="button" aria-pressed={!showAll} className={!showAll ? "mode-active" : ""} onClick={() => setShowAll(false)}>Needs attention</button>
            <button type="button" aria-pressed={showAll} className={showAll ? "mode-active" : ""} onClick={() => setShowAll(true)}>All</button>
          </div>
        </div>
      )}
      {groups.map((group) => {
        const groupedItems = items.filter((item) => groupForType(item.type) === group.key);
        if (!groupedItems.length) return null;
        const counts = statusCounts(groupedItems);
        const visibleItems = groupedItems
          .filter((item) => showAll || evidenceStatus(item.outcome) !== "passed")
          .filter((item) => {
            if (!normalizedQuery) return true;
            return [
              item.type,
              expectedRuleSummary(item.expectation?.rule),
              outcomeExplanation(item.outcome) ?? "",
            ].some((value) => queryTerms.some((term) => value.toLowerCase().includes(term)));
          })
          .sort((left, right) =>
            statusRank[evidenceStatus(left.outcome)] - statusRank[evidenceStatus(right.outcome)],
          );
        if (!visibleItems.length && normalizedQuery) return null;
        const visibleLimit = visibleLimits[group.key] ?? 60;
        const renderedItems = visibleItems.slice(0, visibleLimit);
        return (
          <details className="diagnostic-rule-group" key={group.key} open={Boolean(normalizedQuery) || group.key === firstPopulatedGroup}>
            <summary>
              <span>
                <strong>{group.label}</strong>
                <small>{renderedItems.length.toLocaleString()} shown · {visibleItems.length.toLocaleString()} matching · {groupedItems.length.toLocaleString()} total</small>
              </span>
              <span className="diagnostic-group-counts">
                {counts.failed > 0 && <span>{counts.failed} failed</span>}
                {counts.partial > 0 && <span>{counts.partial} partial</span>}
                {counts.passed > 0 && <span>{counts.passed} passed</span>}
              </span>
            </summary>
            <div className="diagnostic-rule-list">
              {renderedItems.map((item) => {
                const status = evidenceStatus(item.outcome);
                const explanation = outcomeExplanation(item.outcome);
                return (
                  <EvidenceButton
                    key={item.id}
                    id={item.id}
                    selected={selectedEvidenceId === item.id}
                    onSelect={onSelectEvidence}
                    className="diagnostic-rule-row"
                  >
                    <span className="diagnostic-rule-main">
                      <strong>{humanize(item.type)}</strong>
                      <small>{expectedRuleSummary(item.expectation?.rule)}</small>
                      {explanation && <span title={explanation}>{explanation}</span>}
                    </span>
                    <span className="diagnostic-rule-result">
                      <StatusPill status={status} />
                      {item.outcome?.score != null && <small>{scorePercent(item.outcome.score)}</small>}
                    </span>
                  </EvidenceButton>
                );
              })}
              {renderedItems.length < visibleItems.length && (
                <button
                  className="diagnostic-load-more"
                  type="button"
                  onClick={() => setVisibleLimits((current) => ({
                    ...current,
                    [group.key]: visibleLimit + 60,
                  }))}
                >
                  Show 60 more · {(visibleItems.length - renderedItems.length).toLocaleString()} remaining
                </button>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function TextDiagnostic(props: DiagnosticInspectorProps) {
  const items = buildEvidenceItems(props.diagnostic);
  return items.length ? (
    <section className="diagnostic-dimension-view diagnostic-text-view" aria-labelledby="diagnostic-text-heading">
      <div className="diagnostic-section-heading">
        <div><span className="diagnostic-eyebrow">Content evidence</span><h3 id="diagnostic-text-heading">Completeness, accuracy and order</h3></div>
        <span>{items.length.toLocaleString()} checks</span>
      </div>
      <RuleGroups
        items={items}
        groups={TEXT_GROUPS}
        groupForType={textGroup}
        selectedEvidenceId={props.selectedEvidenceId}
        onSelectEvidence={props.onSelectEvidence}
      />
    </section>
  ) : <EmptyDiagnostics message="No text-content rule outcomes were retained for this result." />;
}

function FormattingDiagnostic(props: DiagnosticInspectorProps) {
  const items = buildEvidenceItems(props.diagnostic);
  return items.length ? (
    <section className="diagnostic-dimension-view diagnostic-formatting-view" aria-labelledby="diagnostic-formatting-heading">
      <div className="diagnostic-section-heading">
        <div><span className="diagnostic-eyebrow">Formatting evidence</span><h3 id="diagnostic-formatting-heading">Semantic formatting checks</h3></div>
        <span>{items.length.toLocaleString()} checks</span>
      </div>
      <RuleGroups
        items={items}
        groups={FORMATTING_GROUPS}
        groupForType={formattingGroup}
        selectedEvidenceId={props.selectedEvidenceId}
        onSelectEvidence={props.onSelectEvidence}
      />
    </section>
  ) : <EmptyDiagnostics message="No formatting-rule outcomes were retained for this result." />;
}

function GenericDiagnostic({
  diagnostic,
  selectedEvidenceId,
  onSelectEvidence,
}: DiagnosticInspectorProps) {
  const items = buildEvidenceItems(diagnostic);
  return items.length ? (
    <section className="diagnostic-dimension-view diagnostic-generic-view">
      <div className="diagnostic-section-heading"><div><span className="diagnostic-eyebrow">Evaluation evidence</span><h3>Checks and outcomes</h3></div></div>
      <div className="diagnostic-rule-list">
        {items.map((item) => (
          <EvidenceButton
            key={item.id}
            id={item.id}
            selected={selectedEvidenceId === item.id}
            onSelect={onSelectEvidence}
            className="diagnostic-rule-row"
          >
            <span className="diagnostic-rule-main">
              <strong>{humanize(item.type)}</strong>
              <small>{expectedRuleSummary(item.expectation?.rule)}</small>
              {outcomeExplanation(item.outcome) && (
                <span title={outcomeExplanation(item.outcome) ?? undefined}>
                  {outcomeExplanation(item.outcome)}
                </span>
              )}
            </span>
            <StatusPill status={evidenceStatus(item.outcome)} />
          </EvidenceButton>
        ))}
      </div>
    </section>
  ) : <EmptyDiagnostics message="No rule-level evidence was retained for this result." />;
}

function EmptyDiagnostics({
  title = "Detailed evidence unavailable",
  message,
}: {
  title?: string;
  message: string;
}) {
  return (
    <div className="diagnostic-empty-state" role="status">
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}

export function DiagnosticInspector(props: DiagnosticInspectorProps) {
  const items = buildEvidenceItems(props.diagnostic);
  let detail: ReactNode;
  switch (props.diagnostic.dimension) {
    case "table":
      detail = <TableDiagnostic {...props} />;
      break;
    case "chart":
      detail = <ChartDiagnostic {...props} />;
      break;
    case "layout":
      detail = <LayoutDiagnostic {...props} />;
      break;
    case "text_content":
      detail = <TextDiagnostic {...props} />;
      break;
    case "text_formatting":
      detail = <FormattingDiagnostic {...props} />;
      break;
    default:
      detail = <GenericDiagnostic {...props} />;
  }
  return (
    <div className={`diagnostic-inspector diagnostic-inspector-${props.diagnostic.dimension}`}>
      <PrimaryMetricSummary diagnostic={props.diagnostic} items={items} />
      {detail}
    </div>
  );
}

export default DiagnosticInspector;
