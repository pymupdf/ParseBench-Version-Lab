import {
  asNumber,
  asRecord,
  asString,
  outcomeExplanation,
  type EvidenceItem,
  type EvidenceStatus,
} from "./model";
import type { DiagnosticOutcome } from "./types";

type TextBagKind = "sentence" | "word" | "digit";

type TextBagMode = "maximum" | "missing" | "unexpected";

export type TextBagDefinition = {
  entries: Array<{ target: string; count: number }>;
  kind: TextBagKind;
  mode: TextBagMode;
};

type RetainedTextComparison = {
  actualCount: number;
  compacted: boolean;
  expectedCount: number | null;
  target: string;
};

const TEXT_BAG_RULES = {
  missing_sentence: { field: "bag_of_sentence", kind: "sentence", mode: "missing" },
  missing_sentence_percent: { field: "bag_of_sentence", kind: "sentence", mode: "missing" },
  unexpected_sentence: { field: "bag_of_sentence", kind: "sentence", mode: "unexpected" },
  unexpected_sentence_percent: { field: "bag_of_sentence", kind: "sentence", mode: "unexpected" },
  too_many_sentence_occurence: { field: "bag_of_sentence", kind: "sentence", mode: "maximum" },
  too_many_sentence_occurence_percent: { field: "bag_of_sentence", kind: "sentence", mode: "maximum" },
  missing_word: { field: "bag_of_word", kind: "word", mode: "missing" },
  missing_word_percent: { field: "bag_of_word", kind: "word", mode: "missing" },
  unexpected_word: { field: "bag_of_word", kind: "word", mode: "unexpected" },
  unexpected_word_percent: { field: "bag_of_word", kind: "word", mode: "unexpected" },
  too_many_word_occurence: { field: "bag_of_word", kind: "word", mode: "maximum" },
  too_many_word_occurence_percent: { field: "bag_of_word", kind: "word", mode: "maximum" },
  bag_of_digit_percent: { field: "bag_of_digit", kind: "digit", mode: "missing" },
} as const satisfies Record<string, {
  field: "bag_of_sentence" | "bag_of_word" | "bag_of_digit";
  kind: TextBagKind;
  mode: TextBagMode;
}>;

export function normalizedComparisonTarget(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replaceAll("…", "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

export function textBagDefinition(item: EvidenceItem): TextBagDefinition | null {
  const rule = asRecord(item.expectation?.rule);
  if (!rule) return null;
  const config = TEXT_BAG_RULES[item.type as keyof typeof TEXT_BAG_RULES];
  if (!config) return null;
  const bag = asRecord(rule[config.field]);
  if (!bag) return null;
  const entries = Object.entries(bag).flatMap(([target, count]) => {
    const numericCount = asNumber(count);
    return numericCount == null ? [] : [{ target, count: numericCount }];
  });
  return entries.length ? { entries, kind: config.kind, mode: config.mode } : null;
}

function decodePythonStringBody(value: string) {
  return value.replace(/\\([\\'"nrt])/gu, (_match, escaped: string) => {
    if (escaped === "n") return "\n";
    if (escaped === "r") return "\r";
    if (escaped === "t") return "\t";
    return escaped;
  });
}

export function retainedTextComparisons(outcome: DiagnosticOutcome | null) {
  const explanation = outcomeExplanation(outcome);
  if (!explanation) return [];
  const comparisons: RetainedTextComparison[] = [];
  const pattern = /(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")(?: \[len=(\d+), sha1=[^\]]+\])? \((\d+)(?:([<>])(\d+)|x)\)/gu;
  for (const match of explanation.matchAll(pattern)) {
    const actualCount = Number(match[4]);
    const expectedCount = match[6] == null ? null : Number(match[6]);
    if (!Number.isFinite(actualCount) || (expectedCount != null && !Number.isFinite(expectedCount))) {
      continue;
    }
    comparisons.push({
      actualCount,
      compacted: Number(match[3]) > 96,
      expectedCount,
      target: decodePythonStringBody(match[1] ?? match[2] ?? ""),
    });
  }
  return comparisons;
}

export function comparisonMatchesTarget(comparison: RetainedTextComparison, target: string) {
  const retainedTarget = normalizedComparisonTarget(comparison.target);
  const expectedTarget = normalizedComparisonTarget(target);
  if (retainedTarget === expectedTarget) return true;
  if (!comparison.compacted || !comparison.target.includes("…")) return false;
  const ellipsis = comparison.target.indexOf("…");
  const start = normalizedComparisonTarget(comparison.target.slice(0, ellipsis));
  const end = normalizedComparisonTarget(comparison.target.slice(ellipsis + 1));
  return expectedTarget.startsWith(start) && expectedTarget.endsWith(end);
}

export function specificTextEvidence(items: EvidenceItem[]) {
  const evidence = new Map<string, EvidenceItem[]>();
  for (const item of items) {
    const field = item.type === "missing_specific_sentence"
      ? "sentence"
      : item.type === "missing_specific_word"
        ? "word"
        : null;
    if (!field) continue;
    const target = asString(asRecord(item.expectation?.rule)?.[field]);
    if (!target) continue;
    const key = `${item.page ?? "all"}:${field}:${normalizedComparisonTarget(target)}`;
    evidence.set(key, [...(evidence.get(key) ?? []), item]);
  }
  return evidence;
}

export function specificMatcherStatus(item: EvidenceItem | null): EvidenceStatus {
  if (!item?.outcome) return "unknown";
  if (item.outcome.passed === true) return "passed";
  const explanation = outcomeExplanation(item.outcome);
  if (
    item.outcome.passed === false &&
    explanation != null &&
    /^Missing specific (?:sentence|word):/iu.test(explanation)
  ) {
    return "failed";
  }
  return "unknown";
}

export function textBagSearchText(item: EvidenceItem) {
  return textBagDefinition(item)?.entries.map((entry) => entry.target).join(" ") ?? "";
}

export function textBagNoun(kind: TextBagKind, count: number) {
  const singular = kind === "digit" ? "digit" : kind;
  return count === 1 ? singular : `${singular}s`;
}
