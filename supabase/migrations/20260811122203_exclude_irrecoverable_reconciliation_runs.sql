-- These completed historical runs cannot produce benchmark artifacts: two
-- were cancelled before publication and one was an environment-image build
-- from before that job moved to its own workflow. Marking them unavailable is
-- terminal and keeps the hourly repair job from retrying them forever.
update public.benchmark_runs
set artifact_state = 'unavailable',
    leaderboard_eligible = false,
    eligibility_reasons = array['artifacts_incomplete'],
    updated_at = now()
where github_repository = 'pymupdf/ParseBench-Version-Lab'
  and github_run_id in (29715034030, 29716440800, 30343780721);

update public.ingestion_jobs
set status = 'complete',
    runs_imported = 0,
    runs_failed = 0,
    error_summary = jsonb_build_array(
        jsonb_build_object(
            'disposition', 'excluded',
            'reason', 'completed run has no recoverable benchmark artifact'
        )
    ),
    completed_at = now(),
    updated_at = now()
where source = 'github_run'
  and source_key in (
      'pymupdf/ParseBench-Version-Lab:29715034030:1',
      'pymupdf/ParseBench-Version-Lab:29716440800:1',
      'pymupdf/ParseBench-Version-Lab:30343780721:1'
  );
