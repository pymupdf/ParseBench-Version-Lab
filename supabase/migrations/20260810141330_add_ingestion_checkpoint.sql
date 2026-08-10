alter table public.ingestion_jobs
add column checkpoint jsonb not null default '{}'::jsonb;

alter table public.ingestion_jobs
add constraint ingestion_jobs_checkpoint_object
check (jsonb_typeof(checkpoint) = 'object');

comment on column public.ingestion_jobs.checkpoint is
'Durable source-specific cursor used to resume incremental ingestion.';
