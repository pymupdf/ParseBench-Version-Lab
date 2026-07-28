#!/usr/bin/env python3
"""GitHub adapter for shared Version Lab benchmark phases."""

from common import VERSION_LAB_SRC  # noqa: F401 - bootstraps the shared package path
from parsebench_version_lab.runtime_benchmark import (
    COMMANDS,
    DATASET_MARKER,
    download,
    evaluate,
    evaluate_group,
    evaluation_groups,
    inference,
    main,
    parse_bench,
    regenerate,
    report,
    run,
)

__all__ = [
    "COMMANDS",
    "DATASET_MARKER",
    "download",
    "evaluate",
    "evaluate_group",
    "evaluation_groups",
    "inference",
    "main",
    "parse_bench",
    "regenerate",
    "report",
    "run",
]


if __name__ == "__main__":
    raise SystemExit(main())
