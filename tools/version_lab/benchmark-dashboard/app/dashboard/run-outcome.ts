import type { BenchmarkRun } from "../lib/data";

export function runOutcome(
  run: Pick<BenchmarkRun, "conclusion" | "status" | "artifact_state">,
) {
  const conclusion = run.conclusion ?? run.status;
  if (["failure", "timed_out", "startup_failure"].includes(conclusion)) {
    return {
      label:
        conclusion === "timed_out" ? "Workflow timed out" : "Workflow failed",
      action: "View failure details",
      tone: "failed",
    };
  }
  if (conclusion === "action_required") {
    return {
      label: "Action required",
      action: "View run details",
      tone: "pending",
    };
  }
  if (conclusion === "cancelled") {
    return {
      label: "Workflow cancelled",
      action: "View run details",
      tone: "cancelled",
    };
  }
  if (
    ["in_progress", "queued", "waiting", "requested", "pending"].includes(
      run.status,
    )
  ) {
    return {
      label:
        run.status === "in_progress"
          ? "Workflow in progress"
          : "Workflow pending",
      action: "View run progress",
      tone: "pending",
    };
  }
  return {
    label:
      run.artifact_state === "partial"
        ? "Results incomplete"
        : "Scores unavailable",
    action: "View run details",
    tone: "incomplete",
  };
}

export function unscoredRunDescription(
  run: Pick<BenchmarkRun, "artifact_state">,
) {
  if (run.artifact_state === "unavailable")
    return "Benchmark artifacts are unavailable. No scores are indexed.";
  if (run.artifact_state === "partial")
    return "Partial artifacts are retained. No scores are indexed.";
  return "No benchmark scores are indexed for this attempt.";
}
