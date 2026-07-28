#!/usr/bin/env python3
"""GitHub adapter for shared Version Lab aggregate result rendering."""

from pathlib import Path

from common import VERSION_LAB_SRC, append_summary, env, write_json  # noqa: F401
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
    scores = load_scores(pipeline_output_dir, env("GROUP"))
    markdown, data = build_summary(scores)
    write_json(output_dir / "_benchmark_scores.json", data)
    append_summary(markdown.rstrip().splitlines())
    print(markdown)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
