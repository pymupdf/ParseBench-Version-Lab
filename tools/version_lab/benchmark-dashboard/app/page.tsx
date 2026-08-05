"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import {
  artifactUrl,
  BenchmarkRun,
  CaseMetric,
  CaseResult,
  DimensionMetric,
  humanize,
  loadArtifact,
  loadCaseMetrics,
  loadDocuments,
  loadGroundTruth,
  loadRunBundle,
  loadRuns,
  pdfUrl,
  primaryMetricForDimension,
  RunBundle,
  RunDimension,
} from "./lib/data";

type View = "overview" | "documents";
type MarkdownMode = "preview" | "source";
type ArtifactState = {
  loading: boolean;
  markdown: string;
  reference: string | null;
  url: string | null;
  error: string | null;
};

const EMPTY_BUNDLE: RunBundle = {
  dimensions: [],
  metrics: [],
  components: [],
  errors: [],
};

const DIMENSION_LABELS: Record<string, string> = {
  chart: "Charts",
  layout: "Layout",
  table: "Tables",
  text_content: "Text content",
  text_formatting: "Formatting",
};

function scorePercent(value: number | null | undefined) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function scoreTone(value: number | null | undefined) {
  if (value == null) return "neutral";
  if (value < 0.45) return "critical";
  if (value < 0.75) return "warning";
  return "good";
}

function formatDate(value: string | null) {
  if (!value) return "Unknown time";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function shortSha(value: string | null | undefined) {
  return value ? value.slice(0, 8) : "unknown";
}

function countDocuments(bundle: RunBundle) {
  return bundle.dimensions.reduce(
    (total, dimension) => total + (dimension.total_examples ?? 0),
    0,
  );
}

function overallScore(bundle: RunBundle) {
  const scores = bundle.dimensions
    .map(
      (dimension) =>
        primaryMetricForDimension(dimension, bundle.metrics)?.metric_value,
    )
    .filter((value): value is number => typeof value === "number");
  if (!scores.length) return null;
  return scores.reduce((total, value) => total + value, 0) / scores.length;
}

function scoreWidth(value: number | null | undefined) {
  return `${Math.max(0, Math.min(100, (value ?? 0) * 100))}%`;
}

function StatusBadge({ value }: { value: string | null }) {
  const normalized = value ?? "unknown";
  return (
    <span className={`status-badge status-${normalized}`}>
      <span className="status-dot" />
      {humanize(normalized)}
    </span>
  );
}

function ScoreBar({ score }: { score: number | null | undefined }) {
  return (
    <div className="score-track" aria-label={`Score ${scorePercent(score)}`}>
      <span
        className={`score-fill score-fill-${scoreTone(score)}`}
        style={{ width: scoreWidth(score) }}
      />
    </div>
  );
}

function MarkdownPanel({ markdown }: { markdown: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function EmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function DimensionCard({
  dimension,
  metrics,
  onInspect,
}: {
  dimension: RunDimension;
  metrics: DimensionMetric[];
  onInspect: () => void;
}) {
  const metric = primaryMetricForDimension(dimension, metrics);
  return (
    <button className="dimension-card" onClick={onInspect} type="button">
      <p>{DIMENSION_LABELS[dimension.dimension] ?? humanize(dimension.dimension)}</p>
      <div className="dimension-score-row">
        <strong>{scorePercent(metric?.metric_value)}</strong>
        <span>{dimension.total_examples?.toLocaleString() ?? 0} records</span>
      </div>
      <ScoreBar score={metric?.metric_value} />
      <span className="metric-caption">
        {metric ? humanize(metric.metric_name) : "No aggregate score"}
      </span>
    </button>
  );
}

function Overview({
  bundle,
  documents,
  loading,
  inspectDimension,
  inspectDocument,
}: {
  bundle: RunBundle;
  documents: CaseResult[];
  loading: boolean;
  inspectDimension: (dimension: string) => void;
  inspectDocument: (result: CaseResult) => void;
}) {
  const overall = overallScore(bundle);
  const failed = bundle.dimensions.reduce(
    (total, dimension) => total + (dimension.failed ?? 0),
    0,
  );

  return (
    <main className="content-shell overview-shell">
      <section className="headline-grid" aria-label="Run headline numbers">
        <article className="headline-card headline-primary">
          <div className="headline-label">Composite view</div>
          <strong>{scorePercent(overall)}</strong>
          <p>Mean of available headline dimension scores</p>
        </article>
        <article className="headline-card">
          <div className="headline-label">Evaluations</div>
          <strong>{countDocuments(bundle).toLocaleString()}</strong>
          <p>Document-dimension records in this run</p>
        </article>
        <article className="headline-card">
          <div className="headline-label">Failed cases</div>
          <strong>{failed.toLocaleString()}</strong>
          <p>Cases that did not complete evaluation</p>
        </article>
        <article className="headline-card">
          <div className="headline-label">Recorded errors</div>
          <strong>{bundle.errors.length.toLocaleString()}</strong>
          <p>Workflow and inference errors retained in the index</p>
        </article>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Benchmark profile</span>
            <h2>Scores by evaluation dimension</h2>
          </div>
          <span className="section-hint">Select a score to inspect its lowest documents</span>
        </div>
        {loading ? (
          <div className="loading-panel">Loading score profile…</div>
        ) : bundle.dimensions.length ? (
          <div className="dimension-grid">
            {bundle.dimensions.map((dimension) => (
              <DimensionCard
                key={dimension.id}
                dimension={dimension}
                metrics={bundle.metrics}
                onInspect={() => inspectDimension(dimension.dimension)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No evaluation reports"
            body="This run has workflow metadata, but no dimension reports were indexed."
          />
        )}
      </section>

      <div className="overview-columns">
        <section className="section-block low-score-section">
          <div className="section-heading compact-heading">
            <div>
              <span className="eyebrow">Triage queue</span>
              <h2>Lowest-scoring documents</h2>
            </div>
            <button className="text-button" onClick={() => inspectDimension("all")} type="button">
              Open explorer ↗
            </button>
          </div>
          {documents.length ? (
            <div className="score-table">
              <div className="score-table-head">
                <span>Document</span><span>Dimension</span><span>Score</span>
              </div>
              {documents.slice(0, 8).map((result) => (
                <button
                  type="button"
                  className="score-table-row"
                  key={result.id}
                  onClick={() => inspectDocument(result)}
                >
                  <span className="document-cell">
                    <span>{result.benchmark_cases.test_id.split("/").at(-1)}</span>
                  </span>
                  <span className="dimension-pill">
                    {DIMENSION_LABELS[result.run_dimensions.dimension] ?? humanize(result.run_dimensions.dimension)}
                  </span>
                  <span className={`score-number score-${scoreTone(result.primary_score)}`}>
                    {scorePercent(result.primary_score)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title="No document scores" body="There are no granular results attached to this run." />
          )}
        </section>

        <aside className="overview-sidebar">
          <section className="section-block compact-block">
            <div className="section-heading compact-heading">
              <div>
                <span className="eyebrow">Provenance</span>
                <h2>Source stack</h2>
              </div>
            </div>
            <div className="component-list">
              {bundle.components.length ? bundle.components.map((component) => (
                <div className="component-row" key={component.id}>
                  <div>
                    <strong>{humanize(component.component)}</strong>
                    <span>{component.installed_version ?? component.requested_ref ?? "Unversioned"}</span>
                  </div>
                  <code>{shortSha(component.resolved_sha)}</code>
                </div>
              )) : <p className="muted-copy">No component metadata was available.</p>}
            </div>
          </section>

          <section className="section-block compact-block">
            <div className="section-heading compact-heading">
              <div>
                <span className="eyebrow">Diagnostics</span>
                <h2>Run errors</h2>
              </div>
            </div>
            {bundle.errors.length ? (
              <div className="error-list">
                {bundle.errors.slice(0, 5).map((error) => (
                  <div className="error-row" key={error.id}>
                    <span>{humanize(error.stage)}</span>
                    <p>{error.message}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="clean-run">No indexed errors for this run</div>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

function DocumentExplorer({
  bundle,
  documents,
  documentsLoading,
  selected,
  selectDocument,
  dimension,
  setDimension,
  search,
  setSearch,
  ceiling,
  setCeiling,
  artifact,
  caseMetrics,
}: {
  bundle: RunBundle;
  documents: CaseResult[];
  documentsLoading: boolean;
  selected: CaseResult | null;
  selectDocument: (result: CaseResult) => void;
  dimension: string;
  setDimension: (dimension: string) => void;
  search: string;
  setSearch: (search: string) => void;
  ceiling: number;
  setCeiling: (ceiling: number) => void;
  artifact: ArtifactState;
  caseMetrics: CaseMetric[];
}) {
  const [referenceSelectionFor, setReferenceSelectionFor] = useState<number | null>(null);
  const [markdownMode, setMarkdownMode] = useState<MarkdownMode>("preview");
  const visibleDocuments = documents.filter(
    (result) => result.primary_score != null && result.primary_score <= ceiling / 100,
  );
  const selectedPdf = selected ? pdfUrl(selected) : null;
  const hasReference = Boolean(artifact.reference?.trim());
  const showingReference = hasReference && referenceSelectionFor === selected?.id;
  const shownMarkdown = showingReference ? artifact.reference ?? "" : artifact.markdown;

  return (
    <main className="explorer-shell">
      <aside className="document-browser">
        <div className="browser-heading">
          <div>
            <span className="eyebrow">Low-score finder</span>
            <h2>Documents</h2>
          </div>
          <span className="result-count">{visibleDocuments.length}</span>
        </div>
        <label className="search-field compact-search">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search document name"
            aria-label="Search document name"
          />
        </label>
        <div className="filter-row">
          <label>
            <span>Dimension</span>
            <select value={dimension} onChange={(event) => setDimension(event.target.value)}>
              <option value="all">All dimensions</option>
              {bundle.dimensions.map((item) => (
                <option value={item.dimension} key={item.id}>
                  {DIMENSION_LABELS[item.dimension] ?? humanize(item.dimension)}
                </option>
              ))}
            </select>
          </label>
          <label className="ceiling-filter">
            <span>Score ≤ <strong>{ceiling}%</strong></span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={ceiling}
              onChange={(event) => setCeiling(Number(event.target.value))}
            />
          </label>
        </div>
        <div className="document-list">
          {documentsLoading ? (
            <div className="loading-list">Finding low scores…</div>
          ) : visibleDocuments.length ? (
            visibleDocuments.map((result) => (
              <button
                type="button"
                key={result.id}
                className={`document-row ${selected?.id === result.id ? "document-row-selected" : ""}`}
                onClick={() => selectDocument(result)}
              >
                <div className="document-row-main">
                  <div>
                    <strong>{result.benchmark_cases.test_id.split("/").at(-1)}</strong>
                    <span>{DIMENSION_LABELS[result.run_dimensions.dimension] ?? humanize(result.run_dimensions.dimension)}</span>
                  </div>
                </div>
                <span className={`document-score score-${scoreTone(result.primary_score)}`}>
                  {scorePercent(result.primary_score)}
                </span>
              </button>
            ))
          ) : (
            <EmptyState
              title="No matching low scores"
              body="Raise the score ceiling or change the dimension filter."
            />
          )}
        </div>
      </aside>

      <section className="inspection-workspace">
        {selected ? (
          <>
            <header className="inspection-header">
              <div className="inspection-title">
                <div className="breadcrumb">
                  <span>{DIMENSION_LABELS[selected.run_dimensions.dimension] ?? humanize(selected.run_dimensions.dimension)}</span>
                  <span>/</span>
                  <span>{selected.benchmark_cases.inference_group ?? "document"}</span>
                </div>
                <h2>{selected.benchmark_cases.test_id.split("/").at(-1)}</h2>
              </div>
              <div className="inspection-score">
                <span>Primary score</span>
                <strong className={`score-${scoreTone(selected.primary_score)}`}>
                  {scorePercent(selected.primary_score)}
                </strong>
                <small>{humanize(selected.primary_metric_name)}</small>
              </div>
              <div className="metric-strip">
                {caseMetrics.slice(0, 4).map((metric) => (
                  <div className="metric-chip" key={metric.id}>
                    <span>{humanize(metric.metric_name)}</span>
                    <strong>{scorePercent(metric.metric_value)}</strong>
                  </div>
                ))}
              </div>
            </header>

            <div className="comparison-grid">
              <article className="viewer-card pdf-card">
                <div className="viewer-toolbar">
                  <div>
                    <span className="viewer-kicker">Source document</span>
                    <strong>PDF preview</strong>
                  </div>
                  {selectedPdf && (
                    <a href={selectedPdf} target="_blank" rel="noreferrer" className="simple-link" aria-label="Open PDF in a new tab">
                      Open PDF ↗
                    </a>
                  )}
                </div>
                <div className="pdf-stage">
                  {selectedPdf ? (
                    <iframe src={selectedPdf} title={`PDF preview for ${selected.benchmark_cases.test_id}`} />
                  ) : (
                    <EmptyState title="PDF unavailable" body="This case does not include a dataset PDF locator." />
                  )}
                </div>
              </article>

              <article className="viewer-card output-card">
                <div className="viewer-toolbar output-toolbar">
                  {hasReference ? (
                    <div className="content-tabs" role="tablist" aria-label="Output comparison">
                      <button
                        role="tab"
                        aria-selected={!showingReference}
                        className={!showingReference ? "content-tab-active" : ""}
                        onClick={() => setReferenceSelectionFor(null)}
                        type="button"
                      >
                        Rendered output
                      </button>
                      <button
                        role="tab"
                        aria-selected={showingReference}
                        className={showingReference ? "content-tab-active" : ""}
                        onClick={() => setReferenceSelectionFor(selected.id)}
                        type="button"
                      >
                        Ground truth
                      </button>
                    </div>
                  ) : (
                    <div className="output-heading">
                      <span className="viewer-kicker">Evaluation result</span>
                      <strong>Rendered output</strong>
                    </div>
                  )}
                  <div className="viewer-actions">
                    <div className="mode-toggle" aria-label="Markdown display mode">
                      <button
                        className={markdownMode === "preview" ? "mode-active" : ""}
                        onClick={() => setMarkdownMode("preview")}
                        type="button"
                      >
                        Preview
                      </button>
                      <button
                        className={markdownMode === "source" ? "mode-active" : ""}
                        onClick={() => setMarkdownMode("source")}
                        type="button"
                      >
                        Source
                      </button>
                    </div>
                    {artifact.url && (
                      <a href={artifact.url} target="_blank" rel="noreferrer" className="simple-link" aria-label="Open result JSON">
                        JSON ↗
                      </a>
                    )}
                  </div>
                </div>
                <div className="markdown-stage">
                  {artifact.loading ? (
                    <div className="artifact-loading">Loading rendered artifact…</div>
                  ) : artifact.error ? (
                    <EmptyState title="Output unavailable" body={artifact.error} />
                  ) : shownMarkdown ? (
                    markdownMode === "preview" ? (
                      <MarkdownPanel markdown={shownMarkdown} />
                    ) : (
                      <pre className="markdown-source"><code>{shownMarkdown}</code></pre>
                    )
                  ) : (
                    <EmptyState title="No rendered markdown" body="The indexed result does not contain a markdown payload." />
                  )}
                </div>
              </article>
            </div>
          </>
        ) : (
          <EmptyState title="Select a document" body="Choose a low-scoring document to inspect its PDF and parser output." />
        )}
      </section>
    </main>
  );
}

export default function Home() {
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [runInput, setRunInput] = useState("");
  const [view, setView] = useState<View>("overview");
  const [bundle, setBundle] = useState<RunBundle>(EMPTY_BUNDLE);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [documents, setDocuments] = useState<CaseResult[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<CaseResult | null>(null);
  const [dimension, setDimension] = useState("all");
  const [search, setSearch] = useState("");
  const [ceiling, setCeiling] = useState(65);
  const [caseMetrics, setCaseMetrics] = useState<CaseMetric[]>([]);
  const [artifact, setArtifact] = useState<ArtifactState>({
    loading: false,
    markdown: "",
    reference: null,
    url: null,
    error: null,
  });

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;

  useEffect(() => {
    const controller = new AbortController();
    loadRuns(controller.signal)
      .then((loadedRuns) => {
        setRuns(loadedRuns);
        const params = new URLSearchParams(window.location.search);
        const requestedId = Number(params.get("run"));
        const requested = loadedRuns.find((run) => run.github_run_id === requestedId);
        const initial = requested ?? loadedRuns[0] ?? null;
        if (initial) {
          setSelectedRunId(initial.id);
          setRunInput(String(initial.github_run_id));
        }
        if (params.get("view") === "documents") setView("documents");
      })
      .catch((error: Error) => setLoadError(error.message))
      .finally(() => setRunsLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedRun) return;
    const controller = new AbortController();
    // This reset intentionally belongs to the selected-run synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBundleLoading(true);
    setBundle(EMPTY_BUNDLE);
    loadRunBundle(selectedRun.id, controller.signal)
      .then(setBundle)
      .catch((error: Error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      })
      .finally(() => setBundleLoading(false));
    return () => controller.abort();
  }, [selectedRun]);

  useEffect(() => {
    if (!selectedRun) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setDocumentsLoading(true);
      loadDocuments(
        selectedRun.id,
        { dimension, search, limit: 240 },
        controller.signal,
      )
        .then((loadedDocuments) => {
          setDocuments(loadedDocuments);
          setSelectedDocument((current) =>
            loadedDocuments.find((document) => document.id === current?.id) ??
            loadedDocuments.find((document) => document.primary_score != null) ??
            null,
          );
        })
        .catch((error: Error) => {
          if (error.name !== "AbortError") setLoadError(error.message);
        })
        .finally(() => setDocumentsLoading(false));
    }, search ? 280 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [selectedRun, dimension, search]);

  useEffect(() => {
    if (!selectedRun || !selectedDocument) {
      return;
    }
    const controller = new AbortController();
    // This reset intentionally belongs to the selected-document synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setArtifact({
      loading: true,
      markdown: "",
      reference: null,
      url: artifactUrl(selectedRun, selectedDocument.result_relative_path),
      error: null,
    });
    Promise.all([
      loadArtifact(selectedRun, selectedDocument, controller.signal),
      loadCaseMetrics(selectedDocument.id, controller.signal),
      loadGroundTruth(selectedDocument),
    ])
      .then(([loadedArtifact, metrics, reference]) => {
        setCaseMetrics(metrics);
        setArtifact({
          loading: false,
          markdown: loadedArtifact.markdown,
          reference,
          url: loadedArtifact.url,
          error: null,
        });
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") {
          setArtifact((current) => ({ ...current, loading: false, error: error.message }));
        }
      });
    return () => controller.abort();
  }, [selectedRun, selectedDocument]);

  useEffect(() => {
    if (!selectedRun) return;
    const params = new URLSearchParams(window.location.search);
    params.set("run", String(selectedRun.github_run_id));
    params.set("view", view);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  }, [selectedRun, view]);

  const runOptions = useMemo(
    () =>
      runs.map((run) => ({
        value: String(run.github_run_id),
        label: `#${run.github_run_id} · ${run.pipeline_name ?? "No pipeline"} · ${formatDate(run.source_created_at)}`,
      })),
    [runs],
  );

  function selectRun(event: FormEvent) {
    event.preventDefault();
    const candidate = runs.find(
      (run) => String(run.github_run_id) === runInput.trim().replace(/^#/, ""),
    );
    if (!candidate) {
      setLoadError(`Workflow run ${runInput || "ID"} is not in the benchmark index.`);
      return;
    }
    setLoadError(null);
    setSelectedRunId(candidate.id);
    setRunInput(String(candidate.github_run_id));
    setDimension("all");
    setSearch("");
    setSelectedDocument(null);
  }

  function showView(nextView: View) {
    setView(nextView);
  }

  function inspectDimension(nextDimension: string) {
    setDimension(nextDimension);
    setSearch("");
    setView("documents");
  }

  function inspectDocument(result: CaseResult) {
    setDimension(result.run_dimensions.dimension);
    setSelectedDocument(result);
    setView("documents");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="ParseBench run observatory home">
          <span><strong>ParseBench</strong><small>Run Observatory</small></span>
        </Link>
        <nav className="view-nav" aria-label="Dashboard sections">
          <button type="button" className={view === "overview" ? "view-nav-active" : ""} onClick={() => showView("overview")}>
            Overview
          </button>
          <button type="button" className={view === "documents" ? "view-nav-active" : ""} onClick={() => showView("documents")}>
            Document explorer
          </button>
        </nav>
        <div className="data-source"><span>Live benchmark index</span></div>
      </header>

      <section className="run-command-bar">
        <div className="run-context">
          <span className="eyebrow">Selected workflow run</span>
          {selectedRun ? (
            <div className="run-title-row">
              <h1>Run #{selectedRun.github_run_id}</h1>
              <StatusBadge value={selectedRun.conclusion} />
              <span className="artifact-badge">{humanize(selectedRun.artifact_state)} artifacts</span>
            </div>
          ) : (
            <h1>{runsLoading ? "Loading latest run…" : "No benchmark run selected"}</h1>
          )}
          {selectedRun && (
            <div className="run-meta">
              <span>{formatDate(selectedRun.source_created_at)}</span>
              <span>{selectedRun.pipeline_name ?? "No pipeline"}</span>
              <span>{selectedRun.head_branch ?? "Unknown branch"} · {shortSha(selectedRun.head_sha)}</span>
              {selectedRun.github_run_url && (
                <a href={selectedRun.github_run_url} target="_blank" rel="noreferrer">Open in GitHub ↗</a>
              )}
            </div>
          )}
        </div>
        <form className="run-selector" onSubmit={selectRun}>
          <label htmlFor="run-id">Workflow run ID</label>
          <div className="run-selector-controls">
            <div className="run-input-wrap">
              <input
                id="run-id"
                list="run-options"
                inputMode="numeric"
                value={runInput}
                onChange={(event) => setRunInput(event.target.value)}
                placeholder="Enter a GitHub run ID"
              />
              <datalist id="run-options">
                {runOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </datalist>
            </div>
            <button type="submit" disabled={runsLoading}>Load run</button>
          </div>
          <span>{runs.length} indexed workflow runs · latest selected by default</span>
        </form>
      </section>

      {loadError && (
        <div className="global-alert" role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}

      {selectedRun ? (
        view === "overview" ? (
          <Overview
            bundle={bundle}
            documents={documents}
            loading={bundleLoading}
            inspectDimension={inspectDimension}
            inspectDocument={inspectDocument}
          />
        ) : (
          <DocumentExplorer
            bundle={bundle}
            documents={documents}
            documentsLoading={documentsLoading}
            selected={selectedDocument}
            selectDocument={setSelectedDocument}
            dimension={dimension}
            setDimension={setDimension}
            search={search}
            setSearch={setSearch}
            ceiling={ceiling}
            setCeiling={setCeiling}
            artifact={artifact}
            caseMetrics={caseMetrics}
          />
        )
      ) : (
        <main className="content-shell">
          <EmptyState title="Connecting to the benchmark index" body="The newest indexed workflow run will appear automatically." />
        </main>
      )}
    </div>
  );
}
