from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

VERSION_LAB_SRC = Path(__file__).parents[1] / "src"
sys.path.insert(0, str(VERSION_LAB_SRC))

from parsebench_version_lab.benchmark_index import (  # noqa: E402
    BenchmarkIndexer,
    LocalArtifactReader,
    discover_gcs_readers,
)


class FakeStorage:
    def __init__(self) -> None:
        self.names = [
            "runs/one/parsebench-output/_github_run.json",
            "runs/two/parsebench-output/_github_run.json",
        ]

    def list_objects(self, bucket: str, *, suffix: str | None = None):  # noqa: ANN201
        assert bucket == "benchmark-results"
        assert suffix == "_github_run.json"
        yield from self.names

    def read_json(self, bucket: str, object_name: str) -> dict[str, str]:
        assert bucket == "benchmark-results"
        run_id = "101" if "/one/" in object_name else "202"
        return {"github_run_id": run_id, "github_run_attempt": "2"}


class FakeDatabase:
    def __init__(self) -> None:
        self.rows: dict[str, list[dict[str, Any]]] = {}
        self.next_id = 1

    def _record(self, table: str, row: dict[str, Any]) -> dict[str, Any]:
        recorded = {"id": self.next_id, **row}
        self.next_id += 1
        self.rows.setdefault(table, []).append(recorded)
        return recorded

    def upsert_one(self, table: str, row: dict[str, Any], conflict: str) -> dict[str, Any]:
        del conflict
        return self._record(table, row)

    def upsert_many(self, table: str, rows: list[dict[str, Any]], conflict: str) -> list[dict[str, Any]]:
        del conflict
        return [self._record(table, row) for row in rows]


class FakeGithub:
    repository = "owner/repository"

    def failed_steps(self, run_id: int) -> list[dict[str, Any]]:
        assert run_id == 123
        return []


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def test_gcs_discovery_accepts_string_ids_and_saves_inventory(tmp_path: Path) -> None:
    inventory_path = tmp_path / "gcs-run-inventory.json"

    readers = discover_gcs_readers(FakeStorage(), "benchmark-results", inventory_path=inventory_path)  # type: ignore[arg-type]

    assert sorted(readers) == [(101, 2), (202, 2)]
    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    assert inventory["run_count"] == 2
    assert [run["github_run_id"] for run in inventory["runs"]] == [101, 202]


def test_indexer_extracts_document_scores_and_artifact_locators(tmp_path: Path) -> None:
    pipeline = "pymupdf4llm_markdown"
    write_json(
        tmp_path / "_github_run.json",
        {
            "pipeline": pipeline,
            "dataset": {"repository": "owner/dataset", "resolved_sha": "a" * 40},
            "gcs_bucket": "benchmark-results",
            "gcs_destination": "runs/example",
        },
    )
    write_json(tmp_path / pipeline / "_metadata.json", {"summary": {"errors": []}})
    write_json(
        tmp_path / pipeline / "table" / "_evaluation_report.json",
        {
            "total_examples": 1,
            "successful": 1,
            "failed": 0,
            "skipped": 0,
            "aggregate_metrics": {"grits_trm_composite": 0.75},
            "per_example_results": [
                {
                    "test_id": "table/invoice",
                    "success": True,
                    "metrics": [
                        {
                            "metric_name": "grits_trm_composite",
                            "value": 0.75,
                            "metadata": {"passed": 3, "total": 4},
                        }
                    ],
                    "tags": ["invoice"],
                }
            ],
        },
    )
    database = FakeDatabase()
    github_run = {
        "id": 123,
        "run_attempt": 1,
        "repository": {"full_name": "owner/repository"},
        "status": "completed",
        "conclusion": "success",
    }

    BenchmarkIndexer(database, FakeGithub()).index_run(  # type: ignore[arg-type]
        github_run, LocalArtifactReader(tmp_path)
    )

    assert database.rows["benchmark_cases"][0]["pdf_relative_path"] == "docs/table/invoice.pdf"
    assert database.rows["case_results"][0]["primary_score"] == 0.75
    assert database.rows["case_results"][0]["result_relative_path"] == (
        "pymupdf4llm_markdown/table/invoice.result.json"
    )
    assert database.rows["case_metrics"][0]["passed_count"] == 3
