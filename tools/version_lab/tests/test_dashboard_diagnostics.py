from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

VERSION_LAB_SRC = Path(__file__).parents[1] / "src"
sys.path.insert(0, str(VERSION_LAB_SRC))

from parsebench_version_lab.benchmark_index import LocalArtifactReader  # noqa: E402
from parsebench_version_lab.dashboard_diagnostics import (  # noqa: E402
    transform_v2_diagnostic,
    upgrade_local_dashboard_diagnostic_trees,
    write_dashboard_diagnostics,
)


def diagnostic_v2(
    *,
    dimension: str = "layout",
    primary_name: str = "rule_pass_rate",
    summary_source: str = "rule_pass_rate.rule_results",
) -> dict[str, object]:
    return {
        "schema_version": 2,
        "test_id": f"{dimension}/example",
        "dimension": dimension,
        "source": {"relative_path": "example.pdf"},
        "primary_metric": {
            "name": primary_name,
            "value": 0.5,
            "formula": {"kind": "direct", "components": []},
        },
        "metrics": [
            {"metric_name": "rule_pass_rate", "value": 0.5, "metadata": {}},
        ],
        "expectations": [
            {"id": "layout-1", "type": "layout", "rule": {"bbox": [0, 0, 1, 1]}},
            {"id": "order-1", "type": "order", "rule": {"before": "a", "after": "b"}},
        ],
        "outcomes": [{"rule_id": "order-1", "type": "order", "score": 0.5}],
        "summary": {"passed": 0, "partial": 1, "failed": 0, "total": 1, "source": summary_source},
    }


def test_transform_identifies_mixed_layout_and_primary_summary() -> None:
    source = diagnostic_v2()
    source["metrics"].append({"metric_name": "layout_element_rule_pass_rate", "value": 0.25, "metadata": {}})

    upgraded = transform_v2_diagnostic(source, dimension="layout")

    assert source["schema_version"] == 2
    assert upgraded["schema_version"] == 3
    assert upgraded["evaluation_kind"] == "layout_mixed"
    assert upgraded["summary"]["headline_contribution"] == {
        "primary_metric_name": "rule_pass_rate",
        "kind": "primary",
        "contributes": True,
        "weight": 1.0,
        "normalized_weight": 1.0,
    }
    assert "metric" not in upgraded["summary"]


def test_transform_uses_the_primary_metric_for_element_scored_mixed_layout() -> None:
    source = diagnostic_v2(primary_name="layout_element_rule_pass_rate")
    source["metrics"].append({"metric_name": "layout_element_rule_pass_rate", "value": 0.25, "metadata": {}})

    upgraded = transform_v2_diagnostic(source, dimension="layout")

    assert upgraded["evaluation_kind"] == "layout_elements"


def test_transform_marks_table_summary_as_a_weighted_component() -> None:
    source = diagnostic_v2(
        dimension="table",
        primary_name="grits_trm_composite",
        summary_source="table_record_match.per_table_details",
    )
    source["primary_metric"] = {
        "name": "grits_trm_composite",
        "value": 0.6,
        "formula": {
            "kind": "weighted_mean",
            "weight_sum": 1.0,
            "components": [
                {"metric_name": "grits_con", "value": 0.7, "weight": 0.5},
                {"metric_name": "table_record_match", "value": 0.5, "weight": 0.5},
            ],
        },
    }
    source["metrics"] = [
        {"metric_name": "grits_trm_composite", "value": 0.6},
        {"metric_name": "table_record_match", "value": 0.5},
    ]

    upgraded = transform_v2_diagnostic(source, dimension="table")

    assert upgraded["evaluation_kind"] == "table_comparison"
    assert upgraded["summary"]["headline_contribution"] == {
        "primary_metric_name": "grits_trm_composite",
        "kind": "component",
        "contributes": True,
        "weight": 0.5,
        "normalized_weight": 0.5,
    }


def test_transform_marks_grits_only_trm_counts_as_diagnostic() -> None:
    source = diagnostic_v2(
        dimension="table",
        primary_name="grits_trm_composite",
        summary_source="table_record_match.per_table_details",
    )
    source["primary_metric"] = {
        "name": "grits_trm_composite",
        "value": 0.7,
        "formula": {
            "kind": "fallback",
            "components": [{"metric_name": "grits_con", "value": 0.7, "weight": 1.0}],
        },
    }

    upgraded = transform_v2_diagnostic(source, dimension="table")

    contribution = upgraded["summary"]["headline_contribution"]
    assert contribution["kind"] == "diagnostic"
    assert contribution["contributes"] is False


def test_writer_requires_complete_v2_index_and_publishes_v3_tree(tmp_path: Path) -> None:
    source_root = tmp_path / "source"
    v2_directory = source_root / "pipeline/layout/_diagnostics/v2"
    v2_directory.mkdir(parents=True)
    payload = diagnostic_v2()
    (v2_directory / "case.json").write_text(json.dumps(payload), encoding="utf-8")
    (v2_directory / "index.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "dimension": "layout",
                "diagnostics": {
                    "layout/example": {
                        "relative_path": "_diagnostics/v2/case.json",
                        "schema_version": 2,
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    output_root = tmp_path / "output"
    index_path = write_dashboard_diagnostics(
        LocalArtifactReader(source_root),
        "pipeline/layout/_evaluation_report.json",
        dimension="layout",
        expected_test_ids=["layout/example"],
        output_root=output_root,
    )

    index = json.loads(index_path.read_text(encoding="utf-8"))
    assert index == {
        "schema_version": 3,
        "dimension": "layout",
        "diagnostics": {
            "layout/example": {
                "relative_path": "_diagnostics/v3/case.json",
                "schema_version": 3,
            }
        },
    }
    artifact = json.loads((output_root / "_diagnostics/v3/case.json").read_text(encoding="utf-8"))
    assert artifact["evaluation_kind"] == "layout_mixed"
    assert artifact["outcomes"] == payload["outcomes"]


def test_writer_rejects_unsafe_v2_locator(tmp_path: Path) -> None:
    source_root = tmp_path / "source"
    v2_directory = source_root / "pipeline/layout/_diagnostics/v2"
    v2_directory.mkdir(parents=True)
    (v2_directory / "index.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "dimension": "layout",
                "diagnostics": {
                    "layout/example": {
                        "relative_path": "../../secret.json",
                        "schema_version": 2,
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="Unsafe or incompatible"):
        write_dashboard_diagnostics(
            LocalArtifactReader(source_root),
            "pipeline/layout/_evaluation_report.json",
            dimension="layout",
            expected_test_ids=["layout/example"],
            output_root=tmp_path / "output",
        )


def _write_local_v2_tree(
    root: Path,
    relative_parent: str,
    payload: dict[str, object],
    *,
    relative_path: str = "_diagnostics/v2/case.json",
) -> None:
    directory = root / relative_parent / "_diagnostics/v2"
    directory.mkdir(parents=True)
    (directory / "case.json").write_text(json.dumps(payload), encoding="utf-8")
    (directory / "index.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "dimension": payload["dimension"],
                "diagnostics": {
                    payload["test_id"]: {
                        "relative_path": relative_path,
                        "schema_version": 2,
                    }
                },
            }
        ),
        encoding="utf-8",
    )


def test_recursive_local_upgrade_installs_every_dimension(tmp_path: Path) -> None:
    chart = diagnostic_v2(dimension="chart")
    table = diagnostic_v2(dimension="table", primary_name="grits_trm_composite")
    _write_local_v2_tree(tmp_path, "pipeline/chart", chart)
    _write_local_v2_tree(tmp_path, "pipeline/table", table)

    indexes = upgrade_local_dashboard_diagnostic_trees(tmp_path)

    assert indexes == [
        tmp_path / "pipeline/chart/_diagnostics/v3/index.json",
        tmp_path / "pipeline/table/_diagnostics/v3/index.json",
    ]
    assert all(json.loads(path.read_text(encoding="utf-8"))["schema_version"] == 3 for path in indexes)


def test_recursive_local_upgrade_accepts_an_empty_dimension(tmp_path: Path) -> None:
    source_directory = tmp_path / "pipeline/chart/_diagnostics/v2"
    source_directory.mkdir(parents=True)
    (source_directory / "index.json").write_text(
        json.dumps({"schema_version": 2, "dimension": "chart", "diagnostics": {}}),
        encoding="utf-8",
    )

    indexes = upgrade_local_dashboard_diagnostic_trees(tmp_path)

    assert indexes == [tmp_path / "pipeline/chart/_diagnostics/v3/index.json"]
    assert json.loads(indexes[0].read_text(encoding="utf-8")) == {
        "schema_version": 3,
        "dimension": "chart",
        "diagnostics": {},
    }


def test_recursive_local_upgrade_leaves_all_dimensions_unchanged_on_failure(tmp_path: Path) -> None:
    chart = diagnostic_v2(dimension="chart")
    layout = diagnostic_v2()
    _write_local_v2_tree(tmp_path, "pipeline/chart", chart)
    _write_local_v2_tree(
        tmp_path,
        "pipeline/layout",
        layout,
        relative_path="../../escape.json",
    )

    with pytest.raises(ValueError, match="Unsafe or incompatible"):
        upgrade_local_dashboard_diagnostic_trees(tmp_path)

    assert not list(tmp_path.rglob("_diagnostics/v3"))
