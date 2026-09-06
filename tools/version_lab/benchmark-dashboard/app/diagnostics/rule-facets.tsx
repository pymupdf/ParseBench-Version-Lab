"use client";

import { useRef } from "react";

import type { EvidenceStatus } from "./model";
import type { RuleFacet, RuleFacetForType, RuleImpact } from "./rule-model";

type RuleFacetCount = RuleFacet & {
  attention: number;
  total: number;
  evaluated?: boolean;
};

function categorySymbol(label: string) {
  const family = label.toLowerCase();
  if (family.includes("all checks")) return "∷";
  if (family.includes("digit")) return "123";
  if (family.includes("sentence")) return "¶";
  if (family.includes("word")) return "Aa";
  if (family.includes("order") || family.includes("hierarchy")) return "↳";
  if (family.includes("bold")) return "B";
  if (family.includes("italic")) return "𝑖";
  if (family.includes("underline")) return "U̲";
  if (family.includes("title")) return "H₁";
  if (family.includes("code")) return "</>";
  if (family.includes("latex")) return "∑";
  return "Aa";
}

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
    {
      key: "all",
      label: "All checks",
      total,
      attention,
      evaluated: facets.some((facet) => facet.evaluated),
    },
    ...facets,
  ];
  const selectFacet = (key: string) => {
    onSelect(key);
    window.requestAnimationFrame(() => {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches
        ? "auto"
        : "smooth";
      barRef.current?.scrollIntoView({ behavior, block: "start" });
    });
  };
  return (
    <div
      className="diagnostic-facet-bar evidence-category-grid"
      aria-label={label}
      ref={barRef}
      role="group"
    >
      {choices.map((facet) => (
        <button
          aria-pressed={selected === facet.key}
          aria-label={`${facet.label} ${facet.total.toLocaleString()}${facet.attention > 0 ? ` · ${facet.attention.toLocaleString()} need attention` : ""}`}
          className={
            selected === facet.key ? "diagnostic-facet-active" : undefined
          }
          key={facet.key}
          onClick={() => selectFacet(facet.key)}
          type="button"
        >
          <span className="evidence-category-top">
            <span className="evidence-category-symbol" aria-hidden="true">
              {categorySymbol(facet.label)}
            </span>
            <strong>{facet.total.toLocaleString()}</strong>
          </span>
          <span className="evidence-category-name">
            {facet.label.split(" · ")[0]}
          </span>
          <small>
            {facet.label.includes(" · ")
              ? facet.label.split(" · ")[1]
              : "Entire evaluation"}
          </small>
          {facet.evaluated && (
            <span className="evidence-category-status">
              {facet.attention > 0
                ? `${facet.attention.toLocaleString()} need attention`
                : "All passed"}
              <span className="evidence-category-track" aria-hidden="true">
                <span
                  style={{
                    width: `${facet.total ? ((facet.total - facet.attention) / facet.total) * 100 : 0}%`,
                  }}
                />
              </span>
            </span>
          )}
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
    const current = facets.get(facet.key) ?? {
      ...facet,
      attention: 0,
      total: 0,
      evaluated: statusForIndex != null,
    };
    current.total += 1;
    if (statusForIndex && statusForIndex(index) !== "passed")
      current.attention += 1;
    facets.set(facet.key, current);
  });
  return [...facets.values()];
}
