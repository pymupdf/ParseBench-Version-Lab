from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

VERSION_LAB_SRC = Path(__file__).parents[1] / "src"
sys.path.insert(0, str(VERSION_LAB_SRC))

from parsebench_version_lab import benchmark_index as benchmark_index_module  # noqa: E402
from parsebench_version_lab.benchmark_index import (  # noqa: E402
    BenchmarkIndexer,
    IngestionJob,
    LocalArtifactReader,
    discover_gcs_readers,
    gcs_reader_for_run,
    parse_ingestion_source_key,
    reconcile_repository,
    validate_workflow_run,
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


def test_gcs_reader_resolves_the_durable_manifest_for_one_run() -> None:
    class RunStorage:
        def list_objects(self, bucket: str, *, suffix: str | None = None):  # noqa: ANN201
            assert bucket == "benchmark-results"
            assert suffix == "run-123-attempt-2/parsebench-output/_github_run.json"
            yield "parsebench/stack/main/run-123-attempt-2/parsebench-output/_github_run.json"

        def read_json(self, bucket: str, object_name: str):  # noqa: ANN201
            del bucket, object_name
            return {"github_run_id": "123"}

    reader = gcs_reader_for_run(RunStorage(), "benchmark-results", 123, 2)  # type: ignore[arg-type]

    assert reader is not None
    assert reader.artifact_root == (
        "gs://benchmark-results/parsebench/stack/main/run-123-attempt-2/parsebench-output/"
    )


def test_ingestion_job_uses_stable_source_key() -> None:
    database = FakeDatabase()
    job = IngestionJob.start(
        database,  # type: ignore[arg-type]
        "owner/repository",
        {"id": 123, "run_attempt": 2},
    )
    job.finish(imported=True)

    assert job.source_key == "owner/repository:123:2"
    assert parse_ingestion_source_key(job.source_key) == ("owner/repository", 123, 2)
    assert parse_ingestion_source_key("invalid") is None
    assert [row["status"] for row in database.rows["ingestion_jobs"]] == ["running", "complete"]
    assert database.rows["ingestion_jobs"][-1]["runs_imported"] == 1


def test_workflow_run_validation_rejects_unrelated_or_incomplete_runs() -> None:
    validate_workflow_run(
        {
            "id": 123,
            "path": ".github/workflows/pymupdf-source-stack-parsebench.yml",
            "status": "completed",
        },
        "pymupdf-source-stack-parsebench.yml",
    )

    with pytest.raises(ValueError, match="belongs to"):
        validate_workflow_run(
            {"id": 124, "path": ".github/workflows/release.yml", "status": "completed"},
            "pymupdf-source-stack-parsebench.yml",
        )
    with pytest.raises(ValueError, match="expected 'completed'"):
        validate_workflow_run(
            {
                "id": 125,
                "path": ".github/workflows/pymupdf-source-stack-parsebench.yml",
                "status": "in_progress",
            },
            "pymupdf-source-stack-parsebench.yml",
        )


def test_reconciliation_falls_back_to_gcs_when_the_artifact_expired(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = FakeDatabase()

    def select(table: str, query: dict[str, str]) -> list[dict[str, Any]]:
        del query
        assert table in {"benchmark_runs", "ingestion_jobs"}
        return []

    database.select = select  # type: ignore[attr-defined]

    class ReconcileGithub:
        repository = "owner/repository"

        def runs(self, workflow: str):  # noqa: ANN201
            assert workflow == "benchmark.yml"
            yield {
                "id": 123,
                "run_attempt": 2,
                "path": ".github/workflows/benchmark.yml",
                "status": "completed",
                "conclusion": "success",
            }

        def run_attempt(self, run_id: int, attempt: int):  # noqa: ANN201
            raise AssertionError(f"Unexpected attempt lookup for {run_id}/{attempt}")

    gcs_reader = object()
    indexed_readers: list[object] = []

    class ReconcileIndexer:
        def __init__(self, selected_database: object, github: object) -> None:
            assert selected_database is database
            assert isinstance(github, ReconcileGithub)

        def index_run(self, run: dict[str, Any], reader: object) -> int:
            assert run["id"] == 123
            indexed_readers.append(reader)
            return 1

    monkeypatch.setattr(benchmark_index_module, "SupabaseRestClient", lambda *_args, **_kwargs: database)
    monkeypatch.setattr(benchmark_index_module, "GithubClient", lambda *_args, **_kwargs: ReconcileGithub())
    monkeypatch.setattr(benchmark_index_module, "BenchmarkIndexer", ReconcileIndexer)
    monkeypatch.setattr(benchmark_index_module, "GcsClient", lambda _token: object())
    monkeypatch.setattr(
        benchmark_index_module,
        "download_github_artifact",
        lambda **_kwargs: (None, "artifact expired"),
    )
    monkeypatch.setattr(
        benchmark_index_module,
        "gcs_reader_for_run",
        lambda *_args, **_kwargs: gcs_reader,
    )

    result = reconcile_repository(
        github_repository="owner/repository",
        bucket="benchmark-results",
        workflow="benchmark.yml",
        supabase_url="https://example.supabase.co",
        supabase_secret_key="secret",
        github_token="github-token",
        gcs_access_token="gcs-token",
        lookback=10,
    )

    assert indexed_readers == [gcs_reader]
    assert result["runs_imported"] == 1
    assert result["runs_failed"] == 0
    run_jobs = [
        row for row in database.rows["ingestion_jobs"] if row["source"] == "github_run"
    ]
    assert [row["status"] for row in run_jobs] == ["running", "complete"]
    reconciliation = next(
        row
        for row in database.rows["ingestion_jobs"]
        if row["source"] == "github_reconciliation"
    )
    assert reconciliation["checkpoint"] == {"github_run_id": 123, "github_run_attempt": 2}


def test_reconciliation_scans_every_run_newer_than_its_cursor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = FakeDatabase()

    def select(table: str, query: dict[str, str]) -> list[dict[str, Any]]:
        if table == "benchmark_runs":
            return []
        assert table == "ingestion_jobs"
        if query.get("source") == "eq.github_reconciliation":
            return [{"checkpoint": {"github_run_id": 100, "github_run_attempt": 1}}]
        assert query["source_key"] == "like.owner/repository:*"
        return [{"source_key": "owner/repository:50:2", "status": "partial"}]

    database.select = select  # type: ignore[attr-defined]
    visited: list[int] = []

    class ReconcileGithub:
        repository = "owner/repository"

        def runs(self, workflow: str):  # noqa: ANN201
            assert workflow == "benchmark.yml"
            for run_id in (105, 104, 103, 102, 101, 100, 99):
                visited.append(run_id)
                yield {
                    "id": run_id,
                    "run_attempt": 1,
                    "path": ".github/workflows/benchmark.yml",
                    "status": "completed",
                    "conclusion": "success",
                }

        def run_attempt(self, run_id: int, attempt: int):  # noqa: ANN201
            assert (run_id, attempt) == (50, 2)
            return {
                "id": run_id,
                "run_attempt": attempt,
                "path": ".github/workflows/benchmark.yml",
                "status": "completed",
                "conclusion": "success",
            }

    indexed: list[int] = []

    class ReconcileIndexer:
        def __init__(self, selected_database: object, github: object) -> None:
            assert selected_database is database
            assert isinstance(github, ReconcileGithub)

        def index_run(self, run: dict[str, Any], reader: object) -> int:
            assert reader is not None
            indexed.append(run["id"])
            return run["id"]

    artifact_reader = object()
    monkeypatch.setattr(benchmark_index_module, "SupabaseRestClient", lambda *_args: database)
    monkeypatch.setattr(benchmark_index_module, "GithubClient", lambda *_args: ReconcileGithub())
    monkeypatch.setattr(benchmark_index_module, "BenchmarkIndexer", ReconcileIndexer)
    monkeypatch.setattr(
        benchmark_index_module,
        "download_github_artifact",
        lambda **_kwargs: (artifact_reader, None),
    )

    result = reconcile_repository(
        github_repository="owner/repository",
        bucket="benchmark-results",
        workflow="benchmark.yml",
        supabase_url="https://example.supabase.co",
        supabase_secret_key="secret",
        github_token="github-token",
        lookback=2,
    )

    assert visited == [105, 104, 103, 102, 101, 100]
    assert indexed == [50, 101, 102, 103, 104, 105]
    assert result["runs_examined"] == 6
    assert result["cursor_github_run_id"] == 105
    reconciliation = next(
        row
        for row in database.rows["ingestion_jobs"]
        if row["source"] == "github_reconciliation"
    )
    assert reconciliation["checkpoint"] == {"github_run_id": 105, "github_run_attempt": 1}


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
                    "source_relative_path": "docs/table/invoice.pdf",
                    "source_media_type": "application/pdf",
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
    assert database.rows["benchmark_cases"][0]["source_relative_path"] == "docs/table/invoice.pdf"
    assert database.rows["case_results"][0]["primary_score"] == 0.75
    assert database.rows["case_results"][0]["result_relative_path"] == (
        "pymupdf4llm_markdown/table/invoice.result.json"
    )
    assert database.rows["case_metrics"][0]["passed_count"] == 3


def test_indexer_discovers_single_group_report_at_pipeline_root(tmp_path: Path) -> None:
    pipeline = "pymupdf4llm_html_tables"
    write_json(
        tmp_path / "_github_run.json",
        {
            "pipeline": pipeline,
            "requested_scope": "full",
            "requested_group": "table",
            "dataset": {
                "repository": "owner/dataset",
                "resolved_sha": "a" * 40,
                "profile": "full",
                "profile_source": "canonical_branch_head",
                "manifest": {
                    "document_count": 10,
                    "dimension_counts": {
                        "chart": 2,
                        "layout": 2,
                        "table": 1,
                        "text_content": 3,
                        "text_formatting": 2,
                    },
                },
            },
        },
    )
    write_json(tmp_path / pipeline / "_metadata.json", {"summary": {"total": 1, "errors": []}})
    write_json(
        tmp_path / pipeline / "_evaluation_report.json",
        {
            "total_examples": 1,
            "successful": 1,
            "failed": 0,
            "skipped": 0,
            "aggregate_metrics": {"avg_grits_trm_composite": 0.8},
            "per_example_results": [],
        },
    )
    database = FakeDatabase()

    BenchmarkIndexer(database, FakeGithub()).index_run(  # type: ignore[arg-type]
        {
            "id": 123,
            "run_attempt": 1,
            "repository": {"full_name": "owner/repository"},
            "status": "completed",
            "conclusion": "success",
        },
        LocalArtifactReader(tmp_path),
    )

    assert database.rows["run_dimensions"][0]["dimension"] == "table"
    assert database.rows["run_dimensions"][0]["report_relative_path"] == (
        "pymupdf4llm_html_tables/_evaluation_report.json"
    )
    assert database.rows["benchmark_runs"][0]["effective_group"] == "table"
    assert database.rows["benchmark_runs"][0]["coverage_status"] == "complete"
    assert database.rows["benchmark_runs"][0]["leaderboard_eligible"] is True
    assert database.rows["benchmark_runs"][0]["eligibility_reasons"] == []
