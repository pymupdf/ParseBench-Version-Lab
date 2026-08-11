#!/usr/bin/env python3
"""Repair recent missing Supabase index rows from GitHub artifacts or GCS."""

from __future__ import annotations

import json

from common import VERSION_LAB_SRC, append_summary, env  # noqa: F401
from parsebench_version_lab.benchmark_index import reconcile_repository


def main() -> int:
    result = reconcile_repository(
        github_repository=env("GITHUB_REPOSITORY"),
        bucket=env("GCS_BUCKET"),
        workflow=env("SOURCE_WORKFLOW"),
        supabase_url=env("SUPABASE_URL"),
        supabase_secret_key=env("SUPABASE_SECRET_KEY"),
        github_token=env("GITHUB_TOKEN"),
        lookback=int(env("RECONCILIATION_LOOKBACK")),
    )
    append_summary(
        [
            "## Benchmark index reconciliation",
            "",
            f"- Cursor GitHub run: `{result['cursor_github_run_id']}`",
            f"- Runs examined: **{result['runs_examined']}**",
            f"- Runs selected: **{result['runs_selected']}**",
            f"- Runs imported: **{result['runs_imported']}**",
            f"- Runs excluded (no recoverable benchmark artifact): **{result['runs_excluded']}**",
            f"- Runs failed: **{result['runs_failed']}**",
        ]
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 1 if result["runs_failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
