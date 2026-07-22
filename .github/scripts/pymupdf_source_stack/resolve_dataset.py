#!/usr/bin/env python3
"""Resolve the selected Hugging Face dataset branch to an immutable commit."""

from __future__ import annotations

import json
import re
import subprocess
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from common import DATASET_BRANCHES, DATASET_REPOSITORY, env, write_github_outputs, write_json

FULL_SHA = re.compile(r"[0-9a-f]{40}")
CURRENT = "current"
RESOLUTION_ATTEMPTS = 3


class DatasetBranchResolutionError(RuntimeError):
    def __init__(
        self,
        *,
        repository: str,
        branch: str,
        remote: str,
        ref: str,
        attempts: int,
        exit_code: int | None,
        stdout: str,
        stderr: str,
        reason: str,
    ) -> None:
        self.repository = repository
        self.branch = branch
        self.remote = remote
        self.ref = ref
        self.attempts = attempts
        self.exit_code = exit_code
        self.stdout = stdout.strip()
        self.stderr = stderr.strip()
        self.reason = reason
        exit_description = "could not start Git" if exit_code is None else f"Git exit code {exit_code}"
        stderr_description = self.stderr or "Git produced no stderr output"
        super().__init__(
            f"Could not resolve Hugging Face dataset branch {repository}@{branch} after "
            f"{attempts} attempts ({exit_description}). {reason}. Git stderr: {stderr_description}"
        )

    def markdown_details(self) -> str:
        exit_description = "Git did not start" if self.exit_code is None else str(self.exit_code)
        return "\n".join(
            [
                f"The workflow ran `git ls-remote --exit-code {self.remote} {self.ref}` "
                f"{self.attempts} times.",
                "",
                "````text",
                f"Exit code: {exit_description}",
                f"Reason: {self.reason}",
                "stderr:",
                self.stderr or "(empty)",
                "stdout:",
                self.stdout or "(empty)",
                "````",
            ]
        )


def branch_for_scope(run_scope: str) -> str:
    try:
        return DATASET_BRANCHES[run_scope]
    except KeyError as error:
        choices = ", ".join(sorted(DATASET_BRANCHES))
        raise SystemExit(f"Unsupported dataset scope {run_scope!r}. Expected one of: {choices}") from error


def resolve_branch(repository: str, branch: str) -> str:
    remote = f"https://huggingface.co/datasets/{repository}.git"
    ref = f"refs/heads/{branch}"
    command = ["git", "ls-remote", "--exit-code", remote, ref]
    failure: DatasetBranchResolutionError | None = None

    for attempt in range(1, RESOLUTION_ATTEMPTS + 1):
        try:
            result = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
            )
        except OSError as error:
            failure = DatasetBranchResolutionError(
                repository=repository,
                branch=branch,
                remote=remote,
                ref=ref,
                attempts=attempt,
                exit_code=None,
                stdout="",
                stderr=f"{type(error).__name__}: {error}",
                reason="Git could not be started",
            )
        else:
            fields = result.stdout.split()
            if (
                result.returncode == 0
                and len(fields) == 2
                and fields[1] == ref
                and FULL_SHA.fullmatch(fields[0])
            ):
                return fields[0]
            reason = (
                "Git could not read the remote ref"
                if result.returncode != 0
                else "Git returned an unexpected response for the requested ref"
            )
            failure = DatasetBranchResolutionError(
                repository=repository,
                branch=branch,
                remote=remote,
                ref=ref,
                attempts=attempt,
                exit_code=result.returncode,
                stdout=result.stdout,
                stderr=result.stderr,
                reason=reason,
            )

        if attempt < RESOLUTION_ATTEMPTS:
            print(
                f"Dataset branch resolution attempt {attempt}/{RESOLUTION_ATTEMPTS} failed: {failure}. "
                "Retrying..."
            )
            time.sleep(2 ** (attempt - 1))

    assert failure is not None
    raise failure


def validate_commit(repository: str, sha: str) -> str:
    url = f"https://huggingface.co/api/datasets/{repository}/revision/{sha}"
    try:
        with urlopen(url, timeout=30) as response:  # noqa: S310 - fixed trusted host
            metadata = json.load(response)
    except HTTPError as error:
        if error.code == 404:
            raise SystemExit(f"Hugging Face dataset commit {repository}@{sha} does not exist") from error
        raise SystemExit(f"Hugging Face rejected dataset commit {repository}@{sha}: HTTP {error.code}") from error
    except URLError as error:
        raise SystemExit(f"Could not validate Hugging Face dataset commit {repository}@{sha}: {error}") from error

    resolved = metadata.get("sha")
    if resolved != sha:
        raise SystemExit(f"Hugging Face returned unexpected revision {resolved!r} for {repository}@{sha}")
    return sha


def main() -> int:
    repository = DATASET_REPOSITORY
    branch = branch_for_scope(env("RUN_SCOPE"))
    requested_ref = env("DATASET_REF").strip().lower()
    if requested_ref == CURRENT:
        try:
            sha = resolve_branch(repository, branch)
        except DatasetBranchResolutionError as error:
            write_json(
                Path(env("OUTPUT_DIR")) / "_failure.json",
                {
                    "title": "Cannot resolve ParseBench dataset branch",
                    "error": str(error),
                    "component": "Hugging Face dataset Git hosting",
                    "repository": repository,
                    "requested_ref": branch,
                    "git_exit_code": error.exit_code,
                    "git_stderr": error.stderr,
                    "git_stdout": error.stdout,
                    "attempts": error.attempts,
                    "details": error.markdown_details(),
                },
            )
            raise SystemExit(str(error)) from error
    elif FULL_SHA.fullmatch(requested_ref):
        sha = validate_commit(repository, requested_ref)
    else:
        raise SystemExit(
            f"Unsupported dataset version {requested_ref!r}. Use {CURRENT!r} or a full 40-character commit SHA."
        )
    commit_url = f"https://huggingface.co/datasets/{repository}/commit/{sha}"

    dataset = {
        "branch": branch,
        "commit_url": commit_url,
        "repository": repository,
        "requested_ref": requested_ref,
        "resolved_sha": sha,
    }
    write_json(Path(env("OUTPUT_DIR")) / "_dataset.json", dataset)
    write_github_outputs(
        {
            "branch": branch,
            "commit_url": commit_url,
            "repository": repository,
            "requested_ref": requested_ref,
            "sha": sha,
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
