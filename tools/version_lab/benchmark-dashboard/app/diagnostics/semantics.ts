import type { DiagnosticArtifact, DiagnosticExpectation, DiagnosticOutcome } from "./types";

export type LayoutElementHeadlineStatus = "passed" | "failed" | "unknown";

function recordValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function truthyFlag(value: unknown) {
  if (value === true || value === 1) return true;
  return typeof value === "string" && ["true", "1", "yes", "y"].includes(value.trim().toLowerCase());
}

export function diagnosticUsesElementLayout(diagnostic: DiagnosticArtifact | null) {
  if (diagnostic?.dimension !== "layout") return false;
  if (diagnostic.evaluation_kind === "layout_elements") return true;
  // Early v3 artifacts classified mixed expectation sets before consulting the
  // primary metric. Preserve their scoring mode without restoring v1/v2
  // inference throughout the UI.
  return diagnostic.evaluation_kind === "layout_mixed" &&
    diagnostic.primary_metric?.name === "layout_element_rule_pass_rate";
}

export function layoutExpectationIgnored(expectation: DiagnosticExpectation) {
  const rule = recordValue(expectation.rule);
  const attributes = recordValue(rule?.attributes);
  return truthyFlag(expectation.ignore) || truthyFlag(rule?.ignore) || truthyFlag(attributes?.ignore);
}

export function layoutElementHeadlineStatus(
  outcome: DiagnosticOutcome | Record<string, unknown>,
): LayoutElementHeadlineStatus {
  const localization = outcome.localization_pass;
  const classification = outcome.classification_pass;
  const attributionApplicable = outcome.attribution_applicable;
  if (
    typeof localization !== "boolean" ||
    typeof classification !== "boolean" ||
    typeof attributionApplicable !== "boolean"
  ) {
    return "unknown";
  }

  const attribution = outcome.attribution_pass;
  if (attributionApplicable && typeof attribution !== "boolean") return "unknown";
  return localization && classification && (!attributionApplicable || attribution)
    ? "passed"
    : "failed";
}
