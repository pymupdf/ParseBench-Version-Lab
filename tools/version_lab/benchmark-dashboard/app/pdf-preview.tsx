"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import { EvidenceOverlay, type EvidenceOverlayBox } from "./evidence-overlay";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const PDF_OPTIONS = { rangeChunkSize: 65_536 } as const;

export default function PdfPreview({
  source,
  page,
  title,
  boxes = [],
  selectedId,
  onSelect,
}: {
  source: string;
  page: number;
  title: string;
  boxes?: EvidenceOverlayBox[];
  selectedId?: string | null;
  onSelect?: (id: string, kind: EvidenceOverlayBox["kind"]) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [loadedDocument, setLoadedDocument] = useState<{ source: string; pages: number } | null>(null);
  const requestedPage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
  const pageCount = loadedDocument?.source === source ? loadedDocument.pages : null;
  const pageUnavailable = pageCount != null && requestedPage > pageCount;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = Math.max(1, Math.floor(entry.contentRect.width - 16));
      setWidth((current) => (Math.abs(current - nextWidth) > 1 ? nextWidth : current));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="pdf-preview" ref={hostRef} aria-label={title}>
      <Document
        file={source}
        options={PDF_OPTIONS}
        onLoadSuccess={({ numPages }) => setLoadedDocument({ source, pages: numPages })}
        loading={<div className="artifact-loading" role="status">Loading PDF page…</div>}
        error={(
          <div className="artifact-loading" role="status">
            PDF preview unavailable. <a href={source} target="_blank" rel="noreferrer">Open source PDF</a>
          </div>
        )}
      >
        {pageUnavailable ? (
          <div className="artifact-loading" role="status">
            Page {requestedPage} is unavailable in this {pageCount}-page PDF.
          </div>
        ) : <div className="pdf-evidence-page">
          <Page
            pageNumber={requestedPage}
            width={width}
            devicePixelRatio={typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 1.5)}
            renderAnnotationLayer={false}
            renderTextLayer={false}
            loading={<div className="artifact-loading" role="status">Rendering PDF page…</div>}
            error={<div className="artifact-loading" role="status">This PDF page could not be rendered.</div>}
          />
          <EvidenceOverlay boxes={boxes} selectedId={selectedId} onSelect={onSelect} />
        </div>}
      </Document>
    </div>
  );
}
