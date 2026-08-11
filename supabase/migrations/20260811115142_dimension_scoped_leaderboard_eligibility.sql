-- A run can be eligible for a dimension leaderboard without evaluating every
-- other dimension. The dashboard still restricts the aggregate leaderboard to
-- effective_group = 'all' and each dimension leaderboard to matching reports.
update public.benchmark_runs
set leaderboard_eligible = (
        conclusion = 'success'
        and artifact_state = 'complete'
        and effective_scope = 'full'
        and coverage_status = 'complete'
        and effective_group in (
            'all',
            'chart',
            'layout',
            'table',
            'text_content',
            'text_formatting'
        )
    ),
    eligibility_reasons =
        case when conclusion <> 'success'
            then array['workflow_not_successful'] else array[]::text[] end
        || case when artifact_state <> 'complete'
            then array['artifacts_incomplete'] else array[]::text[] end
        || case when effective_scope is distinct from 'full'
            then array['dataset_not_full_profile'] else array[]::text[] end
        || case when coverage_status is distinct from 'complete'
            then array['dimension_coverage_mismatch'] else array[]::text[] end,
    updated_at = now();
