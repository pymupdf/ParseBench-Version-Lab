"""Index Version Lab GitHub runs and ParseBench artifacts in Supabase."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Protocol

from .coverage import execution_coverage
from .results import DEFAULT_METRICS, report_dimension

KNOWN_DIMENSIONS = ("chart", "table", "layout", "text_content", "text_formatting")
INGESTION_SCHEMA_VERSION = 4
DEFAULT_BATCH_SIZE = 250
DEFAULT_WORKFLOW = "pymupdf-source-stack-parsebench.yml"
LEGACY_NON_BENCHMARK_RUN_PREFIXES = ("Publish source-stack environment",)
SOURCE_MEDIA_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".jfif": "image/jpeg",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def _now_expression_payload() -> str:
    """Return an ISO timestamp without adding a third-party dependency."""
    from datetime import UTC, datetime

    return datetime.now(UTC).isoformat()


def _finite_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _integer(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _coerce_integer(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _object(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _array(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _chunks(values: list[dict[str, Any]], size: int = DEFAULT_BATCH_SIZE) -> Iterator[list[dict[str, Any]]]:
    for offset in range(0, len(values), size):
        yield values[offset : offset + size]


def _normalized_source_path(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    path = PurePosixPath(value.strip())
    if path.is_absolute() or ".." in path.parts:
        return None
    return path.as_posix()


def _source_media_type(path: str | None, declared: Any = None) -> str | None:
    if path is not None:
        inferred = SOURCE_MEDIA_TYPES.get(PurePosixPath(path).suffix.lower())
        if inferred is not None:
            return inferred
    if isinstance(declared, str) and declared.strip():
        return declared.strip().lower()
    return None


def _next_link(value: str | None) -> str | None:
    if not value:
        return None
    for match in re.finditer(r'<([^>]+)>;\s*rel="([^"]+)"', value):
        if match.group(2) == "next":
            return match.group(1)
    return None


class JsonArtifactReader(Protocol):
    @property
    def artifact_root(self) -> str: ...

    def read_json(self, relative_path: str) -> dict[str, Any] | list[Any] | None: ...


@dataclass(frozen=True)
class LocalArtifactReader:
    root: Path

    @property
    def artifact_root(self) -> str:
        return str(self.root.resolve())

    def read_json(self, relative_path: str) -> dict[str, Any] | list[Any] | None:
        path = self.root / PurePosixPath(relative_path)
        if not path.is_file():
            return None
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, (dict, list)) else None


class GcsClient:
    """Small Cloud Storage JSON API client using an existing OAuth token."""

    def __init__(self, access_token: str) -> None:
        if not access_token:
            raise ValueError("A Google Cloud access token is required")
        self.access_token = access_token

    def _request_json(self, url: str) -> dict[str, Any] | list[Any]:
        request = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.access_token}"})
        with urllib.request.urlopen(request, timeout=120) as response:
            value = json.load(response)
        if not isinstance(value, (dict, list)):
            raise ValueError(f"Expected JSON object or array from {url}")
        return value

    def read_json(self, bucket: str, object_name: str) -> dict[str, Any] | list[Any] | None:
        encoded_bucket = urllib.parse.quote(bucket, safe="")
        encoded_name = urllib.parse.quote(object_name, safe="")
        url = f"https://storage.googleapis.com/download/storage/v1/b/{encoded_bucket}/o/{encoded_name}?alt=media"
        try:
            return self._request_json(url)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            raise

    def list_objects(self, bucket: str, *, suffix: str | None = None) -> Iterator[str]:
        """List bucket objects, optionally retaining only names with a suffix.

        ``matchGlob`` is intentionally used in addition to the client-side suffix
        check. Cloud Storage can return a continuation token after a sparse page,
        so pagination continues until the token is absent even when a page has no
        matching objects.
        """
        page_token: str | None = None
        while True:
            query: dict[str, str] = {
                "fields": "items(name),nextPageToken",
                "maxResults": "1000",
            }
            if suffix:
                query["matchGlob"] = f"**/{suffix.lstrip('/')}"
            if page_token:
                query["pageToken"] = page_token
            encoded_bucket = urllib.parse.quote(bucket, safe="")
            url = f"https://storage.googleapis.com/storage/v1/b/{encoded_bucket}/o?{urllib.parse.urlencode(query)}"
            payload = _object(self._request_json(url))
            for item in _array(payload.get("items")):
                name = _object(item).get("name")
                if isinstance(name, str) and (suffix is None or name.endswith(suffix)):
                    yield name
            token = payload.get("nextPageToken")
            if not isinstance(token, str) or not token:
                break
            page_token = token


@dataclass(frozen=True)
class GcsArtifactReader:
    client: GcsClient
    bucket: str
    prefix: str

    @property
    def artifact_root(self) -> str:
        return f"gs://{self.bucket}/{self.prefix.rstrip('/')}/"

    def read_json(self, relative_path: str) -> dict[str, Any] | list[Any] | None:
        object_name = f"{self.prefix.rstrip('/')}/{relative_path.lstrip('/')}"
        return self.client.read_json(self.bucket, object_name)


class GithubClient:
    def __init__(self, repository: str, token: str) -> None:
        if not token:
            raise ValueError("A GitHub token is required")
        self.repository = repository
        self.token = token

    def _get(self, path: str) -> dict[str, Any]:
        url = f"https://api.github.com/repos/{self.repository}/{path.lstrip('/')}"
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {self.token}",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            return _object(json.load(response))

    def run(self, run_id: int) -> dict[str, Any]:
        return self._get(f"actions/runs/{run_id}")

    def run_attempt(self, run_id: int, attempt: int) -> dict[str, Any]:
        return self._get(f"actions/runs/{run_id}/attempts/{attempt}")

    def runs(self, workflow: str = DEFAULT_WORKFLOW) -> Iterator[dict[str, Any]]:
        page = 1
        workflow_id = urllib.parse.quote(workflow, safe="")
        while True:
            payload = self._get(f"actions/workflows/{workflow_id}/runs?per_page=100&page={page}")
            runs = [_object(value) for value in _array(payload.get("workflow_runs"))]
            yield from runs
            if len(runs) < 100:
                break
            page += 1

    def failed_steps(self, run_id: int) -> list[dict[str, Any]]:
        payload = self._get(f"actions/runs/{run_id}/jobs?filter=all&per_page=100")
        failures: list[dict[str, Any]] = []
        for job_value in _array(payload.get("jobs")):
            job = _object(job_value)
            job_conclusion = job.get("conclusion")
            if job_conclusion not in {"failure", "cancelled", "timed_out", "action_required"}:
                continue
            failed_steps = [
                _object(step)
                for step in _array(job.get("steps"))
                if _object(step).get("conclusion") in {"failure", "cancelled", "timed_out", "action_required"}
            ]
            if failed_steps:
                for step in failed_steps:
                    failures.append(
                        {
                            "stage": str(job.get("name") or "github_actions"),
                            "error_type": f"github_step_{step.get('conclusion')}",
                            "message": f"{job.get('name')}: {step.get('name')} concluded {step.get('conclusion')}",
                            "occurred_at": job.get("completed_at"),
                            "details": {
                                "job_id": job.get("id"),
                                "job_url": job.get("html_url"),
                                "step_number": step.get("number"),
                                "job_conclusion": job_conclusion,
                            },
                        }
                    )
            else:
                failures.append(
                    {
                        "stage": str(job.get("name") or "github_actions"),
                        "error_type": f"github_job_{job_conclusion}",
                        "message": f"{job.get('name')} concluded {job_conclusion}",
                        "occurred_at": job.get("completed_at"),
                        "details": {"job_id": job.get("id"), "job_url": job.get("html_url")},
                    }
                )
        return failures


class SupabaseRestClient:
    def __init__(self, url: str, secret_key: str, *, batch_size: int = DEFAULT_BATCH_SIZE) -> None:
        self.url = url.rstrip("/")
        self.secret_key = secret_key
        self.batch_size = batch_size

    def _request(
        self,
        method: str,
        table: str,
        *,
        query: Mapping[str, str] | None = None,
        payload: Any = None,
        prefer: str | None = None,
    ) -> list[dict[str, Any]]:
        encoded_query = urllib.parse.urlencode(query or {}, safe=",.*()")
        url = f"{self.url}/rest/v1/{table}"
        if encoded_query:
            url += f"?{encoded_query}"
        headers = {
            "apikey": self.secret_key,
            "Authorization": f"Bearer {self.secret_key}",
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        data = None if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                raw = response.read()
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase {method} {table} failed ({error.code}): {detail}") from error
        if not raw:
            return []
        value = json.loads(raw)
        if not isinstance(value, list):
            raise ValueError(f"Expected a list response from Supabase table {table}")
        return [_object(row) for row in value]

    def upsert_one(self, table: str, row: Mapping[str, Any], conflict: str) -> dict[str, Any]:
        rows = self._request(
            "POST",
            table,
            query={"on_conflict": conflict},
            payload=[dict(row)],
            prefer="resolution=merge-duplicates,return=representation",
        )
        if len(rows) != 1:
            raise RuntimeError(f"Expected one returned {table} row, received {len(rows)}")
        return rows[0]

    def select(self, table: str, query: Mapping[str, str]) -> list[dict[str, Any]]:
        return self._request("GET", table, query=query)

    def upsert_many(self, table: str, rows: Iterable[Mapping[str, Any]], conflict: str) -> list[dict[str, Any]]:
        values = [dict(row) for row in rows]
        returned: list[dict[str, Any]] = []
        for batch in _chunks(values, self.batch_size):
            returned.extend(
                self._request(
                    "POST",
                    table,
                    query={"on_conflict": conflict},
                    payload=batch,
                    prefer="resolution=merge-duplicates,return=representation",
                )
            )
        return returned


def _artifact_json(reader: JsonArtifactReader | None, path: str) -> dict[str, Any]:
    if reader is None:
        return {}
    return _object(reader.read_json(path))


def _diagnostic_locators(
    reader: JsonArtifactReader,
    report_path: str,
    dimension: str,
) -> dict[str, tuple[str, int]]:
    """Read safe dashboard schema-v3 diagnostic paths."""
    report_directory = PurePosixPath(report_path).parent
    expected_version = 3
    expected_directory = PurePosixPath("_diagnostics/v3")
    index_path = (report_directory / expected_directory / "index.json").as_posix()
    index = _object(reader.read_json(index_path))
    index_version = _coerce_integer(index.get("schema_version"))
    if index_version != expected_version or index.get("dimension") != dimension:
        return {}

    locators: dict[str, tuple[str, int]] = {}
    for test_id, value in _object(index.get("diagnostics")).items():
        if not test_id:
            continue
        entry = _object(value)
        relative_path = _normalized_source_path(entry.get("relative_path"))
        entry_version = _coerce_integer(entry.get("schema_version"))
        schema_version = index_version if entry_version is None else entry_version
        if relative_path is None or schema_version != expected_version:
            continue
        path = PurePosixPath(relative_path)
        if path.parent != expected_directory or path.suffix != ".json":
            continue
        locators[test_id] = ((report_directory / path).as_posix(), schema_version)
    return locators


def _pipeline_from_run_name(run: Mapping[str, Any]) -> str | None:
    title = run.get("display_title") or run.get("name")
    if not isinstance(title, str):
        return None
    first = title.split(" · ", 1)[0].strip()
    return first if first.startswith("pymupdf") else None


def _dataset_row(metadata: Mapping[str, Any]) -> dict[str, Any] | None:
    dataset = _object(metadata.get("dataset"))
    repository = dataset.get("repository")
    resolved_sha = dataset.get("resolved_sha")
    if not isinstance(repository, str) or not isinstance(resolved_sha, str):
        return None
    manifest = _object(dataset.get("manifest"))
    row = {
        "repository": repository,
        "resolved_sha": resolved_sha,
        "commit_url": dataset.get("commit_url"),
        "pdf_root_uri": f"hf://datasets/{repository}@{resolved_sha}",
        "ground_truth_root_uri": f"hf://datasets/{repository}@{resolved_sha}",
        "updated_at": _now_expression_payload(),
    }
    profile = dataset.get("profile")
    if profile in {"test", "full", "custom"}:
        row["profile"] = profile
        row["branch"] = dataset.get("branch")
        row["metadata"] = {
            "profile": profile,
            "profile_source": dataset.get("profile_source"),
            "manifest": manifest,
        }
        row["provenance"] = {
            "method": dataset.get("profile_source") or "artifact_dataset_metadata",
            "branch": dataset.get("branch"),
        }
    document_count = _integer(manifest.get("document_count"))
    if document_count is not None:
        row["document_count"] = document_count
    dimension_counts = _object(manifest.get("dimension_counts"))
    if dimension_counts:
        row["dimension_counts"] = dimension_counts
    manifest_sha256 = manifest.get("manifest_sha256")
    if isinstance(manifest_sha256, str):
        row["manifest_sha256"] = manifest_sha256
    return row


def _primary_metric(dimension: str, metrics: list[dict[str, Any]]) -> tuple[str | None, float | None]:
    values = {
        str(metric.get("metric_name")): _finite_number(metric.get("value"))
        for metric in metrics
        if isinstance(metric.get("metric_name"), str)
    }
    preferred = DEFAULT_METRICS.get(dimension, "rule_pass_rate")
    if values.get(preferred) is not None:
        return preferred, values[preferred]
    if values.get("rule_pass_rate") is not None:
        return "rule_pass_rate", values["rule_pass_rate"]
    for name in sorted(values):
        if values[name] is not None:
            return name, values[name]
    return None, None


def _error_fingerprint(error: Mapping[str, Any]) -> str:
    stable = json.dumps(
        {
            "stage": error.get("stage"),
            "test_id": error.get("test_id"),
            "error_type": error.get("error_type"),
            "message": error.get("message"),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(stable.encode("utf-8")).hexdigest()


class BenchmarkIndexer:
    def __init__(self, database: SupabaseRestClient, github: GithubClient) -> None:
        self.database = database
        self.github = github
        self._dataset_asset_cache: dict[tuple[str, str], dict[str, str]] = {}

    def _dataset_source_assets(self, repository: str, resolved_sha: str) -> dict[str, str]:
        """Map legacy test ids to exact assets from the run's pinned dataset revision."""
        cache_key = (repository, resolved_sha)
        if cache_key in self._dataset_asset_cache:
            return self._dataset_asset_cache[cache_key]

        encoded_repository = urllib.parse.quote(repository, safe="/")
        encoded_revision = urllib.parse.quote(resolved_sha, safe="")
        url: str | None = (
            f"https://huggingface.co/api/datasets/{encoded_repository}/tree/"
            f"{encoded_revision}?recursive=true&expand=false&limit=1000"
        )
        candidates: dict[str, list[str]] = {}
        headers = {"User-Agent": "parsebench-version-lab/benchmark-index"}
        hub_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
        if hub_token:
            headers["Authorization"] = f"Bearer {hub_token}"

        while url:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = json.load(response)
                if not isinstance(payload, list):
                    raise ValueError(f"Expected a list from Hugging Face dataset tree: {url}")
                for item_value in payload:
                    item = _object(item_value)
                    path = _normalized_source_path(item.get("path"))
                    if item.get("type") != "file" or path is None:
                        continue
                    source_path = PurePosixPath(path)
                    if len(source_path.parts) < 3 or source_path.parts[0] != "docs":
                        continue
                    if source_path.suffix.lower() not in SOURCE_MEDIA_TYPES:
                        continue
                    test_id = PurePosixPath(*source_path.parts[1:]).with_suffix("").as_posix()
                    candidates.setdefault(test_id, []).append(path)
                url = _next_link(response.headers.get("Link"))

        # Never guess if a legacy revision contains two assets with the same test id.
        assets = {test_id: paths[0] for test_id, paths in candidates.items() if len(paths) == 1}
        self._dataset_asset_cache[cache_key] = assets
        return assets

    def index_run(
        self,
        github_run: Mapping[str, Any],
        reader: JsonArtifactReader | None = None,
        *,
        terminal_missing_artifact: bool = False,
    ) -> int:
        run_id_value = _coerce_integer(github_run.get("id"))
        if run_id_value is None:
            raise ValueError("GitHub run payload is missing a numeric id")
        run_attempt = _coerce_integer(github_run.get("run_attempt")) or 1
        github_repository = str(github_run.get("repository", {}).get("full_name") or self.github.repository)
        run_metadata = _artifact_json(reader, "_github_run.json")
        pipeline_name = run_metadata.get("pipeline") or _pipeline_from_run_name(github_run)
        pipeline_metadata = _artifact_json(reader, f"{pipeline_name}/_metadata.json") if pipeline_name else {}
        dataset = _dataset_row(run_metadata)
        dataset_id: int | None = None
        dataset_record: dict[str, Any] = {}
        if dataset is not None:
            dataset_record = self.database.upsert_one("dataset_versions", dataset, "repository,resolved_sha")
            dataset_id = int(dataset_record["id"])
        else:
            try:
                existing_runs = self.database.select(
                    "benchmark_runs",
                    {
                        "select": "dataset_version_id,execution_metadata",
                        "github_repository": f"eq.{github_repository}",
                        "github_run_id": f"eq.{run_id_value}",
                        "github_run_attempt": f"eq.{run_attempt}",
                        "limit": "1",
                    },
                )
            except AttributeError:
                existing_runs = []
            if existing_runs:
                dataset_id = _coerce_integer(existing_runs[0].get("dataset_version_id"))
                if dataset_id is not None:
                    dataset_rows = self.database.select(
                        "dataset_versions",
                        {"select": "*", "id": f"eq.{dataset_id}", "limit": "1"},
                    )
                    dataset_record = dataset_rows[0] if dataset_rows else {}

        summary = _object(pipeline_metadata.get("summary"))
        inference_errors = _array(summary.get("errors"))
        github_failures = self.github.failed_steps(run_id_value) if github_run.get("conclusion") != "success" else []
        artifact_state = "unavailable" if terminal_missing_artifact and reader is None else "missing"
        if reader is not None:
            artifact_state = "complete" if github_run.get("conclusion") == "success" else "partial"
        requested = _object(run_metadata.get("requested"))
        requested_scope = requested.get("scope") or run_metadata.get("requested_scope") or run_metadata.get("run_scope")
        requested_group = requested.get("group") or run_metadata.get("requested_group") or run_metadata.get("group")
        reports = (
            self._artifact_reports(pipeline_name, reader, requested_group)
            if reader is not None and isinstance(pipeline_name, str)
            else []
        )
        execution = _artifact_json(reader, "_execution.json")
        if not execution:
            execution = _object(run_metadata.get("execution"))
        if not execution:
            dataset_manifest = {
                "document_count": dataset_record.get("document_count"),
                "dimension_counts": _object(dataset_record.get("dimension_counts")),
            }
            execution = execution_coverage(
                requested_scope=str(requested_scope) if requested_scope is not None else None,
                requested_group=str(requested_group) if requested_group is not None else None,
                dataset_profile=(
                    str(dataset_record.get("profile")) if dataset_record.get("profile") is not None else None
                ),
                dataset_manifest=dataset_manifest,
                summary=summary,
                categories=[
                    {"category": dimension, "evaluated_cases": _integer(report.get("total_examples"))}
                    for dimension, _path, report in reports
                ],
                conclusion=str(github_run.get("conclusion") or "unknown"),
                artifact_state=artifact_state,
            )
        gcs_bucket = run_metadata.get("gcs_bucket")
        gcs_destination = run_metadata.get("gcs_destination")
        gcs_prefix = f"{gcs_destination}/parsebench-output" if isinstance(gcs_destination, str) else None
        run_row = {
            "github_repository": github_repository,
            "github_workflow_id": github_run.get("workflow_id"),
            "github_workflow_name": github_run.get("name"),
            "github_run_id": run_id_value,
            "github_run_attempt": run_attempt,
            "github_run_url": github_run.get("html_url") or run_metadata.get("github_run_url"),
            "run_name": github_run.get("display_title"),
            "event": github_run.get("event"),
            "status": str(github_run.get("status") or "unknown"),
            "conclusion": github_run.get("conclusion"),
            "artifact_state": artifact_state,
            "pipeline_name": pipeline_name,
            "pipeline_config": _object(_object(pipeline_metadata.get("pipeline")).get("config")),
            "run_scope": execution.get("effective_scope") or run_metadata.get("run_scope"),
            "selected_group": execution.get("effective_group") or run_metadata.get("group"),
            "requested_scope": requested_scope,
            "requested_group": requested_group,
            "effective_scope": execution.get("effective_scope"),
            "effective_group": execution.get("effective_group"),
            "observed_document_count": _integer(execution.get("observed_document_count")),
            "observed_dimension_counts": _object(execution.get("observed_dimension_counts")),
            "coverage_status": execution.get("coverage_status") or "unknown",
            "leaderboard_eligible": bool(execution.get("leaderboard_eligible")),
            "eligibility_reasons": [str(value) for value in _array(execution.get("eligibility_reasons"))],
            "execution_metadata": execution,
            "dataset_version_id": dataset_id,
            "gcs_bucket": gcs_bucket,
            "gcs_prefix": gcs_prefix,
            "head_branch": github_run.get("head_branch"),
            "head_sha": github_run.get("head_sha"),
            "source_created_at": github_run.get("created_at"),
            "source_updated_at": github_run.get("updated_at"),
            "started_at": github_run.get("run_started_at"),
            "completed_at": github_run.get("updated_at") if github_run.get("status") == "completed" else None,
            "summary": summary,
            "error_summary": inference_errors + github_failures,
            "source_metadata": {
                "github": dict(github_run),
                "artifact": run_metadata,
                "execution": execution,
            },
            "ingestion_schema_version": INGESTION_SCHEMA_VERSION,
            "indexed_at": _now_expression_payload(),
            "updated_at": _now_expression_payload(),
        }
        run_record = self.database.upsert_one(
            "benchmark_runs", run_row, "github_repository,github_run_id,github_run_attempt"
        )
        database_run_id = int(run_record["id"])
        self._index_components(database_run_id, run_metadata)
        self._index_errors(database_run_id, inference_errors, github_failures)
        if reader is not None and isinstance(pipeline_name, str):
            self._index_reports(
                database_run_id,
                dataset_id,
                dataset_record or dataset or {},
                pipeline_name,
                reports,
                reader,
            )
        return database_run_id

    def _artifact_reports(
        self,
        pipeline_name: str,
        reader: JsonArtifactReader,
        requested_group: Any,
    ) -> list[tuple[str, str, dict[str, Any]]]:
        reports: list[tuple[str, str, dict[str, Any]]] = []
        for dimension in KNOWN_DIMENSIONS:
            relative_path = f"{pipeline_name}/{dimension}/_evaluation_report.json"
            report = _object(reader.read_json(relative_path))
            if report:
                reports.append((dimension, relative_path, report))
        root_path = f"{pipeline_name}/_evaluation_report.json"
        root_report = _object(reader.read_json(root_path))
        if root_report:
            fallback = str(requested_group) if requested_group in KNOWN_DIMENSIONS else None
            resolved_dimension = report_dimension(root_report, fallback)
            if resolved_dimension in KNOWN_DIMENSIONS and not any(value[0] == resolved_dimension for value in reports):
                reports.append((resolved_dimension, root_path, root_report))
        return reports

    def _index_components(self, run_id: int, metadata: Mapping[str, Any]) -> None:
        source_stack = _object(metadata.get("source_stack"))
        sources = _object(source_stack.get("sources"))
        installed = _object(source_stack.get("installed_versions"))
        rows: list[dict[str, Any]] = []
        for component, source_value in sources.items():
            source = _object(source_value)
            rows.append(
                {
                    "run_id": run_id,
                    "component": component,
                    "repository": source.get("repository"),
                    "requested_ref": source.get("requested_ref"),
                    "resolved_sha": source.get("resolved_sha"),
                    "installed_version": installed.get(component),
                    "metadata": source,
                    "updated_at": _now_expression_payload(),
                }
            )
        if rows:
            self.database.upsert_many("run_components", rows, "run_id,component")

    def _index_errors(self, run_id: int, inference_errors: list[Any], github_failures: list[dict[str, Any]]) -> None:
        errors: list[dict[str, Any]] = list(github_failures)
        for value in inference_errors:
            error = _object(value)
            errors.append(
                {
                    "stage": "inference",
                    "test_id": error.get("example_id"),
                    "error_type": _object(error.get("error")).get("error_type"),
                    "message": str(_object(error.get("error")).get("message") or error.get("error") or "Unknown error"),
                    "occurred_at": error.get("timestamp"),
                    "details": error,
                }
            )
        rows = []
        for error in errors:
            normalized = {
                "run_id": run_id,
                "stage": str(error.get("stage") or "unknown"),
                "test_id": error.get("test_id"),
                "error_type": error.get("error_type"),
                "message": str(error.get("message") or "Unknown error"),
                "details": _object(error.get("details")),
                "occurred_at": error.get("occurred_at"),
                "updated_at": _now_expression_payload(),
            }
            normalized["error_fingerprint"] = _error_fingerprint(normalized)
            rows.append(normalized)
        if rows:
            self.database.upsert_many("run_errors", rows, "run_id,error_fingerprint")

    def _index_reports(
        self,
        run_id: int,
        dataset_id: int | None,
        dataset: Mapping[str, Any],
        pipeline_name: str,
        reports: list[tuple[str, str, dict[str, Any]]],
        reader: JsonArtifactReader,
    ) -> None:
        for dimension, relative_path, report in reports:
            self._index_report(
                run_id,
                dataset_id,
                dataset,
                pipeline_name,
                dimension,
                relative_path,
                report,
                reader,
            )

    def _index_report(
        self,
        run_id: int,
        dataset_id: int | None,
        dataset: Mapping[str, Any],
        pipeline_name: str,
        dimension: str,
        report_path: str,
        report: Mapping[str, Any],
        reader: JsonArtifactReader,
    ) -> None:
        failed_count = _integer(report.get("failed")) or 0
        dimension_row = {
            "run_id": run_id,
            "dimension": dimension,
            "status": "failed" if failed_count and not report.get("successful") else "complete",
            "total_examples": _integer(report.get("total_examples")),
            "successful": _integer(report.get("successful")),
            "failed": _integer(report.get("failed")),
            "skipped": _integer(report.get("skipped")),
            "report_relative_path": report_path,
            "aggregate_stats": _object(report.get("aggregate_stats")),
            "error_summary": [],
            "updated_at": _now_expression_payload(),
        }
        dimension_record = self.database.upsert_one("run_dimensions", dimension_row, "run_id,dimension")
        run_dimension_id = int(dimension_record["id"])
        aggregate_rows = []
        for name, value in _object(report.get("aggregate_metrics")).items():
            if (number := _finite_number(value)) is not None:
                aggregate_rows.append(
                    {
                        "run_dimension_id": run_dimension_id,
                        "metric_name": name,
                        "metric_value": number,
                        "updated_at": _now_expression_payload(),
                    }
                )
        if aggregate_rows:
            self.database.upsert_many("run_dimension_metrics", aggregate_rows, "run_dimension_id,metric_name")

        if dataset_id is None:
            return

        example_rows = [_object(value) for value in _array(report.get("per_example_results"))]
        diagnostic_locators = _diagnostic_locators(reader, report_path, dimension)
        expected_diagnostic_ids = [
            test_id for example in example_rows if isinstance((test_id := example.get("test_id")), str) and test_id
        ]
        if len(expected_diagnostic_ids) != len(example_rows) or len(expected_diagnostic_ids) != len(
            set(expected_diagnostic_ids)
        ):
            raise ValueError(f"Report {report_path} contains missing or duplicate benchmark test IDs")
        if set(diagnostic_locators) != set(expected_diagnostic_ids):
            missing = sorted(set(expected_diagnostic_ids) - set(diagnostic_locators))[:5]
            extra = sorted(set(diagnostic_locators) - set(expected_diagnostic_ids))[:5]
            raise ValueError(
                f"Dashboard schema-v3 diagnostics are incomplete for {report_path}; "
                f"missing={missing!r}, extra={extra!r}"
            )
        legacy_assets: dict[str, str] | None = None
        case_rows: list[dict[str, Any]] = []
        for example in example_rows:
            test_id = example.get("test_id")
            if not isinstance(test_id, str):
                continue
            inference_group = test_id.split("/", 1)[0] if "/" in test_id else None
            source_path = _normalized_source_path(example.get("source_relative_path"))
            if source_path is None:
                repository = dataset.get("repository")
                resolved_sha = dataset.get("resolved_sha")
                if isinstance(repository, str) and isinstance(resolved_sha, str):
                    if legacy_assets is None:
                        legacy_assets = self._dataset_source_assets(repository, resolved_sha)
                    source_path = legacy_assets.get(test_id)
            source_media_type = _source_media_type(source_path, example.get("source_media_type"))
            pdf_path = source_path if source_media_type == "application/pdf" else None
            case_rows.append(
                {
                    "dataset_version_id": dataset_id,
                    "test_id": test_id,
                    "inference_group": inference_group,
                    "pdf_relative_path": pdf_path,
                    "source_relative_path": source_path,
                    "source_media_type": source_media_type,
                    "tags": [str(tag) for tag in _array(example.get("tags"))],
                    "ground_truth_locator": {"dimension": dimension, "test_id": test_id},
                    "metadata": {},
                    "updated_at": _now_expression_payload(),
                }
            )
        case_records = self.database.upsert_many("benchmark_cases", case_rows, "dataset_version_id,test_id")
        case_ids = {str(row["test_id"]): int(row["id"]) for row in case_records}

        result_rows: list[dict[str, Any]] = []
        result_rows_by_case_id: dict[int, dict[str, Any]] = {}
        diagnostic_by_case_id: dict[int, tuple[str, int]] = {}
        for example in example_rows:
            test_id = example.get("test_id")
            if not isinstance(test_id, str) or test_id not in case_ids:
                continue
            metrics = [_object(metric) for metric in _array(example.get("metrics"))]
            primary_name, primary_score = _primary_metric(dimension, metrics)
            case_id = case_ids[test_id]
            diagnostic = diagnostic_locators.get(test_id)
            if diagnostic is not None:
                diagnostic_by_case_id[case_id] = diagnostic
            result_row = {
                "run_dimension_id": run_dimension_id,
                "benchmark_case_id": case_id,
                "success": bool(example.get("success")),
                "error": example.get("error"),
                "primary_metric_name": primary_name,
                "primary_score": primary_score,
                "raw_relative_path": f"{pipeline_name}/{test_id}.raw.json",
                "result_relative_path": f"{pipeline_name}/{test_id}.result.json",
                "evaluated_at": example.get("evaluated_at"),
                "job_id": example.get("job_id"),
                "parse_job_id": example.get("parse_job_id"),
                "tags": [str(tag) for tag in _array(example.get("tags"))],
                "stats": {
                    str(stat.get("name")): {"value": stat.get("value"), "unit": stat.get("unit")}
                    for stat in (_object(value) for value in _array(example.get("stats")))
                    if isinstance(stat.get("name"), str)
                },
                "updated_at": _now_expression_payload(),
            }
            result_rows.append(result_row)
            result_rows_by_case_id[case_id] = result_row
        # First merge ordinary result data without locator columns. PostgREST's
        # merge-duplicates behavior preserves any locator already in Supabase,
        # and return=representation gives us that current schema. Apply artifact
        # locators in a second merge only when they are a monotonic upgrade.
        result_records = self.database.upsert_many("case_results", result_rows, "run_dimension_id,benchmark_case_id")
        locator_updates: list[dict[str, Any]] = []
        for result_record in result_records:
            case_id = int(result_record["benchmark_case_id"])
            diagnostic = diagnostic_by_case_id.get(case_id)
            if diagnostic is None:
                continue
            diagnostic_path, diagnostic_schema_version = diagnostic
            existing_schema_version = _integer(result_record.get("diagnostic_schema_version"))
            existing_path = result_record.get("diagnostic_relative_path")
            has_existing_locator = isinstance(existing_path, str) and bool(existing_path.strip())
            if existing_schema_version is not None and (
                existing_schema_version > diagnostic_schema_version
                or (existing_schema_version == diagnostic_schema_version and has_existing_locator)
            ):
                continue
            locator_updates.append(
                {
                    # A PostgREST upsert still validates the proposed INSERT
                    # before resolving its conflict. Repeat every required base
                    # column so the upgrade row is valid on either path.
                    **result_rows_by_case_id[case_id],
                    "diagnostic_relative_path": diagnostic_path,
                    "diagnostic_schema_version": diagnostic_schema_version,
                }
            )
        if locator_updates:
            self.database.upsert_many(
                "case_results",
                locator_updates,
                "run_dimension_id,benchmark_case_id",
            )


def gcloud_access_token() -> str:
    return subprocess.check_output(["gcloud", "auth", "print-access-token"], text=True).strip()


def gh_access_token() -> str:
    configured = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if configured:
        return configured
    return subprocess.check_output(["gh", "auth", "token"], text=True).strip()


def validate_workflow_run(run: Mapping[str, Any], workflow: str) -> None:
    expected_path = workflow if workflow.startswith(".github/") else f".github/workflows/{workflow}"
    if run.get("path") != expected_path:
        raise ValueError(f"GitHub run {run.get('id')} belongs to {run.get('path')!r}, expected {expected_path!r}")
    if run.get("status") != "completed":
        raise ValueError(f"GitHub run {run.get('id')} is {run.get('status')!r}, expected 'completed'")


def parse_ingestion_source_key(value: Any) -> tuple[str, int, int] | None:
    if not isinstance(value, str):
        return None
    parts = value.rsplit(":", 2)
    if len(parts) != 3:
        return None
    repository, run_id, run_attempt = parts
    parsed_run_id = _coerce_integer(run_id)
    parsed_attempt = _coerce_integer(run_attempt)
    if parsed_run_id is None or parsed_attempt is None:
        return None
    return repository, parsed_run_id, parsed_attempt


def _run_key(run: Mapping[str, Any]) -> tuple[int, int] | None:
    run_id = _coerce_integer(run.get("id"))
    if run_id is None:
        return None
    return run_id, _coerce_integer(run.get("run_attempt")) or 1


def _missing_artifact_is_terminal(run: Mapping[str, Any]) -> bool:
    """Return whether an artifact-less completed run can never become a benchmark result."""
    conclusion = str(run.get("conclusion") or "")
    if conclusion and conclusion != "success":
        return True
    title = str(run.get("display_title") or run.get("name") or "")
    return title.startswith(LEGACY_NON_BENCHMARK_RUN_PREFIXES)


@dataclass(frozen=True)
class IngestionJob:
    database: SupabaseRestClient
    source_key: str
    started_at: str

    @classmethod
    def start(
        cls,
        database: SupabaseRestClient,
        repository: str,
        run: Mapping[str, Any],
    ) -> IngestionJob:
        key = _run_key(run)
        if key is None:
            raise ValueError("GitHub run payload is missing a numeric id")
        job = cls(database, f"{repository}:{key[0]}:{key[1]}", _now_expression_payload())
        job._record("running")
        return job

    def finish(self, *, imported: bool, error: str | None = None) -> None:
        self._record("complete" if imported else "partial", imported=imported, error=error)

    def exclude(self, reason: str) -> None:
        self._record("complete", note={"disposition": "excluded", "reason": reason})

    def _record(
        self,
        status: str,
        *,
        imported: bool = False,
        error: str | None = None,
        note: Mapping[str, Any] | None = None,
    ) -> None:
        completed_at = _now_expression_payload() if status != "running" else None
        self.database.upsert_one(
            "ingestion_jobs",
            {
                "source": "github_run",
                "source_key": self.source_key,
                "status": status,
                "runs_seen": 1,
                "runs_imported": int(imported),
                "runs_failed": int(error is not None),
                "error_summary": ([dict(note)] if note is not None else ([] if error is None else [{"error": error}])),
                "started_at": self.started_at,
                "completed_at": completed_at,
                "updated_at": completed_at or self.started_at,
            },
            "source,source_key",
        )

    def try_record_failure(self, error: Exception) -> None:
        try:
            self.finish(imported=False, error=str(error))
        except Exception:
            pass


@dataclass(frozen=True)
class ReconciliationState:
    cursor: tuple[int, int] | None
    indexed_artifacts: dict[tuple[int, int], str]
    incomplete_runs: set[tuple[int, int]]

    def needs_indexing(self, key: tuple[int, int]) -> bool:
        return (
            key not in self.indexed_artifacts or self.indexed_artifacts[key] == "missing" or key in self.incomplete_runs
        )


def _load_reconciliation_state(
    database: SupabaseRestClient,
    repository: str,
    source_key: str,
    lookback: int,
) -> ReconciliationState:
    checkpoint_rows = database.select(
        "ingestion_jobs",
        {
            "select": "checkpoint",
            "source": "eq.github_reconciliation",
            "source_key": f"eq.{source_key}",
            "limit": "1",
        },
    )
    checkpoint = _object(checkpoint_rows[0].get("checkpoint")) if checkpoint_rows else {}
    indexed_rows = database.select(
        "benchmark_runs",
        {
            "select": "github_run_id,github_run_attempt,artifact_state",
            "github_repository": f"eq.{repository}",
            "order": "github_run_id.desc",
            "limit": str(lookback),
        },
    )
    indexed_artifacts: dict[tuple[int, int], str] = {}
    for row in indexed_rows:
        key = _run_key({"id": row.get("github_run_id"), "run_attempt": row.get("github_run_attempt")})
        if key is not None:
            indexed_artifacts[key] = str(row.get("artifact_state") or "")
    incomplete_rows = database.select(
        "ingestion_jobs",
        {
            "select": "source_key",
            "source": "eq.github_run",
            "source_key": f"like.{repository}:*",
            "status": "neq.complete",
            "order": "updated_at.desc",
            "limit": str(lookback),
        },
    )
    incomplete_runs = {
        (parsed[1], parsed[2])
        for row in incomplete_rows
        if (parsed := parse_ingestion_source_key(row.get("source_key"))) is not None and parsed[0] == repository
    }
    cursor_run_id = _coerce_integer(checkpoint.get("github_run_id"))
    return ReconciliationState(
        cursor=(
            (cursor_run_id, _coerce_integer(checkpoint.get("github_run_attempt")) or 1)
            if cursor_run_id is not None
            else None
        ),
        indexed_artifacts=indexed_artifacts,
        incomplete_runs=incomplete_runs,
    )


def _workflow_runs_to_reconcile(
    github: GithubClient,
    workflow: str,
    cursor_run_id: int | None,
    lookback: int,
) -> tuple[dict[tuple[int, int], dict[str, Any]], tuple[int, int] | None]:
    runs: dict[tuple[int, int], dict[str, Any]] = {}
    newest: tuple[int, int] | None = None
    completed_seen = 0
    for run in github.runs(workflow):
        key = _run_key(run)
        if key is None:
            continue
        run_id, _attempt = key
        if cursor_run_id is not None and run_id <= cursor_run_id and completed_seen >= lookback:
            break
        if run.get("status") != "completed":
            continue
        validate_workflow_run(run, workflow)
        newest = newest or key
        if completed_seen < lookback or cursor_run_id is None or run_id > cursor_run_id:
            runs[key] = run
        completed_seen += 1
        if cursor_run_id is None and completed_seen >= lookback:
            break
    return runs, newest


def download_github_artifact(
    *,
    repository: str,
    github_token: str,
    run_id: int,
    attempt: int,
    destination: Path,
) -> tuple[LocalArtifactReader | None, str | None]:
    artifact_name = f"pymupdf-source-stack-{run_id}-{attempt}"
    environment = os.environ.copy()
    environment["GH_TOKEN"] = github_token
    result = subprocess.run(
        [
            "gh",
            "run",
            "download",
            str(run_id),
            "--repo",
            repository,
            "--name",
            artifact_name,
            "--dir",
            str(destination),
        ],
        capture_output=True,
        env=environment,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        return None, detail or f"gh run download exited {result.returncode}"
    if not destination.is_dir() or not any(path.is_file() for path in destination.rglob("*")):
        return None, f"GitHub artifact {artifact_name} was empty"
    return LocalArtifactReader(destination), None


def gcs_reader_for_run(
    client: GcsClient,
    bucket: str,
    run_id: int,
    attempt: int,
) -> GcsArtifactReader | None:
    manifest_suffix = f"run-{run_id}-attempt-{attempt}/parsebench-output/_github_run.json"
    manifests = sorted(client.list_objects(bucket, suffix=manifest_suffix))
    if not manifests:
        return None
    if len(manifests) > 1:
        raise RuntimeError(f"Found multiple GCS manifests for GitHub run {run_id} attempt {attempt}: {len(manifests)}")
    prefix = manifests[0].removesuffix("/_github_run.json")
    return GcsArtifactReader(client, bucket, prefix)


def reconcile_repository(
    *,
    github_repository: str,
    bucket: str,
    supabase_url: str,
    supabase_secret_key: str,
    github_token: str | None = None,
    gcs_access_token: str | None = None,
    workflow: str = DEFAULT_WORKFLOW,
    lookback: int = 100,
) -> dict[str, Any]:
    """Re-index recent missing runs, preferring GitHub artifacts over GCS.

    A durable per-workflow cursor makes the forward scan incremental. A bounded
    lookback still catches recent reruns, while incomplete ingestion jobs are
    retried independently even after they fall outside that window.
    """
    token = github_token or gh_access_token()
    github = GithubClient(github_repository, token)
    database = SupabaseRestClient(supabase_url, supabase_secret_key)
    reconciliation_started = _now_expression_payload()
    reconciliation_key = f"{github_repository}:{workflow}"
    state = _load_reconciliation_state(database, github_repository, reconciliation_key, lookback)
    runs_by_key, newest = _workflow_runs_to_reconcile(
        github, workflow, state.cursor[0] if state.cursor else None, lookback
    )

    failures: list[dict[str, Any]] = []
    for run_id, attempt in state.incomplete_runs:
        key = (run_id, attempt)
        if key in runs_by_key:
            continue
        try:
            run = github.run_attempt(run_id, attempt)
            validate_workflow_run(run, workflow)
            runs_by_key[key] = run
        except Exception as error:
            failures.append({"github_run_id": run_id, "attempt": attempt, "error": str(error)})

    candidates = [(run, *key) for key, run in runs_by_key.items() if state.needs_indexing(key)]

    imported = 0
    excluded = 0
    storage: GcsClient | None = None
    indexer = BenchmarkIndexer(database, github)
    for run, run_id, attempt in reversed(candidates):
        ingestion = IngestionJob.start(database, github_repository, run)
        try:
            with tempfile.TemporaryDirectory(prefix="parsebench-index-") as temporary:
                downloaded_reader, artifact_error = download_github_artifact(
                    repository=github_repository,
                    github_token=token,
                    run_id=run_id,
                    attempt=attempt,
                    destination=Path(temporary),
                )
                reader: JsonArtifactReader | None = downloaded_reader
                source = "github_artifact"
                if reader is None:
                    if storage is None:
                        storage = GcsClient(gcs_access_token or gcloud_access_token())
                    reader = gcs_reader_for_run(storage, bucket, run_id, attempt)
                    source = "gcs"
                missing_error = artifact_error or "No GitHub artifact or GCS manifest was available"
                terminal_missing = reader is None and _missing_artifact_is_terminal(run)
                if terminal_missing:
                    indexer.index_run(run, reader, terminal_missing_artifact=True)
                else:
                    indexer.index_run(run, reader)
            if reader is None:
                if terminal_missing:
                    ingestion.exclude(missing_error)
                    excluded += 1
                    print(
                        f"Excluded GitHub run {run_id} attempt {attempt}: "
                        f"the completed run has no recoverable benchmark artifact"
                    )
                    continue
                ingestion.finish(imported=False, error=missing_error)
                failures.append({"github_run_id": run_id, "attempt": attempt, "error": missing_error})
                continue
            imported += 1
            ingestion.finish(imported=True)
            print(f"Indexed GitHub run {run_id} attempt {attempt} from {source}")
        except Exception as error:
            message = str(error)
            ingestion.try_record_failure(error)
            failures.append({"github_run_id": run_id, "attempt": attempt, "error": message})
            print(f"Failed to reconcile GitHub run {run_id} attempt {attempt}: {message}")

    cursor = newest or state.cursor
    completed_at = _now_expression_payload()
    database.upsert_one(
        "ingestion_jobs",
        {
            "source": "github_reconciliation",
            "source_key": reconciliation_key,
            "status": "partial" if failures else "complete",
            "runs_seen": len(runs_by_key),
            "runs_imported": imported,
            "runs_failed": len(failures),
            "error_summary": failures,
            "checkpoint": ({} if cursor is None else {"github_run_id": cursor[0], "github_run_attempt": cursor[1]}),
            "started_at": reconciliation_started,
            "completed_at": completed_at,
            "updated_at": completed_at,
        },
        "source,source_key",
    )
    return {
        "cursor_github_run_id": cursor[0] if cursor else None,
        "runs_examined": len(runs_by_key),
        "runs_selected": len(candidates),
        "runs_imported": imported,
        "runs_excluded": excluded,
        "runs_failed": len(failures),
        "failures": failures,
    }


def discover_gcs_readers(
    client: GcsClient,
    bucket: str,
    *,
    inventory_path: Path | None = None,
) -> dict[tuple[int, int], GcsArtifactReader]:
    readers: dict[tuple[int, int], GcsArtifactReader] = {}
    inventory: list[dict[str, Any]] = []
    for object_name in client.list_objects(bucket, suffix="_github_run.json"):
        metadata = _object(client.read_json(bucket, object_name))
        run_id = _coerce_integer(metadata.get("github_run_id"))
        attempt = _coerce_integer(metadata.get("github_run_attempt")) or 1
        if run_id is None:
            continue
        prefix = object_name.removesuffix("/_github_run.json")
        readers[(run_id, attempt)] = GcsArtifactReader(client, bucket, prefix)
        inventory.append(
            {
                "github_run_id": run_id,
                "github_run_attempt": attempt,
                "bucket": bucket,
                "artifact_prefix": prefix,
                "manifest_object": object_name,
            }
        )
    if inventory_path is not None:
        inventory_path.parent.mkdir(parents=True, exist_ok=True)
        inventory_path.write_text(
            json.dumps(
                {
                    "bucket": bucket,
                    "generated_at": _now_expression_payload(),
                    "run_count": len(inventory),
                    "runs": sorted(inventory, key=lambda item: (item["github_run_id"], item["github_run_attempt"])),
                },
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
    return readers


def index_current_run(
    *,
    output_dir: Path,
    github_repository: str,
    github_run_id: int,
    supabase_url: str,
    supabase_secret_key: str,
    github_token: str,
) -> int:
    github = GithubClient(github_repository, github_token)
    database = SupabaseRestClient(supabase_url, supabase_secret_key)
    return BenchmarkIndexer(database, github).index_run(github.run(github_run_id), LocalArtifactReader(output_dir))


def backfill_repository(
    *,
    github_repository: str,
    bucket: str,
    supabase_url: str,
    supabase_secret_key: str,
    github_token: str | None = None,
    gcs_access_token: str | None = None,
    workspace: Path | None = None,
    workflow: str = DEFAULT_WORKFLOW,
) -> dict[str, Any]:
    github = GithubClient(github_repository, github_token or gh_access_token())
    database = SupabaseRestClient(supabase_url, supabase_secret_key)
    storage = GcsClient(gcs_access_token or gcloud_access_token())
    inventory_path = (workspace / "gcs-run-inventory.json") if workspace is not None else None
    readers = discover_gcs_readers(storage, bucket, inventory_path=inventory_path)
    source_key = f"{github_repository}:{workflow}:{bucket}"
    started = _now_expression_payload()
    database.upsert_one(
        "ingestion_jobs",
        {
            "source": "github_gcs_backfill",
            "source_key": source_key,
            "status": "running",
            "runs_seen": 0,
            "runs_imported": 0,
            "runs_failed": 0,
            "error_summary": [],
            "started_at": started,
            "completed_at": None,
            "updated_at": started,
        },
        "source,source_key",
    )
    runs = list(github.runs(workflow))
    failures: list[dict[str, Any]] = []
    imported = 0
    indexer = BenchmarkIndexer(database, github)
    total_runs = len(runs)
    for position, run in enumerate(sorted(runs, key=lambda value: int(value.get("id") or 0)), start=1):
        run_id = _coerce_integer(run.get("id"))
        if run_id is None:
            continue
        attempt = _coerce_integer(run.get("run_attempt")) or 1
        try:
            indexer.index_run(run, readers.get((run_id, attempt)))
            imported += 1
        except Exception as error:
            failures.append({"github_run_id": run_id, "attempt": attempt, "error": str(error)})
            print(f"Failed to index GitHub run {run_id} attempt {attempt}: {error}")
        if position % 10 == 0 or position == total_runs:
            print(f"Indexed {position}/{total_runs} GitHub runs ({len(failures)} failures)")
    completed = _now_expression_payload()
    database.upsert_one(
        "ingestion_jobs",
        {
            "source": "github_gcs_backfill",
            "source_key": source_key,
            "status": "complete" if not failures else "partial",
            "runs_seen": len(runs),
            "runs_imported": imported,
            "runs_failed": len(failures),
            "error_summary": failures,
            "started_at": started,
            "completed_at": completed,
            "updated_at": completed,
        },
        "source,source_key",
    )
    result = {
        "runs_seen": len(runs),
        "runs_imported": imported,
        "runs_failed": len(failures),
        "gcs_artifact_runs": len(readers),
        "failures": failures,
    }
    if workspace is not None:
        workspace.mkdir(parents=True, exist_ok=True)
        (workspace / "backfill-result.json").write_text(
            json.dumps(result, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    return result
