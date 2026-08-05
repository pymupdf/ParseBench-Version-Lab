"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const PDF_OPTIONS = { rangeChunkSize: 65_536 } as const;

export default function PdfPreview({
  source,
  page,
  title,
}: {
  source: string;
  page: number;
  title: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = Math.max(240, Math.floor(entry.contentRect.width - 16));
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
        loading={<div className="artifact-loading">Loading PDF page…</div>}
        error={<div className="artifact-loading">PDF preview unavailable</div>}
      >
        <Page
          pageNumber={Math.max(1, page)}
          width={width}
          devicePixelRatio={Math.min(window.devicePixelRatio || 1, 1.5)}
          renderAnnotationLayer={false}
          renderTextLayer={false}
          loading={<div className="artifact-loading">Rendering PDF page…</div>}
        />
      </Document>
    </div>
  );
}
