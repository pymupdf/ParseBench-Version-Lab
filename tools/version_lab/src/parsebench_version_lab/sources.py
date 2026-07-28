"""Git source resolution and checkout without GitHub Actions dependencies."""

from __future__ import annotations

import shutil
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path

from .model import COMPONENT_SPECS, ComponentSpec, RunConfig
from .process import CommandError, CommandRunner


@dataclass(frozen=True)
class BranchHead:
    branch: str
    sha: str
    committed_at: int


@dataclass(frozen=True)
class ResolvedSource:
    name: str
    label: str
    repository: str
    requested_ref: str
    resolved_sha: str
    path: Path
    selected_branch: str | None = None

    def to_dict(self) -> dict[str, str | None]:
        value = asdict(self)
        value["path"] = str(self.path)
        return value


def parse_branch_heads(output: str, repository: str) -> BranchHead:
    heads: list[BranchHead] = []
    for line in output.splitlines():
        fields = line.split("\t", 2)
        if len(fields) != 3:
            raise RuntimeError(f"Git returned an invalid branch head for {repository}: {line!r}")
        branch, sha, raw_timestamp = fields
        try:
            timestamp = int(raw_timestamp)
        except ValueError as error:
            raise RuntimeError(f"Git returned an invalid branch timestamp for {repository}: {line!r}") from error
        if not branch or len(sha) != 40 or timestamp < 0:
            raise RuntimeError(f"Git returned an invalid branch head for {repository}: {line!r}")
        heads.append(BranchHead(branch, sha, timestamp))
    if not heads:
        raise RuntimeError(f"No branch heads were found in {repository}")
    return max(heads, key=lambda head: (head.committed_at, head.branch, head.sha))


class SourceManager:
    def __init__(self, runner: CommandRunner) -> None:
        self.runner = runner

    @staticmethod
    def remote(repository: str) -> str:
        return f"https://github.com/{repository}.git"

    @staticmethod
    def git_environment() -> dict[str, str]:
        import os

        return {**os.environ, "GIT_TERMINAL_PROMPT": "0"}

    def latest_branch_head(self, repository: str) -> BranchHead:
        with tempfile.TemporaryDirectory(prefix="parsebench-version-lab-heads-") as directory:
            checkout = Path(directory)
            self.runner.run(["git", "init", "--quiet", checkout])
            self.runner.run(
                [
                    "git",
                    "-C",
                    checkout,
                    "fetch",
                    "--quiet",
                    "--depth=1",
                    "--filter=tree:0",
                    "--no-tags",
                    self.remote(repository),
                    "+refs/heads/*:refs/remotes/source/*",
                ],
                env=self.git_environment(),
            )
            result = self.runner.run(
                [
                    "git",
                    "-C",
                    checkout,
                    "for-each-ref",
                    "--format=%(refname:lstrip=3)\t%(objectname)\t%(committerdate:unix)",
                    "refs/remotes/source",
                ],
                capture=True,
            )
        return parse_branch_heads(result.stdout, repository)

    def checkout(self, repository: str, ref: str, destination: Path) -> str:
        if destination.exists():
            raise RuntimeError(f"Source destination already exists: {destination}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        self.runner.run(["git", "init", "--quiet", destination])
        try:
            self.runner.run(["git", "-C", destination, "remote", "add", "origin", self.remote(repository)])
            self.runner.run(
                ["git", "-C", destination, "fetch", "--quiet", "--depth=1", "origin", ref],
                env=self.git_environment(),
            )
            self.runner.run(["git", "-C", destination, "checkout", "--quiet", "--detach", "FETCH_HEAD"])
            result = self.runner.run(["git", "-C", destination, "rev-parse", "HEAD"], capture=True)
            return result.stdout.strip()
        except Exception:
            shutil.rmtree(destination, ignore_errors=True)
            raise

    def resolve_component(self, component: ComponentSpec, config: RunConfig, root: Path) -> ResolvedSource:
        repositories = component.repositories
        if component.name == "pymupdf_layout" and (config.all_latest or config.latest_any_branch):
            repositories = (repositories[-1],)
        errors: list[str] = []
        for repository in repositories:
            branch: str | None = None
            ref = config.refs[component.name]
            try:
                if config.latest_any_branch:
                    head = self.latest_branch_head(repository)
                    branch = head.branch
                    ref = head.sha
                destination = root / component.checkout_dir
                sha = self.checkout(repository, ref, destination)
                return ResolvedSource(
                    component.name,
                    component.label,
                    repository,
                    branch or ref,
                    sha,
                    destination,
                    branch,
                )
            except (CommandError, OSError, RuntimeError) as error:
                errors.append(f"{repository}@{ref}: {error}")
        detail = "\n\n".join(errors)
        raise RuntimeError(f"Could not resolve {component.label} from any supported repository:\n{detail}")

    def resolve_all(self, config: RunConfig, root: Path) -> dict[str, ResolvedSource]:
        root.mkdir(parents=True, exist_ok=True)
        return {name: self.resolve_component(component, config, root) for name, component in COMPONENT_SPECS.items()}
