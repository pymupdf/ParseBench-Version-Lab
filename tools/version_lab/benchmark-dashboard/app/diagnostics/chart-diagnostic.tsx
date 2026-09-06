"use client";

import { useState } from "react";

import {
  asRecord,
  buildEvidenceItems,
  evidenceStatus,
  humanize,
  outcomeExplanation,
  scalarDisplay,
  scorePercent,
  type DiagnosticInspectorProps,
  type EvidenceItem,
  type EvidenceStatus,
} from "./model";
import { chartArrayPreview, chartScoringDescription } from "./chart-model";
import { EmptyDiagnostics, StatusPill } from "./primitives";

const CHART_CHECK_LABELS: Record<string, string> = {
  chart_data_point: "Data point",
  chart_data_array_labels: "Series labels",
  chart_data_array_data: "Series values",
};

function chartCheckLabel(type: string) {
  return CHART_CHECK_LABELS[type] ?? humanize(type);
}

export function ChartScoringContract() {
  return (
    <aside className="diagnostic-contract-note chart-scoring-contract">
      <strong>Chart data must be in a table</strong>
      <p>
        The evaluator looks only inside structured Markdown or HTML tables. A
        label or value that appears elsewhere in ordinary page text does not
        satisfy a chart check. The headline is the mean of the per-rule scores
        below, so array rules can earn partial credit.
      </p>
    </aside>
  );
}

function ChartExpectedData({ item }: { item: EvidenceItem }) {
  const [showComplete, setShowComplete] = useState(false);
  const rule = asRecord(item.expectation?.rule) ?? {};
  const { preview: matrix, summary, truncated } = chartArrayPreview(rule.data);
  const labels = Array.isArray(rule.labels) ? rule.labels : (matrix[0] ?? []);
  const value = rule.value;

  if (!item.expectation) {
    return (
      <EmptyDiagnostics
        title="Expected data unavailable"
        message="This result retains an outcome without its original chart expectation. The outcome is still shown below."
      />
    );
  }

  return (
    <section className="chart-expected-data" aria-label="Expected chart data">
      <header>
        <div>
          <span className="diagnostic-eyebrow">Ground truth</span>
          <h4>Expected chart data</h4>
        </div>
        {matrix.length > 0 && <span>{summary}</span>}
      </header>
      {labels.length > 0 && (
        <div className="chart-labels">
          <span>
            {item.type === "chart_data_point"
              ? "Associated labels"
              : "Column labels"}
          </span>
          <ul>
            {labels.map((label, index) => (
              <li key={index}>{scalarDisplay(label)}</li>
            ))}
          </ul>
        </div>
      )}
      {value != null && (
        <div className="chart-expected-value">
          <span>Expected value</span>
          <strong>{scalarDisplay(value)}</strong>
        </div>
      )}
      {matrix.length > 0 && (
        <div
          className="diagnostic-table-scroll chart-expected-matrix"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Enables keyboard scrolling of a wide matrix.
          tabIndex={0}
          role="region"
          aria-label="Expected data matrix"
        >
          <table>
            <caption className="sr-only">
              Expected values for {chartCheckLabel(item.type)}
            </caption>
            <thead>
              <tr>
                {matrix[0].map((cell, cellIndex) => (
                  <th scope="col" key={cellIndex}>
                    {scalarDisplay(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.slice(1).map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{scalarDisplay(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {truncated && (
        <details
          className="chart-complete-data"
          open={showComplete}
          onToggle={(event) => setShowComplete(event.currentTarget.open)}
        >
          <summary>
            Preview limited to 12 rows and columns · view complete expected data
          </summary>
          {showComplete && <pre>{JSON.stringify(rule.data, null, 2)}</pre>}
        </details>
      )}
      {!labels.length && value == null && !matrix.length && (
        <p className="diagnostic-empty">
          This expectation has no retained labels, scalar value, or data matrix.
        </p>
      )}
    </section>
  );
}

function ChartCheckDetail({
  item,
  index,
}: {
  item: EvidenceItem;
  index: number;
}) {
  const rule = asRecord(item.expectation?.rule) ?? {};
  const status = evidenceStatus(item.outcome);
  const explanation = outcomeExplanation(item.outcome);
  const method = chartScoringDescription(item.type, rule).split(" · ");
  const score = item.outcome?.score;

  return (
    <article className={`chart-check-detail chart-check-detail-${status}`}>
      <header className="chart-check-heading">
        <div>
          <span className="diagnostic-eyebrow">
            Check {String(index + 1).padStart(2, "0")}
            {item.page != null ? ` · Page ${item.page}` : ""}
          </span>
          <h3>{chartCheckLabel(item.type)}</h3>
        </div>
        <div className="chart-check-score">
          <StatusPill status={status} />
          <strong>{scorePercent(score)}</strong>
        </div>
      </header>
      <ChartExpectedData item={item} />
      <section
        className={`chart-outcome-story chart-outcome-story-${status}`}
        aria-label="Chart check outcome"
      >
        <span className="chart-outcome-mark" aria-hidden="true">
          {status === "passed"
            ? "✓"
            : status === "failed"
              ? "×"
              : status === "partial"
                ? "≈"
                : "?"}
        </span>
        <div>
          <h4>
            {status === "passed"
              ? "This check passed"
              : status === "partial"
                ? "Part of this check matched"
                : status === "failed"
                  ? "This check did not pass"
                  : "Outcome not established"}
          </h4>
          <p>
            {explanation ??
              (status === "unknown"
                ? "No conclusive result was retained for this expectation. It is not treated as a successful match."
                : "The artifact retained the result shown above without a detailed explanation. Inspect the expected data and matching criteria to investigate this check.")}
          </p>
          {item.outcome?.observed != null && (
            <details className="chart-observed-data">
              <summary>Retained observed data</summary>
              <pre>
                {typeof item.outcome.observed === "string"
                  ? item.outcome.observed
                  : JSON.stringify(item.outcome.observed, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </section>
      <details className="chart-matching-criteria">
        <summary>
          <span>Matching criteria</span>
          <span>{method[0]}</span>
        </summary>
        <ul>
          {method.map((description) => (
            <li key={description}>{description}</li>
          ))}
        </ul>
      </details>
    </article>
  );
}

type ChartFilter = "all" | "review" | "passed" | "unknown";

export function ChartDiagnostic({
  diagnostic,
  selectedEvidenceId,
  onSelectEvidence,
}: DiagnosticInspectorProps) {
  const [filter, setFilter] = useState<ChartFilter>("all");
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const items = buildEvidenceItems(diagnostic);
  const counts: Record<EvidenceStatus, number> = {
    passed: 0,
    failed: 0,
    partial: 0,
    unknown: 0,
  };
  for (const item of items) counts[evidenceStatus(item.outcome)] += 1;
  const filters: Array<{ value: ChartFilter; label: string; count: number }> = [
    { value: "all", label: "All checks", count: items.length },
    {
      value: "review",
      label: "Needs review",
      count: counts.failed + counts.partial,
    },
    { value: "passed", label: "Passed", count: counts.passed },
    { value: "unknown", label: "Unknown", count: counts.unknown },
  ];
  const filteredItems = items.filter((item) => {
    const status = evidenceStatus(item.outcome);
    return (
      filter === "all" ||
      (filter === "review"
        ? status === "failed" || status === "partial"
        : status === filter)
    );
  });
  const selectedId = selectedEvidenceId ?? localSelectedId;
  const activeItem =
    filteredItems.find((item) => item.id === selectedId) ?? filteredItems[0];

  if (!items.length)
    return (
      <EmptyDiagnostics message="No chart expectations were retained for this result." />
    );
  return (
    <section
      className="diagnostic-dimension-view diagnostic-chart-view"
      aria-labelledby="diagnostic-chart-heading"
    >
      <div className="dimension-workspace-heading">
        <div>
          <span className="diagnostic-eyebrow">Labels, values & series</span>
          <h3 id="diagnostic-chart-heading">Chart extraction</h3>
        </div>
        <span className="dimension-workspace-badge">
          {items.length.toLocaleString()} checks
        </span>
      </div>
      <div className="dimension-workspace-toolbar">
        <div
          className="dimension-filter-control"
          role="group"
          aria-label="Filter chart checks"
        >
          {filters.map((option) => (
            <button
              type="button"
              key={option.value}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label} <span>{option.count}</span>
            </button>
          ))}
        </div>
      </div>
      {filteredItems.length ? (
        <>
          <div
            className="chart-check-navigator"
            role="group"
            aria-label="Chart checks"
          >
            {filteredItems.map((item) => {
              const status = evidenceStatus(item.outcome);
              const rule = asRecord(item.expectation?.rule) ?? {};
              const index = items.indexOf(item);
              return (
                <button
                  type="button"
                  key={item.id}
                  className={`chart-check-option chart-check-option-${status}`}
                  aria-pressed={activeItem?.id === item.id}
                  aria-controls="chart-active-check"
                  onClick={() => {
                    setLocalSelectedId(item.id);
                    onSelectEvidence?.(item.id);
                  }}
                >
                  <span className="chart-check-option-heading">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{chartCheckLabel(item.type)}</strong>
                  </span>
                  <span className="chart-check-option-preview">
                    {rule.value != null
                      ? scalarDisplay(rule.value)
                      : chartArrayPreview(rule.data).summary}
                  </span>
                  <span className="chart-check-option-result">
                    <span>{humanize(status)}</span>
                    <strong>{scorePercent(item.outcome?.score)}</strong>
                  </span>
                </button>
              );
            })}
          </div>
          {activeItem && (
            <div id="chart-active-check">
              <ChartCheckDetail
                key={activeItem.id}
                item={activeItem}
                index={items.indexOf(activeItem)}
              />
            </div>
          )}
        </>
      ) : (
        <EmptyDiagnostics
          title="No checks in this view"
          message="Choose another outcome filter or All checks to inspect the retained expectations."
        />
      )}
      <ChartScoringContract />
    </section>
  );
}
