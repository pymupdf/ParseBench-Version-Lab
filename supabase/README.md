# ParseBench benchmark index

Supabase stores queryable metadata and scores. It does not duplicate PDFs,
ground truth, raw parser output, or evaluation reports.

## Data model

- `dataset_versions`: immutable Hugging Face dataset commit and root locators.
- `benchmark_cases`: stable document identity within one dataset commit, plus
  its PDF path and ground-truth locator.
- `benchmark_runs`: one GitHub Actions run attempt, configuration, provenance,
  GCS artifact prefix, lifecycle state, and summary.
- `run_components`: exact MuPDF/PyMuPDF/PyMuPDF Layout/PyMuPDF4LLM revisions.
- `run_dimensions` and `run_dimension_metrics`: per-dimension aggregate totals
  and scores.
- `case_results` and `case_metrics`: granular per-document outcomes and metric
  values used for ranking and run-to-run comparisons.
- `run_errors`: normalized inference and GitHub Actions failures.
- `metric_definitions`: UI labels, defaults, and score direction.
- `ingestion_jobs`: backfill checkpoint and failure summary.

Rows use natural unique constraints so both the historical backfill and the
GitHub workflow can be retried without creating duplicates. RLS is enabled and
there are no client policies yet; only the server-side `service_role` is
granted access until the internal web application's access model is defined.

Apply migrations with:

```shell
supabase link --project-ref PROJECT_REF
supabase db push --linked
```
