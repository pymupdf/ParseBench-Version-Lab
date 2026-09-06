"use client";

import { useMemo, useState } from "react";

import {
  asNumber,
  asRecord,
  asRecordArray,
  asString,
  humanize,
  metricComponents,
  scalarDisplay,
  scorePercent,
  type DiagnosticInspectorProps,
} from "./model";
import { EmptyDiagnostics, EvidenceButton, MarkdownEvidence, RuleImpactLabel } from "./primitives";
import type { RuleImpact } from "./rule-model";
import {
  tableFallbackExplanation,
  tableScoreBreakdown,
  type TableScoreBreakdown,
} from "./table-model";
import {
  reconstructSplitTableOutput,
  structuredTableFragments,
  type OutputTablePreview,
} from "./table-output-reconstruction";
import type { DiagnosticArtifact, DiagnosticMetric } from "./types";

const TABLE_DIFFERENCE_PAGE_SIZE = 60;

function TableScoreExplanation({ diagnostic }: { diagnostic: DiagnosticArtifact }) {
  const breakdown = tableScoreBreakdown(diagnostic);
  const modeLabel = breakdown.mode === "combined"
    ? "50 / 50 composite"
    : breakdown.mode === "grits_only"
      ? "GriTS-Con only"
      : "Formula unavailable";
  return (
    <section className="diagnostic-table-score-method" aria-labelledby="diagnostic-table-score-method-heading">
      <div className="diagnostic-section-heading">
        <div>
          <span className="diagnostic-eyebrow">Table scoring method</span>
          <h3 id="diagnostic-table-score-method-heading">How this headline score was calculated</h3>
        </div>
        <span className={`diagnostic-table-score-mode diagnostic-table-score-mode-${breakdown.mode}`}>
          {modeLabel}
        </span>
      </div>
      <p className="diagnostic-table-score-summary">
        {breakdown.mode === "combined"
          ? "This page uses the standard table composite: grid/content similarity and record matching contribute equally."
          : breakdown.mode === "grits_only"
            ? "This page uses GriTS-Con alone. Table-record match does not contribute to the headline score."
            : "The benchmark normally averages GriTS-Con and table-record match equally. If record matching is inapplicable or missing, it falls back to GriTS-Con alone; this historical artifact does not retain which path was used."}
      </p>
      <div className={`diagnostic-table-score-components${breakdown.mode === "grits_only" ? " diagnostic-table-score-components-single" : ""}`}>
        <article>
          <div><span>Grid/content score</span><strong>GriTS-Con</strong></div>
          <strong>{scorePercent(breakdown.gritsScore)}</strong>
          <p>Aligns the expected and output row/column grids, then scores their cell text.</p>
          {breakdown.gritsWeight != null && (
            <small>{scorePercent(breakdown.gritsWeight)} of the headline score</small>
          )}
        </article>
        {breakdown.mode !== "grits_only" && (
          <article>
            <div><span>Record score</span><strong>Table record match</strong></div>
            <strong>{scorePercent(breakdown.trmScore)}</strong>
            <p>Uses headers as fields and compares table rows as records, independent of their visual row order.</p>
            <small>{breakdown.trmWeight != null
              ? `${scorePercent(breakdown.trmWeight)} of the headline score`
              : "Contribution unknown"}</small>
          </article>
        )}
      </div>
      {breakdown.mode === "grits_only" && (
        <div className="diagnostic-table-score-omission">
          <strong>Why there is no record-match score</strong>
          <p>{tableFallbackExplanation(breakdown.fallbackReason)} This is an intentional omission, not a 0% result.</p>
        </div>
      )}
    </section>
  );
}

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

type TablePairEvidence = {
  expectedIndex: number | null;
  outputIndex: number | null;
  expectedMarkdown: string | null;
  outputMarkdown: string | null;
  outputMarkupReliable: boolean;
  outputReconstructed: boolean;
  grits: Record<string, unknown> | null;
  trm: Record<string, unknown> | null;
};

function tableIndex(value: unknown) {
  const number = asNumber(value);
  return number != null && Number.isInteger(number) && number >= 0 ? number : null;
}

function tableDetailsByExpected(metric: DiagnosticMetric | null) {
  const details = new Map<number, Record<string, unknown>>();
  for (const detail of asRecordArray(metric?.metadata?.per_table_details)) {
    const expectedIndex = tableIndex(detail.gt_table_index);
    if (expectedIndex != null) details.set(expectedIndex, detail);
  }
  return details;
}

function tablePairing(metric: DiagnosticMetric | null) {
  const pairing: Array<[number, number | null]> = [];
  const rawPairing = metric?.metadata?.pairing;
  if (!Array.isArray(rawPairing)) return pairing;
  for (const entry of rawPairing) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const expectedIndex = tableIndex(entry[0]);
    const outputIndex = entry[1] == null ? null : tableIndex(entry[1]);
    if (expectedIndex != null && (entry[1] == null || outputIndex != null)) {
      pairing.push([expectedIndex, outputIndex]);
    }
  }
  return pairing;
}

function tablePairEvidence(
  expectedMarkdown: string[],
  outputTables: OutputTablePreview[],
  expectedCount: number | null,
  outputMappingReliable: boolean,
  gritsMetric: DiagnosticMetric | null,
  trmMetric: DiagnosticMetric | null,
) {
  const gritsByExpected = tableDetailsByExpected(gritsMetric);
  const trmByExpected = tableDetailsByExpected(trmMetric);
  const outputByExpected = new Map<number, number | null>();

  for (const [expectedIndex, outputIndex] of tablePairing(gritsMetric)) {
    outputByExpected.set(expectedIndex, outputIndex);
  }
  for (const details of [gritsByExpected, trmByExpected]) {
    for (const [expectedIndex, detail] of details) {
      if (outputByExpected.has(expectedIndex)) continue;
      outputByExpected.set(
        expectedIndex,
        detail.pred_table_index == null ? null : tableIndex(detail.pred_table_index),
      );
    }
  }

  const retainedExpectedCount = Math.max(
    expectedMarkdown.length,
    expectedCount ?? 0,
    ...[...outputByExpected.keys()].map((index) => index + 1),
  );
  const pairedOutputIndexes = new Set<number>();
  const pairs: TablePairEvidence[] = [];
  for (let expectedIndex = 0; expectedIndex < retainedExpectedCount; expectedIndex += 1) {
    const outputIndex = outputByExpected.get(expectedIndex) ?? null;
    if (outputIndex != null) pairedOutputIndexes.add(outputIndex);
    pairs.push({
      expectedIndex,
      outputIndex,
      expectedMarkdown: expectedMarkdown[expectedIndex] ?? null,
      outputMarkdown: outputIndex == null || !outputMappingReliable
        ? null
        : outputTables[outputIndex]?.markdown ?? null,
      outputMarkupReliable: outputMappingReliable &&
        (outputIndex == null || outputIndex < outputTables.length),
      outputReconstructed: outputIndex == null
        ? false
        : outputTables[outputIndex]?.reconstructed ?? false,
      grits: gritsByExpected.get(expectedIndex) ?? null,
      trm: trmByExpected.get(expectedIndex) ?? null,
    });
  }
  if (outputMappingReliable) {
    outputTables.forEach((table, outputIndex) => {
      if (pairedOutputIndexes.has(outputIndex)) return;
      pairs.push({
        expectedIndex: null,
        outputIndex,
        expectedMarkdown: null,
        outputMarkdown: table.markdown,
        outputMarkupReliable: true,
        outputReconstructed: table.reconstructed,
        grits: null,
        trm: null,
      });
    });
  }
  return pairs;
}

function reconstructedTablePairs(diagnostic: DiagnosticArtifact, actualMarkdown: string) {
  const tableMetric = diagnostic.metrics.find(
    (metric) => metric.metric_name === "table_record_match",
  ) ?? null;
  const gritsMetric = diagnostic.metrics.find(
    (metric) => metric.metric_name === "grits_con",
  ) ?? null;
  const metricValue = (name: string) => diagnostic.metrics.find(
    (metric) => metric.metric_name === name,
  )?.value ?? null;
  const predictedTables = asNumber(tableMetric?.metadata?.n_pred_tables) ??
    asNumber(gritsMetric?.metadata?.tables_found_actual) ??
    metricValue("tables_actual") ??
    asNumber(diagnostic.summary.predicted);
  const expectedTables = asNumber(tableMetric?.metadata?.n_gt_tables) ??
    asNumber(gritsMetric?.metadata?.tables_found_expected) ??
    metricValue("tables_expected") ??
    asNumber(diagnostic.summary.expected);
  const extractedOutputTables = metricValue("tables_actual");
  const unparseableOutputTables = metricValue("tables_unparseable_pred");
  const expectedMarkdown = diagnostic.expectations
    .map((expectation) => expectation.expected_markdown?.trim())
    .find((markdown): markdown is string => Boolean(markdown)) ?? "";
  const expectedTableFragments = structuredTableFragments(expectedMarkdown);
  const outputTableFragments = structuredTableFragments(actualMarkdown);
  const noStructuredOutputTables = predictedTables === 0 && outputTableFragments.length === 0;
  const sourceOutputMappingReliable = noStructuredOutputTables || (
    unparseableOutputTables === 0 &&
    extractedOutputTables === outputTableFragments.length &&
    predictedTables === outputTableFragments.length
  );
  const splittingAllowed = diagnostic.expectations.reduce((allowed, expectation) => {
    const configured = asRecord(expectation.rule)?.allow_splitting_ambiguous_merged_tables;
    return typeof configured === "boolean" ? configured : allowed;
  }, false);
  const pairing = tablePairing(gritsMetric);
  const reconstructedOutputTables = !sourceOutputMappingReliable &&
    splittingAllowed &&
    expectedTables != null && Number.isInteger(expectedTables) &&
    extractedOutputTables != null && Number.isInteger(extractedOutputTables) &&
    predictedTables != null && Number.isInteger(predictedTables) &&
    unparseableOutputTables != null && Number.isInteger(unparseableOutputTables)
    ? reconstructSplitTableOutput({
        actualMarkdown,
        expectedMarkdown,
        expectedTableCount: expectedTables,
        rawOutputTableCount: extractedOutputTables,
        scoredOutputTableCount: predictedTables,
        unparseableOutputTableCount: unparseableOutputTables,
        pairing,
      })
    : null;
  const outputMappingReliable = sourceOutputMappingReliable || reconstructedOutputTables != null;
  const outputTablePreviews: OutputTablePreview[] = reconstructedOutputTables ??
    outputTableFragments.map((markdown) => ({ markdown, reconstructed: false }));
  return tablePairEvidence(
    expectedTableFragments,
    outputTablePreviews,
    expectedTables,
    outputMappingReliable,
    gritsMetric,
    tableMetric,
  );
}

function tablePairHeadlineScore(pair: TablePairEvidence, mode: TableScoreBreakdown["mode"]) {
  const grits = asNumber(pair.grits?.grits_con);
  const trm = asNumber(pair.trm?.score) ??
    (pair.expectedIndex != null && pair.outputIndex == null ? 0 : null);
  if (mode === "grits_only") return grits;
  if (mode === "combined" && grits != null && trm != null) return (grits + trm) / 2;
  return null;
}

function TablePairComparison({
  pair,
  pairNumber,
  scoreMode,
}: {
  pair: TablePairEvidence;
  pairNumber: number;
  scoreMode: TableScoreBreakdown["mode"];
}) {
  const pairScore = tablePairHeadlineScore(pair, scoreMode);
  const differenceCount = pair.trm ? tableDifferenceCount(pair.trm) : 0;
  const trmScore = asNumber(pair.trm?.score) ??
    (pair.expectedIndex != null && pair.outputIndex == null ? 0 : null);
  const trmReason = asString(pair.trm?.reason) ??
    (pair.expectedIndex != null && pair.outputIndex == null ? "no prediction" : null);
  const metricValues = [
    ["GriTS-Con", asNumber(pair.grits?.grits_con)],
    ...(scoreMode === "combined" || pair.trm
      ? [["Table record match", trmScore] as const]
      : []),
    ["GriTS precision", asNumber(pair.grits?.grits_precision_con)],
    ["GriTS recall", asNumber(pair.grits?.grits_recall_con)],
  ].filter((entry): entry is [string, number] => entry[1] != null);
  const expectedLabel = pair.expectedIndex == null
    ? "No expected table"
    : `Expected table ${pair.expectedIndex + 1}`;
  const outputLabel = pair.outputIndex == null
    ? "No output match"
    : `Output table ${pair.outputIndex + 1}`;

  return (
    <article className="diagnostic-table-pair">
      <header className="diagnostic-table-pair-heading">
        <div>
          <span className="diagnostic-eyebrow">
            {pair.expectedIndex == null ? "Unmatched output" : `Table comparison ${pairNumber}`}
          </span>
          <h4>{expectedLabel} <span aria-hidden="true">↔</span> {outputLabel}</h4>
        </div>
        {pairScore != null && (
          <div className="diagnostic-table-pair-score">
            <span>Pair score</span>
            <strong>{scorePercent(pairScore)}</strong>
          </div>
        )}
      </header>
      {metricValues.length > 0 && (
        <dl className="diagnostic-table-pair-metrics">
          {metricValues.map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{scorePercent(value)}</dd></div>
          ))}
        </dl>
      )}
      {(trmReason || asString(pair.grits?.note)) && (
        <p className="diagnostic-table-pair-reason">
          {trmReason ? `Table record match: ${humanize(trmReason)}.` : asString(pair.grits?.note)}
        </p>
      )}
      <div className="diagnostic-table-pair-preview">
        <section>
          <div className="diagnostic-panel-heading">
            <span className="diagnostic-eyebrow">Expected</span>
            <h5>{expectedLabel}</h5>
          </div>
          <MarkdownEvidence
            markdown={pair.expectedMarkdown ?? ""}
            empty={pair.expectedIndex == null
              ? "This output table has no expected-table partner."
              : "Expected table markup was not retained for this indexed table."}
          />
        </section>
        <section>
          <div className="diagnostic-panel-heading">
            <span className="diagnostic-eyebrow">Output</span>
            <h5>{outputLabel}</h5>
            {pair.outputReconstructed && (
              <span className="diagnostic-derived-badge">Derived segment</span>
            )}
          </div>
          <MarkdownEvidence
            markdown={pair.outputMarkdown ?? ""}
            empty={!pair.outputMarkupReliable
              ? "Parsing changed the evaluator’s output-table list, so source markup cannot be mapped safely to this comparison. Inspect the complete Output tab instead."
              : pair.outputIndex == null
                ? "The evaluator did not pair an output table with this expected table."
                : "Output table markup was not retained for this indexed table."}
          />
        </section>
      </div>
      {differenceCount > 0 ? (
        <TableDifferences table={pair.trm ?? {}} differenceCount={differenceCount} />
      ) : pair.trm && asRecordArray(pair.trm.record_details).length > 0 ? (
        <p className="diagnostic-empty diagnostic-empty-compact">
          No field-level differences were found in the retained table-record-match evidence.
        </p>
      ) : trmReason === "no prediction" ? (
        <p className="diagnostic-empty diagnostic-empty-compact">
          Field comparison could not run because this expected table has no paired output table.
        </p>
      ) : trmReason === "no column matches" ? (
        <p className="diagnostic-empty diagnostic-empty-compact">
          Field comparison could not run because table-record matching found no corresponding columns.
        </p>
      ) : scoreMode === "grits_only" ? (
        <p className="diagnostic-empty diagnostic-empty-compact">
          Table-record matching is not part of this page’s headline score.
        </p>
      ) : null}
    </article>
  );
}

function TableMetricDetails({
  metric,
  metricIndex,
  impact,
  selectedEvidenceId,
  onSelectEvidence,
}: {
  metric: DiagnosticMetric;
  metricIndex: number;
  impact: RuleImpact;
  selectedEvidenceId?: string | null;
  onSelectEvidence?: (id: string) => void;
}) {
  const tables = asRecordArray(metric.metadata?.per_table_details);
  if (!tables.length) return null;
  return (
    <section className="diagnostic-table-metric">
      <div className="diagnostic-section-heading">
        <div><span className="diagnostic-eyebrow">Structured comparison</span><h3>{humanize(metric.metric_name)}</h3></div>
        <div className="diagnostic-table-metric-score">
          <RuleImpactLabel impact={impact} />
          <strong>{scorePercent(metric.value)}</strong>
          {impact === "supporting" && <small>Not used in headline score</small>}
        </div>
      </div>
      <div className="diagnostic-table-detail-list">
        {tables.map((table, tableIndex) => {
          const gtIndex = asNumber(table.gt_table_index);
          const predictionIndex = asNumber(table.pred_table_index);
          const standaloneTableIndex = asNumber(table.table_index);
          const describesOutputStructure = gtIndex == null && predictionIndex == null && standaloneTableIndex != null;
          const retainedRecordEvidence = asRecordArray(table.record_details).length > 0;
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
                    : retainedRecordEvidence && predictionIndex != null
                      ? "No field-level differences were found in the retained table-record-match evidence."
                      : "No field-level comparison evidence was retained for this table. This does not mean the expected and output tables matched."}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function TableDiagnostic({
  diagnostic,
  actualMarkdown,
  selectedEvidenceId,
  onSelectEvidence,
}: DiagnosticInspectorProps) {
  const scoreBreakdown = tableScoreBreakdown(diagnostic);
  const structuredMetrics = diagnostic.metrics.filter(
    (metric) => asRecordArray(metric.metadata?.per_table_details).length > 0,
  );
  const primaryFormula = asRecord(diagnostic.primary_metric?.formula);
  const primaryComponents = metricComponents(diagnostic.primary_metric?.components);
  const formulaComponents = metricComponents(primaryFormula?.components);
  const componentNames = (primaryComponents.length ? primaryComponents : formulaComponents)
    .map((component) => component.metric_name ?? component.name)
    .filter((name): name is string => Boolean(name));
  const headlineMetricNames = new Set(componentNames);
  if (diagnostic.primary_metric?.name) headlineMetricNames.add(diagnostic.primary_metric.name);
  if (scoreBreakdown.mode === "grits_only") {
    headlineMetricNames.delete("table_record_match");
    headlineMetricNames.add("grits_con");
  } else if (scoreBreakdown.mode === "combined") {
    headlineMetricNames.add("grits_con");
    headlineMetricNames.add("table_record_match");
  } else if (diagnostic.primary_metric?.name === "grits_trm_composite") {
    headlineMetricNames.add("grits_con");
    headlineMetricNames.add("table_record_match");
  }
  const orderedStructuredMetrics = [
    ...structuredMetrics.filter((metric) => headlineMetricNames.has(metric.metric_name)),
    ...structuredMetrics.filter((metric) => !headlineMetricNames.has(metric.metric_name)),
  ];
  const tableMetric = diagnostic.metrics.find(
    (metric) => metric.metric_name === "table_record_match",
  );
  const gritsMetric = diagnostic.metrics.find(
    (metric) => metric.metric_name === "grits_con",
  );
  const metricValue = (name: string) => diagnostic.metrics.find(
    (metric) => metric.metric_name === name,
  )?.value ?? null;
  const predictedTables = asNumber(tableMetric?.metadata?.n_pred_tables) ??
    asNumber(gritsMetric?.metadata?.tables_found_actual) ??
    metricValue("tables_actual") ??
    asNumber(diagnostic.summary.predicted);
  const expectedTables = asNumber(tableMetric?.metadata?.n_gt_tables) ??
    asNumber(gritsMetric?.metadata?.tables_found_expected) ??
    metricValue("tables_expected") ??
    asNumber(diagnostic.summary.expected);
  const pairedTables = metricValue("tables_paired") ??
    asNumber(gritsMetric?.metadata?.tables_matched);
  const unmatchedExpected = metricValue("tables_unmatched_expected");
  const unmatchedOutput = metricValue("tables_unmatched_pred");
  const tablePairs = useMemo(
    () => reconstructedTablePairs(diagnostic, actualMarkdown),
    [actualMarkdown, diagnostic],
  );
  const hasReconstructedOutput = tablePairs.some((pair) => pair.outputReconstructed);
  const supportingStructuredMetrics = orderedStructuredMetrics.filter(
    (metric) => !headlineMetricNames.has(metric.metric_name),
  );
  const alignmentCounts = [
    ["Expected", expectedTables],
    ["Output", predictedTables],
    ["Paired", pairedTables],
    ["Unmatched expected", unmatchedExpected],
    ["Unmatched output", unmatchedOutput],
  ] as const;
  return (
    <div className="diagnostic-dimension-view diagnostic-table-view">
      <TableScoreExplanation diagnostic={diagnostic} />
      <dl className="diagnostic-table-alignment" aria-label="Expected and output table alignment">
        {alignmentCounts.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value == null ? "—" : value.toLocaleString()}</dd></div>
        ))}
      </dl>
      {tablePairs.length ? (
        <section className="diagnostic-table-pairs" aria-labelledby="diagnostic-table-pairs-heading">
          <div className="diagnostic-section-heading">
            <div>
              <span className="diagnostic-eyebrow">Table-by-table evidence</span>
              <h3 id="diagnostic-table-pairs-heading">Expected and output table comparisons</h3>
            </div>
            <span>{tablePairs.length.toLocaleString()} comparisons</span>
          </div>
          {hasReconstructedOutput && (
            <p className="diagnostic-table-reconstruction-note">
              <strong>Derived output segments.</strong> ParseBench split one or more wider source tables at repeated column headers before scoring. These previews reconstruct the corresponding source segments for context; the evaluator can still normalize cells or remove title rows, and the complete original remains in the Output tab.
            </p>
          )}
          <div className="diagnostic-table-pair-list">
            {tablePairs.map((pair, index) => (
              <TablePairComparison
                pair={pair}
                pairNumber={index + 1}
                scoreMode={scoreBreakdown.mode}
                key={`${pair.expectedIndex ?? "extra"}-${pair.outputIndex ?? "missing"}`}
              />
            ))}
          </div>
        </section>
      ) : (
        <EmptyDiagnostics
          title={predictedTables === 0 ? "No structured table was detected" : "No table alignment available"}
          message={predictedTables === 0
            ? `The evaluator expected ${expectedTables ?? "at least one"} table but detected no structured output table, so GRITS/TRM had no pair to compare. Inspect the Output tab to see whether the content was flattened into ordinary text.`
            : "No expected/output table pair was retained for field-level comparison. Use the expected and predicted counts above to see whether a table was missing or extra."}
        />
      )}
      {supportingStructuredMetrics.map((metric, index) => (
        <TableMetricDetails
          key={`${metric.metric_name}-${index}`}
          metric={metric}
          metricIndex={index}
          impact="supporting"
          selectedEvidenceId={selectedEvidenceId}
          onSelectEvidence={onSelectEvidence}
        />
      ))}
    </div>
  );
}
