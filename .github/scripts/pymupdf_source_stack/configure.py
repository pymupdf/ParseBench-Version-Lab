#!/usr/bin/env python3
"""Translate friendly workflow inputs into ParseBench run configuration."""

from __future__ import annotations

import os
import re
from pathlib import Path

from common import COMPONENT_SPECS, append_summary, env, write_github_outputs, write_json
from parsebench_version_lab.model import V2_SUBSETS, RunConfig

DEFAULT_SELECTION = "ParseBench 2 (full)"
DATASET_SELECTIONS = {
    DEFAULT_SELECTION: ("v2", "full", "data_parsebench-2"),
    "ParseBench 1 (full)": ("v1", "full", "data"),
    "ParseBench 1 (quick, 15 cases)": ("v1", "quick", "data/test"),
}
# Payloads from earlier launchers name the v1 scope.
RUN_SCOPES = {
    "Quick test (15 cases)": ("test", "data/test"),
    "Full benchmark (~2,000 pages)": ("full", "data"),
}
GROUPS = {
    "All categories": "all",
    "Charts": "chart",
    "Tables": "table",
    "Page layout": "layout",
    "Text content": "text_content",
    "Text formatting": "text_formatting",
}


def safe_ref(value: str) -> str:
    value = re.sub(r"[/:@ ]", "-", value)
    return re.sub(r"[^A-Za-z0-9._-]", "", value)[:48]


def selected(mapping: dict[str, object], value: str, label: str):
    try:
        return mapping[value]
    except KeyError as error:
        choices = ", ".join(mapping)
        raise SystemExit(f"Unsupported {label}: {value!r}. Expected one of: {choices}") from error


def run_selection() -> tuple[RunConfig, str]:
    label = os.environ.get("DATASET_SELECTION")
    if label:
        version, scope, directory = selected(DATASET_SELECTIONS, label, "dataset")
    elif legacy := os.environ.get("RUN_SCOPE_SELECTION"):
        profile, directory = selected(RUN_SCOPES, legacy, "test size")
        version, scope = "v1", "quick" if profile == "test" else "full"
    else:
        version, scope, directory = DATASET_SELECTIONS[DEFAULT_SELECTION]
    group_label = env("GROUP_SELECTION")
    choices = dict(GROUPS)
    if version == "v2":
        choices = {
            "All categories": "all",
            "Charts": "charts",
            "Tables": "tables",
            "Page layout": "layout",
            "Text content": "text",
            **{name.replace("_", " ").capitalize(): name for name in V2_SUBSETS},
        }
    group = selected(choices, group_label, f"{version} document category")
    return RunConfig(dataset=version, scope=scope, group=group), directory


def main() -> int:
    append_summary(
        [
            f"## [View benchmark run in dashboard](https://parsebench-dashboard.vercel.app/workflows/{env('GITHUB_RUN_ID')})",
            "",
        ]
    )
    benchmark_ref = env("BENCHMARK_REF")
    config, data_dir = run_selection()
    branch = env("PYMUPDF_BRANCH").strip()
    if not branch:
        raise SystemExit("A PyMuPDF branch name is required")
    refs = {name: branch if name == "pymupdf" else "auto" for name in COMPONENT_SPECS}

    output_dir = Path(env("RUNNER_TEMP")) / "parsebench-output"
    output_dir.mkdir(parents=True, exist_ok=True)

    stack_label = f"pymupdf-{safe_ref(refs['pymupdf'])}"
    prefix = env("GCS_PREFIX").strip("/")
    destination = (
        f"{prefix}/{stack_label}/{safe_ref(benchmark_ref)}"
        f"/run-{env('GITHUB_RUN_ID')}-attempt-{env('GITHUB_RUN_ATTEMPT')}"
    )
    artifact_name = f"pymupdf-source-stack-{env('GITHUB_RUN_ID')}-{env('GITHUB_RUN_ATTEMPT')}"

    request = {
        name: {"repository": component.repository, "ref": refs[name]} for name, component in COMPONENT_SPECS.items()
    }
    write_json(output_dir / "_source_request.json", request)
    write_github_outputs(
        {
            "artifact_name": artifact_name,
            "benchmark_ref": benchmark_ref,
            "data_dir": data_dir,
            "dataset_ref": "current",
            "destination": destination,
            "group": config.group,
            "output_dir": str(output_dir),
            "run_scope": config.run_scope,
            "dataset_repository": config.dataset_repository,
            "dataset_version": config.dataset,
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
