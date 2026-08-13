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
import {
  diagnosticUsesElementLayout,
  layoutElementHeadlineStatus,
  layoutExpectationIgnored,
} from "./semantics";

type DiagnosticInspectorProps = {
  diagnostic: DiagnosticArtifact;
  actualMarkdown: string;
  selectedEvidenceId?: string | null;
  onSelectEvidence?: (evidenceId: string) => void;
};

type EvidenceStatus = "passed" | "partial" | "failed" | "unknown";
type RuleImpact = "headline" | "supporting";

const RULE_IMPACTS: readonly RuleImpact[] = ["headline", "supporting"];

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

const CONTENT_HEADLINE_RULE_TYPES = new Set([
  "missing_word_percent",
  "unexpected_word_percent",
  "too_many_word_occurence_percent",
  "missing_sentence_percent",
  "unexpected_sentence_percent",
  "too_many_sentence_occurence_percent",
  "extra_content",
  "bag_of_digit_percent",
  "order",
]);

const FORMATTING_HEADLINE_RULE_TYPES = new Set([
  "is_bold",
  "is_not_bold",
  "is_strikeout",
  "is_not_strikeout",
  "is_sup",
  "is_not_sup",
  "is_sub",
  "is_not_sub",
  "is_title",
  "title_hierarchy_percent",
  "is_latex",
  "is_code_block",
]);

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
  const kind = asString(record.kind);
  if (kind === "fallback") {
    const reason = asString(record.reason);
    const description = reason === "trm_unsupported"
      ? "GriTS-Con only; table-record matching is not applicable to this document."
      : reason === "trm_missing"
        ? "GriTS-Con only; no table-record match score was produced."
        : reason
          ? `Fallback score: ${humanize(reason)}`
          : "Fallback score";
    return { description, components };
  }
  if (kind === "weighted_mean" && components.length) {
    const terms = components.map((component) => {
      const name = humanize(component.label ?? component.name ?? component.metric_name);
      return component.weight == null ? name : `${name} × ${component.weight.toLocaleString()}`;
    });
    const weightSum = asNumber(record.weight_sum);
    return {
      description: weightSum != null && weightSum !== 1
        ? `(${terms.join(" + ")}) ÷ ${weightSum.toLocaleString()}`
        : terms.join(" + "),
      components,
    };
  }
  const explicit = asString(record.description);
  if (explicit) return { description: explicit, components };
  return { description: null, components };
}

function metricContract(diagnostic: DiagnosticArtifact) {
  switch (diagnostic.primary_metric?.name) {
    case "layout_element_rule_pass_rate":
      return "An element passes the headline only when localization and classification pass, plus attribution when the element has scorable content. Reading order is reported separately and does not change this score.";
    case "rule_pass_rate":
      return "This score is the mean of the individual rule scores shown below; partially matched rules can contribute partial credit.";
    case "content_faithfulness":
      return "Content Faithfulness combines normalized content correctness at full weight with reading order at half weight. Supporting checks shown below may help diagnose the page without directly changing the headline.";
    case "semantic_formatting":
      return "Semantic Formatting combines only the available headline formatting categories. Supporting rule checks are shown for diagnosis but do not directly change this score.";
    default:
      return null;
  }
}

function isTableRecordSummary(diagnostic: DiagnosticArtifact) {
  return asString(diagnostic.summary.source)?.startsWith("table_record_match") === true;
}

function outcomeId(outcome: DiagnosticOutcome, index: number) {
  return asString(outcome.id) ?? asString(outcome.rule_id) ??
    asString(outcome.element_id) ?? `outcome-${index + 1}`;
}

function evidenceStatus(outcome: DiagnosticOutcome | null): EvidenceStatus {
  if (!outcome) return "unknown";
  if (
    "localization_pass" in outcome ||
    "classification_pass" in outcome ||
    "attribution_applicable" in outcome
  ) {
    return layoutElementHeadlineStatus(outcome);
  }
  const status = asString(outcome.status)?.toLowerCase();
  if (status === "pass" || status === "passed" || status === "success") return "passed";
  if (status === "partial" || status === "warning") return "partial";
  if (status === "fail" || status === "failed" || status === "error") return "failed";
  if (outcome.passed === true) return "passed";
  if (outcome.passed === false) {
    const score = asNumber(outcome.score);
    return score != null && score > 0 ? "partial" : "failed";
  }
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

function structuredTableFragments(markdown: string) {
  // Mirror ParseBench's table evaluator: only top-level HTML <table> blocks
  // participate in GriTS/TRM. Markdown pipe tables are deliberately excluded.
  const tables: string[] = [];
  const lower = markdown.toLowerCase();
  let searchStart = 0;
  while (searchStart < lower.length) {
    const start = lower.indexOf("<table", searchStart);
    if (start === -1) break;
    const tagNameEnd = start + "<table".length;
    if (tagNameEnd < lower.length && ![">", " ", "\t", "\n", "\r"].includes(lower[tagNameEnd])) {
      searchStart = start + 1;
      continue;
    }

    let depth = 0;
    let position = start;
    let end = -1;
    while (position < lower.length) {
      const nextOpen = lower.indexOf("<table", position + 1);
      const nextClose = lower.indexOf("</table>", position + 1);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        const nestedNameEnd = nextOpen + "<table".length;
        if (
          nestedNameEnd < lower.length &&
          ![">", " ", "\t", "\n", "\r"].includes(lower[nestedNameEnd])
        ) {
          position = nextOpen;
          continue;
        }
        depth += 1;
        position = nextOpen;
      } else if (depth === 0) {
        end = nextClose + "</table>".length;
        break;
      } else {
        depth -= 1;
        position = nextClose;
      }
    }
    if (end === -1) {
      tables.push(markdown.slice(start));
      break;
    }
    tables.push(markdown.slice(start, end));
    searchStart = end;
  }
  return tables.map((table) => table.trim()).filter(Boolean);
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

type TableScoreBreakdown = {
  mode: "combined" | "grits_only" | "unknown";
  gritsScore: number | null;
  trmScore: number | null;
  gritsWeight: number | null;
  trmWeight: number | null;
  fallbackReason: string | null;
};

function tableScoreBreakdown(diagnostic: DiagnosticArtifact): TableScoreBreakdown {
  const primaryFormula = asRecord(diagnostic.primary_metric?.formula);
  const primaryComponents = metricComponents(diagnostic.primary_metric?.components);
  const formulaComponents = metricComponents(primaryFormula?.components);
  const components = primaryComponents.length ? primaryComponents : formulaComponents;
  const compositeMetric = diagnostic.metrics.find(
    (metric) => metric.metric_name === "grits_trm_composite",
  );
  const gritsComponent = components.find(
    (component) => (component.metric_name ?? component.name) === "grits_con",
  );
  const trmComponent = components.find(
    (component) => (component.metric_name ?? component.name) === "table_record_match",
  );
  const gritsMetric = diagnostic.metrics.find(
    (metric) => metric.metric_name === "grits_con",
  );
  const trmMetric = diagnostic.metrics.find(
    (metric) => metric.metric_name === "table_record_match",
  );
  const fallbackReason = asString(primaryFormula?.reason) ??
    asString(compositeMetric?.metadata?.reason) ??
    asString(compositeMetric?.metadata?.fallback);
  const formulaKind = asString(primaryFormula?.kind);
  const hasFallback = formulaKind === "fallback" || fallbackReason != null;
  const hasCombinedFormula = formulaKind === "weighted_mean" ||
    (!hasFallback && gritsComponent != null && trmComponent != null);

  return {
    mode: hasFallback ? "grits_only" : hasCombinedFormula ? "combined" : "unknown",
    gritsScore: gritsComponent?.value ??
      asNumber(compositeMetric?.metadata?.grits_con) ??
      gritsMetric?.value ??
      (hasFallback ? diagnostic.primary_metric?.value ?? null : null),
    trmScore: trmComponent?.value ??
      asNumber(compositeMetric?.metadata?.trm) ??
      trmMetric?.value ??
      null,
    gritsWeight: gritsComponent?.weight ?? (hasFallback ? 1 : hasCombinedFormula ? 0.5 : null),
    trmWeight: trmComponent?.weight ?? (hasCombinedFormula ? 0.5 : null),
    fallbackReason,
  };
}

function tableFallbackExplanation(reason: string | null) {
  if (reason === "trm_unsupported") {
    return "Record matching is not reliable for this document’s table structure, so the benchmark excludes it from the headline score.";
  }
  if (reason === "trm_missing") {
    return "No table-record match score was produced for this result, so the benchmark excludes it from the headline score.";
  }
  return "The diagnostic artifact marks table-record matching as unavailable, so the headline score uses grid/content similarity alone.";
}

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

function tablePairEvidence(
  expectedMarkdown: string[],
  outputMarkdown: string[],
  expectedCount: number | null,
  outputMappingReliable: boolean,
  gritsMetric: DiagnosticMetric | null,
  trmMetric: DiagnosticMetric | null,
) {
  const gritsByExpected = tableDetailsByExpected(gritsMetric);
  const trmByExpected = tableDetailsByExpected(trmMetric);
  const outputByExpected = new Map<number, number | null>();

  const rawPairing = gritsMetric?.metadata?.pairing;
  if (Array.isArray(rawPairing)) {
    for (const entry of rawPairing) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const expectedIndex = tableIndex(entry[0]);
      const outputIndex = entry[1] == null ? null : tableIndex(entry[1]);
      if (expectedIndex != null) outputByExpected.set(expectedIndex, outputIndex);
    }
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
        : outputMarkdown[outputIndex] ?? null,
      outputMarkupReliable: outputMappingReliable &&
        (outputIndex == null || outputIndex < outputMarkdown.length),
      grits: gritsByExpected.get(expectedIndex) ?? null,
      trm: trmByExpected.get(expectedIndex) ?? null,
    });
  }
  if (outputMappingReliable) {
    outputMarkdown.forEach((markdown, outputIndex) => {
      if (pairedOutputIndexes.has(outputIndex)) return;
      pairs.push({
        expectedIndex: null,
        outputIndex,
        expectedMarkdown: null,
        outputMarkdown: markdown,
        outputMarkupReliable: true,
        grits: null,
        trm: null,
      });
    });
  }
  return pairs;
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

function TableDiagnostic({
  diagnostic,
  actualMarkdown,
  selectedEvidenceId,
  onSelectEvidence,
}: DiagnosticInspectorProps) {
  const scoreBreakdown = tableScoreBreakdown(diagnostic);
  const expectedMarkdown = diagnostic.expectations
    .map((expectation) => expectation.expected_markdown?.trim())
    .filter((markdown): markdown is string => Boolean(markdown))
    .join("\n\n");
  const expectedTableFragments = structuredTableFragments(expectedMarkdown);
  const outputTableFragments = structuredTableFragments(actualMarkdown);
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
  const extractedOutputTables = metricValue("tables_actual");
  const unparseableOutputTables = metricValue("tables_unparseable_pred");
  const outputMappingReliable = unparseableOutputTables === 0 &&
    extractedOutputTables === outputTableFragments.length &&
    predictedTables === outputTableFragments.length;
  const tablePairs = tablePairEvidence(
    expectedTableFragments,
    outputTableFragments,
    expectedTables,
    outputMappingReliable,
    gritsMetric ?? null,
    tableMetric ?? null,
  );
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

function arrayPreview(value: unknown): unknown[][] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is unknown[] => Array.isArray(row))
    .slice(0, 12)
    .map((row) => row.slice(0, 12));
}

function chartScoringDescription(type: string, rule: Record<string, unknown>) {
  const configuredMaxDiffs = asNumber(rule.max_diffs);
  if (type === "chart_data_point") {
    const tolerance = asNumber(rule.relative_tolerance) ?? 0.01;
    const maxDiffs = configuredMaxDiffs ?? 0;
    const normalizeNumbers = rule.normalize_numbers !== false;
    return [
      "Value and every label must be associated in one table",
      `number normalization ${normalizeNumbers ? "on" : "off"}`,
      normalizeNumbers ? `numeric tolerance ${scorePercent(tolerance)}` : null,
      `text edit allowance ${maxDiffs.toLocaleString()}`,
    ].filter(Boolean).join(" · ");
  }
  if (type === "chart_data_array_labels") {
    return [
      "Mean label similarity",
      rule.x_axis_shuffle === true ? "column order may change" : "column order must match",
      "best row/column orientation is used",
      configuredMaxDiffs == null
        ? null
        : `stored max_diffs ${configuredMaxDiffs.toLocaleString()} (not used by this array scorer)`,
    ].filter(Boolean).join(" · ");
  }
  if (type === "chart_data_array_data") {
    const normalizeNumbers = rule.normalize_numbers !== false;
    const order = [
      rule.x_axis_shuffle === true ? "columns may reorder" : "columns stay ordered",
      rule.y_axis_shuffle === true ? "rows may reorder" : "rows stay ordered",
    ].join(" · ");
    return [
      "Mean data-cell similarity",
      order,
      `number normalization ${normalizeNumbers ? "on" : "off"}`,
      configuredMaxDiffs == null
        ? null
        : `stored max_diffs ${configuredMaxDiffs.toLocaleString()} (not used by this array scorer)`,
    ].filter(Boolean).join(" · ");
  }
  return "Evaluated as a structured chart rule against a Markdown or HTML table.";
}

function ChartScoringContract() {
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
      <ChartScoringContract />
      <div className="diagnostic-table-scroll">
        <table className="diagnostic-chart-table">
          <thead><tr><th>Check</th><th>Labels</th><th>Expected</th><th>Matching rule</th><th>Result</th></tr></thead>
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

function subcheckStatus(outcome: DiagnosticOutcome, key: string, applicable = true): EvidenceStatus {
  if (!applicable) return "unknown";
  const value = outcome[key];
  return value === true ? "passed" : value === false ? "failed" : "unknown";
}

function metricByName(metrics: DiagnosticMetric[], name: string) {
  return metrics.find((metric) => metric.metric_name === name) ?? null;
}

function layoutMetricCount(metric: DiagnosticMetric | null) {
  const passed = asNumber(metric?.metadata?.passed);
  const total = asNumber(metric?.metadata?.total);
  return passed != null && total != null
    ? `${passed.toLocaleString()} of ${total.toLocaleString()} passed`
    : null;
}

function layoutMatchDetail(outcome: DiagnosticOutcome, kind: "localization" | "classification" | "attribution" | "order") {
  if (kind === "localization") {
    const values = [
      asNumber(outcome.best_pred_iou) != null ? `IoU ${scorePercent(asNumber(outcome.best_pred_iou))}` : null,
      asNumber(outcome.best_pred_ioa_gt) != null ? `GT overlap ${scorePercent(asNumber(outcome.best_pred_ioa_gt))}` : null,
    ].filter(Boolean);
    return values.join(" · ") || humanize(asString(outcome.localization_reason));
  }
  if (kind === "classification") {
    const expected = asString(outcome.gt_class) ?? asString(outcome.gt_class_norm);
    const predicted = asString(outcome.best_pred_class) ?? asString(outcome.best_pred_class_norm);
    return expected && predicted
      ? `${humanize(expected)} → ${humanize(predicted)}`
      : humanize(asString(outcome.classification_reason));
  }
  if (kind === "attribution") {
    const f1 = asNumber(outcome.token_f1);
    const threshold = asNumber(outcome.attribution_threshold);
    if (f1 != null) {
      return `Token F1 ${scorePercent(f1)}${threshold != null ? ` · needs ${scorePercent(threshold)}` : ""}`;
    }
    return humanize(asString(outcome.attribution_reason));
  }
  const expectedOrder = asNumber(outcome.gt_ro_index);
  const predictedOrder = asNumber(outcome.matched_pred_order_index);
  if (expectedOrder != null && predictedOrder != null) {
    return `Expected ${expectedOrder + 1} · output ${predictedOrder + 1}`;
  }
  return humanize(asString(outcome.reading_order_reason));
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
  ] as const;
  const readingOrderMetric = metricByName(diagnostic.metrics, "layout_reading_order_pass_rate");
  return (
    <div className="diagnostic-dimension-view diagnostic-layout-view">
      <aside className="diagnostic-contract-note diagnostic-layout-contract">
        <strong>How an element passes</strong>
        <p>
          Localization and classification must pass, plus content attribution when it applies. This is an
          all-required decision for each element, not an average of the three stage percentages.
        </p>
      </aside>
      <dl className="diagnostic-layout-summary" aria-label="Layout evaluation stages">
        {categoryMetrics.map(([label, name]) => {
          const metric = metricByName(diagnostic.metrics, name);
          return (
            <div key={name}>
              <dt>{label}</dt>
              <dd>{scorePercent(metric?.value)}</dd>
              {layoutMetricCount(metric) && <small>{layoutMetricCount(metric)}</small>}
            </div>
          );
        })}
      </dl>
      <div className="diagnostic-layout-order-summary">
        <div>
          <span className="diagnostic-eyebrow">Separate diagnostic</span>
          <strong>Reading order</strong>
          <p>Reported for debugging after matching; it does not change the element headline score.</p>
        </div>
        <div>
          <strong>{scorePercent(readingOrderMetric?.value)}</strong>
          {layoutMetricCount(readingOrderMetric) && <small>{layoutMetricCount(readingOrderMetric)}</small>}
        </div>
      </div>
      {outcomes.length ? (
        <section aria-labelledby="diagnostic-layout-elements-heading">
          <div className="diagnostic-section-heading">
            <div><span className="diagnostic-eyebrow">Element evidence</span><h3 id="diagnostic-layout-elements-heading">Ground truth matched to output</h3></div>
            <span>{outcomes.length.toLocaleString()} elements</span>
          </div>
          <div className="diagnostic-table-scroll">
            <table className="diagnostic-layout-table">
              <thead><tr><th>Element</th><th>Overall</th><th>Localization</th><th>Classification</th><th>Attribution</th><th className="diagnostic-aux-column">Reading order</th></tr></thead>
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
                      <td><StatusPill status={layoutElementHeadlineStatus(outcome)} /></td>
                      <td><StatusPill status={subcheckStatus(outcome, "localization_pass")} /><small>{layoutMatchDetail(outcome, "localization")}</small></td>
                      <td><StatusPill status={subcheckStatus(outcome, "classification_pass")} /><small>{layoutMatchDetail(outcome, "classification")}</small></td>
                      <td>
                        <StatusPill status={subcheckStatus(outcome, "attribution_pass", attributionApplicable)} label={attributionApplicable ? undefined : "Not scored"} />
                        <small>{layoutMatchDetail(outcome, "attribution")}</small>
                      </td>
                      <td className="diagnostic-aux-column"><StatusPill status={subcheckStatus(outcome, "reading_order_pass", outcome.reading_order_eligible === true)} label={outcome.reading_order_eligible === true ? undefined : "Not scored"} /><small>{layoutMatchDetail(outcome, "order")}</small></td>
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

function HybridLayoutDiagnostic(props: DiagnosticInspectorProps) {
  const scoredItems = buildEvidenceItems(props.diagnostic).filter((item) => item.type !== "layout");
  const referenceCount = props.diagnostic.expectations.filter((expectation) => expectation.type === "layout").length;
  return (
    <div className="diagnostic-dimension-view diagnostic-layout-order-view">
      <aside className="diagnostic-contract-note">
        <strong>This is a reading-order evaluation with layout references</strong>
        <p>
          The {referenceCount.toLocaleString()} layout annotations identify regions on the source page, but
          they are not scored as detected elements in this result. Only the {scoredItems.length.toLocaleString()}
          {" "}reading-order {scoredItems.length === 1 ? "check contributes" : "checks contribute"} to the headline.
        </p>
      </aside>
      {scoredItems.length ? (
        <section aria-labelledby="diagnostic-layout-order-heading">
          <div className="diagnostic-section-heading">
            <div>
              <span className="diagnostic-eyebrow">Scored evidence</span>
              <h3 id="diagnostic-layout-order-heading">Expected sequence in extracted content</h3>
            </div>
            <span>{scoredItems.length.toLocaleString()} checks</span>
          </div>
          <RuleGroups
            items={scoredItems}
            groups={[{ key: "order", label: "Reading-order checks" }]}
            groupForType={() => "order"}
            selectedEvidenceId={props.selectedEvidenceId}
            onSelectEvidence={props.onSelectEvidence}
            impactForType={() => "headline"}
          />
        </section>
      ) : <EmptyDiagnostics message="No scored reading-order outcomes were retained for this result." />}
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

function ruleImpact(diagnostic: DiagnosticArtifact, type: string): RuleImpact {
  const primaryName = diagnostic.primary_metric?.name;
  if (primaryName === "rule_pass_rate") return "headline";
  if (primaryName === `rule_${type}_pass_rate`) return "headline";
  if (primaryName === "content_faithfulness") {
    return CONTENT_HEADLINE_RULE_TYPES.has(type) ? "headline" : "supporting";
  }
  if (primaryName === "semantic_formatting") {
    return FORMATTING_HEADLINE_RULE_TYPES.has(type) ? "headline" : "supporting";
  }
  return "supporting";
}

function RuleImpactLabel({ impact }: { impact: RuleImpact }) {
  return (
    <span className={`diagnostic-rule-impact diagnostic-rule-impact-${impact}`}>
      {impact === "headline" ? "Headline input" : "Supporting diagnostic"}
    </span>
  );
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
  ]);
  const values = Object.entries(rule)
    .filter(([key, value]) => !ignored.has(key) && value != null)
    .slice(0, 4)
    .map(([key, value]) => `${humanize(key)}: ${ruleValueSummary(value)}`);
  return values.join(" · ") || "No additional expectation parameters";
}

function singleScalarRuleEntry(value: unknown): [string, string | number | boolean | null] | null {
  const rule = asRecord(value);
  if (!rule) return null;
  const entries = Object.entries(rule);
  if (entries.length !== 1) return null;
  const entry = entries[0];
  if (!entry) return null;
  const [key, scalar] = entry;
  if (
    scalar === null ||
    typeof scalar === "string" ||
    typeof scalar === "boolean" ||
    (typeof scalar === "number" && Number.isFinite(scalar))
  ) {
    return [key, scalar];
  }
  return null;
}

function RuleGroups({
  items,
  groups,
  groupForType,
  selectedEvidenceId,
  onSelectEvidence,
  impactForType,
  advisoryForItem,
}: {
  items: EvidenceItem[];
  groups: readonly { key: string; label: string }[];
  groupForType: (type: string) => string;
  selectedEvidenceId?: string | null;
  onSelectEvidence?: (id: string) => void;
  impactForType?: (type: string) => RuleImpact;
  advisoryForItem?: (item: EvidenceItem) => string | null;
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
  const impactSections = (impactForType ? RULE_IMPACTS : [null]).map((impact) => ({
    impact,
    items: items.filter((item) => impact == null || impactForType?.(item.type) === impact),
  }));
  const itemMatchesFilters = (item: EvidenceItem) => {
    if (!showAll && evidenceStatus(item.outcome) === "passed") return false;
    if (!normalizedQuery) return true;
    return [
      item.type,
      expectedRuleSummary(item.expectation?.rule),
      outcomeExplanation(item.outcome) ?? "",
    ].some((value) => queryTerms.some((term) => value.toLowerCase().includes(term)));
  };
  const firstPopulatedGroup = impactSections.flatMap((section) =>
    groups.map((group) => ({
      key: `${section.impact ?? "all"}:${group.key}`,
      populated: section.items.some(
        (item) => groupForType(item.type) === group.key && itemMatchesFilters(item),
      ),
    })),
  ).find((group) => group.populated)?.key;
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
      {impactSections.map((section) => {
        if (!section.items.some(itemMatchesFilters)) return null;
        return (
          <div className={`diagnostic-impact-section${section.impact ? ` diagnostic-impact-section-${section.impact}` : ""}`} key={section.impact ?? "all"}>
            {section.impact && (
              <div className="diagnostic-impact-heading">
                <strong>{section.impact === "headline" ? "Headline inputs" : "Supporting diagnostics"}</strong>
                <span>{section.items.length.toLocaleString()} checks</span>
              </div>
            )}
            {groups.map((group) => {
              const groupKey = `${section.impact ?? "all"}:${group.key}`;
              const groupedItems = section.items.filter((item) => groupForType(item.type) === group.key);
              if (!groupedItems.length) return null;
              const counts = statusCounts(groupedItems);
              const visibleItems = groupedItems
                .filter(itemMatchesFilters)
                .sort((left, right) =>
                  statusRank[evidenceStatus(left.outcome)] - statusRank[evidenceStatus(right.outcome)],
                );
              if (!visibleItems.length) return null;
              const visibleLimit = visibleLimits[groupKey] ?? 60;
              const renderedItems = visibleItems.slice(0, visibleLimit);
              return (
                <details className="diagnostic-rule-group" key={groupKey} open={Boolean(normalizedQuery) || groupKey === firstPopulatedGroup}>
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
                const advisory = advisoryForItem?.(item);
                return (
                  <EvidenceButton
                    key={item.id}
                    id={item.id}
                    selected={selectedEvidenceId === item.id}
                    onSelect={onSelectEvidence}
                    className="diagnostic-rule-row"
                  >
                    <span className="diagnostic-rule-main">
                      <span className="diagnostic-rule-title">
                        <strong>{humanize(item.type)}</strong>
                        {impactForType && <RuleImpactLabel impact={impactForType(item.type)} />}
                      </span>
                      <small>{expectedRuleSummary(item.expectation?.rule)}</small>
                      {explanation && <span title={explanation}>{explanation}</span>}
                      {advisory && <span className="diagnostic-rule-advisory">{advisory}</span>}
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
                    [groupKey]: visibleLimit + 60,
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
      })}
    </div>
  );
}

function normalizeInlineText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1")
    .replace(/[\s*_~`]+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function underlineSpanAdvisory(item: EvidenceItem, actualMarkdown: string) {
  if (item.type !== "is_underline" || evidenceStatus(item.outcome) !== "failed") return null;
  const expected = asString(asRecord(item.expectation?.rule)?.text);
  if (!expected || !actualMarkdown) return null;
  const normalizedExpected = normalizeInlineText(expected);
  if (!normalizedExpected) return null;

  const underlinePattern = /<(u|ins)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  for (const match of actualMarkdown.matchAll(underlinePattern)) {
    const normalizedSpan = normalizeInlineText(match[2] ?? "");
    if (
      normalizedSpan !== normalizedExpected &&
      normalizedSpan.includes(normalizedExpected)
    ) {
      return "Advisory: the expected text appears inside a larger underline span. The score above remains the benchmark result; its exact-span matcher may explain this failure.";
    }
  }
  return null;
}

function TextDiagnostic(props: DiagnosticInspectorProps) {
  const items = buildEvidenceItems(props.diagnostic);
  return items.length ? (
    <section className="diagnostic-dimension-view diagnostic-text-view" aria-labelledby="diagnostic-text-heading">
      <div className="diagnostic-section-heading">
        <div><span className="diagnostic-eyebrow">Content evidence</span><h3 id="diagnostic-text-heading">Completeness, accuracy and order</h3></div>
        <span>{items.length.toLocaleString()} checks</span>
      </div>
      <aside className="diagnostic-contract-note diagnostic-contract-note-compact">
        <strong>Headline inputs and supporting checks</strong>
        <p>
          Content completeness, unexpected content, duplicates, digits, and reading order feed Content
          Faithfulness. Other checks remain visible as supporting diagnostics. If this historical result uses
          Rule Pass Rate as its primary metric, every displayed rule contributes instead.
        </p>
      </aside>
      <RuleGroups
        items={items}
        groups={TEXT_GROUPS}
        groupForType={textGroup}
        selectedEvidenceId={props.selectedEvidenceId}
        onSelectEvidence={props.onSelectEvidence}
        impactForType={(type) => ruleImpact(props.diagnostic, type)}
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
      <aside className="diagnostic-contract-note diagnostic-contract-note-compact">
        <strong>Headline inputs and supporting checks</strong>
        <p>
          {props.diagnostic.primary_metric?.name === "rule_pass_rate"
            ? "This historical result uses Rule Pass Rate, so every displayed formatting rule contributes to the headline."
            : "The badges below identify which rules feed this result’s primary metric. In Semantic Formatting, title, bold, strikeout, superscript, subscript, LaTeX, and code categories contribute; underline, italic, and mark checks in historical artifacts are supporting diagnostics."}
        </p>
      </aside>
      <RuleGroups
        items={items}
        groups={FORMATTING_GROUPS}
        groupForType={formattingGroup}
        selectedEvidenceId={props.selectedEvidenceId}
        onSelectEvidence={props.onSelectEvidence}
        impactForType={(type) => ruleImpact(props.diagnostic, type)}
        advisoryForItem={(item) => underlineSpanAdvisory(item, props.actualMarkdown)}
      />
    </section>
  ) : <EmptyDiagnostics message="No formatting-rule outcomes were retained for this result." />;
}

type GroundTruthInspectorProps = {
  dimension: string;
  diagnostic: DiagnosticArtifact | null;
  fallbackMarkdown?: string | null;
};

function expectedTableCount(diagnostic: DiagnosticArtifact | null, markdown: string) {
  if (diagnostic) {
    const preferredMetrics = [
      "table_record_match",
      "grits_con",
      "grits_trm_composite",
      "teds",
    ];
    for (const metricName of preferredMetrics) {
      const metric = diagnostic.metrics.find((candidate) => candidate.metric_name === metricName);
      const count = asNumber(metric?.metadata?.n_gt_tables) ??
        asNumber(metric?.metadata?.tables_found_expected);
      if (count != null) return count;
    }
    const countMetric = diagnostic.metrics.find((metric) => metric.metric_name === "tables_expected");
    if (countMetric?.value != null) return countMetric.value;
    const summaryCount = asNumber(diagnostic.summary.expected);
    if (summaryCount != null) return summaryCount;
  }
  return markdown.match(/<table(?:\s|>)/gi)?.length ?? (markdown ? 1 : 0);
}

function TableGroundTruth({
  diagnostic,
  fallbackMarkdown,
}: Pick<GroundTruthInspectorProps, "diagnostic" | "fallbackMarkdown">) {
  const markdown = diagnostic?.expectations
    .map((expectation) => expectation.expected_markdown?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n\n") || fallbackMarkdown || "";
  const tableCount = expectedTableCount(diagnostic, markdown);
  const tables = structuredTableFragments(markdown);
  return (
    <section className="diagnostic-dimension-view diagnostic-ground-truth-view">
      <div className="diagnostic-section-heading">
        <div><span className="diagnostic-eyebrow">Table ground truth</span><h3>Expected table structure and content</h3></div>
        <span>{tableCount.toLocaleString()} {tableCount === 1 ? "table" : "tables"}</span>
      </div>
      {tables.length ? (
        <div className="diagnostic-ground-truth-table-list">
          {tables.map((table, index) => (
            <article className="diagnostic-ground-truth-table" key={index}>
              <div className="diagnostic-panel-heading">
                <span className="diagnostic-eyebrow">Expected</span>
                <h4>Table {index + 1}</h4>
              </div>
              <MarkdownEvidence
                markdown={table}
                empty={`Expected table ${index + 1} could not be rendered.`}
              />
            </article>
          ))}
        </div>
      ) : (
        <MarkdownEvidence
          markdown={markdown}
          empty="No rendered table ground truth is available for this page."
        />
      )}
    </section>
  );
}

function ChartGroundTruth({ diagnostic }: { diagnostic: DiagnosticArtifact }) {
  const expectations = diagnostic.expectations;
  if (!expectations.length) return <EmptyDiagnostics message="No chart ground truth was retained for this page." />;
  return (
    <section className="diagnostic-dimension-view diagnostic-ground-truth-view">
      <div className="diagnostic-section-heading">
        <div><span className="diagnostic-eyebrow">Chart ground truth</span><h3>Expected labels and data points</h3></div>
        <span>{expectations.length.toLocaleString()} checks</span>
      </div>
      <ChartScoringContract />
      <div className="diagnostic-table-scroll">
        <table className="diagnostic-chart-table">
          <thead><tr><th>Check</th><th>Labels</th><th>Expected value</th><th>Matching rule</th></tr></thead>
          <tbody>
            {expectations.map((expectation) => {
              const rule = asRecord(expectation.rule) ?? {};
              const labels = Array.isArray(rule.labels)
                ? rule.labels.map((label) => scalarDisplay(label)).join(" · ")
                : arrayPreview(rule.data)[0]?.map((label) => scalarDisplay(label)).join(" · ") ?? "—";
              const matrix = arrayPreview(rule.data);
              const value = rule.value ?? (matrix.length
                ? `${Math.max(matrix.length - 1, 0)} data rows × ${matrix[0]?.length ?? 0} columns`
                : "—");
              return (
                <tr key={expectation.id}>
                  <th scope="row"><strong>{humanize(expectation.type)}</strong></th>
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
                  <td className="diagnostic-method-cell">{chartScoringDescription(expectation.type, rule)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function layoutContentSummary(rule: Record<string, unknown>) {
  const content = asRecord(rule.content);
  const text = asString(content?.text);
  if (text) return text;
  const html = asString(content?.html);
  if (html) {
    const rowCount = html.match(/<tr(?:\s|>)/gi)?.length ?? 0;
    const firstRow = html.match(/<tr(?:\s|>)[\s\S]*?<\/tr>/i)?.[0] ?? "";
    const columnCount = firstRow.match(/<t[dh](?:\s|>)/gi)?.length ?? 0;
    return `HTML table${rowCount ? ` · ${rowCount.toLocaleString()} rows` : ""}${columnCount ? ` × ${columnCount.toLocaleString()} columns` : ""}`;
  }
  return "No text content expected";
}

function layoutBoxSummary(rule: Record<string, unknown>) {
  const bbox = Array.isArray(rule.bbox) ? rule.bbox.map(asNumber) : [];
  if (bbox.length !== 4 || bbox.some((value) => value == null)) return "—";
  return ["x", "y", "w", "h"]
    .map((label, index) => `${label} ${((bbox[index] ?? 0) * 100).toFixed(1)}%`)
    .join(" · ");
}

function sortedLayoutExpectations(expectations: DiagnosticExpectation[]) {
  return expectations
    .map((expectation, sourceIndex) => ({ expectation, sourceIndex }))
    .sort((left, right) => {
      const pageDifference = (left.expectation.page ?? 0) - (right.expectation.page ?? 0);
      if (pageDifference) return pageDifference;
      const leftOrder = asNumber(asRecord(left.expectation.rule)?.ro_index) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = asNumber(asRecord(right.expectation.rule)?.ro_index) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.sourceIndex - right.sourceIndex;
    })
    .map(({ expectation }) => expectation);
}

function LayoutGroundTruth({
  diagnostic,
  expectations = diagnostic.expectations.filter((expectation) => expectation.type === "layout"),
  referenceOnly = false,
}: {
  diagnostic: DiagnosticArtifact;
  expectations?: DiagnosticExpectation[];
  referenceOnly?: boolean;
}) {
  if (!expectations.length) return <EmptyDiagnostics message="No layout ground truth was retained for this page." />;
  const orderedExpectations = sortedLayoutExpectations(expectations);
  const sortedExpectations = referenceOnly
    ? orderedExpectations
    : [
        ...orderedExpectations.filter((expectation) => !layoutExpectationIgnored(expectation)),
        ...orderedExpectations.filter(layoutExpectationIgnored),
      ];
  const ignoredCount = sortedExpectations.filter(layoutExpectationIgnored).length;
  const scoredCount = sortedExpectations.length - ignoredCount;
  return (
    <section className="diagnostic-dimension-view diagnostic-ground-truth-view">
      <div className="diagnostic-section-heading">
        <div>
          <span className="diagnostic-eyebrow">{referenceOnly ? "Layout references" : "Layout ground truth"}</span>
          <h3>{referenceOnly ? "Regions referenced by the scored order checks" : "Expected elements and reading order"}</h3>
        </div>
        <span>
          {referenceOnly
            ? `${sortedExpectations.length.toLocaleString()} reference ${sortedExpectations.length === 1 ? "element" : "elements"}`
            : `${scoredCount.toLocaleString()} scored ${scoredCount === 1 ? "element" : "elements"}${ignoredCount > 0 ? ` · ${ignoredCount.toLocaleString()} reference only` : ""}`}
        </span>
      </div>
      <aside className="diagnostic-contract-note diagnostic-contract-note-compact">
        <strong>{referenceOnly ? "Visual context, not element-detection ground truth" : "How to read the coordinates"}</strong>
        <p>
          {referenceOnly
            ? "These regions ground the sequence checks shown in this view; this result does not evaluate their localization or classification. "
            : ""}
          Boxes are normalized to the page: x and y locate the top-left corner; w and h are width and height. Reading order is shown as a human-friendly 1-based position.
        </p>
      </aside>
      <div className="diagnostic-table-scroll">
        <table className="diagnostic-layout-table diagnostic-ground-truth-layout-table">
          <thead><tr><th>Element</th><th>Expected content</th><th>Bounding box (x, y, width, height)</th><th>Reading order</th></tr></thead>
          <tbody>
            {sortedExpectations.map((expectation) => {
              const rule = asRecord(expectation.rule) ?? {};
              const className = asString(rule.canonical_class) ?? asString(rule.source_label) ?? expectation.type;
              const readingOrder = asNumber(rule.ro_index);
              const ignored = referenceOnly || layoutExpectationIgnored(expectation);
              return (
                <tr className={ignored ? "diagnostic-layout-reference-row" : undefined} key={expectation.id}>
                  <th scope="row">
                    <strong>{humanize(className)}</strong>
                    {expectation.page != null && <small>Page {expectation.page}</small>}
                    {ignored && (
                      <span className="diagnostic-reference-label">
                        {referenceOnly ? "Reference only · not scored" : "Ignored by scoring"}
                      </span>
                    )}
                  </th>
                  <td>{layoutContentSummary(rule)}</td>
                  <td><code>{layoutBoxSummary(rule)}</code></td>
                  <td>{readingOrder == null ? "—" : (readingOrder + 1).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GroundTruthRule({
  expectation,
  impact,
}: {
  expectation: DiagnosticExpectation;
  impact: RuleImpact | null;
}) {
  const scalarEntry = singleScalarRuleEntry(expectation.rule);
  const title = (
    <span>
      <span className="diagnostic-rule-title">
        <strong>{humanize(expectation.type)}</strong>
        {impact && <RuleImpactLabel impact={impact} />}
      </span>
      <small>
        {scalarEntry
          ? `${humanize(scalarEntry[0])}: ${scalarDisplay(scalarEntry[1])}`
          : expectedRuleSummary(expectation.rule)}
      </small>
    </span>
  );
  const tags = expectation.tags?.length
    ? <em>{expectation.tags.join(" · ")}</em>
    : null;

  if (scalarEntry) {
    return (
      <div className="diagnostic-ground-truth-rule diagnostic-ground-truth-rule-static">
        {title}
        {tags && <span className="diagnostic-disclosure-meta">{tags}</span>}
      </div>
    );
  }

  return (
    <details className="diagnostic-ground-truth-rule">
      <summary>
        {title}
        <span className="diagnostic-disclosure-meta">
          {tags}
          <span className="diagnostic-disclosure-label">View rule details</span>
        </span>
      </summary>
      <pre><code>{JSON.stringify(expectation.rule, null, 2)}</code></pre>
    </details>
  );
}

function ExpectationGroups({
  expectations,
  groups,
  groupForType,
  eyebrow,
  heading,
  contract,
  impactForType,
}: {
  expectations: DiagnosticExpectation[];
  groups: readonly { key: string; label: string }[];
  groupForType: (type: string) => string;
  eyebrow: string;
  heading: string;
  contract?: ReactNode;
  impactForType?: (type: string) => RuleImpact;
}) {
  const [query, setQuery] = useState("");
  const [visibleLimits, setVisibleLimits] = useState<Record<string, number>>({});
  const normalizedQuery = query.trim().toLowerCase();
  const impactSections = (impactForType ? RULE_IMPACTS : [null]).map((impact) => ({
    impact,
    expectations: expectations.filter(
      (expectation) => impact == null || impactForType?.(expectation.type) === impact,
    ),
  }));
  const expectationMatchesQuery = (expectation: DiagnosticExpectation) =>
    !normalizedQuery || [
      expectation.type,
      expectedRuleSummary(expectation.rule),
      ...(expectation.tags ?? []),
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  const firstPopulatedGroup = impactSections.flatMap((section) =>
    groups.map((group) => ({
      key: `${section.impact ?? "all"}:${group.key}`,
      populated: section.expectations.some(
        (expectation) =>
          groupForType(expectation.type) === group.key && expectationMatchesQuery(expectation),
      ),
    })),
  ).find((group) => group.populated)?.key;
  return (
    <section className="diagnostic-dimension-view diagnostic-ground-truth-view">
      <div className="diagnostic-section-heading">
        <div><span className="diagnostic-eyebrow">{eyebrow}</span><h3>{heading}</h3></div>
        <span>{expectations.length.toLocaleString()} checks</span>
      </div>
      {contract && <aside className="diagnostic-contract-note diagnostic-contract-note-compact">{contract}</aside>}
      {expectations.length > 8 && (
        <div className="diagnostic-rule-toolbar diagnostic-ground-truth-toolbar">
          <input
            aria-label="Search ground-truth checks"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search ground truth"
          />
        </div>
      )}
      <div className="diagnostic-rule-groups">
        {impactSections.map((section) => {
          if (!section.expectations.some(expectationMatchesQuery)) return null;
          return (
            <div className={`diagnostic-impact-section${section.impact ? ` diagnostic-impact-section-${section.impact}` : ""}`} key={section.impact ?? "all"}>
              {section.impact && (
                <div className="diagnostic-impact-heading">
                  <strong>{section.impact === "headline" ? "Headline inputs" : "Supporting diagnostics"}</strong>
                  <span>{section.expectations.length.toLocaleString()} checks</span>
                </div>
              )}
              {groups.map((group) => {
                const groupKey = `${section.impact ?? "all"}:${group.key}`;
                const grouped = section.expectations
                  .filter((expectation) => groupForType(expectation.type) === group.key)
                  .filter(expectationMatchesQuery);
                if (!grouped.length) return null;
                const visibleLimit = visibleLimits[groupKey] ?? 60;
                const rendered = grouped.slice(0, visibleLimit);
                return (
                  <details className="diagnostic-rule-group" key={groupKey} open={Boolean(normalizedQuery) || groupKey === firstPopulatedGroup}>
                    <summary>
                      <span><strong>{group.label}</strong><small>{grouped.length.toLocaleString()} expected checks</small></span>
                    </summary>
                    <div className="diagnostic-rule-list">
                      {rendered.map((expectation) => (
                        <GroundTruthRule
                          expectation={expectation}
                          impact={section.impact}
                          key={expectation.id}
                        />
                      ))}
                      {rendered.length < grouped.length && (
                        <button
                          className="diagnostic-load-more"
                          type="button"
                          onClick={() => setVisibleLimits((current) => ({
                            ...current,
                            [groupKey]: visibleLimit + 60,
                          }))}
                        >
                          Show 60 more · {(grouped.length - rendered.length).toLocaleString()} remaining
                        </button>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HybridLayoutGroundTruth({ diagnostic }: { diagnostic: DiagnosticArtifact }) {
  const layoutExpectations = diagnostic.expectations.filter((expectation) => expectation.type === "layout");
  const scoredExpectations = diagnostic.expectations.filter((expectation) => expectation.type !== "layout");
  return (
    <div className="diagnostic-ground-truth-stack">
      <ExpectationGroups
        expectations={scoredExpectations}
        groups={[{ key: "order", label: "Scored reading-order checks" }]}
        groupForType={() => "order"}
        eyebrow="Reading-order ground truth"
        heading="Expected sequence between referenced regions"
        contract={(
          <>
            <strong>These are the scored expectations</strong>
            <p>Only these sequence checks contribute to this result’s headline score. The layout elements below provide supporting visual references.</p>
          </>
        )}
        impactForType={() => "headline"}
      />
      <LayoutGroundTruth diagnostic={diagnostic} expectations={layoutExpectations} referenceOnly />
    </div>
  );
}

export function GroundTruthInspector({
  dimension,
  diagnostic,
  fallbackMarkdown,
}: GroundTruthInspectorProps) {
  if (dimension === "table") {
    return <TableGroundTruth diagnostic={diagnostic} fallbackMarkdown={fallbackMarkdown} />;
  }
  if (!diagnostic) {
    return <EmptyDiagnostics message="No structured ground truth is available for this historical result." />;
  }
  if (dimension === "chart") return <ChartGroundTruth diagnostic={diagnostic} />;
  if (dimension === "layout") {
    return diagnosticUsesElementLayout(diagnostic)
      ? <LayoutGroundTruth diagnostic={diagnostic} />
      : <HybridLayoutGroundTruth diagnostic={diagnostic} />;
  }
  if (dimension === "text_content") {
    return (
      <ExpectationGroups
        expectations={diagnostic.expectations}
        groups={TEXT_GROUPS}
        groupForType={textGroup}
        eyebrow="Text-content ground truth"
        heading="Expected content, completeness and order"
        contract={(
          <>
            <strong>Ground truth and score contribution</strong>
            <p>Headline-input badges identify expectations used by Content Faithfulness; supporting checks remain visible for diagnosis.</p>
          </>
        )}
        impactForType={(type) => ruleImpact(diagnostic, type)}
      />
    );
  }
  if (dimension === "text_formatting") {
    return (
      <ExpectationGroups
        expectations={diagnostic.expectations}
        groups={FORMATTING_GROUPS}
        groupForType={formattingGroup}
        eyebrow="Formatting ground truth"
        heading="Expected semantic formatting"
        contract={(
          <>
            <strong>Ground truth and score contribution</strong>
            <p>Headline-input badges identify expectations used by this result’s primary formatting metric; the others are supporting checks.</p>
          </>
        )}
        impactForType={(type) => ruleImpact(diagnostic, type)}
      />
    );
  }
  return (
    <ExpectationGroups
      expectations={diagnostic.expectations}
      groups={[{ key: "all", label: "Expected checks" }]}
      groupForType={() => "all"}
      eyebrow="Ground truth"
      heading="Expected evaluation checks"
    />
  );
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
  const elementLayout = props.diagnostic.dimension === "layout" &&
    diagnosticUsesElementLayout(props.diagnostic);
  const items = buildEvidenceItems(props.diagnostic).filter((item) =>
    props.diagnostic.dimension !== "layout" || elementLayout || item.type !== "layout",
  );
  let detail: ReactNode;
  switch (props.diagnostic.dimension) {
    case "table":
      detail = <TableDiagnostic {...props} />;
      break;
    case "chart":
      detail = <ChartDiagnostic {...props} />;
      break;
    case "layout":
      detail = elementLayout
        ? <LayoutDiagnostic {...props} />
        : <HybridLayoutDiagnostic {...props} />;
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
