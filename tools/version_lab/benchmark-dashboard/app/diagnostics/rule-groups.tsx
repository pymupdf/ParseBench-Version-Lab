"use client";

import { type ReactNode, useState } from "react";

import {
  evidenceStatus,
  humanize,
  outcomeExplanation,
  scorePercent,
  statusCounts,
  type EvidenceItem,
  type EvidenceStatus,
} from "./model";
import { EmptyDiagnostics, EvidenceButton, RuleImpactLabel, StatusPill } from "./primitives";
import { RuleFacetBar, ruleFacetCounts } from "./rule-facets";
import {
  RULE_IMPACTS,
  expectedRuleSummary,
  type RuleFacetForType,
  type RuleImpact,
} from "./rule-model";
import { textBagSearchText } from "./text-bag-model";

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
}: {
  items: EvidenceItem[];
  groups: readonly { key: string; label: string }[];
  groupForType: (type: string) => string;
  selectedEvidenceId?: string | null;
  onSelectEvidence?: (id: string) => void;
  impactForType?: (type: string) => RuleImpact;
  facetForType?: RuleFacetForType;
  advisoryForItem?: (item: EvidenceItem) => string | null;
  detailForItem?: (item: EvidenceItem) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(items.length <= 10);
  const [selectedFacet, setSelectedFacet] = useState("all");
  const [visibleLimits, setVisibleLimits] = useState<Record<string, number>>({});
  const normalizedQuery = query.trim().toLowerCase();
  const queryTerms = normalizedQuery.endsWith("s")
    ? [normalizedQuery, normalizedQuery.slice(0, -1)]
    : [normalizedQuery];
  const statusRank: Record<EvidenceStatus, number> = {
    failed: 0,
    partial: 1,
    unknown: 2,
    passed: 3,
  };
  const impactSections = (impactForType ? RULE_IMPACTS : [null]).map((impact) => ({
    impact,
    items: items.filter((item) => impact == null || impactForType?.(item.type) === impact),
  }));
  const itemMatchesFilters = (item: EvidenceItem) => {
    if (!showAll && evidenceStatus(item.outcome) === "passed") return false;
    if (!normalizedQuery) return true;
    return [
      item.type,
      expectedRuleSummary(item.expectation?.rule),
      textBagSearchText(item),
      outcomeExplanation(item.outcome) ?? "",
    ].some((value) => queryTerms.some((term) => value.toLowerCase().includes(term)));
  };
  const firstPopulatedGroup = impactSections.flatMap((section) =>
    groups.map((group) => ({
      key: `${section.impact ?? "all"}:${group.key}`,
      populated: section.items.some(
        (item) => groupForType(item.type) === group.key && itemMatchesFilters(item),
      ),
    })),
  ).find((group) => group.populated)?.key;
  if (facetForType && impactForType) {
    const facets = ruleFacetCounts(
      items.map((item) => item.type),
      impactForType,
      facetForType,
      (index) => evidenceStatus(items[index]?.outcome ?? null),
    );
    const activeFacets = selectedFacet === "all"
      ? facets
      : facets.filter((facet) => facet.key === selectedFacet);
    const sections = activeFacets.flatMap((facet) => {
      const matching = items
        .filter((item) => facetForType(item.type, impactForType(item.type)).key === facet.key)
        .filter(itemMatchesFilters)
        .sort((left, right) =>
          statusRank[evidenceStatus(left.outcome)] - statusRank[evidenceStatus(right.outcome)],
        );
      if (!matching.length) return [];
      const visibleLimit = visibleLimits[`facet:${facet.key}`] ?? 60;
      return [{ facet, matching, visibleLimit, rendered: matching.slice(0, visibleLimit) }];
    });
    return (
      <div className={`diagnostic-rule-groups diagnostic-rule-groups-faceted${selectedFacet === "all" ? "" : " diagnostic-rule-groups-filtered"}`}>
        <div className="diagnostic-rule-toolbar">
          <input
            aria-label="Search evaluation checks"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search checks"
          />
          <div className="mode-toggle" aria-label="Evidence status filter">
            <button type="button" aria-pressed={!showAll} className={!showAll ? "mode-active" : ""} onClick={() => setShowAll(false)}>Needs attention</button>
            <button type="button" aria-pressed={showAll} className={showAll ? "mode-active" : ""} onClick={() => setShowAll(true)}>All</button>
          </div>
        </div>
        <RuleFacetBar
          facets={facets}
          selected={selectedFacet}
          onSelect={setSelectedFacet}
          label="Evaluation check categories"
        />
        {sections.length ? sections.map(({ facet, matching, rendered, visibleLimit }) => (
          <section className="diagnostic-facet-section" key={facet.key}>
            <div className="diagnostic-facet-section-heading">
              <strong>{facet.label}</strong>
              <span>{matching.length.toLocaleString()} matching</span>
            </div>
            <div className="diagnostic-rule-list">
              {rendered.map((item) => {
                const status = evidenceStatus(item.outcome);
                const explanation = outcomeExplanation(item.outcome);
                const advisory = advisoryForItem?.(item);
                const detail = detailForItem?.(item);
                return (
                  <div className="diagnostic-rule-entry" key={item.id}>
                    <EvidenceButton
                      id={item.id}
                      selected={selectedEvidenceId === item.id}
                      onSelect={onSelectEvidence}
                      className={`diagnostic-rule-row${detail ? " diagnostic-rule-row-has-detail" : ""}`}
                    >
                      <span className="diagnostic-rule-main">
                        <span className="diagnostic-rule-title">
                          <strong>{expectedRuleSummary(item.expectation?.rule)}</strong>
                        </span>
                        {!detail && explanation && <span title={explanation}>{explanation}</span>}
                        {advisory && <span className="diagnostic-rule-advisory">{advisory}</span>}
                      </span>
                      <span className="diagnostic-rule-result">
                        <StatusPill status={status} />
                        {item.outcome?.score != null && <small>{scorePercent(item.outcome.score)}</small>}
                      </span>
                    </EvidenceButton>
                    {detail}
                  </div>
                );
              })}
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
          <EmptyDiagnostics title="No matching checks" message="Try another category, search term, or status filter." />
        )}
      </div>
    );
  }
  return (
    <div className="diagnostic-rule-groups">
      {items.length > 0 && (
        <div className="diagnostic-rule-toolbar">
          <input
            aria-label="Search evaluation checks"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search checks"
          />
          <div className="mode-toggle" aria-label="Evidence status filter">
            <button type="button" aria-pressed={!showAll} className={!showAll ? "mode-active" : ""} onClick={() => setShowAll(false)}>Needs attention</button>
            <button type="button" aria-pressed={showAll} className={showAll ? "mode-active" : ""} onClick={() => setShowAll(true)}>All</button>
          </div>
        </div>
      )}
      {impactSections.map((section) => {
        if (!section.items.some(itemMatchesFilters)) return null;
        return (
          <div className={`diagnostic-impact-section${section.impact ? ` diagnostic-impact-section-${section.impact}` : ""}`} key={section.impact ?? "all"}>
            {section.impact && (
              <div className="diagnostic-impact-heading">
                <strong>{section.impact === "headline" ? "Headline inputs" : "Supporting diagnostics"}</strong>
                <span>{section.items.length.toLocaleString()} checks</span>
              </div>
            )}
            {groups.map((group) => {
              const groupKey = `${section.impact ?? "all"}:${group.key}`;
              const groupedItems = section.items.filter((item) => groupForType(item.type) === group.key);
              if (!groupedItems.length) return null;
              const counts = statusCounts(groupedItems);
              const visibleItems = groupedItems
                .filter(itemMatchesFilters)
                .sort((left, right) =>
                  statusRank[evidenceStatus(left.outcome)] - statusRank[evidenceStatus(right.outcome)],
                );
              if (!visibleItems.length) return null;
              const visibleLimit = visibleLimits[groupKey] ?? 60;
              const renderedItems = visibleItems.slice(0, visibleLimit);
              return (
                <details className="diagnostic-rule-group" key={groupKey} open={Boolean(normalizedQuery) || groupKey === firstPopulatedGroup}>
            <summary>
              <span>
                <strong>{group.label}</strong>
                <small>{renderedItems.length.toLocaleString()} shown · {visibleItems.length.toLocaleString()} matching · {groupedItems.length.toLocaleString()} total</small>
              </span>
              <span className="diagnostic-group-counts">
                {counts.failed > 0 && <span>{counts.failed} failed</span>}
                {counts.partial > 0 && <span>{counts.partial} partial</span>}
                {counts.passed > 0 && <span>{counts.passed} passed</span>}
              </span>
            </summary>
            <div className="diagnostic-rule-list">
              {renderedItems.map((item) => {
                const status = evidenceStatus(item.outcome);
                const explanation = outcomeExplanation(item.outcome);
                const advisory = advisoryForItem?.(item);
                const detail = detailForItem?.(item);
                return (
                  <div className="diagnostic-rule-entry" key={item.id}>
                    <EvidenceButton
                      id={item.id}
                      selected={selectedEvidenceId === item.id}
                      onSelect={onSelectEvidence}
                      className={`diagnostic-rule-row${detail ? " diagnostic-rule-row-has-detail" : ""}`}
                    >
                      <span className="diagnostic-rule-main">
                        <span className="diagnostic-rule-title">
                          <strong>{humanize(item.type)}</strong>
                          {impactForType && <RuleImpactLabel impact={impactForType(item.type)} />}
                        </span>
                        <small>{expectedRuleSummary(item.expectation?.rule)}</small>
                        {!detail && explanation && <span title={explanation}>{explanation}</span>}
                        {advisory && <span className="diagnostic-rule-advisory">{advisory}</span>}
                      </span>
                      <span className="diagnostic-rule-result">
                        <StatusPill status={status} />
                        {item.outcome?.score != null && <small>{scorePercent(item.outcome.score)}</small>}
                      </span>
                    </EvidenceButton>
                    {detail}
                  </div>
                );
              })}
              {renderedItems.length < visibleItems.length && (
                <button
                  className="diagnostic-load-more"
                  type="button"
                  onClick={() => setVisibleLimits((current) => ({
                    ...current,
                    [groupKey]: visibleLimit + 60,
                  }))}
                >
                  Show 60 more · {(visibleItems.length - renderedItems.length).toLocaleString()} remaining
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
  );
}
