"use client";

import { useMemo } from "react";

import {
  asRecord,
  asString,
  buildEvidenceItems,
  evidenceStatus,
  outcomeReceivedNoMarkdown,
  statusCounts,
  type DiagnosticInspectorProps,
  type EvidenceItem,
} from "./model";
import { EmptyDiagnostics } from "./primitives";
import { RuleGroups } from "./rule-groups";
import {
  FORMATTING_GROUPS,
  TEXT_GROUPS,
  formattingFacetForType,
  formattingGroup,
  ruleImpact,
  textFacetForType,
  textGroup,
} from "./rule-model";
import { TextBagComparison } from "./text-bag-comparison";
import { specificTextEvidence, textBagDefinition } from "./text-bag-model";

function EvidenceOverview({
  items,
  symbol,
  title,
  description,
  headingId,
}: {
  items: EvidenceItem[];
  symbol: string;
  title: string;
  description: string;
  headingId: string;
}) {
  const counts = statusCounts(items);
  const attention = counts.failed + counts.partial + counts.unknown;
  return (
    <header className="evidence-workspace-heading">
      <div className="evidence-heading-main">
        <span className="evidence-dimension-symbol" aria-hidden="true">
          {symbol}
        </span>
        <div>
          <span className="evidence-kicker">Document evidence</span>
          <h3 id={headingId}>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      <dl
        className="evidence-overview-counts"
        aria-label="Retained check results"
      >
        <div>
          <dt>Checks retained</dt>
          <dd>{items.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Passed</dt>
          <dd>{counts.passed.toLocaleString()}</dd>
        </div>
        <div className={attention ? "evidence-count-attention" : ""}>
          <dt>Need attention</dt>
          <dd>{attention.toLocaleString()}</dd>
        </div>
      </dl>
      {counts.unknown > 0 && (
        <p className="evidence-overview-note">
          Includes {counts.unknown.toLocaleString()} checks with an unknown
          result.
        </p>
      )}
    </header>
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
  if (item.type !== "is_underline" || evidenceStatus(item.outcome) !== "failed")
    return null;
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

export function TextDiagnostic(props: DiagnosticInspectorProps) {
  const items = useMemo(
    () => buildEvidenceItems(props.diagnostic),
    [props.diagnostic],
  );
  const specificEvidence = useMemo(() => specificTextEvidence(items), [items]);
  return items.length ? (
    <section
      className="diagnostic-dimension-view diagnostic-text-view evidence-workspace evidence-text-workspace"
      aria-labelledby="diagnostic-text-heading"
    >
      <EvidenceOverview
        items={items}
        symbol="Aa"
        headingId="diagnostic-text-heading"
        title="Completeness, accuracy and order"
        description="Follow every word from the reference to the extracted content."
      />
      <details className="evidence-scoring-note">
        <summary>How content checks contribute to the score</summary>
        <p>
          Content completeness, unexpected content, duplicates, digits, and
          reading order feed Content Faithfulness. Other checks remain visible
          as supporting diagnostics. If this result uses Rule Pass Rate as its
          primary metric, every displayed rule contributes instead.
        </p>
      </details>
      {items.some((item) => outcomeReceivedNoMarkdown(item.outcome)) && (
        <aside className="diagnostic-contract-note diagnostic-contract-note-compact evidence-input-alert">
          <strong>
            {props.actualMarkdownState === "empty"
              ? "Parser returned empty Markdown"
              : props.actualMarkdownState === "not_retained"
                ? "Markdown was not retained"
                : "Evaluator received no Markdown"}
          </strong>
          {props.actualMarkdownState !== "empty" && (
            <p>
              {props.actualMarkdownState === "not_retained"
                ? "The evaluator received no Markdown and the result artifact has no Markdown field. The dashboard cannot determine whether extraction was empty or the output was lost before serialization."
                : "The diagnostic records that no Markdown was provided to the evaluator. Required-content checks therefore failed with zero coverage."}
            </p>
          )}
        </aside>
      )}
      <RuleGroups
        items={items}
        groups={TEXT_GROUPS}
        groupForType={textGroup}
        selectedEvidenceId={props.selectedEvidenceId}
        onSelectEvidence={props.onSelectEvidence}
        impactForType={(type) => ruleImpact(props.diagnostic, type)}
        facetForType={textFacetForType}
        detailForItem={(item) => {
          const definition = textBagDefinition(item);
          return definition ? (
            <TextBagComparison
              definition={definition}
              item={item}
              specificEvidence={specificEvidence}
              markdownState={props.actualMarkdownState}
            />
          ) : null;
        }}
      />
    </section>
  ) : (
    <EmptyDiagnostics message="No text-content rule outcomes were retained for this result." />
  );
}

export function FormattingDiagnostic(props: DiagnosticInspectorProps) {
  const items = buildEvidenceItems(props.diagnostic);
  return items.length ? (
    <section
      className="diagnostic-dimension-view diagnostic-formatting-view evidence-workspace evidence-formatting-workspace"
      aria-labelledby="diagnostic-formatting-heading"
    >
      <EvidenceOverview
        items={items}
        symbol="B𝑖"
        headingId="diagnostic-formatting-heading"
        title="Semantic formatting checks"
        description="See whether structure, emphasis and meaning survived extraction."
      />
      <details className="evidence-scoring-note">
        <summary>Headline formatting and supporting checks</summary>
        <p>
          {props.diagnostic.primary_metric?.name === "rule_pass_rate"
            ? "This historical result uses Rule Pass Rate, so every displayed formatting rule contributes to the headline."
            : "The badges below identify which rules feed this result’s primary metric. In Semantic Formatting, title, bold, strikeout, superscript, subscript, LaTeX, and code categories contribute; underline, italic, and mark checks in historical artifacts are supporting diagnostics."}
        </p>
      </details>
      <RuleGroups
        items={items}
        groups={FORMATTING_GROUPS}
        groupForType={formattingGroup}
        selectedEvidenceId={props.selectedEvidenceId}
        onSelectEvidence={props.onSelectEvidence}
        impactForType={(type) => ruleImpact(props.diagnostic, type)}
        facetForType={formattingFacetForType}
        advisoryForItem={(item) =>
          underlineSpanAdvisory(item, props.actualMarkdown)
        }
      />
    </section>
  ) : (
    <EmptyDiagnostics message="No formatting-rule outcomes were retained for this result." />
  );
}
