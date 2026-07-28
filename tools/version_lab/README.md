# ParseBench Version Lab runner

This standalone controller runs the MuPDF, PyMuPDF, PyMuPDF Layout, and
PyMuPDF4LLM source-stack benchmark locally. The controller has no runtime Python
dependencies and creates a disposable target environment for the selected
source stack.

From the repository root:

```shell
uv run --project tools/version_lab version-lab doctor
uv run --project tools/version_lab version-lab plan --all-latest --scope quick
uv run --project tools/version_lab version-lab run --all-latest --scope quick
```

Use `version-lab run --help` for explicit component refs, category selection,
workspace placement, source-resolution-only runs, and Python selection.
See [the complete local usage guide](docs/local.md) for prerequisites, output
layout, private-source authentication, and platform notes.

Run its focused tests from the repository root with:

```shell
uv run --extra dev pytest tools/version_lab/tests
```

The native backend is designed for Linux, macOS, and Windows. Developers need
Git, uv, SWIG, unzip, Tesseract, and the platform C/C++ build toolchain. On
Windows, run it from a Visual Studio developer environment. A future container
adapter can provide Linux cloud parity on Docker-capable hosts without changing
the core run model.
