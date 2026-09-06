"use client";

import { useState } from "react";

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

function subcheckStatus(
  outcome: DiagnosticOutcome,
  key: string,
  applicable = true,
): EvidenceStatus {
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

function layoutMatchDetail(
  outcome: DiagnosticOutcome,
  kind: "localization" | "classification" | "attribution" | "order",
) {
  if (kind === "localization") {
    const values = [
      asNumber(outcome.best_pred_iou) != null
        ? `IoU ${scorePercent(asNumber(outcome.best_pred_iou))}`
        : null,
      asNumber(outcome.best_pred_ioa_gt) != null
        ? `GT overlap ${scorePercent(asNumber(outcome.best_pred_ioa_gt))}`
        : null,
    ].filter(Boolean);
    return (
      values.join(" · ") || humanize(asString(outcome.localization_reason))
    );
  }
  if (kind === "classification") {
    const expected =
      asString(outcome.gt_class) ?? asString(outcome.gt_class_norm);
    const predicted =
      asString(outcome.best_pred_class) ??
      asString(outcome.best_pred_class_norm);
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
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [query, setQuery] = useState("");
  const outcomes = diagnosticOutcomes(diagnostic);
  const categoryMetrics = [
    [
      "Localization",
      "layout_localization_pass_rate",
      "Find the right region",
      "localization",
    ],
    [
      "Classification",
      "layout_classification_pass_rate",
      "Recognize its purpose",
      "classification",
    ],
    [
      "Attribution",
      "layout_attribution_pass_rate",
      "Match its content",
      "attribution",
    ],
  ] as const;
  const readingOrderMetric = metricByName(
    diagnostic.metrics,
    "layout_reading_order_pass_rate",
  );
  const attention = outcomes.filter(
    (outcome) => layoutElementHeadlineStatus(outcome) !== "passed",
  ).length;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOutcomes = outcomes
    .map((outcome, index) => ({ outcome, index }))
    .filter(({ outcome }) => {
      if (onlyAttention && layoutElementHeadlineStatus(outcome) === "passed")
        return false;
      return (
        !normalizedQuery ||
        [
          outcome.gt_class,
          outcome.gt_class_norm,
          outcome.best_pred_class,
          outcome.localization_reason,
          outcome.classification_reason,
          outcome.attribution_reason,
        ].some((value) =>
          asString(value)?.toLowerCase().includes(normalizedQuery),
        )
      );
    });
  return (
    <div className="diagnostic-dimension-view diagnostic-layout-view evidence-workspace evidence-layout-workspace">
      <header className="evidence-workspace-heading">
        <div className="evidence-heading-main">
          <span className="evidence-dimension-symbol" aria-hidden="true">
            ▥
          </span>
          <div>
            <span className="evidence-kicker">Layout evidence</span>
            <h3>Locate. Classify. Attribute.</h3>
            <p>
              Follow each source region through the three stages of element
              matching.
            </p>
          </div>
        </div>
      </header>
      <dl
        className="diagnostic-layout-summary layout-stage-pipeline"
        aria-label="Layout evaluation stages"
      >
        {categoryMetrics.map(([label, name, description], index) => {
          const metric = metricByName(diagnostic.metrics, name);
          return (
            <div key={name}>
              <dt>
                <span className="layout-stage-number">0{index + 1}</span>
                {label}
              </dt>
              <dd>{scorePercent(metric?.value)}</dd>
              <span className="layout-stage-track" aria-hidden="true">
                <span
                  style={{
                    width: `${Math.max(0, Math.min(1, metric?.value ?? 0)) * 100}%`,
                  }}
                />
              </span>
              <strong>{description}</strong>
              <small>
                {layoutMetricCount(metric) ?? "Stage count not retained"}
              </small>
            </div>
          );
        })}
      </dl>
      <details className="evidence-scoring-note">
        <summary>How an element passes</summary>
        <p>
          Localization and classification must pass, plus content attribution
          when it applies. This is an all-required decision for each element,
          not an average of the three stage percentages.
        </p>
      </details>
      <div className="diagnostic-layout-order-summary layout-order-card">
        <span className="layout-order-symbol" aria-hidden="true">
          ↳
        </span>
        <div>
          <span className="evidence-kicker">Separate diagnostic</span>
          <strong>Reading order</strong>
          <p>
            Reported after matching; it does not change the element headline
            score.
          </p>
        </div>
        <div>
          <strong>{scorePercent(readingOrderMetric?.value)}</strong>
          {layoutMetricCount(readingOrderMetric) && (
            <small>{layoutMetricCount(readingOrderMetric)}</small>
          )}
        </div>
      </div>
      {outcomes.length ? (
        <section
          className="layout-elements"
          aria-labelledby="diagnostic-layout-elements-heading"
        >
          <div className="evidence-browser-header">
            <div>
              <span className="evidence-kicker">Element by element</span>
              <h3 id="diagnostic-layout-elements-heading">
                Ground truth matched to output
              </h3>
            </div>
            <span>
              {outcomes.length.toLocaleString()} elements ·{" "}
              {attention.toLocaleString()} need attention
            </span>
          </div>
          <div className="diagnostic-rule-toolbar evidence-check-toolbar">
            <input
              aria-label="Search layout elements"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Find an element or matching reason…"
            />
            <div
              className="mode-toggle"
              role="group"
              aria-label="Layout element status filter"
            >
              <button
                type="button"
                aria-pressed={onlyAttention}
                className={onlyAttention ? "mode-active" : ""}
                onClick={() => setOnlyAttention(true)}
              >
                Needs attention
              </button>
              <button
                type="button"
                aria-pressed={!onlyAttention}
                className={!onlyAttention ? "mode-active" : ""}
                onClick={() => setOnlyAttention(false)}
              >
                All
              </button>
            </div>
          </div>
          <div className="layout-element-list">
            {visibleOutcomes.length ? (
              visibleOutcomes.map(({ outcome, index }) => {
                const id = outcomeId(outcome, index);
                const expectedClass =
                  asString(outcome.gt_class) ??
                  asString(outcome.gt_class_norm) ??
                  "Element";
                const predictedClass =
                  asString(outcome.best_pred_class) ?? "No matched block";
                const overall = layoutElementHeadlineStatus(outcome);
                const attributionApplicable =
                  outcome.attribution_applicable === true;
                return (
                  <article
                    className={`layout-element-card layout-element-${overall}${selectedEvidenceId === id ? " layout-element-selected" : ""}`}
                    key={id}
                  >
                    <EvidenceButton
                      id={id}
                      selected={selectedEvidenceId === id}
                      onSelect={onSelectEvidence}
                      className="diagnostic-evidence-trigger layout-element-select"
                    >
                      <span
                        className="layout-element-number"
                        aria-hidden="true"
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="layout-element-match">
                        <span>
                          <small>Expected region</small>
                          <strong>{humanize(expectedClass)}</strong>
                        </span>
                        <span className="layout-match-arrow" aria-hidden="true">
                          →
                        </span>
                        <span>
                          <small>Matched output</small>
                          <strong>
                            {predictedClass === "No matched block"
                              ? predictedClass
                              : humanize(predictedClass)}
                          </strong>
                        </span>
                      </span>
                      <span className="layout-element-overall">
                        <StatusPill status={overall} />
                        {onSelectEvidence && <small>Locate on source ↗</small>}
                      </span>
                    </EvidenceButton>
                    <div className="layout-element-stages">
                      {categoryMetrics.map(([label, , , kind], stageIndex) => {
                        const applicable =
                          kind !== "attribution" || attributionApplicable;
                        return (
                          <div key={kind}>
                            <span className="layout-element-stage-label">
                              <span aria-hidden="true">0{stageIndex + 1}</span>
                              {label}
                            </span>
                            <StatusPill
                              status={subcheckStatus(
                                outcome,
                                `${kind}_pass`,
                                applicable,
                              )}
                              label={applicable ? undefined : "Not scored"}
                            />
                            <p>{layoutMatchDetail(outcome, kind)}</p>
                          </div>
                        );
                      })}
                    </div>
                    <div className="layout-element-order">
                      <span>
                        <span aria-hidden="true">↳</span> Reading order{" "}
                        <small>Supporting check</small>
                      </span>
                      <StatusPill
                        status={subcheckStatus(
                          outcome,
                          "reading_order_pass",
                          outcome.reading_order_eligible === true,
                        )}
                        label={
                          outcome.reading_order_eligible === true
                            ? undefined
                            : "Not scored"
                        }
                      />
                      <span>{layoutMatchDetail(outcome, "order")}</span>
                    </div>
                  </article>
                );
              })
            ) : (
              <EmptyDiagnostics
                title="No matching elements"
                message="Try another search term or show all elements."
              />
            )}
          </div>
        </section>
      ) : (
        <EmptyDiagnostics message="No element-level layout evidence was retained for this result." />
      )}
    </div>
  );
}

export function HybridLayoutDiagnostic(props: DiagnosticInspectorProps) {
  const scoredItems = buildEvidenceItems(props.diagnostic).filter(
    (item) => item.type !== "layout",
  );
  const referenceCount = props.diagnostic.expectations.filter(
    (expectation) => expectation.type === "layout",
  ).length;
  return (
    <div className="diagnostic-dimension-view diagnostic-layout-order-view evidence-workspace evidence-layout-workspace">
      <header className="evidence-workspace-heading">
        <div className="evidence-heading-main">
          <span className="evidence-dimension-symbol" aria-hidden="true">
            ↳
          </span>
          <div>
            <span className="evidence-kicker">Reading-order evidence</span>
            <h3>Follow the document’s sequence.</h3>
            <p>
              Compare the expected flow between source regions with the
              extracted reading order.
            </p>
          </div>
        </div>
        <dl className="evidence-overview-counts">
          <div>
            <dt>Scored sequence checks</dt>
            <dd>{scoredItems.length.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Source references</dt>
            <dd>{referenceCount.toLocaleString()}</dd>
          </div>
        </dl>
      </header>
      <aside className="diagnostic-contract-note evidence-input-alert">
        <strong>
          This is a reading-order evaluation with layout references
        </strong>
        <p>
          The {referenceCount.toLocaleString()} layout annotations identify
          regions on the source page, but they are not scored as detected
          elements in this result. Only the{" "}
          {scoredItems.length.toLocaleString()} reading-order{" "}
          {scoredItems.length === 1 ? "check contributes" : "checks contribute"}{" "}
          to the headline.
        </p>
      </aside>
      {scoredItems.length ? (
        <section aria-labelledby="diagnostic-layout-order-heading">
          <div className="diagnostic-section-heading">
            <div>
              <span className="diagnostic-eyebrow">Scored evidence</span>
              <h3 id="diagnostic-layout-order-heading">
                Expected sequence in extracted content
              </h3>
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
      ) : (
        <EmptyDiagnostics message="No scored reading-order outcomes were retained for this result." />
      )}
    </div>
  );
}
