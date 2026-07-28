"""Small dependency-free helpers shared by local and GitHub adapters."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def required_env(name: str) -> str:
    try:
        return os.environ[name]
    except KeyError as error:
        raise SystemExit(f"Required environment variable {name} is not set") from error


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def repository_root(start: Path | None = None) -> Path:
    """Find the ParseBench checkout without relying on the current directory."""
    current = (start or Path.cwd()).resolve()
    for candidate in (current, *current.parents):
        if (candidate / "pyproject.toml").is_file() and (candidate / "src/parse_bench").is_dir():
            return candidate
    raise SystemExit("Could not find the ParseBench repository root; run this command inside its checkout")
