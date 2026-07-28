"""Shared helpers for the PyMuPDF source-stack GitHub workflow."""

from __future__ import annotations

import subprocess
import sys
from collections.abc import Mapping
from pathlib import Path

VERSION_LAB_SRC = Path(__file__).resolve().parents[3] / "tools" / "version_lab" / "src"
if not VERSION_LAB_SRC.is_dir():
    raise RuntimeError(f"Version Lab shared source is missing: {VERSION_LAB_SRC}")
sys.path.insert(0, str(VERSION_LAB_SRC))

from parsebench_version_lab.model import (  # noqa: E402, F401 - compatibility re-exports
    COMPONENTS,
    DATASET_BRANCHES,
    DATASET_REPOSITORY,
    LAYOUT_REPOSITORIES,
)
from parsebench_version_lab.provenance import mupdf_build_spec  # noqa: E402, F401 - compatibility re-export
from parsebench_version_lab.util import required_env as env  # noqa: E402, F401
from parsebench_version_lab.util import write_json  # noqa: E402, F401


def git_sha(path: str | Path = ".") -> str:
    return subprocess.check_output(
        ["git", "-C", str(path), "rev-parse", "HEAD"],
        text=True,
    ).strip()


def write_github_outputs(values: Mapping[str, str]) -> None:
    """Append single-line values to the current step's GitHub output file."""
    output = Path(env("GITHUB_OUTPUT"))
    with output.open("a", encoding="utf-8") as stream:
        for name, value in values.items():
            if "\n" in value or "\r" in value:
                raise ValueError(f"GitHub output {name!r} must be a single line")
            stream.write(f"{name}={value}\n")


def append_summary(lines: list[str]) -> None:
    with Path(env("GITHUB_STEP_SUMMARY")).open("a", encoding="utf-8") as stream:
        stream.write("\n".join(lines) + "\n")


def markdown_cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\r", " ").replace("\n", " ")
