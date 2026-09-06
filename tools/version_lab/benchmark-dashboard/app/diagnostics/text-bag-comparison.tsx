"use client";

import { useState } from "react";

import {
  evidenceStatus,
  outcomeExplanation,
  outcomeReceivedNoMarkdown,
  scorePercent,
  type DiagnosticInspectorProps,
  type EvidenceItem,
  type EvidenceStatus,
} from "./model";
import { StatusPill } from "./primitives";
import {
  comparisonMatchesTarget,
  normalizedComparisonTarget,
  retainedTextComparisons,
  specificMatcherStatus,
  textBagNoun,
  type TextBagDefinition,
} from "./text-bag-model";

const TEXT_BAG_INITIAL_ROWS = 20;

const TEXT_BAG_PAGE_SIZE = 60;

export function TextBagComparison({
  definition,
  item,
  specificEvidence,
  markdownState,
}: {
  definition: TextBagDefinition;
  item: EvidenceItem;
  specificEvidence: Map<string, EvidenceItem[]>;
  markdownState: DiagnosticInspectorProps["actualMarkdownState"];
}) {
  const retained = retainedTextComparisons(item.outcome);
  const explanation = outcomeExplanation(item.outcome);
  const unexpectedRows = definition.mode === "unexpected" ? retained : [];
  const rowCount =
    definition.mode === "unexpected"
      ? unexpectedRows.length
      : definition.entries.length;
  const [open, setOpen] = useState(
    evidenceStatus(item.outcome) !== "passed" && rowCount <= 10,
  );
  const [visible, setVisible] = useState(TEXT_BAG_INITIAL_ROWS);
  const aggregateStatus = evidenceStatus(item.outcome);
  const noMarkdownProvided = outcomeReceivedNoMarkdown(item.outcome);
  const visibleUnexpected = unexpectedRows.slice(0, visible);
  const visibleEntries = definition.entries.slice(0, visible);
  const noun = textBagNoun(definition.kind, rowCount);
  const comparisonLabel =
    definition.mode === "unexpected"
      ? `${rowCount.toLocaleString()} retained unexpected ${noun}`
      : definition.mode === "maximum"
        ? `${definition.entries.length.toLocaleString()} ${noun} with occurrence limits`
        : definition.kind === "digit"
          ? `${definition.entries.length.toLocaleString()} expected digit ${definition.entries.length === 1 ? "count" : "counts"}`
          : `${definition.entries.length.toLocaleString()} expected ${noun}`;

  return (
    <details
      className="diagnostic-text-comparison evidence-text-audit"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>
          <small className="evidence-kicker">
            {definition.mode === "unexpected"
              ? "Unexpected content"
              : definition.mode === "maximum"
                ? "Occurrence limits"
                : "Reference coverage"}
          </small>
          <strong>{comparisonLabel}</strong>
        </span>
        <span className="evidence-audit-expand">
          {open ? "Close comparison" : "Compare content"}
          <span aria-hidden="true">{open ? "−" : "+"}</span>
        </span>
      </summary>
      {open &&
        definition.mode === "unexpected" &&
        (noMarkdownProvided ? (
          <p className="diagnostic-text-comparison-empty">
            {markdownState === "empty"
              ? "The parser returned an explicitly empty Markdown result, so the evaluator had no content to inspect for unexpected text."
              : markdownState === "not_retained"
                ? "The evaluator received no Markdown, and the result artifact does not retain a Markdown field. Whether extraction was empty or lost before serialization cannot be determined here."
                : "The evaluator received no Markdown, so it could not inspect the output for unexpected text."}
          </p>
        ) : unexpectedRows.length ? (
          <>
            <p className="diagnostic-text-comparison-note">
              These are normalized {textBagNoun(definition.kind, 2)} that the
              evaluator did not recognize in the reference content. Only
              examples retained in the artifact are shown; the complete
              extraction remains available in the Output tab.
            </p>
            <div className="diagnostic-text-comparison-table evidence-content-list">
              {visibleUnexpected.map((comparison, index) => (
                <article
                  className="evidence-content-card evidence-content-failed"
                  key={`${comparison.target}-${index}`}
                >
                  <div className="evidence-content-heading">
                    <span className="evidence-kicker">
                      Evaluator-observed text
                    </span>
                    <StatusPill status="failed" />
                  </div>
                  <blockquote>{comparison.target}</blockquote>
                  <dl className="evidence-content-counts">
                    <div>
                      <dt>Expected condition</dt>
                      <dd>No unexpected content</dd>
                    </div>
                    <div>
                      <dt>Occurrences in output</dt>
                      <dd>{comparison.actualCount.toLocaleString()}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="diagnostic-text-comparison-empty">
            {aggregateStatus === "passed"
              ? "No unexpected extracted content was detected."
              : "The artifact does not retain individual unexpected-content examples for this rule."}
          </p>
        ))}
      {open && definition.mode === "maximum" && noMarkdownProvided && (
        <p className="diagnostic-text-comparison-empty">
          No per-key maximum comparison was performed because the evaluator
          received no Markdown. The rule-level 0% is an input-availability
          failure, not evidence that any individual occurrence limit was
          exceeded.
        </p>
      )}
      {open &&
        definition.mode !== "unexpected" &&
        !(definition.mode === "maximum" && noMarkdownProvided) && (
          <>
            <p className="diagnostic-text-comparison-note">
              {definition.kind === "digit" ? (
                <>
                  This check counts each individual digit character in the
                  extracted Markdown. For example, &ldquo;32&rdquo; contributes
                  one 3 and one 2. Expected counts come from the ground-truth
                  Markdown, and coverage is the output count divided by the
                  expected count. The diagnostic reports deficient counts;
                  &ldquo;Not reported&rdquo; does not mean the digit was absent.
                </>
              ) : (
                <>
                  {definition.kind === "sentence" &&
                    "This is an unordered coverage check; reading order is evaluated separately. "}
                  Expected content comes from the ground-truth Markdown. The
                  evaluator normalizes and may combine equivalent entries before
                  scoring. The aggregate percentage above is authoritative;
                  exact output counts are shown only when retained in the
                  diagnostic artifact.
                </>
              )}
            </p>
            <div
              className={`diagnostic-text-comparison-table evidence-content-list evidence-content-${definition.kind}`}
            >
              {visibleEntries.map((entry) => {
                const retainedMatches = retained.filter((comparison) =>
                  comparisonMatchesTarget(comparison, entry.target),
                );
                const retainedComparison =
                  retainedMatches.length === 1 &&
                  definition.entries.filter((candidate) =>
                    comparisonMatchesTarget(
                      retainedMatches[0]!,
                      candidate.target,
                    ),
                  ).length === 1
                    ? retainedMatches[0]!
                    : null;
                const specificKey = `${item.page ?? "all"}:${definition.kind}:${normalizedComparisonTarget(entry.target)}`;
                const specificCandidates =
                  definition.mode === "missing" && definition.kind !== "digit"
                    ? (specificEvidence.get(specificKey) ?? [])
                    : [];
                const specific =
                  specificCandidates.length === 1
                    ? specificCandidates[0]!
                    : null;
                const specificStatus = specificMatcherStatus(specific);
                const actualCount = retainedComparison?.actualCount ?? null;
                const evaluatorCount =
                  retainedComparison?.expectedCount ?? entry.count;
                let status: EvidenceStatus = "unknown";
                let statusLabel: string | undefined;
                let extractedEvidence = "Not reported";
                let coverage: number | null = null;

                if (actualCount != null) {
                  if (definition.mode === "maximum") {
                    status =
                      actualCount <= evaluatorCount ? "passed" : "failed";
                    coverage =
                      actualCount <= evaluatorCount
                        ? 1
                        : evaluatorCount / Math.max(actualCount, 1);
                  } else {
                    status =
                      actualCount >= evaluatorCount
                        ? "passed"
                        : actualCount > 0
                          ? "partial"
                          : "failed";
                    coverage =
                      evaluatorCount > 0
                        ? Math.min(actualCount, evaluatorCount) / evaluatorCount
                        : 1;
                  }
                  extractedEvidence = actualCount.toLocaleString();
                } else if (aggregateStatus === "passed") {
                  status = "passed";
                  coverage = 1;
                  extractedEvidence =
                    definition.mode === "maximum"
                      ? "Within limit"
                      : `At least ${evaluatorCount.toLocaleString()}`;
                } else if (
                  noMarkdownProvided &&
                  definition.mode === "missing"
                ) {
                  status = "failed";
                  coverage = 0;
                  extractedEvidence = "0";
                } else if (specificStatus === "failed") {
                  status = "failed";
                  coverage = 0;
                  extractedEvidence = "0";
                } else if (specificStatus === "passed" && entry.count === 1) {
                  status = "passed";
                  coverage = 1;
                  extractedEvidence = "At least 1";
                } else if (specificStatus === "passed") {
                  status = "unknown";
                  statusLabel = "Not reported";
                  extractedEvidence = "At least 1";
                } else {
                  statusLabel = "Not reported";
                }

                return (
                  <article
                    className={`evidence-content-card evidence-content-${status}`}
                    key={entry.target}
                  >
                    <div className="evidence-content-heading">
                      <span className="evidence-kicker">
                        {definition.mode === "maximum"
                          ? `Limited ${definition.kind}`
                          : `Expected ${definition.kind}`}
                      </span>
                      <StatusPill status={status} label={statusLabel} />
                    </div>
                    <blockquote>{entry.target}</blockquote>
                    <dl className="evidence-content-counts">
                      <div>
                        <dt>
                          {definition.mode === "maximum"
                            ? "Allowed count"
                            : "Expected count"}
                        </dt>
                        <dd>{evaluatorCount.toLocaleString()}</dd>
                        {evaluatorCount !== entry.count && (
                          <small>
                            {entry.count.toLocaleString()} in the source rule
                          </small>
                        )}
                      </div>
                      <div>
                        <dt>Found in output</dt>
                        <dd>{extractedEvidence}</dd>
                      </div>
                      <div>
                        <dt>
                          {definition.mode === "maximum"
                            ? "Compliance"
                            : "Coverage"}
                        </dt>
                        <dd>{scorePercent(coverage)}</dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
          </>
        )}
      {open && visible < rowCount && (
        <button
          className="diagnostic-load-more"
          type="button"
          onClick={() => setVisible((current) => current + TEXT_BAG_PAGE_SIZE)}
        >
          Show{" "}
          {Math.min(TEXT_BAG_PAGE_SIZE, rowCount - visible).toLocaleString()}{" "}
          more · {(rowCount - visible).toLocaleString()} remaining
        </button>
      )}
      {open && explanation && (
        <details className="diagnostic-text-evaluator-note">
          <summary>Evaluator note</summary>
          <p>{explanation}</p>
        </details>
      )}
    </details>
  );
}
