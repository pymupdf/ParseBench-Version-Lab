from __future__ import annotations

import io
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

VERSION_LAB_SRC = Path(__file__).parents[1] / "src"
WORKFLOW = Path(__file__).parents[3] / ".github" / "workflows" / "pymupdf-source-stack-parsebench.yml"
INDEX_WORKFLOW = Path(__file__).parents[3] / ".github" / "workflows" / "pymupdf-source-stack-index.yml"
RECONCILE_WORKFLOW = Path(__file__).parents[3] / ".github" / "workflows" / "pymupdf-source-stack-reconcile.yml"
sys.path.insert(0, str(VERSION_LAB_SRC))

from parsebench_version_lab import cli, local, provenance, runtime_check, sources  # noqa: E402
from parsebench_version_lab.local import LocalRun, create_paths, ensure_ready  # noqa: E402
from parsebench_version_lab.model import (  # noqa: E402
    COMPONENT_SPECS,
    DEFAULT_PIPELINE,
    RunConfig,
)
from parsebench_version_lab.process import (  # noqa: E402
    CommandRunner,
    runtime_environment,
    subprocess_environment,
    venv_executable,
)
from parsebench_version_lab.sources import ResolvedSource, SourceManager  # noqa: E402


def test_run_config_normalizes_branch_and_scope() -> None:
    config = RunConfig(pymupdf_branch=" main ", scope="quick", group="table")

    assert config.refs == {
        "mupdf": "auto",
        "pymupdf": "main",
        "pymupdf_layout": "auto",
        "pymupdf4llm": "auto",
    }
    assert config.run_scope == "test"
    assert config.dataset_branch == "test-data"


def test_run_config_requires_branch_and_fixes_pipeline_and_dataset() -> None:
    with pytest.raises(ValueError, match="branch name is required"):
        RunConfig(pymupdf_branch=" ")
    assert RunConfig().pipeline == DEFAULT_PIPELINE == "pymupdf4llm_html_tables_rapidocr_v3"
    assert RunConfig().dataset_ref == "current"
    with pytest.raises(TypeError):
        RunConfig(pipeline="pymupdf4llm_markdown_no_ocr")
    with pytest.raises(TypeError):
        RunConfig(dataset_ref="a" * 40)


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


def test_github_workflow_uses_current_rapidocr_for_every_pipeline() -> None:
    publisher = WORKFLOW.with_name("pymupdf-source-stack-environment.yml").read_text(encoding="utf-8")
    for workflow in (WORKFLOW.read_text(encoding="utf-8"), publisher):
        assert "from rapidocr import RapidOCR" in workflow
        assert "rapidocr_onnxruntime" not in workflow
        assert "rapidocr-onnxruntime" not in workflow
        assert "--extra rapidocr-modern" not in workflow
    assert "uv sync --project /workspace/tools/version_lab --locked" in publisher


def test_source_manager_accepts_branches_and_rejects_tags_and_commits(tmp_path: Path) -> None:
    remote = tmp_path / "remote"
    remote.mkdir()
    subprocess.run(["git", "init", "--quiet", remote], check=True)
    subprocess.run(["git", "-C", remote, "config", "user.name", "Version Lab Test"], check=True)
    subprocess.run(["git", "-C", remote, "config", "user.email", "version-lab@example.invalid"], check=True)
    (remote / "file.txt").write_text("selected source\n", encoding="utf-8")
    subprocess.run(["git", "-C", remote, "add", "file.txt"], check=True)
    subprocess.run(["git", "-C", remote, "commit", "--quiet", "-m", "test source"], check=True)
    subprocess.run(["git", "-C", remote, "branch", "feature/current"], check=True)
    subprocess.run(["git", "-C", remote, "tag", "-a", "2.0", "-m", "release"], check=True)
    subprocess.run(["git", "-C", remote, "tag", "1.27.0"], check=True)
    expected = subprocess.check_output(["git", "-C", remote, "rev-parse", "HEAD"], text=True).strip()

    manager = SourceManager(CommandRunner(verbose=False))
    manager.remote = lambda repository: str(remote)  # type: ignore[method-assign]
    component = COMPONENT_SPECS["pymupdf"]

    for ref in ("feature/current",):
        source = manager.resolve_component(component, RunConfig(pymupdf_branch=ref), tmp_path / ref)
        assert source.resolved_sha == expected
        assert source.requested_ref == ref
        assert source.selected_branch == ref
        assert (source.path / "file.txt").read_text(encoding="utf-8") == "selected source\n"

    for ref in ("latest", "2.0", "1.27.0", expected, "missing-branch"):
        with pytest.raises(ValueError, match="Release tags and commit SHAs are not accepted"):
            manager.resolve_branch(component, ref)


def test_create_paths_keeps_environment_inside_unique_run(tmp_path: Path) -> None:
    paths = create_paths(tmp_path, tmp_path / ".version-lab")

    assert paths.environment.parent == paths.run
    assert paths.sources.parent == paths.run
    assert paths.run.parent == tmp_path / ".version-lab"


def test_mupdf_release_uses_native_version_from_pinned_pymupdf_source(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = SourceManager(CommandRunner(verbose=False))
    refs = {
        ("pymupdf/PyMuPDF", "refs/tags/2.0"): "a" * 40,
        ("ArtifexSoftware/mupdf", "refs/tags/1.28.5"): "b" * 40,
    }
    monkeypatch.setattr(manager, "remote_ref", lambda repository, ref: refs.get((repository, ref)))

    def read_setup(url: str, *, timeout: int) -> io.BytesIO:
        assert url == f"https://raw.githubusercontent.com/pymupdf/PyMuPDF/{'a' * 40}/setup.py"
        return io.BytesIO(b"version_p = '2.0'\nversion_mupdf = '1.28.5'\nraise RuntimeError('do not execute')\n")

    monkeypatch.setattr(sources, "urlopen", read_setup)
    pymupdf = ResolvedSource("pymupdf", "PyMuPDF", "pymupdf/PyMuPDF", "feature/current", "a" * 40, Path("."))
    source = manager.resolve_mupdf(pymupdf)
    assert source.requested_ref == "1.28.5"
    assert source.resolved_sha == "b" * 40


@pytest.mark.parametrize("name", ["pymupdf_layout", "pymupdf4llm"])
def test_companion_sources_follow_pymupdf_selection(name: str, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    manager = SourceManager(CommandRunner(verbose=False))
    component = COMPONENT_SPECS[name]
    branch = "feature/only-in-pymupdf"
    pymupdf = ResolvedSource("pymupdf", "PyMuPDF", "pymupdf/PyMuPDF", branch, "a" * 40, tmp_path, branch)
    expected_ref = f"refs/heads/{component.default_branch}"

    def remote_ref(repository: str, ref: str) -> str:
        assert repository == component.repository
        assert ref == expected_ref
        return "b" * 40

    monkeypatch.setattr(manager, "remote_ref", remote_ref)
    monkeypatch.setattr(manager, "checkout", lambda repository, sha, destination: sha)
    source = manager.resolve_component(component, RunConfig(pymupdf_branch=branch), tmp_path, pymupdf=pymupdf)
    assert source.resolved_sha == "b" * 40
    assert source.requested_ref == component.default_branch
    assert source.selected_branch == component.default_branch


def test_github_workflow_builds_one_integrated_package() -> None:
    import yaml

    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    launcher = yaml.safe_load(WORKFLOW.with_name("pymupdf-source-stack-launch.yml").read_text(encoding="utf-8"))
    inputs = launcher[True]["workflow_dispatch"]["inputs"]  # PyYAML reads unquoted 'on' as True.
    assert set(inputs) == {"pymupdf_branch", "run_scope", "group"}
    assert inputs["pymupdf_branch"]["default"] == "main"
    assert workflow[True] == {"repository_dispatch": {"types": ["parsebench-version-lab"]}}
    assert "github.event.client_payload.pymupdf_version" in workflow["run-name"]
    assert "PyMuPDF {0}" in workflow["run-name"]
    assert launcher["name"] != workflow["name"]
    assert workflow["env"]["PIPELINE"] == RunConfig().pipeline
    assert "inputs.pipeline" not in WORKFLOW.read_text(encoding="utf-8")
    assert "inputs.pymupdf_layout_ref" not in WORKFLOW.read_text(encoding="utf-8")
    assert "inputs.pymupdf4llm_ref" not in WORKFLOW.read_text(encoding="utf-8")
    steps = [step for job in workflow["jobs"].values() for step in job.get("steps", [])]
    checkouts = [
        step
        for step in steps
        if step.get("uses", "").startswith("actions/checkout@") and "repository" not in step.get("with", {})
    ]
    assert all(step["with"]["ref"] == "${{ github.event.client_payload.benchmark_sha }}" for step in checkouts)
    builds = [step for step in steps if step.get("name", "").startswith("Build and install")]
    assert len(builds) == 1
    environment = builds[0]["env"]
    assert environment["PYMUPDF_SETUP_PATH_LAYOUT"] == "${{ steps.sources.outputs.pymupdf_layout_dir }}"
    assert environment["PYMUPDF_SETUP_PATH_4LLM"] == "${{ steps.sources.outputs.pymupdf4llm_dir }}"
    assert environment["PYMUPDF_SETUP_MUPDF_BUILD"] == "${{ steps.sources.outputs.mupdf_build }}"


@pytest.mark.parametrize("mismatch", [None, "pymupdf", "pymupdf_layout", "pymupdf4llm"])
def test_integrated_provenance_checks_each_embedded_commit(
    mismatch: str | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    selected = {name: {"resolved_sha": "a" * 40} for name in COMPONENT_SPECS}
    modules = {
        "pymupdf._build": SimpleNamespace(pymupdf_git_sha="a" * 40),
        "pymupdf.layout._build": SimpleNamespace(git_sha="a" * 40),
        "pymupdf4llm._build": SimpleNamespace(pymupdf4llm_git_sha="a" * 40),
    }
    monkeypatch.setattr(provenance.importlib, "import_module", modules.__getitem__)
    if mismatch:
        selected[mismatch]["resolved_sha"] = "b" * 40
        with pytest.raises(RuntimeError, match=f"Installed {mismatch} source mismatch"):
            provenance.verify_integrated_build_sources(selected)
    else:
        checks = provenance.verify_integrated_build_sources(selected)
        assert set(checks) == {"pymupdf", "pymupdf_layout", "pymupdf4llm"}
        assert all(check["verified"] for check in checks.values())


def test_runtime_import_failure_still_writes_diagnostics(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def broken_import() -> dict[str, str | None]:
        raise ImportError("missing embedded layout")

    monkeypatch.setattr(runtime_check, "_installed_versions", broken_import)
    output = tmp_path / "compatibility.json"
    args = ["--output", str(output)]
    for name in COMPONENT_SPECS:
        for field, value in (("repository", f"owner/{name}"), ("ref", "main"), ("sha", "a" * 40)):
            args.extend([f"--{name.replace('_', '-')}-{field}", value])
    assert runtime_check.main(args) == 1
    result = json.loads(output.read_text())
    assert result["status"] == "incompatible"
    assert result["error"] == "ImportError: missing embedded layout"


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


def test_stack_build_embeds_sources_in_one_pymupdf_install(tmp_path: Path) -> None:
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
        if name == "pymupdf":
            (source_path / "pyproject.toml").touch()
        sources[name] = ResolvedSource(name, label, f"owner/{name}", "main", "a" * 40, source_path)
    run.sources = sources

    run.build_stack(venv_executable(paths.environment, "python"))

    expected_swig = str(venv_executable(paths.environment, "swig"))
    pymupdf_environment = runner.calls[0]["env"]
    assert len(runner.calls) == 1
    assert runner.calls[0]["command"][-1] == sources["pymupdf"].path
    assert isinstance(pymupdf_environment, dict)
    assert pymupdf_environment["PYMUPDF_SETUP_SWIG"] == expected_swig
    assert pymupdf_environment["PYMUPDF_SETUP_PATH_LAYOUT"] == str(sources["pymupdf_layout"].path.resolve())
    assert pymupdf_environment["PYMUPDF_SETUP_PATH_4LLM"] == str(sources["pymupdf4llm"].path.resolve())
    assert pymupdf_environment["PYMUPDF_SETUP_MUPDF_BUILD"] == (
        f"git:--sha {'a' * 40} https://github.com/ArtifexSoftware/mupdf.git"
    )


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
    assert cli.main(["plan", "--pymupdf-branch", "feature/test", "--scope", "quick", "--group", "layout"]) == 0

    plan = json.loads(capsys.readouterr().out)
    assert plan["refs"]["mupdf"] == "auto"
    assert plan["run_scope"] == "test"
    assert plan["group"] == "layout"
    assert plan["refs"]["pymupdf"] == "feature/test"
    assert plan["pipeline"] == DEFAULT_PIPELINE
    assert plan["dataset_ref"] == "current"


@pytest.mark.parametrize(
    "option", ["--pipeline", "--dataset-ref", "--pymupdf-ref", "--all-latest", "--latest-any-branch"]
)
def test_cli_rejects_removed_selectors(option: str) -> None:
    with pytest.raises(SystemExit) as error:
        cli.main(["plan", option, "anything"])
    assert error.value.code == 2


@pytest.mark.parametrize(
    ("command", "expected_options"),
    [
        (
            "plan",
            (
                "--pymupdf-branch",
                "--scope",
                "--group",
                "--python",
            ),
        ),
        (
            "run",
            (
                "--pymupdf-branch",
                "--scope",
                "--group",
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
    assert "--mupdf-ref" not in help_text
    assert "--pymupdf-layout-ref" not in help_text
    assert "--pymupdf4llm-ref" not in help_text
    assert "(default:" in help_text
    assert "Any existing PyMuPDF branch" in help_text
