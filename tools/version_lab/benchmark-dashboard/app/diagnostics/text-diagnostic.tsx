"use client";

import { useMemo } from "react";

import {
  asRecord,
  asString,
  buildEvidenceItems,
  evidenceStatus,
  outcomeReceivedNoMarkdown,
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

export function TextDiagnostic(props: DiagnosticInspectorProps) {
  const items = useMemo(
    () => buildEvidenceItems(props.diagnostic),
    [props.diagnostic],
  );
  const specificEvidence = useMemo(
    () => specificTextEvidence(items),
    [items],
  );
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
          Faithfulness. Other checks remain visible as supporting diagnostics. If this result uses
          Rule Pass Rate as its primary metric, every displayed rule contributes instead.
        </p>
      </aside>
      {items.some((item) => outcomeReceivedNoMarkdown(item.outcome)) && (
        <aside className="diagnostic-contract-note diagnostic-contract-note-compact">
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
          return definition
            ? <TextBagComparison
                definition={definition}
                item={item}
                specificEvidence={specificEvidence}
                markdownState={props.actualMarkdownState}
              />
            : null;
        }}
      />
    </section>
  ) : <EmptyDiagnostics message="No text-content rule outcomes were retained for this result." />;
}

export function FormattingDiagnostic(props: DiagnosticInspectorProps) {
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
        facetForType={formattingFacetForType}
        advisoryForItem={(item) => underlineSpanAdvisory(item, props.actualMarkdown)}
      />
    </section>
  ) : <EmptyDiagnostics message="No formatting-rule outcomes were retained for this result." />;
}
