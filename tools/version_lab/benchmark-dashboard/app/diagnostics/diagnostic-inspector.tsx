"use client";

import type { ReactNode } from "react";

import { ChartDiagnostic } from "./chart-diagnostic";
import { HybridLayoutDiagnostic, LayoutDiagnostic } from "./layout-diagnostic";
import {
  buildEvidenceItems,
  evidenceStatus,
  humanize,
  outcomeExplanation,
  type DiagnosticInspectorProps,
} from "./model";
import { EmptyDiagnostics, EvidenceButton, StatusPill } from "./primitives";
import { expectedRuleSummary } from "./rule-model";
import { PrimaryMetricSummary } from "./score-summary";
import { diagnosticUsesElementLayout } from "./semantics";
import { TableDiagnostic } from "./table-diagnostic";
import { FormattingDiagnostic, TextDiagnostic } from "./text-diagnostic";

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

export { GroundTruthInspector } from "./ground-truth";
