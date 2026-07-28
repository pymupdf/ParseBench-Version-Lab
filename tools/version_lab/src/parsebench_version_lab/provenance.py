"""MuPDF build provenance shared by cloud and local compatibility gates."""

from __future__ import annotations

from typing import Any

MUPDF_REMOTE = "https://github.com/ArtifexSoftware/mupdf.git"


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
