# Version Lab scope

This repository combines two codebases:

- `upstream`: `run-llama/ParseBench`, the benchmark implementation.
- `origin`: `pymupdf/ParseBench-Version-Lab`, our integration and tooling.

Keep upstream ParseBench unchanged. Refactoring and feature work belong only
in the files and directories introduced by this fork. This boundary preserves
straightforward upstream merges.

Our code lives in `tools/version_lab/`, including its React dashboard, and the
associated `.github/scripts/pymupdf_source_stack/` helpers,
`pymupdf-source-stack-*` workflows, container setup, fork-specific tests,
documentation, and Supabase integration. Do not assume a whole shared directory
such as `tests/`, `docs/`, or `.github/` belongs to the fork; check file ownership
against `upstream/main` when uncertain.

Do not edit upstream `src/parse_bench/`, `apps/`, `scripts/`, tests, or root
package configuration as part of Version Lab work. Adapt upstream behavior
through Version Lab entry points, provider registration, and diagnostic
sidecars instead. Keep benchmark transformations and scoring upstream-owned.

Keep the dashboard in React. Introduce a new abstraction only when the repeated
code occurs at least three times. Prefer existing meaningful tests and remove
tests for deleted behavior; avoid adding a large new test suite for cleanup.

Source builds accept only existing PyMuPDF branches. Release tags, arbitrary
source commits, and historical dependency combinations are outside the scope.

Support only the current integrated PyMuPDF packaging. Build Layout and
PyMuPDF4LLM into the PyMuPDF wheel from their selected source checkouts;
do not add separate package installs or compatibility paths for PyMuPDF 1.x.
Derive MuPDF from the selected PyMuPDF commit's declared native version;
keep its provenance, but do not expose a separate MuPDF selector.
Expose only one PyMuPDF branch selector, defaulting to main. Resolve Layout
and PyMuPDF4LLM from their default branches. Fix the benchmark pipeline to
pymupdf4llm_html_tables_rapidocr_v3 and resolve the current dataset automatically;
do not expose pipeline or dataset-commit selectors.
