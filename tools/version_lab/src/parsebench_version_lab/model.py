"""Portable Version Lab configuration and source component definitions."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

LAYOUT_REPOSITORIES = (
    "ArtifexSoftware/sce",
    "ArtifexSoftware/pymupdf_layout",
)
STANDARD_REF = "1.28.0"


@dataclass(frozen=True)
class ComponentSpec:
    name: str
    label: str
    repositories: tuple[str, ...]
    checkout_dir: str
    default_branch: str


COMPONENT_SPECS = {
    "mupdf": ComponentSpec("mupdf", "MuPDF", ("ArtifexSoftware/mupdf",), "mupdf", "master"),
    "pymupdf": ComponentSpec("pymupdf", "PyMuPDF", ("pymupdf/PyMuPDF",), "pymupdf", "main"),
    "pymupdf_layout": ComponentSpec(
        "pymupdf_layout",
        "PyMuPDF Layout",
        LAYOUT_REPOSITORIES,
        "pymupdf-layout",
        "main",
    ),
    "pymupdf4llm": ComponentSpec("pymupdf4llm", "PyMuPDF4LLM", ("pymupdf/pymupdf4llm",), "pymupdf4llm", "main"),
}

# Backward-compatible view used by the existing GitHub workflow helpers.
COMPONENTS = {
    name: {
        "label": component.label,
        "repository": component.repositories[0],
        "root": Path(f".source/{component.checkout_dir}"),
        "default_branch": component.default_branch,
    }
    for name, component in COMPONENT_SPECS.items()
}

DATASET_REPOSITORY = "llamaindex/ParseBench"
DATASET_BRANCHES = {"full": "main", "test": "test-data"}
RUN_SCOPES = {"quick": "test", "full": "full"}
GROUPS = ("all", "chart", "table", "layout", "text_content", "text_formatting")
PIPELINE = "pymupdf4llm_markdown_150dpi"


@dataclass(frozen=True)
class RunConfig:
    """A frontend-independent description of one Version Lab run."""

    mupdf_ref: str = STANDARD_REF
    pymupdf_ref: str = STANDARD_REF
    pymupdf_layout_ref: str = STANDARD_REF
    pymupdf4llm_ref: str = STANDARD_REF
    dataset_ref: str = "current"
    scope: str = "quick"
    group: str = "all"
    all_latest: bool = False
    latest_any_branch: bool = False
    python: str = "3.12"
    pipeline: str = PIPELINE
    refs: dict[str, str] = field(init=False)

    def __post_init__(self) -> None:
        if self.scope not in RUN_SCOPES:
            raise ValueError(f"Unsupported scope {self.scope!r}; expected one of: {', '.join(RUN_SCOPES)}")
        if self.group not in GROUPS:
            raise ValueError(f"Unsupported group {self.group!r}; expected one of: {', '.join(GROUPS)}")
        if self.all_latest and self.latest_any_branch:
            raise ValueError("Select all-latest or latest-any-branch, not both")
        requested = {name: getattr(self, f"{name}_ref") for name in COMPONENT_SPECS}
        if self.all_latest:
            requested = {name: component.default_branch for name, component in COMPONENT_SPECS.items()}
        object.__setattr__(self, "refs", requested)

    @property
    def run_scope(self) -> str:
        return RUN_SCOPES[self.scope]

    @property
    def dataset_branch(self) -> str:
        return DATASET_BRANCHES[self.run_scope]

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["run_scope"] = self.run_scope
        value["dataset_branch"] = self.dataset_branch
        return value
