#!/usr/bin/env python3
"""GitHub adapter for shared Version Lab benchmark phases."""

from common import VERSION_LAB_SRC  # noqa: F401 - bootstraps the shared package path
from parsebench_version_lab.runtime_benchmark import main

if __name__ == "__main__":
    raise SystemExit(main())
