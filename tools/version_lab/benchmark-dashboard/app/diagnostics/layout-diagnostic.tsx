"use client";

import {
  asNumber,
  asString,
  buildEvidenceItems,
  diagnosticOutcomes,
  humanize,
  outcomeId,
  scorePercent,
  type DiagnosticInspectorProps,
  type EvidenceStatus,
} from "./model";
import { EmptyDiagnostics, EvidenceButton, StatusPill } from "./primitives";
import { RuleGroups } from "./rule-groups";
import { layoutElementHeadlineStatus } from "./semantics";
import type { DiagnosticMetric, DiagnosticOutcome } from "./types";

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

export function LayoutDiagnostic({
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

export function HybridLayoutDiagnostic(props: DiagnosticInspectorProps) {
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
