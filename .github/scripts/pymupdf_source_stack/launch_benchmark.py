#!/usr/bin/env python3
"""Resolve the release label before GitHub creates the benchmark run title."""

from __future__ import annotations

import json
import re
import subprocess

from common import append_summary, env, markdown_cell
from configure import GROUPS, RUN_SCOPES, selected


def main() -> int:
    branch = env("PYMUPDF_BRANCH").strip()
    if not branch:
        raise SystemExit("A PyMuPDF branch name is required")
    scope = env("RUN_SCOPE_SELECTION")
    group = env("GROUP_SELECTION")
    selected(RUN_SCOPES, scope, "test size")
    selected(GROUPS, group, "document category")
    release_result = subprocess.run(
        ["gh", "api", "repos/pymupdf/PyMuPDF/releases/latest"],
        check=True,
        capture_output=True,
        text=True,
    )
    release = json.loads(release_result.stdout)
    tag = release.get("tag_name")
    if not isinstance(tag, str) or not re.fullmatch(r"v?\d+(?:\.\d+)+", tag):
        raise SystemExit(f"Latest PyMuPDF release has an unsupported tag: {tag!r}")
    repository = env("GITHUB_REPOSITORY")
    payload = {
        "event_type": "parsebench-version-lab",
        "client_payload": {
            "pymupdf_version": tag.removeprefix("v"),
            "pymupdf_tag": tag,
            "pymupdf_branch": branch,
            "run_scope": scope,
            "group": group,
            "benchmark_ref": env("GITHUB_REF_NAME"),
            "benchmark_sha": env("GITHUB_SHA"),
            "launcher_run_id": env("GITHUB_RUN_ID"),
        },
    }
    subprocess.run(
        ["gh", "api", "--method", "POST", f"repos/{repository}/dispatches", "--input", "-"],
        input=json.dumps(payload),
        text=True,
        check=True,
    )
    benchmark_url = (
        f"{env('GITHUB_SERVER_URL')}/{repository}/actions/workflows/pymupdf-source-stack-parsebench.yml"
    )
    append_summary(
        [
            "## Benchmark launched",
            "",
            f"[Open benchmark runs]({benchmark_url})",
            "",
            f"- PyMuPDF release label: **{markdown_cell(tag)}**",
            f"- Branch to build: **{markdown_cell(branch)}**",
            f"- Test size: {markdown_cell(scope)}",
            f"- Document category: {markdown_cell(group)}",
            "",
            "The benchmark runs separately. Its conclusion and results appear in the linked workflow.",
        ]
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
