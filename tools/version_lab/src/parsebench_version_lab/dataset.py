"""Resolve the immutable ParseBench dataset revision used by a local run."""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import asdict, dataclass
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from .model import DATASET_REPOSITORY, RunConfig
from .process import CommandRunner

FULL_SHA = re.compile(r"[0-9a-f]{40}")


@dataclass(frozen=True)
class DatasetRevision:
    repository: str
    requested_ref: str
    branch: str
    resolved_sha: str
    commit_url: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


def _validate_commit(repository: str, sha: str) -> str:
    url = f"https://huggingface.co/api/datasets/{repository}/revision/{sha}"
    try:
        with urlopen(url, timeout=30) as response:  # noqa: S310 - fixed trusted host
            metadata = json.load(response)
    except HTTPError as error:
        raise RuntimeError(f"Hugging Face rejected dataset commit {repository}@{sha}: HTTP {error.code}") from error
    except URLError as error:
        raise RuntimeError(f"Could not validate Hugging Face dataset commit {repository}@{sha}: {error}") from error
    if metadata.get("sha") != sha:
        raise RuntimeError(f"Hugging Face returned an unexpected revision for {repository}@{sha}")
    return sha


def resolve_dataset(config: RunConfig, runner: CommandRunner) -> DatasetRevision:
    repository = DATASET_REPOSITORY
    branch = config.dataset_branch
    requested = config.dataset_ref.strip().lower()
    if requested == "current":
        remote = f"https://huggingface.co/datasets/{repository}.git"
        ref = f"refs/heads/{branch}"
        result = runner.run(["git", "ls-remote", "--exit-code", remote, ref], capture=True)
        fields = result.stdout.split()
        if len(fields) != 2 or fields[1] != ref or not FULL_SHA.fullmatch(fields[0]):
            raise RuntimeError(f"Git returned an invalid dataset revision for {repository}@{branch}")
        sha = fields[0]
    elif FULL_SHA.fullmatch(requested):
        sha = _validate_commit(repository, requested)
    else:
        raise ValueError("Dataset ref must be 'current' or a full 40-character commit SHA")
    return DatasetRevision(
        repository,
        requested,
        branch,
        sha,
        f"https://huggingface.co/datasets/{repository}/commit/{sha}",
    )


def git_version() -> str:
    return subprocess.check_output(["git", "--version"], text=True).strip()
