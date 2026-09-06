"use client";

import { type ReactNode, useState } from "react";

import { chartArrayPreview, chartScoringDescription } from "./chart-model";
import { ChartScoringContract } from "./chart-diagnostic";
import { asNumber, asRecord, asString, humanize, scalarDisplay } from "./model";
import { EmptyDiagnostics, MarkdownEvidence, RuleImpactLabel } from "./primitives";
import { RuleFacetBar, ruleFacetCounts } from "./rule-facets";
import {
  FORMATTING_GROUPS,
  RULE_IMPACTS,
  TEXT_GROUPS,
  expectedRuleSummary,
  formattingFacetForType,
  formattingGroup,
  ruleImpact,
  singleScalarRuleEntry,
  textFacetForType,
  textGroup,
  type RuleFacetForType,
  type RuleImpact,
} from "./rule-model";
import { diagnosticUsesElementLayout, layoutExpectationIgnored } from "./semantics";
import { structuredTableFragments } from "./table-output-reconstruction";
import type { DiagnosticArtifact, DiagnosticExpectation } from "./types";

type GroundTruthInspectorProps = {
  dimension: string;
  diagnostic: DiagnosticArtifact | null;
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
}: Pick<GroundTruthInspectorProps, "diagnostic">) {
  const markdown = diagnostic?.expectations
    .map((expectation) => expectation.expected_markdown?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n\n") || "";
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
              const { preview: matrix, summary, truncated } = chartArrayPreview(rule.data);
              const labels = Array.isArray(rule.labels)
                ? rule.labels.map((label) => scalarDisplay(label)).join(" · ")
                : matrix[0]?.map((label) => scalarDisplay(label)).join(" · ") ?? "—";
              const value = rule.value ?? summary;
              return (
                <tr key={expectation.id}>
                  <th scope="row"><strong>{humanize(expectation.type)}</strong></th>
                  <td>{labels}</td>
                  <td>
                    <span>{scalarDisplay(value)}</span>
                    {matrix.length > 0 && (
                      <details className="diagnostic-matrix-details">
                        <summary>View expected data{truncated ? " · first 12 rows and columns" : ""}</summary>
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
  condensed = false,
}: {
  expectation: DiagnosticExpectation;
  impact: RuleImpact | null;
  condensed?: boolean;
}) {
  const scalarEntry = singleScalarRuleEntry(expectation.rule);
  const ruleSummary = scalarEntry
    ? `${humanize(scalarEntry[0])}: ${scalarDisplay(scalarEntry[1])}`
    : expectedRuleSummary(expectation.rule);
  const title = (
    <span>
      <span className="diagnostic-rule-title">
        <strong>{condensed ? ruleSummary : humanize(expectation.type)}</strong>
        {!condensed && impact && <RuleImpactLabel impact={impact} />}
      </span>
      {!condensed && <small>{ruleSummary}</small>}
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
  facetForType,
}: {
  expectations: DiagnosticExpectation[];
  groups: readonly { key: string; label: string }[];
  groupForType: (type: string) => string;
  eyebrow: string;
  heading: string;
  contract?: ReactNode;
  impactForType?: (type: string) => RuleImpact;
  facetForType?: RuleFacetForType;
}) {
  const [query, setQuery] = useState("");
  const [selectedFacet, setSelectedFacet] = useState("all");
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
  if (facetForType && impactForType) {
    const facets = ruleFacetCounts(
      expectations.map((expectation) => expectation.type),
      impactForType,
      facetForType,
    );
    const activeFacets = selectedFacet === "all"
      ? facets
      : facets.filter((facet) => facet.key === selectedFacet);
    const sections = activeFacets.flatMap((facet) => {
      const matching = expectations
        .filter((expectation) => facetForType(expectation.type, impactForType(expectation.type)).key === facet.key)
        .filter(expectationMatchesQuery);
      if (!matching.length) return [];
      const visibleLimit = visibleLimits[`facet:${facet.key}`] ?? 60;
      return [{ facet, matching, visibleLimit, rendered: matching.slice(0, visibleLimit) }];
    });
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
        <RuleFacetBar
          facets={facets}
          selected={selectedFacet}
          onSelect={setSelectedFacet}
          label="Ground-truth check categories"
        />
        <div className={`diagnostic-rule-groups diagnostic-rule-groups-faceted${selectedFacet === "all" ? "" : " diagnostic-rule-groups-filtered"}`}>
          {sections.length ? sections.map(({ facet, matching, rendered, visibleLimit }) => (
            <section className="diagnostic-facet-section" key={facet.key}>
              <div className="diagnostic-facet-section-heading">
                <strong>{facet.label}</strong>
                <span>{matching.length.toLocaleString()} expected checks</span>
              </div>
              <div className="diagnostic-rule-list">
                {rendered.map((expectation) => (
                  <GroundTruthRule
                    expectation={expectation}
                    impact={null}
                    condensed
                    key={expectation.id}
                  />
                ))}
                {rendered.length < matching.length && (
                  <button
                    className="diagnostic-load-more"
                    type="button"
                    onClick={() => setVisibleLimits((current) => ({
                      ...current,
                      [`facet:${facet.key}`]: visibleLimit + 60,
                    }))}
                  >
                    Show 60 more · {(matching.length - rendered.length).toLocaleString()} remaining
                  </button>
                )}
              </div>
            </section>
          )) : (
            <EmptyDiagnostics title="No matching checks" message="Try another category or search term." />
          )}
        </div>
      </section>
    );
  }
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
}: GroundTruthInspectorProps) {
  if (dimension === "table") {
    return <TableGroundTruth diagnostic={diagnostic} />;
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
        facetForType={textFacetForType}
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
        facetForType={formattingFacetForType}
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
