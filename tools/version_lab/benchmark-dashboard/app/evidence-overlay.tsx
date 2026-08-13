"use client";

export type EvidenceOverlayBox = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: "ground-truth" | "prediction" | "best";
  tone?: EvidenceOverlayTone;
  status?: "passed" | "partial" | "failed" | "neutral";
};

export type EvidenceOverlayTone = "section" | "text" | "table" | "visual" | "other";

export function EvidenceOverlay({
  boxes,
  selectedId,
  onSelect,
}: {
  boxes: EvidenceOverlayBox[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  if (!boxes.length) return null;
  return (
    <div className="evidence-overlay" aria-label="Evaluation evidence overlay">
      {boxes.map((box) => {
        const left = Math.max(0, Math.min(1, box.x));
        const top = Math.max(0, Math.min(1, box.y));
        const width = Math.max(0, Math.min(1 - left, box.width));
        const height = Math.max(0, Math.min(1 - top, box.height));
        const kindLabel = box.kind === "ground-truth"
          ? "Expected"
          : box.kind === "best"
            ? "Best result"
            : "Output";
        return (
          <button
            aria-label={`${kindLabel} ${box.label}`}
            className={`evidence-box evidence-box-${box.kind} evidence-box-${box.status ?? "neutral"} evidence-box-tone-${box.tone ?? "other"}${selectedId === box.id ? " evidence-box-selected" : ""}`}
            key={`${box.kind}-${box.id}`}
            onClick={() => onSelect?.(box.id)}
            style={{
              height: `${height * 100}%`,
              left: `${left * 100}%`,
              top: `${top * 100}%`,
              width: `${width * 100}%`,
            }}
            title={`${kindLabel}: ${box.label}`}
            type="button"
          >
            <span>{box.label}</span>
          </button>
        );
      })}
    </div>
  );
}
