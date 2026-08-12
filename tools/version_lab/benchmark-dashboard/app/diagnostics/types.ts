type DiagnosticDimension =
  | "table"
  | "chart"
  | "layout"
  | "text_content"
  | "text_formatting"
  | (string & {});

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

export type DiagnosticArtifact = {
  schema_version: 1 | 2 | "1" | "2";
  test_id: string;
  dimension: DiagnosticDimension;
  source: DiagnosticSource | null;
  dataset_file?: string | null;
  primary_metric: DiagnosticPrimaryMetric | null;
  metrics: DiagnosticMetric[];
  expectations: DiagnosticExpectation[];
  summary: JsonObject;
  outcomes?: DiagnosticOutcome[] | null;
};
