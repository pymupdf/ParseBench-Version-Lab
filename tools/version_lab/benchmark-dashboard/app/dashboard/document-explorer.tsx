import dynamic from "next/dynamic";
import { type EvidenceOverlayBox, EvidenceOverlay } from "../evidence-overlay";
import {
  useState,
  useMemo,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type CSSProperties,
} from "react";
import Image from "next/image";
import {
  humanize,
  loadSiblingOriginalMarkdown,
  originalMarkdownFromDiagnostic,
  sourceAssetKind,
  sourceAssetUrl,
  sourcePdfPreviewUrl,
  type BenchmarkRun,
  type CaseResult,
  type TriageCaseResult,
} from "../lib/data";
import type {
  ArtifactState,
  DiagnosticState,
  HistoricalBestState,
  InspectorTab,
  MarkdownMode,
  OriginalMarkdownState,
} from "./types";
import { layoutOverlayBoxes, LAYOUT_REGION_TONES } from "./layout-evidence";
import {
  alignedPrimaryMetric,
  diagnosticMetricDisplay,
  documentName,
  scorePercent,
} from "./format";
import { DIMENSION_LABELS } from "./constants";
import { Icon } from "../ui/icons";
import { EmptyState, EmptyMarkdownArtifact } from "./shared";
import {
  DiagnosticInspector,
  GroundTruthInspector,
} from "../diagnostics/lazy-inspectors";
import { MarkdownPanel } from "./markdown-panel";
import { BestResultPanel } from "./best-result-panel";
import { DiagnosticJsonBrowser } from "./diagnostic-json";
import { DEFAULT_SOURCE_WIDTH, PanelDivider } from "./panel-divider";

const PdfPreview = dynamic(() => import("../pdf-preview"), {
  ssr: false,
  loading: () => <div className="artifact-loading">Loading PDF viewer…</div>,
});

function DiagnosticImagePreview({
  source,
  title,
  boxes,
  selectedId,
  onSelect,
}: {
  source: string;
  title: string;
  boxes: EvidenceOverlayBox[];
  selectedId: string | null;
  onSelect: (id: string, kind: EvidenceOverlayBox["kind"]) => void;
}) {
  const [aspectRatio, setAspectRatio] = useState(1);
  return (
    <div className="image-preview" aria-label={title}>
      <div className="image-evidence-page" style={{ aspectRatio }}>
        <Image
          src={source}
          alt={title}
          fill
          sizes="(max-width: 760px) 100vw, 50vw"
          loading="eager"
          unoptimized
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            if (naturalWidth > 0 && naturalHeight > 0)
              setAspectRatio(naturalWidth / naturalHeight);
          }}
        />
        <EvidenceOverlay
          boxes={boxes}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

export function DocumentExplorer({
  run,
  selected,
  loading,
  artifact,
  diagnostic,
  historicalBest,
  onLoadHistoricalBest,
  onRetryHistoricalBest,
  onBrowseQueue,
  previous,
  next,
  onNavigate,
}: {
  run: BenchmarkRun;
  selected: CaseResult | null;
  loading: boolean;
  artifact: ArtifactState;
  diagnostic: DiagnosticState;
  historicalBest: HistoricalBestState;
  onLoadHistoricalBest: () => void;
  onRetryHistoricalBest: () => void;
  onBrowseQueue: (trigger: HTMLButtonElement) => void;
  previous: TriageCaseResult | null;
  next: TriageCaseResult | null;
  onNavigate: (result: TriageCaseResult) => void;
}) {
  const [analysisFocus, setAnalysisFocus] = useState(false);
  const sourceViewerButton = useRef<HTMLButtonElement>(null);
  const [sourceWidth, setSourceWidth] = useState(DEFAULT_SOURCE_WIDTH);
  const [markdownMode, setMarkdownMode] = useState<MarkdownMode>("preview");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("explain");
  const [mobileViewer, setMobileViewer] = useState<"source" | "output">(
    "source",
  );
  const [siblingOriginalMarkdown, setSiblingOriginalMarkdown] =
    useState<OriginalMarkdownState>({
      loading: true,
      markdown: "",
      error: null,
    });
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(
    null,
  );
  const [selectedEvidenceKind, setSelectedEvidenceKind] = useState<
    EvidenceOverlayBox["kind"] | "diagnostic" | null
  >(null);
  const [layers, setLayers] = useState({
    expected: false,
    predicted: false,
    best: false,
  });
  const selectedSource = selected ? sourceAssetUrl(selected) : null;
  const selectedSourceKind = selected
    ? sourceAssetKind(selected)
    : "unsupported";
  const selectedSourceOpenUrl =
    selectedSourceKind === "pdf" && selected
      ? sourcePdfPreviewUrl(selected)
      : selectedSource;
  const selectedSourceLabel =
    selectedSourceKind === "pdf"
      ? "PDF preview"
      : selectedSourceKind === "image"
        ? "Image preview"
        : "Source asset";
  const isLayoutDimension = selected?.run_dimensions.dimension === "layout";
  const allLayoutBoxes = useMemo(
    () =>
      layoutOverlayBoxes(
        isLayoutDimension,
        diagnostic.data,
        artifact.layoutBoxes,
        historicalBest.diagnostic,
        historicalBest.artifact.layoutBoxes,
      ),
    [
      artifact.layoutBoxes,
      diagnostic.data,
      historicalBest.artifact.layoutBoxes,
      historicalBest.diagnostic,
      isLayoutDimension,
    ],
  );
  const boxes = useMemo(
    () =>
      selectedEvidenceId
        ? allLayoutBoxes.filter(
            (box) =>
              (selectedEvidenceKind === "diagnostic"
                ? box.kind !== "best"
                : box.kind === selectedEvidenceKind) &&
              (box.id === selectedEvidenceId ||
                box.relatedIds?.includes(selectedEvidenceId) === true),
          )
        : allLayoutBoxes.filter((box) =>
            box.kind === "ground-truth"
              ? layers.expected
              : box.kind === "best"
                ? layers.best
                : layers.predicted,
          ),
    [allLayoutBoxes, layers, selectedEvidenceId, selectedEvidenceKind],
  );
  const layerCounts = useMemo(
    () =>
      allLayoutBoxes.reduce(
        (counts, box) => {
          if (box.kind === "ground-truth" && box.status === "ignored")
            counts.ignored += 1;
          else if (box.kind === "ground-truth" && box.status === "reference")
            counts.reference += 1;
          else counts[box.kind] += 1;
          return counts;
        },
        { "ground-truth": 0, prediction: 0, best: 0, ignored: 0, reference: 0 },
      ),
    [allLayoutBoxes],
  );
  const visibleRegionTones = useMemo(
    () =>
      LAYOUT_REGION_TONES.filter(({ tone }) =>
        boxes.some((box) => box.tone === tone),
      ),
    [boxes],
  );
  const hasLayoutEvidence = isLayoutDimension;
  const hasHistoricalBest = historicalBest.data != null;
  const inspectorViews: ReadonlyArray<readonly [InspectorTab, string]> = [
    ["explain", "Explain"],
    ["best", "Best result"],
    ["output", "Output"],
    ["original", "Ground truth Markdown"],
    ["expectations", "Ground truth"],
    ["json", "JSON"],
  ];
  const bestEvidenceLoading = historicalBest.evidenceStatus === "loading";
  const currentOriginalMarkdown = useMemo(
    () => originalMarkdownFromDiagnostic(diagnostic.data),
    [diagnostic.data],
  );
  const originalMarkdown =
    currentOriginalMarkdown || siblingOriginalMarkdown.markdown;
  const originalMarkdownLoading =
    !currentOriginalMarkdown && siblingOriginalMarkdown.loading;

  useEffect(() => {
    if (!selected || diagnostic.loading || currentOriginalMarkdown) return;
    const controller = new AbortController();
    loadSiblingOriginalMarkdown(run, selected, controller.signal)
      .then((markdown) => {
        if (controller.signal.aborted) return;
        setSiblingOriginalMarkdown({ loading: false, markdown, error: null });
      })
      .catch((error: Error) => {
        if (error.name === "AbortError") return;
        setSiblingOriginalMarkdown({
          loading: false,
          markdown: "",
          error: error.message,
        });
      });
    return () => controller.abort();
  }, [currentOriginalMarkdown, diagnostic.loading, run, selected]);
  const primary = selected
    ? alignedPrimaryMetric(selected, diagnostic.data)
    : null;
  const detailedMetrics = useMemo(
    () =>
      [...(diagnostic.data?.metrics ?? [])]
        .filter(
          (metric) => metric.value != null && Number.isFinite(metric.value),
        )
        .sort((left, right) =>
          left.metric_name.localeCompare(right.metric_name),
        ),
    [diagnostic.data],
  );

  function toggleLayoutLayer(layer: keyof typeof layers) {
    const enable = !layers[layer];
    setSelectedEvidenceId(null);
    setSelectedEvidenceKind(null);
    setLayers((current) => ({ ...current, [layer]: !current[layer] }));
    if (layer === "best" && enable) onLoadHistoricalBest();
  }

  function selectDiagnosticEvidence(id: string) {
    setSelectedEvidenceId(id);
    setSelectedEvidenceKind("diagnostic");
    if (isLayoutDimension) {
      setAnalysisFocus(false);
      setMobileViewer("source");
      setLayers({ expected: false, predicted: false, best: false });
      if (window.matchMedia("(max-width: 760px)").matches) {
        sourceViewerButton.current?.focus();
      }
    }
  }

  function selectOverlayEvidence(id: string, kind: EvidenceOverlayBox["kind"]) {
    setSelectedEvidenceId(id);
    setSelectedEvidenceKind(kind);
    setLayers({ expected: false, predicted: false, best: false });
  }

  function selectInspectorView(value: InspectorTab) {
    setInspectorTab(value);
    setMobileViewer("output");
    setSelectedEvidenceId(null);
    setSelectedEvidenceKind(null);
    if (value === "best") onLoadHistoricalBest();
  }

  function navigateInspectorTabs(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight")
      nextIndex = (index + 1) % inspectorViews.length;
    if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + inspectorViews.length) % inspectorViews.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = inspectorViews.length - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    selectInspectorView(inspectorViews[nextIndex][0]);
    const tabs =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        "[role='tab']",
      );
    tabs?.[nextIndex]?.focus();
  }

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className={`workbench-shell investigation-workspace ${analysisFocus ? "analysis-focused" : ""}`}
      data-dimension={selected?.run_dimensions.dimension}
      style={
        {
          "--source-width": `${sourceWidth}fr`,
          "--analysis-width": `${100 - sourceWidth}fr`,
        } as CSSProperties
      }
    >
      <section className="inspection-workspace">
        {selected ? (
          <>
            <header className="workbench-header">
              <div className="workbench-navigation">
                <button
                  className="queue-browser-button"
                  type="button"
                  onClick={(event) => onBrowseQueue(event.currentTarget)}
                >
                  <Icon name="grid" size={16} /> Browse queue
                </button>
              </div>
              <div className="inspection-title">
                <div className="breadcrumb">
                  <span>
                    {DIMENSION_LABELS[selected.run_dimensions.dimension] ??
                      humanize(selected.run_dimensions.dimension)}
                  </span>
                  <span>/</span>
                  <span>
                    {selected.benchmark_cases.inference_group ?? "document"}
                  </span>
                </div>
                <h2 title={documentName(selected)}>{documentName(selected)}</h2>
                <p className="document-locator">
                  Page{" "}
                  {selected.benchmark_cases.page_number ??
                    diagnostic.data?.source?.page ??
                    1}{" "}
                  <span>·</span> {humanize(primary?.name)}
                  {!diagnostic.data && !diagnostic.loading && (
                    <strong className="recorded-score-fallback">
                      Recorded score {scorePercent(primary?.score)}
                    </strong>
                  )}
                </p>
              </div>
              <div
                className="case-navigation"
                aria-label="Cases in the current triage result page"
              >
                <button
                  type="button"
                  disabled={!previous}
                  onClick={() => previous && onNavigate(previous)}
                  aria-label="Previous case"
                >
                  ←
                </button>
                <button
                  type="button"
                  disabled={!next}
                  onClick={() => next && onNavigate(next)}
                  aria-label="Next case"
                >
                  →
                </button>
              </div>
            </header>

            <div
              className="mobile-viewer-tabs"
              aria-label="Document inspection panels"
            >
              <button
                ref={sourceViewerButton}
                type="button"
                aria-pressed={mobileViewer === "source"}
                className={
                  mobileViewer === "source" ? "mobile-viewer-active" : ""
                }
                onClick={() => setMobileViewer("source")}
              >
                Source
              </button>
              <button
                type="button"
                aria-pressed={mobileViewer === "output"}
                className={
                  mobileViewer === "output" ? "mobile-viewer-active" : ""
                }
                onClick={() => setMobileViewer("output")}
              >
                Analysis
              </button>
            </div>

            <div className={`comparison-grid mobile-view-${mobileViewer}`}>
              <article
                className="viewer-card pdf-card"
                id="source-document-panel"
              >
                <div className="viewer-toolbar source-toolbar">
                  <div>
                    <span className="viewer-kicker">
                      <span className="panel-number">01</span> Source document
                    </span>
                    <strong>{selectedSourceLabel}</strong>
                  </div>
                  <div className="source-toolbar-actions">
                    {hasLayoutEvidence && (
                      <div className="layer-legend">
                        <span className="layer-legend-label">Layers</span>
                        <div
                          className="layer-toggle"
                          aria-label="Layout evidence layers"
                        >
                          <button
                            type="button"
                            aria-pressed={layers.expected}
                            onClick={() => toggleLayoutLayer("expected")}
                          >
                            <span>Expected</span>
                            <strong
                              aria-label={`${layerCounts["ground-truth"]} scored expected regions${layerCounts.reference ? `; ${layerCounts.reference} reference-only regions` : ""}${layerCounts.ignored ? `; ${layerCounts.ignored} regions ignored by scoring` : ""}`}
                              title={
                                layerCounts.reference
                                  ? `${layerCounts.reference} region${layerCounts.reference === 1 ? " is" : "s are"} visual context for the scored order rules`
                                  : layerCounts.ignored
                                    ? `${layerCounts.ignored} additional region${layerCounts.ignored === 1 ? " is" : "s are"} ignored by scoring`
                                    : undefined
                              }
                            >
                              {layerCounts.reference > 0 &&
                              layerCounts["ground-truth"] === 0
                                ? `${layerCounts.reference} ref`
                                : `${layerCounts["ground-truth"]}${layerCounts.reference ? ` +${layerCounts.reference} ref` : ""}${layerCounts.ignored ? ` +${layerCounts.ignored} ignored` : ""}`}
                            </strong>
                          </button>
                          <button
                            type="button"
                            aria-pressed={layers.predicted}
                            onClick={() => toggleLayoutLayer("predicted")}
                          >
                            <span>Output</span>
                            <strong
                              aria-label={`${layerCounts.prediction} output regions`}
                            >
                              {layerCounts.prediction}
                            </strong>
                          </button>
                          {hasHistoricalBest && (
                            <button
                              type="button"
                              aria-pressed={layers.best}
                              onClick={() => toggleLayoutLayer("best")}
                            >
                              <span>Best result</span>
                              <strong
                                aria-label={
                                  bestEvidenceLoading
                                    ? "Loading best-result regions"
                                    : historicalBest.evidenceStatus === "idle"
                                      ? "Load best-result regions"
                                      : `${layerCounts.best} best-result regions`
                                }
                              >
                                {bestEvidenceLoading
                                  ? "…"
                                  : historicalBest.evidenceStatus === "idle"
                                    ? "Load"
                                    : layerCounts.best}
                              </strong>
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    {selectedSourceOpenUrl && (
                      <a
                        className="simple-link"
                        href={selectedSourceOpenUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open source ↗
                      </a>
                    )}
                  </div>
                </div>
                {hasLayoutEvidence && (
                  <div
                    className="layout-region-legend"
                    aria-label="Layout region color legend"
                  >
                    <span className="layout-region-legend-title">
                      Region legend
                    </span>
                    {visibleRegionTones.length ? (
                      visibleRegionTones.map(({ tone, label }) => (
                        <span className="layout-region-legend-item" key={tone}>
                          <i
                            className={`layout-region-swatch layout-region-tone-${tone}`}
                            aria-hidden="true"
                          />
                          {label}
                        </span>
                      ))
                    ) : (
                      <span className="layout-region-legend-empty">
                        No overlay layers selected
                      </span>
                    )}
                    {layers.expected && layerCounts.ignored > 0 && (
                      <span className="layout-region-legend-item">
                        <i
                          className="layout-region-swatch layout-region-ignored"
                          aria-hidden="true"
                        />
                        Ignored by scoring ({layerCounts.ignored})
                      </span>
                    )}
                    {layers.expected && layerCounts.reference > 0 && (
                      <span className="layout-region-legend-item">
                        <i
                          className="layout-region-swatch layout-region-reference"
                          aria-hidden="true"
                        />
                        Reference only ({layerCounts.reference})
                      </span>
                    )}
                    <span
                      className="layout-region-legend-key"
                      aria-label="Layer styles"
                    >
                      <span className="layout-region-layer-key">
                        <i
                          className="layout-layer-swatch layout-layer-swatch-expected"
                          aria-hidden="true"
                        />
                        Expected
                      </span>
                      <span className="layout-region-layer-key">
                        <i
                          className="layout-layer-swatch layout-layer-swatch-output"
                          aria-hidden="true"
                        />
                        Output
                      </span>
                      {hasHistoricalBest && (
                        <span className="layout-region-layer-key">
                          <i
                            className="layout-layer-swatch layout-layer-swatch-best"
                            aria-hidden="true"
                          />
                          Best
                        </span>
                      )}
                    </span>
                  </div>
                )}
                <div className="pdf-stage">
                  {selectedSource && selectedSourceKind === "pdf" ? (
                    <PdfPreview
                      source={selectedSource}
                      page={
                        selected.benchmark_cases.page_number ??
                        diagnostic.data?.source?.page ??
                        1
                      }
                      title={`PDF preview for ${selected.benchmark_cases.test_id}`}
                      boxes={boxes}
                      selectedId={selectedEvidenceId}
                      onSelect={selectOverlayEvidence}
                    />
                  ) : selectedSource && selectedSourceKind === "image" ? (
                    <DiagnosticImagePreview
                      source={selectedSource}
                      title={`Source document ${selected.benchmark_cases.test_id}`}
                      boxes={boxes}
                      selectedId={selectedEvidenceId}
                      onSelect={selectOverlayEvidence}
                    />
                  ) : selectedSource ? (
                    <EmptyState
                      title="Preview unavailable"
                      body="Open the source asset to inspect this file type."
                    />
                  ) : (
                    <EmptyState
                      title="Source unavailable"
                      body="This case does not include a dataset source locator."
                    />
                  )}
                </div>
              </article>

              <PanelDivider
                value={sourceWidth}
                onChange={setSourceWidth}
                onHiddenFocus={() => {
                  setMobileViewer("source");
                  sourceViewerButton.current?.focus();
                }}
              />

              <article
                className="viewer-card output-card"
                id="analysis-document-panel"
                onFocusCapture={() => setMobileViewer("output")}
              >
                <div className="analysis-view-toolbar">
                  <div
                    className="content-tabs inspector-tabs"
                    role="tablist"
                    aria-label="Case inspection views"
                  >
                    {inspectorViews.map(([value, label], index) => (
                      <button
                        id={`inspector-${value}-tab`}
                        role="tab"
                        aria-selected={inspectorTab === value}
                        aria-controls="inspector-panel"
                        tabIndex={inspectorTab === value ? 0 : -1}
                        className={
                          inspectorTab === value ? "content-tab-active" : ""
                        }
                        onClick={() => selectInspectorView(value)}
                        onKeyDown={(event) =>
                          navigateInspectorTabs(event, index)
                        }
                        type="button"
                        key={value}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button
                    className="focus-analysis-button"
                    type="button"
                    aria-pressed={analysisFocus}
                    onClick={() => setAnalysisFocus((current) => !current)}
                  >
                    <Icon name="layers" size={16} />{" "}
                    {analysisFocus ? "Split view" : "Focus analysis"}
                  </button>
                </div>
                <div className="viewer-toolbar output-toolbar">
                  <div className="analysis-panel-heading">
                    <span className="panel-number">02</span>
                    <strong>
                      {
                        inspectorViews.find(
                          ([value]) => value === inspectorTab,
                        )?.[1]
                      }
                    </strong>
                  </div>
                  {inspectorTab === "explain" && detailedMetrics.length > 0 && (
                    <details className="inspector-metrics">
                      <summary>
                        All metrics <span>{detailedMetrics.length}</span>
                      </summary>
                      <dl>
                        {detailedMetrics.map((metric) => (
                          <div key={metric.metric_name}>
                            <dt>{humanize(metric.metric_name)}</dt>
                            <dd>{diagnosticMetricDisplay(metric)}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  )}
                  {(inspectorTab === "output" ||
                    (inspectorTab === "original" && originalMarkdown)) && (
                    <div
                      className="mode-toggle"
                      aria-label="Markdown display mode"
                    >
                      <button
                        aria-pressed={markdownMode === "preview"}
                        className={
                          markdownMode === "preview" ? "mode-active" : ""
                        }
                        onClick={() => setMarkdownMode("preview")}
                        type="button"
                      >
                        Preview
                      </button>
                      <button
                        aria-pressed={markdownMode === "source"}
                        className={
                          markdownMode === "source" ? "mode-active" : ""
                        }
                        onClick={() => setMarkdownMode("source")}
                        type="button"
                      >
                        Source
                      </button>
                    </div>
                  )}
                </div>
                <div
                  className="markdown-stage inspector-stage"
                  id="inspector-panel"
                  role="tabpanel"
                  aria-labelledby={`inspector-${inspectorTab}-tab`}
                >
                  {inspectorTab === "explain" ? (
                    diagnostic.loading ? (
                      <div className="artifact-loading">
                        Loading score evidence…
                      </div>
                    ) : diagnostic.data ? (
                      <DiagnosticInspector
                        diagnostic={diagnostic.data}
                        actualMarkdown={artifact.markdown}
                        actualMarkdownState={artifact.markdownState}
                        selectedEvidenceId={selectedEvidenceId}
                        onSelectEvidence={selectDiagnosticEvidence}
                      />
                    ) : (
                      <div className="diagnostic-unavailable">
                        <EmptyState
                          title="Detailed evidence unavailable"
                          body={
                            diagnostic.error ??
                            "The per-case diagnostic artifact could not be loaded from GCS."
                          }
                        />
                      </div>
                    )
                  ) : inspectorTab === "output" ? (
                    artifact.loading ? (
                      <div className="artifact-loading">
                        Loading rendered artifact…
                      </div>
                    ) : artifact.error ? (
                      <EmptyState
                        title="Output unavailable"
                        body={artifact.error}
                      />
                    ) : artifact.markdownState === "present" ? (
                      markdownMode === "preview" ? (
                        <MarkdownPanel markdown={artifact.markdown} />
                      ) : (
                        <pre className="markdown-source">
                          <code>{artifact.markdown}</code>
                        </pre>
                      )
                    ) : (
                      <EmptyMarkdownArtifact state={artifact.markdownState} />
                    )
                  ) : inspectorTab === "original" ? (
                    originalMarkdown ? (
                      <div className="original-markdown-view">
                        <aside className="original-markdown-note">
                          <strong>Reference Markdown used for grading</strong>
                          <p>
                            This is the human-readable ground-truth Markdown
                            retained by the benchmark. It is the reference used
                            to derive grading checks, not the parser output.
                          </p>
                        </aside>
                        {markdownMode === "preview" ? (
                          <MarkdownPanel markdown={originalMarkdown} />
                        ) : (
                          <pre className="markdown-source">
                            <code>{originalMarkdown}</code>
                          </pre>
                        )}
                      </div>
                    ) : originalMarkdownLoading ? (
                      <div className="artifact-loading">
                        Looking for ground-truth Markdown across this run…
                      </div>
                    ) : siblingOriginalMarkdown.error ? (
                      <EmptyState
                        title="Could not load ground-truth Markdown"
                        body={siblingOriginalMarkdown.error}
                      />
                    ) : (
                      <EmptyState
                        title="Ground-truth Markdown unavailable"
                        body="No diagnostic for this document retains a human-readable ground-truth Markdown reference."
                      />
                    )
                  ) : inspectorTab === "expectations" ? (
                    diagnostic.loading ? (
                      <div className="artifact-loading">
                        Loading ground truth…
                      </div>
                    ) : (
                      <GroundTruthInspector
                        dimension={selected.run_dimensions.dimension}
                        diagnostic={diagnostic.data}
                      />
                    )
                  ) : inspectorTab === "best" ? (
                    <BestResultPanel
                      current={selected}
                      currentArtifact={artifact}
                      currentDiagnostic={diagnostic.data}
                      currentDiagnosticError={diagnostic.error}
                      best={historicalBest}
                      onRetry={onRetryHistoricalBest}
                    />
                  ) : (
                    <div className="raw-artifacts-view">
                      <header className="artifact-browser-heading">
                        <div>
                          <span className="eyebrow">Retained artifacts</span>
                          <h2>Explore the evaluation record</h2>
                          <p>
                            Browse the exact metrics, expectations, and outcomes
                            behind this result.
                          </p>
                        </div>
                      </header>
                      <div className="raw-artifact-links">
                        {artifact.url && (
                          <a
                            href={artifact.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open parser result JSON ↗
                          </a>
                        )}
                        {diagnostic.url && (
                          <a
                            href={diagnostic.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open diagnostic JSON ↗
                          </a>
                        )}
                      </div>
                      {diagnostic.data ? (
                        <DiagnosticJsonBrowser
                          key={diagnostic.data.test_id}
                          diagnostic={diagnostic.data}
                        />
                      ) : (
                        <EmptyState
                          title="Diagnostic JSON unavailable"
                          body={
                            diagnostic.error ??
                            "This result does not have a diagnostic artifact."
                          }
                        />
                      )}
                    </div>
                  )}
                </div>
              </article>
            </div>
          </>
        ) : loading ? (
          <div className="artifact-loading" role="status">
            Loading document details…
          </div>
        ) : (
          <EmptyState
            title="Case not found"
            body={`This result is not available for workflow #${run.github_run_id}.`}
          />
        )}
      </section>
    </main>
  );
}
