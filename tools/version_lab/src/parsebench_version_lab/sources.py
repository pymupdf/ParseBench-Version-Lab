"""Git source resolution and checkout without GitHub Actions dependencies."""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from urllib.request import urlopen

from .model import COMPONENT_SPECS, LATEST_RELEASE, ComponentSpec, RunConfig
from .process import CommandRunner


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
        self.release_versions: dict[str, str] = {}

    @staticmethod
    def remote(repository: str) -> str:
        return f"https://github.com/{repository}.git"

    @staticmethod
    def git_environment() -> dict[str, str]:
        return {**os.environ, "GIT_TERMINAL_PROMPT": "0"}

    def latest_release(self, package: str) -> str:
        if package not in self.release_versions:
            with urlopen(f"https://pypi.org/pypi/{package}/json", timeout=30) as response:
                version = json.load(response)["info"]["version"]
            if not isinstance(version, str) or not re.fullmatch(r"\d+(?:\.\d+)+", version):
                raise RuntimeError(f"PyPI returned an invalid stable release for {package}: {version!r}")
            self.release_versions[package] = version
        return self.release_versions[package]

    def remote_ref(self, repository: str, ref: str) -> str | None:
        result = self.runner.run(
            ["git", "ls-remote", self.remote(repository), ref, f"{ref}^{{}}"],
            env=self.git_environment(),
            capture=True,
        )
        refs = {}
        for line in result.stdout.splitlines():
            sha, name = line.split("\t", 1)
            if not re.fullmatch(r"[0-9a-f]{40}", sha):
                raise RuntimeError(f"Git returned an invalid commit for {repository}@{ref}: {sha!r}")
            refs[name] = sha
        # Annotated tags point at tag objects; check out their peeled commits.
        return refs.get(f"{ref}^{{}}", refs.get(ref))

    def resolve_ref(self, component: ComponentSpec, requested_ref: str) -> ResolvedSource:
        repository = component.repository
        branch = None
        ref = requested_ref.strip()
        if not ref:
            raise ValueError(f"A release or branch is required for {component.label}")
        if ref == "latest-any-branch":
            head = self.latest_branch_head(repository)
            ref, sha, branch = head.branch, head.sha, head.branch
        else:
            # Resolve branches in their own namespace so old tags and arbitrary
            # commits cannot silently bypass the current-source support policy.
            sha = None if ref == LATEST_RELEASE else self.remote_ref(repository, f"refs/heads/{ref}")
            if sha:
                branch = ref
            else:
                release = self.latest_release(component.pypi_package)
                if ref not in (LATEST_RELEASE, release):
                    raise ValueError(
                        f"Unsupported {component.label} ref {ref!r}; select 'latest' ({release}) "
                        "or a current branch name. Historical tags and commit SHAs are not supported."
                    )
                ref = release
                sha = self.remote_ref(repository, f"refs/tags/{release}")
                if sha is None:
                    raise RuntimeError(f"Latest PyPI release {release} has no source tag in {repository}")
        return ResolvedSource(
            component.name, component.label, repository, ref, sha, Path(component.checkout_dir), branch
        )

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
        source = self.resolve_ref(component, config.refs[component.name])
        destination = root / component.checkout_dir
        sha = self.checkout(source.repository, source.resolved_sha, destination)
        if sha != source.resolved_sha:
            raise RuntimeError(f"Checkout of {source.repository} did not match resolved commit {source.resolved_sha}")
        return replace(source, path=destination)

    def resolve_all(self, config: RunConfig, root: Path) -> dict[str, ResolvedSource]:
        root.mkdir(parents=True, exist_ok=True)
        return {name: self.resolve_component(component, config, root) for name, component in COMPONENT_SPECS.items()}
