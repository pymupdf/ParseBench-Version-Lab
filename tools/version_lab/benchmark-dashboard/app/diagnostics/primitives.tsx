"use client";

import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { humanize, scorePercent, type EvidenceStatus } from "./model";
import type { RuleImpact } from "./rule-model";
import type { DiagnosticMetricComponent } from "./types";

export function StatusPill({ status, label }: { status: EvidenceStatus; label?: string }) {
  return (
    <span className={`diagnostic-status diagnostic-status-${status}`}>
      {label ?? humanize(status)}
    </span>
  );
}

export function MetricComponent({ component }: { component: DiagnosticMetricComponent }) {
  const name = component.label ?? component.name ?? component.metric_name ?? "Component";
  return (
    <div className="diagnostic-component">
      <span>{humanize(name)}</span>
      <strong>{scorePercent(component.value)}</strong>
      {component.weight != null && <small>{component.weight.toLocaleString()} weight</small>}
    </div>
  );
}

export function MarkdownEvidence({ markdown, empty }: { markdown: string; empty: string }) {
  if (!markdown.trim()) {
    return <p className="diagnostic-empty">{empty}</p>;
  }
  return (
    <div className="diagnostic-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

export function EvidenceButton({
  id,
  selected,
  onSelect,
  className,
  children,
}: {
  id: string;
  selected: boolean;
  onSelect?: (id: string) => void;
  className: string;
  children: ReactNode;
}) {
  if (!onSelect) {
    return <div className={`${className}${selected ? " diagnostic-evidence-selected" : ""}`}>{children}</div>;
  }
  return (
    <button
      type="button"
      className={`${className}${selected ? " diagnostic-evidence-selected" : ""}`}
      aria-pressed={selected}
      onClick={() => onSelect(id)}
    >
      {children}
    </button>
  );
}

export function EmptyDiagnostics({
  title = "Detailed evidence unavailable",
  message,
}: {
  title?: string;
  message: string;
}) {
  return (
    <div className="diagnostic-empty-state" role="status">
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}

export function RuleImpactLabel({ impact }: { impact: RuleImpact }) {
  return (
    <span className={`diagnostic-rule-impact diagnostic-rule-impact-${impact}`}>
      {impact === "headline" ? "Headline input" : "Supporting diagnostic"}
    </span>
  );
}
