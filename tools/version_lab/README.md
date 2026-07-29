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

The default PyMuPDF Layout `1.28.0` ref uses the private
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
uv run --project tools/version_lab version-lab run --mupdf-ref 1.28.0 --pymupdf-ref 1.28.0 --pymupdf-layout-ref 1.28.0 --pymupdf4llm-ref 1.28.0 --pipeline pymupdf4llm_markdown_150dpi --scope quick --group all
```

View all arguments and accepted values:

```shell
uv run --project tools/version_lab version-lab --help
uv run --project tools/version_lab version-lab plan --help
uv run --project tools/version_lab version-lab run --help
```

## Results

Each run is stored under `.version-lab/run-*`. The main outputs are:

- `run.json`: selected configuration, exact source commits, and status
- `output/_benchmark_scores.md`: aggregate score summary
- `output/_benchmark_scores.json`: machine-readable aggregate scores
- `output/<pipeline>/_evaluation_report_dashboard.html`: HTML dashboard

The dataset cache is stored under `.version-lab/cache/datasets/`. Use
`--workspace PATH` to select another location.
