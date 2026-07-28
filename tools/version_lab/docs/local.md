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

On PowerShell, put the command on one line or use PowerShell's backtick line
continuation instead of the backslashes shown above.

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

Use a Visual Studio developer environment on Windows, Xcode command-line tools
on macOS, and the distribution compiler toolchain on Linux. The controller
performs a portable preflight check but intentionally does not install or modify
system packages.

The current backend is native: Windows and macOS runs compile for those
platforms rather than silently running a Linux container. A container adapter
can be added later for developers who prefer exact parity with the pinned GitHub
Actions environment.

For private refs, configure the normal Git credential helper first. Developers
who use GitHub CLI can run `gh auth setup-git`; Version Lab never writes an
access token to its run manifest or command line.
