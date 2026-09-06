import {
  humanize,
  sourceAssetKind,
  sourceAssetUrl,
  thumbnailUrl,
  type DocumentSort,
  type RunBundle,
  type TriageCaseResult,
} from "../lib/data";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { DIMENSION_LABELS, DIMENSION_ORDER, TRIAGE_PAGE_SIZE } from "./constants";
import Image from "next/image";
import { documentName, scoreTone, scorePercent } from "./format";
import type { TriageFilters } from "./types";
import { normalizeTriageFilters, hrefWithTriageFilters } from "./filters";
import Link from "next/link";
import { EmptyState } from "./shared";

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
  const sourceFallback = sourceAssetKind(result) === "image" ? sourceAssetUrl(result) : null;
  const [imageSource, setImageSource] = useState(thumbnail ?? sourceFallback);
  const [imageFailed, setImageFailed] = useState(false);
  const label = DIMENSION_LABELS[result.run_dimensions.dimension] ?? humanize(result.run_dimensions.dimension);

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
      className={`triage-card ${selected ? "triage-card-selected" : ""}`}
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
            sizes="(max-width: 620px) 50vw, (max-width: 1000px) 33vw, 20vw"
            unoptimized
            onError={recoverMissingThumbnail}
          />
        ) : (
          <span className="thumbnail-fallback" aria-hidden="true">
            <span>{label.slice(0, 1)}</span>
            Preview unavailable
          </span>
        )}
        <span className="triage-card-badges">
          <span className="triage-dimension-badge">{label}</span>
          <span className={`triage-score-badge score-${scoreTone(result.primary_score)}`}>
            {scorePercent(result.primary_score)}
          </span>
        </span>
      </span>
      <span className="triage-card-copy">
        <strong title={documentName(result)}>{documentName(result)}</strong>
        <span>{result.success ? humanize(result.primary_metric_name) : "Evaluation error"}</span>
      </span>
    </button>
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
}: {
  bundle: RunBundle;
  filters: TriageFilters;
  total: number;
  updateFilters: (updates: Partial<TriageFilters>) => void;
  resetFilters: () => void;
  onDraftFiltersChange: (filters: TriageFilters) => void;
  navigationPendingRef: { current: boolean };
  fullPageHref?: string;
}) {
  const [draftSearch, setDraftSearch] = useState(filters.search);
  const [draftMinimum, setDraftMinimum] = useState(filters.minimum);
  const [draftMaximum, setDraftMaximum] = useState(filters.maximum);
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
      if (!navigationPendingRef.current && (draftMinimum !== filters.minimum || draftMaximum !== filters.maximum)) {
        updateFilters({ minimum: draftMinimum, maximum: draftMaximum, page: 0 });
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [draftMaximum, draftMinimum, filters.maximum, filters.minimum, navigationPendingRef, updateFilters]);

  return (
    <section className="triage-toolbar" aria-label="Triage filters">
      <div className="triage-toolbar-topline">
        <div>
          <span className="eyebrow">Visual case finder</span>
          <h1>Triage queue</h1>
        </div>
        <div className="triage-toolbar-actions">
          <span className="triage-result-summary" aria-live="polite">
            <strong>{total.toLocaleString()}</strong> matching cases
          </span>
          {fullPageHref && (
            <Link
              className="triage-full-page-link"
              href={hrefWithTriageFilters(fullPageHref.split("?")[0], draftFilters)}
              onNavigate={() => {
                navigationPendingRef.current = true;
              }}
            >
              Open full page ↗
            </Link>
          )}
        </div>
      </div>

      <div className="dimension-pills" aria-label="Evaluation dimension">
        {bundle.dimensions.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={filters.dimension === item.dimension}
            onClick={() => updateFilters(reportDraft({ dimension: item.dimension, page: 0 }))}
          >
            {DIMENSION_LABELS[item.dimension] ?? humanize(item.dimension)}
            <span>{item.total_examples?.toLocaleString() ?? 0}</span>
          </button>
        ))}
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
          <div className="dual-range" style={{ "--range-start": `${draftMinimum}%`, "--range-end": `${draftMaximum}%` } as CSSProperties}>
            <span className="dual-range-track" />
            <input
              aria-label="Minimum score"
              type="range"
              min="0"
              max="100"
              step="1"
              value={draftMinimum}
              onChange={(event) => {
                const minimum = Math.min(Number(event.target.value), draftMaximum);
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
                const maximum = Math.max(Number(event.target.value), draftMinimum);
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
            onChange={(event) => updateFilters(reportDraft({ sort: event.target.value as DocumentSort, page: 0 }))}
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
              dimension: bundle.dimensions[0]?.dimension ?? DIMENSION_ORDER[0],
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
  onSelect: (result: TriageCaseResult, navigationFilters?: TriageFilters) => void;
  compact?: boolean;
  embedded?: boolean;
  fullPageHref?: string;
  selectedId?: number;
}) {
  const Container = compact || embedded ? "div" : "main";
  const pageCount = Math.max(1, Math.ceil(total / TRIAGE_PAGE_SIZE));
  const draftFiltersRef = useRef(filters);
  const navigationPendingRef = useRef(false);

  useEffect(() => {
    draftFiltersRef.current = filters;
  }, [filters]);

  return (
    <Container id={!compact && !embedded ? "main-content" : undefined} tabIndex={!compact && !embedded ? -1 : undefined} className={compact ? "queue-overlay-body" : embedded ? "triage-embedded" : "triage-page"}>
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
      />
      <section className="triage-results" aria-label="Matching benchmark cases">
        {error ? (
          <EmptyState title="Could not load document results" body={error} />
        ) : loading ? (
          <div className="triage-grid-loading" role="status">Loading document thumbnails…</div>
        ) : documents.length ? (
          <div className="triage-grid">
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
          <EmptyState title="No matching cases" body="Adjust the score range, dimension, or document search." />
        )}
      </section>
      {total > TRIAGE_PAGE_SIZE && (
        <nav className="triage-pagination" aria-label="Triage result pages">
          <button type="button" disabled={filters.page === 0} onClick={() => updateFilters({ page: Math.max(0, filters.page - 1) })}>← Previous</button>
          <span>Page {filters.page + 1} of {pageCount}</span>
          <button type="button" disabled={filters.page >= pageCount - 1} onClick={() => updateFilters({ page: Math.min(pageCount - 1, filters.page + 1) })}>Next →</button>
        </nav>
      )}
    </Container>
  );
}
