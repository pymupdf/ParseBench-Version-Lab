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
  --pipeline pymupdf4llm_markdown_150dpi \
  --scope quick \
  --group all
```

Use `--pipeline` to select any registered PyMuPDF4LLM variant exposed by the
Version Lab CLI. It defaults to `pymupdf4llm_markdown_150dpi`; run
`version-lab run --help` to list every accepted pipeline name.

Runs and the shared immutable dataset cache are stored under `.version-lab/`,
which is ignored by Git. Every run retains `run.json`, resolved source SHAs,
compatibility diagnostics, benchmark reports, and aggregate scores.

## Native prerequisites

The controller itself requires only Python 3.12 and uv. A complete native build
also requires:

- Git, with credentials configured when using Layout sources from the private
  `ArtifexSoftware/sce` repository;
- Tesseract and English language data;
- the native C/C++ toolchain expected by MuPDF and PyMuPDF.

Native benchmark execution supports Linux, macOS, and Windows. The preflight
checks for a platform-appropriate C/C++ compiler, all required commands, and
English Tesseract language data, but intentionally does not install or modify
system packages. On Windows, run the CLI from a developer shell where the
selected compiler is available.

The standard PyMuPDF Layout `1.28.0` ref is fetched from the private
`ArtifexSoftware/sce` repository. Developers using this ref must already have
access to that repository and must configure a Git credential helper. If GitHub
CLI is authenticated with an authorized account, run `gh auth setup-git`.

Automatic latest modes use the public `ArtifexSoftware/pymupdf_layout`
repository and do not require private-repository access. MuPDF, PyMuPDF, and
PyMuPDF4LLM are also fetched from public repositories. Version Lab never writes
an access token to its run manifest or command line.
