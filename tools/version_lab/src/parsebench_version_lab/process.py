"""Cross-platform subprocess and virtual-environment helpers."""

from __future__ import annotations

import os
import shutil
import subprocess
from collections.abc import Mapping, Sequence
from pathlib import Path


class CommandError(RuntimeError):
    def __init__(self, command: Sequence[str], result: subprocess.CompletedProcess[str]) -> None:
        self.command = tuple(command)
        self.returncode = result.returncode
        self.stdout = result.stdout or ""
        self.stderr = result.stderr or ""
        detail = self.stderr.strip() or self.stdout.strip() or "no command output"
        super().__init__(f"Command failed with exit code {result.returncode}: {display_command(command)}\n{detail}")


def display_command(command: Sequence[str]) -> str:
    return subprocess.list2cmdline([str(argument) for argument in command])


class CommandRunner:
    def __init__(self, *, verbose: bool = True) -> None:
        self.verbose = verbose

    def run(
        self,
        command: Sequence[str | Path],
        *,
        cwd: Path | None = None,
        env: Mapping[str, str] | None = None,
        capture: bool = False,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        arguments = [str(argument) for argument in command]
        if self.verbose:
            print(f"+ {display_command(arguments)}", flush=True)
        result = subprocess.run(
            arguments,
            cwd=cwd,
            env=dict(env) if env is not None else None,
            check=False,
            capture_output=capture,
            text=True,
        )
        if check and result.returncode != 0:
            raise CommandError(arguments, result)
        return result


def executable(name: str) -> str | None:
    return shutil.which(name)


def venv_executable(environment: Path, name: str) -> Path:
    if os.name == "nt":
        suffix = ".exe" if not name.lower().endswith(".exe") else ""
        return environment / "Scripts" / f"{name}{suffix}"
    return environment / "bin" / name


def runtime_environment(tool_source: Path, extra: Mapping[str, str] | None = None) -> dict[str, str]:
    env = os.environ.copy()
    existing = env.get("PYTHONPATH")
    env["PYTHONPATH"] = str(tool_source) if not existing else str(tool_source) + os.pathsep + existing
    if extra:
        env.update(extra)
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUNBUFFERED"] = "1"
    return env


def platform_description() -> dict[str, str]:
    import platform

    return {
        "machine": platform.machine(),
        "platform": platform.platform(),
        "python": platform.python_version(),
        "system": platform.system(),
    }
