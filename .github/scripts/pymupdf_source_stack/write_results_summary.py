#!/usr/bin/env python3
"""GitHub adapter for shared Version Lab aggregate result rendering."""

import json
from pathlib import Path

from common import VERSION_LAB_SRC, append_summary, env, write_json  # noqa: F401
from parsebench_version_lab.coverage import execution_coverage
from parsebench_version_lab.results import (
    DEFAULT_METRICS,
    CategoryScore,
    build_summary,
    category_score,
    discover_reports,
    display_name,
    load_scores,
)

__all__ = [
    "DEFAULT_METRICS",
    "CategoryScore",
    "build_summary",
    "category_score",
    "discover_reports",
    "display_name",
    "load_scores",
    "main",
]


def main() -> int:
    output_dir = Path(env("OUTPUT_DIR"))
    pipeline_output_dir = output_dir / env("PIPELINE")
    requested_group = env("GROUP")
    scores = load_scores(pipeline_output_dir, requested_group)
    markdown, data = build_summary(scores)
    write_json(output_dir / "_benchmark_scores.json", data)
    dataset = json.loads((output_dir / "_dataset.json").read_text(encoding="utf-8"))
    pipeline_metadata = json.loads((pipeline_output_dir / "_metadata.json").read_text(encoding="utf-8"))
    execution = execution_coverage(
        requested_scope=env("RUN_SCOPE"),
        requested_group=requested_group,
        dataset_profile=dataset.get("profile"),
        dataset_manifest=dataset.get("manifest", {}),
        summary=pipeline_metadata.get("summary", {}),
        categories=data["categories"],
    )
    write_json(output_dir / "_execution.json", execution)
    run_metadata_path = output_dir / "_github_run.json"
    run_metadata = json.loads(run_metadata_path.read_text(encoding="utf-8"))
    run_metadata["execution"] = execution
    run_metadata["run_scope"] = execution["effective_scope"]
    run_metadata["group"] = execution["effective_group"]
    write_json(run_metadata_path, run_metadata)
    append_summary(markdown.rstrip().splitlines())
    if execution["requested_scope"] != execution["effective_scope"]:
        append_summary(
            [
                "## Dataset selection normalized",
                "",
                f"- Requested scope: `{execution['requested_scope']}`",
                f"- Dataset-derived scope: `{execution['effective_scope']}`",
                "- Leaderboard decisions use the dataset-derived scope and observed reports.",
                "",
            ]
        )
    print(markdown)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
