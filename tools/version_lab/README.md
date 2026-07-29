# ParseBench Version Lab runner

This cross-platform controller runs the MuPDF, PyMuPDF, PyMuPDF Layout, and
PyMuPDF4LLM source-stack benchmark locally. It creates an isolated target
environment for the selected stack without changing the developer's normal
ParseBench environment.

## Prerequisites

Install Python 3.12, `uv`, Git, a native C/C++ compiler, Tesseract, and the
English Tesseract language data. For example, on Ubuntu:

```shell
sudo apt-get update
sudo apt-get install build-essential git tesseract-ocr tesseract-ocr-eng
```

The standard PyMuPDF Layout `1.28.0` ref is fetched from the private
`ArtifexSoftware/sce` repository. Developers using this ref must already have
access to that repository and must configure a Git credential helper. If GitHub
CLI is authenticated with an authorized account, run `gh auth setup-git`.

Automatic latest modes use the public `ArtifexSoftware/pymupdf_layout`
repository and do not require private-repository access. MuPDF, PyMuPDF, and
PyMuPDF4LLM are also fetched from public repositories.

Native benchmark execution supports Linux, macOS, and Windows. On Windows, run
the CLI from a developer shell where the selected C/C++ compiler is available.
Use `version-lab doctor` to identify missing prerequisites on the current
machine.

## Run locally

From the repository root:

```shell
uv run --project tools/version_lab version-lab doctor
uv run --project tools/version_lab version-lab plan --all-latest --scope quick
uv run --project tools/version_lab version-lab run --all-latest --scope quick
```

- `version-lab doctor` checks that the operating system, compiler, Git,
  Tesseract, and English Tesseract language data are available. It
  reports the result as JSON and must show `"ready": true` before a native run.
- `version-lab plan --all-latest --scope quick` prints the normalized run
  configuration without checking out sources, building packages, downloading
  the dataset, or changing files. `--all-latest` selects each repository's
  default branch, and `--scope quick` selects the 15-document test dataset.
- `version-lab run --all-latest --scope quick` resolves the exact latest commit
  on each default branch, creates an isolated environment, builds all four
  selected projects, verifies MuPDF provenance and Layout/OCR behavior, and
  runs the 15-document quick benchmark.

To run the complete benchmark instead of the 15-document quick test:

```shell
uv run --project tools/version_lab version-lab run --all-latest --scope full
```

A full benchmark typically takes around one hour. The actual duration depends
on the machine, network speed, selected source versions, and whether build and
dataset caches are already populated.

To verify source access without compiling or downloading the dataset:

```shell
uv run --project tools/version_lab version-lab run --all-latest --resolve-only
```

To select explicit refs:

```shell
uv run --project tools/version_lab version-lab run \
  --mupdf-ref 1.28.0 \
  --pymupdf-ref 1.28.0 \
  --pymupdf-layout-ref 1.28.0 \
  --pymupdf4llm-ref 1.28.0 \
  --pipeline pymupdf4llm_markdown_150dpi \
  --scope quick \
  --group all
```

The `1.28.0` Layout selection resolves from the legacy
`ArtifexSoftware/sce` repository; automatic latest modes use
`ArtifexSoftware/pymupdf_layout`.

## Important options

The `plan` and `run` commands support the same source and benchmark selections:

- `--all-latest` selects the latest commit on each repository's default branch.
- `--latest-any-branch` selects the newest branch-head commit in each
  repository. It cannot be combined with `--all-latest`.
- `--mupdf-ref`, `--pymupdf-ref`, `--pymupdf-layout-ref`, and
  `--pymupdf4llm-ref` select an explicit tag, branch, or commit for each source.
  Their default is `1.28.0`, and automatic latest modes override them.
- `--scope quick` runs the 15-document smoke benchmark; `--scope full` runs the
  complete benchmark.
- `--pipeline` selects a registered PyMuPDF4LLM pipeline. The available values
  are `pymupdf4llm_markdown_150dpi`, `pymupdf4llm_markdown`,
  `pymupdf4llm_markdown_tesseract`, `pymupdf4llm_markdown_rapidocr`,
  `pymupdf4llm_markdown_no_ocr`, and `pymupdf4llm_html_tables`; the default is
  `pymupdf4llm_markdown_150dpi`.
- `--group` accepts `all`, `chart`, `table`, `layout`, `text_content`, or
  `text_formatting`.
- `--dataset-ref` accepts `current` or a full 40-character dataset commit SHA.
- `--python` selects the Python version or executable understood by `uv`; its
  default is `3.12`.

The `run` command additionally supports:

- `--resolve-only` to resolve and check out exact source and dataset commits
  without compiling or benchmarking.
- `--workspace PATH` to place retained runs and caches somewhere other than the
  default `.version-lab/` directory.

The CLI help is the authoritative reference for every command, argument,
default, and accepted value:

```shell
uv run --project tools/version_lab version-lab --help
uv run --project tools/version_lab version-lab plan --help
uv run --project tools/version_lab version-lab run --help
```

Runs are retained under `.version-lab/run-*`. Each run contains `run.json`,
resolved source commits, compatibility diagnostics, benchmark reports, and
aggregate scores. The immutable dataset cache is shared under
`.version-lab/cache/datasets/`.

Selected packages are installed with `--no-deps` so dependency resolution
cannot replace another selected source component. ParseBench's locked runner
dependencies plus the explicitly pinned source-stack supplements provide the
runtime. A selected commit that requires an additional dependency may therefore
need an explicit runner update.

Run its focused tests from the repository root with:

```shell
uv run --extra dev pytest tools/version_lab/tests
```

The runner uses platform-native paths, subprocesses, and build tools. Individual
source revisions must still support the operating system and compiler selected
for that run.
