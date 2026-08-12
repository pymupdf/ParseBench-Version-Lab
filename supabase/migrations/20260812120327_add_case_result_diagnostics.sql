alter table if exists public.case_results
    add column if not exists diagnostic_relative_path text,
    add column if not exists diagnostic_schema_version smallint;

do $$
begin
    if to_regclass('public.case_results') is not null
       and not exists (
           select 1
           from pg_constraint
           where conrelid = 'public.case_results'::regclass
             and conname = 'case_results_diagnostic_schema_version_positive'
       ) then
        alter table public.case_results
            add constraint case_results_diagnostic_schema_version_positive
            check (diagnostic_schema_version is null or diagnostic_schema_version > 0);
    end if;
end
$$;

comment on column public.case_results.diagnostic_relative_path is
    'Run-artifact-relative path to the versioned per-case evaluation diagnostic JSON.';

comment on column public.case_results.diagnostic_schema_version is
    'Positive schema version declared by the per-case evaluation diagnostic JSON.';
