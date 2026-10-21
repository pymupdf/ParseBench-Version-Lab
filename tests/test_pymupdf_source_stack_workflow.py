from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

HELPERS = Path(__file__).parents[1] / ".github" / "scripts" / "pymupdf_source_stack"


def _load_module(name: str):
    sys.path.insert(0, str(HELPERS))
    try:
        path = HELPERS / f"{name}.py"
        spec = importlib.util.spec_from_file_location(name, path)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(HELPERS))


configure = _load_module("configure")
benchmark = importlib.import_module("parsebench_version_lab.runtime_benchmark")
provenance = importlib.import_module("parsebench_version_lab.provenance")
resolve_dataset = _load_module("resolve_dataset")
resolve_refs = _load_module("resolve_refs")
resolve_sources = _load_module("resolve_sources")
results_summary = importlib.import_module("parsebench_version_lab.results")
run_summary = _load_module("write_run_summary")


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("1.28.0", "1.28.0"),
        ("feature/layout@next", "feature-layout-next"),
        ("a" * 60, "a" * 48),
    ],
)
def test_safe_ref_produces_bounded_path_component(value: str, expected: str) -> None:
    assert configure.safe_ref(value) == expected


def test_configure_maps_friendly_inputs_and_records_request(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(tmp_path / "summary"))
    github_output = tmp_path / "github-output"
    values = {
        "ALL_LATEST": "false",
        "BENCHMARK_REF": "main",
        "DATASET_REF": "current",
        "GCS_PREFIX": "/parsebench/pymupdf_source_stack/",
        "GITHUB_OUTPUT": str(github_output),
        "GITHUB_RUN_ATTEMPT": "2",
        "GITHUB_RUN_ID": "123",
        "GROUP_SELECTION": "Page layout",
        "LATEST_ANY_BRANCH": "false",
        "PYMUPDF_REF": "main",
        "RUNNER_TEMP": str(tmp_path),
        "RUN_SCOPE_SELECTION": "Quick test (15 cases)",
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)

    assert configure.main() == 0

    outputs = dict(line.split("=", 1) for line in github_output.read_text().splitlines())
    assert outputs["run_scope"] == "test"
    assert outputs["data_dir"] == "data/test"
    assert outputs["group"] == "layout"
    assert outputs["artifact_name"] == "pymupdf-source-stack-123-2"
    assert "/pymupdf-main/main/run-123-attempt-2" in outputs["destination"]

    request = json.loads((tmp_path / "parsebench-output" / "_source_request.json").read_text())
    assert request["mupdf"] == {"ref": "auto", "repository": "ArtifexSoftware/mupdf"}
    assert request["pymupdf"] == {"ref": "main", "repository": "pymupdf/PyMuPDF"}
    assert request["pymupdf_layout"] == {
        "ref": "auto",
        "repository": "ArtifexSoftware/pymupdf_layout",
    }


def test_configure_all_latest_overrides_source_inputs_but_preserves_dataset_version(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(tmp_path / "summary"))
    github_output = tmp_path / "github-output"
    values = {
        "ALL_LATEST": "true",
        "BENCHMARK_REF": "main",
        "DATASET_REF": "d" * 40,
        "GCS_PREFIX": "parsebench/pymupdf_source_stack",
        "GITHUB_OUTPUT": str(github_output),
        "GITHUB_RUN_ATTEMPT": "1",
        "GITHUB_RUN_ID": "456",
        "GROUP_SELECTION": "All categories",
        "LATEST_ANY_BRANCH": "false",
        "PYMUPDF_REF": "a" * 40,
        "RUNNER_TEMP": str(tmp_path),
        "RUN_SCOPE_SELECTION": "Quick test (15 cases)",
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)

    assert configure.main() == 0

    outputs = dict(line.split("=", 1) for line in github_output.read_text().splitlines())
    assert outputs["dataset_ref"] == "d" * 40

    request = json.loads((tmp_path / "parsebench-output" / "_source_request.json").read_text())
    assert request["mupdf"] == {"ref": "auto", "repository": "ArtifexSoftware/mupdf"}
    assert request["pymupdf"] == {"ref": "main", "repository": "pymupdf/PyMuPDF"}


def test_configure_latest_any_branch_uses_resolver_placeholders(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(tmp_path / "summary"))
    github_output = tmp_path / "github-output"
    values = {
        "ALL_LATEST": "false",
        "BENCHMARK_REF": "main",
        "DATASET_REF": "current",
        "GCS_PREFIX": "parsebench/pymupdf_source_stack",
        "GITHUB_OUTPUT": str(github_output),
        "GITHUB_RUN_ATTEMPT": "1",
        "GITHUB_RUN_ID": "789",
        "GROUP_SELECTION": "All categories",
        "LATEST_ANY_BRANCH": "true",
        "PYMUPDF_REF": "1.28.0",
        "RUNNER_TEMP": str(tmp_path),
        "RUN_SCOPE_SELECTION": "Quick test (15 cases)",
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)

    assert configure.main() == 0

    outputs = dict(line.split("=", 1) for line in github_output.read_text().splitlines())
    assert "pymupdf-latest-any-branch" in outputs["destination"]
    request = json.loads((tmp_path / "parsebench-output" / "_source_request.json").read_text())
    assert request["mupdf"]["ref"] == "auto"
    assert all(request[name]["ref"] == "latest-any-branch" for name in configure.SELECTABLE_COMPONENTS)


def test_configure_rejects_both_automatic_latest_modes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(tmp_path / "summary"))
    monkeypatch.setenv("GITHUB_RUN_ID", "123")
    monkeypatch.setenv("ALL_LATEST", "true")
    monkeypatch.setenv("LATEST_ANY_BRANCH", "true")
    monkeypatch.setenv("BENCHMARK_REF", "main")
    monkeypatch.setenv("GROUP_SELECTION", "All categories")
    monkeypatch.setenv("RUN_SCOPE_SELECTION", "Quick test (15 cases)")

    with pytest.raises(SystemExit, match="not both"):
        configure.main()


def test_resolve_refs_records_pinned_shas(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    github_output = tmp_path / "github-output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(github_output))
    monkeypatch.setenv("OUTPUT_DIR", str(tmp_path))
    request_path = tmp_path / "_source_request.json"
    request_path.write_text(
        json.dumps({name: {"ref": "latest" if name == "pymupdf" else "auto"} for name in configure.COMPONENT_SPECS})
    )

    def resolve_ref(self, component, selection):
        assert selection == "latest"
        return SimpleNamespace(
            repository=component.repository,
            requested_ref="2.0",
            selected_branch=None,
            resolved_sha="a" * 40,
        )

    monkeypatch.setattr(resolve_refs.SourceManager, "resolve_ref", resolve_ref)

    def resolve_mupdf(self, pymupdf):
        assert pymupdf.resolved_sha == "a" * 40
        return SimpleNamespace(
            repository="ArtifexSoftware/mupdf", requested_ref="1.28.5", selected_branch=None, resolved_sha="b" * 40
        )

    monkeypatch.setattr(resolve_refs.SourceManager, "resolve_mupdf", resolve_mupdf)
    monkeypatch.setattr(
        resolve_refs.SourceManager,
        "remote_ref",
        lambda self, repository, ref: "a" * 40 if ref == "refs/tags/2.0" else None,
    )

    assert resolve_refs.main() == 0

    outputs = dict(line.split("=", 1) for line in github_output.read_text().splitlines())
    request = json.loads(request_path.read_text())
    for name, component in configure.COMPONENT_SPECS.items():
        sha, ref = ("b" * 40, "1.28.5") if name == "mupdf" else ("a" * 40, "2.0")
        assert outputs[f"{name}_sha"] == sha
        assert outputs[f"{name}_ref"] == ref
        assert request[name] == {
            "selection": "latest" if name == "pymupdf" else "auto",
            "ref": ref,
            "branch": None,
            "repository": component.repository,
            "resolved_sha": sha,
        }


def test_resolve_refs_preserves_diagnostics_on_failure(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    github_output = tmp_path / "github-output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(github_output))
    monkeypatch.setenv("OUTPUT_DIR", str(tmp_path))
    request_path = tmp_path / "_source_request.json"
    request_path.write_text(json.dumps({name: {"ref": "old-release"} for name in configure.COMPONENT_SPECS}))

    def unresolved(*args):
        raise RuntimeError("Only the latest release or current branch heads are supported")

    monkeypatch.setattr(resolve_refs.SourceManager, "resolve_ref", unresolved)

    with pytest.raises(SystemExit, match="Only the latest release"):
        resolve_refs.main()

    failure = json.loads((tmp_path / "_failure.json").read_text())
    assert failure["component"] == "PyMuPDF"
    assert failure["requested_ref"] == "old-release"
    assert not github_output.exists()


def test_resolve_sources_rejects_changed_checkout(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OUTPUT_DIR", str(tmp_path))
    (tmp_path / "_source_request.json").write_text(json.dumps({"pymupdf": {"ref": "main", "resolved_sha": "a" * 40}}))
    monkeypatch.setattr(resolve_sources, "git_sha", lambda root: "b" * 40)

    with pytest.raises(SystemExit, match="differs from the resolved commit"):
        resolve_sources.main()

    failure = json.loads((tmp_path / "_failure.json").read_text())
    assert failure["component"] == "PyMuPDF"
    assert failure["resolved_sha"] == "b" * 40


def test_resolve_sources_exports_absolute_roots_without_standalone_packages(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("OUTPUT_DIR", str(tmp_path))
    github_output = tmp_path / "github-output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(github_output))
    request = {name: {"ref": "main", "resolved_sha": "a" * 40} for name in configure.COMPONENT_SPECS}
    (tmp_path / "_source_request.json").write_text(json.dumps(request))
    monkeypatch.setattr(resolve_sources, "git_sha", lambda root: "a" * 40)
    for component in configure.COMPONENT_SPECS.values():
        (tmp_path / ".source" / component.checkout_dir).mkdir(parents=True)

    assert resolve_sources.main() == 0

    outputs = dict(line.split("=", 1) for line in github_output.read_text().splitlines())
    for name, component in configure.COMPONENT_SPECS.items():
        assert outputs[f"{name}_dir"] == str(tmp_path / ".source" / component.checkout_dir)
        assert outputs[f"{name}_sha"] == "a" * 40


def test_source_summary_links_resolved_commits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(run_summary, "commit_date", lambda root: "2026-09-24 12:34:56 UTC")
    sources = {
        name: {"repository": component.repository, "ref": "feature/current", "resolved_sha": "a" * 40}
        for name, component in configure.COMPONENT_SPECS.items()
    }

    markdown = "\n".join(run_summary.source_table(sources))

    assert "[aaaaaaaaaaaa](https://github.com/pymupdf/PyMuPDF/commit/" + "a" * 40 + ")" in markdown
    assert "`feature/current`" in markdown
    assert "2026-09-24 12:34:56 UTC" in markdown


def test_mupdf_build_spec_pins_exact_sha() -> None:
    sha = "d" * 40

    assert resolve_sources.mupdf_build_spec(sha) == (f"git:--sha {sha} https://github.com/ArtifexSoftware/mupdf.git")


def test_mupdf_build_provenance_accepts_selected_source() -> None:
    sha = "d" * 40
    source = f"git:--sha {sha} https://github.com/ArtifexSoftware/mupdf.git"
    pymupdf = SimpleNamespace(mupdf_location=source, mupdf_version="1.28.0")

    assert provenance.verify_mupdf_build_source(pymupdf, "ArtifexSoftware/mupdf", sha) == {
        "expected_build_source": source,
        "installed_build_source": source,
        "mupdf_version": "1.28.0",
        "verified": True,
    }


@pytest.mark.parametrize("reported_source", [None, "https://mupdf.com/downloads/archive/mupdf-1.28.0-source.tar.gz"])
def test_mupdf_build_provenance_rejects_missing_or_fixed_source(reported_source: str | None) -> None:
    pymupdf = SimpleNamespace(mupdf_location=reported_source, mupdf_version="1.28.0")

    with pytest.raises(RuntimeError, match="fixed default MuPDF"):
        provenance.verify_mupdf_build_source(pymupdf, "ArtifexSoftware/mupdf", "d" * 40)


def test_evaluation_groups_expands_text_categories(tmp_path: Path) -> None:
    for group in ("chart", "text"):
        group_dir = tmp_path / group
        group_dir.mkdir()
        (group_dir / "case.result.json").touch()

    assert benchmark.evaluation_groups(tmp_path) == ["chart", "text_content", "text_formatting"]


def test_evaluation_groups_rejects_missing_inference_results(tmp_path: Path) -> None:
    with pytest.raises(SystemExit, match="No inference result groups found"):
        benchmark.evaluation_groups(tmp_path)


@pytest.mark.parametrize(("scope", "branch"), [("full", "main"), ("test", "test-data")])
def test_dataset_branch_matches_run_scope(scope: str, branch: str) -> None:
    assert resolve_dataset.branch_for_scope(scope) == branch


def test_resolve_dataset_records_immutable_revision(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(tmp_path / "summary"))
    github_output = tmp_path / "github-output"
    output_dir = tmp_path / "output"
    sha = "a" * 40
    monkeypatch.setenv("GITHUB_OUTPUT", str(github_output))
    monkeypatch.setenv("DATASET_REF", "current")
    monkeypatch.setenv("OUTPUT_DIR", str(output_dir))
    monkeypatch.setenv("RUN_SCOPE", "test")
    monkeypatch.setattr(resolve_dataset, "resolve_branch", lambda repository, branch: sha)

    assert resolve_dataset.main() == 0

    outputs = dict(line.split("=", 1) for line in github_output.read_text().splitlines())
    assert outputs["branch"] == "test-data"
    assert outputs["sha"] == sha
    dataset = json.loads((output_dir / "_dataset.json").read_text())
    assert dataset["repository"] == "llamaindex/ParseBench"
    assert dataset["requested_ref"] == "current"
    assert dataset["resolved_sha"] == sha


def test_resolve_dataset_retries_and_records_git_stderr(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    output_dir = tmp_path / "output"
    calls: list[list[str]] = []
    sleeps: list[int] = []
    monkeypatch.setenv("DATASET_REF", "current")
    monkeypatch.setenv("GITHUB_OUTPUT", str(tmp_path / "github-output"))
    monkeypatch.setenv("OUTPUT_DIR", str(output_dir))
    monkeypatch.setenv("RUN_SCOPE", "full")

    def failed_git(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        calls.append(command)
        assert kwargs == {"check": False, "capture_output": True, "text": True}
        return subprocess.CompletedProcess(
            command,
            128,
            stdout="",
            stderr="fatal: unable to access remote: HTTP 503",
        )

    monkeypatch.setattr(resolve_dataset.subprocess, "run", failed_git)
    monkeypatch.setattr(resolve_dataset.time, "sleep", sleeps.append)

    with pytest.raises(SystemExit, match="HTTP 503"):
        resolve_dataset.main()

    assert len(calls) == 3
    assert sleeps == [1, 2]
    failure = json.loads((output_dir / "_failure.json").read_text())
    assert failure["title"] == "Cannot resolve ParseBench dataset branch"
    assert failure["component"] == "Hugging Face dataset Git hosting"
    assert failure["requested_ref"] == "main"
    assert failure["git_exit_code"] == 128
    assert failure["git_stderr"] == "fatal: unable to access remote: HTTP 503"
    assert failure["attempts"] == 3
    assert "Exit code: 128" in failure["details"]
    assert "fatal: unable to access remote: HTTP 503" in failure["details"]


def test_resolve_dataset_retry_can_recover(monkeypatch: pytest.MonkeyPatch) -> None:
    sha = "e" * 40
    results = iter(
        [
            subprocess.CompletedProcess([], 128, stdout="", stderr="temporary failure"),
            subprocess.CompletedProcess([], 0, stdout=f"{sha}\trefs/heads/main\n", stderr=""),
        ]
    )
    sleeps: list[int] = []
    monkeypatch.setattr(resolve_dataset.subprocess, "run", lambda *args, **kwargs: next(results))
    monkeypatch.setattr(resolve_dataset.time, "sleep", sleeps.append)

    assert resolve_dataset.resolve_branch("llamaindex/ParseBench", "main") == sha
    assert sleeps == [1]


def test_resolve_dataset_classifies_explicit_sha_independently_of_requested_scope(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(tmp_path / "summary"))
    github_output = tmp_path / "github-output"
    sha = "d" * 40
    monkeypatch.setenv("DATASET_REF", sha.upper())
    monkeypatch.setenv("GITHUB_OUTPUT", str(github_output))
    monkeypatch.setenv("OUTPUT_DIR", str(tmp_path / "output"))
    monkeypatch.setenv("RUN_SCOPE", "full")
    monkeypatch.setattr(resolve_dataset, "validate_commit", lambda repository, revision: revision)
    monkeypatch.setattr(
        resolve_dataset,
        "resolve_branch",
        lambda repository, branch: sha if branch == "test-data" else "e" * 40,
    )

    assert resolve_dataset.main() == 0

    outputs = dict(line.split("=", 1) for line in github_output.read_text().splitlines())
    assert outputs["requested_ref"] == sha
    assert outputs["sha"] == sha
    assert outputs["profile"] == "test"
    dataset = json.loads((tmp_path / "output" / "_dataset.json").read_text())
    assert dataset["branch"] == "test-data"
    assert dataset["requested_scope"] == "full"


def test_resolve_dataset_rejects_ambiguous_version(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATASET_REF", "main")
    monkeypatch.setenv("GITHUB_OUTPUT", str(tmp_path / "github-output"))
    monkeypatch.setenv("OUTPUT_DIR", str(tmp_path / "output"))
    monkeypatch.setenv("RUN_SCOPE", "full")

    with pytest.raises(SystemExit, match="full 40-character commit SHA"):
        resolve_dataset.main()


def _write_report(path: Path, *, total: int, metrics: dict[str, float]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"total_examples": total, "aggregate_metrics": metrics}),
        encoding="utf-8",
    )


def test_results_summary_uses_dashboard_headline_metrics_and_overall_average(tmp_path: Path) -> None:
    _write_report(
        tmp_path / "table" / "_evaluation_report.json",
        total=3,
        metrics={"avg_grits_trm_composite": 0.6, "avg_rule_pass_rate": 0.9},
    )
    _write_report(
        tmp_path / "text_content" / "_evaluation_report.json",
        total=4,
        metrics={"avg_content_faithfulness": 0.8, "avg_rule_pass_rate_judge": 1.0},
    )

    scores = results_summary.load_scores(tmp_path, "all")
    markdown, data = results_summary.build_summary(scores)

    assert data["overall_score"] == pytest.approx(0.7)
    assert "Overall aggregate score: **70.0%**" in markdown
    assert "| Table | GriTS table score | 60.0% | 3 |" in markdown
    assert "| Text Content | Content faithfulness | 80.0% | 4 |" in markdown


def test_results_summary_supports_single_category_report(tmp_path: Path) -> None:
    _write_report(
        tmp_path / "_evaluation_report.json",
        total=2,
        metrics={"avg_layout_element_rule_pass_rate": 0.75},
    )

    scores = results_summary.load_scores(tmp_path, "layout")

    assert scores == [results_summary.CategoryScore("layout", "layout_element_rule_pass_rate", 0.75, 2)]


def test_results_summary_falls_back_to_rule_pass_rate(tmp_path: Path) -> None:
    _write_report(
        tmp_path / "chart" / "_evaluation_report.json",
        total=1,
        metrics={"avg_rule_pass_rate": 0.25, "avg_rule_pass_rate_judge": 0.5},
    )

    scores = results_summary.load_scores(tmp_path, "all")

    assert scores[0].metric == "rule_pass_rate"
    assert scores[0].score == 0.25
