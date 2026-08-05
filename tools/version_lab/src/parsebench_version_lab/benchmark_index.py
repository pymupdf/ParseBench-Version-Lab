"""Index Version Lab GitHub runs and ParseBench artifacts in Supabase."""

from __future__ import annotations

import hashlib
import json
import math
import os
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Protocol

from .results import DEFAULT_METRICS

KNOWN_DIMENSIONS = ("chart", "table", "layout", "text_content", "text_formatting")
INGESTION_SCHEMA_VERSION = 1
DEFAULT_BATCH_SIZE = 250
DEFAULT_WORKFLOW = "pymupdf-source-stack-parsebench.yml"


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


class JsonArtifactReader(Protocol):
    artifact_root: str

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
    return {
        "repository": repository,
        "resolved_sha": resolved_sha,
        "requested_ref": dataset.get("requested_ref"),
        "branch": dataset.get("branch"),
        "commit_url": dataset.get("commit_url"),
        "pdf_root_uri": f"hf://datasets/{repository}@{resolved_sha}",
        "ground_truth_root_uri": f"hf://datasets/{repository}@{resolved_sha}",
        "metadata": dataset,
        "updated_at": _now_expression_payload(),
    }


def _primary_metric(dimension: str, metrics: list[dict[str, Any]]) -> tuple[str | None, float | None]:
    values = {
        str(metric.get("metric_name")): _finite_number(metric.get("value"))
        for metric in metrics
        if isinstance(metric.get("metric_name"), str)
    }
    preferred = DEFAULT_METRICS.get(dimension, "rule_pass_rate")
    if values.get(preferred) is not None:
        return preferred, values[preferred]
    for name in sorted(values):
        if values[name] is not None:
            return name, values[name]
    return None, None


def _compact_metric_metadata(value: Any) -> dict[str, Any]:
    metadata = _object(value)
    compact: dict[str, Any] = {}
    for key in ("passed", "total", "score_sum", "score_count", "rule_type", "tp", "fp", "fn"):
        candidate = metadata.get(key)
        if isinstance(candidate, (str, int, float, bool)) or candidate is None:
            compact[key] = candidate
    return compact


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

    def index_run(self, github_run: Mapping[str, Any], reader: JsonArtifactReader | None = None) -> int:
        run_id_value = _coerce_integer(github_run.get("id"))
        if run_id_value is None:
            raise ValueError("GitHub run payload is missing a numeric id")
        run_attempt = _coerce_integer(github_run.get("run_attempt")) or 1
        run_metadata = _artifact_json(reader, "_github_run.json")
        pipeline_name = run_metadata.get("pipeline") or _pipeline_from_run_name(github_run)
        pipeline_metadata = _artifact_json(reader, f"{pipeline_name}/_metadata.json") if pipeline_name else {}
        dataset_id: int | None = None
        if (dataset := _dataset_row(run_metadata)) is not None:
            dataset_record = self.database.upsert_one(
                "dataset_versions", dataset, "repository,resolved_sha"
            )
            dataset_id = int(dataset_record["id"])

        summary = _object(pipeline_metadata.get("summary"))
        inference_errors = _array(summary.get("errors"))
        github_failures = self.github.failed_steps(run_id_value) if github_run.get("conclusion") != "success" else []
        artifact_state = "missing"
        if reader is not None:
            artifact_state = "complete" if github_run.get("conclusion") == "success" else "partial"
        gcs_bucket = run_metadata.get("gcs_bucket")
        gcs_destination = run_metadata.get("gcs_destination")
        gcs_prefix = f"{gcs_destination}/parsebench-output" if isinstance(gcs_destination, str) else None
        run_row = {
            "github_repository": str(github_run.get("repository", {}).get("full_name") or self.github.repository),
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
            "run_scope": run_metadata.get("run_scope"),
            "selected_group": run_metadata.get("group"),
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
            "source_metadata": {"github": dict(github_run), "artifact": run_metadata},
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
        if reader is not None and dataset_id is not None and isinstance(pipeline_name, str):
            self._index_reports(database_run_id, dataset_id, pipeline_name, reader)
        return database_run_id

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

    def _index_errors(
        self, run_id: int, inference_errors: list[Any], github_failures: list[dict[str, Any]]
    ) -> None:
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
        dataset_id: int,
        pipeline_name: str,
        reader: JsonArtifactReader,
    ) -> None:
        for dimension in KNOWN_DIMENSIONS:
            relative_path = f"{pipeline_name}/{dimension}/_evaluation_report.json"
            report = _object(reader.read_json(relative_path))
            if not report:
                continue
            self._index_report(run_id, dataset_id, pipeline_name, dimension, relative_path, report)

    def _index_report(
        self,
        run_id: int,
        dataset_id: int,
        pipeline_name: str,
        dimension: str,
        report_path: str,
        report: Mapping[str, Any],
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
        dimension_record = self.database.upsert_one(
            "run_dimensions", dimension_row, "run_id,dimension"
        )
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
            self.database.upsert_many(
                "run_dimension_metrics", aggregate_rows, "run_dimension_id,metric_name"
            )

        example_rows = [_object(value) for value in _array(report.get("per_example_results"))]
        case_rows: list[dict[str, Any]] = []
        for example in example_rows:
            test_id = example.get("test_id")
            if not isinstance(test_id, str):
                continue
            inference_group = test_id.split("/", 1)[0] if "/" in test_id else None
            pdf_path = f"docs/{test_id}.pdf" if "/" in test_id else None
            case_rows.append(
                {
                    "dataset_version_id": dataset_id,
                    "test_id": test_id,
                    "inference_group": inference_group,
                    "pdf_relative_path": pdf_path,
                    "tags": [str(tag) for tag in _array(example.get("tags"))],
                    "ground_truth_locator": {"dimension": dimension, "test_id": test_id},
                    "metadata": {},
                    "updated_at": _now_expression_payload(),
                }
            )
        case_records = self.database.upsert_many(
            "benchmark_cases", case_rows, "dataset_version_id,test_id"
        )
        case_ids = {str(row["test_id"]): int(row["id"]) for row in case_records}

        result_rows: list[dict[str, Any]] = []
        metrics_by_case_id: dict[int, list[dict[str, Any]]] = {}
        for example in example_rows:
            test_id = example.get("test_id")
            if not isinstance(test_id, str) or test_id not in case_ids:
                continue
            metrics = [_object(metric) for metric in _array(example.get("metrics"))]
            primary_name, primary_score = _primary_metric(dimension, metrics)
            case_id = case_ids[test_id]
            result_rows.append(
                {
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
            )
            metrics_by_case_id[case_id] = metrics
        result_records = self.database.upsert_many(
            "case_results", result_rows, "run_dimension_id,benchmark_case_id"
        )
        metric_rows: list[dict[str, Any]] = []
        for result in result_records:
            case_id = int(result["benchmark_case_id"])
            for metric in metrics_by_case_id.get(case_id, []):
                name = metric.get("metric_name")
                value = _finite_number(metric.get("value"))
                if not isinstance(name, str) or value is None:
                    continue
                metadata = _compact_metric_metadata(metric.get("metadata"))
                metric_rows.append(
                    {
                        "case_result_id": int(result["id"]),
                        "metric_name": name,
                        "metric_value": value,
                        "passed_count": _integer(metadata.get("passed")),
                        "total_count": _integer(metadata.get("total")),
                        "metadata_summary": metadata,
                        "updated_at": _now_expression_payload(),
                    }
                )
        if metric_rows:
            self.database.upsert_many("case_metrics", metric_rows, "case_result_id,metric_name")


def gcloud_access_token() -> str:
    return subprocess.check_output(["gcloud", "auth", "print-access-token"], text=True).strip()


def gh_access_token() -> str:
    configured = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if configured:
        return configured
    return subprocess.check_output(["gh", "auth", "token"], text=True).strip()


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
    return BenchmarkIndexer(database, github).index_run(
        github.run(github_run_id), LocalArtifactReader(output_dir)
    )


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
