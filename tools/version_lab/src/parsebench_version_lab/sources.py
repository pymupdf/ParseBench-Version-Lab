"""Git source resolution and checkout without GitHub Actions dependencies."""

from __future__ import annotations

import os
import re
import shutil
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from urllib.request import urlopen

from .model import COMPONENT_SPECS, ComponentSpec, RunConfig
from .process import CommandRunner


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


class SourceManager:
    def __init__(self, runner: CommandRunner) -> None:
        self.runner = runner

    @staticmethod
    def remote(repository: str) -> str:
        return f"https://github.com/{repository}.git"

    @staticmethod
    def git_environment() -> dict[str, str]:
        return {**os.environ, "GIT_TERMINAL_PROMPT": "0"}

    def resolve_mupdf(self, pymupdf: ResolvedSource) -> ResolvedSource:
        # Read the native version from the selected immutable PyMuPDF source,
        # including feature branches, without executing its build script.
        url = f"https://raw.githubusercontent.com/{pymupdf.repository}/{pymupdf.resolved_sha}/setup.py"
        with urlopen(url, timeout=30) as response:
            setup = response.read().decode("utf-8")
        match = re.search(r"^version_mupdf\s*=\s*['\"](\d+(?:\.\d+)+)['\"]\s*$", setup, re.MULTILINE)
        if match is None:
            raise RuntimeError(f"PyMuPDF {pymupdf.resolved_sha} does not declare version_mupdf in setup.py")
        release = match.group(1)
        component = COMPONENT_SPECS["mupdf"]
        sha = self.remote_ref(component.repository, f"refs/tags/{release}")
        if sha is None:
            raise RuntimeError(f"MuPDF version {release} declared by PyMuPDF has no source tag")
        return ResolvedSource(
            component.name, component.label, component.repository, release, sha, Path(component.checkout_dir)
        )

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

    def resolve_branch(self, component: ComponentSpec, requested_branch: str) -> ResolvedSource:
        branch = requested_branch.strip()
        if not branch:
            raise ValueError(f"A branch name is required for {component.label}")
        sha = self.remote_ref(component.repository, f"refs/heads/{branch}")
        if sha is None:
            raise ValueError(
                f"No branch {branch!r} exists in {component.repository}; select an existing branch name. "
                "Release tags and commit SHAs are not accepted."
            )
        return ResolvedSource(
            component.name, component.label, component.repository, branch, sha, Path(component.checkout_dir), branch
        )

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

    def resolve_component(
        self, component: ComponentSpec, config: RunConfig, root: Path, *, pymupdf: ResolvedSource | None = None
    ) -> ResolvedSource:
        if component.name == "pymupdf":
            source = self.resolve_branch(component, config.pymupdf_branch)
        else:
            assert pymupdf is not None
            source = (
                self.resolve_mupdf(pymupdf)
                if component.name == "mupdf"
                else self.resolve_branch(component, component.default_branch)
            )
        destination = root / component.checkout_dir
        sha = self.checkout(source.repository, source.resolved_sha, destination)
        if sha != source.resolved_sha:
            raise RuntimeError(f"Checkout of {source.repository} did not match resolved commit {source.resolved_sha}")
        return replace(source, path=destination)

    def resolve_all(self, config: RunConfig, root: Path) -> dict[str, ResolvedSource]:
        root.mkdir(parents=True, exist_ok=True)
        sources: dict[str, ResolvedSource] = {}
        for name, component in COMPONENT_SPECS.items():
            sources[name] = self.resolve_component(component, config, root, pymupdf=sources.get("pymupdf"))
        return sources
