type DiagnosticDimension =
  | "table"
  | "chart"
  | "layout"
  | "text_content"
  | "text_formatting"
  | (string & {});

export const DIAGNOSTIC_EVALUATION_KINDS = [
  "chart_rules",
  "layout_elements",
  "layout_mixed",
  "layout_order",
  "layout_rules",
  "rules",
  "table_comparison",
  "text_content",
  "text_formatting",
] as const;

export type DiagnosticEvaluationKind = typeof DIAGNOSTIC_EVALUATION_KINDS[number];

export function isDiagnosticEvaluationKind(value: unknown): value is DiagnosticEvaluationKind {
  return typeof value === "string" &&
    (DIAGNOSTIC_EVALUATION_KINDS as readonly string[]).includes(value);
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

type DiagnosticSource = {
  asset_url?: string | null;
  render_url?: string | null;
  media_type?: string | null;
  relative_path?: string | null;
  page?: number | null;
  width?: number | null;
  height?: number | null;
  [key: string]: JsonValue | undefined;
};

export type DiagnosticMetricComponent = {
  name?: string;
  metric_name?: string;
  label?: string;
  value: number;
  weight?: number;
  contribution?: number;
};

type DiagnosticPrimaryMetric = {
  name: string;
  value: number | null;
  formula?: JsonValue;
  components?: JsonValue;
};

export type DiagnosticMetric = {
  metric_name: string;
  value: number | null;
  metadata?: JsonObject | null;
  details?: string[] | null;
};

export type DiagnosticExpectation = {
  id: string;
  type: string;
  page?: number | null;
  tags?: string[];
  rule: JsonValue;
  expected_markdown?: string | null;
  [key: string]: JsonValue | undefined;
};

export type DiagnosticOutcome = {
  id?: string | null;
  rule_id?: string | null;
  type?: string | null;
  page?: number | null;
  tags?: string[];
  status?: string | null;
  passed?: boolean | null;
  score?: number | null;
  explanation?: string | null;
  expected?: JsonValue;
  observed?: JsonValue;
  source_reference?: JsonObject | null;
  output_reference?: JsonObject | null;
  [key: string]: JsonValue | undefined;
};

type DiagnosticHeadlineContribution = {
  primary_metric_name: string | null;
  kind: "component" | "diagnostic" | "primary";
  contributes: boolean;
  weight: number | null;
  normalized_weight: number | null;
};

type DiagnosticSummary = {
  headline_contribution: DiagnosticHeadlineContribution;
  [key: string]: JsonValue;
};

export type DiagnosticArtifact = {
  schema_version: 3;
  evaluation_kind: DiagnosticEvaluationKind;
  test_id: string;
  dimension: DiagnosticDimension;
  source: DiagnosticSource | null;
  dataset_file?: string | null;
  primary_metric: DiagnosticPrimaryMetric | null;
  metrics: DiagnosticMetric[];
  expectations: DiagnosticExpectation[];
  summary: DiagnosticSummary;
  outcomes?: DiagnosticOutcome[] | null;
};
