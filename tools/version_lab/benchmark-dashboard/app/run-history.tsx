"use client";

import { useState } from "react";
import type { BenchmarkRun, RunScoreIndex } from "./lib/data";
import { Icon } from "./ui/icons";

export function RunHistory({
  runs,
  scores,
  loading,
  onSelect,
}: {
  runs: BenchmarkRun[];
  scores: RunScoreIndex;
  loading: boolean;
  onSelect: (run: BenchmarkRun) => void;
}) {
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const history = runs
    .filter(
      (run) =>
        run.leaderboard_eligible &&
        run.artifact_state === "complete" &&
        run.effective_group === "all" &&
        Number.isFinite(scores[run.id]?.aggregate),
    )
    .sort(
      (a, b) =>
        new Date(a.source_created_at ?? 0).getTime() -
        new Date(b.source_created_at ?? 0).getTime(),
    )
    .slice(-24);
  const active = history.find((run) => run.id === focusedId) ?? history.at(-1);
  const activeScore = active ? scores[active.id]?.aggregate : null;

  return (
    <section
      className="run-history"
      aria-label="Recent full benchmark run scores"
    >
      <div className="history-heading">
        <span className="eyebrow">
          <span className="connection-dot" /> Across the run history
        </span>
        <Icon name="chart" size={19} />
      </div>
      <div className="history-reading">
        <strong>
          {loading
            ? "…"
            : activeScore == null
              ? "—"
              : `${(activeScore * 100).toFixed(2)}%`}
        </strong>
        <span>
          aggregate score
          <small>
            {active ? `Run #${active.github_run_id}` : "No eligible runs yet"}
          </small>
        </span>
      </div>
      <div className="history-plot">
        <span className="history-midline" aria-hidden="true" />
        <div className="history-bars">
          {history.map((run) => (
            <button
              key={run.id}
              type="button"
              className={
                run.id === active?.id
                  ? "history-bar history-bar-active"
                  : "history-bar"
              }
              style={{
                height: `${Math.max(3, (scores[run.id]?.aggregate ?? 0) * 100)}%`,
              }}
              aria-label={`Open workflow run ${run.github_run_id}, aggregate ${((scores[run.id]?.aggregate ?? 0) * 100).toFixed(2)} percent`}
              onMouseEnter={() => setFocusedId(run.id)}
              onMouseLeave={() => setFocusedId(null)}
              onFocus={() => setFocusedId(run.id)}
              onBlur={() => setFocusedId(null)}
              onClick={() => onSelect(run)}
            />
          ))}
        </div>
        <span className="history-scale" aria-hidden="true">
          100%<span>0%</span>
        </span>
      </div>
      <div className="history-caption">
        <span>
          {loading
            ? "Loading scores…"
            : `${history.length} recent eligible runs · all pipelines`}
        </span>
        <span>Oldest → newest</span>
      </div>
    </section>
  );
}
