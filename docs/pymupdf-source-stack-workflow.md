# ParseBench Version Lab workflow

The `ParseBench Version Lab` workflow builds the PyMuPDF parsing stack from
source, runs upstream ParseBench, and publishes results and diagnostics.
Version Lab's implementation stays in the fork-owned tooling and workflow
files. The upstream benchmark implementation remains unchanged; see the
[contribution boundary](../tools/version_lab/AGENTS.md).

For local installation, commands, pipeline choices, and result locations, see
the [Version Lab README](../tools/version_lab/README.md).

## Source selection

Each component input defaults to `latest`: resolve its latest stable PyPI
version to the matching Git tag, then build that source. MuPDF uses the release
tag matching PyMuPDF. An explicit current release tag or any existing branch
name is also accepted. Historical tags and arbitrary source commit SHAs are
no longer supported.

The fixed public repositories are:

| Component | Repository |
| --- | --- |
| MuPDF | `ArtifexSoftware/mupdf` |
| PyMuPDF | `pymupdf/PyMuPDF` |
| PyMuPDF Layout | `ArtifexSoftware/pymupdf_layout` |
| PyMuPDF4LLM | `pymupdf/pymupdf4llm` |

Private Layout repository access and `PYMUPDF_SOURCE_TOKEN` are no longer
required.

Two mutually exclusive automatic modes override the component inputs:

- **Latest default-branch commits** selects `master` for MuPDF and `main` for
  the other components.
- **Latest commits from any branch** selects the newest branch head by its
  commit's committer timestamp in each repository. Creating a new branch that
  points to an older commit does not make it the newest.

The shared resolver pins every selection to an immutable SHA before checkout.
The workflow verifies the checkouts against those SHAs and records the
resolved release or branch and commit in `_source_request.json` and the run
summary. Current branches must expose the API required by the selected
pipeline; Version Lab does not emulate older provider APIs.

Dataset selection is separate: `current` resolves the selected dataset's
branch, and an explicit full Hugging Face commit SHA remains supported.
Downloads use an immutable SHA cache and validate completeness before reuse.

## Build and runtime checks

The workflow defaults to `pymupdf4llm_html_tables_rapidocr_v3`, which installs
the locked modern RapidOCR extra and verifies its native HTML capabilities.
All registered pipelines use upstream's native HTML table output. The
duplicate `pymupdf4llm_html_tables` pipeline has been removed from new runs;
historical results remain readable.

The source packages build in this order:

1. MuPDF, compiled as part of the PyMuPDF source build.
2. PyMuPDF.
3. PyMuPDF Layout, linked against the selected PyMuPDF build.
4. PyMuPDF4LLM, using the selected PyMuPDF and Layout builds.

The MuPDF SHA is supplied through `PYMUPDF_SETUP_MUPDF_BUILD` as
`git:--sha <sha> https://github.com/ArtifexSoftware/mupdf.git`. Before
benchmarking, the runtime check verifies that the installed PyMuPDF reports
that exact build source. It then activates Layout, creates a small PDF, forces
OCR, and checks for marker text and non-empty Layout page boxes.

Failures stop benchmark inference and write `_compatibility.json`. Successful
runs record source SHAs, installed versions, and dataset metadata in
`_github_run.json`. The selected pipeline is recorded in the run title,
metadata, output directory, and score report.

## Results and publishing

Successful runs report category headline scores and their unweighted average
in the GitHub summary and `_benchmark_scores.json`. Version Lab produces
diagnostic sidecars after upstream evaluation has written its canonical
reports. The React dashboard consumes separately versioned diagnostic data.

The benchmark job has no GCP credentials. A separate publish job downloads
the GitHub artifact and uploads completed results or partial failure
diagnostics to the configured GCS location. The final outcome job reports
completion or relevant failure details. Indexing and reconciliation use
separate workflows.

Container publication also has its own workflow,
`Build ParseBench Version Lab Environment`. The benchmark consumes the pinned
image digest without building or publishing a container.

## Implementation

The workflow YAML defines inputs, jobs, permissions, third-party actions, and
step names. Its Python adapters live in
[`.github/scripts/pymupdf_source_stack/`](../.github/scripts/pymupdf_source_stack/README.md)
and use the shared `tools/version_lab` package for source resolution,
benchmark orchestration, diagnostics, and indexing. Helpers and benchmark
code are checked out from the workflow's selected repository revision.
