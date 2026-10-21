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

`launch_benchmark.py` reads the latest published PyMuPDF release tag and sends
a `parsebench-version-lab` repository dispatch. This supplies the version
before GitHub evaluates the benchmark's `run-name`, without adding a version
input to the manual form. The launcher uses its built-in token with
`contents: write` for dispatch; no extra secret is needed. The benchmark retains
its workflow identity for indexing, checks out the launcher's exact repository
commit, and records the launch run ID and release label alongside source provenance.

MuPDF follows the version declared in the selected PyMuPDF commit's `setup.py`;
developers do not select it separately. The workflow resolves that native
release tag to a full SHA before checkout, then gives PyMuPDF's build system a reproducible
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

After upstream evaluation writes its canonical report, Version Lab creates
immutable per-document diagnostic sidecars from that report and the pinned
dataset. After canonical reporting completes,
`parsebench_version_lab.dashboard_diagnostics` copies those sidecars into a
separately versioned dashboard schema. The dashboard metadata records metric
identity and score contribution semantics without changing benchmark rules,
reports, scores, or upstream modules.

Each adapter is a small command with one responsibility. `resolve_dataset.py`
resolves the current Hugging Face dataset branch for the chosen test size.
`resolve_refs.py` uses the shared source resolver for all four components from
the single PyMuPDF branch input, which defaults to `main`. Layout and PyMuPDF4LLM
use their default branches; MuPDF follows the selected PyMuPDF commit.
Release tags and arbitrary source commits are rejected. Every run uses
`pymupdf4llm_html_tables_rapidocr_v3`; no pipeline or dataset-commit input is
exposed. Layout always comes from
`ArtifexSoftware/pymupdf_layout`. `resolve_sources.py` verifies every source
checkout against its resolved SHA and exports absolute source roots. PyMuPDF
builds one wheel using `PYMUPDF_SETUP_PATH_LAYOUT` and
`PYMUPDF_SETUP_PATH_4LLM`; the embedded commit IDs are checked before benchmarking.
There are no standalone Layout/4LLM installs or older packaging fallbacks. Finally,
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
