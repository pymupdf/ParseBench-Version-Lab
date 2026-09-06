import type { RunBundle } from "../lib/data";
import type { ArtifactState, DiagnosticState, HistoricalBestState } from "./types";

export const ANY_GROUP = "__any_group__";

export const EMPTY_BUNDLE: RunBundle = {
  dimensions: [],
  metrics: [],
  components: [],
  errors: [],
};

export const EMPTY_ARTIFACT: ArtifactState = {
  loading: false,
  markdown: "",
  markdownState: "unknown",
  layoutBoxes: [],
  url: null,
  error: null,
};

export const EMPTY_DIAGNOSTIC: DiagnosticState = {
  loading: false,
  data: null,
  url: null,
  error: null,
};

export const EMPTY_HISTORICAL_BEST: HistoricalBestState = {
  data: null,
  evidenceStatus: "idle",
  diagnostic: null,
  diagnosticError: null,
  artifact: EMPTY_ARTIFACT,
  error: null,
};

export const BEST_SCORE_MINIMUM_IMPROVEMENT = 0.1;

export const DIMENSION_LABELS: Record<string, string> = {
  chart: "Charts",
  layout: "Layout",
  table: "Tables",
  text_content: "Text content",
  text_formatting: "Formatting",
};

export const DIMENSION_ORDER = [
  "table",
  "text_content",
  "text_formatting",
  "layout",
  "chart",
] as const;

export const DIMENSION_SHORT_LABELS: Record<(typeof DIMENSION_ORDER)[number], string> = {
  chart: "Chart",
  layout: "Layout",
  table: "Table",
  text_content: "Text",
  text_formatting: "Format",
};

export const TRIAGE_PAGE_SIZE = 60;

export const DIAGNOSTIC_LIST_PAGE_SIZE = 60;
