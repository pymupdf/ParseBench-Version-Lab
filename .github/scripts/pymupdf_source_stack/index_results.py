#!/usr/bin/env python3
"""Index a completed GitHub Actions benchmark run in Supabase."""

from __future__ import annotations

from pathlib import Path

from common import VERSION_LAB_SRC, append_summary, env  # noqa: F401
from parsebench_version_lab.benchmark_index import (
    BenchmarkIndexer,
    GithubClient,
    IngestionJob,
    LocalArtifactReader,
    SupabaseRestClient,
    validate_workflow_run,
)


def main() -> int:
    repository = env("GITHUB_REPOSITORY")
    github_run_id = int(env("SOURCE_GITHUB_RUN_ID"))
    github = GithubClient(repository, env("GITHUB_TOKEN"))
    run = github.run(github_run_id)
    validate_workflow_run(run, env("SOURCE_WORKFLOW"))
    database = SupabaseRestClient(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"))
    output_dir = Path(env("OUTPUT_DIR"))
    reader = (
        LocalArtifactReader(output_dir)
        if any(path.is_file() for path in output_dir.rglob("*"))
        else None
    )
    ingestion = IngestionJob.start(database, repository, run)
    try:
        database_run_id = BenchmarkIndexer(database, github).index_run(run, reader)
    except Exception as error:
        ingestion.try_record_failure(error)
        raise
    ingestion.finish(
        imported=reader is not None,
        error=None if reader else "The completed GitHub run had no downloadable artifact",
    )
    append_summary(
        [
            "## Benchmark index updated",
            "",
            f"- Supabase run row: `{database_run_id}`",
            f"- GitHub run: `{github_run_id}`",
            f"- Artifact source: `{'GitHub artifact' if reader is not None else 'GitHub metadata only'}`",
        ]
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
