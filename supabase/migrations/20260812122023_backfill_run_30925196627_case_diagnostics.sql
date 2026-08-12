-- Run 30925196627 was evaluated before per-case diagnostic locators were
-- indexed. Its immutable GCS report tree has now been backfilled with the
-- deterministic schema-v1 sidecars emitted by the evaluator.
update public.case_results as case_result
set
    diagnostic_relative_path =
        regexp_replace(run_dimension.report_relative_path, '[^/]+$', '')
        || '_diagnostics/'
        || encode(extensions.digest(benchmark_case.test_id, 'sha256'), 'hex')
        || '.json',
    diagnostic_schema_version = 1,
    updated_at = now()
from
    public.run_dimensions as run_dimension,
    public.benchmark_runs as benchmark_run,
    public.benchmark_cases as benchmark_case
where
    case_result.run_dimension_id = run_dimension.id
    and run_dimension.run_id = benchmark_run.id
    and case_result.benchmark_case_id = benchmark_case.id
    and benchmark_run.github_run_id = 30925196627
    and run_dimension.report_relative_path is not null
    and (
        case_result.diagnostic_relative_path is null
        or case_result.diagnostic_schema_version is distinct from 1
    );
