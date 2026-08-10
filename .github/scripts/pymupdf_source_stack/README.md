# PyMuPDF source-stack workflow helpers

These scripts are GitHub Actions adapters for the PyMuPDF source-stack
benchmark, index, and reconciliation workflows in `../../workflows/`. The
workflow YAML keeps inputs, triggers, permissions, jobs, third-party actions,
credentials, and user-facing step names visible. Portable configuration, build
provenance, compatibility, benchmark, artifact parsing, transformation,
cursor, and Supabase indexing logic lives in `../../../tools/version_lab/`;
the adapters in this directory translate GitHub environment variables and
output files to that shared core. GitHub-only publishing and failure-summary
behavior remains here.

MuPDF is an independently selected source component. The workflow resolves its
requested branch, tag, or commit to the checkout's full SHA, then gives
PyMuPDF's build system a reproducible
`git:--sha <sha> https://github.com/ArtifexSoftware/mupdf.git` selector through
`PYMUPDF_SETUP_MUPDF_BUILD`. The compatibility gate independently compares
that selector with the source embedded in the installed
`pymupdf.mupdf_location` build metadata. This prevents a successful benchmark
from being attributed to the selected MuPDF commit if PyMuPDF silently used its
fixed default MuPDF source instead.

Successful runs read the generated `_evaluation_report.json` files and append
an overall aggregate plus category headline scores directly to the GitHub run
summary. `_benchmark_scores.json` records the same values in the uploaded
artifact.

Each adapter is a small command with one responsibility. `resolve_dataset.py`
resolves the `current` Hugging Face branch or validates a user-supplied full
commit SHA. `resolve_layout_source.py` resolves a PyMuPDF Layout selection
against the legacy `ArtifexSoftware/sce` repository first, then falls back to
the current `ArtifexSoftware/pymupdf_layout` repository so one workflow input
continues to support both source histories. Finally,
`benchmark.py download` reuses only a complete cached snapshot whose internal
revision marker matches that SHA. A missing, stale, or incomplete snapshot is
removed and downloaded again. Inputs supplied by the workflow are passed
through environment variables, while values needed by later steps are written
using the standard `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY` files.

Run the local checks with:

```shell
uv run --extra dev ruff check .github/scripts/pymupdf_source_stack tests
uv run --extra dev pytest tests/test_pymupdf_source_stack_workflow.py tests/test_github_failure_summary.py
```
