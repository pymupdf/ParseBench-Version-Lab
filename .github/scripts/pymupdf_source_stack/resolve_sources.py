#!/usr/bin/env python3
"""Locate installable packages in the checked-out source repositories."""

from __future__ import annotations

from pathlib import Path

from common import COMPONENTS, env, git_sha, write_github_outputs, write_json

MUPDF_REMOTE = "https://github.com/ArtifexSoftware/mupdf.git"

CANDIDATES = {
    "pymupdf": [Path(".source/pymupdf")],
    "pymupdf_layout": [Path(".source/pymupdf-layout"), Path(".source/pymupdf-layout/pymupdf_layout")],
    "pymupdf4llm": [Path(".source/pymupdf4llm"), Path(".source/pymupdf4llm/pymupdf4llm")],
}


class SourceResolutionError(RuntimeError):
    pass


def mupdf_build_spec(sha: str) -> str:
    """Return the pipcl source selector consumed by PyMuPDF's build."""
    return f"git:--sha {sha} {MUPDF_REMOTE}"


def package_dir(name: str, requested_ref: str, output_dir: Path) -> tuple[Path, str]:
    component = COMPONENTS[name]
    root = component["root"]
    resolved_sha = git_sha(root)
    candidates = CANDIDATES[name]
    for candidate in candidates:
        if (candidate / "pyproject.toml").is_file() or (candidate / "setup.py").is_file():
            return candidate, resolved_sha

    locations = ", ".join(map(str, candidates))
    error = (
        f"{component['label']} at commit {resolved_sha} is not an installable Python package. "
        f"No pyproject.toml or setup.py was found in: {locations}."
    )
    write_json(
        output_dir / "_failure.json",
        {
            "title": f"Cannot build {component['label']}",
            "error": error,
            "component": component["label"],
            "requested_ref": requested_ref,
            "resolved_sha": resolved_sha,
            "details": (
                "Compatibility checks and benchmark execution were skipped because this source cannot be built."
            ),
        },
    )
    print(f"::error title=Cannot build {component['label']}::{error}")
    raise SourceResolutionError(error)


def main() -> int:
    output_dir = Path(env("OUTPUT_DIR"))
    refs = {
        "mupdf": env("MUPDF_REF"),
        "pymupdf": env("PYMUPDF_REF"),
        "pymupdf_layout": env("PYMUPDF_LAYOUT_REF"),
        "pymupdf4llm": env("PYMUPDF4LLM_REF"),
    }
    resolved = {name: package_dir(name, refs[name], output_dir) for name in CANDIDATES}
    mupdf_sha = git_sha(COMPONENTS["mupdf"]["root"])
    write_github_outputs(
        {
            "mupdf_build": mupdf_build_spec(mupdf_sha),
            "mupdf_sha": mupdf_sha,
            "pymupdf_dir": str(resolved["pymupdf"][0]),
            "pymupdf_sha": resolved["pymupdf"][1],
            "layout_dir": str(resolved["pymupdf_layout"][0]),
            "layout_sha": resolved["pymupdf_layout"][1],
            "llm_dir": str(resolved["pymupdf4llm"][0]),
            "llm_sha": resolved["pymupdf4llm"][1],
        }
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SourceResolutionError:
        raise SystemExit(1) from None
