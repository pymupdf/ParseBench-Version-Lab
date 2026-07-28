#!/usr/bin/env python3
"""GitHub adapter for the shared Version Lab compatibility gate."""

from common import VERSION_LAB_SRC  # noqa: F401 - bootstraps the shared package path
from parsebench_version_lab.provenance import (
    expected_mupdf_build_source,
    verify_mupdf_build_source,
)
from parsebench_version_lab.runtime_check import main, run_compatibility_check

__all__ = [
    "expected_mupdf_build_source",
    "main",
    "run_compatibility_check",
    "verify_mupdf_build_source",
]


if __name__ == "__main__":
    raise SystemExit(main())
