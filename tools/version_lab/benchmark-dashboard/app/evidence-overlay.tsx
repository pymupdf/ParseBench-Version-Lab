"use client";

import { useState } from "react";

export type EvidenceOverlayBox = {
  id: string;
  relatedIds?: string[];
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: "ground-truth" | "prediction" | "best";
  sourceIndex?: number;
  tone?: EvidenceOverlayTone;
  status?: "passed" | "partial" | "failed" | "unknown" | "neutral" | "ignored" | "reference";
};

export type EvidenceOverlayTone = "section" | "text" | "table" | "visual" | "other";

function normalizedBounds(box: EvidenceOverlayBox) {
  const left = Math.max(0, Math.min(1, box.x));
  const top = Math.max(0, Math.min(1, box.y));
  const width = Math.max(0, Math.min(1 - left, box.width));
  const height = Math.max(0, Math.min(1 - top, box.height));
  return { left, top, width, height };
}

export function EvidenceOverlay({
  boxes,
  selectedId,
  onSelect,
}: {
  boxes: EvidenceOverlayBox[];
  selectedId?: string | null;
  onSelect?: (id: string, kind: EvidenceOverlayBox["kind"]) => void;
}) {
  const [hoveredExpectedId, setHoveredExpectedId] = useState<string | null>(null);

  if (!boxes.length) return null;

  const expectedAtPosition = (clientX: number, clientY: number, overlay: HTMLDivElement) => {
    const overlayBounds = overlay.getBoundingClientRect();
    if (!overlayBounds.width || !overlayBounds.height) return null;
    const x = (clientX - overlayBounds.left) / overlayBounds.width;
    const y = (clientY - overlayBounds.top) / overlayBounds.height;
    let match: { box: EvidenceOverlayBox; area: number } | null = null;
    for (const box of boxes) {
      if (box.kind !== "ground-truth") continue;
      const bounds = normalizedBounds(box);
      const containsPoint = x >= bounds.left
        && x <= bounds.left + bounds.width
        && y >= bounds.top
        && y <= bounds.top + bounds.height;
      if (!containsPoint) continue;
      const area = bounds.width * bounds.height;
      if (!match || area < match.area) match = { box, area };
    }
    return match?.box ?? null;
  };

  const activeHoveredExpectedId = boxes.some(
    (box) => box.kind === "ground-truth" && box.id === hoveredExpectedId,
  )
    ? hoveredExpectedId
    : null;

  return (
    <div
      aria-label="Evaluation evidence overlay"
      className={`evidence-overlay${activeHoveredExpectedId ? " evidence-overlay-has-hovered-expected" : ""}`}
      onPointerUp={(event) => {
        if (event.target !== event.currentTarget) return;
        const expected = expectedAtPosition(event.clientX, event.clientY, event.currentTarget);
        if (expected) onSelect?.(expected.id, expected.kind);
      }}
      onPointerLeave={() => setHoveredExpectedId(null)}
      onPointerMove={(event) => {
        const directExpected = (event.target as HTMLElement).closest<HTMLButtonElement>(
          ".evidence-box-ground-truth",
        );
        const expected = directExpected
          ? boxes.find((box) => box.kind === "ground-truth" && box.id === directExpected.dataset.evidenceId) ?? null
          : expectedAtPosition(event.clientX, event.clientY, event.currentTarget);
        setHoveredExpectedId(expected?.id ?? null);
      }}
    >
      {boxes.map((box) => {
        const { left, top, width, height } = normalizedBounds(box);
        const kindLabel = box.kind === "ground-truth"
          ? "Expected"
          : box.kind === "best"
            ? "Best result"
            : "Output";
        const selected = selectedId === box.id || box.relatedIds?.includes(selectedId ?? "") === true;
        return (
          <button
            aria-label={`${kindLabel} ${box.label}`}
            className={`evidence-box evidence-box-${box.kind} evidence-box-${box.status ?? "neutral"} evidence-box-tone-${box.tone ?? "other"}${selected ? " evidence-box-selected" : ""}${box.kind === "ground-truth" && box.id === activeHoveredExpectedId ? " evidence-box-hovered" : ""}`}
            data-evidence-id={box.id}
            key={`${box.kind}-${box.id}`}
            onClick={() => onSelect?.(box.id, box.kind)}
            style={{
              height: `${height * 100}%`,
              left: `${left * 100}%`,
              top: `${top * 100}%`,
              width: `${width * 100}%`,
            }}
            title={`${kindLabel}: ${box.label}`}
            type="button"
          >
            <span>{kindLabel} · {box.label}</span>
          </button>
        );
      })}
    </div>
  );
}
