import { humanize } from "../lib/data";
import { scorePercent, scoreTone, scoreWidth } from "./format";
import type { ArtifactState } from "./types";

export function StatusBadge({ value }: { value: string | null }) {
  const normalized = value ?? "unknown";
  return (
    <span className={`status-badge status-${normalized}`}>
      <span className="status-dot" />
      {humanize(normalized)}
    </span>
  );
}

export function ScoreBar({ score }: { score: number | null | undefined }) {
  return (
    <div className="score-track" aria-label={`Score ${scorePercent(score)}`}>
      <span
        className={`score-fill score-fill-${scoreTone(score)}`}
        style={{ width: scoreWidth(score) }}
      />
    </div>
  );
}

export function EmptyMarkdownArtifact({
  state,
}: {
  state: ArtifactState["markdownState"];
}) {
  if (state === "empty") {
    return <EmptyState title="Parser returned empty Markdown" />;
  }
  if (state === "not_retained") {
    return (
      <EmptyState
        title="Extracted Markdown was not retained"
        body="The result artifact does not contain a document- or page-level Markdown field, so the dashboard cannot determine what the parser produced."
      />
    );
  }
  return <EmptyState title="No extracted Markdown" body="The extracted-output state is unavailable." />;
}

export function EmptyState({
  title,
  body,
}: {
  title: string;
  body?: string;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {body && <p>{body}</p>}
    </div>
  );
}
