"""Reconstruct and publish per-case diagnostics for indexed historical runs."""

from __future__ import annotations

import json
import os
import re
import subprocess
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from parse_bench.evaluation.diagnostics import DIAGNOSTIC_SCHEMA_VERSION, write_diagnostic_artifacts
from parse_bench.schemas.evaluation import EvaluationSummary

from .benchmark_index import (
    BenchmarkIndexer,
    GcsArtifactReader,
    GcsClient,
    GithubClient,
    SupabaseRestClient,
    _now_expression_payload,
    gcloud_access_token,
    gh_access_token,
)

PAGE_SIZE = 1000
DATASET_REVISION_PATTERN = re.compile(r"[0-9a-f]{40}")
CommandRunner = Callable[[Sequence[str]], None]


@dataclass(frozen=True)
class DiagnosticDimension:
    """One indexed dimension whose report can be reconstructed."""

    id: int
    dimension: str
    report_relative_path: str
    test_ids: tuple[str, ...]
    missing_count: int


@dataclass(frozen=True)
class DiagnosticRun:
    """A historical run with at least one missing diagnostic locator."""

    id: int
    github_repository: str
    github_run_id: int
    github_run_attempt: int
    bucket: str
    prefix: str
    dataset_repository: str
    dataset_sha: str
    dimensions: tuple[DiagnosticDimension, ...]

    @property
    def missing_count(self) -> int:
        return sum(value.missing_count for value in self.dimensions)


def _integer(value: Any, label: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{label} must be an integer")
    try:
        return int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must be an integer") from error


def _string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    return value.strip()


def _artifact_path(value: Any, label: str) -> str:
    path = PurePosixPath(_string(value, label))
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"{label} must be relative to the artifact root")
    return path.as_posix()


def _select_all(
    database: SupabaseRestClient,
    table: str,
    query: Mapping[str, str],
) -> list[dict[str, Any]]:
    """Read a stable result set without relying on the PostgREST row cap."""

    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        page_query = dict(query)
        page_query["limit"] = str(PAGE_SIZE)
        page_query["offset"] = str(offset)
        page = database.select(table, page_query)
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE


def _dimension_case_rows(database: SupabaseRestClient, run_dimension_id: int) -> list[dict[str, Any]]:
    return _select_all(
        database,
        "case_results",
        {
            "select": (
                "id,diagnostic_relative_path,diagnostic_schema_version,"
                "benchmark_cases!inner(test_id)"
            ),
            "run_dimension_id": f"eq.{run_dimension_id}",
            "order": "id.asc",
        },
    )


def _all_case_rows(database: SupabaseRestClient) -> list[dict[str, Any]]:
    """Load indexed case IDs once so discovery does not make one request per dimension."""

    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = database.select(
            "case_results",
            {
                "select": (
                    "id,run_dimension_id,diagnostic_relative_path,diagnostic_schema_version,"
                    "benchmark_cases!inner(test_id)"
                ),
                "order": "id.asc",
                    "limit": str(PAGE_SIZE),
                "offset": str(offset),
            },
        )
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE


def _case_test_id(row: Mapping[str, Any]) -> str:
    case = row.get("benchmark_cases")
    if not isinstance(case, Mapping):
        raise ValueError("Supabase did not return the benchmark case relationship")
    return _string(case.get("test_id"), "benchmark_cases.test_id")


def discover_diagnostic_runs(
    database: SupabaseRestClient,
    *,
    github_repository: str,
    github_run_ids: Sequence[int] = (),
) -> list[DiagnosticRun]:
    """Find indexed runs with reconstructable reports and missing locators."""

    run_query = {
        "select": (
            "id,github_repository,github_run_id,github_run_attempt,gcs_bucket,gcs_prefix,"
            "dataset_version_id"
        ),
        "github_repository": f"eq.{github_repository}",
        "gcs_bucket": "not.is.null",
        "gcs_prefix": "not.is.null",
        "dataset_version_id": "not.is.null",
        "order": "github_run_id.asc,github_run_attempt.asc",
    }
    selected_ids = sorted(set(github_run_ids))
    if selected_ids:
        run_query["github_run_id"] = f"in.({','.join(str(value) for value in selected_ids)})"

    case_rows_by_dimension: dict[int, list[dict[str, Any]]] = {}
    for case_row in _all_case_rows(database):
        dimension_id = _integer(case_row.get("run_dimension_id"), "case_results.run_dimension_id")
        case_rows_by_dimension.setdefault(dimension_id, []).append(case_row)

    dataset_cache: dict[int, tuple[str, str]] = {}
    candidates: list[DiagnosticRun] = []
    for run in _select_all(database, "benchmark_runs", run_query):
        database_run_id = _integer(run.get("id"), "benchmark_runs.id")
        dataset_id = _integer(run.get("dataset_version_id"), "benchmark_runs.dataset_version_id")
        if dataset_id not in dataset_cache:
            dataset_rows = database.select(
                "dataset_versions",
                {
                    "select": "repository,resolved_sha",
                    "id": f"eq.{dataset_id}",
                    "limit": "1",
                },
            )
            if len(dataset_rows) != 1:
                raise ValueError(f"Dataset version {dataset_id} was not found")
            dataset_repository = _string(dataset_rows[0].get("repository"), "dataset_versions.repository")
            dataset_sha = _string(dataset_rows[0].get("resolved_sha"), "dataset_versions.resolved_sha")
            if DATASET_REVISION_PATTERN.fullmatch(dataset_sha) is None:
                raise ValueError(f"Dataset version {dataset_id} is not pinned to a full commit SHA")
            dataset_cache[dataset_id] = dataset_repository, dataset_sha

        dimensions: list[DiagnosticDimension] = []
        dimension_rows = _select_all(
            database,
            "run_dimensions",
            {
                "select": "id,dimension,report_relative_path",
                "run_id": f"eq.{database_run_id}",
                "report_relative_path": "not.is.null",
                "order": "id.asc",
            },
        )
        for dimension_row in dimension_rows:
            run_dimension_id = _integer(dimension_row.get("id"), "run_dimensions.id")
            case_rows = case_rows_by_dimension.get(run_dimension_id, [])
            missing = [
                row
                for row in case_rows
                if not row.get("diagnostic_relative_path")
                or row.get("diagnostic_schema_version") != DIAGNOSTIC_SCHEMA_VERSION
            ]
            if not missing:
                continue
            test_ids = tuple(_case_test_id(row) for row in case_rows)
            if len(test_ids) != len(set(test_ids)):
                raise ValueError(f"Run dimension {run_dimension_id} contains duplicate benchmark test IDs")
            dimensions.append(
                DiagnosticDimension(
                    id=run_dimension_id,
                    dimension=_string(dimension_row.get("dimension"), "run_dimensions.dimension"),
                    report_relative_path=_artifact_path(
                        dimension_row.get("report_relative_path"),
                        "run_dimensions.report_relative_path",
                    ),
                    test_ids=test_ids,
                    missing_count=len(missing),
                )
            )
        if dimensions:
            dataset_repository, dataset_sha = dataset_cache[dataset_id]
            candidates.append(
                DiagnosticRun(
                    id=database_run_id,
                    github_repository=_string(run.get("github_repository"), "benchmark_runs.github_repository"),
                    github_run_id=_integer(run.get("github_run_id"), "benchmark_runs.github_run_id"),
                    github_run_attempt=_integer(
                        run.get("github_run_attempt") or 1,
                        "benchmark_runs.github_run_attempt",
                    ),
                    bucket=_string(run.get("gcs_bucket"), "benchmark_runs.gcs_bucket"),
                    prefix=_artifact_path(run.get("gcs_prefix"), "benchmark_runs.gcs_prefix"),
                    dataset_repository=dataset_repository,
                    dataset_sha=dataset_sha,
                    dimensions=tuple(dimensions),
                )
            )

    if selected_ids:
        found_ids = {candidate.github_run_id for candidate in candidates}
        absent = sorted(set(selected_ids) - found_ids)
        if absent:
            print(
                "No missing, reconstructable diagnostic rows for requested run(s): "
                + ", ".join(str(value) for value in absent)
            )
    return candidates


def _run_checked(command: Sequence[str]) -> None:
    subprocess.run(list(command), check=True)


def _ensure_dataset(
    run: DiagnosticRun,
    workspace: Path,
    command_runner: CommandRunner,
) -> Path:
    destination = workspace / "datasets" / run.dataset_sha
    required = {dimension.dimension for dimension in run.dimensions}
    missing = [dimension for dimension in required if not (destination / f"{dimension}.jsonl").is_file()]
    if missing:
        destination.mkdir(parents=True, exist_ok=True)
        command_runner(
            [
                "hf",
                "download",
                run.dataset_repository,
                *(f"{dimension}.jsonl" for dimension in sorted(required)),
                "--repo-type",
                "dataset",
                "--revision",
                run.dataset_sha,
                "--local-dir",
                str(destination),
            ]
        )
    still_missing = sorted(
        dimension for dimension in required if not (destination / f"{dimension}.jsonl").is_file()
    )
    if still_missing:
        raise FileNotFoundError(
            f"Pinned dataset {run.dataset_repository}@{run.dataset_sha} is missing: " + ", ".join(still_missing)
        )
    return destination


def _report_path(
    run: DiagnosticRun,
    dimension: DiagnosticDimension,
    workspace: Path,
    command_runner: CommandRunner,
) -> Path:
    report_path = workspace / "reports" / str(dimension.id) / "_evaluation_report.json"
    if not report_path.is_file():
        report_path.parent.mkdir(parents=True, exist_ok=True)
        remote = f"gs://{run.bucket}/{run.prefix.rstrip('/')}/{dimension.report_relative_path}"
        command_runner(["gcloud", "storage", "cp", remote, str(report_path)])
    return report_path


def _generate_dimension(
    run: DiagnosticRun,
    dimension: DiagnosticDimension,
    workspace: Path,
    dataset_dir: Path,
    command_runner: CommandRunner,
) -> Path:
    report_path = _report_path(run, dimension, workspace, command_runner)
    summary = EvaluationSummary.model_validate_json(report_path.read_text(encoding="utf-8"))
    report_test_ids = [result.test_id for result in summary.per_example_results]
    if len(report_test_ids) != len(set(report_test_ids)):
        raise ValueError(f"Report for run dimension {dimension.id} contains duplicate test IDs")
    expected_ids = set(dimension.test_ids)
    actual_ids = set(report_test_ids)
    if expected_ids != actual_ids:
        missing = sorted(expected_ids - actual_ids)[:5]
        extra = sorted(actual_ids - expected_ids)[:5]
        raise ValueError(
            f"Report test IDs do not match Supabase for run dimension {dimension.id}; "
            f"missing={missing!r}, extra={extra!r}"
        )

    generated_dir = workspace / "generated" / str(dimension.id)
    cached_index_path = (
        generated_dir
        / "_diagnostics"
        / f"v{DIAGNOSTIC_SCHEMA_VERSION}"
        / "index.json"
    )
    if cached_index_path.is_file():
        cached_index = json.loads(cached_index_path.read_text(encoding="utf-8"))
        cached_entries = cached_index.get("diagnostics")
        if (
            cached_index.get("schema_version") == DIAGNOSTIC_SCHEMA_VERSION
            and cached_index.get("dimension") == dimension.dimension
            and isinstance(cached_entries, dict)
            and set(cached_entries) == expected_ids
            and all(
                isinstance(entry, Mapping)
                and isinstance(entry.get("relative_path"), str)
                and (generated_dir / entry["relative_path"]).is_file()
                for entry in cached_entries.values()
            )
        ):
            return cached_index_path

    index_path = write_diagnostic_artifacts(
        summary,
        generated_dir,
        test_cases_dir=dataset_dir,
        dimension=dimension.dimension,
        verified_only=summary.verified_only,
    )
    index = json.loads(index_path.read_text(encoding="utf-8"))
    index_ids = set(index.get("diagnostics", {}))
    if index.get("schema_version") != DIAGNOSTIC_SCHEMA_VERSION or index_ids != expected_ids:
        raise ValueError(f"Generated diagnostic index failed validation for run dimension {dimension.id}")
    for entry in index["diagnostics"].values():
        relative_path = _artifact_path(entry.get("relative_path"), "diagnostic relative_path")
        if not (generated_dir / relative_path).is_file():
            raise FileNotFoundError(f"Generated diagnostic sidecar is missing: {relative_path}")
    return index_path


def _publish_dimension(
    run: DiagnosticRun,
    dimension: DiagnosticDimension,
    index_path: Path,
    command_runner: CommandRunner,
) -> None:
    report_parent = PurePosixPath(dimension.report_relative_path).parent.as_posix()
    destination = (
        f"gs://{run.bucket}/{run.prefix.rstrip('/')}/{report_parent}/"
        f"_diagnostics/v{DIAGNOSTIC_SCHEMA_VERSION}"
    )
    # The index is the publication boundary: consumers cannot discover partial
    # output because it is copied only after every immutable sidecar succeeds.
    command_runner(
        [
            "gcloud",
            "storage",
            "rsync",
            str(index_path.parent),
            destination,
            "--recursive",
            "--exclude",
            r"(^|/)index\.json$",
            "--cache-control",
            "public,max-age=31536000,immutable",
        ]
    )
    command_runner(
        [
            "gcloud",
            "storage",
            "cp",
            str(index_path),
            f"{destination}/index.json",
            "--cache-control",
            "public,max-age=31536000,immutable",
        ]
    )


def _remote_dimension_is_complete(
    storage: GcsClient,
    run: DiagnosticRun,
    dimension: DiagnosticDimension,
) -> bool:
    """Treat a valid published index as the durable completion boundary."""

    report_parent = PurePosixPath(dimension.report_relative_path).parent.as_posix()
    object_name = (
        f"{run.prefix.rstrip('/')}/{report_parent}/"
        f"_diagnostics/v{DIAGNOSTIC_SCHEMA_VERSION}/index.json"
    )
    index = storage.read_json(run.bucket, object_name)
    if not isinstance(index, Mapping):
        return False
    entries = index.get("diagnostics")
    if (
        index.get("schema_version") != DIAGNOSTIC_SCHEMA_VERSION
        or index.get("dimension") != dimension.dimension
        or not isinstance(entries, Mapping)
        or set(entries) != set(dimension.test_ids)
    ):
        return False
    for entry in entries.values():
        if not isinstance(entry, Mapping):
            return False
        try:
            relative_path = _artifact_path(entry.get("relative_path"), "diagnostic relative_path")
        except ValueError:
            return False
        if (
            PurePosixPath(relative_path).parent
            != PurePosixPath(f"_diagnostics/v{DIAGNOSTIC_SCHEMA_VERSION}")
            or entry.get("schema_version", DIAGNOSTIC_SCHEMA_VERSION)
            != DIAGNOSTIC_SCHEMA_VERSION
        ):
            return False
    return True


def _record_job(
    database: SupabaseRestClient,
    run: DiagnosticRun,
    *,
    started_at: str,
    status: str,
    imported: bool = False,
    error: str | None = None,
) -> None:
    completed_at = _now_expression_payload() if status != "running" else None
    database.upsert_one(
        "ingestion_jobs",
        {
            "source": "github_diagnostic_backfill",
            "source_key": f"{run.github_repository}:{run.github_run_id}:{run.github_run_attempt}",
            "status": status,
            "runs_seen": 1,
            "runs_imported": int(imported),
            "runs_failed": int(error is not None),
            "error_summary": [] if error is None else [{"error": error}],
            "started_at": started_at,
            "completed_at": completed_at,
            "updated_at": completed_at or started_at,
        },
        "source,source_key",
    )


def _verify_run(database: SupabaseRestClient, run: DiagnosticRun) -> None:
    for dimension in run.dimensions:
        rows = _dimension_case_rows(database, dimension.id)
        indexed_ids = {_case_test_id(row) for row in rows}
        if indexed_ids != set(dimension.test_ids):
            raise RuntimeError(f"Indexed cases changed while backfilling run dimension {dimension.id}")
        missing = [
            _case_test_id(row)
            for row in rows
            if not row.get("diagnostic_relative_path")
            or row.get("diagnostic_schema_version") != DIAGNOSTIC_SCHEMA_VERSION
        ]
        if missing:
            raise RuntimeError(
                f"Supabase did not index {len(missing)} diagnostic locator(s) for run dimension {dimension.id}"
            )


def backfill_diagnostics(
    *,
    github_repository: str,
    supabase_url: str,
    supabase_secret_key: str,
    workspace: Path,
    github_run_ids: Sequence[int] = (),
    github_token: str | None = None,
    gcs_access_token: str | None = None,
    dry_run: bool = False,
    command_runner: CommandRunner = _run_checked,
) -> dict[str, Any]:
    """Backfill recoverable diagnostics and idempotently index their locators."""

    database = SupabaseRestClient(supabase_url, supabase_secret_key)
    candidates = discover_diagnostic_runs(
        database,
        github_repository=github_repository,
        github_run_ids=github_run_ids,
    )
    planned_rows = sum(run.missing_count for run in candidates)
    if dry_run:
        return {
            "dry_run": True,
            "runs_selected": len(candidates),
            "case_results_selected": planned_rows,
            "runs_imported": 0,
            "runs_failed": 0,
            "failures": [],
        }

    workspace.mkdir(parents=True, exist_ok=True)
    github = GithubClient(github_repository, github_token or gh_access_token())
    storage = GcsClient(gcs_access_token or gcloud_access_token())
    indexer = BenchmarkIndexer(database, github)
    failures: list[dict[str, Any]] = []
    imported = 0
    indexed_rows = 0
    for position, run in enumerate(candidates, start=1):
        started_at = _now_expression_payload()
        _record_job(database, run, started_at=started_at, status="running")
        try:
            incomplete_dimensions = [
                dimension
                for dimension in run.dimensions
                if not _remote_dimension_is_complete(storage, run, dimension)
            ]
            dataset_dir = (
                _ensure_dataset(run, workspace, command_runner)
                if incomplete_dimensions
                else None
            )
            for dimension in run.dimensions:
                if dimension not in incomplete_dimensions:
                    continue
                assert dataset_dir is not None
                index_path = _generate_dimension(run, dimension, workspace, dataset_dir, command_runner)
                _publish_dimension(run, dimension, index_path, command_runner)

            reader = GcsArtifactReader(storage, run.bucket, run.prefix)
            github_run = github.run_attempt(run.github_run_id, run.github_run_attempt)
            indexer.index_run(github_run, reader)
            _verify_run(database, run)
            _record_job(database, run, started_at=started_at, status="complete", imported=True)
            imported += 1
            indexed_rows += run.missing_count
            print(
                f"Backfilled run {run.github_run_id} attempt {run.github_run_attempt} "
                f"({position}/{len(candidates)}, {run.missing_count} case results)"
            )
        except Exception as error:
            message = str(error)
            failures.append(
                {
                    "github_run_id": run.github_run_id,
                    "github_run_attempt": run.github_run_attempt,
                    "error": message,
                }
            )
            try:
                _record_job(database, run, started_at=started_at, status="partial", error=message)
            except Exception:
                pass
            print(f"Failed to backfill run {run.github_run_id}: {message}")

    result = {
        "dry_run": False,
        "runs_selected": len(candidates),
        "case_results_selected": planned_rows,
        "runs_imported": imported,
        "case_results_imported": indexed_rows,
        "runs_failed": len(failures),
        "failures": failures,
    }
    (workspace / "backfill-result.json").write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return result


def required_environment() -> tuple[str, str]:
    """Read the service-role Supabase credentials used by the CLI adapter."""

    url = os.environ.get("SUPABASE_URL")
    secret_key = os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not secret_key:
        raise ValueError("SUPABASE_URL and SUPABASE_SECRET_KEY are required")
    return url, secret_key
