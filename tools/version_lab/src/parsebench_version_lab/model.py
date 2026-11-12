"""Portable Version Lab configuration and source component definitions."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class ComponentSpec:
    name: str
    label: str
    repository: str
    checkout_dir: str
    default_branch: str


COMPONENT_SPECS = {
    # Resolve PyMuPDF first: the selected source declares the native MuPDF version.
    "pymupdf": ComponentSpec("pymupdf", "PyMuPDF", "pymupdf/PyMuPDF", "pymupdf", "main"),
    "mupdf": ComponentSpec("mupdf", "MuPDF", "ArtifexSoftware/mupdf", "mupdf", "master"),
    "pymupdf_layout": ComponentSpec(
        "pymupdf_layout",
        "PyMuPDF Layout",
        "ArtifexSoftware/pymupdf_layout",
        "pymupdf-layout",
        "main",
    ),
    "pymupdf4llm": ComponentSpec("pymupdf4llm", "PyMuPDF4LLM", "pymupdf/pymupdf4llm", "pymupdf4llm", "main"),
}

DATASET_REPOSITORY = "llamaindex/ParseBench"
DATASET_BRANCHES = {"full": "main", "test": "test-data"}
V2_REPOSITORY = "llamaindex/ParseBench-2"
V2_METRICS = {
    "text": "text_next",
    "headings": "formatting_v2",
    "strikeout": "formatting_v2",
    "underline": "formatting_v2",
    "tables": "table_next",
    "complex_table_headers": "table_next",
    "financial_tables": "table_next",
    "insurance_filing_tables": "table_next",
    "dense_tables": "table_next",
    "charts": "chart_next",
    "layout": "layout_grounding_pass_rate",
    "forms": "forms_v2",
    "fillable_forms": "forms_v2",
}
V2_SUBSETS = tuple(V2_METRICS)
RUN_SCOPES = {"quick": "test", "full": "full"}
GROUPS = ("all", "chart", "table", "layout", "text_content", "text_formatting")
DEFAULT_PIPELINE = "pymupdf4llm_html_tables_rapidocr_v3"


@dataclass(frozen=True)
class RunConfig:
    """A frontend-independent description of one Version Lab run."""

    pymupdf_branch: str = "main"
    dataset_ref: str = field(default="current", init=False)
    scope: str = "full"
    group: str = "all"
    python: str = "3.12"
    dataset: str | None = None
    pipeline: str = field(default=DEFAULT_PIPELINE, init=False)
    refs: dict[str, str] = field(init=False)

    def __post_init__(self) -> None:
        if self.scope not in RUN_SCOPES:
            raise ValueError(f"Unsupported scope {self.scope!r}; expected one of: {', '.join(RUN_SCOPES)}")
        version = self.dataset or ("v1" if self.scope == "quick" else "v2")
        if version not in {"v1", "v2"}:
            raise ValueError(f"Unsupported dataset {version!r}")
        if version == "v2" and self.scope == "quick":
            raise ValueError("ParseBench 2 has no quick split. Select one v2 group or use --dataset v1 --scope quick.")
        object.__setattr__(self, "dataset", version)
        groups = ("all", *V2_SUBSETS) if version == "v2" else GROUPS
        if self.group not in groups:
            raise ValueError(f"Unsupported group {self.group!r}; expected one of: {', '.join(groups)}")
        branch = self.pymupdf_branch.strip()
        if not branch:
            raise ValueError("A PyMuPDF branch name is required")
        object.__setattr__(self, "pymupdf_branch", branch)
        requested = {name: branch if name == "pymupdf" else "auto" for name in COMPONENT_SPECS}
        object.__setattr__(self, "refs", requested)

    @property
    def run_scope(self) -> str:
        return RUN_SCOPES[self.scope]

    @property
    def dataset_repository(self) -> str:
        return V2_REPOSITORY if self.dataset == "v2" else DATASET_REPOSITORY

    @property
    def dataset_branch(self) -> str:
        return DATASET_BRANCHES[self.run_scope]

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["run_scope"] = self.run_scope
        value["dataset_repository"] = self.dataset_repository
        value["dataset_branch"] = self.dataset_branch
        return value
