# ParseBench Version Lab

The `ParseBench Version Lab` workflow benchmarks a selected Git ref
from each component of the PyMuPDF parsing stack without changing the pinned
`PyMuPDF4LLM ParseBench` workflow.

Container construction and publication are intentionally separate from
benchmark execution. The `Build ParseBench Version Lab Environment` workflow
builds, smoke-tests, and publishes the GHCR environment image; `ParseBench
Version Lab` only consumes its pinned immutable digest and never builds or
publishes a container.

The manual form keeps the repositories fixed and asks only for the ParseBench
ref, four component refs, PyMuPDF4LLM pipeline, dataset size, and document
category. Each component ref accepts a release tag, branch, or full commit SHA.
Leave the displayed defaults unchanged for a standard quick test; prefer full
commit SHAs for reproducible benchmark runs.

The pipeline dropdown exposes the registered PyMuPDF4LLM variants. It defaults
to `pymupdf4llm_markdown_150dpi`, matching the workflow's previous fixed
configuration. The selected name is recorded in the run title, summary,
metadata, output directory, and score report.

`pymupdf4llm_html_tables_rapidocr_v3` selects native HTML table output and the
modern `rapidocr` package. The workflow installs its locked modern OCR extra
only for that selection and verifies that the chosen PyMuPDF4LLM source exposes
both the modern RapidOCR adapter and the native `table_output` option. The
standard `1.28.0` PyMuPDF4LLM ref predates those capabilities, so select latest
default-branch sources for exploratory runs or an explicit compatible commit
for reproducible runs. The pipeline refuses to fall back to
`rapidocr-onnxruntime`.

Two optional checkboxes provide automatic source selection:

- **Latest default-branch commits** selects the current `master` head for MuPDF
  and the current `main` head in the other three source repositories.
- **Latest commits from any branch** fetches every branch head and selects the
  one with the newest commit timestamp independently in each repository. The
  workflow records the selected branch names and pins their exact SHAs before
  checkout. Do not select both automatic modes in the same run.

Git does not store a per-branch push timestamp, so the any-branch mode measures
recency by the branch-head commit's committer timestamp. Creating a new branch
that points to an older commit does not make that branch the newest.

Enter only the Git ref, not a GitHub URL. Examples:

- Version tag: `1.28.0`
- Branch: `main`
- Commit: `e9cdfc9e7fe3260efcc9d28713903f075ab05bce` (the full 40-character SHA)

The fixed source repositories are:

- MuPDF: `ArtifexSoftware/mupdf`
- PyMuPDF: `pymupdf/PyMuPDF`
- PyMuPDF Layout: `ArtifexSoftware/sce`, with automatic latest modes using the
  current `ArtifexSoftware/pymupdf_layout` repository
- PyMuPDF4LLM: `pymupdf/pymupdf4llm`

Every run starts its GitHub summary with the selected test size, document
category, pipeline, and source configuration. For ParseBench and all four
components, the summary shows both the branch, tag, or SHA entered by the user
and the exact 40-character commit checked out for that run.

After a successful benchmark, the same summary shows the aggregate score for
each tested category and an overall score, without requiring the user to open
the HTML report. Each category uses the same headline metric selected by the
ParseBench dashboard, and the overall score is their unweighted average. The
machine-readable `_benchmark_scores.json` artifact records those values and the
aggregation method.

The Actions run list uses a compact title containing the exact registered
pipeline name, source selection, test size, document category, and dataset
selection. GitHub already displays the workflow branch alongside the title. If
all four explicit component refs are equal, only that ref is shown; mixed refs
use the compact `M:`, `P:`, `L:`, and `4:` labels. Automatic modes appear as
`Latest default` or `Latest branch`. The latter cannot name the resolved branch
heads in the run title because GitHub fixes that title before the resolver job
runs; the exact selected branches and commits remain in the run summary.

For example, a standard feature-branch run appears as:

```text
pymupdf4llm_markdown_150dpi · 1.28.0 · Quick 15 · All · data:current
```

## Private repository access

PyMuPDF Layout source is currently read from the private
`ArtifexSoftware/sce` repository. Add a repository secret named
`PYMUPDF_SOURCE_TOKEN` containing a fine-grained token with read-only access to
the selected private source repositories. Public source checkouts fall back to
the workflow's standard GitHub token.

PyMuPDF Layout uses Git tags even though the private repository does not publish
entries on GitHub's Releases page. The workflow defaults to the human-readable
`1.28.0` tag, which resolves to:

```text
2e21fab5bb27e0296cc54c6d73eeb774402553db
```

The `ArtifexSoftware/sce` `master` branch removed the installable runtime
package on 2026-07-10, so `master` is not currently a suitable Layout source
selection. Update the fixed Layout repository in the workflow when the
replacement runtime repository is available to the ParseBench workflow token.

## MuPDF version

MuPDF is the native engine wrapped by PyMuPDF, not a separately installed
Python dependency. The workflow nevertheless exposes it as an independent
source selection so developers can test a MuPDF branch, tag, or full commit
against any PyMuPDF revision. The standard default remains `1.28.0`.

The workflow checks out the selected MuPDF ref to resolve its immutable commit
SHA. When PyMuPDF is built, that SHA is passed through
`PYMUPDF_SETUP_MUPDF_BUILD` as
`git:--sha <sha> https://github.com/ArtifexSoftware/mupdf.git`. PyMuPDF's build
system clones, compiles, and links that exact MuPDF revision. Unsupported
MuPDF/PyMuPDF combinations can fail during compilation or at the compatibility
gate; those failures are retained as workflow diagnostics.

## Compatibility gate

The workflow builds and installs source packages in this order:

1. MuPDF, as part of the PyMuPDF source build
2. PyMuPDF
3. PyMuPDF Layout, linked against the selected PyMuPDF build
4. PyMuPDF4LLM, using the selected PyMuPDF and Layout builds

Before downloading the ParseBench dataset, the compatibility gate activates
Layout, creates a small PDF, calls PyMuPDF4LLM with a forced-OCR compatibility
configuration independent of the selected benchmark pipeline, and verifies
that the result contains both the marker text and non-empty Layout page boxes.
Before that behavioral check, it compares the selected MuPDF SHA against the
source selector embedded in the installed PyMuPDF build metadata. A PyMuPDF
installation built with its fixed default MuPDF therefore fails the gate even
if its basic PDF operations happen to work.

An incompatible stack fails before benchmark inference and writes diagnostic
details to `_compatibility.json` in the GitHub artifact. Successful runs also
record all requested refs, resolved commit SHAs, and installed distribution
versions in `_github_run.json`.

A final, neutral `Report final outcome` job runs after benchmarking and
publishing. Successful runs receive a completion summary. Failed runs receive
the failed job and step names, plus the complete compatibility traceback when
available or relevant error context from the completed job log. Cancelled or
otherwise incomplete runs report the final state of both preceding jobs.

## Output security

Source code runs only in the benchmark job, which has no GCP credentials. A
separate publish job downloads the resulting GitHub artifact and uploads it to
the fixed ParseBench GCS location. Partial diagnostic output is also published
when compatibility or benchmarking fails. This prevents a selected source
revision from executing in the credentialed publishing job.

The graph uses the static node name `Publish results or diagnostics` so GitHub
can display it before the benchmark outcome is known. Once the job runs, its
step name and summary state whether it published completed benchmark results or
failure diagnostics. A failure summary explicitly states that no completed
benchmark results were published.

## Workflow implementation

The workflow file is intentionally limited to GitHub Actions orchestration:
manual inputs, permissions, jobs, third-party actions, and user-facing step
names. Its executable logic lives in
`.github/scripts/pymupdf_source_stack/`, where ordinary Python linting and unit
tests can cover configuration mapping, source discovery, benchmark routing,
metadata, publishing, and summary generation.

Each job checks out those helpers from the exact commit containing the workflow
file. This keeps helper behavior stable even when `benchmark_ref` selects an
older or different ParseBench revision. The benchmark source itself remains at
the workspace root, so ParseBench commands continue to run against the selected
revision.
