import hashlib
import json
from datetime import datetime
from pathlib import Path

import pytest

from parse_bench.evaluation import cli as evaluation_cli_module
from parse_bench.evaluation.cli import EvaluationCLI
from parse_bench.evaluation.diagnostics import diagnostic_dimension, write_diagnostic_artifacts
from parse_bench.evaluation.runner import EvaluationRunner
from parse_bench.schemas.evaluation import EvaluationResult, EvaluationSummary, MetricValue


def _summary(result: EvaluationResult) -> EvaluationSummary:
    return EvaluationSummary(
        total_examples=1,
        successful=int(result.success),
        failed=int(not result.success),
        skipped=0,
        per_example_results=[result],
    )


def _result(*, metrics: list[MetricValue], tags: list[str] | None = None) -> EvaluationResult:
    return EvaluationResult(
        test_id="chart/sample",
        example_id="sample",
        pipeline_name="example_pipeline",
        product_type="parse",
        source_relative_path="docs/chart/sample.pdf",
        source_media_type="application/pdf",
        success=True,
        metrics=metrics,
        tags=tags or ["chart"],
        evaluated_at=datetime(2026, 8, 12, 10, 30),
    )


def _read_artifact(index_path: Path, test_id: str) -> tuple[dict, dict]:
    index = json.loads(index_path.read_text(encoding="utf-8"))
    artifact_path = index_path.parents[2] / index["diagnostics"][test_id]["relative_path"]
    return index, json.loads(artifact_path.read_text(encoding="utf-8"))


def test_writes_deterministic_index_and_joins_exact_chart_expectations(tmp_path: Path) -> None:
    dataset_dir = tmp_path / "dataset"
    dataset_dir.mkdir()
    row = {
        "pdf": "docs/chart/sample.pdf",
        "category": "chart",
        "id": "point-1",
        "type": "chart_data_point",
        "rule": json.dumps({"labels": ["Revenue"], "value": "42", "max_diffs": 0}),
        "page": 2,
        "verified": True,
        "custom_field": "preserved",
    }
    (dataset_dir / "chart.jsonl").write_text(json.dumps(row) + "\n", encoding="utf-8")
    metric = MetricValue(
        metric_name="rule_pass_rate",
        value=0.4,
        metadata={
            "passed": 1,
            "total": 3,
            "rule_results": [
                {"id": "a", "type": "chart_data_point", "passed": True, "score": 1.0},
                {"id": "b", "type": "chart_data_point", "passed": False, "score": 0.2},
                {"id": "c", "type": "chart_data_point", "passed": False, "score": 0.0},
            ],
            "nested_evidence": {"values": [1, 2, 3]},
        },
        details=["Rule-level evidence"],
    )

    index_path = write_diagnostic_artifacts(
        _summary(_result(metrics=[metric])),
        tmp_path / "report",
        test_cases_dir=dataset_dir,
        dimension="chart",
    )

    index, artifact = _read_artifact(index_path, "chart/sample")
    expected_filename = hashlib.sha256(b"chart/sample").hexdigest() + ".json"
    assert index == {
        "schema_version": 2,
        "dimension": "chart",
        "diagnostics": {
            "chart/sample": {
                "relative_path": f"_diagnostics/v2/{expected_filename}",
                "schema_version": 2,
            }
        },
    }
    assert index_path == tmp_path / "report" / "_diagnostics" / "v2" / "index.json"
    assert artifact["schema_version"] == 2
    assert artifact["source"] == {
        "relative_path": "docs/chart/sample.pdf",
        "dataset_relative_paths": ["docs/chart/sample.pdf"],
        "media_type": "application/pdf",
        "page": 2,
        "pages": [2],
    }
    assert artifact["dataset_file"] == "chart.jsonl"
    assert artifact["expectations"][0]["rule"] == {
        "labels": ["Revenue"],
        "value": "42",
        "max_diffs": 0,
    }
    assert artifact["expectations"][0]["custom_field"] == "preserved"
    assert artifact["metrics"][0]["metadata"]["nested_evidence"] == {"values": [1, 2, 3]}
    assert "rule_results" not in artifact["metrics"][0]["metadata"]
    assert artifact["outcomes"] == [
        {"id": "a", "type": "chart_data_point", "passed": True, "score": 1.0},
        {"id": "b", "type": "chart_data_point", "passed": False, "score": 0.2},
        {"id": "c", "type": "chart_data_point", "passed": False, "score": 0.0},
    ]
    assert artifact["summary"] == {
        "passed": 1,
        "partial": 1,
        "failed": 1,
        "total": 3,
        "source": "rule_pass_rate.rule_results",
    }


def test_verified_only_omits_explicitly_unverified_expectations(tmp_path: Path) -> None:
    dataset_dir = tmp_path / "dataset"
    dataset_dir.mkdir()
    rows = [
        {
            "pdf": "docs/chart/sample.pdf",
            "category": "chart",
            "id": "kept",
            "type": "chart_data_point",
            "rule": "{}",
            "verified": True,
        },
        {
            "pdf": "docs/chart/sample.pdf",
            "category": "chart",
            "id": "discarded",
            "type": "chart_data_point",
            "rule": "{}",
            "verified": False,
        },
    ]
    (dataset_dir / "chart.jsonl").write_text(
        "\n".join(json.dumps(row) for row in rows) + "\n",
        encoding="utf-8",
    )
    metric = MetricValue(
        metric_name="rule_pass_rate",
        value=1.0,
        metadata={
            "passed": 1,
            "total": 1,
            "rule_results": [
                {"id": "kept", "type": "chart_data_point", "passed": True, "score": 1.0},
            ],
        },
    )

    index_path = write_diagnostic_artifacts(
        _summary(_result(metrics=[metric])),
        tmp_path / "report",
        test_cases_dir=dataset_dir,
        dimension="chart",
        verified_only=True,
    )
    _, artifact = _read_artifact(index_path, "chart/sample")

    assert [expectation["id"] for expectation in artifact["expectations"]] == ["kept"]
    assert artifact["outcomes"] == [
        {"id": "kept", "type": "chart_data_point", "passed": True, "score": 1.0}
    ]
    assert artifact["metrics"][0]["metadata"]["passed"] == 1
    assert artifact["metrics"][0]["metadata"]["total"] == 1
    assert artifact["summary"] == {
        "passed": 1,
        "partial": 0,
        "failed": 0,
        "total": 1,
        "source": "rule_pass_rate.rule_results",
    }


def test_verified_only_rejects_an_unfiltered_historical_summary(tmp_path: Path) -> None:
    dataset_dir = tmp_path / "dataset"
    dataset_dir.mkdir()
    rows = [
        {
            "pdf": "docs/chart/sample.pdf",
            "category": "chart",
            "id": rule_id,
            "type": "chart_data_point",
            "rule": "{}",
            "verified": verified,
        }
        for rule_id, verified in (("kept", True), ("discarded", False))
    ]
    (dataset_dir / "chart.jsonl").write_text(
        "\n".join(json.dumps(row) for row in rows) + "\n",
        encoding="utf-8",
    )
    metric = MetricValue(
        metric_name="rule_pass_rate",
        value=0.5,
        metadata={
            "rule_results": [
                {"id": "kept", "type": "chart_data_point", "passed": True, "score": 1.0},
                {"id": "discarded", "type": "chart_data_point", "passed": False, "score": 0.0},
            ]
        },
    )

    with pytest.raises(ValueError, match="EvaluationSummary produced with verified_only=True"):
        write_diagnostic_artifacts(
            _summary(_result(metrics=[metric])),
            tmp_path / "report",
            test_cases_dir=dataset_dir,
            dimension="chart",
            verified_only=True,
        )


@pytest.mark.parametrize("identifier_key", ["rule_id", "element_id"])
def test_verified_only_validates_alternate_outcome_identifiers(
    tmp_path: Path,
    identifier_key: str,
) -> None:
    dataset_dir = tmp_path / "dataset"
    dataset_dir.mkdir()
    rows = [
        {
            "pdf": "docs/layout/sample.pdf",
            "category": "layout",
            "id": rule_id,
            "type": "element",
            "rule": "{}",
            "verified": verified,
        }
        for rule_id, verified in (("kept", True), ("discarded", False))
    ]
    (dataset_dir / "layout.jsonl").write_text(
        "\n".join(json.dumps(row) for row in rows) + "\n",
        encoding="utf-8",
    )
    result = _result(
        tags=["layout"],
        metrics=[
            MetricValue(
                metric_name="layout_element_rule_pass_rate",
                value=0.5,
                metadata={
                    "rule_results": [
                        {identifier_key: "discarded", "localization_pass": False}
                    ]
                },
            )
        ],
    )
    result.test_id = "layout/sample"

    with pytest.raises(ValueError, match="EvaluationSummary produced with verified_only=True"):
        write_diagnostic_artifacts(
            _summary(result),
            tmp_path / "report",
            test_cases_dir=dataset_dir,
            dimension="layout",
            verified_only=True,
        )


def test_derives_weighted_primary_formula_and_ignores_judge_duplicates(tmp_path: Path) -> None:
    result = _result(
        tags=["text_content"],
        metrics=[
            MetricValue(
                metric_name="rule_pass_rate",
                value=0.5,
                metadata={
                    "rule_results": [
                        {"type": "missing_word_percent", "passed": False, "score": 0.5},
                        {"type": "chart_data_point_judge", "passed": True, "score": 1.0},
                    ]
                },
            ),
            MetricValue(
                metric_name="content_faithfulness",
                value=0.3,
                metadata={
                    "weights": {"normalized_order": 0.5, "normalized_text_correctness": 1.0},
                    "category_scores": {"normalized_order": 0.0, "normalized_text_correctness": 0.45},
                    "weight_sum": 1.5,
                },
            ),
        ],
    )
    result.test_id = "text/sample"

    index_path = write_diagnostic_artifacts(_summary(result), tmp_path / "report")
    _, artifact = _read_artifact(index_path, "text/sample")

    assert artifact["dimension"] == "text_content"
    assert artifact["primary_metric"] == {
        "name": "content_faithfulness",
        "value": 0.3,
        "formula": {
            "kind": "weighted_mean",
            "components": [
                {"metric_name": "normalized_order", "value": 0.0, "weight": 0.5},
                {"metric_name": "normalized_text_correctness", "value": 0.45, "weight": 1.0},
            ],
            "weight_sum": 1.5,
        },
    }
    assert artifact["summary"] == {
        "passed": 0,
        "partial": 1,
        "failed": 0,
        "total": 1,
        "source": "rule_pass_rate.rule_results",
    }


def test_derives_table_formula_and_per_table_outcomes(tmp_path: Path) -> None:
    result = _result(
        tags=["table"],
        metrics=[
            MetricValue(
                metric_name="grits_trm_composite",
                value=0.45,
                metadata={"grits_con": 0.9, "trm": 0.0, "fallback": None},
            ),
            MetricValue(
                metric_name="table_record_match",
                value=0.25,
                metadata={"per_table_details": [{"score": 1.0}, {"score": 0.5}, {"score": 0.0}]},
            ),
        ],
    )
    result.test_id = "table/sample"

    index_path = write_diagnostic_artifacts(_summary(result), tmp_path / "report")
    _, artifact = _read_artifact(index_path, "table/sample")

    assert artifact["primary_metric"]["formula"] == {
        "kind": "weighted_mean",
        "components": [
            {"metric_name": "grits_con", "value": 0.9, "weight": 0.5},
            {"metric_name": "table_record_match", "value": 0.0, "weight": 0.5},
        ],
        "weight_sum": 1.0,
    }
    assert artifact["summary"] == {
        "passed": 1,
        "partial": 1,
        "failed": 1,
        "total": 3,
        "source": "table_record_match.per_table_details",
    }


def test_uses_layout_metric_counts_when_elements_have_component_outcomes(tmp_path: Path) -> None:
    result = _result(
        tags=["layout"],
        metrics=[
            MetricValue(
                metric_name="layout_element_rule_pass_rate",
                value=0.5,
                metadata={
                    "passed": 1,
                    "total": 2,
                    "rule_results": [
                        {
                            "element_id": "heading",
                            "localization_pass": True,
                            "classification_pass": True,
                            "attribution_pass": True,
                        },
                        {
                            "element_id": "table",
                            "localization_pass": True,
                            "classification_pass": False,
                            "attribution_pass": None,
                        },
                    ],
                },
            )
        ],
    )
    result.test_id = "layout/sample"

    index_path = write_diagnostic_artifacts(_summary(result), tmp_path / "report")
    _, artifact = _read_artifact(index_path, "layout/sample")

    assert artifact["summary"] == {
        "passed": 1,
        "partial": 0,
        "failed": 1,
        "total": 2,
        "source": "layout_element_rule_pass_rate.counts",
    }


def test_counts_every_expected_table_as_failed_when_no_table_was_predicted(tmp_path: Path) -> None:
    result = _result(
        tags=["table"],
        metrics=[
            MetricValue(
                metric_name="table_record_match",
                value=0.0,
                metadata={"n_gt_tables": 2, "n_pred_tables": 0, "tables_predicted": False},
            ),
            MetricValue(
                metric_name="grits_trm_composite",
                value=0.0,
                metadata={"grits_con": 0.0, "trm": 0.0, "fallback": None},
            ),
        ],
    )
    result.test_id = "table/no-prediction"

    index_path = write_diagnostic_artifacts(_summary(result), tmp_path / "report")
    _, artifact = _read_artifact(index_path, "table/no-prediction")

    assert artifact["summary"] == {
        "passed": 0,
        "partial": 0,
        "failed": 2,
        "total": 2,
        "source": "table_record_match.table_counts",
        "expected": 2,
        "predicted": 0,
    }


def test_arbitrary_group_name_is_not_serialized_as_a_diagnostic_dimension(tmp_path: Path) -> None:
    dataset_dir = tmp_path / "dataset"
    dataset_dir.mkdir()
    row = {
        "pdf": "docs/chart/sample.pdf",
        "category": "chart",
        "id": "point-1",
        "type": "chart_data_point",
        "rule": "{}",
    }
    (dataset_dir / "chart.jsonl").write_text(json.dumps(row) + "\n", encoding="utf-8")

    assert diagnostic_dimension("arxiv_math") is None
    index_path = write_diagnostic_artifacts(
        _summary(_result(metrics=[])),
        tmp_path / "report",
        test_cases_dir=dataset_dir,
        dimension="arxiv_math",
    )
    index, artifact = _read_artifact(index_path, "chart/sample")

    assert index["dimension"] == "chart"
    assert artifact["dimension"] == "chart"
    assert artifact["dataset_file"] == "chart.jsonl"
    assert [expectation["id"] for expectation in artifact["expectations"]] == ["point-1"]


def test_compacts_repeated_layout_outcome_text_for_eager_loading(tmp_path: Path) -> None:
    repeated_page_text = "predicted page token " * 1_600
    outcomes = [
        {
            "element_id": f"element-{index}",
            "gt_class": "Text",
            "best_pred_class": "Text",
            "best_pred_bbox": [0.1, 0.2, 0.3, 0.4],
            "localization_pass": True,
            "classification_pass": True,
            "attribution_applicable": True,
            "attribution_pass": False,
            "reading_order_eligible": True,
            "reading_order_pass": True,
            "token_f1": 0.75,
            "pred_text_norm": repeated_page_text,
            "missing_tokens": ["missing"] * 100,
            "extra_tokens": ["extra"] * 100,
        }
        for index in range(200)
    ]
    result = _result(
        tags=["layout"],
        metrics=[
            MetricValue(
                metric_name="layout_element_rule_pass_rate",
                value=0.5,
                metadata={"passed": 100, "total": 200, "rule_results": outcomes},
            )
        ],
    )
    result.test_id = "layout/sample"

    index_path = write_diagnostic_artifacts(_summary(result), tmp_path / "report")
    _, artifact = _read_artifact(index_path, "layout/sample")
    sidecar_path = index_path.parent.parent.parent / json.loads(index_path.read_text())["diagnostics"][
        "layout/sample"
    ]["relative_path"]

    assert sidecar_path.stat().st_size < 250_000
    assert "rule_results" not in artifact["metrics"][0]["metadata"]
    assert len(artifact["outcomes"]) == 200
    assert artifact["outcomes"][0]["best_pred_bbox"] == [0.1, 0.2, 0.3, 0.4]
    assert artifact["outcomes"][0]["token_f1"] == 0.75
    assert not ({"pred_text_norm", "missing_tokens", "extra_tokens"} & artifact["outcomes"][0].keys())


def test_regenerate_uses_verified_only_provenance_from_report(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    evaluation_dir = tmp_path / "chart"
    evaluation_dir.mkdir()
    summary = _summary(_result(metrics=[]))
    summary.verified_only = True
    (evaluation_dir / "_evaluation_report.json").write_text(
        summary.model_dump_json(),
        encoding="utf-8",
    )
    observed: dict[str, object] = {}

    def fake_write_diagnostics(*_args: object, **kwargs: object) -> Path:
        observed.update(kwargs)
        return evaluation_dir / "_diagnostics" / "v2" / "index.json"

    monkeypatch.setattr(evaluation_cli_module, "write_diagnostic_artifacts", fake_write_diagnostics)

    exit_code = EvaluationCLI().regenerate_report(
        evaluation_dir,
        export_csv=False,
        export_rule_csv=False,
        export_markdown=False,
        export_html=False,
    )

    assert exit_code == 0
    assert observed["verified_only"] is True


def test_historical_report_defaults_verified_only_provenance_to_false() -> None:
    summary = _summary(_result(metrics=[])).model_dump()
    summary.pop("verified_only")

    assert EvaluationSummary.model_validate(summary).verified_only is False


def test_runner_records_verified_only_provenance(tmp_path: Path) -> None:
    summary = EvaluationRunner(tmp_path, verified_only=True).run_evaluation(use_rich=False)

    assert summary.verified_only is True
