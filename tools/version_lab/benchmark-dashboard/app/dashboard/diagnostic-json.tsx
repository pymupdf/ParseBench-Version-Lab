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
    <details className={className} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {label}
        {code && <code>{code}</code>}
      </summary>
      {open && <pre><code>{JSON.stringify(value, null, 2)}</code></pre>}
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
          onClick={() => setVisible((current) => current + DIAGNOSTIC_LIST_PAGE_SIZE)}
        >
          Show {Math.min(DIAGNOSTIC_LIST_PAGE_SIZE, items.length - rendered.length)} more · {(items.length - rendered.length).toLocaleString()} remaining
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
      ...(ruleResults.length ? { rule_results: `${ruleResults.length.toLocaleString()} entries shown below` } : {}),
    },
  };
  return (
    <details className="expectation-row diagnostic-json-metric" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <strong>{humanize(metric.metric_name)}</strong>
        <code>{diagnosticMetricDisplay(metric)}</code>
      </summary>
      {open && (
        <>
          <pre><code>{JSON.stringify(compactMetric, null, 2)}</code></pre>
          {ruleResults.length > 0 && (
            <PaginatedJsonList
              items={ruleResults}
              labelFor={(outcome, index) => {
                const record = typeof outcome === "object" && outcome !== null && !Array.isArray(outcome)
                  ? outcome as Record<string, unknown>
                  : null;
                return <strong>{humanize(String(record?.type ?? `Outcome ${index + 1}`))}</strong>;
              }}
              codeFor={(outcome, index) => {
                const record = typeof outcome === "object" && outcome !== null && !Array.isArray(outcome)
                  ? outcome as Record<string, unknown>
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

export function DiagnosticJsonBrowser({ diagnostic }: { diagnostic: DiagnosticArtifact }) {
  const { metrics, expectations, outcomes, ...manifest } = diagnostic;
  return (
    <div className="diagnostic-json-browser">
      <dl className="diagnostic-json-summary">
        <div><dt>Schema</dt><dd>v{diagnostic.schema_version}</dd></div>
        <div><dt>Metrics</dt><dd>{metrics.length.toLocaleString()}</dd></div>
        <div><dt>Expectations</dt><dd>{expectations.length.toLocaleString()}</dd></div>
        <div><dt>Outcomes</dt><dd>{outcomes?.length.toLocaleString() ?? "In metrics"}</dd></div>
      </dl>
      <section className="diagnostic-json-section">
        <h3>Manifest</h3>
        <LazyJsonDetails label={<strong>Run and source metadata</strong>} value={manifest} />
      </section>
      <section className="diagnostic-json-section">
        <h3>Metrics</h3>
        <div className="expectation-list diagnostic-json-items">
          {metrics.map((metric, index) => (
            <DiagnosticMetricJson key={`${metric.metric_name}-${index}`} metric={metric} />
          ))}
        </div>
      </section>
      <section className="diagnostic-json-section">
        <h3>Expectations</h3>
        <PaginatedJsonList
          items={expectations}
          labelFor={(expectation) => <strong>{humanize(expectation.type)}</strong>}
          codeFor={(expectation) => expectation.id}
        />
      </section>
      {outcomes && outcomes.length > 0 && (
        <section className="diagnostic-json-section">
          <h3>Top-level outcomes</h3>
          <PaginatedJsonList
            items={outcomes}
            labelFor={(outcome, index) => <strong>{humanize(String(outcome.type ?? `Outcome ${index + 1}`))}</strong>}
            codeFor={(outcome, index) => String(outcome.id ?? outcome.rule_id ?? index + 1)}
          />
        </section>
      )}
    </div>
  );
}
