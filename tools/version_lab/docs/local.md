# Running ParseBench Version Lab locally

The local Version Lab controller uses the same configuration, MuPDF provenance
gate, benchmark phases, and aggregate score logic as the GitHub Actions
workflow. It checks out exact source commits and builds them in an isolated
target environment, leaving the developer's normal ParseBench environment
unchanged.

## Commands

Run these commands from the ParseBench checkout root:

```shell
uv run --project tools/version_lab version-lab doctor
uv run --project tools/version_lab version-lab plan --all-latest --scope quick
uv run --project tools/version_lab version-lab run --all-latest --scope quick
```

To validate source access and selection without compiling:

```shell
uv run --project tools/version_lab version-lab run --all-latest --resolve-only
```

This mode requires only Git beyond the uv command used to start the controller.

Explicit refs use the same form as the workflow:

```shell
uv run --project tools/version_lab version-lab run \
  --mupdf-ref 1.28.0 \
  --pymupdf-ref 1.28.0 \
  --pymupdf-layout-ref 1.28.0 \
  --pymupdf4llm-ref 1.28.0 \
  --scope quick \
  --group all
```

Runs and the shared immutable dataset cache are stored under `.version-lab/`,
which is ignored by Git. Every run retains `run.json`, resolved source SHAs,
compatibility diagnostics, benchmark reports, and aggregate scores.

## Native prerequisites

The controller itself requires only Python 3.12 and uv. A complete native build
also requires:

- Git with credentials for any selected private Layout source;
- SWIG;
- `unzip`;
- Tesseract and English language data;
- the native C/C++ toolchain expected by MuPDF and PyMuPDF.

Native benchmark execution is currently supported on Linux. The preflight
checks for a C compiler, all required commands, and English Tesseract language
data, but intentionally does not install or modify system packages. Windows and
macOS execution is not currently claimed or tested.

For private refs, configure the normal Git credential helper first. Developers
who use GitHub CLI can run `gh auth setup-git`; Version Lab never writes an
access token to its run manifest or command line.
