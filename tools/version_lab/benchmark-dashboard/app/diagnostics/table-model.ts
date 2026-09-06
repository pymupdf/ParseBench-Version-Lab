import { asNumber, asRecord, asString, metricComponents } from "./model";
import type { DiagnosticArtifact } from "./types";

export type TableScoreBreakdown = {
  mode: "combined" | "grits_only" | "unknown";
  gritsScore: number | null;
  trmScore: number | null;
  gritsWeight: number | null;
  trmWeight: number | null;
  fallbackReason: string | null;
};

export function tableScoreBreakdown(diagnostic: DiagnosticArtifact): TableScoreBreakdown {
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

export function tableFallbackExplanation(reason: string | null) {
  if (reason === "trm_unsupported") {
    return "Record matching is not reliable for this document’s table structure, so the benchmark excludes it from the headline score.";
  }
  if (reason === "trm_missing") {
    return "No table-record match score was produced for this result, so the benchmark excludes it from the headline score.";
  }
  return "The diagnostic artifact marks table-record matching as unavailable, so the headline score uses grid/content similarity alone.";
}
