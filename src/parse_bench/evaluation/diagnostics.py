"""Write compact, per-example evaluation diagnostics for interactive consumers.

The canonical evaluation report intentionally keeps every example in one file.
That is convenient for aggregate reports, but expensive for a document inspector:
some dimension reports are tens of megabytes.  This module splits the existing
evaluation evidence into immutable, independently fetchable JSON documents and
joins it with the exact dataset expectations used for the run.
"""

from __future__ import annotations

import hashlib
import json
import math
import mimetypes
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

from parse_bench.schemas.evaluation import EvaluationResult, EvaluationSummary, MetricValue

DIAGNOSTIC_SCHEMA_VERSION = 2
DIAGNOSTIC_DIRECTORY = "_diagnostics"
DIAGNOSTIC_VERSION_DIRECTORY = f"{DIAGNOSTIC_DIRECTORY}/v{DIAGNOSTIC_SCHEMA_VERSION}"

_DATASET_DIMENSIONS = ("chart", "layout", "table", "text_content", "text_formatting")
_SHARED_INFERENCE_GROUPS = {
    "text_content": "text",
    "text_formatting": "text",
}
_PRIMARY_METRICS = {
    "chart": "rule_pass_rate",
    "layout": "layout_element_rule_pass_rate",
    "table": "grits_trm_composite",
    "text_content": "content_faithfulness",
    "text_formatting": "semantic_formatting",
}

# These evaluator-internal fields can repeat the complete predicted page text
# once per layout element.  They are useful while developing a metric, but the
# canonical evaluation report already retains them and the interactive
# inspector does not consume them.  Keeping every other outcome field preserves
# useful raw evidence without turning a single eagerly loaded sidecar into a
# multi-megabyte response.
_HEAVY_OUTCOME_FIELDS = frozenset({"pred_text_norm", "missing_tokens", "extra_tokens"})


def diagnostic_dimension(group: str | None) -> str | None:
    """Return a supported benchmark dimension, otherwise request inference."""

    return group if group in _DATASET_DIMENSIONS else None


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"Invalid JSONL at {path}:{line_number}: {error}") from error
            if not isinstance(row, dict):
                raise ValueError(f"Expected a JSON object at {path}:{line_number}")
            rows.append(row)
    return rows


def _normalized_expectation(row: Mapping[str, Any]) -> dict[str, Any]:
    """Return a JSON-friendly dataset row with a decoded rule payload.

    Public dataset rows historically stored ``rule`` as a double-encoded JSON
    string.  Decoding it here preserves the expectation while making the
    diagnostic directly useful to a browser.  Unknown row fields are retained.
    """

    expectation = dict(row)
    rule = expectation.get("rule")
    if isinstance(rule, str):
        try:
            expectation["rule"] = json.loads(rule)
        except json.JSONDecodeError:
            # Custom datasets may legitimately use a plain string expectation.
            pass
    return expectation


def _test_id_for_row(row: Mapping[str, Any], fallback_dimension: str) -> str | None:
    source_path = row.get("pdf")
    if not isinstance(source_path, str) or not source_path:
        return None
    category = row.get("category")
    dimension = category if isinstance(category, str) and category else fallback_dimension
    inference_group = _SHARED_INFERENCE_GROUPS.get(dimension, dimension)
    return f"{inference_group}/{Path(source_path).stem}"


def _load_expectations(
    test_cases_dir: Path | None,
    dimensions: Iterable[str],
    *,
    verified_only: bool = False,
) -> dict[str, dict[str, list[dict[str, Any]]]]:
    by_dimension: dict[str, dict[str, list[dict[str, Any]]]] = {}
    if test_cases_dir is None:
        return by_dimension

    for dimension in dimensions:
        dataset_file = test_cases_dir / f"{dimension}.jsonl"
        if not dataset_file.is_file():
            continue
        by_test_id: dict[str, list[dict[str, Any]]] = {}
        for raw_row in _read_jsonl(dataset_file):
            if verified_only and raw_row.get("verified") is False:
                continue
            test_id = _test_id_for_row(raw_row, dimension)
            if test_id is not None:
                by_test_id.setdefault(test_id, []).append(_normalized_expectation(raw_row))
        by_dimension[dimension] = by_test_id
    return by_dimension


def _dimension_for_result(
    result: EvaluationResult,
    explicit_dimension: str | None,
    expectations: Mapping[str, Mapping[str, list[dict[str, Any]]]],
) -> str | None:
    if explicit_dimension:
        return explicit_dimension

    tagged_dimensions = [dimension for dimension in _DATASET_DIMENSIONS if dimension in result.tags]
    if len(tagged_dimensions) == 1:
        return tagged_dimensions[0]

    base_test_id = result.test_id.split("#q", 1)[0]
    matching_dimensions = [dimension for dimension, rows in expectations.items() if base_test_id in rows]
    if len(matching_dimensions) == 1:
        return matching_dimensions[0]

    prefix = base_test_id.partition("/")[0]
    if prefix in _DATASET_DIMENSIONS:
        return prefix
    return None


def _primary_metric(result: EvaluationResult, dimension: str | None) -> MetricValue | None:
    by_name = {metric.metric_name: metric for metric in result.metrics}
    preferred = _PRIMARY_METRICS.get(dimension or "", "rule_pass_rate")
    if preferred in by_name:
        return by_name[preferred]
    if "rule_pass_rate" in by_name:
        return by_name["rule_pass_rate"]
    return min(result.metrics, key=lambda metric: metric.metric_name, default=None)


def _validate_excluded_rule_outcomes(
    result: EvaluationResult,
    excluded_rule_ids: set[str],
) -> None:
    """Ensure a verified-only summary was evaluated with the same rules.

    Rewriting evidence from an unfiltered historical summary would leave its
    headline metric values inconsistent with the displayed checks.  Refuse that
    contradictory state rather than attempting to recalculate dimension-specific
    scores outside their evaluators.
    """

    if not excluded_rule_ids:
        return

    for metric in result.metrics:
        raw_results = metric.metadata.get("rule_results")
        if not isinstance(raw_results, list):
            continue
        retained_excluded_ids: set[str] = set()
        for item in raw_results:
            if not isinstance(item, Mapping):
                continue
            outcome_id = next(
                (
                    item.get(key)
                    for key in ("id", "rule_id", "element_id")
                    if isinstance(item.get(key), str)
                ),
                None,
            )
            if outcome_id in excluded_rule_ids:
                retained_excluded_ids.add(outcome_id)
        if retained_excluded_ids:
            joined_ids = ", ".join(sorted(retained_excluded_ids)[:3])
            raise ValueError(
                "verified_only diagnostics require an EvaluationSummary produced "
                f"with verified_only=True; excluded outcomes remain for {joined_ids}"
            )


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _primary_formula(metric: MetricValue | None) -> dict[str, Any] | None:
    if metric is None:
        return None

    metadata = metric.metadata
    details = metric.details
    formula: dict[str, Any] = {
        "kind": "direct",
        "components": [],
    }
    if details:
        formula["description"] = details[0]

    weights = metadata.get("weights")
    category_scores = metadata.get("category_scores")
    if isinstance(weights, dict) and isinstance(category_scores, dict):
        components: list[dict[str, Any]] = []
        for name in sorted(weights):
            weight = _number(weights.get(name))
            value = _number(category_scores.get(name))
            if weight is not None and value is not None:
                components.append({"metric_name": name, "value": value, "weight": weight})
        if components:
            formula.update(
                {
                    "kind": "weighted_mean",
                    "components": components,
                    "weight_sum": _number(metadata.get("weight_sum")) or sum(c["weight"] for c in components),
                }
            )
            return formula

    if metric.metric_name == "grits_trm_composite":
        grits = _number(metadata.get("grits_con"))
        trm = _number(metadata.get("trm"))
        fallback = metadata.get("fallback")
        if grits is not None and not fallback and trm is not None:
            formula.update(
                {
                    "kind": "weighted_mean",
                    "components": [
                        {"metric_name": "grits_con", "value": grits, "weight": 0.5},
                        {"metric_name": "table_record_match", "value": trm, "weight": 0.5},
                    ],
                    "weight_sum": 1.0,
                }
            )
        elif grits is not None:
            formula.update(
                {
                    "kind": "fallback",
                    "components": [{"metric_name": "grits_con", "value": grits, "weight": 1.0}],
                    "reason": metadata.get("reason") or fallback,
                }
            )
    return formula


def _score_status(score: float, passed: bool | None = None) -> str:
    if passed is True or score >= 1.0:
        return "passed"
    if score > 0.0:
        return "partial"
    return "failed"


def _outcome_summary(result: EvaluationResult, primary: MetricValue | None) -> dict[str, Any]:
    metrics_by_preference = sorted(
        result.metrics,
        key=lambda metric: (
            metric is not primary,
            metric.metric_name != "rule_pass_rate",
            metric.metric_name,
        ),
    )
    for metric in metrics_by_preference:
        raw_results = metric.metadata.get("rule_results")
        if not isinstance(raw_results, list):
            continue
        # Judge-normalized chart entries are alternate evaluations of the same
        # rules.  Keep them in metric metadata, but do not double-count them.
        rule_results = [
            item for item in raw_results if isinstance(item, dict) and not str(item.get("type", "")).endswith("_judge")
        ]
        if not rule_results:
            continue
        has_explicit_outcomes = all(
            isinstance(item.get("passed"), bool) or _number(item.get("score")) is not None for item in rule_results
        )
        if not has_explicit_outcomes:
            # Layout element evidence deliberately stores the four component
            # decisions instead of repeating a synthetic per-item score.  Its
            # metric-level counts are the canonical headline outcome.
            passed = metric.metadata.get("passed")
            total = metric.metadata.get("total")
            if isinstance(passed, int) and not isinstance(passed, bool) and isinstance(total, int) and total >= passed:
                return {
                    "passed": passed,
                    "partial": 0,
                    "failed": total - passed,
                    "total": total,
                    "source": f"{metric.metric_name}.counts",
                }
            continue
        counts = {"passed": 0, "partial": 0, "failed": 0}
        for item in rule_results:
            score = _number(item.get("score"))
            if score is None:
                score = 1.0 if item.get("passed") is True else 0.0
            status = _score_status(score, item.get("passed") if isinstance(item.get("passed"), bool) else None)
            counts[status] += 1
        return {**counts, "total": len(rule_results), "source": f"{metric.metric_name}.rule_results"}

    # Table metrics do not use rule_results.  TRM's per-table records are the
    # most user-meaningful fallback because each item represents one pairing.
    table_metric = next((metric for metric in result.metrics if metric.metric_name == "table_record_match"), None)
    if table_metric is not None:
        table_details = table_metric.metadata.get("per_table_details")
        if isinstance(table_details, list) and table_details:
            counts = {"passed": 0, "partial": 0, "failed": 0}
            counted = 0
            for item in table_details:
                if not isinstance(item, dict):
                    continue
                score = _number(item.get("score"))
                if score is None:
                    continue
                counts[_score_status(score)] += 1
                counted += 1
            if counted:
                return {
                    **counts,
                    "total": counted,
                    "source": "table_record_match.per_table_details",
                }
        expected_tables = table_metric.metadata.get("n_gt_tables")
        predicted_tables = table_metric.metadata.get("n_pred_tables")
        if (
            isinstance(expected_tables, int)
            and not isinstance(expected_tables, bool)
            and expected_tables > 0
            and predicted_tables == 0
        ):
            # The no-prediction fast path predates per-table details, but its
            # semantics are unambiguous: every expected table scored zero.
            return {
                "passed": 0,
                "partial": 0,
                "failed": expected_tables,
                "total": expected_tables,
                "source": "table_record_match.table_counts",
                "expected": expected_tables,
                "predicted": 0,
            }

    for metric in metrics_by_preference:
        passed = metric.metadata.get("passed")
        total = metric.metadata.get("total")
        if isinstance(passed, int) and not isinstance(passed, bool) and isinstance(total, int) and total >= passed:
            return {
                "passed": passed,
                "partial": 0,
                "failed": total - passed,
                "total": total,
                "source": f"{metric.metric_name}.counts",
            }

    return {"passed": 0, "partial": 0, "failed": 0, "total": 0, "source": None}


def _source_details(
    result: EvaluationResult,
    expectation_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    dataset_paths = sorted(
        {source_path for row in expectation_rows if isinstance((source_path := row.get("pdf")), str) and source_path}
    )
    relative_path = result.source_relative_path or (dataset_paths[0] if len(dataset_paths) == 1 else None)
    media_type = result.source_media_type
    if media_type is None and relative_path:
        media_type = mimetypes.guess_type(relative_path)[0]

    pages = sorted(
        {page for row in expectation_rows if isinstance((page := row.get("page")), int) and not isinstance(page, bool)}
    )
    return {
        "relative_path": relative_path,
        "dataset_relative_paths": dataset_paths,
        "media_type": media_type,
        "page": pages[0] if len(pages) == 1 else None,
        "pages": pages,
    }


def _compact_metrics(
    result: EvaluationResult,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Serialize metrics and lift compact rule outcomes out of metric metadata.

    The dashboard needs one rule-result stream, not copies embedded inside its
    metric list.  This mirrors the inspector's historical behavior of choosing
    the longest stream while making that contract explicit in schema v2.
    """

    metrics = [json.loads(metric.model_dump_json()) for metric in result.metrics]
    longest_outcomes: list[dict[str, Any]] = []
    for metric in metrics:
        metadata = metric.get("metadata")
        if not isinstance(metadata, dict):
            continue
        raw_outcomes = metadata.pop("rule_results", None)
        if not isinstance(raw_outcomes, list):
            continue
        outcomes = [
            {
                key: value
                for key, value in outcome.items()
                if key not in _HEAVY_OUTCOME_FIELDS
            }
            for outcome in raw_outcomes
            if isinstance(outcome, dict)
            and not str(outcome.get("type", "")).endswith("_judge")
        ]
        if len(outcomes) > len(longest_outcomes):
            longest_outcomes = outcomes
    return metrics, longest_outcomes


def _diagnostic_filename(test_id: str) -> str:
    digest = hashlib.sha256(test_id.encode("utf-8")).hexdigest()
    return f"{digest}.json"


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    temporary_path = path.with_suffix(f"{path.suffix}.tmp")
    temporary_path.write_text(
        json.dumps(payload, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    temporary_path.replace(path)


def write_diagnostic_artifacts(
    summary: EvaluationSummary,
    report_dir: Path,
    *,
    test_cases_dir: Path | None = None,
    dimension: str | None = None,
    verified_only: bool = False,
) -> Path:
    """Write one diagnostic JSON per result and return the index path.

    All paths in the index are relative to ``report_dir`` so a copied or
    uploaded report tree remains self-contained.
    """

    dimension = diagnostic_dimension(dimension)
    if dimension is not None:
        dimensions_to_load = [dimension]
    else:
        tagged_dimensions = {
            candidate
            for result in summary.per_example_results
            for candidate in _DATASET_DIMENSIONS
            if candidate in result.tags
        }
        dimensions_to_load = sorted(tagged_dimensions) or list(_DATASET_DIMENSIONS)
    all_expectations = _load_expectations(
        test_cases_dir,
        dimensions_to_load,
    )
    expectations = (
        _load_expectations(
            test_cases_dir,
            dimensions_to_load,
            verified_only=True,
        )
        if verified_only
        else all_expectations
    )
    diagnostics_dir = report_dir / DIAGNOSTIC_VERSION_DIRECTORY
    diagnostics_dir.mkdir(parents=True, exist_ok=True)

    index_entries: dict[str, dict[str, Any]] = {}
    resolved_dimensions: set[str] = set()
    for result in sorted(summary.per_example_results, key=lambda item: item.test_id):
        if result.test_id in index_entries:
            raise ValueError(f"Cannot write diagnostics for duplicate test_id: {result.test_id}")
        resolved_dimension = _dimension_for_result(result, dimension, all_expectations)
        if resolved_dimension:
            resolved_dimensions.add(resolved_dimension)
        base_test_id = result.test_id.split("#q", 1)[0]
        dimension_expectations = expectations.get(resolved_dimension or "", {})
        all_dimension_expectations = all_expectations.get(resolved_dimension or "", {})
        expectation_rows = list(dimension_expectations.get(base_test_id, []))
        all_expectation_rows = list(all_dimension_expectations.get(base_test_id, []))
        included_rule_ids = {
            row["id"] for row in expectation_rows if isinstance(row.get("id"), str)
        }
        all_rule_ids = {
            row["id"] for row in all_expectation_rows if isinstance(row.get("id"), str)
        }
        _validate_excluded_rule_outcomes(
            result,
            all_rule_ids - included_rule_ids if verified_only else set(),
        )
        diagnostic_result = result
        primary = _primary_metric(diagnostic_result, resolved_dimension)
        compact_metrics, outcomes = _compact_metrics(diagnostic_result)
        filename = _diagnostic_filename(result.test_id)
        relative_path = f"{DIAGNOSTIC_VERSION_DIRECTORY}/{filename}"
        payload = {
            "schema_version": DIAGNOSTIC_SCHEMA_VERSION,
            "test_id": result.test_id,
            "dimension": resolved_dimension,
            "source": _source_details(diagnostic_result, expectation_rows),
            "dataset_file": (f"{resolved_dimension}.jsonl" if resolved_dimension in _DATASET_DIMENSIONS else None),
            "primary_metric": (
                {
                    "name": primary.metric_name,
                    "value": _number(primary.value),
                    "formula": _primary_formula(primary),
                }
                if primary is not None
                else None
            ),
            # Pydantic's JSON serializer also normalizes non-finite floats to
            # null, keeping these artifacts valid for JSON.parse in browsers.
            "metrics": compact_metrics,
            "outcomes": outcomes,
            "expectations": expectation_rows,
            "summary": _outcome_summary(diagnostic_result, primary),
        }
        _write_json(diagnostics_dir / filename, payload)
        index_entries[result.test_id] = {
            "relative_path": relative_path,
            "schema_version": DIAGNOSTIC_SCHEMA_VERSION,
        }

    index_dimension = dimension or (next(iter(resolved_dimensions)) if len(resolved_dimensions) == 1 else None)
    index_payload = {
        "schema_version": DIAGNOSTIC_SCHEMA_VERSION,
        "dimension": index_dimension,
        "diagnostics": index_entries,
    }
    index_path = diagnostics_dir / "index.json"
    _write_json(index_path, index_payload)
    return index_path
