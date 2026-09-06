"use client";

import { type ReactNode, useState } from "react";

import { chartArrayPreview, chartScoringDescription } from "./chart-model";
import { ChartScoringContract } from "./chart-diagnostic";
import { asNumber, asRecord, asString, humanize, scalarDisplay } from "./model";
import {
  EmptyDiagnostics,
  MarkdownEvidence,
  RuleImpactLabel,
} from "./primitives";
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
import {
  diagnosticUsesElementLayout,
  layoutExpectationIgnored,
} from "./semantics";
import { structuredTableFragments } from "./table-output-reconstruction";
import type { DiagnosticArtifact, DiagnosticExpectation } from "./types";

type GroundTruthInspectorProps = {
  dimension: string;
  diagnostic: DiagnosticArtifact | null;
};

function expectedTableCount(
  diagnostic: DiagnosticArtifact | null,
  markdown: string,
) {
  if (diagnostic) {
    const preferredMetrics = [
      "table_record_match",
      "grits_con",
      "grits_trm_composite",
      "teds",
    ];
    for (const metricName of preferredMetrics) {
      const metric = diagnostic.metrics.find(
        (candidate) => candidate.metric_name === metricName,
      );
      const count =
        asNumber(metric?.metadata?.n_gt_tables) ??
        asNumber(metric?.metadata?.tables_found_expected);
      if (count != null) return count;
    }
    const countMetric = diagnostic.metrics.find(
      (metric) => metric.metric_name === "tables_expected",
    );
    if (countMetric?.value != null) return countMetric.value;
    const summaryCount = asNumber(diagnostic.summary.expected);
    if (summaryCount != null) return summaryCount;
  }
  return markdown.match(/<table(?:\s|>)/gi)?.length ?? (markdown ? 1 : 0);
}

function TableGroundTruth({
  diagnostic,
}: Pick<GroundTruthInspectorProps, "diagnostic">) {
  const markdown =
    diagnostic?.expectations
      .map((expectation) => expectation.expected_markdown?.trim())
      .filter((value): value is string => Boolean(value))
      .join("\n\n") || "";
  const tableCount = expectedTableCount(diagnostic, markdown);
  const tables = structuredTableFragments(markdown);
  return (
    <section className="diagnostic-dimension-view diagnostic-ground-truth-view evidence-workspace evidence-reference-workspace">
      <header className="evidence-workspace-heading">
        <div className="evidence-heading-main">
          <span className="evidence-dimension-symbol" aria-hidden="true">
            ▦
          </span>
          <div>
            <span className="evidence-kicker">Table ground truth</span>
            <h3>Expected table structure and content</h3>
            <p>
              The reference cells, rows and headers used to evaluate extraction.
            </p>
          </div>
        </div>
        <div className="evidence-reference-total">
          <strong>{tableCount.toLocaleString()}</strong>
          <span>expected {tableCount === 1 ? "table" : "tables"}</span>
        </div>
      </header>
      {tables.length ? (
        <div className="diagnostic-ground-truth-table-list">
          {tables.map((table, index) => (
            <article
              className="diagnostic-ground-truth-table evidence-reference-table"
              key={index}
            >
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

function CompleteChartExpectedData({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="evidence-reference-details chart-ground-truth-complete-data"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>View complete expected data</summary>
      {open && (
        <pre>
          <code>{JSON.stringify(data, null, 2)}</code>
        </pre>
      )}
    </details>
  );
}

function ChartGroundTruth({ diagnostic }: { diagnostic: DiagnosticArtifact }) {
  const expectations = diagnostic.expectations;
  if (!expectations.length)
    return (
      <EmptyDiagnostics message="No chart ground truth was retained for this page." />
    );
  return (
    <section className="diagnostic-dimension-view diagnostic-ground-truth-view evidence-workspace evidence-reference-workspace">
      <header className="evidence-workspace-heading">
        <div className="evidence-heading-main">
          <span className="evidence-dimension-symbol" aria-hidden="true">
            ▥
          </span>
          <div>
            <span className="evidence-kicker">Chart ground truth</span>
            <h3>Expected labels and data points</h3>
            <p>
              Inspect the reference value and matching method for each chart
              check.
            </p>
          </div>
        </div>
        <div className="evidence-reference-total">
          <strong>{expectations.length.toLocaleString()}</strong>
          <span>expected checks</span>
        </div>
      </header>
      <ChartScoringContract />
      <div className="evidence-chart-reference-list">
        {expectations.map((expectation, index) => {
          const rule = asRecord(expectation.rule) ?? {};
          const {
            preview: matrix,
            summary,
            truncated,
          } = chartArrayPreview(rule.data);
          const labels = Array.isArray(rule.labels)
            ? rule.labels.map((label) => scalarDisplay(label)).join(" · ")
            : (matrix[0]?.map((label) => scalarDisplay(label)).join(" · ") ??
              "—");
          return (
            <article className="evidence-chart-reference" key={expectation.id}>
              <header>
                <span className="evidence-check-number" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h4>{humanize(expectation.type)}</h4>
                <span className="evidence-kicker">Reference</span>
              </header>
              <dl className="evidence-reference-fields">
                <div>
                  <dt>Expected labels</dt>
                  <dd>{labels}</dd>
                </div>
                <div>
                  <dt>Expected value</dt>
                  <dd>{scalarDisplay(rule.value ?? summary)}</dd>
                </div>
              </dl>
              <div className="evidence-reference-method">
                <span className="evidence-kicker">Matching rule</span>
                <p>{chartScoringDescription(expectation.type, rule)}</p>
              </div>
              {matrix.length > 0 && (
                <details className="diagnostic-matrix-details evidence-reference-details">
                  <summary>
                    View expected data
                    {truncated ? " · first 12 rows and columns" : ""}
                  </summary>
                  <div className="diagnostic-table-scroll">
                    <table>
                      <tbody>
                        {matrix.map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {row.map((cell, cellIndex) =>
                              rowIndex === 0 ? (
                                <th scope="col" key={cellIndex}>
                                  {scalarDisplay(cell)}
                                </th>
                              ) : (
                                <td key={cellIndex}>{scalarDisplay(cell)}</td>
                              ),
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
              {truncated && <CompleteChartExpectedData data={rule.data} />}
            </article>
          );
        })}
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
      const pageDifference =
        (left.expectation.page ?? 0) - (right.expectation.page ?? 0);
      if (pageDifference) return pageDifference;
      const leftOrder =
        asNumber(asRecord(left.expectation.rule)?.ro_index) ??
        Number.MAX_SAFE_INTEGER;
      const rightOrder =
        asNumber(asRecord(right.expectation.rule)?.ro_index) ??
        Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.sourceIndex - right.sourceIndex;
    })
    .map(({ expectation }) => expectation);
}

function ReferenceRegionMap({ rule }: { rule: Record<string, unknown> }) {
  const box = Array.isArray(rule.bbox) ? rule.bbox.map(asNumber) : [];
  const valid =
    box.length === 4 &&
    box.every((value) => value != null) &&
    (box[2] ?? 0) > 0 &&
    (box[3] ?? 0) > 0;
  return (
    <div
      className="reference-region-map"
      aria-label={
        valid
          ? `Expected region: ${layoutBoxSummary(rule)}`
          : "Region coordinates unavailable"
      }
      role="img"
    >
      <span className="reference-page-lines" aria-hidden="true" />
      {valid && (
        <span
          className="reference-region-box"
          style={{
            left: `${box[0]! * 100}%`,
            top: `${box[1]! * 100}%`,
            width: `${box[2]! * 100}%`,
            height: `${box[3]! * 100}%`,
          }}
        />
      )}
    </div>
  );
}

function LayoutGroundTruth({
  diagnostic,
  expectations = diagnostic.expectations.filter(
    (expectation) => expectation.type === "layout",
  ),
  referenceOnly = false,
}: {
  diagnostic: DiagnosticArtifact;
  expectations?: DiagnosticExpectation[];
  referenceOnly?: boolean;
}) {
  if (!expectations.length)
    return (
      <EmptyDiagnostics message="No layout ground truth was retained for this page." />
    );
  const orderedExpectations = sortedLayoutExpectations(expectations);
  const sortedExpectations = referenceOnly
    ? orderedExpectations
    : [
        ...orderedExpectations.filter(
          (expectation) => !layoutExpectationIgnored(expectation),
        ),
        ...orderedExpectations.filter(layoutExpectationIgnored),
      ];
  const ignoredCount = sortedExpectations.filter(
    layoutExpectationIgnored,
  ).length;
  const scoredCount = sortedExpectations.length - ignoredCount;
  return (
    <section className="diagnostic-dimension-view diagnostic-ground-truth-view evidence-workspace evidence-layout-workspace evidence-reference-workspace">
      <header className="evidence-workspace-heading">
        <div className="evidence-heading-main">
          <span className="evidence-dimension-symbol" aria-hidden="true">
            ▥
          </span>
          <div>
            <span className="evidence-kicker">
              {referenceOnly ? "Layout references" : "Layout ground truth"}
            </span>
            <h3>
              {referenceOnly
                ? "Regions referenced by the scored order checks"
                : "Expected elements and reading order"}
            </h3>
            <p>
              {referenceOnly
                ? "Source regions that anchor the sequence checks."
                : "A spatial reference for every annotated document region."}
            </p>
          </div>
        </div>
        <dl className="evidence-overview-counts">
          <div>
            <dt>{referenceOnly ? "Reference elements" : "Scored elements"}</dt>
            <dd>
              {(referenceOnly
                ? sortedExpectations.length
                : scoredCount
              ).toLocaleString()}
            </dd>
          </div>
          {!referenceOnly && (
            <div>
              <dt>Reference only</dt>
              <dd>{ignoredCount.toLocaleString()}</dd>
            </div>
          )}
        </dl>
      </header>
      <details className="evidence-scoring-note">
        <summary>
          {referenceOnly
            ? "Visual references and reading-order coordinates"
            : "How to read the reference coordinates"}
        </summary>
        <p>
          {referenceOnly &&
            "These regions ground the sequence checks shown in this view; this result does not evaluate their localization or classification. "}
          Boxes are normalized to the page: x and y locate the top-left corner;
          w and h are width and height. Reading order is shown as a
          human-friendly 1-based position.
        </p>
      </details>
      <div className="evidence-region-list">
        {sortedExpectations.map((expectation) => {
          const rule = asRecord(expectation.rule) ?? {};
          const className =
            asString(rule.canonical_class) ??
            asString(rule.source_label) ??
            expectation.type;
          const readingOrder = asNumber(rule.ro_index);
          const ignored =
            referenceOnly || layoutExpectationIgnored(expectation);
          return (
            <article
              className={`evidence-region-card${ignored ? " diagnostic-layout-reference-row evidence-region-reference" : ""}`}
              key={expectation.id}
            >
              <ReferenceRegionMap rule={rule} />
              <div className="evidence-region-content">
                <header>
                  <div>
                    <span className="evidence-kicker">
                      {expectation.page != null
                        ? `Page ${expectation.page}`
                        : "Source region"}
                    </span>
                    <h4>{humanize(className)}</h4>
                  </div>
                  <span className="reference-reading-position">
                    <small>Reading order</small>
                    <strong>
                      {readingOrder == null
                        ? "—"
                        : (readingOrder + 1).toLocaleString()}
                    </strong>
                  </span>
                </header>
                <p>{layoutContentSummary(rule)}</p>
                <code>{layoutBoxSummary(rule)}</code>
                {ignored && (
                  <span className="diagnostic-reference-label">
                    {referenceOnly
                      ? "Reference only · not scored"
                      : "Ignored by scoring"}
                  </span>
                )}
              </div>
            </article>
          );
        })}
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
  const rule = asRecord(expectation.rule);
  const fields = rule
    ? Object.entries(rule).filter(
        ([key, value]) =>
          ![
            "id",
            "type",
            "page",
            "tags",
            "original_md",
            "layout_bindings",
            "layout_id",
            "layout_ids",
          ].includes(key) &&
          (typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"),
      )
    : [];
  return (
    <article className="diagnostic-ground-truth-rule evidence-reference-rule">
      <header>
        <span className="evidence-kicker">{humanize(expectation.type)}</span>
        {impact && <RuleImpactLabel impact={impact} />}
        {expectation.page != null && <small>Page {expectation.page}</small>}
      </header>
      {scalarEntry ? (
        <blockquote>{scalarDisplay(scalarEntry[1])}</blockquote>
      ) : fields.length ? (
        <dl className="evidence-reference-fields">
          {fields.slice(0, 6).map(([key, value]) => (
            <div key={key}>
              <dt>{humanize(key)}</dt>
              <dd>{scalarDisplay(value)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="evidence-reference-summary">
          {expectedRuleSummary(expectation.rule)}
        </p>
      )}
      {expectation.tags?.length ? (
        <div className="evidence-reference-tags">
          {expectation.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}
      {!scalarEntry && (
        <details className="evidence-reference-details">
          <summary>View rule details</summary>
          <pre>
            <code>{JSON.stringify(expectation.rule, null, 2)}</code>
          </pre>
        </details>
      )}
    </article>
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
  const [visibleLimits, setVisibleLimits] = useState<Record<string, number>>(
    {},
  );
  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (expectation: DiagnosticExpectation) =>
    !normalizedQuery ||
    [
      expectation.type,
      expectedRuleSummary(expectation.rule),
      asString(asRecord(expectation.rule)?.text) ?? "",
      ...(expectation.tags ?? []),
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  const facets =
    facetForType && impactForType
      ? ruleFacetCounts(
          expectations.map((expectation) => expectation.type),
          impactForType,
          facetForType,
        )
      : null;
  const groupsWithExpectations =
    facets && facetForType && impactForType
      ? facets
          .filter(
            (facet) => selectedFacet === "all" || facet.key === selectedFacet,
          )
          .map((facet) => ({
            key: facet.key,
            label: facet.label,
            expectations: expectations.filter(
              (expectation) =>
                facetForType(expectation.type, impactForType(expectation.type))
                  .key === facet.key,
            ),
          }))
      : (impactForType ? RULE_IMPACTS : [null]).flatMap((impact) =>
          groups.map((group) => ({
            key: `${impact ?? "all"}:${group.key}`,
            label: group.label,
            expectations: expectations.filter(
              (expectation) =>
                groupForType(expectation.type) === group.key &&
                (impact == null ||
                  impactForType?.(expectation.type) === impact),
            ),
          })),
        );
  const sections = groupsWithExpectations.flatMap((group) => {
    const matching = group.expectations.filter(matchesQuery);
    const limit = visibleLimits[group.key] ?? 60;
    return matching.length
      ? [{ ...group, matching, limit, rendered: matching.slice(0, limit) }]
      : [];
  });
  return (
    <section
      className={`diagnostic-dimension-view diagnostic-ground-truth-view evidence-workspace evidence-reference-workspace${eyebrow.toLowerCase().includes("formatting") ? " evidence-formatting-workspace" : ""}`}
    >
      <header className="evidence-workspace-heading">
        <div className="evidence-heading-main">
          <span className="evidence-dimension-symbol" aria-hidden="true">
            ≡
          </span>
          <div>
            <span className="evidence-kicker">{eyebrow}</span>
            <h3>{heading}</h3>
            <p>The reference expectations used to evaluate this document.</p>
          </div>
        </div>
        <div className="evidence-reference-total">
          <strong>{expectations.length.toLocaleString()}</strong>
          <span>expected checks</span>
        </div>
      </header>
      {contract && (
        <details className="evidence-scoring-note">
          <summary>About this reference and its score contribution</summary>
          <div>{contract}</div>
        </details>
      )}
      {facets && (
        <RuleFacetBar
          facets={facets}
          selected={selectedFacet}
          onSelect={setSelectedFacet}
          label="Ground-truth check categories"
        />
      )}
      {expectations.length > 8 && (
        <div className="diagnostic-rule-toolbar diagnostic-ground-truth-toolbar evidence-check-toolbar">
          <input
            aria-label="Search ground-truth checks"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Find reference text or an expected rule…"
          />
        </div>
      )}
      <div className="diagnostic-rule-groups evidence-reference-groups">
        {sections.length ? (
          sections.map((section) => (
            <section
              className="diagnostic-facet-section evidence-check-section"
              key={section.key}
            >
              <div className="diagnostic-facet-section-heading evidence-section-heading">
                <strong>{section.label}</strong>
                <span>
                  {section.matching.length.toLocaleString()} expected checks
                </span>
              </div>
              <div className="diagnostic-rule-list evidence-reference-list">
                {section.rendered.map((expectation) => (
                  <GroundTruthRule
                    expectation={expectation}
                    impact={impactForType?.(expectation.type) ?? null}
                    key={expectation.id}
                  />
                ))}
              </div>
              {section.rendered.length < section.matching.length && (
                <button
                  className="diagnostic-load-more"
                  type="button"
                  onClick={() =>
                    setVisibleLimits((current) => ({
                      ...current,
                      [section.key]: section.limit + 60,
                    }))
                  }
                >
                  Show{" "}
                  {Math.min(
                    60,
                    section.matching.length - section.rendered.length,
                  )}{" "}
                  more ·{" "}
                  {(
                    section.matching.length - section.rendered.length
                  ).toLocaleString()}{" "}
                  remaining
                </button>
              )}
            </section>
          ))
        ) : (
          <EmptyDiagnostics
            title="No matching checks"
            message="Try another category or search term."
          />
        )}
      </div>
    </section>
  );
}

function HybridLayoutGroundTruth({
  diagnostic,
}: {
  diagnostic: DiagnosticArtifact;
}) {
  const layoutExpectations = diagnostic.expectations.filter(
    (expectation) => expectation.type === "layout",
  );
  const scoredExpectations = diagnostic.expectations.filter(
    (expectation) => expectation.type !== "layout",
  );
  return (
    <div className="diagnostic-ground-truth-stack">
      <ExpectationGroups
        expectations={scoredExpectations}
        groups={[{ key: "order", label: "Scored reading-order checks" }]}
        groupForType={() => "order"}
        eyebrow="Reading-order ground truth"
        heading="Expected sequence between referenced regions"
        contract={
          <>
            <strong>These are the scored expectations</strong>
            <p>
              Only these sequence checks contribute to this result’s headline
              score. The layout elements below provide supporting visual
              references.
            </p>
          </>
        }
        impactForType={() => "headline"}
      />
      <LayoutGroundTruth
        diagnostic={diagnostic}
        expectations={layoutExpectations}
        referenceOnly
      />
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
    return (
      <EmptyDiagnostics message="No structured ground truth is available for this historical result." />
    );
  }
  if (dimension === "chart")
    return <ChartGroundTruth diagnostic={diagnostic} />;
  if (dimension === "layout") {
    return diagnosticUsesElementLayout(diagnostic) ? (
      <LayoutGroundTruth diagnostic={diagnostic} />
    ) : (
      <HybridLayoutGroundTruth diagnostic={diagnostic} />
    );
  }
  if (dimension === "text_content") {
    return (
      <ExpectationGroups
        expectations={diagnostic.expectations}
        groups={TEXT_GROUPS}
        groupForType={textGroup}
        eyebrow="Text-content ground truth"
        heading="Expected content, completeness and order"
        contract={
          <>
            <strong>Ground truth and score contribution</strong>
            <p>
              Headline-input badges identify expectations used by Content
              Faithfulness; supporting checks remain visible for diagnosis.
            </p>
          </>
        }
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
        contract={
          <>
            <strong>Ground truth and score contribution</strong>
            <p>
              Headline-input badges identify expectations used by this result’s
              primary formatting metric; the others are supporting checks.
            </p>
          </>
        }
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
