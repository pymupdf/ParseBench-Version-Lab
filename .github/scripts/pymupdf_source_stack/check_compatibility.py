#!/usr/bin/env python3
"""GitHub adapter for the shared Version Lab compatibility gate."""

from common import VERSION_LAB_SRC  # noqa: F401 - bootstraps the shared package path
from parsebench_version_lab.runtime_check import main

if __name__ == "__main__":
    raise SystemExit(main())
