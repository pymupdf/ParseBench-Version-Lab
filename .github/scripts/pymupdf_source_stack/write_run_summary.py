#!/usr/bin/env python3
"""Put the requested and resolved source configuration at the top of the run summary."""

from __future__ import annotations

import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from common import COMPONENT_SPECS, append_summary, env, git_sha, markdown_cell


def commit_date(root: Path) -> str:
    value = subprocess.check_output(
        ["git", "-C", str(root), "show", "-s", "--format=%cI", "HEAD"],
        text=True,
    ).strip()
    parsed = datetime.fromisoformat(value).astimezone(UTC)
    return parsed.strftime("%Y-%m-%d %H:%M:%S UTC")


def github_link(label: str, repository: str, suffix: str = "") -> str:
    url = f"https://github.com/{repository}{suffix}"
    return f"[{markdown_cell(label)}]({url})"


def source_table(sources: dict[str, dict[str, str]]) -> list[str]:
    lines = [
        "### Source-stack commits",
        "",
        "| Component | Repository | Release or branch | Commit used | Commit date |",
        "| --- | --- | --- | --- | --- |",
    ]
    for name, component in COMPONENT_SPECS.items():
        source = sources[name]
        repository = source["repository"]
        sha = source["resolved_sha"]
        lines.append(
            f"| {markdown_cell(component.label)} | "
            f"{github_link(repository, repository)} | "
            f"`{markdown_cell(source['ref'])}` | "
            f"{github_link(sha[:12], repository, f'/commit/{sha}')} | "
            f"{commit_date(Path('.source') / component.checkout_dir)} |"
        )
    return lines


def main() -> int:
    sources = json.loads((Path(env("OUTPUT_DIR")) / "_source_request.json").read_text(encoding="utf-8"))
    benchmark_repository = env("GITHUB_REPOSITORY")
    benchmark_sha = git_sha()
    dataset_repository = env("DATASET_REPOSITORY")
    dataset_sha = env("DATASET_SHA")
    lines = [
        "## What this run is testing",
        "",
        f"- **Test size:** {markdown_cell(env('RUN_SCOPE_SELECTION'))}",
        f"- **Document category:** {markdown_cell(env('GROUP_SELECTION'))}",
        f"- **Pipeline:** {markdown_cell(env('PIPELINE'))}",
        "- **Dataset download:** immutable SHA cache; downloads only on a cache miss",
        "",
        *source_table(sources),
        "",
        "### Benchmark revisions",
        "",
        "| Component | Repository | Requested selection | Commit used |",
        "| --- | --- | --- | --- |",
        f"| ParseBench | {github_link(benchmark_repository, benchmark_repository)} | "
        f"`{markdown_cell(env('BENCHMARK_REF'))}` | "
        f"{github_link('Workflow commit', benchmark_repository, f'/commit/{benchmark_sha}')} |",
        f"| ParseBench dataset | `{markdown_cell(dataset_repository)}` | "
        f"`{markdown_cell(env('DATASET_REQUESTED_REF'))}` | "
        f"[{'Current dataset commit' if env('DATASET_REQUESTED_REF') == 'current' else 'Selected dataset commit'}]"
        f"(https://huggingface.co/datasets/{dataset_repository}/commit/{dataset_sha}) |",
        "",
    ]
    append_summary(lines)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
