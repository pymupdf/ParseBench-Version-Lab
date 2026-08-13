# ParseBench benchmark index

Supabase stores queryable workflow metadata, aggregate scores, per-document
headline scores, and GCS artifact locators. Detailed per-document metrics,
ground-truth evidence, raw parser output, and evaluation reports remain in GCS.

## Data model

- `dataset_versions`: immutable Hugging Face dataset commit and root locators.
- `benchmark_cases`: stable document identity within one dataset commit, plus
  its exact source path, media type, and ground-truth locator.
- `benchmark_runs`: one GitHub Actions run attempt, configuration, provenance,
  GCS artifact prefix, lifecycle state, and summary.
- `run_components`: exact MuPDF/PyMuPDF/PyMuPDF Layout/PyMuPDF4LLM revisions.
- `run_dimensions` and `run_dimension_metrics`: per-dimension aggregate totals
  and scores.
- `case_results`: per-document headline outcomes and artifact locators used for
  filtering, ranking, and run-to-run comparisons.
- `case_metrics`: retained legacy data. Dashboard clients and ingestion jobs no
  longer read or refresh this table; it can be removed separately after an
  operational observation period.
- `run_errors`: normalized inference and GitHub Actions failures.
- `metric_definitions`: UI labels, defaults, and score direction.
- `ingestion_jobs`: backfill checkpoint and failure summary.

The reconciliation job persists its last processed GitHub run in
`ingestion_jobs.checkpoint`. Each scheduled pass scans every newer run, keeps a
bounded recent-run repair window, and separately retries older incomplete
ingestion jobs.

Rows use natural unique constraints so both the historical backfill and the
GitHub workflow can be retried without creating duplicates. RLS is enabled on
every indexed table. The browser-facing tables intentionally grant SELECT to
the `anon` role with public-read policies; writes remain restricted to the
server-side secret used by the indexing workflow.

## Continuous ingestion

`.github/workflows/pymupdf-source-stack-index.yml` is independent from the
benchmark workflow. Each completed benchmark run triggers a separate Actions
run that downloads the source run's artifact, transforms it, and upserts this
schema. Its conclusion cannot change the benchmark conclusion.

The separate `.github/workflows/pymupdf-source-stack-reconcile.yml` workflow
runs hourly and examines every run newer than its cursor plus the latest 100
workflow runs. It retries missing, metadata-only, or incomplete ingestion jobs,
preferring an unexpired GitHub artifact and falling back to the durable copy in
GCS. The full historical backfill remains available for initial history outside
that bounded repair window.

Configure these repository settings before enabling continuous ingestion:

- Variable `PARSEBENCH_SUPABASE_URL`
- Secret `PARSEBENCH_SUPABASE_SECRET_KEY`
- Variable `PARSEBENCH_GCS_BUCKET`
- Secret `GCP_SA_KEY`

Apply migrations with:

```shell
supabase link --project-ref PROJECT_REF
supabase db push --linked
```
