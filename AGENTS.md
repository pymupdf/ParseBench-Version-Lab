# Repository Guidelines

## Project Structure & Ownership

This fork adds source-build benchmarking for MuPDF, PyMuPDF, Layout, and PyMuPDF4LLM to upstream ParseBench.

- `src/parse_bench/`: upstream inference, evaluation, metrics, and reporting; `tests/` contains core tests and some fork-specific integration tests.
- `tools/version_lab/src/parsebench_version_lab/`: fork-owned CLI, source builds, orchestration, and diagnostics; tests live in `tools/version_lab/tests/`.
- `tools/version_lab/benchmark-dashboard/`: React/Next.js dashboard, with UI in `app/`, assets in `public/`, and tests in `tests/`.
- `.github/scripts/pymupdf_source_stack/` and `pymupdf-source-stack-*` workflows: fork automation. `docs/` contains documentation; `apps/` contains upstream annotation/viewer applications.

Keep Version Lab changes within fork-owned files. Preserve upstream code, scoring, transformations, and root package configuration. Check ownership against `upstream/main` when uncertain; shared directories are not entirely fork-owned. Read nested `AGENTS.md` files before editing their directories.

## Build, Test, and Development Commands

Run from the repository root unless noted:

- `uv sync --extra runners --extra fast --extra dev`: install the core CI dependencies.
- `uv run pytest -q`: run core tests.
- `uv run --project tools/version_lab --with pytest pytest tools/version_lab/tests -q`: run Version Lab tests explicitly.
- `uv run ruff check src tests` and `uv run ruff format --check src tests`: reproduce core CI style checks; target changed fork paths separately.
- `uv build`: build the core wheel and source distribution.
- `uv run --project tools/version_lab version-lab doctor`: check native build prerequisites.
- `uv run --project tools/version_lab version-lab run --scope quick`: build sources and benchmark 15 documents.

In `tools/version_lab/benchmark-dashboard/`, use Node.js 22.13+, `npm ci`, and `npm run dev`. Run `npm run lint` and `npm test` for ESLint, production build, and rendered-HTML checks.

## Coding Style & Naming Conventions

Use Python 3.12+, four-space indentation, type hints, `snake_case` functions/modules, and `PascalCase` classes. Ruff sets a 120-character line limit and sorts imports. Follow existing TypeScript/React conventions and ESLint configuration.

## Testing Guidelines

Use pytest files/functions named `test_*`. Add focused regression coverage for changed behavior; mock external services. No numeric coverage threshold is configured. Dashboard tests use Node's test runner and Playwright; `npm run test:data` checks configured data access, and `npm run test:e2e` runs browser tests.

## Commit & Pull Request Guidelines

Prefer concise imperative subjects, matching recent commits such as “Simplify Version Lab source support and runtime orchestration.” Include the problem, behavior changes, validation commands/results, relevant issues, and screenshots for UI changes in PR descriptions. Keep generated benchmark output and credentials out of commits.
