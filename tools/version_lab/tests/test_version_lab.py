from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

VERSION_LAB_SRC = Path(__file__).parents[1] / "src"
WORKFLOW = Path(__file__).parents[3] / ".github" / "workflows" / "pymupdf-source-stack-parsebench.yml"
INDEX_WORKFLOW = Path(__file__).parents[3] / ".github" / "workflows" / "pymupdf-source-stack-index.yml"
RECONCILE_WORKFLOW = Path(__file__).parents[3] / ".github" / "workflows" / "pymupdf-source-stack-reconcile.yml"
sys.path.insert(0, str(VERSION_LAB_SRC))

from parsebench_version_lab import cli, local  # noqa: E402
from parsebench_version_lab.local import LocalRun, create_paths, ensure_ready, package_dir  # noqa: E402
from parsebench_version_lab.model import (  # noqa: E402
    COMPONENT_SPECS,
    DEFAULT_PIPELINE,
    MODERN_RAPIDOCR_PIPELINE,
    PIPELINES,
    RunConfig,
)
from parsebench_version_lab.process import (  # noqa: E402
    CommandRunner,
    runtime_environment,
    subprocess_environment,
    venv_executable,
)
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

    assert "type: choice" in pipeline_input
    assert (
        tuple(
            line.removeprefix('          - "').removesuffix('"')
            for line in pipeline_input.splitlines()
            if line.startswith('          - "')
        )
        == PIPELINES
    )
    assert "PIPELINE: ${{ inputs.pipeline }}" in workflow


def test_github_indexing_is_independent_from_the_benchmark_outcome() -> None:
    benchmark_workflow = WORKFLOW.read_text(encoding="utf-8")
    index_workflow = INDEX_WORKFLOW.read_text(encoding="utf-8")
    reconcile_workflow = RECONCILE_WORKFLOW.read_text(encoding="utf-8")

    assert "PARSEBENCH_SUPABASE_SECRET_KEY" not in benchmark_workflow
    assert "index_results:" not in benchmark_workflow
    assert "workflow_run:" in index_workflow
    assert "- ParseBench Version Lab" in index_workflow
    assert "- completed" in index_workflow
    assert "workflow_dispatch:" in index_workflow
    assert "SOURCE_WORKFLOW: pymupdf-source-stack-parsebench.yml" in index_workflow
    assert "PARSEBENCH_SUPABASE_SECRET_KEY" in index_workflow
    assert 'run: python3 "$WORKFLOW_SCRIPTS/index_results.py"' in index_workflow
    assert 'run: .venv/bin/python -m parsebench_version_lab.dashboard_diagnostics "$OUTPUT_DIR"' in benchmark_workflow
    assert benchmark_workflow.index("Prepare dashboard diagnostics") > benchmark_workflow.index(
        "Generate ParseBench reports"
    )
    assert benchmark_workflow.index("Prepare dashboard diagnostics") < benchmark_workflow.index(
        "Upload source-stack GitHub artifact"
    )
    assert "github-token: ${{ github.token }}" in index_workflow
    assert "The scheduled reconciliation will retry from GitHub and then GCS." in index_workflow
    assert "schedule:" not in index_workflow
    assert "GCP_SA_KEY" not in index_workflow

    assert "workflow_run:" not in reconcile_workflow
    assert "schedule:" in reconcile_workflow
    assert "workflow_dispatch:" in reconcile_workflow
    assert "PARSEBENCH_SUPABASE_SECRET_KEY" in reconcile_workflow
    assert "GCP_SA_KEY" in reconcile_workflow
    assert 'run: python3 "$WORKFLOW_SCRIPTS/reconcile_results.py"' in reconcile_workflow


def test_github_workflow_installs_and_verifies_modern_rapidocr_only_for_its_pipeline() -> None:
    workflow = WORKFLOW.read_text(encoding="utf-8")

    assert f"MODERN_RAPIDOCR_PIPELINE: {MODERN_RAPIDOCR_PIPELINE}" in workflow
    assert "sync_args+=(--extra rapidocr-modern)" in workflow
    assert f"inputs.pipeline == '{MODERN_RAPIDOCR_PIPELINE}'" in workflow
    assert f"inputs.pipeline != '{MODERN_RAPIDOCR_PIPELINE}'" in workflow
    assert "Expected modern rapidocr backend" in workflow
    assert "lacks native table_output support" in workflow


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


def test_source_manager_limits_sources_to_latest_release_and_current_branches(tmp_path: Path) -> None:
    remote = tmp_path / "remote"
    remote.mkdir()
    subprocess.run(["git", "init", "--quiet", remote], check=True)
    subprocess.run(["git", "-C", remote, "config", "user.name", "Version Lab Test"], check=True)
    subprocess.run(["git", "-C", remote, "config", "user.email", "version-lab@example.invalid"], check=True)
    (remote / "file.txt").write_text("selected source\n", encoding="utf-8")
    subprocess.run(["git", "-C", remote, "add", "file.txt"], check=True)
    subprocess.run(["git", "-C", remote, "commit", "--quiet", "-m", "test source"], check=True)
    subprocess.run(["git", "-C", remote, "branch", "feature/current"], check=True)
    subprocess.run(["git", "-C", remote, "tag", "-a", "1.28.2", "-m", "release"], check=True)
    subprocess.run(["git", "-C", remote, "tag", "1.27.0"], check=True)
    expected = subprocess.check_output(["git", "-C", remote, "rev-parse", "HEAD"], text=True).strip()

    manager = SourceManager(CommandRunner(verbose=False))
    manager.remote = lambda repository: str(remote)  # type: ignore[method-assign]
    manager.latest_release = lambda package: "1.28.2"  # type: ignore[method-assign]
    component = COMPONENT_SPECS["pymupdf4llm"]

    for ref in ("latest", "1.28.2", "feature/current"):
        source = manager.resolve_component(component, RunConfig(pymupdf4llm_ref=ref), tmp_path / ref)
        assert source.resolved_sha == expected
        assert source.requested_ref == ("1.28.2" if ref == "latest" else ref)
        assert source.selected_branch == (ref if ref == "feature/current" else None)
        assert (source.path / "file.txt").read_text(encoding="utf-8") == "selected source\n"

    for ref in ("1.27.0", expected, "missing-branch"):
        with pytest.raises(ValueError, match="Historical tags and commit SHAs are not supported"):
            manager.resolve_ref(component, ref)


def test_create_paths_keeps_environment_inside_unique_run(tmp_path: Path) -> None:
    paths = create_paths(tmp_path, tmp_path / ".version-lab")

    assert paths.environment.parent == paths.run
    assert paths.sources.parent == paths.run
    assert paths.run.parent == tmp_path / ".version-lab"


def test_package_dir_supports_current_experimenting_branch_layout(tmp_path: Path) -> None:
    package = tmp_path / "pymupdf4llm"
    package.mkdir()
    (package / "setup.py").touch()
    source = ResolvedSource("pymupdf4llm", "PyMuPDF4LLM", "owner/repo", "experimenting", "a" * 40, tmp_path)

    assert package_dir(source) == package


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
    assert paths.repository / "tools" / "version_lab" in runner.calls[1]["command"]
    assert "--extra" not in runner.calls[1]["command"]
    assert local.SWIG_REQUIREMENT in runner.calls[2]["command"]


def test_modern_rapidocr_pipeline_adds_only_its_locked_environment_extra(tmp_path: Path) -> None:
    class RecordingRunner:
        def __init__(self) -> None:
            self.calls: list[dict[str, object]] = []

        def run(self, command: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
            self.calls.append({"command": command, **kwargs})
            return subprocess.CompletedProcess([], 0, stdout="", stderr="")

    paths = create_paths(tmp_path, tmp_path / ".version-lab")
    runner = RecordingRunner()

    LocalRun(
        RunConfig(pipeline=MODERN_RAPIDOCR_PIPELINE),
        paths,
        runner=runner,
    ).create_environment()  # type: ignore[arg-type]

    sync_command = runner.calls[1]["command"]
    assert "--extra" in sync_command
    assert "rapidocr-modern" in sync_command


def test_stack_build_uses_one_swig_for_pymupdf_and_layout(tmp_path: Path) -> None:
    class RecordingRunner:
        def __init__(self) -> None:
            self.calls: list[dict[str, object]] = []

        def run(self, command: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
            self.calls.append({"command": command, **kwargs})
            return subprocess.CompletedProcess([], 0, stdout="", stderr="")

    paths = create_paths(tmp_path, tmp_path / ".version-lab")
    runner = RecordingRunner()
    run = LocalRun(RunConfig(), paths, runner=runner)  # type: ignore[arg-type]
    sources = {}
    for name, label in (
        ("mupdf", "MuPDF"),
        ("pymupdf", "PyMuPDF"),
        ("pymupdf_layout", "PyMuPDF Layout"),
        ("pymupdf4llm", "PyMuPDF4LLM"),
    ):
        source_path = tmp_path / name
        source_path.mkdir()
        if name != "mupdf":
            (source_path / "pyproject.toml").touch()
        sources[name] = ResolvedSource(name, label, f"owner/{name}", "main", "a" * 40, source_path)
    run.sources = sources

    run.build_stack(venv_executable(paths.environment, "python"))

    expected_swig = str(venv_executable(paths.environment, "swig"))
    pymupdf_environment = runner.calls[0]["env"]
    layout_environment = runner.calls[1]["env"]
    assert isinstance(pymupdf_environment, dict)
    assert isinstance(layout_environment, dict)
    assert pymupdf_environment["PYMUPDF_SETUP_SWIG"] == expected_swig
    assert layout_environment["PYMUPDF_LAYOUT_SETUP_SWIG"] == expected_swig


def test_venv_python_path_is_platform_specific(tmp_path: Path) -> None:
    expected = tmp_path / ("Scripts/python.exe" if os.name == "nt" else "bin/python")

    assert venv_executable(tmp_path, "python") == expected


def test_runtime_environment_forces_utf8_for_cross_platform_documents(tmp_path: Path) -> None:
    environment = runtime_environment(tmp_path, {"PYTHONUTF8": "0", "PYTHONIOENCODING": "ascii"})

    assert environment["PYTHONUTF8"] == "1"
    assert environment["PYTHONIOENCODING"] == "utf-8"


def test_local_run_disables_optional_llm_normalization(tmp_path: Path) -> None:
    paths = create_paths(tmp_path, tmp_path / ".version-lab")
    run = LocalRun(RunConfig(), paths)
    run.dataset = local.DatasetRevision("owner/dataset", "current", "test-data", "a" * 40, "https://example.invalid")

    assert run.runtime_env()["LLAMACLOUD_BENCH_LLM_NORMALIZATION"] == "off"


def test_subprocess_environment_does_not_forward_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PATH", "/test/bin")
    monkeypatch.setenv("SERVICE_API_KEY", "secret-value")
    monkeypatch.setenv("SERVICE_TOKEN", "secret-value")

    environment = subprocess_environment({"BUILD_SETTING": "enabled"})

    assert environment["PATH"] == "/test/bin"
    assert environment["BUILD_SETTING"] == "enabled"
    assert "SERVICE_API_KEY" not in environment
    assert "SERVICE_TOKEN" not in environment


@pytest.mark.parametrize("system", local.SUPPORTED_SYSTEMS)
@pytest.mark.parametrize(("languages", "ready"), [("eng\nosd\n", True), ("osd\n", False)])
def test_doctor_checks_cross_platform_toolchain_and_english_tesseract(
    system: str,
    languages: str,
    ready: bool,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(local, "executable", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(local.platform, "system", lambda: system)
    monkeypatch.setattr(
        local.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess([], 0, stdout=languages, stderr=""),
    )

    status = local.doctor()

    assert status["supported_platform"] is True
    assert status["checks"]["tesseract_english"] is ready
    assert status["ready"] is ready


def test_doctor_rejects_unknown_platform(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(local, "executable", lambda name: f"/tools/{name}")
    monkeypatch.setattr(local.platform, "system", lambda: "Plan9")
    monkeypatch.setattr(
        local.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess([], 0, stdout="eng\n", stderr=""),
    )

    status = local.doctor()

    assert status["supported_platform"] is False
    assert status["ready"] is False


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


@pytest.mark.parametrize(
    ("command", "expected_options"),
    [
        (
            "plan",
            (
                "--mupdf-ref",
                "--pymupdf-ref",
                "--pymupdf-layout-ref",
                "--pymupdf4llm-ref",
                "--dataset-ref",
                "--pipeline",
                "--scope",
                "--group",
                "--all-latest",
                "--latest-any-branch",
                "--python",
            ),
        ),
        (
            "run",
            (
                "--mupdf-ref",
                "--pymupdf-ref",
                "--pymupdf-layout-ref",
                "--pymupdf4llm-ref",
                "--dataset-ref",
                "--pipeline",
                "--scope",
                "--group",
                "--all-latest",
                "--latest-any-branch",
                "--python",
                "--workspace",
                "--resolve-only",
            ),
        ),
    ],
)
def test_cli_help_documents_every_option(
    command: str,
    expected_options: tuple[str, ...],
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit) as exit_info:
        cli.main([command, "--help"])

    assert exit_info.value.code == 0
    help_text = capsys.readouterr().out
    assert all(option in help_text for option in expected_options)
    assert "(default:" in help_text
    assert "latest PyPI release tag" in help_text
