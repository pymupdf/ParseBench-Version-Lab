import { layoutElementHeadlineStatus } from "./semantics";
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
  actualMarkdownState?: "present" | "empty" | "not_retained" | "unknown";
  selectedEvidenceId?: string | null;
  onSelectEvidence?: (evidenceId: string) => void;
};

export type EvidenceStatus = "passed" | "partial" | "failed" | "unknown";

export type EvidenceItem = {
  id: string;
  type: string;
  page: number | null;
  expectation: DiagnosticExpectation | null;
  outcome: DiagnosticOutcome | null;
};

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is Record<string, unknown> => item != null)
    : [];
}

export function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function humanize(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value
    .replace(/^avg_/, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function scorePercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en", {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(value);
}

export function scalarDisplay(value: unknown): string {
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

export function metricComponents(value: unknown): DiagnosticMetricComponent[] {
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

export function formulaDetails(formula: unknown) {
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

export function metricContract(diagnostic: DiagnosticArtifact) {
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

export function isTableRecordSummary(diagnostic: DiagnosticArtifact) {
  return asString(diagnostic.summary.source)?.startsWith("table_record_match") === true;
}

export function outcomeId(outcome: DiagnosticOutcome, index: number) {
  return asString(outcome.id) ?? asString(outcome.rule_id) ??
    asString(outcome.element_id) ?? `outcome-${index + 1}`;
}

export function evidenceStatus(outcome: DiagnosticOutcome | null): EvidenceStatus {
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

export function outcomeExplanation(outcome: DiagnosticOutcome | null) {
  return asString(outcome?.explanation) ?? asString(outcome?.reason) ??
    asString(outcome?.note);
}

export function outcomeReceivedNoMarkdown(outcome: DiagnosticOutcome | null) {
  return /^No markdown content provided\.?$/iu.test(outcomeExplanation(outcome) ?? "");
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

export function diagnosticOutcomes(diagnostic: DiagnosticArtifact) {
  return diagnostic.outcomes?.length
    ? diagnostic.outcomes
    : metricRuleOutcomes(diagnostic.metrics);
}

export function buildEvidenceItems(diagnostic: DiagnosticArtifact): EvidenceItem[] {
  const outcomes = diagnosticOutcomes(diagnostic);
  const outcomesById = new Map<string, DiagnosticOutcome>();
  outcomes.forEach((outcome) => {
    for (const identifier of [outcome.id, outcome.rule_id, outcome.element_id]) {
      const id = asString(identifier);
      if (id) outcomesById.set(id, outcome);
    }
  });

  // Reserve explicit matches before considering historical outcomes that lack
  // identifiers. A missing first outcome must never borrow the second rule's
  // result and display the same pass/fail evidence twice.
  const used = new Set<DiagnosticOutcome>();
  const explicitMatches = diagnostic.expectations.map((expectation) => {
    const outcome = outcomesById.get(expectation.id) ?? null;
    if (!outcome || used.has(outcome)) return null;
    used.add(outcome);
    return outcome;
  });
  const items: EvidenceItem[] = diagnostic.expectations.map((expectation, index) => {
    let outcome = explicitMatches[index];
    if (!outcome) {
      const samePosition = outcomes[index];
      if (
        samePosition &&
        !used.has(samePosition) &&
        ![samePosition.id, samePosition.rule_id, samePosition.element_id].some(asString) &&
        (!samePosition.type || samePosition.type === expectation.type) &&
        (samePosition.page == null || expectation.page == null || samePosition.page === expectation.page)
      ) {
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

export function statusCounts(items: EvidenceItem[]) {
  return items.reduce(
    (counts, item) => {
      counts[evidenceStatus(item.outcome)] += 1;
      return counts;
    },
    { passed: 0, partial: 0, failed: 0, unknown: 0 } satisfies Record<EvidenceStatus, number>,
  );
}
