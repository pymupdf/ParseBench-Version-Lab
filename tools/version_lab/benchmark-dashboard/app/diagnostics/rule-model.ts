import { asRecord, asString, humanize, scalarDisplay } from "./model";
import type { DiagnosticArtifact } from "./types";

export type RuleImpact = "headline" | "supporting";

export type RuleFacet = { key: string; label: string };

export type RuleFacetForType = (type: string, impact: RuleImpact) => RuleFacet;

export const RULE_IMPACTS: readonly RuleImpact[] = ["headline", "supporting"];

export const TEXT_GROUPS = [
  { key: "completeness", label: "Completeness" },
  { key: "unexpected", label: "Unexpected content" },
  { key: "duplicates", label: "Duplicates" },
  { key: "digits", label: "Digits" },
  { key: "order", label: "Reading order" },
  { key: "other", label: "Other checks" },
] as const;

export const FORMATTING_GROUPS = [
  { key: "titles", label: "Titles and hierarchy" },
  { key: "styling", label: "Text styling" },
  { key: "latex", label: "LaTeX" },
  { key: "code", label: "Code blocks" },
  { key: "other", label: "Other checks" },
] as const;

const CONTENT_HEADLINE_RULE_TYPES = new Set([
  "missing_word_percent",
  "unexpected_word_percent",
  "too_many_word_occurence_percent",
  "missing_sentence_percent",
  "unexpected_sentence_percent",
  "too_many_sentence_occurence_percent",
  "extra_content",
  "bag_of_digit_percent",
  "order",
]);

const FORMATTING_HEADLINE_RULE_TYPES = new Set([
  "is_bold",
  "is_not_bold",
  "is_strikeout",
  "is_not_strikeout",
  "is_sup",
  "is_not_sup",
  "is_sub",
  "is_not_sub",
  "is_title",
  "title_hierarchy_percent",
  "is_latex",
  "is_code_block",
]);

export function textGroup(type: string) {
  if (type.includes("order")) return "order";
  if (type.includes("digit")) return "digits";
  if (type.includes("too_many") || type.includes("occurrence")) return "duplicates";
  if (type.includes("unexpected") || type.includes("extra_content")) return "unexpected";
  if (type.includes("missing") || type.includes("presence") || type.includes("baseline")) return "completeness";
  return "other";
}

export function formattingGroup(type: string) {
  if (type.includes("title") || type.includes("hierarchy") || type.includes("page_section")) return "titles";
  if (type.includes("latex")) return "latex";
  if (type.includes("code_block")) return "code";
  if (["bold", "italic", "underline", "strikeout", "mark", "sup", "sub"].some((token) => type.includes(token))) {
    return "styling";
  }
  return "other";
}

function ruleFacet(family: string, impact: RuleImpact): RuleFacet {
  return {
    key: `${family.toLocaleLowerCase().replaceAll(" ", "-")}:${impact}`,
    label: `${family} · ${impact === "headline" ? "Headline" : "Supporting"}`,
  };
}

export const textFacetForType: RuleFacetForType = (type, impact) => {
  if (type.includes("sentence")) {
    if (type.includes("too_many")) return ruleFacet("Repeated sentences", impact);
    if (type.includes("unexpected")) return ruleFacet("Unexpected sentences", impact);
    if (type.includes("missing")) return ruleFacet("Missing sentences", impact);
  }
  if (type.includes("word")) {
    if (type.includes("too_many")) return ruleFacet("Repeated words", impact);
    if (type.includes("unexpected")) return ruleFacet("Unexpected words", impact);
    if (type.includes("missing")) return ruleFacet("Missing words", impact);
  }
  if (type.includes("digit")) return ruleFacet("Digits", impact);
  if (type.includes("order")) return ruleFacet("Reading order", impact);
  if (type.includes("extra_content")) return ruleFacet("Extra content", impact);
  return ruleFacet(humanize(type), impact);
};

export const formattingFacetForType: RuleFacetForType = (type, impact) => {
  if (type.includes("title_hierarchy")) return ruleFacet("Title hierarchy", impact);
  if (type.includes("title") || type.includes("page_section")) return ruleFacet("Titles", impact);
  if (type.includes("bold")) return ruleFacet("Bold", impact);
  if (type.includes("italic")) return ruleFacet("Italic", impact);
  if (type.includes("underline")) return ruleFacet("Underline", impact);
  if (type.includes("strikeout")) return ruleFacet("Strikeout", impact);
  if (type.includes("mark")) return ruleFacet("Highlight", impact);
  if (type.includes("sup")) return ruleFacet("Superscript", impact);
  if (type.includes("sub")) return ruleFacet("Subscript", impact);
  if (type.includes("latex")) return ruleFacet("LaTeX", impact);
  if (type.includes("code_block")) return ruleFacet("Code blocks", impact);
  return ruleFacet(humanize(type), impact);
};

export function ruleImpact(diagnostic: DiagnosticArtifact, type: string): RuleImpact {
  const primaryName = diagnostic.primary_metric?.name;
  if (primaryName === "rule_pass_rate") return "headline";
  if (primaryName === `rule_${type}_pass_rate`) return "headline";
  if (primaryName === "content_faithfulness") {
    return CONTENT_HEADLINE_RULE_TYPES.has(type) ? "headline" : "supporting";
  }
  if (primaryName === "semantic_formatting") {
    return FORMATTING_HEADLINE_RULE_TYPES.has(type) ? "headline" : "supporting";
  }
  return "supporting";
}

function ruleValueSummary(value: unknown) {
  if (typeof value === "string") {
    return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  }
  if (Array.isArray(value)) {
    if (value.length <= 4) return value.map((item) => scalarDisplay(item)).join(", ");
    return `${value.length.toLocaleString()} items`;
  }
  const record = asRecord(value);
  if (record) {
    const text = asString(record.text);
    if (text) return text.length > 120 ? `${text.slice(0, 117)}…` : text;
    return `${Object.keys(record).length.toLocaleString()} entries`;
  }
  return scalarDisplay(value);
}

export function expectedRuleSummary(value: unknown) {
  const rule = asRecord(value);
  if (!rule) return value == null
    ? "Expectation details unavailable"
    : `Expected: ${scalarDisplay(value)}`;
  const matcherBag = ([
    ["bag_of_sentence", "sentence"],
    ["bag_of_word", "word"],
    ["bag_of_digit", "digit"],
  ] as const).find(([key]) => asRecord(rule[key]) != null);
  if (matcherBag) {
    const count = Object.keys(asRecord(rule[matcherBag[0]]) ?? {}).length;
    const noun = count === 1 ? matcherBag[1] : `${matcherBag[1]}s`;
    return matcherBag[1] === "digit"
      ? `${count.toLocaleString()} expected digit ${count === 1 ? "count" : "counts"}`
      : `${count.toLocaleString()} expected ${noun}`;
  }
  const ignored = new Set([
    "id", "type", "page", "tags", "layout_id", "layout_ids", "layout_bindings", "original_md",
  ]);
  const values = Object.entries(rule)
    .filter(([key, value]) => !ignored.has(key) && value != null)
    .slice(0, 4)
    .map(([key, value]) => `${humanize(key)}: ${ruleValueSummary(value)}`);
  return values.join(" · ") || "No additional expectation parameters";
}

export function singleScalarRuleEntry(value: unknown): [string, string | number | boolean | null] | null {
  const rule = asRecord(value);
  if (!rule) return null;
  const entries = Object.entries(rule);
  if (entries.length !== 1) return null;
  const entry = entries[0];
  if (!entry) return null;
  const [key, scalar] = entry;
  if (
    scalar === null ||
    typeof scalar === "string" ||
    typeof scalar === "boolean" ||
    (typeof scalar === "number" && Number.isFinite(scalar))
  ) {
    return [key, scalar];
  }
  return null;
}
