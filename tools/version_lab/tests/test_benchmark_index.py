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
        if table == "case_results" and conflict == "run_dimension_id,benchmark_case_id":
            recorded: list[dict[str, Any]] = []
            for row in rows:
                existing = next(
                    (
                        value
                        for value in self.rows.get(table, [])
                        if value["run_dimension_id"] == row["run_dimension_id"]
                        and value["benchmark_case_id"] == row["benchmark_case_id"]
                    ),
                    None,
                )
                if existing is None:
                    existing = self._record(table, row)
                else:
                    existing.update(row)
                recorded.append(existing)
            return recorded
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
    assert reader.artifact_root == ("gs://benchmark-results/parsebench/stack/main/run-123-attempt-2/parsebench-output/")


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
    run_jobs = [row for row in database.rows["ingestion_jobs"] if row["source"] == "github_run"]
    assert [row["status"] for row in run_jobs] == ["running", "complete"]
    reconciliation = next(row for row in database.rows["ingestion_jobs"] if row["source"] == "github_reconciliation")
    assert reconciliation["checkpoint"] == {"github_run_id": 123, "github_run_attempt": 2}


@pytest.mark.parametrize(
    ("conclusion", "display_title", "expected_excluded"),
    [
        ("cancelled", "All latest commits · Quick test", 1),
        ("success", "Publish source-stack environment · Quick test", 1),
        ("success", "Pymupdf4llm Markdown · Quick test", 0),
    ],
)
def test_reconciliation_excludes_only_irrecoverable_artifactless_runs(
    monkeypatch: pytest.MonkeyPatch,
    conclusion: str,
    display_title: str,
    expected_excluded: int,
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
                "run_attempt": 1,
                "path": ".github/workflows/benchmark.yml",
                "status": "completed",
                "conclusion": conclusion,
                "display_title": display_title,
            }

        def run_attempt(self, run_id: int, attempt: int):  # noqa: ANN201
            raise AssertionError(f"Unexpected attempt lookup for {run_id}/{attempt}")

    terminal_flags: list[bool] = []

    class ReconcileIndexer:
        def __init__(self, selected_database: object, github: object) -> None:
            assert selected_database is database
            assert isinstance(github, ReconcileGithub)

        def index_run(
            self,
            run: dict[str, Any],
            reader: object,
            *,
            terminal_missing_artifact: bool = False,
        ) -> int:
            assert run["id"] == 123
            assert reader is None
            terminal_flags.append(terminal_missing_artifact)
            return 1

    monkeypatch.setattr(benchmark_index_module, "SupabaseRestClient", lambda *_args, **_kwargs: database)
    monkeypatch.setattr(benchmark_index_module, "GithubClient", lambda *_args, **_kwargs: ReconcileGithub())
    monkeypatch.setattr(benchmark_index_module, "BenchmarkIndexer", ReconcileIndexer)
    monkeypatch.setattr(benchmark_index_module, "GcsClient", lambda _token: object())
    monkeypatch.setattr(benchmark_index_module, "download_github_artifact", lambda **_kwargs: (None, "missing"))
    monkeypatch.setattr(benchmark_index_module, "gcs_reader_for_run", lambda *_args, **_kwargs: None)

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

    assert terminal_flags == [bool(expected_excluded)]
    assert result["runs_excluded"] == expected_excluded
    assert result["runs_failed"] == 1 - expected_excluded
    run_jobs = [row for row in database.rows["ingestion_jobs"] if row["source"] == "github_run"]
    assert run_jobs[-1]["status"] == ("complete" if expected_excluded else "partial")


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
    reconciliation = next(row for row in database.rows["ingestion_jobs"] if row["source"] == "github_reconciliation")
    assert reconciliation["checkpoint"] == {"github_run_id": 105, "github_run_attempt": 1}


def test_indexer_extracts_document_scores_and_requires_v3_diagnostic_locators(tmp_path: Path) -> None:
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
    diagnostic_index_path = tmp_path / pipeline / "table" / "_diagnostics" / "v3" / "index.json"
    write_json(
        diagnostic_index_path,
        {
            "schema_version": 3,
            "dimension": "table",
            "diagnostics": {
                "table/invoice": {
                    "relative_path": "_diagnostics/v3/0123456789abcdef0123456789abcdef.json",
                    "schema_version": 3,
                }
            },
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
    assert database.rows["case_results"][0]["diagnostic_relative_path"] == (
        "pymupdf4llm_markdown/table/_diagnostics/v3/0123456789abcdef0123456789abcdef.json"
    )
    assert database.rows["case_results"][0]["diagnostic_schema_version"] == 3
    assert database.rows["case_metrics"][0]["passed_count"] == 3

    diagnostic_index_path.unlink()
    historical_database = FakeDatabase()
    with pytest.raises(ValueError, match="schema-v3 diagnostics are incomplete"):
        BenchmarkIndexer(historical_database, FakeGithub()).index_run(  # type: ignore[arg-type]
            github_run, LocalArtifactReader(tmp_path)
        )


def test_diagnostic_index_rejects_unsafe_or_incompatible_locators(tmp_path: Path) -> None:
    index_path = tmp_path / "pipeline" / "table" / "_diagnostics" / "v3" / "index.json"
    write_json(
        index_path,
        {
            "schema_version": 3,
            "dimension": "table",
            "diagnostics": {
                "table/safe": {"relative_path": "_diagnostics/v3/safe.json"},
                "table/escape": {"relative_path": "../../escape.json"},
                "table/outside": {"relative_path": "results/outside.json"},
                "table/version": {
                    "relative_path": "_diagnostics/v3/version.json",
                    "schema_version": 2,
                },
            },
        },
    )

    locators = benchmark_index_module._diagnostic_locators(
        LocalArtifactReader(tmp_path),
        "pipeline/table/_evaluation_report.json",
        "table",
    )

    assert locators == {"table/safe": ("pipeline/table/_diagnostics/v3/safe.json", 3)}
    assert (
        benchmark_index_module._diagnostic_locators(
            LocalArtifactReader(tmp_path),
            "pipeline/table/_evaluation_report.json",
            "layout",
        )
        == {}
    )


def test_diagnostic_index_ignores_legacy_indexes(tmp_path: Path) -> None:
    write_json(
        tmp_path / "pipeline" / "table" / "_diagnostics" / "index.json",
        {
            "schema_version": 1,
            "dimension": "table",
            "diagnostics": {
                "table/example": {
                    "relative_path": "_diagnostics/legacy.json",
                    "schema_version": 1,
                }
            },
        },
    )
    write_json(
        tmp_path / "pipeline" / "table" / "_diagnostics" / "v2" / "index.json",
        {
            "schema_version": 2,
            "dimension": "table",
            "diagnostics": {
                "table/example": {
                    "relative_path": "_diagnostics/v2/compact.json",
                    "schema_version": 2,
                }
            },
        },
    )

    assert (
        benchmark_index_module._diagnostic_locators(
            LocalArtifactReader(tmp_path),
            "pipeline/table/_evaluation_report.json",
            "table",
        )
        == {}
    )


def test_diagnostic_index_consumes_only_dashboard_v3(tmp_path: Path) -> None:
    for version in (2, 3):
        write_json(
            tmp_path / "pipeline" / "layout" / "_diagnostics" / f"v{version}" / "index.json",
            {
                "schema_version": version,
                "dimension": "layout",
                "diagnostics": {
                    "layout/example": {
                        "relative_path": f"_diagnostics/v{version}/case.json",
                        "schema_version": version,
                    }
                },
            },
        )

    assert benchmark_index_module._diagnostic_locators(
        LocalArtifactReader(tmp_path),
        "pipeline/layout/_evaluation_report.json",
        "layout",
    ) == {"layout/example": ("pipeline/layout/_diagnostics/v3/case.json", 3)}

    (tmp_path / "pipeline/layout/_diagnostics/v3/index.json").unlink()
    assert (
        benchmark_index_module._diagnostic_locators(
            LocalArtifactReader(tmp_path),
            "pipeline/layout/_evaluation_report.json",
            "layout",
        )
        == {}
    )


def test_primary_metric_fallback_prefers_general_rule_pass_rate() -> None:
    name, value = benchmark_index_module._primary_metric(
        "text_formatting",
        [
            {"metric_name": "rule_is_italic_pass_rate", "value": 1.0},
            {"metric_name": "rule_pass_rate", "value": 0.5},
            {"metric_name": "rule_is_underline_pass_rate", "value": 0.0},
        ],
    )

    assert (name, value) == ("rule_pass_rate", 0.5)


@pytest.mark.parametrize(
    (
        "existing_version",
        "existing_has_path",
        "expected_path",
        "expected_upserts",
    ),
    [
        (2, True, "pipeline/table/_diagnostics/v3/upgrade.json", 2),
        (3, False, "pipeline/table/_diagnostics/v3/upgrade.json", 2),
        (3, True, "pipeline/table/_diagnostics/v3/persisted.json", 1),
        (4, True, "pipeline/table/_diagnostics/v4/persisted.json", 1),
    ],
)
def test_indexer_applies_v3_locator_without_downgrading_newer_persisted_locator(
    tmp_path: Path,
    existing_version: int,
    existing_has_path: bool,
    expected_path: str | None,
    expected_upserts: int,
) -> None:
    class ExistingLocatorDatabase(FakeDatabase):
        def __init__(self) -> None:
            super().__init__()
            self.case_result_upserts = 0
            self.case_result_payloads: list[list[dict[str, Any]]] = []

        def upsert_many(
            self,
            table: str,
            rows: list[dict[str, Any]],
            conflict: str,
        ) -> list[dict[str, Any]]:
            if table == "case_results":
                self.case_result_payloads.append([dict(row) for row in rows])
            records = super().upsert_many(table, rows, conflict)
            if table != "case_results":
                return records
            self.case_result_upserts += 1
            if self.case_result_upserts == 1:
                for record in records:
                    record.update(
                        {
                            "diagnostic_relative_path": (
                                f"pipeline/table/_diagnostics/v{existing_version}/persisted.json"
                                if existing_has_path
                                else None
                            ),
                            "diagnostic_schema_version": existing_version,
                        }
                    )
            return records

    diagnostic_directory = "_diagnostics/v3"
    diagnostic_filename = "upgrade.json"
    write_json(
        tmp_path / "pipeline" / "table" / diagnostic_directory / "index.json",
        {
            "schema_version": 3,
            "dimension": "table",
            "diagnostics": {
                "table/example": {
                    "relative_path": f"{diagnostic_directory}/{diagnostic_filename}",
                    "schema_version": 3,
                }
            },
        },
    )
    report = {
        "total_examples": 1,
        "successful": 1,
        "failed": 0,
        "skipped": 0,
        "per_example_results": [
            {
                "test_id": "table/example",
                "source_relative_path": "docs/table/example.pdf",
                "source_media_type": "application/pdf",
                "success": True,
                "metrics": [],
                "tags": ["table"],
                "stats": [{"name": "latency_ms", "value": 5, "unit": "ms"}],
            }
        ],
    }
    database = ExistingLocatorDatabase()

    BenchmarkIndexer(database, FakeGithub())._index_report(  # type: ignore[arg-type]
        1,
        1,
        {},
        "pipeline",
        "table",
        "pipeline/table/_evaluation_report.json",
        report,
        LocalArtifactReader(tmp_path),
    )

    result = database.rows["case_results"][0]
    assert result["diagnostic_schema_version"] == max(existing_version, 3)
    assert result["diagnostic_relative_path"] == expected_path
    assert database.case_result_upserts == expected_upserts
    if expected_upserts == 2:
        upgrade = database.case_result_payloads[1][0]
        assert upgrade["success"] is True
        assert upgrade["tags"] == ["table"]
        assert upgrade["stats"] == {"latency_ms": {"value": 5, "unit": "ms"}}


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
