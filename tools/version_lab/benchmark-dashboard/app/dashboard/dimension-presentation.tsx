import { humanize } from "../lib/data";
import { DIMENSION_LABELS } from "./constants";

const DIMENSION_DESCRIPTIONS: Record<
  string,
  { focus: string; description: string }
> = {
  table: {
    focus: "Structure, cells & content",
    description:
      "Inspect extracted tables against the benchmark’s expected structure and cell content.",
  },
  text_content: {
    focus: "Content faithfulness",
    description:
      "Review how faithfully the parser captures the source document’s text.",
  },
  text_formatting: {
    focus: "Semantic formatting",
    description:
      "Inspect headings, emphasis, lists, and other formatting against the expected output.",
  },
  layout: {
    focus: "Page structure & regions",
    description:
      "Review document regions and the layout rules evaluated for each page.",
  },
  chart: {
    focus: "Chart content & rules",
    description:
      "Inspect extracted chart content and the benchmark rules behind each score.",
  },
};

export function dimensionPresentation(dimension: string) {
  return {
    label: DIMENSION_LABELS[dimension] ?? humanize(dimension),
    ...(DIMENSION_DESCRIPTIONS[dimension] ?? {
      focus: "Benchmark evaluation",
      description:
        "Inspect document results and the evidence behind their benchmark scores.",
    }),
  };
}

export function DimensionIcon({ dimension }: { dimension: string }) {
  return (
    <svg
      className="dimension-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {dimension === "table" ? (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 10h18M3 15h18M10 10v10M16 10v10" />
        </>
      ) : dimension === "layout" ? (
        <>
          <rect x="3" y="3" width="18" height="5" rx="1" />
          <rect x="3" y="12" width="7" height="9" rx="1" />
          <path d="M14 12h7M14 16h7M14 20h5" />
        </>
      ) : dimension === "chart" ? (
        <>
          <path d="M3 3v18h18M7 16v-5M12 16V6M17 16V9" />
        </>
      ) : dimension === "text_formatting" ? (
        <>
          <path d="M4 5h16M12 5v14M8 19h8M4 5v3M20 5v3" />
        </>
      ) : (
        <>
          <path d="M4 5h16M4 10h16M4 15h16M4 20h10" />
        </>
      )}
    </svg>
  );
}
