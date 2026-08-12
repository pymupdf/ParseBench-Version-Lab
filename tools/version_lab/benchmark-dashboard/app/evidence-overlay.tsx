"use client";

export type EvidenceOverlayBox = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: "ground-truth" | "prediction";
  status?: "passed" | "partial" | "failed" | "neutral";
};

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
        return (
          <button
            aria-label={`${box.kind === "ground-truth" ? "Expected" : "Predicted"} ${box.label}`}
            className={`evidence-box evidence-box-${box.kind} evidence-box-${box.status ?? "neutral"}${selectedId === box.id ? " evidence-box-selected" : ""}`}
            key={`${box.kind}-${box.id}`}
            onClick={() => onSelect?.(box.id)}
            style={{
              height: `${height * 100}%`,
              left: `${left * 100}%`,
              top: `${top * 100}%`,
              width: `${width * 100}%`,
            }}
            title={`${box.kind === "ground-truth" ? "Expected" : "Predicted"}: ${box.label}`}
            type="button"
          >
            <span>{box.label}</span>
          </button>
        );
      })}
    </div>
  );
}
