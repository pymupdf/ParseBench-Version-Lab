"use client";

import { type ReactNode, useMemo, useState, useRef, useCallback, useEffectEvent, useEffect } from "react";
import { useRouter, usePathname, useParams, useSearchParams } from "next/navigation";
import type { View, TriageFilters, ArtifactState, DiagnosticState, HistoricalBestState } from "./dashboard/types";
import { normalizeTriageFilters, parsePercent, parsePage, triageQuery, hrefWithTriageFilters } from "./dashboard/filters";
import { DIMENSION_ORDER, EMPTY_BUNDLE, EMPTY_ARTIFACT, EMPTY_DIAGNOSTIC, EMPTY_HISTORICAL_BEST, TRIAGE_PAGE_SIZE } from "./dashboard/constants";
import { type BenchmarkRun, type RunScoreIndex, type RunBundle, type TriageCaseResult, type CaseResult, loadRuns, loadRun, loadRunScores, loadRunBundle, loadDocuments, loadDocument, artifactUrl, loadArtifact, loadDiagnostic, loadHistoricalBestResult, type ArtifactLayoutBox } from "./lib/data";
import { orderRunDimensions } from "./dashboard/format";
import { DashboardNavigation, RunContextBar } from "./dashboard-navigation";
import { EmptyState } from "./dashboard/shared";
import { WorkflowBrowser } from "./dashboard/workflow-browser";
import { Overview } from "./dashboard/overview";
import { TriageGrid } from "./dashboard/triage-grid";
import dynamic from "next/dynamic";

const DocumentExplorer = dynamic(
  () => import("./dashboard/document-explorer").then((module) => module.DocumentExplorer),
  {
    loading: () => <div className="artifact-loading" role="status">Loading document explorer…</div>,
  },
);

export default function DashboardClient({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const routeParams = useParams<{ runId?: string }>();
  const searchParams = useSearchParams();
  const routeRunId = routeParams.runId;
  const githubRunId = routeRunId && /^\d+$/.test(routeRunId) ? Number(routeRunId) : undefined;
  const routeCaseResultValue = pathname.match(/\/triage\/(\d+)\/?$/)?.[1];
  const routeCaseResultId = routeCaseResultValue && /^\d+$/.test(routeCaseResultValue)
    ? Number(routeCaseResultValue)
    : null;
  const view: View = githubRunId == null
    ? "runs"
    : pathname.includes("/triage/")
      ? "inspect"
      : pathname.endsWith("/triage")
        ? "triage"
        : "overview";
  const sortValue = searchParams.get("sort");
  const filters = useMemo<TriageFilters>(() => normalizeTriageFilters({
      dimension: DIMENSION_ORDER.includes(searchParams.get("dimension") as (typeof DIMENSION_ORDER)[number])
        ? searchParams.get("dimension")!
        : DIMENSION_ORDER[0],
      search: searchParams.get("q") || "",
      minimum: parsePercent(searchParams.get("min"), 0),
      maximum: parsePercent(searchParams.get("max"), 100),
      sort: sortValue === "highest" || sortValue === "document" ? sortValue : "lowest",
      page: parsePage(searchParams.get("page")),
    }), [searchParams, sortValue]);
  const inspectionOrigin = searchParams.get("from") === "overview" ? "overview" : "triage";
  const [catalogRuns, setCatalogRuns] = useState<BenchmarkRun[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(view === "runs");
  const [selectedRunRecord, setSelectedRunRecord] = useState<BenchmarkRun | null>(null);
  const [selectedRunLoading, setSelectedRunLoading] = useState(githubRunId != null);
  const [runScores, setRunScores] = useState<RunScoreIndex>({});
  const [runScoresLoading, setRunScoresLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<RunBundle>(EMPTY_BUNDLE);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [documents, setDocuments] = useState<TriageCaseResult[]>([]);
  const [documentTotal, setDocumentTotal] = useState(0);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<CaseResult | null>(null);
  const [documentLoadState, setDocumentLoadState] = useState<{ id: number | null; loading: boolean }>({
    id: null,
    loading: false,
  });
  const [artifact, setArtifact] = useState<ArtifactState>(EMPTY_ARTIFACT);
  const [artifactResultId, setArtifactResultId] = useState<number | null>(null);
  const [diagnostic, setDiagnostic] = useState<DiagnosticState>(EMPTY_DIAGNOSTIC);
  const [diagnosticResultId, setDiagnosticResultId] = useState<number | null>(null);
  const [historicalBest, setHistoricalBest] = useState<HistoricalBestState>(EMPTY_HISTORICAL_BEST);
  const [historicalBestResultId, setHistoricalBestResultId] = useState<number | null>(null);
  const [historicalBestEvidenceResultId, setHistoricalBestEvidenceResultId] = useState<number | null>(null);
  const [historicalBestAttempt, setHistoricalBestAttempt] = useState(0);
  const [queueOpen, setQueueOpen] = useState(false);
  const queueOverlayRef = useRef<HTMLDivElement>(null);
  const queueCloseButtonRef = useRef<HTMLButtonElement>(null);
  const queueTriggerRef = useRef<HTMLButtonElement>(null);

  const selectedRun = githubRunId != null && selectedRunRecord?.github_run_id === githubRunId
    ? selectedRunRecord
    : null;
  const selectedRunId = selectedRun?.id ?? null;
  const queueVisible = queueOpen && view === "inspect" && selectedRun != null;
  const activeRunDimensionId = (
    bundle.dimensions.find(
      (item) => item.run_id === selectedRunId && item.dimension === filters.dimension,
    ) ?? bundle.dimensions.find((item) => item.run_id === selectedRunId)
  )?.id ?? null;

  const updateFilters = useCallback((updates: Partial<TriageFilters>) => {
    if (!selectedRun) return;
    const next = { ...filters, ...updates };
    if (next.minimum > next.maximum) {
      if (updates.minimum != null) next.maximum = next.minimum;
      else next.minimum = next.maximum;
    }
    const normalized = normalizeTriageFilters(next);
    const base = view === "inspect" && routeCaseResultId != null
      ? `/workflows/${selectedRun.github_run_id}/triage/${routeCaseResultId}`
      : view === "overview"
        ? `/workflows/${selectedRun.github_run_id}`
        : `/workflows/${selectedRun.github_run_id}/triage`;
    const query = triageQuery(normalized);
    if (view === "inspect") query.set("from", inspectionOrigin);
    router.replace(query.size ? `${base}?${query.toString()}` : base, { scroll: false });
  }, [filters, inspectionOrigin, routeCaseResultId, router, selectedRun, view]);

  const reconcileDocumentPage = useEffectEvent((total: number) => {
    const lastPage = Math.max(0, Math.ceil(total / TRIAGE_PAGE_SIZE) - 1);
    if (filters.page <= lastPage) return false;
    updateFilters({ page: lastPage });
    return true;
  });

  const defaultDetailDimension = useEffectEvent((document: CaseResult) => {
    const requestedDimension = searchParams.get("dimension");
    if (
      !DIMENSION_ORDER.includes(requestedDimension as (typeof DIMENSION_ORDER)[number]) &&
      DIMENSION_ORDER.includes(document.run_dimensions.dimension as (typeof DIMENSION_ORDER)[number])
    ) {
      updateFilters({ dimension: document.run_dimensions.dimension, page: 0 });
    }
  });

  useEffect(() => {
    // Browser Back/Forward changes the route without using our case handlers.
    // Dismiss its transient dialog so it cannot reopen on forward navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQueueOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!queueVisible) return;
    const trigger = queueTriggerRef.current;
    queueCloseButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setQueueOpen(false);
      if (event.key !== "Tab") return;
      const focusable = queueOverlayRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])",
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      if (trigger?.isConnected) trigger.focus();
    };
  }, [queueVisible]);

  useEffect(() => {
    if (view !== "runs" || catalogLoaded) return;
    const controller = new AbortController();
    // The catalog is loaded lazily and retained while detail routes are open.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCatalogLoading(true);
    loadRuns(controller.signal)
      .then((loadedRuns) => {
        setCatalogRuns(loadedRuns);
        setCatalogLoaded(true);
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatalogLoading(false);
      });
    return () => controller.abort();
  }, [catalogLoaded, view]);

  useEffect(() => {
    if (githubRunId == null) {
      // Keep the last record cached for a possible forward navigation, but do
      // not expose it as selected while the catalog route is active.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedRunLoading(false);
      return;
    }
    if (selectedRunRecord?.github_run_id === githubRunId) {
      setSelectedRunLoading(false);
      return;
    }
    const catalogMatch = catalogRuns.find((run) => run.github_run_id === githubRunId);
    if (catalogMatch) {
      setSelectedRunRecord(catalogMatch);
      setSelectedRunLoading(false);
      return;
    }
    const controller = new AbortController();
    setSelectedRunLoading(true);
    loadRun(githubRunId, controller.signal)
      .then(setSelectedRunRecord)
      .catch((error: Error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSelectedRunLoading(false);
      });
    return () => controller.abort();
  }, [catalogRuns, githubRunId, selectedRunRecord?.github_run_id]);

  useEffect(() => {
    if (view !== "runs" || !catalogLoaded) return;
    const controller = new AbortController();
    // This loading state follows the catalog score request lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRunScoresLoading(true);
    loadRunScores(catalogRuns.map((run) => run.id), controller.signal)
      .then(setRunScores)
      .catch((error: Error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRunScoresLoading(false);
      });
    return () => controller.abort();
  }, [catalogLoaded, catalogRuns, view]);

  useEffect(() => {
    if (selectedRunId == null) return;
    const controller = new AbortController();
    // This reset intentionally belongs to the selected-run synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBundleLoading(true);
    setBundle(EMPTY_BUNDLE);
    loadRunBundle(selectedRunId, controller.signal)
      .then((loadedBundle) => {
        setBundle({
          ...loadedBundle,
          dimensions: orderRunDimensions(loadedBundle.dimensions),
        });
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBundleLoading(false);
      });
    return () => controller.abort();
  }, [selectedRunId]);

  useEffect(() => {
    if (
      selectedRunId == null ||
      activeRunDimensionId == null ||
      selectedRun?.artifact_state !== "complete"
    ) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setDocumentsLoading(true);
      setDocumentsError(null);
      loadDocuments(
        activeRunDimensionId,
        {
          search: filters.search,
          floor: filters.minimum / 100,
          ceiling: filters.maximum / 100,
          sort: filters.sort,
          limit: TRIAGE_PAGE_SIZE,
          offset: filters.page * TRIAGE_PAGE_SIZE,
        },
        controller.signal,
      )
        .then(({ documents: loadedDocuments, total }) => {
          if (reconcileDocumentPage(total)) {
            setDocuments([]);
            setDocumentTotal(total);
            return;
          }
          setDocuments(loadedDocuments);
          setDocumentTotal(total);
          setDocumentsError(null);
        })
        .catch((error: Error) => {
          if (error.name !== "AbortError") {
            setDocuments([]);
            setDocumentTotal(0);
            setDocumentsError(error.message);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setDocumentsLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    activeRunDimensionId,
    filters.maximum,
    filters.minimum,
    filters.page,
    filters.search,
    filters.sort,
    selectedRun?.artifact_state,
    selectedRunId,
  ]);

  useEffect(() => {
    if (selectedRunId == null || view !== "inspect" || routeCaseResultId == null) {
      // Route changes intentionally clear the case-specific workbench state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedDocument(null);
      setDocumentLoadState({ id: null, loading: false });
      return;
    }
    const controller = new AbortController();
    setDocumentLoadState({ id: routeCaseResultId, loading: true });
    loadDocument(selectedRunId, routeCaseResultId, controller.signal)
      .then((document) => {
        if (controller.signal.aborted) return;
        setSelectedDocument(document);
        setDocumentLoadState({ id: routeCaseResultId, loading: false });
        if (document) defaultDetailDimension(document);
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") {
          setSelectedDocument(null);
          setDocumentLoadState({ id: routeCaseResultId, loading: false });
          setLoadError(error.message);
        }
      });
    return () => controller.abort();
  }, [routeCaseResultId, selectedRunId, view]);

  useEffect(() => {
    if (!selectedRun || !selectedDocument) {
      return;
    }
    const controller = new AbortController();
    // This reset intentionally belongs to the selected-document synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setArtifactResultId(selectedDocument.id);
    setDiagnosticResultId(selectedDocument.id);
    setArtifact({
      loading: true,
      markdown: "",
      markdownState: "unknown",
      layoutBoxes: [],
      url: artifactUrl(selectedRun, selectedDocument.result_relative_path),
      error: null,
    });
    setDiagnostic({
      loading: true,
      data: null,
      url: artifactUrl(selectedRun, selectedDocument.diagnostic_relative_path),
      error: null,
    });
    loadArtifact(selectedRun, selectedDocument, controller.signal)
      .then((loadedArtifact) => {
        if (controller.signal.aborted) return;
        setArtifact({
          loading: false,
          markdown: loadedArtifact.markdown,
          markdownState: loadedArtifact.markdownState,
          layoutBoxes: loadedArtifact.layoutBoxes,
          url: loadedArtifact.url,
          error: null,
        });
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") {
          setArtifact((current) => ({ ...current, loading: false, error: error.message }));
        }
      });
    loadDiagnostic(selectedRun, selectedDocument, controller.signal)
      .then((loadedDiagnostic) => {
        if (controller.signal.aborted) return;
        setDiagnostic({
          loading: false,
          data: loadedDiagnostic.diagnostic,
          url: loadedDiagnostic.url,
          error: null,
        });
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") {
          setDiagnostic((current) => ({ ...current, loading: false, error: error.message }));
        }
      });
    return () => controller.abort();
  }, [selectedRun, selectedDocument]);

  useEffect(() => {
    if (!selectedDocument) return;
    const document = selectedDocument;
    const controller = new AbortController();
    // This state is keyed to the selected result so a previous page's best
    // result cannot appear while the next page is loading.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistoricalBestResultId(document.id);
    setHistoricalBest({ ...EMPTY_HISTORICAL_BEST, loading: true });

    async function loadBest() {
      try {
        const candidate = await loadHistoricalBestResult(
          document,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (!candidate) {
          setHistoricalBest(EMPTY_HISTORICAL_BEST);
          return;
        }

        setHistoricalBest({
          ...EMPTY_HISTORICAL_BEST,
          data: candidate,
        });
      } catch (error) {
        if (!controller.signal.aborted && error instanceof Error && error.name !== "AbortError") {
          setHistoricalBest({ ...EMPTY_HISTORICAL_BEST, error: error.message });
        }
      }
    }

    void loadBest();
    return () => controller.abort();
  }, [selectedDocument, historicalBestAttempt]);

  useEffect(() => {
    const candidate = historicalBest.data;
    if (
      !selectedDocument ||
      !candidate ||
      historicalBestResultId !== selectedDocument.id ||
      historicalBestEvidenceResultId !== selectedDocument.id
    ) return;
    const bestCandidate = candidate;
    const controller = new AbortController();
    // Remember early tab clicks while the candidate query is still pending.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistoricalBest((current) => ({
      ...current,
      evidenceStatus: "loading",
      artifact: { ...EMPTY_ARTIFACT, loading: true },
    }));
    // Historical artifacts can be large, so fetch them only after the user
    // opens the Best result tab or enables its source overlay.
    async function loadBestEvidence() {
      const [loadedDiagnostic, loadedArtifact] = await Promise.allSettled([
        loadDiagnostic(bestCandidate.run, bestCandidate.result, controller.signal),
        loadArtifact(bestCandidate.run, bestCandidate.result, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      const diagnosticValue = loadedDiagnostic.status === "fulfilled"
        ? loadedDiagnostic.value.diagnostic
        : null;
      const diagnosticError = loadedDiagnostic.status === "rejected" &&
        loadedDiagnostic.reason instanceof Error
        ? loadedDiagnostic.reason.message
        : null;
      const artifactError = loadedArtifact.status === "rejected" &&
        loadedArtifact.reason instanceof Error
        ? loadedArtifact.reason.message
        : null;
      const artifactValue = loadedArtifact.status === "fulfilled"
        ? loadedArtifact.value
        : {
          url: artifactUrl(bestCandidate.run, bestCandidate.result.result_relative_path),
          markdown: "",
          markdownState: "unknown" as const,
          layoutBoxes: [] as ArtifactLayoutBox[],
        };
      setHistoricalBest((current) => ({
        ...current,
        evidenceStatus: "loaded",
        diagnostic: diagnosticValue,
        diagnosticError,
        artifact: {
          loading: false,
          markdown: artifactValue.markdown,
          markdownState: artifactValue.markdownState,
          layoutBoxes: artifactValue.layoutBoxes,
          url: artifactValue.url,
          error: artifactError,
        },
      }));
    }

    void loadBestEvidence();
    return () => controller.abort();
  }, [historicalBest.data, historicalBestResultId, historicalBestEvidenceResultId, selectedDocument]);

  function selectWorkflow(candidate: BenchmarkRun) {
    setLoadError(null);
    if (candidate.id !== selectedRunId) {
      setBundle(EMPTY_BUNDLE);
      setDocuments([]);
      setDocumentTotal(0);
      setDocumentsError(null);
      setSelectedDocument(null);
      setArtifact(EMPTY_ARTIFACT);
      setArtifactResultId(null);
      setDiagnostic(EMPTY_DIAGNOSTIC);
      setDiagnosticResultId(null);
      setHistoricalBest(EMPTY_HISTORICAL_BEST);
      setHistoricalBestResultId(null);
      setHistoricalBestEvidenceResultId(null);
    }
    setSelectedRunRecord(candidate);
    router.push(`/workflows/${candidate.github_run_id}`);
  }

  function inspectDimension(nextDimension: string) {
    if (!selectedRun) return;
    const resolvedDimension = nextDimension === "all"
      ? bundle.dimensions[0]?.dimension ?? DIMENSION_ORDER[0]
      : nextDimension;
    const query = `?dimension=${encodeURIComponent(resolvedDimension)}`;
    router.push(`/workflows/${selectedRun.github_run_id}/triage${query}`);
  }

  function inspectDocument(result: TriageCaseResult, navigationFilters: TriageFilters = filters) {
    if (!selectedRun) return;
    setQueueOpen(false);
    setSelectedDocument(null);
    setDocumentLoadState({ id: result.id, loading: true });
    setArtifactResultId(null);
    setDiagnosticResultId(null);
    setHistoricalBestResultId(null);
    setHistoricalBestEvidenceResultId(null);
    const query = triageQuery(navigationFilters);
    const origin = view === "overview"
      ? "overview"
      : view === "triage"
        ? "triage"
        : inspectionOrigin;
    query.set("from", origin);
    const href = `/workflows/${selectedRun.github_run_id}/triage/${result.id}`;
    router.push(query.size ? `${href}?${query.toString()}` : href, { scroll: false });
  }

  const resetFilters = useCallback(() => {
    updateFilters({
      dimension: bundle.dimensions[0]?.dimension ?? DIMENSION_ORDER[0],
      search: "",
      minimum: 0,
      maximum: 100,
      sort: "lowest",
      page: 0,
    });
  }, [bundle.dimensions, updateFilters]);

  useEffect(() => {
    if (
      view !== "runs" &&
      bundle.dimensions.length &&
      !bundle.dimensions.some((item) => item.dimension === filters.dimension)
    ) {
      updateFilters({ dimension: bundle.dimensions[0].dimension, page: 0 });
    }
  }, [bundle.dimensions, filters.dimension, updateFilters, view]);

  const currentIndex = routeCaseResultId == null
    ? -1
    : documents.findIndex((document) => document.id === routeCaseResultId);
  const previousDocument = currentIndex > 0 ? documents[currentIndex - 1] : null;
  const nextDocument = currentIndex >= 0 && currentIndex < documents.length - 1
    ? documents[currentIndex + 1]
    : null;
  const queueHref = selectedRun
    ? hrefWithTriageFilters(`/workflows/${selectedRun.github_run_id}/triage`, filters)
    : "/workflows";
  const displayedDocument = selectedDocument?.id === routeCaseResultId ? selectedDocument : null;
  const documentDetailsLoading = routeCaseResultId != null && (
    documentLoadState.id !== routeCaseResultId || documentLoadState.loading
  );
  const displayedArtifact = artifactResultId === routeCaseResultId
    ? artifact
    : { ...EMPTY_ARTIFACT, loading: documentDetailsLoading || displayedDocument != null };
  const displayedDiagnostic = diagnosticResultId === routeCaseResultId
    ? diagnostic
    : { ...EMPTY_DIAGNOSTIC, loading: documentDetailsLoading || displayedDocument != null };
  const displayedHistoricalBest = historicalBestResultId === routeCaseResultId
    ? historicalBest
    : { ...EMPTY_HISTORICAL_BEST, loading: documentDetailsLoading || displayedDocument != null };

  return (
    <div className={`app-shell app-view-${view}`}>
      <DashboardNavigation
        view={view}
        runId={githubRunId}
        caseResultId={routeCaseResultId}
        dimensions={bundle.dimensions.filter((dimension) => dimension.run_id === selectedRunId)}
        filters={filters}
        runCount={catalogLoaded ? catalogRuns.length : null}
        loading={catalogLoading}
        onJump={(href) => router.push(href)}
      />
      <RunContextBar run={selectedRun} runId={githubRunId} loading={selectedRunLoading} view={view} />

      {loadError && (
        <div className="global-alert" role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={() => setLoadError(null)}>Dismiss</button>
        </div>
      )}

      {view === "runs" ? (
        <WorkflowBrowser
          runs={catalogRuns}
          scores={runScores}
          loading={catalogLoading}
          scoresLoading={runScoresLoading}
          onSelect={selectWorkflow}
        />
      ) : selectedRun ? (
        view === "overview" ? (
          <Overview
            run={selectedRun}
            bundle={bundle}
            documents={documents}
            documentTotal={documentTotal}
            loading={bundleLoading}
            documentsLoading={documentsLoading}
            documentsError={documentsError}
            filters={filters}
            updateFilters={updateFilters}
            resetFilters={resetFilters}
            fullPageHref={queueHref}
            inspectDimension={inspectDimension}
            inspectDocument={inspectDocument}
          />
        ) : view === "triage" ? (
          <TriageGrid
            bundle={bundle}
            documents={documents}
            total={documentTotal}
            loading={documentsLoading || bundleLoading}
            error={documentsError}
            filters={filters}
            updateFilters={updateFilters}
            resetFilters={resetFilters}
            onSelect={inspectDocument}
          />
        ) : (
          <DocumentExplorer
            key={routeCaseResultId ?? "missing-case"}
            run={selectedRun}
            selected={displayedDocument}
            loading={documentDetailsLoading}
            artifact={displayedArtifact}
            diagnostic={displayedDiagnostic}
            historicalBest={displayedHistoricalBest}
            onRetryHistoricalBest={() => setHistoricalBestAttempt((attempt) => attempt + 1)}
            onLoadHistoricalBest={() => {
              if (!displayedDocument) return;
              setHistoricalBestEvidenceResultId(displayedDocument.id);
            }}
            onBrowseQueue={(trigger) => {
              queueTriggerRef.current = trigger;
              setQueueOpen(true);
            }}
            previous={previousDocument}
            next={nextDocument}
            onNavigate={inspectDocument}
          />
        )
      ) : (
        <main id="main-content" tabIndex={-1} className="content-shell">
          <EmptyState
            title={selectedRunLoading ? "Loading workflow" : "Workflow not found"}
            body={selectedRunLoading
              ? "Loading the selected workflow from the benchmark index."
              : `Workflow run #${githubRunId} is not in the benchmark index.`}
          />
        </main>
      )}
      {queueVisible && (
        <div ref={queueOverlayRef} className="queue-overlay" role="dialog" aria-modal="true" aria-label="Browse triage queue">
          <div className="queue-overlay-header">
            <div>
              <span className="eyebrow">Current filtered queue</span>
              <strong>Choose another case</strong>
            </div>
            <button ref={queueCloseButtonRef} type="button" onClick={() => setQueueOpen(false)} aria-label="Close queue browser">×</button>
          </div>
          <TriageGrid
            bundle={bundle}
            documents={documents}
            total={documentTotal}
            loading={documentsLoading}
            error={documentsError}
            filters={filters}
            updateFilters={updateFilters}
            resetFilters={resetFilters}
            onSelect={inspectDocument}
            compact
            selectedId={routeCaseResultId ?? undefined}
          />
        </div>
      )}
      {children}
    </div>
  );
}
