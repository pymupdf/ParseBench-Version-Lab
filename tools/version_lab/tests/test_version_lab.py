from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

VERSION_LAB_SRC = Path(__file__).parents[1] / "src"
WORKFLOW = Path(__file__).parents[3] / ".github" / "workflows" / "pymupdf-source-stack-parsebench.yml"
ENVIRONMENT_WORKFLOW = (
    Path(__file__).parents[3] / ".github" / "workflows" / "pymupdf-source-stack-environment.yml"
)
sys.path.insert(0, str(VERSION_LAB_SRC))

from parsebench_version_lab import cli, local  # noqa: E402
from parsebench_version_lab.local import LocalRun, create_paths, ensure_ready, package_dir  # noqa: E402
from parsebench_version_lab.model import DEFAULT_PIPELINE, PIPELINES, RunConfig  # noqa: E402
from parsebench_version_lab.process import CommandRunner, venv_executable  # noqa: E402
from parsebench_version_lab.sources import ResolvedSource, SourceManager, parse_branch_heads  # noqa: E402


def test_run_config_normalizes_latest_refs_and_scope() -> None:
    config = RunConfig(all_latest=True, scope="quick", group="table")

    assert config.refs == {
        "mupdf": "master",
        "pymupdf": "main",
        "pymupdf_layout": "main",
        "pymupdf4llm": "main",
    }
    assert config.run_scope == "test"
    assert config.dataset_branch == "test-data"


def test_run_config_rejects_conflicting_latest_modes() -> None:
    with pytest.raises(ValueError, match="not both"):
        RunConfig(all_latest=True, latest_any_branch=True)


def test_run_config_defaults_to_150dpi_pipeline_and_accepts_registered_variants() -> None:
    assert RunConfig().pipeline == DEFAULT_PIPELINE == "pymupdf4llm_markdown_150dpi"
    assert RunConfig(pipeline="pymupdf4llm_markdown_no_ocr").pipeline == "pymupdf4llm_markdown_no_ocr"


def test_run_config_rejects_unknown_pipeline() -> None:
    with pytest.raises(ValueError, match="Unsupported pipeline"):
        RunConfig(pipeline="unknown_pipeline")


def test_github_workflow_pipeline_dropdown_matches_local_choices() -> None:
    workflow = WORKFLOW.read_text(encoding="utf-8")
    pipeline_input = workflow.split("      pipeline:\n", 1)[1].split("      dataset_version:\n", 1)[0]

    assert f'default: "{DEFAULT_PIPELINE}"' in pipeline_input
    assert 'type: choice' in pipeline_input
    assert tuple(
        line.removeprefix('          - "').removesuffix('"')
        for line in pipeline_input.splitlines()
        if line.startswith('          - "')
    ) == PIPELINES
    assert "PIPELINE: ${{ inputs.pipeline }}" in workflow


def test_github_run_name_identifies_selected_benchmark_configuration() -> None:
    workflow = WORKFLOW.read_text(encoding="utf-8")
    run_name = workflow.split("run-name: >-\n", 1)[1].split("\non:\n", 1)[0]

    for selection in (
        "inputs.pipeline",
        "inputs.mupdf_ref",
        "inputs.pymupdf_ref",
        "inputs.pymupdf_layout_ref",
        "inputs.pymupdf4llm_ref",
        "inputs.run_scope",
        "inputs.group",
        "inputs.dataset_version",
    ):
        assert selection in run_name
    for concise_label in (
        "'Latest branch'",
        "'Latest default'",
        "'Quick 15'",
        "'Full ~2k'",
    ):
        assert concise_label in run_name
    assert "'BENCH" not in run_name
    assert "workflow@" not in run_name
    assert "M:{0},P:{1},L:{2},4:{3}" in run_name
    assert "'{0} · {1} · {2} · {3} · data:{4}'" in run_name


def test_container_publisher_is_isolated_from_benchmark_workflow() -> None:
    benchmark_workflow = WORKFLOW.read_text(encoding="utf-8")
    environment_workflow = ENVIRONMENT_WORKFLOW.read_text(encoding="utf-8")

    for publisher_detail in (
        "rebuild_environment",
        "build_environment:",
        "docker/build-push-action@",
        "docker/login-action@",
        "ENVIRONMENT_VERSION_TAG",
    ):
        assert publisher_detail not in benchmark_workflow

    for publisher_detail in (
        "name: Build ParseBench Version Lab Environment",
        "workflow_dispatch:",
        "build_environment:",
        "docker/build-push-action@",
        "docker/login-action@",
        "ENVIRONMENT_VERSION_TAG",
        ".github/docker/pymupdf-source-stack/Dockerfile",
    ):
        assert publisher_detail in environment_workflow


def test_run_config_marks_latest_any_branch_refs_as_dynamic() -> None:
    config = RunConfig(latest_any_branch=True)

    assert config.refs == dict.fromkeys(
        ("mupdf", "pymupdf", "pymupdf_layout", "pymupdf4llm"),
        "latest-any-branch",
    )


def test_parse_branch_heads_uses_deterministic_newest_commit() -> None:
    output = "\n".join(
        [
            f"main\t{'a' * 40}\t100",
            f"feature/new\t{'b' * 40}\t101",
            f"feature/z-tie\t{'c' * 40}\t101",
        ]
    )

    assert parse_branch_heads(output, "owner/repo").branch == "feature/z-tie"


def test_source_manager_checks_out_exact_local_ref(tmp_path: Path) -> None:
    remote = tmp_path / "remote"
    remote.mkdir()
    subprocess.run(["git", "init", "--quiet", remote], check=True)
    subprocess.run(["git", "-C", remote, "config", "user.name", "Version Lab Test"], check=True)
    subprocess.run(["git", "-C", remote, "config", "user.email", "version-lab@example.invalid"], check=True)
    (remote / "file.txt").write_text("selected source\n", encoding="utf-8")
    subprocess.run(["git", "-C", remote, "add", "file.txt"], check=True)
    subprocess.run(["git", "-C", remote, "commit", "--quiet", "-m", "test source"], check=True)
    expected = subprocess.check_output(["git", "-C", remote, "rev-parse", "HEAD"], text=True).strip()

    manager = SourceManager(CommandRunner(verbose=False))
    manager.remote = lambda repository: str(remote)  # type: ignore[method-assign]
    destination = tmp_path / "checkout"

    assert manager.checkout("owner/repo", expected, destination) == expected
    assert (destination / "file.txt").read_text(encoding="utf-8") == "selected source\n"


def test_package_dir_supports_nested_layout_package(tmp_path: Path) -> None:
    root = tmp_path / "layout"
    package = root / "pymupdf_layout"
    package.mkdir(parents=True)
    (package / "pyproject.toml").touch()
    source = ResolvedSource(
        "pymupdf_layout",
        "PyMuPDF Layout",
        "owner/layout",
        "main",
        "a" * 40,
        root,
    )

    assert package_dir(source) == package


def test_create_paths_keeps_environment_inside_unique_run(tmp_path: Path) -> None:
    paths = create_paths(tmp_path, tmp_path / ".version-lab")

    assert paths.environment.parent == paths.run
    assert paths.sources.parent == paths.run
    assert paths.run.parent == tmp_path / ".version-lab"


def test_environment_creation_does_not_reuse_controller_virtualenv(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class RecordingRunner:
        def __init__(self) -> None:
            self.calls: list[dict[str, object]] = []

        def run(self, command: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
            self.calls.append({"command": command, **kwargs})
            return subprocess.CompletedProcess([], 0, stdout="", stderr="")

    monkeypatch.setenv("VIRTUAL_ENV", str(tmp_path / "controller-environment"))
    paths = create_paths(tmp_path, tmp_path / ".version-lab")
    runner = RecordingRunner()

    LocalRun(RunConfig(), paths, runner=runner).create_environment()  # type: ignore[arg-type]

    sync_environment = runner.calls[1]["env"]
    assert isinstance(sync_environment, dict)
    assert "VIRTUAL_ENV" not in sync_environment
    assert sync_environment["UV_PROJECT_ENVIRONMENT"] == str(paths.environment)


def test_venv_python_path_is_platform_specific(tmp_path: Path) -> None:
    expected = tmp_path / ("Scripts/python.exe" if os.name == "nt" else "bin/python")

    assert venv_executable(tmp_path, "python") == expected


@pytest.mark.parametrize(("languages", "ready"), [("eng\nosd\n", True), ("osd\n", False)])
def test_doctor_checks_linux_toolchain_and_english_tesseract(
    languages: str,
    ready: bool,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(local, "executable", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(local.platform, "system", lambda: "Linux")
    monkeypatch.setattr(
        local.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess([], 0, stdout=languages, stderr=""),
    )

    status = local.doctor()

    assert status["checks"]["tesseract_english"] is ready
    assert status["ready"] is ready


def test_resolve_only_requires_git_but_not_build_tools(monkeypatch: pytest.MonkeyPatch) -> None:
    tools: dict[str, str | None] = dict.fromkeys(local.REQUIRED_TOOLS)
    tools["git"] = "/usr/bin/git"
    monkeypatch.setattr(
        local,
        "doctor",
        lambda: {
            "checks": {"tesseract_english": False},
            "supported_platform": True,
            "tools": tools,
        },
    )

    ensure_ready(resolve_only=True)
    with pytest.raises(RuntimeError, match="uv"):
        ensure_ready()


def test_cli_plan_is_machine_readable(capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main(["plan", "--all-latest", "--scope", "quick", "--group", "layout"]) == 0

    plan = json.loads(capsys.readouterr().out)
    assert plan["refs"]["mupdf"] == "master"
    assert plan["run_scope"] == "test"
    assert plan["group"] == "layout"


def test_cli_plan_marks_latest_any_branch_refs_as_dynamic(capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main(["plan", "--latest-any-branch"]) == 0

    plan = json.loads(capsys.readouterr().out)
    assert set(plan["refs"].values()) == {"latest-any-branch"}


@pytest.mark.parametrize("pipeline", PIPELINES)
def test_cli_plan_accepts_every_registered_pymupdf4llm_pipeline(
    pipeline: str,
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert cli.main(["plan", "--pipeline", pipeline]) == 0

    plan = json.loads(capsys.readouterr().out)
    assert plan["pipeline"] == pipeline
