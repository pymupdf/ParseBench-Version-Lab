# ParseBench Version Lab

Benchmark selected MuPDF, PyMuPDF, PyMuPDF Layout, and PyMuPDF4LLM source
revisions.

## Requirements

- Git
- `uv` and Python 3.12
- A native C/C++ compiler
- Tesseract with the English (`eng`) language data
- Network access to GitHub, PyPI, Hugging Face, and `astral.sh`
- At least 5 GB of free space for a quick run; allow more for the full dataset

SWIG is installed in the benchmark environment.

### Linux

Ubuntu or Debian:

```shell
sudo apt-get update
sudo apt-get install build-essential curl git tesseract-ocr tesseract-ocr-eng
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Open a new shell if `uv` is not yet on `PATH`, then run:

```shell
uv python install 3.12
```

Use equivalent packages on other distributions.

### macOS

Install [Homebrew](https://brew.sh/) if needed, then run:

```shell
xcode-select --install
brew install git tesseract uv
uv python install 3.12
```

### Windows

Install:

- [Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  with the **Desktop development with C++** workload, MSVC, and a Windows SDK
- [Git for Windows](https://git-scm.com/downloads/win)
- [Tesseract](https://github.com/UB-Mannheim/tesseract/wiki) with English data

Install `uv` from PowerShell:

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Open **Developer PowerShell for VS 2022** or an **x64 Native Tools Command
Prompt for VS 2022**, then install Python 3.12 and check the compiler and
Tesseract:

```powershell
uv python install 3.12
where.exe cl
where.exe tesseract
tesseract --list-langs
```

The language list must contain `eng`. If Tesseract is not found, add
`C:\Program Files\Tesseract-OCR` to `PATH` and open a new developer shell.

## Repository

```shell
git clone https://github.com/pymupdf/ParseBench-Version-Lab.git
cd ParseBench-Version-Lab
```

## Source access

The default PyMuPDF Layout `1.28.2` ref uses the private
`ArtifexSoftware/sce` repository. Configure Git credentials for an account with
access. If GitHub CLI is already authenticated:

```shell
gh auth setup-git
```

`--all-latest` uses the public `ArtifexSoftware/pymupdf_layout` repository.

## Run

Run all commands from the repository root.

Check the required tools:

```shell
uv run --project tools/version_lab version-lab doctor
```

Continue when `doctor` reports `"ready": true`.

Preview the normalized selection:

```shell
uv run --project tools/version_lab version-lab plan --all-latest --scope quick
```

Run the 15-document quick benchmark:

```shell
uv run --project tools/version_lab version-lab run --all-latest --scope quick
```

Run the full benchmark, which typically takes around one hour:

```shell
uv run --project tools/version_lab version-lab run --all-latest --scope full
```

Resolve source and dataset commits without building:

```shell
uv run --project tools/version_lab version-lab run --all-latest --resolve-only
```

Select explicit refs and a pipeline:

```shell
uv run --project tools/version_lab version-lab run --mupdf-ref 1.28.2 --pymupdf-ref 1.28.2 --pymupdf-layout-ref 1.28.2 --pymupdf4llm-ref 1.28.2 --pipeline pymupdf4llm_markdown_150dpi --scope quick --group all
```

View all arguments and accepted values:

```shell
uv run --project tools/version_lab version-lab --help
uv run --project tools/version_lab version-lab plan --help
uv run --project tools/version_lab version-lab run --help
```

## PyMuPDF4LLM pipelines

The canonical `pymupdf4llm_markdown` pipeline and all output transformation,
layout projection, evaluation, and scoring behavior come directly from
upstream ParseBench. Version Lab registers only these additional configurations:

| Pipeline | Version Lab variation |
|---|---|
| `pymupdf4llm_markdown_150dpi` | OCR at 150 DPI |
| `pymupdf4llm_markdown_tesseract` | Tesseract OCR backend |
| `pymupdf4llm_markdown_rapidocr` | Bundled RapidOCR backend |
| `pymupdf4llm_markdown_no_ocr` | OCR disabled |
| `pymupdf4llm_html_tables` | Native HTML tables at 150 DPI |
| `pymupdf4llm_html_tables_rapidocr_v3` | Native HTML tables with modern RapidOCR |

Selected historical source revisions must support the current upstream
PyMuPDF4LLM provider API. Incompatible revisions fail rather than receiving a
Version Lab-specific output transformation.

## Diagnostic boundary

ParseBench produces its canonical evaluation reports unchanged. After each
evaluation, Version Lab reads that report and the pinned dataset rows, then
writes separate per-document diagnostic sidecars for publishing and dashboard
indexing. Dashboard metadata, source-asset mapping, and schema upgrades remain
under `tools/version_lab`; no diagnostic hooks or fields are added to upstream
ParseBench modules.

## Results

Each run is stored under `.version-lab/run-*`. The main outputs are:

- `run.json`: selected configuration, exact source commits, and status
- `output/_benchmark_scores.md`: aggregate score summary
- `output/_benchmark_scores.json`: machine-readable aggregate scores
- `output/<pipeline>/_evaluation_report_dashboard.html`: HTML dashboard
- `output/<pipeline>/**/_diagnostics/`: Version Lab diagnostic sidecars

The dataset cache is stored under `.version-lab/cache/datasets/`. Use
`--workspace PATH` to select another location.

## Continuous benchmark indexing

The existing benchmark workflow remains responsible only for benchmarking,
publishing, and its own final outcome. The independent
`.github/workflows/pymupdf-source-stack-index.yml` workflow listens for its
`workflow_run: completed` event, downloads the completed run's full artifact,
and idempotently indexes it in Supabase.

Indexing failures appear on that separate Actions run and do not turn a
successful benchmark red. It can also be started manually for a specific
source run ID. The separate
`.github/workflows/pymupdf-source-stack-reconcile.yml` workflow runs hourly or
on manual request and reconciles every run newer than its durable cursor plus
the latest 100 runs. Reconciliation prefers GitHub artifacts while they are
available and falls back to the durable GCS copy after expiration or download
failure.

Both workflows keep their triggers, permissions, and credentials explicit in
YAML. Their GitHub adapters live in
`.github/scripts/pymupdf_source_stack/` and share the artifact parsing,
transformation, cursor, and Supabase indexing implementation in
`tools/version_lab/src/parsebench_version_lab/benchmark_index.py`.

## Benchmark index backfill

The historical indexer treats Supabase as an index, not artifact storage. PDFs
and ground truth remain in the immutable Hugging Face dataset revision, while
raw parser outputs and evaluation reports remain in Google Cloud Storage.

Authenticate `gh` and `gcloud`, set server-side Supabase credentials, and run:

```shell
export SUPABASE_URL=https://PROJECT_REF.supabase.co
export SUPABASE_SECRET_KEY=SERVER_SIDE_SECRET_KEY
uv run --project tools/version_lab version-lab backfill-index \
  --repository pymupdf/ParseBench-Version-Lab \
  --bucket parsebench-pymupdf-results-457820
```

The command paginates GCS without printing object names. It saves its complete
manifest and final checkpoint under the ignored directory
`.version-lab/benchmark-index-backfill/`, then idempotently upserts runs,
document-level headline scores, artifact locators, and errors into Supabase.
Detailed per-document metrics remain in the GCS diagnostic artifacts. Re-running
the command safely refreshes the lightweight index without writing `case_metrics`.

## Run Observatory

The client-only dashboard lives in `tools/version_lab/benchmark-dashboard`.
It reads the public Supabase index, GCS result artifacts, and immutable Hugging
Face dataset files without exposing the workflow write credential.

```shell
cd tools/version_lab/benchmark-dashboard
npm install
npm run dev
```

It opens at `http://localhost:3000`, selects the newest indexed workflow run,
and provides separate run-overview and low-score document-inspection views.
