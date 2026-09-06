"use client";

import { type ReactNode, useState } from "react";

import {
  asRecord,
  asString,
  evidenceStatus,
  humanize,
  outcomeExplanation,
  scorePercent,
  type EvidenceItem,
  type EvidenceStatus,
} from "./model";
import {
  EmptyDiagnostics,
  EvidenceButton,
  RuleImpactLabel,
  StatusPill,
} from "./primitives";
import { RuleFacetBar, ruleFacetCounts } from "./rule-facets";
import {
  RULE_IMPACTS,
  expectedRuleSummary,
  type RuleFacetForType,
  type RuleImpact,
} from "./rule-model";
import { textBagSearchText } from "./text-bag-model";

const STATUS_RANK: Record<EvidenceStatus, number> = {
  failed: 0,
  partial: 1,
  unknown: 2,
  passed: 3,
};
const CHECK_PAGE_SIZE = 60;

type RuleGroupsProps = {
  items: EvidenceItem[];
  groups: readonly { key: string; label: string }[];
  groupForType: (type: string) => string;
  selectedEvidenceId?: string | null;
  onSelectEvidence?: (id: string) => void;
  impactForType?: (type: string) => RuleImpact;
  facetForType?: RuleFacetForType;
  advisoryForItem?: (item: EvidenceItem) => string | null;
  detailForItem?: (item: EvidenceItem) => ReactNode;
};

type CheckSection = {
  key: string;
  label: string;
  impact: RuleImpact | null;
  items: EvidenceItem[];
};

export function RuleGroups({
  items,
  groups,
  groupForType,
  selectedEvidenceId,
  onSelectEvidence,
  impactForType,
  facetForType,
  advisoryForItem,
  detailForItem,
}: RuleGroupsProps) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(items.length <= 10);
  const [selectedFacet, setSelectedFacet] = useState("all");
  const [visibleLimits, setVisibleLimits] = useState<Record<string, number>>(
    {},
  );
  const normalizedQuery = query.trim().toLowerCase();
  const queryTerms = normalizedQuery.endsWith("s")
    ? [normalizedQuery, normalizedQuery.slice(0, -1)]
    : [normalizedQuery];
  const matchesFilters = (item: EvidenceItem) => {
    if (!showAll && evidenceStatus(item.outcome) === "passed") return false;
    return (
      !normalizedQuery ||
      [
        item.type,
        expectedRuleSummary(item.expectation?.rule),
        asString(asRecord(item.expectation?.rule)?.text) ?? "",
        textBagSearchText(item),
        outcomeExplanation(item.outcome) ?? "",
      ].some((value) =>
        queryTerms.some((term) => value.toLowerCase().includes(term)),
      )
    );
  };
  const facets =
    facetForType && impactForType
      ? ruleFacetCounts(
          items.map((item) => item.type),
          impactForType,
          facetForType,
          (index) => evidenceStatus(items[index]?.outcome ?? null),
        )
      : null;
  const sourceSections: CheckSection[] =
    facets && facetForType && impactForType
      ? facets
          .filter(
            (facet) => selectedFacet === "all" || facet.key === selectedFacet,
          )
          .map((facet) => ({
            key: facet.key,
            label: facet.label.split(" · ")[0]!,
            impact: facet.key.endsWith(":headline") ? "headline" : "supporting",
            items: items.filter(
              (item) =>
                facetForType(item.type, impactForType(item.type)).key ===
                facet.key,
            ),
          }))
      : (impactForType ? RULE_IMPACTS : [null]).flatMap((impact) =>
          groups.map((group) => ({
            key: `${impact ?? "all"}:${group.key}`,
            label: group.label,
            impact,
            items: items.filter(
              (item) =>
                groupForType(item.type) === group.key &&
                (impact == null || impactForType?.(item.type) === impact),
            ),
          })),
        );
  const sections = sourceSections.flatMap((section) => {
    const matching = section.items
      .filter(matchesFilters)
      .sort(
        (left, right) =>
          STATUS_RANK[evidenceStatus(left.outcome)] -
          STATUS_RANK[evidenceStatus(right.outcome)],
      );
    if (!matching.length) return [];
    const limit = visibleLimits[section.key] ?? CHECK_PAGE_SIZE;
    return [
      { ...section, matching, rendered: matching.slice(0, limit), limit },
    ];
  });
  const matchingCount = sections.reduce(
    (sum, section) => sum + section.matching.length,
    0,
  );

  return (
    <div
      className={`diagnostic-rule-groups evidence-check-browser${facets ? " diagnostic-rule-groups-faceted" : ""}${selectedFacet === "all" ? "" : " diagnostic-rule-groups-filtered"}`}
    >
      {facets && (
        <RuleFacetBar
          facets={facets}
          selected={selectedFacet}
          onSelect={setSelectedFacet}
          label="Evaluation check categories"
        />
      )}
      <div className="evidence-browser-header">
        <div>
          <span className="evidence-kicker">Explore the evidence</span>
          <strong>
            {matchingCount.toLocaleString()}{" "}
            {showAll ? "matching checks" : "checks need attention"}
          </strong>
        </div>
        <span>Unresolved checks appear first</span>
      </div>
      <div className="diagnostic-rule-toolbar evidence-check-toolbar">
        <input
          aria-label="Search evaluation checks"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Find text, a rule or an evaluator note…"
        />
        <div
          className="mode-toggle"
          role="group"
          aria-label="Evidence status filter"
        >
          <button
            type="button"
            aria-pressed={!showAll}
            className={!showAll ? "mode-active" : ""}
            onClick={() => setShowAll(false)}
          >
            Needs attention
          </button>
          <button
            type="button"
            aria-pressed={showAll}
            className={showAll ? "mode-active" : ""}
            onClick={() => setShowAll(true)}
          >
            All
          </button>
        </div>
      </div>
      {sections.length ? (
        sections.map((section) => (
          <section
            className="diagnostic-facet-section evidence-check-section"
            key={section.key}
          >
            <div className="diagnostic-facet-section-heading evidence-section-heading">
              <div>
                <strong>{section.label}</strong>
                {section.impact && <RuleImpactLabel impact={section.impact} />}
              </div>
              <span>{section.matching.length.toLocaleString()} checks</span>
            </div>
            <div className="diagnostic-rule-list evidence-check-list">
              {section.rendered.map((item, index) => {
                const status = evidenceStatus(item.outcome);
                const explanation = outcomeExplanation(item.outcome);
                const advisory = advisoryForItem?.(item);
                const detail = detailForItem?.(item);
                const expected =
                  asString(asRecord(item.expectation?.rule)?.text) ??
                  expectedRuleSummary(item.expectation?.rule);
                return (
                  <article
                    className={`diagnostic-rule-entry evidence-check-card evidence-check-${status}${selectedEvidenceId === item.id ? " evidence-check-selected" : ""}`}
                    key={item.id}
                  >
                    <EvidenceButton
                      id={item.id}
                      selected={selectedEvidenceId === item.id}
                      onSelect={onSelectEvidence}
                      className={`diagnostic-rule-row evidence-check-select${detail ? " diagnostic-rule-row-has-detail" : ""}`}
                    >
                      <span
                        className="evidence-check-number"
                        aria-hidden="true"
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="diagnostic-rule-main evidence-check-expectation">
                        <span className="evidence-check-meta">
                          <span>{humanize(item.type)}</span>
                          {item.page != null && <span>Page {item.page}</span>}
                        </span>
                        <span className="diagnostic-rule-title">
                          <strong>{expected}</strong>
                        </span>
                        {onSelectEvidence && (
                          <small className="evidence-source-hint">
                            {selectedEvidenceId === item.id
                              ? "Selected evidence"
                              : "Select this check"}
                            <span aria-hidden="true">↗</span>
                          </small>
                        )}
                      </span>
                      <span className="diagnostic-rule-result evidence-check-result">
                        {item.outcome?.score != null && (
                          <strong>{scorePercent(item.outcome.score)}</strong>
                        )}
                        <StatusPill status={status} />
                      </span>
                    </EvidenceButton>
                    {!detail && explanation && (
                      <div className="evidence-observation">
                        <span className="evidence-kicker">
                          Evaluator observation
                        </span>
                        <p>{explanation}</p>
                      </div>
                    )}
                    {advisory && (
                      <aside className="diagnostic-rule-advisory evidence-advisory">
                        <strong>Matching context</strong>
                        <p>{advisory}</p>
                      </aside>
                    )}
                    {detail}
                  </article>
                );
              })}
              {section.rendered.length < section.matching.length && (
                <button
                  className="diagnostic-load-more"
                  type="button"
                  onClick={() =>
                    setVisibleLimits((current) => ({
                      ...current,
                      [section.key]: section.limit + CHECK_PAGE_SIZE,
                    }))
                  }
                >
                  Show{" "}
                  {Math.min(
                    CHECK_PAGE_SIZE,
                    section.matching.length - section.rendered.length,
                  )}{" "}
                  more ·{" "}
                  {(
                    section.matching.length - section.rendered.length
                  ).toLocaleString()}{" "}
                  remaining
                </button>
              )}
            </div>
          </section>
        ))
      ) : (
        <EmptyDiagnostics
          title="No matching checks"
          message="Try another category, search term, or status filter."
        />
      )}
    </div>
  );
}
