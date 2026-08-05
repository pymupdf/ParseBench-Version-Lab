create table public.dataset_versions (
    id bigint generated always as identity primary key,
    repository text not null,
    resolved_sha text not null,
    requested_ref text,
    branch text,
    commit_url text,
    pdf_root_uri text,
    ground_truth_root_uri text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint dataset_versions_repository_sha_key unique (repository, resolved_sha),
    constraint dataset_versions_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create table public.benchmark_cases (
    id bigint generated always as identity primary key,
    dataset_version_id bigint not null references public.dataset_versions(id) on delete cascade,
    test_id text not null,
    inference_group text,
    pdf_relative_path text,
    page_number integer,
    tags text[] not null default '{}',
    ground_truth_locator jsonb not null default '{}'::jsonb,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint benchmark_cases_dataset_test_key unique (dataset_version_id, test_id),
    constraint benchmark_cases_page_number_positive check (page_number is null or page_number > 0),
    constraint benchmark_cases_ground_truth_locator_object check (jsonb_typeof(ground_truth_locator) = 'object'),
    constraint benchmark_cases_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create table public.benchmark_runs (
    id bigint generated always as identity primary key,
    github_repository text not null,
    github_workflow_id bigint,
    github_workflow_name text,
    github_run_id bigint not null,
    github_run_attempt integer not null default 1,
    github_run_url text,
    run_name text,
    event text,
    status text not null,
    conclusion text,
    artifact_state text not null default 'unknown',
    pipeline_name text,
    pipeline_config jsonb not null default '{}'::jsonb,
    run_scope text,
    selected_group text,
    dataset_version_id bigint references public.dataset_versions(id) on delete restrict,
    gcs_bucket text,
    gcs_prefix text,
    head_branch text,
    head_sha text,
    source_created_at timestamptz,
    source_updated_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    summary jsonb not null default '{}'::jsonb,
    error_summary jsonb not null default '[]'::jsonb,
    source_metadata jsonb not null default '{}'::jsonb,
    ingestion_schema_version integer not null default 1,
    indexed_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint benchmark_runs_source_key unique (github_repository, github_run_id, github_run_attempt),
    constraint benchmark_runs_attempt_positive check (github_run_attempt > 0),
    constraint benchmark_runs_pipeline_config_object check (jsonb_typeof(pipeline_config) = 'object'),
    constraint benchmark_runs_summary_object check (jsonb_typeof(summary) = 'object'),
    constraint benchmark_runs_error_summary_array check (jsonb_typeof(error_summary) = 'array'),
    constraint benchmark_runs_source_metadata_object check (jsonb_typeof(source_metadata) = 'object')
);

create table public.run_components (
    id bigint generated always as identity primary key,
    run_id bigint not null references public.benchmark_runs(id) on delete cascade,
    component text not null,
    repository text,
    requested_ref text,
    resolved_sha text,
    installed_version text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint run_components_run_component_key unique (run_id, component),
    constraint run_components_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create table public.run_dimensions (
    id bigint generated always as identity primary key,
    run_id bigint not null references public.benchmark_runs(id) on delete cascade,
    dimension text not null,
    status text not null default 'unknown',
    total_examples integer,
    successful integer,
    failed integer,
    skipped integer,
    report_relative_path text,
    aggregate_stats jsonb not null default '{}'::jsonb,
    error_summary jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint run_dimensions_run_dimension_key unique (run_id, dimension),
    constraint run_dimensions_counts_nonnegative check (
        (total_examples is null or total_examples >= 0)
        and (successful is null or successful >= 0)
        and (failed is null or failed >= 0)
        and (skipped is null or skipped >= 0)
    ),
    constraint run_dimensions_aggregate_stats_object check (jsonb_typeof(aggregate_stats) = 'object'),
    constraint run_dimensions_error_summary_array check (jsonb_typeof(error_summary) = 'array')
);

create table public.run_dimension_metrics (
    id bigint generated always as identity primary key,
    run_dimension_id bigint not null references public.run_dimensions(id) on delete cascade,
    metric_name text not null,
    metric_value double precision not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint run_dimension_metrics_dimension_name_key unique (run_dimension_id, metric_name)
);

create table public.case_results (
    id bigint generated always as identity primary key,
    run_dimension_id bigint not null references public.run_dimensions(id) on delete cascade,
    benchmark_case_id bigint not null references public.benchmark_cases(id) on delete cascade,
    success boolean not null,
    error text,
    primary_metric_name text,
    primary_score double precision,
    raw_relative_path text,
    result_relative_path text,
    evaluated_at timestamptz,
    job_id text,
    parse_job_id text,
    tags text[] not null default '{}',
    stats jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint case_results_dimension_case_key unique (run_dimension_id, benchmark_case_id),
    constraint case_results_stats_object check (jsonb_typeof(stats) = 'object')
);

create table public.case_metrics (
    id bigint generated always as identity primary key,
    case_result_id bigint not null references public.case_results(id) on delete cascade,
    metric_name text not null,
    metric_value double precision not null,
    passed_count integer,
    total_count integer,
    metadata_summary jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint case_metrics_result_name_key unique (case_result_id, metric_name),
    constraint case_metrics_counts_nonnegative check (
        (passed_count is null or passed_count >= 0)
        and (total_count is null or total_count >= 0)
    ),
    constraint case_metrics_metadata_summary_object check (jsonb_typeof(metadata_summary) = 'object')
);

create table public.run_errors (
    id bigint generated always as identity primary key,
    run_id bigint not null references public.benchmark_runs(id) on delete cascade,
    stage text not null,
    test_id text,
    error_type text,
    message text not null,
    details jsonb not null default '{}'::jsonb,
    occurred_at timestamptz,
    error_fingerprint text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint run_errors_run_fingerprint_key unique (run_id, error_fingerprint),
    constraint run_errors_details_object check (jsonb_typeof(details) = 'object')
);

create table public.metric_definitions (
    id bigint generated always as identity primary key,
    dimension text not null,
    metric_name text not null,
    display_name text not null,
    higher_is_better boolean not null default true,
    is_default boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint metric_definitions_dimension_name_key unique (dimension, metric_name)
);

create table public.ingestion_jobs (
    id bigint generated always as identity primary key,
    source text not null,
    source_key text not null,
    status text not null,
    runs_seen integer not null default 0,
    runs_imported integer not null default 0,
    runs_failed integer not null default 0,
    error_summary jsonb not null default '[]'::jsonb,
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    updated_at timestamptz not null default now(),
    constraint ingestion_jobs_source_key unique (source, source_key),
    constraint ingestion_jobs_counts_nonnegative check (runs_seen >= 0 and runs_imported >= 0 and runs_failed >= 0),
    constraint ingestion_jobs_error_summary_array check (jsonb_typeof(error_summary) = 'array')
);

create index benchmark_cases_dataset_version_id_idx on public.benchmark_cases (dataset_version_id);
create index benchmark_cases_group_test_idx on public.benchmark_cases (inference_group, test_id);
create index benchmark_runs_dataset_version_id_idx on public.benchmark_runs (dataset_version_id);
create index benchmark_runs_pipeline_created_idx on public.benchmark_runs (pipeline_name, source_created_at desc, id desc);
create index benchmark_runs_conclusion_created_idx on public.benchmark_runs (conclusion, source_created_at desc, id desc);
create index run_components_run_id_idx on public.run_components (run_id);
create index run_components_component_sha_idx on public.run_components (component, resolved_sha, run_id);
create index run_dimensions_run_id_idx on public.run_dimensions (run_id);
create index run_dimension_metrics_dimension_value_idx
    on public.run_dimension_metrics (run_dimension_id, metric_name, metric_value desc);
create index case_results_run_dimension_id_idx on public.case_results (run_dimension_id);
create index case_results_benchmark_case_id_idx on public.case_results (benchmark_case_id);
create index case_results_score_idx on public.case_results (run_dimension_id, primary_score desc, id);
create index case_metrics_case_result_id_idx on public.case_metrics (case_result_id);
create index case_metrics_name_value_idx on public.case_metrics (metric_name, metric_value desc, case_result_id);
create index run_errors_run_id_idx on public.run_errors (run_id);
create index run_errors_stage_created_idx on public.run_errors (stage, created_at desc, id);

insert into public.metric_definitions (dimension, metric_name, display_name, higher_is_better, is_default)
values
    ('chart', 'rule_pass_rate', 'Chart data point match', true, true),
    ('table', 'grits_trm_composite', 'GriTS table score', true, true),
    ('layout', 'layout_element_rule_pass_rate', 'Layout element pass rate', true, true),
    ('text_content', 'content_faithfulness', 'Content faithfulness', true, true),
    ('text_formatting', 'semantic_formatting', 'Semantic formatting', true, true)
on conflict (dimension, metric_name) do update
set display_name = excluded.display_name,
    higher_is_better = excluded.higher_is_better,
    is_default = excluded.is_default,
    updated_at = now();

alter table public.dataset_versions enable row level security;
alter table public.benchmark_cases enable row level security;
alter table public.benchmark_runs enable row level security;
alter table public.run_components enable row level security;
alter table public.run_dimensions enable row level security;
alter table public.run_dimension_metrics enable row level security;
alter table public.case_results enable row level security;
alter table public.case_metrics enable row level security;
alter table public.run_errors enable row level security;
alter table public.metric_definitions enable row level security;
alter table public.ingestion_jobs enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on
    public.dataset_versions,
    public.benchmark_cases,
    public.benchmark_runs,
    public.run_components,
    public.run_dimensions,
    public.run_dimension_metrics,
    public.case_results,
    public.case_metrics,
    public.run_errors,
    public.metric_definitions,
    public.ingestion_jobs
to service_role;
grant usage, select on all sequences in schema public to service_role;
