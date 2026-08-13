#!/usr/bin/env python3
"""Add dashboard-owned diagnostic metadata to completed benchmark output."""

from __future__ import annotations

from pathlib import Path

from common import append_summary, env
from parsebench_version_lab.dashboard_diagnostics import (
    DASHBOARD_DIAGNOSTIC_SCHEMA_VERSION,
    upgrade_local_dashboard_diagnostic_trees,
)


def main() -> int:
    output_dir = Path(env("OUTPUT_DIR"))
    indexes = upgrade_local_dashboard_diagnostic_trees(output_dir)
    append_summary(
        [
            "## Dashboard diagnostics prepared",
            "",
            f"- Schema: `v{DASHBOARD_DIAGNOSTIC_SCHEMA_VERSION}`",
            f"- Dimension indexes: `{len(indexes)}`",
            "- Canonical ParseBench reports and evaluator diagnostics were not modified.",
        ]
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
