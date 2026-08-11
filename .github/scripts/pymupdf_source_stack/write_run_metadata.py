#!/usr/bin/env python3
"""Record the reproducible configuration associated with benchmark output."""

from __future__ import annotations

import json
import os
from pathlib import Path

from common import env, git_sha, write_json


def main() -> int:
    output_dir = Path(env("OUTPUT_DIR"))
    compatibility = json.loads((output_dir / "_compatibility.json").read_text(encoding="utf-8"))
    dataset = json.loads((output_dir / "_dataset.json").read_text(encoding="utf-8"))
    requested_scope = env("RUN_SCOPE")
    requested_group = env("GROUP")
    metadata = {
        "pipeline": env("PIPELINE"),
        "benchmark_ref_input": env("BENCHMARK_REF"),
        "checked_out_sha": git_sha(),
        "github_ref": env("GITHUB_REF"),
        "github_sha": env("GITHUB_SHA"),
        "github_repository": env("GITHUB_REPOSITORY"),
        "github_run_id": env("GITHUB_RUN_ID"),
        "github_run_attempt": env("GITHUB_RUN_ATTEMPT"),
        "github_run_url": f"{env('GITHUB_SERVER_URL')}/{env('GITHUB_REPOSITORY')}/actions/runs/{env('GITHUB_RUN_ID')}",
        "requested": {"scope": requested_scope, "group": requested_group},
        "requested_scope": requested_scope,
        "requested_group": requested_group,
        "run_scope": dataset.get("profile") or "custom",
        "group": requested_group,
        "max_concurrent": 1,
        "gcs_bucket": os.environ.get("PARSEBENCH_GCS_BUCKET", ""),
        "gcs_destination": env("DESTINATION"),
        "dataset": dataset,
        "source_stack": compatibility,
    }
    write_json(output_dir / "_github_run.json", metadata)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
