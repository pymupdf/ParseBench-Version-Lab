import type {
  ArtifactLayoutBox,
  ArtifactMarkdownState,
  DocumentSort,
  HistoricalBestResult,
} from "../lib/data";
import type { DiagnosticArtifact } from "../diagnostics";

export type View = "runs" | "overview" | "triage" | "inspect";

export type MarkdownMode = "preview" | "source";

export type InspectorTab = "explain" | "output" | "original" | "expectations" | "best" | "json";

export type RunSort = "newest" | "oldest" | "largest" | "fastest";

export type ArtifactState = {
  loading: boolean;
  markdown: string;
  markdownState: ArtifactMarkdownState | "unknown";
  layoutBoxes: ArtifactLayoutBox[];
  url: string | null;
  error: string | null;
};

export type DiagnosticState = {
  loading: boolean;
  data: DiagnosticArtifact | null;
  url: string | null;
  error: string | null;
};

export type OriginalMarkdownState = {
  loading: boolean;
  markdown: string;
  error: string | null;
};

export type HistoricalBestState = {
  loading: boolean;
  data: HistoricalBestResult | null;
  evidenceStatus: "idle" | "loading" | "loaded";
  diagnostic: DiagnosticArtifact | null;
  diagnosticError: string | null;
  artifact: ArtifactState;
  error: string | null;
};

export type TriageFilters = {
  dimension: string;
  search: string;
  minimum: number;
  maximum: number;
  sort: DocumentSort;
  page: number;
};
