import { type ReactNode, useState } from "react";
import { DIAGNOSTIC_LIST_PAGE_SIZE } from "./constants";
import type { DiagnosticMetric, DiagnosticArtifact } from "../diagnostics";
import { humanize } from "../lib/data";
import { diagnosticMetricDisplay } from "./format";

function LazyJsonDetails({
  label,
  code,
  value,
  className = "expectation-row",
}: {
  label: ReactNode;
  code?: string;
  value: unknown;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className={className}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {label}
        {code && <code>{code}</code>}
      </summary>
      {open && (
        <pre>
          <code>{JSON.stringify(value, null, 2)}</code>
        </pre>
      )}
    </details>
  );
}

function PaginatedJsonList<T>({
  items,
  labelFor,
  codeFor,
}: {
  items: T[];
  labelFor: (item: T, index: number) => ReactNode;
  codeFor?: (item: T, index: number) => string | undefined;
}) {
  const [visible, setVisible] = useState(DIAGNOSTIC_LIST_PAGE_SIZE);
  const rendered = items.slice(0, visible);
  return (
    <div className="expectation-list diagnostic-json-items">
      {rendered.map((item, index) => (
        <LazyJsonDetails
          key={`${codeFor?.(item, index) ?? "item"}-${index}`}
          label={labelFor(item, index)}
          code={codeFor?.(item, index)}
          value={item}
        />
      ))}
      {rendered.length < items.length && (
        <button
          className="diagnostic-load-more"
          type="button"
          onClick={() =>
            setVisible((current) => current + DIAGNOSTIC_LIST_PAGE_SIZE)
          }
        >
          Show{" "}
          {Math.min(DIAGNOSTIC_LIST_PAGE_SIZE, items.length - rendered.length)}{" "}
          more · {(items.length - rendered.length).toLocaleString()} remaining
        </button>
      )}
    </div>
  );
}

function DiagnosticMetricJson({ metric }: { metric: DiagnosticMetric }) {
  const [open, setOpen] = useState(false);
  const metadata = metric.metadata ?? {};
  const rawRuleResults = metadata.rule_results;
  const ruleResults = Array.isArray(rawRuleResults) ? rawRuleResults : [];
  const metadataWithoutRuleResults = { ...metadata };
  delete metadataWithoutRuleResults.rule_results;
  const compactMetric = {
    ...metric,
    metadata: {
      ...metadataWithoutRuleResults,
      ...(ruleResults.length
        ? {
            rule_results: `${ruleResults.length.toLocaleString()} entries shown below`,
          }
        : {}),
    },
  };
  return (
    <details
      className="expectation-row diagnostic-json-metric"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <strong>{humanize(metric.metric_name)}</strong>
        <code>{diagnosticMetricDisplay(metric)}</code>
      </summary>
      {open && (
        <>
          <pre>
            <code>{JSON.stringify(compactMetric, null, 2)}</code>
          </pre>
          {ruleResults.length > 0 && (
            <PaginatedJsonList
              items={ruleResults}
              labelFor={(outcome, index) => {
                const record =
                  typeof outcome === "object" &&
                  outcome !== null &&
                  !Array.isArray(outcome)
                    ? (outcome as Record<string, unknown>)
                    : null;
                return (
                  <strong>
                    {humanize(String(record?.type ?? `Outcome ${index + 1}`))}
                  </strong>
                );
              }}
              codeFor={(outcome, index) => {
                const record =
                  typeof outcome === "object" &&
                  outcome !== null &&
                  !Array.isArray(outcome)
                    ? (outcome as Record<string, unknown>)
                    : null;
                return String(record?.id ?? index + 1);
              }}
            />
          )}
        </>
      )}
    </details>
  );
}

type JsonSection = "metrics" | "expectations" | "outcomes" | "manifest";

export function DiagnosticJsonBrowser({
  diagnostic,
}: {
  diagnostic: DiagnosticArtifact;
}) {
  const { metrics, expectations, outcomes, ...manifest } = diagnostic;
  const [section, setSection] = useState<JsonSection>("metrics");
  const [query, setQuery] = useState("");
  const filteredMetrics = metrics.filter((metric) =>
    `${metric.metric_name} ${humanize(metric.metric_name)}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const sections: Array<{
    key: JsonSection;
    label: string;
    count: string | number;
  }> = [
    { key: "metrics", label: "Metrics", count: metrics.length },
    { key: "expectations", label: "Expectations", count: expectations.length },
    {
      key: "outcomes",
      label: "Outcomes",
      count: outcomes?.length ?? "In metrics",
    },
    {
      key: "manifest",
      label: "Manifest",
      count: `v${diagnostic.schema_version}`,
    },
  ];
  return (
    <div className="diagnostic-json-browser record-browser">
      <nav className="record-sections" aria-label="Diagnostic record sections">
        {sections.map((item) => (
          <button
            type="button"
            aria-pressed={section === item.key}
            onClick={() => setSection(item.key)}
            key={item.key}
          >
            <strong>{item.label}</strong>
            <span>{item.count}</span>
          </button>
        ))}
      </nav>
      <section
        className="diagnostic-json-section record-section"
        aria-label={sections.find((item) => item.key === section)?.label}
      >
        {section === "manifest" ? (
          <>
            <div className="record-section-heading">
              <h3>Run & source manifest</h3>
              <p>
                Dataset identity, source location, and scoring configuration.
              </p>
            </div>
            <LazyJsonDetails
              label={<strong>Run and source metadata</strong>}
              value={manifest}
            />
          </>
        ) : section === "metrics" ? (
          <>
            <div className="record-section-heading">
              <h3>Metric records</h3>
              <p>
                Expand a metric to inspect its value, metadata, and retained
                rule outcomes.
              </p>
            </div>
            <label className="record-search">
              Find a metric
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search metric names"
              />
            </label>
            <div className="expectation-list diagnostic-json-items">
              {filteredMetrics.length ? (
                filteredMetrics.map((metric, index) => (
                  <DiagnosticMetricJson
                    key={`${metric.metric_name}-${index}`}
                    metric={metric}
                  />
                ))
              ) : (
                <p className="record-empty">No metrics match “{query}”.</p>
              )}
            </div>
          </>
        ) : section === "expectations" ? (
          <>
            <div className="record-section-heading">
              <h3>Expected evidence</h3>
              <p>Ground-truth rules supplied to the evaluator.</p>
            </div>
            <PaginatedJsonList
              items={expectations}
              labelFor={(expectation) => (
                <strong>{humanize(expectation.type)}</strong>
              )}
              codeFor={(expectation) => expectation.id}
            />
          </>
        ) : (
          <>
            <div className="record-section-heading">
              <h3>Recorded outcomes</h3>
              <p>Observed results of the evaluation checks.</p>
            </div>
            {outcomes?.length ? (
              <PaginatedJsonList
                items={outcomes}
                labelFor={(outcome, index) => (
                  <strong>
                    {humanize(String(outcome.type ?? `Outcome ${index + 1}`))}
                  </strong>
                )}
                codeFor={(outcome, index) =>
                  String(outcome.id ?? outcome.rule_id ?? index + 1)
                }
              />
            ) : (
              <p className="record-empty">
                This artifact retains outcomes within its metric records. Open
                Metrics to inspect them.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
