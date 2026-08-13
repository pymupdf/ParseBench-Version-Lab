"""Upgrade evaluator diagnostics into the dashboard-owned schema.

The evaluator's schema-v2 sidecars are immutable evidence.  Version Lab adds
presentation semantics in a new versioned tree instead of rewriting that
evidence or changing benchmark scores.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from collections.abc import Mapping, Sequence
from copy import deepcopy
from pathlib import Path, PurePosixPath
from typing import Any

from .benchmark_index import JsonArtifactReader, LocalArtifactReader

DASHBOARD_DIAGNOSTIC_SCHEMA_VERSION = 3
SOURCE_DIAGNOSTIC_SCHEMA_VERSION = 2
DASHBOARD_DIAGNOSTIC_DIRECTORY = f"_diagnostics/v{DASHBOARD_DIAGNOSTIC_SCHEMA_VERSION}"
SOURCE_DIAGNOSTIC_DIRECTORY = f"_diagnostics/v{SOURCE_DIAGNOSTIC_SCHEMA_VERSION}"


def _object(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _array(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _evaluation_kind(diagnostic: Mapping[str, Any]) -> str:
    dimension = diagnostic.get("dimension")
    if dimension == "layout":
        primary_name = _object(diagnostic.get("primary_metric")).get("name")
        if primary_name == "layout_element_rule_pass_rate":
            return "layout_elements"
        expectation_types = {
            expectation.get("type")
            for expectation in (_object(value) for value in _array(diagnostic.get("expectations")))
        }
        has_layout_expectations = "layout" in expectation_types
        has_rule_expectations = any(value != "layout" for value in expectation_types)
        if has_layout_expectations and has_rule_expectations:
            return "layout_mixed"
        if has_rule_expectations:
            return "layout_order"
        return "layout_rules"
    return {
        "chart": "chart_rules",
        "table": "table_comparison",
        "text_content": "text_content",
        "text_formatting": "text_formatting",
    }.get(str(dimension), "rules")


def _summary_metric_name(summary: Mapping[str, Any]) -> str | None:
    source = summary.get("source")
    if not isinstance(source, str) or not source:
        return None
    name, separator, _suffix = source.partition(".")
    return name if separator and name else None


def _headline_contribution(
    primary: Mapping[str, Any],
    summary_metric_name: str | None,
) -> dict[str, Any]:
    primary_name = primary.get("name")
    contribution: dict[str, Any] = {
        "primary_metric_name": primary_name if isinstance(primary_name, str) else None,
        "kind": "diagnostic",
        "contributes": False,
        "weight": None,
        "normalized_weight": None,
    }
    if summary_metric_name is None or not isinstance(primary_name, str):
        return contribution
    if summary_metric_name == primary_name:
        contribution.update(
            {
                "kind": "primary",
                "contributes": True,
                "weight": 1.0,
                "normalized_weight": 1.0,
            }
        )
        return contribution

    formula = _object(primary.get("formula"))
    components = [_object(value) for value in _array(formula.get("components"))]
    component = next(
        (
            value
            for value in components
            if value.get("metric_name") == summary_metric_name or value.get("name") == summary_metric_name
        ),
        None,
    )
    if component is None:
        return contribution
    weight = _number(component.get("weight"))
    weight_sum = _number(formula.get("weight_sum"))
    contribution.update(
        {
            "kind": "component",
            "contributes": True,
            "weight": weight,
            "normalized_weight": weight / weight_sum if weight is not None and weight_sum else None,
        }
    )
    return contribution


def transform_v2_diagnostic(
    diagnostic: Mapping[str, Any],
    *,
    dimension: str,
) -> dict[str, Any]:
    """Return dashboard schema v3 without changing schema-v2 evidence."""

    if diagnostic.get("schema_version") != SOURCE_DIAGNOSTIC_SCHEMA_VERSION:
        raise ValueError("Dashboard diagnostic upgrade requires a schema-v2 source")
    if diagnostic.get("dimension") != dimension:
        raise ValueError(f"Diagnostic dimension {diagnostic.get('dimension')!r} does not match {dimension!r}")
    if not isinstance(diagnostic.get("test_id"), str) or not diagnostic.get("test_id"):
        raise ValueError("Diagnostic test_id must be a non-empty string")

    upgraded = deepcopy(dict(diagnostic))
    upgraded["schema_version"] = DASHBOARD_DIAGNOSTIC_SCHEMA_VERSION
    upgraded["evaluation_kind"] = _evaluation_kind(diagnostic)

    summary = _object(upgraded.get("summary"))
    metric_name = _summary_metric_name(summary)
    summary["headline_contribution"] = _headline_contribution(
        _object(diagnostic.get("primary_metric")),
        metric_name,
    )
    upgraded["summary"] = summary
    return upgraded


def _safe_v2_entry(value: Any) -> tuple[str, int] | None:
    entry = _object(value)
    relative_path = entry.get("relative_path")
    version = entry.get("schema_version", SOURCE_DIAGNOSTIC_SCHEMA_VERSION)
    if not isinstance(relative_path, str) or version != SOURCE_DIAGNOSTIC_SCHEMA_VERSION:
        return None
    path = PurePosixPath(relative_path)
    if path.is_absolute() or ".." in path.parts:
        return None
    if path.parent != PurePosixPath(SOURCE_DIAGNOSTIC_DIRECTORY) or path.suffix != ".json":
        return None
    return path.as_posix(), version


def _write_json(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def write_dashboard_diagnostics(
    reader: JsonArtifactReader,
    report_relative_path: str,
    *,
    dimension: str,
    expected_test_ids: Sequence[str],
    output_root: Path,
) -> Path:
    """Transform a complete immutable v2 dimension tree into schema v3."""

    report_parent = PurePosixPath(report_relative_path).parent
    source_index_path = (report_parent / SOURCE_DIAGNOSTIC_DIRECTORY / "index.json").as_posix()
    source_index = reader.read_json(source_index_path)
    if not isinstance(source_index, Mapping):
        raise FileNotFoundError(f"Schema-v2 diagnostic index is missing: {source_index_path}")
    if (
        source_index.get("schema_version") != SOURCE_DIAGNOSTIC_SCHEMA_VERSION
        or source_index.get("dimension") != dimension
    ):
        raise ValueError(f"Schema-v2 diagnostic index is incompatible: {source_index_path}")

    expected_ids = set(expected_test_ids)
    source_entries = _object(source_index.get("diagnostics"))
    if set(source_entries) != expected_ids:
        missing = sorted(expected_ids - set(source_entries))[:5]
        extra = sorted(set(source_entries) - expected_ids)[:5]
        raise ValueError(f"Schema-v2 diagnostic IDs do not match Supabase; missing={missing!r}, extra={extra!r}")

    destination = output_root / DASHBOARD_DIAGNOSTIC_DIRECTORY
    index_entries: dict[str, dict[str, Any]] = {}
    for test_id in sorted(expected_ids):
        source_entry = _safe_v2_entry(source_entries[test_id])
        if source_entry is None:
            raise ValueError(f"Unsafe or incompatible schema-v2 locator for {test_id}")
        source_relative_path, _version = source_entry
        artifact_path = (report_parent / source_relative_path).as_posix()
        artifact = reader.read_json(artifact_path)
        if not isinstance(artifact, Mapping):
            raise FileNotFoundError(f"Schema-v2 diagnostic is missing: {artifact_path}")
        if artifact.get("test_id") != test_id:
            raise ValueError(f"Schema-v2 diagnostic test_id mismatch for {test_id}")

        filename = PurePosixPath(source_relative_path).name
        upgraded = transform_v2_diagnostic(artifact, dimension=dimension)
        _write_json(destination / filename, upgraded)
        index_entries[test_id] = {
            "relative_path": f"{DASHBOARD_DIAGNOSTIC_DIRECTORY}/{filename}",
            "schema_version": DASHBOARD_DIAGNOSTIC_SCHEMA_VERSION,
        }

    index = {
        "schema_version": DASHBOARD_DIAGNOSTIC_SCHEMA_VERSION,
        "dimension": dimension,
        "diagnostics": index_entries,
    }
    index_path = destination / "index.json"
    _write_json(index_path, index)
    return index_path


def upgrade_local_dashboard_diagnostic_trees(artifact_root: Path) -> list[Path]:
    """Atomically upgrade every schema-v2 diagnostic tree under an output root.

    All dimensions are transformed in a sibling staging directory first.  A
    malformed or incomplete v2 tree therefore leaves the output root exactly
    as it was.  Existing local v3 trees are restored if installation fails.
    """

    root = artifact_root.resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"Diagnostic artifact root does not exist: {root}")
    source_indexes = sorted(root.rglob(f"{SOURCE_DIAGNOSTIC_DIRECTORY}/index.json"))
    if not source_indexes:
        raise FileNotFoundError(f"No schema-v2 diagnostic indexes found beneath {root}")

    reader = LocalArtifactReader(root)
    dimensions: list[tuple[Path, str, tuple[str, ...]]] = []
    for source_index_path in source_indexes:
        report_parent = source_index_path.parent.parent.parent
        report_parent_relative = report_parent.relative_to(root)
        source_index = json.loads(source_index_path.read_text(encoding="utf-8"))
        if not isinstance(source_index, Mapping):
            raise ValueError(f"Expected a JSON object in {source_index_path}")
        dimension = source_index.get("dimension")
        entries = source_index.get("diagnostics")
        if source_index.get("schema_version") != SOURCE_DIAGNOSTIC_SCHEMA_VERSION:
            raise ValueError(f"Expected schema-v2 diagnostic index: {source_index_path}")
        if not isinstance(dimension, str) or not dimension:
            raise ValueError(f"Diagnostic dimension is missing: {source_index_path}")
        if not isinstance(entries, Mapping):
            raise ValueError(f"Diagnostic index cases must be an object: {source_index_path}")
        dimensions.append((report_parent_relative, dimension, tuple(entries)))

    with tempfile.TemporaryDirectory(prefix=".dashboard-diagnostics-", dir=root.parent) as temporary:
        staging_root = Path(temporary)
        for report_parent_relative, dimension, test_ids in dimensions:
            report_relative_path = (report_parent_relative / "_evaluation_report.json").as_posix()
            write_dashboard_diagnostics(
                reader,
                report_relative_path,
                dimension=dimension,
                expected_test_ids=test_ids,
                output_root=staging_root / report_parent_relative,
            )

        installed: list[tuple[Path, Path | None]] = []
        backup_root = staging_root / "backups"
        try:
            for position, (report_parent_relative, _dimension, _test_ids) in enumerate(dimensions):
                staged = staging_root / report_parent_relative / DASHBOARD_DIAGNOSTIC_DIRECTORY
                target = root / report_parent_relative / DASHBOARD_DIAGNOSTIC_DIRECTORY
                backup: Path | None = None
                target.parent.mkdir(parents=True, exist_ok=True)
                if target.exists():
                    backup = backup_root / str(position)
                    backup.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(target, backup)
                try:
                    os.replace(staged, target)
                except Exception:
                    if backup is not None:
                        os.replace(backup, target)
                    raise
                installed.append((target, backup))
        except Exception:
            for target, backup in reversed(installed):
                if target.is_dir():
                    shutil.rmtree(target)
                elif target.exists():
                    target.unlink()
                if backup is not None:
                    os.replace(backup, target)
            raise

        return [target / "index.json" for target, _backup in installed]
