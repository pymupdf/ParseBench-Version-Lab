"use client";

import { useRef } from "react";

import type { EvidenceStatus } from "./model";
import type { RuleFacet, RuleFacetForType, RuleImpact } from "./rule-model";

type RuleFacetCount = RuleFacet & { attention: number; total: number };

export function RuleFacetBar({
  facets,
  selected,
  onSelect,
  label,
}: {
  facets: RuleFacetCount[];
  selected: string;
  onSelect: (key: string) => void;
  label: string;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const total = facets.reduce((sum, facet) => sum + facet.total, 0);
  const attention = facets.reduce((sum, facet) => sum + facet.attention, 0);
  const choices: RuleFacetCount[] = [
    { key: "all", label: "All checks", total, attention },
    ...facets,
  ];
  const selectFacet = (key: string) => {
    onSelect(key);
    window.requestAnimationFrame(() => {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth";
      barRef.current?.scrollIntoView({ behavior, block: "start" });
    });
  };
  return (
    <div className="diagnostic-facet-bar" aria-label={label} ref={barRef} role="group">
      {choices.map((facet) => (
        <button
          aria-pressed={selected === facet.key}
          className={selected === facet.key ? "diagnostic-facet-active" : undefined}
          key={facet.key}
          onClick={() => selectFacet(facet.key)}
          type="button"
        >
          <span>{facet.label}</span>
          <small>
            {facet.total.toLocaleString()}
            {facet.attention > 0 ? ` · ${facet.attention.toLocaleString()} need attention` : ""}
          </small>
        </button>
      ))}
    </div>
  );
}

export function ruleFacetCounts(
  types: string[],
  impactForType: (type: string) => RuleImpact,
  facetForType: RuleFacetForType,
  statusForIndex?: (index: number) => EvidenceStatus,
) {
  const facets = new Map<string, RuleFacetCount>();
  types.forEach((type, index) => {
    const facet = facetForType(type, impactForType(type));
    const current = facets.get(facet.key) ?? { ...facet, attention: 0, total: 0 };
    current.total += 1;
    if (statusForIndex && statusForIndex(index) !== "passed") current.attention += 1;
    facets.set(facet.key, current);
  });
  return [...facets.values()];
}
