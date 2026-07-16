#!/usr/bin/env python3
"""Resolve the selected Hugging Face dataset branch to an immutable commit."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from common import DATASET_BRANCHES, DATASET_REPOSITORY, env, write_github_outputs, write_json

FULL_SHA = re.compile(r"[0-9a-f]{40}")


def branch_for_scope(run_scope: str) -> str:
    try:
        return DATASET_BRANCHES[run_scope]
    except KeyError as error:
        choices = ", ".join(sorted(DATASET_BRANCHES))
        raise SystemExit(f"Unsupported dataset scope {run_scope!r}. Expected one of: {choices}") from error


def resolve_branch(repository: str, branch: str) -> str:
    remote = f"https://huggingface.co/datasets/{repository}.git"
    ref = f"refs/heads/{branch}"
    result = subprocess.run(
        ["git", "ls-remote", "--exit-code", remote, ref],
        check=True,
        capture_output=True,
        text=True,
    )
    fields = result.stdout.split()
    if len(fields) != 2 or fields[1] != ref or not FULL_SHA.fullmatch(fields[0]):
        raise SystemExit(f"Could not resolve Hugging Face dataset branch {repository}@{branch}")
    return fields[0]


def main() -> int:
    repository = DATASET_REPOSITORY
    branch = branch_for_scope(env("RUN_SCOPE"))
    sha = resolve_branch(repository, branch)
    commit_url = f"https://huggingface.co/datasets/{repository}/commit/{sha}"

    dataset = {
        "branch": branch,
        "commit_url": commit_url,
        "repository": repository,
        "resolved_sha": sha,
    }
    write_json(Path(env("OUTPUT_DIR")) / "_dataset.json", dataset)
    write_github_outputs(
        {
            "branch": branch,
            "commit_url": commit_url,
            "repository": repository,
            "sha": sha,
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
