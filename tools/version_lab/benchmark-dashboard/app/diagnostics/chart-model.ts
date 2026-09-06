import { asNumber, scorePercent } from "./model";

const CHART_PREVIEW_LIMIT = 12;

export function chartArrayPreview(value: unknown) {
  const rows = Array.isArray(value)
    ? value.filter((row): row is unknown[] => Array.isArray(row))
    : [];
  const columns = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  return {
    preview: rows.slice(0, CHART_PREVIEW_LIMIT).map((row) => row.slice(0, CHART_PREVIEW_LIMIT)),
    summary: rows.length ? `${Math.max(rows.length - 1, 0)} data rows × ${columns} columns` : "—",
    truncated: rows.length > CHART_PREVIEW_LIMIT || columns > CHART_PREVIEW_LIMIT,
  };
}

export function chartScoringDescription(type: string, rule: Record<string, unknown>) {
  const configuredMaxDiffs = asNumber(rule.max_diffs);
  if (type === "chart_data_point") {
    const tolerance = asNumber(rule.relative_tolerance) ?? 0.01;
    const maxDiffs = configuredMaxDiffs ?? 0;
    const normalizeNumbers = rule.normalize_numbers !== false;
    return [
      "Value and every label must be associated in one table",
      `number normalization ${normalizeNumbers ? "on" : "off"}`,
      normalizeNumbers ? `numeric tolerance ${scorePercent(tolerance)}` : null,
      `text edit allowance ${maxDiffs.toLocaleString()}`,
    ].filter(Boolean).join(" · ");
  }
  if (type === "chart_data_array_labels") {
    return [
      "Mean label similarity",
      rule.x_axis_shuffle === true ? "column order may change" : "column order must match",
      "best row/column orientation is used",
      configuredMaxDiffs == null
        ? null
        : `stored max_diffs ${configuredMaxDiffs.toLocaleString()} (not used by this array scorer)`,
    ].filter(Boolean).join(" · ");
  }
  if (type === "chart_data_array_data") {
    const normalizeNumbers = rule.normalize_numbers !== false;
    const order = [
      rule.x_axis_shuffle === true ? "columns may reorder" : "columns stay ordered",
      rule.y_axis_shuffle === true ? "rows may reorder" : "rows stay ordered",
    ].join(" · ");
    return [
      "Mean data-cell similarity",
      order,
      `number normalization ${normalizeNumbers ? "on" : "off"}`,
      configuredMaxDiffs == null
        ? null
        : `stored max_diffs ${configuredMaxDiffs.toLocaleString()} (not used by this array scorer)`,
    ].filter(Boolean).join(" · ");
  }
  return "Evaluated as a structured chart rule against a Markdown or HTML table.";
}
