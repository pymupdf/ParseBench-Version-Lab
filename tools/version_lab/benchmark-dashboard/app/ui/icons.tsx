import type { CSSProperties } from "react";

const paths = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  chart: "M4 4v16h16 M8 15l4-5 4 2 5-7",
  document: "M14 2H5v20h14V7z M14 2v6h5 M8 12h8 M8 16h6",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  external: "M14 3h7v7 M21 3l-11 11 M10 3H3v18h18v-7",
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  branch:
    "M6 6v12 M18 6v2a4 4 0 0 1-4 4h-4 M8 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M8 20a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M20 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
  layers: "M12 3l10 5-10 5L2 8z M2 12l10 5 10-5 M2 16l10 5 10-5",
  check: "M5 12l4 4L19 6",
} as const;

export function Icon({
  name,
  size = 18,
  style,
}: {
  name: keyof typeof paths;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function BrandMark() {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
    >
      <rect width="36" height="36" rx="9" fill="currentColor" />
      <path d="M10 10h7v7h-7z M19 10h7v7h-7z M10 19h7v7h-7z" fill="#20312d" />
      <path d="m19 19 7 7m0-7-7 7" stroke="#20312d" strokeWidth="2" />
    </svg>
  );
}
