"""Native local Version Lab orchestration."""

from __future__ import annotations

import os
import platform
import subprocess
import tempfile
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .dataset import DatasetRevision, resolve_dataset
from .model import COMPONENT_SPECS, DATASET_REPOSITORY, RunConfig
from .process import CommandRunner, executable, platform_description, runtime_environment, venv_executable
from .provenance import mupdf_build_spec
from .results import build_summary, load_scores
from .sources import ResolvedSource, SourceManager
from .util import write_json

REQUIRED_TOOLS = ("cc", "git", "uv", "swig", "unzip", "tesseract")


@dataclass(frozen=True)
class LocalPaths:
    repository: Path
    workspace_root: Path
    run: Path
    sources: Path
    environment: Path
    output: Path
    dataset: Path
    tool_source: Path

    def to_dict(self) -> dict[str, str]:
        return {name: str(value) for name, value in asdict(self).items()}


def doctor() -> dict[str, Any]:
    tools = {name: executable(name) for name in REQUIRED_TOOLS}
    supported_platform = platform.system() == "Linux"
    tesseract_english = False
    if tools["tesseract"]:
        result = subprocess.run(
            [tools["tesseract"], "--list-langs"],
            check=False,
            capture_output=True,
            text=True,
        )
        tesseract_english = result.returncode == 0 and "eng" in result.stdout.splitlines()
    return {
        "platform": platform_description(),
        "supported_platform": supported_platform,
        "tools": tools,
        "checks": {"tesseract_english": tesseract_english},
        "ready": supported_platform and all(tools.values()) and tesseract_english,
        "notes": [
            "Native benchmark execution is currently supported on Linux.",
            "Private Layout refs use the developer's existing Git credential helper.",
        ],
    }


def ensure_ready(*, resolve_only: bool = False) -> None:
    status = doctor()
    required = ("git",) if resolve_only else REQUIRED_TOOLS
    missing = [name for name in required if status["tools"][name] is None]
    if missing:
        raise RuntimeError(
            "Missing required local tools: " + ", ".join(missing) + ". Install them and rerun `version-lab doctor`."
        )
    if not resolve_only and not status["supported_platform"]:
        raise RuntimeError("Native benchmark execution is currently supported on Linux only")
    if not resolve_only and not status["checks"]["tesseract_english"]:
        raise RuntimeError("Tesseract English language data is missing; install it and rerun `version-lab doctor`")


def create_paths(repository: Path, workspace_root: Path) -> LocalPaths:
    workspace_root.mkdir(parents=True, exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix="run-", dir=workspace_root))
    dataset_cache = workspace_root / "cache" / "datasets"
    return LocalPaths(
        repository=repository,
        workspace_root=workspace_root,
        run=run,
        sources=run / "sources",
        environment=run / "environment",
        output=run / "output",
        dataset=dataset_cache,
        tool_source=repository / "tools" / "version_lab" / "src",
    )


def package_dir(source: ResolvedSource) -> Path:
    candidates = [source.path]
    if source.name == "pymupdf_layout":
        candidates.append(source.path / "pymupdf_layout")
    elif source.name == "pymupdf4llm":
        candidates.append(source.path / "pymupdf4llm")
    for candidate in candidates:
        if (candidate / "pyproject.toml").is_file() or (candidate / "setup.py").is_file():
            return candidate
    raise RuntimeError(
        f"{source.label} at {source.resolved_sha} is not an installable package; checked: "
        + ", ".join(str(candidate) for candidate in candidates)
    )


class LocalRun:
    def __init__(self, config: RunConfig, paths: LocalPaths, runner: CommandRunner | None = None) -> None:
        self.config = config
        self.paths = paths
        self.runner = runner or CommandRunner()
        self.sources: dict[str, ResolvedSource] = {}
        self.dataset: DatasetRevision | None = None

    def record_manifest(self, *, status: str) -> None:
        value = {
            "status": status,
            "created_at": datetime.now(UTC).isoformat(),
            "config": self.config.to_dict(),
            "paths": self.paths.to_dict(),
            "platform": platform_description(),
            "sources": {name: source.to_dict() for name, source in self.sources.items()},
            "dataset": self.dataset.to_dict() if self.dataset else None,
        }
        write_json(self.paths.run / "run.json", value)

    def resolve(self) -> None:
        self.sources = SourceManager(self.runner).resolve_all(self.config, self.paths.sources)
        self.dataset = resolve_dataset(self.config, self.runner)
        self.record_manifest(status="resolved")

    def create_environment(self) -> Path:
        project_env = os.environ.copy()
        # The controller itself commonly runs under `uv run`. Do not let its
        # VIRTUAL_ENV leak into the disposable benchmark environment.
        project_env.pop("VIRTUAL_ENV", None)
        project_env["UV_PROJECT_ENVIRONMENT"] = str(self.paths.environment)
        self.runner.run(
            ["uv", "venv", "--python", self.config.python, self.paths.environment],
            cwd=self.paths.repository,
        )
        self.runner.run(
            [
                "uv",
                "sync",
                "--project",
                self.paths.repository,
                "--locked",
                "--extra",
                "runners",
                "--no-install-package",
                "pymupdf",
                "--no-install-package",
                "pymupdf-layout",
                "--no-install-package",
                "pymupdf4llm",
            ],
            cwd=self.paths.repository,
            env=project_env,
        )
        python = venv_executable(self.paths.environment, "python")
        self.runner.run(["uv", "pip", "install", "--python", python, "pipcl==12", "psutil==7.2.2"])
        return python

    def build_stack(self, python: Path) -> None:
        mupdf = self.sources["mupdf"]
        pymupdf = self.sources["pymupdf"]
        layout = self.sources["pymupdf_layout"]
        llm = self.sources["pymupdf4llm"]
        build_env = {**os.environ, "PYMUPDF_SETUP_MUPDF_BUILD": mupdf_build_spec(mupdf.resolved_sha)}
        self.runner.run(
            ["uv", "pip", "install", "--python", python, "--reinstall", "--no-deps", package_dir(pymupdf)],
            env=build_env,
        )
        layout_env = {**os.environ, "PYMUPDF_LAYOUT_SETUP_BUILD_PYMUPDF": "1"}
        self.runner.run(
            [
                "uv",
                "pip",
                "install",
                "--python",
                python,
                "--reinstall",
                "--no-build-isolation",
                "--no-deps",
                package_dir(layout),
            ],
            env=layout_env,
        )
        self.runner.run(
            ["uv", "pip", "install", "--python", python, "--reinstall", "--no-deps", package_dir(llm)],
            env={**os.environ, "PYMUPDF_SETUP_VERSION": "1"},
        )

    def runtime_env(self) -> dict[str, str]:
        assert self.dataset is not None
        dataset_dir = self.paths.dataset / self.dataset.resolved_sha
        return runtime_environment(
            self.paths.tool_source,
            {
                "DATA_DIR": str(dataset_dir),
                "DATASET_REPOSITORY": DATASET_REPOSITORY,
                "DATASET_SHA": self.dataset.resolved_sha,
                "GROUP": self.config.group,
                "OUTPUT_DIR": str(self.paths.output),
                "PIPELINE": self.config.pipeline,
            },
        )

    def compatibility(self, python: Path) -> None:
        arguments: list[str | Path] = [
            python,
            "-m",
            "parsebench_version_lab.runtime_check",
            "--output",
            self.paths.output / "_compatibility.json",
        ]
        for name in COMPONENT_SPECS:
            option = name.replace("_", "-")
            source = self.sources[name]
            arguments.extend(
                [
                    f"--{option}-repository",
                    source.repository,
                    f"--{option}-ref",
                    source.requested_ref,
                    f"--{option}-sha",
                    source.resolved_sha,
                ]
            )
        self.runner.run(arguments, env=self.runtime_env())

    def benchmark(self, python: Path) -> None:
        environment = self.runtime_env()
        for phase in ("download", "inference", "evaluate", "report"):
            self.runner.run(
                [python, "-m", "parsebench_version_lab.runtime_benchmark", phase],
                cwd=self.paths.repository,
                env=environment,
            )
        scores = load_scores(self.paths.output / self.config.pipeline, self.config.group)
        markdown, data = build_summary(scores)
        write_json(self.paths.output / "_benchmark_scores.json", data)
        (self.paths.output / "_benchmark_scores.md").write_text(markdown, encoding="utf-8")
        print(markdown)

    def run(self, *, resolve_only: bool = False) -> None:
        self.record_manifest(status="starting")
        self.resolve()
        if resolve_only:
            return
        python = self.create_environment()
        self.build_stack(python)
        self.compatibility(python)
        self.benchmark(python)
        self.record_manifest(status="completed")
