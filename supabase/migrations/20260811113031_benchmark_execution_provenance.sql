alter table public.dataset_versions
    add column profile text,
    add column document_count integer,
    add column dimension_counts jsonb not null default '{}'::jsonb,
    add column manifest_sha256 text,
    add column provenance jsonb not null default '{}'::jsonb,
    add constraint dataset_versions_profile_check
        check (profile is null or profile in ('test', 'full', 'custom')),
    add constraint dataset_versions_document_count_nonnegative
        check (document_count is null or document_count >= 0),
    add constraint dataset_versions_dimension_counts_object
        check (jsonb_typeof(dimension_counts) = 'object'),
    add constraint dataset_versions_provenance_object
        check (jsonb_typeof(provenance) = 'object');

alter table public.benchmark_runs
    add column requested_scope text,
    add column requested_group text,
    add column effective_scope text,
    add column effective_group text,
    add column observed_document_count integer,
    add column observed_dimension_counts jsonb not null default '{}'::jsonb,
    add column coverage_status text not null default 'unknown',
    add column leaderboard_eligible boolean not null default false,
    add column eligibility_reasons text[] not null default '{}',
    add column execution_metadata jsonb not null default '{}'::jsonb,
    add constraint benchmark_runs_effective_scope_check
        check (effective_scope is null or effective_scope in ('test', 'full', 'custom')),
    add constraint benchmark_runs_observed_document_count_nonnegative
        check (observed_document_count is null or observed_document_count >= 0),
    add constraint benchmark_runs_observed_dimension_counts_object
        check (jsonb_typeof(observed_dimension_counts) = 'object'),
    add constraint benchmark_runs_coverage_status_check
        check (coverage_status in ('unknown', 'not_run', 'partial', 'complete')),
    add constraint benchmark_runs_execution_metadata_object
        check (jsonb_typeof(execution_metadata) = 'object');

create index benchmark_runs_leaderboard_created_idx
    on public.benchmark_runs (source_created_at desc, id desc)
    where leaderboard_eligible;

-- These immutable revisions are the two benchmark profiles used by every
-- historical Version Lab run. Their counts are derived from the unique source
-- paths in each pinned JSONL file, not from workflow-dispatch inputs.
update public.dataset_versions
set profile = 'test',
    document_count = 12,
    dimension_counts = '{"chart":3,"layout":3,"table":3,"text_content":3,"text_formatting":3}'::jsonb,
    provenance = jsonb_build_object(
        'method', 'pinned_dataset_manifest',
        'branch', 'test-data'
    ),
    updated_at = now()
where repository = 'llamaindex/ParseBench'
  and resolved_sha = '68bbab242f749df2e2ef753daabcbbbe291d943e';

update public.dataset_versions
set profile = 'full',
    document_count = 2078,
    dimension_counts = '{"chart":568,"layout":500,"table":503,"text_content":506,"text_formatting":476}'::jsonb,
    provenance = jsonb_build_object(
        'method', 'pinned_dataset_manifest',
        'branch', 'main'
    ),
    updated_at = now()
where repository = 'llamaindex/ParseBench'
  and resolved_sha = '2805a1d940f95a203e0ae4b88be9934f7765b3fc';

-- The first nine successful runs predate immutable dataset metadata. Their
-- unexpired artifacts contain exact result-file sets matching these profiles,
-- and both Hugging Face branch heads predate the runs by several months.
update public.benchmark_runs
set dataset_version_id = (
        select id
        from public.dataset_versions
        where repository = 'llamaindex/ParseBench'
          and resolved_sha = '68bbab242f749df2e2ef753daabcbbbe291d943e'
    ),
    execution_metadata = jsonb_build_object(
        'dataset_revision_provenance', 'historical_branch_head_and_exact_manifest_match'
    )
where github_run_id in (
    29451069568,
    29452298629,
    29452606927,
    29455249856,
    29455915880,
    29459275676,
    29461117880
);

update public.benchmark_runs
set dataset_version_id = (
        select id
        from public.dataset_versions
        where repository = 'llamaindex/ParseBench'
          and resolved_sha = '2805a1d940f95a203e0ae4b88be9934f7765b3fc'
    ),
    execution_metadata = jsonb_build_object(
        'dataset_revision_provenance', 'historical_branch_head_and_exact_manifest_match'
    )
where github_run_id in (29453856890, 29455137721);

update public.benchmark_runs
set requested_scope = run_scope,
    requested_group = selected_group,
    observed_document_count = case
        when jsonb_typeof(summary -> 'total') = 'number'
            then (summary ->> 'total')::integer
        else null
    end;

with observed as (
    select run_id, jsonb_object_agg(dimension, total_examples) as counts
    from public.run_dimensions
    where total_examples is not null
    group by run_id
), coverage as (
    select
        runs.id,
        datasets.profile,
        datasets.document_count,
        datasets.dimension_counts as expected_counts,
        coalesce(observed.counts, '{}'::jsonb) as observed_counts,
        case
            when observed.counts ?& array['chart', 'layout', 'table', 'text_content', 'text_formatting']
                then 'all'
            when (
                select count(*)
                from jsonb_object_keys(coalesce(observed.counts, '{}'::jsonb))
            ) = 1
                then (select key from jsonb_each(observed.counts) limit 1)
            else null
        end as observed_group
    from public.benchmark_runs as runs
    join public.dataset_versions as datasets on datasets.id = runs.dataset_version_id
    left join observed on observed.run_id = runs.id
)
update public.benchmark_runs as runs
set effective_scope = coverage.profile,
    effective_group = coverage.observed_group,
    observed_dimension_counts = coverage.observed_counts,
    coverage_status = case
        when runs.conclusion <> 'success' then 'not_run'
        when coverage.profile is null or runs.observed_document_count is null then 'unknown'
        when runs.selected_group = 'all'
             and runs.observed_document_count = coverage.document_count
             and coverage.observed_counts = coverage.expected_counts
            then 'complete'
        when runs.selected_group <> 'all'
             and (coverage.observed_counts ->> runs.selected_group)::integer =
                 (coverage.expected_counts ->> runs.selected_group)::integer
            then 'complete'
        else 'partial'
    end,
    leaderboard_eligible = (
        runs.conclusion = 'success'
        and runs.artifact_state = 'complete'
        and coverage.profile = 'full'
        and runs.selected_group = 'all'
        and runs.observed_document_count = coverage.document_count
        and coverage.observed_counts = coverage.expected_counts
    ),
    eligibility_reasons = case
        when runs.conclusion <> 'success' then array['workflow_not_successful']
        when runs.artifact_state <> 'complete' then array['artifacts_incomplete']
        when coverage.profile is distinct from 'full' then array['dataset_not_full_profile']
        when runs.selected_group is distinct from 'all' then array['not_all_dimensions']
        when runs.observed_document_count is distinct from coverage.document_count
            then array['document_count_mismatch']
        when coverage.observed_counts <> coverage.expected_counts
            then array['dimension_coverage_mismatch']
        else '{}'
    end,
    updated_at = now()
from coverage
where coverage.id = runs.id;

-- Keep the legacy columns useful for older clients, but make them describe
-- effective execution rather than the untrusted dispatch request.
update public.benchmark_runs
set run_scope = effective_scope,
    selected_group = coalesce(effective_group, requested_group),
    updated_at = now()
where effective_scope is not null;
