import type { EvidenceOverlayTone, EvidenceOverlayBox } from "../evidence-overlay";
import {
  diagnosticUsesElementLayout,
  layoutElementHeadlineStatus,
  layoutExpectationIgnored,
} from "../diagnostics/semantics";
import type { DiagnosticArtifact } from "../diagnostics/types";
import type { ArtifactLayoutBox } from "../lib/data";

function objectValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizedBox(value: unknown) {
  if (!Array.isArray(value) || value.length < 4) return null;
  const coordinates = value.slice(0, 4).map(finiteNumber);
  if (coordinates.some((coordinate) => coordinate == null)) return null;
  const [x, y, width, height] = coordinates as [number, number, number, number];
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function normalizedCornerBox(value: unknown) {
  if (!Array.isArray(value) || value.length < 4) return null;
  const coordinates = value.slice(0, 4).map(finiteNumber);
  if (coordinates.some((coordinate) => coordinate == null)) return null;
  const [x1, y1, x2, y2] = coordinates as [number, number, number, number];
  return normalizedBox([x1, y1, x2 - x1, y2 - y1]);
}

export const LAYOUT_REGION_TONES: Array<{ tone: EvidenceOverlayTone; label: string }> = [
  { tone: "section", label: "Section" },
  { tone: "text", label: "Text" },
  { tone: "table", label: "Table" },
  { tone: "visual", label: "Picture / chart" },
  { tone: "other", label: "Other" },
];

function layoutRegionTone(label: string): EvidenceOverlayTone {
  const normalized = label.toLowerCase();
  if (/(section|header|heading)/.test(normalized)) return "section";
  if (/(table|grid)/.test(normalized)) return "table";
  if (/(picture|image|figure|chart|graphic)/.test(normalized)) return "visual";
  if (/(text|caption|footnote|paragraph|list)/.test(normalized)) return "text";
  return "other";
}

export function layoutOverlayBoxes(
  isLayoutDimension: boolean,
  diagnostic: DiagnosticArtifact | null,
  outputBoxes: ArtifactLayoutBox[],
  bestDiagnostic: DiagnosticArtifact | null,
  bestOutputBoxes: ArtifactLayoutBox[],
) {
  if (!isLayoutDimension) return [];
  const boxes: EvidenceOverlayBox[] = [];
  if (diagnostic?.dimension === "layout") {
    const referenceOnly = !diagnosticUsesElementLayout(diagnostic);
    for (const expectation of diagnostic.expectations) {
      const rule = objectValue(expectation.rule);
      const ignored = layoutExpectationIgnored(expectation);
      const expectedClass = typeof rule?.canonical_class === "string"
        ? rule.canonical_class
        : "Expected element";
      const box = normalizedBox(rule?.bbox);
      if (box) {
        boxes.push({
          ...box,
          id: expectation.id,
          kind: "ground-truth",
          label: referenceOnly
            ? `Reference only — ${expectedClass}`
            : ignored
              ? `Ignored by scoring — ${expectedClass}`
              : expectedClass,
          tone: layoutRegionTone(expectedClass),
          status: referenceOnly ? "reference" : ignored ? "ignored" : "neutral",
        });
      }
    }
  }

  function appendPredictions(
    source: DiagnosticArtifact | null,
    kind: "prediction" | "best",
  ) {
    const appended: EvidenceOverlayBox[] = [];
    if (!source || source.dimension !== "layout") return appended;
    const compactOutcomes = (source.outcomes ?? [])
      .map(objectValue)
      .filter((value): value is Record<string, unknown> => value != null);
    const metricOutcomes = source.metrics
      .flatMap((metric) => {
        const results = objectValue(metric.metadata)?.rule_results;
        return Array.isArray(results)
          ? results.map(objectValue).filter((value): value is Record<string, unknown> => value != null)
          : [];
      });
    const outcomes = compactOutcomes.length ? compactOutcomes : metricOutcomes;
    const outcomesById = new Map<string, Record<string, unknown>>();
    for (const outcome of outcomes) {
      const id = [outcome.element_id, outcome.id, outcome.rule_id]
        .find((value): value is string => typeof value === "string");
      if (id) outcomesById.set(id, outcome);
    }
    const predictionsByRegion = new Map<string, EvidenceOverlayBox>();

    for (const expectation of source.expectations) {
      const outcome = outcomesById.get(expectation.id);
      if (!outcome) continue;
      const box = normalizedCornerBox(outcome.best_pred_bbox);
      if (box) {
        const sourceIndex = finiteNumber(outcome.best_pred_index);
        const regionKey = sourceIndex != null
          ? `index:${sourceIndex}`
          : [box.x, box.y, box.width, box.height].map((value) => value.toFixed(6)).join(":");
        const existing = predictionsByRegion.get(regionKey);
        if (existing) {
          existing.relatedIds = [...(existing.relatedIds ?? []), expectation.id];
          continue;
        }
        const label = typeof outcome.best_pred_class === "string"
          ? outcome.best_pred_class
          : "Predicted element";
        const prediction: EvidenceOverlayBox = {
          ...box,
          id: expectation.id,
          relatedIds: [expectation.id],
          kind,
          label,
          sourceIndex: sourceIndex ?? undefined,
          tone: layoutRegionTone(label),
          status: layoutElementHeadlineStatus(outcome),
        };
        boxes.push(prediction);
        appended.push(prediction);
        predictionsByRegion.set(regionKey, prediction);
      }
    }
    return appended;
  }

  function intersectionOverUnion(
    left: Pick<EvidenceOverlayBox, "x" | "y" | "width" | "height">,
    right: Pick<EvidenceOverlayBox, "x" | "y" | "width" | "height">,
  ) {
    const intersectionWidth = Math.max(
      0,
      Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
    );
    const intersectionHeight = Math.max(
      0,
      Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
    );
    const intersection = intersectionWidth * intersectionHeight;
    const union = left.width * left.height + right.width * right.height - intersection;
    return union > 0 ? intersection / union : 0;
  }

  function appendArtifactBoxes(
    artifactBoxes: ArtifactLayoutBox[],
    kind: "prediction" | "best",
    matchedBoxes: EvidenceOverlayBox[],
  ) {
    for (const box of artifactBoxes) {
      // Retain unmatched parser regions, but use evaluator-linked regions for
      // matched elements so selecting Explain evidence highlights the output.
      const matched = matchedBoxes.find((candidate) => (
        candidate.sourceIndex != null &&
        box.sourceIndex != null &&
        candidate.sourceIndex === box.sourceIndex
      )) ?? matchedBoxes.find(
        (candidate) => intersectionOverUnion(box, candidate) >= 0.9,
      );
      if (matched) {
        // Failed localization can leave best_pred_class unset even though the
        // retained parser output still knows the region class. Preserve that
        // class so the overlay remains distinguishable as text, picture, etc.
        if (matched.label === "Predicted element") {
          matched.label = box.label;
          matched.tone = layoutRegionTone(box.label);
        }
        continue;
      }
      boxes.push({
        ...box,
        id: `${kind}-${box.id}`,
        kind,
        tone: layoutRegionTone(box.label),
        status: "neutral",
      });
    }
  }

  const matchedOutputBoxes = appendPredictions(diagnostic, "prediction");
  appendArtifactBoxes(outputBoxes, "prediction", matchedOutputBoxes);
  const matchedBestBoxes = appendPredictions(bestDiagnostic, "best");
  appendArtifactBoxes(bestOutputBoxes, "best", matchedBestBoxes);
  return boxes;
}
