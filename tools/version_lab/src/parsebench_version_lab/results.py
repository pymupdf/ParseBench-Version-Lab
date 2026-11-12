"""Frontend-independent aggregate score discovery and rendering."""

from __future__ import annotations

import json
import math
from collections.abc import Callable, Collection
from dataclasses import asdict, dataclass
from pathlib import Path
from statistics import fmean
from typing import Any

from .model import V2_METRICS, V2_REPOSITORY, V2_SUBSETS

DEFAULT_METRICS = {
    "table": "grits_trm_composite",
    "layout": "layout_element_rule_pass_rate",
    "text_content": "content_faithfulness",
    "text_formatting": "semantic_formatting",
    "form": "rule_form_field_pass_rate",
}
REPORT_DIMENSION_METRICS = {
    "chart": "avg_rule_pass_rate",
    "layout": "avg_layout_element_rule_pass_rate",
    "table": "avg_grits_trm_composite",
    "text_content": "avg_content_faithfulness",
    "text_formatting": "avg_semantic_formatting",
}


@dataclass(frozen=True)
class CategoryScore:
    category: str
    metric: str | None
    score: float | None
    evaluated_cases: int


def display_name(value: str) -> str:
    special_names = {
        "grits_trm_composite": "GriTS table score",
        "layout_element_rule_pass_rate": "Layout element pass rate",
        "content_faithfulness": "Content faithfulness",
        "semantic_formatting": "Semantic formatting",
        "rule_form_field_pass_rate": "Form field pass rate",
        "rule_pass_rate": "Rule pass rate",
    }
    return special_names.get(value, value.replace("_", " ").title())


def finite_number(value: Any) -> float | None:
    """Accept finite numeric scores and weights, excluding booleans."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def headline_metric(dimension: str | None, metric_names: Collection[str], *, v2: bool = False) -> str | None:
    """Choose the same headline metric for summaries, diagnostics, and indexing."""
    if v2:
        preferred = V2_METRICS.get(dimension or "")
        return preferred if preferred in metric_names else None
    preferred = DEFAULT_METRICS.get(dimension or "", "rule_pass_rate")
    if preferred in metric_names:
        return preferred
    if "rule_pass_rate" in metric_names:
        return "rule_pass_rate"
    return min(metric_names, default=None)


def category_score(category: str, report: dict[str, Any]) -> CategoryScore:
    aggregate_metrics = report.get("aggregate_metrics", {})
    metrics = {
        key.removeprefix("avg_"): value
        for key, raw_value in aggregate_metrics.items()
        if key.startswith("avg_")
        and "_predicted" not in key
        and "_judge" not in key
        and (value := finite_number(raw_value)) is not None
    }
    metric = headline_metric(category, metrics)
    score = metrics.get(metric) if metric is not None else None
    total_examples = report.get("total_examples", 0)
    evaluated_cases = total_examples if isinstance(total_examples, int) and total_examples >= 0 else 0
    return CategoryScore(category, metric, score, evaluated_cases)


def report_dimension(report: dict[str, Any], fallback: str | None = None) -> str | None:
    """Infer a report dimension from its aggregate metrics."""
    aggregate_metrics = report.get("aggregate_metrics", {})
    if isinstance(aggregate_metrics, dict):
        matches = [dimension for dimension, metric in REPORT_DIMENSION_METRICS.items() if metric in aggregate_metrics]
        if len(matches) == 1:
            return matches[0]
    return fallback


def discover_reports(pipeline_output_dir: Path, selected_group: str) -> list[tuple[str, Path]]:
    category_reports = [
        (path.parent.name, path) for path in sorted(pipeline_output_dir.glob("*/_evaluation_report.json"))
    ]
    if category_reports:
        return category_reports
    report = pipeline_output_dir / "_evaluation_report.json"
    if report.is_file():
        payload = json.loads(report.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError(f"Expected a JSON object in {report}")
        dimension = report_dimension(payload, selected_group)
        if dimension is None:
            raise ValueError(f"Could not identify the evaluation dimension in {report}")
        return [(dimension, report)]
    raise FileNotFoundError(f"No evaluation reports found in {pipeline_output_dir}")


def load_scores(pipeline_output_dir: Path, selected_group: str) -> list[CategoryScore]:
    scores = []
    for category, path in discover_reports(pipeline_output_dir, selected_group):
        report = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(report, dict):
            raise ValueError(f"Expected a JSON object in {path}")
        scores.append(category_score(category, report))
    return scores


def build_summary(scores: list[CategoryScore]) -> tuple[str, dict[str, Any]]:
    available_scores = [category.score for category in scores if category.score is not None]
    overall = fmean(available_scores) if available_scores else None
    overall_display = f"**{overall:.1%}**" if overall is not None else "**N/A**"
    lines = [
        "## Aggregate benchmark results",
        "",
        f"Overall aggregate score: {overall_display}",
        "",
        "The overall score is the unweighted average of the headline metric shown for each category.",
        "",
        "| Category | Headline metric | Aggregate score | Evaluated cases |",
        "| --- | --- | ---: | ---: |",
    ]
    for category in scores:
        score = f"{category.score:.1%}" if category.score is not None else "N/A"
        metric = display_name(category.metric) if category.metric else "No aggregate metric available"
        lines.append(f"| {display_name(category.category)} | {metric} | {score} | {category.evaluated_cases} |")
    lines.append("")
    data = {
        "overall_score": overall,
        "overall_method": "unweighted_average_of_category_headline_metrics",
        "categories": [asdict(category) for category in scores],
    }
    return "\n".join(lines), data


def v2_pipeline_metadata(pipeline: str, read_json: Callable[[str], Any]) -> dict[str, Any]:
    """Combine upstream inference counters and carry the scorer's weighted dimensions verbatim."""
    summaries = []
    config = {}
    for subset in V2_SUBSETS:
        metadata = read_json(f"parsebench-2/{subset}/{pipeline}/_metadata.json")
        if metadata:
            summaries.append(metadata["summary"])
            config = metadata["pipeline"]
    summary = {}
    if summaries:
        for key in ("total", "successful", "skipped", "failed", "total_latency_ms"):
            summary[key] = sum(part.get(key, 0) for part in summaries)
        summary["errors"] = [error for part in summaries for error in part.get("errors", [])]
        summary["avg_latency_ms"] = round(summary["total_latency_ms"] / max(summary["successful"], 1), 2)
        summary["success_rate"] = round(100 * summary["successful"] / max(summary["total"], 1), 2)
    score = read_json(f"parsebench-2/_score/{pipeline}/_next_score.json")
    if score:
        summary["parsebench_2"] = {key: score[key] for key in ("next_score", "dimensions", "missing_dimensions")}
    return {"summary": summary, "pipeline": config}


def run_summary(output_dir: Path, pipeline: str, group: str, repository: str) -> tuple[str, dict[str, Any]]:
    if repository != V2_REPOSITORY:
        return build_summary(load_scores(output_dir / pipeline, group))

    score_dir = output_dir / "parsebench-2"
    combined = json.loads((score_dir / "_score" / pipeline / "_next_score.json").read_bytes())
    scores = []
    for subset in V2_SUBSETS if group == "all" else (group,):
        report = json.loads((score_dir / subset / pipeline / "_evaluation_report.json").read_bytes())
        metric = V2_METRICS[subset]
        scores.append(
            CategoryScore(
                subset,
                metric,
                finite_number(report["aggregate_metrics"].get(f"avg_{metric}")),
                report["total_examples"],
            )
        )
    overall = combined["next_score"]
    display = "N/A" if overall is None else f"{overall:.1%}"
    lines = [f"## ParseBench 2 score: {display}", "", "| Dimension | Score |", "| --- | ---: |"]
    for name, dimension in combined["dimensions"].items():
        value = dimension["score"]
        rendered = "N/A" if value is None else f"{value:.1%}"
        lines.append(f"| {display_name(name)} | {rendered} |")
    if group != "all":
        category = scores[0]
        subset_score = "N/A" if category.score is None else f"{category.score:.1%}"
        lines.extend(("", f"{display_name(group)} subset ({category.evaluated_cases} cases): {subset_score}"))
    return "\n".join(lines) + "\n", {
        "overall_score": overall,
        "overall_method": "parsebench_2_next_score",
        "dimensions": combined["dimensions"],
        "missing_dimensions": combined["missing_dimensions"],
        "categories": [asdict(score) for score in scores],
    }
