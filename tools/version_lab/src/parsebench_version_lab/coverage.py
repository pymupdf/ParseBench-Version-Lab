"""Derive benchmark dataset and execution coverage from durable files."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from pathlib import Path, PurePosixPath
from typing import Any

DIMENSIONS = ("chart", "layout", "table", "text_content", "text_formatting")


def inspect_dataset(data_dir: Path) -> dict[str, Any]:
    """Describe the exact corpus represented by a downloaded dataset snapshot."""
    dimension_documents: dict[str, set[str]] = {}
    digest = hashlib.sha256()
    for dimension in DIMENSIONS:
        path = data_dir / f"{dimension}.jsonl"
        documents: set[str] = set()
        payload = path.read_bytes()
        digest.update(path.name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(payload)
        digest.update(b"\0")
        for line_number, line in enumerate(payload.decode("utf-8").splitlines(), 1):
            if not line.strip():
                continue
            value = json.loads(line)
            source = value.get("pdf") if isinstance(value, dict) else None
            if not isinstance(source, str) or not source.strip():
                raise ValueError(f"{path}:{line_number} is missing a source path")
            normalized = PurePosixPath(source.strip())
            if normalized.is_absolute() or ".." in normalized.parts:
                raise ValueError(f"{path}:{line_number} contains an unsafe source path")
            documents.add(normalized.as_posix())
        dimension_documents[dimension] = documents

    all_documents = set().union(*dimension_documents.values())
    return {
        "schema_version": 1,
        "document_count": len(all_documents),
        "dimension_counts": {dimension: len(dimension_documents[dimension]) for dimension in DIMENSIONS},
        "manifest_sha256": digest.hexdigest(),
    }


def execution_coverage(
    *,
    requested_scope: str | None,
    requested_group: str | None,
    dataset_profile: str | None,
    dataset_manifest: Mapping[str, Any],
    summary: Mapping[str, Any],
    categories: Sequence[Mapping[str, Any]],
    conclusion: str = "success",
    artifact_state: str = "complete",
) -> dict[str, Any]:
    """Classify what actually ran by comparing reports with the pinned corpus."""
    expected_counts = {
        str(key): value
        for key, value in dict(dataset_manifest.get("dimension_counts") or {}).items()
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0
    }
    observed_counts = {
        str(category.get("category")): int(category["evaluated_cases"])
        for category in categories
        if isinstance(category.get("category"), str)
        and isinstance(category.get("evaluated_cases"), int)
        and not isinstance(category.get("evaluated_cases"), bool)
        and category["evaluated_cases"] >= 0
    }
    observed_dimensions = set(observed_counts)
    expected_dimensions = set(expected_counts)
    if expected_dimensions and observed_dimensions == expected_dimensions:
        effective_group: str | None = "all"
    elif len(observed_dimensions) == 1:
        effective_group = next(iter(observed_dimensions))
    elif observed_dimensions:
        effective_group = "multiple"
    else:
        effective_group = None

    observed_documents = summary.get("total")
    if not isinstance(observed_documents, int) or isinstance(observed_documents, bool):
        observed_documents = None
    expected_documents = dataset_manifest.get("document_count")
    if not isinstance(expected_documents, int) or isinstance(expected_documents, bool):
        expected_documents = None

    if effective_group == "all":
        reports_complete = observed_counts == expected_counts
        inference_complete = observed_documents == expected_documents
    elif effective_group in expected_counts:
        reports_complete = observed_counts.get(effective_group) == expected_counts[effective_group]
        inference_complete = observed_documents == expected_counts[effective_group]
    else:
        reports_complete = False
        inference_complete = False

    if conclusion != "success":
        coverage_status = "not_run" if observed_documents is None else "partial"
    elif not observed_counts or observed_documents is None or not expected_counts:
        coverage_status = "unknown"
    elif reports_complete and inference_complete:
        coverage_status = "complete"
    else:
        coverage_status = "partial"

    reasons: list[str] = []
    if conclusion != "success":
        reasons.append("workflow_not_successful")
    if artifact_state != "complete":
        reasons.append("artifacts_incomplete")
    if dataset_profile != "full":
        reasons.append("dataset_not_full_profile")
    if not inference_complete:
        reasons.append("document_count_mismatch")
    if not reports_complete:
        reasons.append("dimension_coverage_mismatch")
    eligible = not reasons

    return {
        "schema_version": 2,
        "requested_scope": requested_scope,
        "requested_group": requested_group,
        "effective_scope": dataset_profile,
        "effective_group": effective_group,
        "observed_document_count": observed_documents,
        "observed_dimension_counts": observed_counts,
        "coverage_status": coverage_status,
        "leaderboard_eligible": eligible,
        "eligibility_reasons": reasons,
    }
