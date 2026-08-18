#!/usr/bin/env python3
"""Add dashboard-owned diagnostic metadata to completed benchmark output."""

from __future__ import annotations

from pathlib import Path

from common import env
from parsebench_version_lab.dashboard_diagnostics import upgrade_local_dashboard_diagnostic_trees


def main() -> int:
    output_dir = Path(env("OUTPUT_DIR"))
    upgrade_local_dashboard_diagnostic_trees(output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
