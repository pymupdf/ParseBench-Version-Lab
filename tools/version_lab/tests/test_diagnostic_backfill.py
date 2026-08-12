from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

VERSION_LAB_SRC = Path(__file__).parents[1] / "src"
sys.path.insert(0, str(VERSION_LAB_SRC))

from parsebench_version_lab.diagnostic_backfill import (  # noqa: E402
    DiagnosticDimension,
    DiagnosticRun,
    _generate_dimension,
    _publish_dimension,
    _remote_dimension_is_complete,
    discover_diagnostic_runs,
)


class CandidateDatabase:
    def __init__(self, diagnostic_schema_version: int | None = None) -> None:
        self.diagnostic_schema_version = diagnostic_schema_version

    def select(self, table: str, query: dict[str, str]) -> list[dict[str, Any]]:
        if table == "benchmark_runs":
            assert query["gcs_bucket"] == "not.is.null"
            return [
                {
                    "id": 7,
                    "github_repository": "owner/repository",
                    "github_run_id": 123,
                    "github_run_attempt": 2,
                    "gcs_bucket": "benchmark-results",
                    "gcs_prefix": "runs/123/parsebench-output",
                    "dataset_version_id": 4,
                }
            ]
        if table == "dataset_versions":
            return [
                {
                    "repository": "owner/dataset",
                    "resolved_sha": "a" * 40,
                }
            ]
        if table == "run_dimensions":
            return [
                {
                    "id": 9,
                    "dimension": "table",
                    "report_relative_path": "pipeline/table/_evaluation_report.json",
                }
            ]
        if table == "case_results":
            return [
                {
                    "id": 1,
                    "run_dimension_id": 9,
                    "diagnostic_relative_path": (
                        None
                        if self.diagnostic_schema_version is None
                        else f"pipeline/table/_diagnostics/v{self.diagnostic_schema_version}/case.json"
                    ),
                    "diagnostic_schema_version": self.diagnostic_schema_version,
                    "benchmark_cases": {"test_id": "table/example"},
                }
            ]
        raise AssertionError(table)


def diagnostic_run() -> DiagnosticRun:
    return DiagnosticRun(
        id=7,
        github_repository="owner/repository",
        github_run_id=123,
        github_run_attempt=2,
        bucket="benchmark-results",
        prefix="runs/123/parsebench-output",
        dataset_repository="owner/dataset",
        dataset_sha="a" * 40,
        dimensions=(
            DiagnosticDimension(
                id=9,
                dimension="table",
                report_relative_path="pipeline/table/_evaluation_report.json",
                test_ids=("table/example",),
                missing_count=1,
            ),
        ),
    )


@pytest.mark.parametrize("existing_schema_version", [None, 1])
def test_discovers_missing_and_outdated_diagnostic_locators(
    existing_schema_version: int | None,
) -> None:
    candidates = discover_diagnostic_runs(
        CandidateDatabase(existing_schema_version),  # type: ignore[arg-type]
        github_repository="owner/repository",
    )

    assert candidates == [diagnostic_run()]


def test_discovery_skips_current_diagnostic_locators() -> None:
    assert discover_diagnostic_runs(
        CandidateDatabase(2),  # type: ignore[arg-type]
        github_repository="owner/repository",
    ) == []


def test_generation_requires_report_and_database_test_ids_to_match(tmp_path: Path) -> None:
    run = diagnostic_run()
    report_dir = tmp_path / "reports" / "9"
    report_dir.mkdir(parents=True)
    report = {
        "total_examples": 1,
        "successful": 1,
        "failed": 0,
        "skipped": 0,
        "per_example_results": [
            {
                "test_id": "table/different",
                "example_id": "different",
                "pipeline_name": "pipeline",
                "product_type": "parse",
                "success": True,
            }
        ],
    }
    (report_dir / "_evaluation_report.json").write_text(json.dumps(report), encoding="utf-8")
    dataset_dir = tmp_path / "datasets" / ("a" * 40)
    dataset_dir.mkdir(parents=True)
    (dataset_dir / "table.jsonl").write_text("", encoding="utf-8")

    with pytest.raises(ValueError, match="do not match Supabase"):
        _generate_dimension(run, run.dimensions[0], tmp_path, dataset_dir, lambda _command: None)


def test_publish_uploads_sidecars_before_the_discovery_index(tmp_path: Path) -> None:
    run = diagnostic_run()
    index_path = tmp_path / "_diagnostics" / "v2" / "index.json"
    index_path.parent.mkdir(parents=True)
    index_path.write_text("{}", encoding="utf-8")
    commands: list[list[str]] = []

    _publish_dimension(run, run.dimensions[0], index_path, lambda command: commands.append(list(command)))

    assert commands[0][0:3] == ["gcloud", "storage", "rsync"]
    assert commands[0][4].endswith("/_diagnostics/v2")
    assert "--exclude" in commands[0]
    assert commands[1][0:3] == ["gcloud", "storage", "cp"]
    assert commands[1][4].endswith("/_diagnostics/v2/index.json")


class DiagnosticStorage:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload
        self.object_names: list[str] = []

    def read_json(self, _bucket: str, object_name: str) -> dict[str, Any]:
        self.object_names.append(object_name)
        return self.payload


def test_remote_completion_uses_only_the_versioned_v2_index() -> None:
    storage = DiagnosticStorage(
        {
            "schema_version": 2,
            "dimension": "table",
            "diagnostics": {
                "table/example": {
                    "relative_path": "_diagnostics/v2/example.json",
                    "schema_version": 2,
                }
            },
        }
    )

    assert _remote_dimension_is_complete(storage, diagnostic_run(), diagnostic_run().dimensions[0])
    assert storage.object_names == [
        "runs/123/parsebench-output/pipeline/table/_diagnostics/v2/index.json"
    ]
