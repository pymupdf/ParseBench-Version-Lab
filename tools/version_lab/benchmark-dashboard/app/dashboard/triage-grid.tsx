import {
  humanize,
  primaryMetricForDimension,
  sourceAssetKind,
  sourceAssetUrl,
  thumbnailUrl,
  type DocumentSort,
  type RunBundle,
  type TriageCaseResult,
} from "../lib/data";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  DIMENSION_LABELS,
  DIMENSION_ORDER,
  TRIAGE_PAGE_SIZE,
} from "./constants";
import Image from "next/image";
import { documentName, scoreTone, scorePercent, scoreWidth } from "./format";
import type { TriageFilters } from "./types";
import { normalizeTriageFilters, hrefWithTriageFilters } from "./filters";
import Link from "next/link";
import { EmptyState, ScoreBar } from "./shared";
import { DimensionIcon, dimensionPresentation } from "./dimension-presentation";

function ThumbnailCard({
  result,
  selected,
  eager,
  onSelect,
}: {
  result: TriageCaseResult;
  selected?: boolean;
  eager?: boolean;
  onSelect: (result: TriageCaseResult) => void;
}) {
  const thumbnail = thumbnailUrl(result);
  const sourceFallback =
    sourceAssetKind(result) === "image" ? sourceAssetUrl(result) : null;
  const [imageSource, setImageSource] = useState(thumbnail ?? sourceFallback);
  const [imageFailed, setImageFailed] = useState(false);
  const label =
    DIMENSION_LABELS[result.run_dimensions.dimension] ??
    humanize(result.run_dimensions.dimension);
  const parentPath = result.benchmark_cases.test_id
    .split("/")
    .slice(0, -1)
    .join("/");
  const sourceKind = sourceAssetKind(result);

  function recoverMissingThumbnail() {
    if (imageSource === thumbnail && sourceFallback) {
      setImageSource(sourceFallback);
    } else {
      setImageFailed(true);
    }
  }

  return (
    <button
      type="button"
      className={`triage-card case-file ${selected ? "triage-card-selected" : ""}`}
      aria-pressed={selected}
      onClick={() => onSelect(result)}
    >
      <span className="triage-thumbnail">
        {imageSource && !imageFailed ? (
          <Image
            src={imageSource}
            alt={`Thumbnail of ${documentName(result)}`}
            fill
            loading={eager ? "eager" : "lazy"}
            sizes="(max-width: 620px) 50vw, (max-width: 1000px) 33vw, (max-width: 1400px) 25vw, 20vw"
            unoptimized
            onError={recoverMissingThumbnail}
          />
        ) : (
          <span className="thumbnail-fallback" aria-hidden="true">
            <span>{label.slice(0, 1)}</span>
            Preview unavailable
          </span>
        )}
        <span className="case-source-stamp">
          {sourceKind === "pdf"
            ? "PDF"
            : sourceKind === "image"
              ? "Image"
              : label}
          {result.benchmark_cases.page_number != null
            ? ` · p. ${result.benchmark_cases.page_number}`
            : ""}
        </span>
      </span>
      <span className="triage-card-copy">
        <span className="case-collection" title={parentPath}>
          {parentPath || label}
        </span>
        <strong title={documentName(result)}>{documentName(result)}</strong>
        <span className="case-metric-name">
          {result.success
            ? humanize(result.primary_metric_name)
            : "Evaluation error"}
        </span>
      </span>
      <span className="case-score-line">
        <span className={`case-score score-${scoreTone(result.primary_score)}`}>
          {scorePercent(result.primary_score)}
        </span>
        <span className="case-open-label">
          Inspect <span aria-hidden="true">↗</span>
        </span>
      </span>
      <span className="case-score-track" aria-hidden="true">
        <span
          className={`score-fill-${scoreTone(result.primary_score)}`}
          style={{ width: scoreWidth(result.primary_score) }}
        />
      </span>
    </button>
  );
}

function DimensionSummary({
  bundle,
  dimension,
  embedded,
}: {
  bundle: RunBundle;
  dimension: string;
  embedded: boolean;
}) {
  const item = bundle.dimensions.find(
    (candidate) => candidate.dimension === dimension,
  );
  const metric = item ? primaryMetricForDimension(item, bundle.metrics) : null;
  const presentation = dimensionPresentation(dimension);
  const Heading = embedded ? "h2" : "h1";
  return (
    <div className="dimension-summary">
      <div className="dimension-introduction">
        <span className="dimension-mark">
          <DimensionIcon dimension={dimension} />
        </span>
        <div>
          <span className="eyebrow">
            {embedded ? "Explore the results" : "Dimension analysis"}
          </span>
          <Heading>
            {presentation.label}
            <span className="dimension-focus">{presentation.focus}</span>
          </Heading>
          <p>{presentation.description}</p>
        </div>
      </div>
      <div
        className="dimension-run-metrics"
        aria-label={`${presentation.label} run totals`}
      >
        <div className="dimension-primary-score">
          <span>Aggregate score</span>
          <strong>{scorePercent(metric?.metric_value)}</strong>
          <ScoreBar score={metric?.metric_value} />
          <small>
            {metric
              ? humanize(metric.metric_name)
              : "No aggregate score available"}
          </small>
        </div>
        <div className="dimension-coverage">
          <div>
            <span>Scored cases</span>
            <strong>
              {(
                metric?.evaluated_count ?? item?.successful
              )?.toLocaleString() ?? "—"}
              <small> / {item?.total_examples?.toLocaleString() ?? "—"}</small>
            </strong>
          </div>
          <div>
            <span>Evaluation errors</span>
            <strong>{item?.failed?.toLocaleString() ?? "—"}</strong>
          </div>
          {item?.skipped != null && item.skipped > 0 ? (
            <div>
              <span>Skipped</span>
              <strong>{item.skipped.toLocaleString()}</strong>
            </div>
          ) : null}
        </div>
        <p className="dimension-totals-note">
          Run totals · independent of queue filters
        </p>
      </div>
    </div>
  );
}

function TriageToolbar({
  bundle,
  filters,
  total,
  updateFilters,
  resetFilters,
  onDraftFiltersChange,
  navigationPendingRef,
  fullPageHref,
  embedded,
}: {
  bundle: RunBundle;
  filters: TriageFilters;
  total: number;
  updateFilters: (updates: Partial<TriageFilters>) => void;
  resetFilters: () => void;
  onDraftFiltersChange: (filters: TriageFilters) => void;
  navigationPendingRef: { current: boolean };
  fullPageHref?: string;
  embedded: boolean;
}) {
  const [draftSearch, setDraftSearch] = useState(filters.search);
  const [draftMinimum, setDraftMinimum] = useState(filters.minimum);
  const [draftMaximum, setDraftMaximum] = useState(filters.maximum);
  const dimensionNavigationRef = useRef<HTMLDivElement>(null);
  const draftFilters = normalizeTriageFilters({
    ...filters,
    search: draftSearch,
    minimum: draftMinimum,
    maximum: draftMaximum,
  });

  function reportDraft(updates: Partial<TriageFilters>) {
    const next = normalizeTriageFilters({ ...draftFilters, ...updates });
    onDraftFiltersChange(next);
    return next;
  }

  function setScoreRange(minimum: number, maximum: number) {
    setDraftMinimum(minimum);
    setDraftMaximum(maximum);
    updateFilters(reportDraft({ minimum, maximum, page: 0 }));
  }

  useEffect(() => {
    const navigation = dimensionNavigationRef.current;
    const active = navigation?.querySelector<HTMLButtonElement>(
      '[aria-pressed="true"]',
    );
    if (!navigation || !active) return;
    const navigationBounds = navigation.getBoundingClientRect();
    const activeBounds = active.getBoundingClientRect();
    if (
      activeBounds.left < navigationBounds.left ||
      activeBounds.right > navigationBounds.right
    ) {
      navigation.scrollTo({
        left:
          navigation.scrollLeft +
          activeBounds.left -
          navigationBounds.left -
          (navigation.clientWidth - activeBounds.width) / 2,
      });
    }
  }, [bundle.dimensions, filters.dimension]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!navigationPendingRef.current && draftSearch !== filters.search) {
        updateFilters({ search: draftSearch, page: 0 });
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [draftSearch, filters.search, navigationPendingRef, updateFilters]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (
        !navigationPendingRef.current &&
        (draftMinimum !== filters.minimum || draftMaximum !== filters.maximum)
      ) {
        updateFilters({
          minimum: draftMinimum,
          maximum: draftMaximum,
          page: 0,
        });
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [
    draftMaximum,
    draftMinimum,
    filters.maximum,
    filters.minimum,
    navigationPendingRef,
    updateFilters,
  ]);

  return (
    <section className="triage-toolbar" aria-label="Triage filters">
      <div className="triage-workspace-heading">
        <span className="eyebrow">
          {embedded ? "Document results" : "Triage queue"}
        </span>
        {fullPageHref && (
          <Link
            className="triage-full-page-link"
            href={hrefWithTriageFilters(
              fullPageHref.split("?")[0],
              draftFilters,
            )}
            onNavigate={() => {
              navigationPendingRef.current = true;
            }}
          >
            Open dimension workspace ↗
          </Link>
        )}
      </div>
      <div
        className="dimension-pills"
        aria-label="Evaluation dimension"
        ref={dimensionNavigationRef}
      >
        {bundle.dimensions.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={filters.dimension === item.dimension}
            onClick={() =>
              updateFilters(reportDraft({ dimension: item.dimension, page: 0 }))
            }
          >
            <DimensionIcon dimension={item.dimension} />
            <span className="dimension-nav-label">
              {DIMENSION_LABELS[item.dimension] ?? humanize(item.dimension)}
            </span>
            <span className="dimension-nav-score">
              {scorePercent(
                primaryMetricForDimension(item, bundle.metrics)?.metric_value,
              )}
            </span>
          </button>
        ))}
      </div>

      <DimensionSummary
        bundle={bundle}
        dimension={filters.dimension}
        embedded={embedded}
      />

      <div className="case-finder-controls">
        <div className="case-finder-heading">
          <strong>Find a case</strong>
          <span className="triage-result-summary" aria-live="polite">
            <strong>{total.toLocaleString()}</strong> matching cases
          </span>
        </div>
        <div className="triage-controls">
          <label className="triage-search">
            <span>Search documents</span>
            <input
              type="search"
              value={draftSearch}
              onChange={(event) => {
                setDraftSearch(event.target.value);
                reportDraft({ search: event.target.value, page: 0 });
              }}
              placeholder="Name, identifier, or page"
            />
          </label>

          <fieldset className="score-range-control">
            <legend>Score range</legend>
            <div className="score-range-values">
              <output>{draftMinimum}%</output>
              <span>to</span>
              <output>{draftMaximum}%</output>
            </div>
            <div
              className="dual-range"
              style={
                {
                  "--range-start": `${draftMinimum}%`,
                  "--range-end": `${draftMaximum}%`,
                } as CSSProperties
              }
            >
              <span className="dual-range-track" />
              <input
                aria-label="Minimum score"
                type="range"
                min="0"
                max="100"
                step="1"
                value={draftMinimum}
                onChange={(event) => {
                  const minimum = Math.min(
                    Number(event.target.value),
                    draftMaximum,
                  );
                  setDraftMinimum(minimum);
                  reportDraft({ minimum, page: 0 });
                }}
              />
              <input
                aria-label="Maximum score"
                type="range"
                min="0"
                max="100"
                step="1"
                value={draftMaximum}
                onChange={(event) => {
                  const maximum = Math.max(
                    Number(event.target.value),
                    draftMinimum,
                  );
                  setDraftMaximum(maximum);
                  reportDraft({ maximum, page: 0 });
                }}
              />
            </div>
          </fieldset>

          <label className="triage-sort">
            <span>Sort by</span>
            <select
              value={filters.sort}
              onChange={(event) =>
                updateFilters(
                  reportDraft({
                    sort: event.target.value as DocumentSort,
                    page: 0,
                  }),
                )
              }
            >
              <option value="lowest">Lowest score</option>
              <option value="highest">Highest score</option>
              <option value="document">Document order</option>
            </select>
          </label>

          <button
            className="reset-filters"
            type="button"
            onClick={() => {
              const next = normalizeTriageFilters({
                dimension:
                  bundle.dimensions[0]?.dimension ?? DIMENSION_ORDER[0],
                search: "",
                minimum: 0,
                maximum: 100,
                sort: "lowest",
                page: 0,
              });
              setDraftSearch("");
              setDraftMinimum(0);
              setDraftMaximum(100);
              onDraftFiltersChange(next);
              resetFilters();
            }}
          >
            Reset
          </button>
        </div>
        <div className="score-quick-filters" aria-label="Score shortcuts">
          <span>Score shortcuts</span>
          {[
            { label: "All scores", minimum: 0, maximum: 100 },
            { label: "0–45%", minimum: 0, maximum: 45 },
            { label: "45–75%", minimum: 45, maximum: 75 },
            { label: "75–100%", minimum: 75, maximum: 100 },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              aria-pressed={
                draftMinimum === preset.minimum &&
                draftMaximum === preset.maximum
              }
              onClick={() => setScoreRange(preset.minimum, preset.maximum)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export function TriageGrid({
  bundle,
  documents,
  total,
  loading,
  error,
  filters,
  updateFilters,
  resetFilters,
  onSelect,
  compact = false,
  embedded = false,
  fullPageHref,
  selectedId,
}: {
  bundle: RunBundle;
  documents: TriageCaseResult[];
  total: number;
  loading: boolean;
  error?: string | null;
  filters: TriageFilters;
  updateFilters: (updates: Partial<TriageFilters>) => void;
  resetFilters: () => void;
  onSelect: (
    result: TriageCaseResult,
    navigationFilters?: TriageFilters,
  ) => void;
  compact?: boolean;
  embedded?: boolean;
  fullPageHref?: string;
  selectedId?: number;
}) {
  const Container = compact || embedded ? "div" : "main";
  const pageCount = Math.max(1, Math.ceil(total / TRIAGE_PAGE_SIZE));
  const draftFiltersRef = useRef(filters);
  const navigationPendingRef = useRef(false);
  const [displayMode, setDisplayMode] = useState<"grid" | "list">("grid");
  const firstResult = total ? filters.page * TRIAGE_PAGE_SIZE + 1 : 0;
  const lastResult = Math.min(
    total,
    filters.page * TRIAGE_PAGE_SIZE + documents.length,
  );

  useEffect(() => {
    draftFiltersRef.current = filters;
  }, [filters]);

  return (
    <Container
      id={!compact && !embedded ? "main-content" : undefined}
      tabIndex={!compact && !embedded ? -1 : undefined}
      data-dimension={filters.dimension}
      className={`dimension-context case-workspace ${compact ? "queue-overlay-body" : embedded ? "triage-embedded" : "triage-page"}`}
    >
      <TriageToolbar
        key={`${filters.search}:${filters.minimum}:${filters.maximum}`}
        bundle={bundle}
        filters={filters}
        total={total}
        updateFilters={updateFilters}
        resetFilters={resetFilters}
        onDraftFiltersChange={(draftFilters) => {
          navigationPendingRef.current = false;
          draftFiltersRef.current = draftFilters;
        }}
        navigationPendingRef={navigationPendingRef}
        fullPageHref={fullPageHref}
        embedded={compact || embedded}
      />
      <section
        className="triage-results"
        aria-label="Matching benchmark cases"
        aria-busy={loading}
      >
        <div className="case-results-heading">
          <div>
            <h2>Case library</h2>
            <span>
              {loading
                ? "Loading cases…"
                : error
                  ? "Results unavailable"
                  : `${firstResult.toLocaleString()}–${lastResult.toLocaleString()} of ${total.toLocaleString()} cases`}
            </span>
          </div>
          <div className="case-view-toggle" aria-label="Case display">
            <button
              type="button"
              aria-label="Grid view"
              aria-pressed={displayMode === "grid"}
              onClick={() => setDisplayMode("grid")}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2 2h4v4H2zm8 0h4v4h-4zM2 10h4v4H2zm8 0h4v4h-4z" />
              </svg>
              <span>Grid</span>
            </button>
            <button
              type="button"
              aria-label="List view"
              aria-pressed={displayMode === "list"}
              onClick={() => setDisplayMode("list")}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2 3h12M2 8h12M2 13h12" />
              </svg>
              <span>List</span>
            </button>
          </div>
        </div>
        {error ? (
          <EmptyState title="Could not load document results" body={error} />
        ) : loading ? (
          <div className="case-loading-grid" role="status">
            <span className="sr-only">Loading document thumbnails…</span>
            {Array.from({ length: 5 }, (_, index) => (
              <div className="case-skeleton" key={index} aria-hidden="true">
                <span />
                <i />
                <i />
              </div>
            ))}
          </div>
        ) : documents.length ? (
          <div
            className={`triage-grid ${displayMode === "list" ? "case-list-view" : "case-grid-view"}`}
          >
            {documents.map((result, index) => (
              <ThumbnailCard
                key={result.id}
                result={result}
                selected={result.id === selectedId}
                eager={index < 6}
                onSelect={(selected) => {
                  navigationPendingRef.current = true;
                  onSelect(selected, draftFiltersRef.current);
                }}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No matching cases"
            body="Adjust the score range, dimension, or document search."
          />
        )}
      </section>
      {total > TRIAGE_PAGE_SIZE && (
        <nav className="triage-pagination" aria-label="Triage result pages">
          <button
            type="button"
            disabled={filters.page === 0}
            onClick={() =>
              updateFilters({ page: Math.max(0, filters.page - 1) })
            }
          >
            ← Previous
          </button>
          <span>
            Page {filters.page + 1} of {pageCount}
          </span>
          <button
            type="button"
            disabled={filters.page >= pageCount - 1}
            onClick={() =>
              updateFilters({ page: Math.min(pageCount - 1, filters.page + 1) })
            }
          >
            Next →
          </button>
        </nav>
      )}
    </Container>
  );
}
