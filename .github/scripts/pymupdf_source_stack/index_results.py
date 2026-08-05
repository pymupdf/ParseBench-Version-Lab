#!/usr/bin/env python3
"""Index the current GitHub Actions benchmark run in Supabase."""

from __future__ import annotations

from pathlib import Path

from common import VERSION_LAB_SRC, append_summary, env  # noqa: F401
from parsebench_version_lab.benchmark_index import (
    BenchmarkIndexer,
    GithubClient,
    LocalArtifactReader,
    SupabaseRestClient,
)


def resolved_conclusion(benchmark_result: str, publish_result: str) -> str:
    for result in (benchmark_result, publish_result):
        if result != "success":
            return result
    return "success"


def main() -> int:
    repository = env("GITHUB_REPOSITORY")
    github_run_id = int(env("GITHUB_RUN_ID"))
    github = GithubClient(repository, env("GITHUB_TOKEN"))
    run = github.run(github_run_id)
    run["status"] = "completed"
    run["conclusion"] = resolved_conclusion(env("BENCHMARK_RESULT"), env("PUBLISH_RESULT"))

    database = SupabaseRestClient(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"))
    output_dir = Path(env("OUTPUT_DIR"))
    reader = LocalArtifactReader(output_dir) if output_dir.is_dir() else None
    database_run_id = BenchmarkIndexer(database, github).index_run(run, reader)
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
