"use client";

import dynamic from "next/dynamic";

// Keep dimension renderers and table reconstruction outside the workflow
// catalog's initial bundle. Each view loads when its inspector tab is opened.
export const DiagnosticInspector = dynamic(
  () => import("./diagnostic-inspector").then((module) => module.DiagnosticInspector),
  {
    loading: () => <div className="artifact-loading" role="status">Loading evaluation evidence…</div>,
  },
);

export const GroundTruthInspector = dynamic(
  () => import("./ground-truth").then((module) => module.GroundTruthInspector),
  {
    loading: () => <div className="artifact-loading" role="status">Loading ground truth…</div>,
  },
);
