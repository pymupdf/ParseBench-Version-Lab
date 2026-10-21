"""MuPDF build provenance shared by cloud and local compatibility gates."""

from __future__ import annotations

import importlib
from typing import Any

MUPDF_REMOTE = "https://github.com/ArtifexSoftware/mupdf.git"


def verify_integrated_build_sources(sources: dict[str, dict[str, str]]) -> dict[str, dict[str, Any]]:
    """Check the commits embedded in the wheel, not the empty compatibility packages."""
    result = {}
    for name, module_name, attribute in (
        ("pymupdf", "pymupdf._build", "pymupdf_git_sha"),
        ("pymupdf_layout", "pymupdf.layout._build", "git_sha"),
        ("pymupdf4llm", "pymupdf4llm._build", "pymupdf4llm_git_sha"),
    ):
        actual = getattr(importlib.import_module(module_name), attribute, None)
        expected = sources[name]["resolved_sha"]
        if actual != expected:
            raise RuntimeError(f"Installed {name} source mismatch: expected {expected!r}, received {actual!r}")
        result[name] = {"expected_sha": expected, "installed_sha": actual, "verified": True}
    return result


def mupdf_build_spec(sha: str) -> str:
    return f"git:--sha {sha} {MUPDF_REMOTE}"


def expected_mupdf_build_source(repository: str, sha: str) -> str:
    return f"git:--sha {sha} https://github.com/{repository}.git"


def verify_mupdf_build_source(pymupdf_module: Any, repository: str, sha: str) -> dict[str, Any]:
    expected = expected_mupdf_build_source(repository, sha)
    actual = getattr(pymupdf_module, "mupdf_location", None)
    if actual != expected:
        raise RuntimeError(
            "Installed PyMuPDF does not report the selected MuPDF source: "
            f"expected pymupdf.mupdf_location={expected!r}, received {actual!r}. "
            "PyMuPDF may have used its fixed default MuPDF instead of the requested commit."
        )
    return {
        "expected_build_source": expected,
        "installed_build_source": actual,
        "mupdf_version": getattr(pymupdf_module, "mupdf_version", None),
        "verified": True,
    }
