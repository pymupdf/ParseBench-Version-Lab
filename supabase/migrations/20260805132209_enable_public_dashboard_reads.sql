-- The dashboard is a browser-only, read-only client. Its publishable key maps
-- to the anon role, so expose only SELECT while RLS continues to reject every
-- write operation.

revoke insert, update, delete, truncate, references, trigger on
    public.dataset_versions,
    public.benchmark_cases,
    public.benchmark_runs,
    public.run_components,
    public.run_dimensions,
    public.run_dimension_metrics,
    public.case_results,
    public.case_metrics,
    public.run_errors,
    public.metric_definitions
from anon;

grant usage on schema public to anon;
grant select on
    public.dataset_versions,
    public.benchmark_cases,
    public.benchmark_runs,
    public.run_components,
    public.run_dimensions,
    public.run_dimension_metrics,
    public.case_results,
    public.case_metrics,
    public.run_errors,
    public.metric_definitions
to anon;

create policy "Public read access for dataset versions"
on public.dataset_versions for select to anon using (true);

create policy "Public read access for benchmark cases"
on public.benchmark_cases for select to anon using (true);

create policy "Public read access for benchmark runs"
on public.benchmark_runs for select to anon using (true);

create policy "Public read access for run components"
on public.run_components for select to anon using (true);

create policy "Public read access for run dimensions"
on public.run_dimensions for select to anon using (true);

create policy "Public read access for run dimension metrics"
on public.run_dimension_metrics for select to anon using (true);

create policy "Public read access for case results"
on public.case_results for select to anon using (true);

create policy "Public read access for case metrics"
on public.case_metrics for select to anon using (true);

create policy "Public read access for run errors"
on public.run_errors for select to anon using (true);

create policy "Public read access for metric definitions"
on public.metric_definitions for select to anon using (true);
