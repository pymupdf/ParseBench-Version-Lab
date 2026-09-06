# Diagnostic inspector

The public entry points are `DiagnosticInspector` and `GroundTruthInspector`,
re-exported through `index.ts`. The inspector selects a dimension view and renders
its score explanation; it does not interpret individual evaluator rule formats.

- `model.ts` normalizes retained metrics and matches outcomes to expectations.
  Explicit identifiers take precedence. Only anonymous historical outcomes may
  fall back to their original position, and each outcome is used at most once.
- `*-model.ts` contains dimension-specific scoring and evidence transformations.
  These modules are independent of React and can be tested without a browser.
- `table-diagnostic.tsx`, `chart-diagnostic.tsx`, `layout-diagnostic.tsx`, and
  `text-diagnostic.tsx` render each dimension's evaluation evidence.
- `ground-truth.tsx` renders expected content and distinguishes scored checks
  from supporting layout references.
- `rule-groups.tsx`, `rule-facets.tsx`, and `text-bag-comparison.tsx` own filtering,
  disclosure, and pagination for large expectation sets.
- `primitives.tsx` provides shared status, selection, empty state, and sanitized
  Markdown components. `score-summary.tsx` explains the headline contribution.
- `evidence-geometry.ts` clips source bounding boxes to the visible page and
  rejects invisible or invalid controls before the source overlay renders them.

Preserve the distinction between headline scoring and supporting evidence.
Missing retained evidence must remain unknown; do not infer a pass or failure
from a neighboring result or from a rendered preview. Previews may be truncated,
but reported counts describe the complete retained data.

Run `node --test tests/diagnostics-model.test.mjs` from the dashboard directory for
the evidence matching, scoring, geometry, and chart preview regression checks.
