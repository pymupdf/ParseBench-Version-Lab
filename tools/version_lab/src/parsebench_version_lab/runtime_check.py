"""Behavioral and provenance checks executed inside the selected target environment."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import platform
import tempfile
import traceback
from pathlib import Path
from typing import Any

from .model import COMPONENT_SPECS
from .provenance import verify_integrated_build_sources, verify_mupdf_build_source
from .util import write_json

SMOKE_MARKERS = ("PARSEBENCH", "INVOICE NUMBER", "GRAND TOTAL")


def _distribution_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def _github_escape(value: str) -> str:
    return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def _source_metadata(args: argparse.Namespace) -> dict[str, dict[str, str]]:
    return {
        name: {
            "repository": getattr(args, f"{name}_repository"),
            "requested_ref": getattr(args, f"{name}_ref"),
            "resolved_sha": getattr(args, f"{name}_sha"),
        }
        for name in COMPONENT_SPECS
    }


def _installed_versions() -> dict[str, str | None]:
    import pymupdf
    import pymupdf.layout._build
    import pymupdf4llm

    return {
        "onnxruntime": _distribution_version("onnxruntime"),
        "pymupdf": pymupdf.__version__,
        "pymupdf_layout": pymupdf.layout._build.version,
        "pymupdf4llm": pymupdf4llm.__version__,
        "rapidocr": _distribution_version("rapidocr"),
    }


def _make_smoke_pdf(path: Path) -> None:
    import pymupdf

    source = pymupdf.open()
    source_page = source.new_page(width=612, height=792)
    source_page.insert_text((54, 80), "PARSEBENCH OCR COMPATIBILITY TEST", fontsize=18)
    source_page.insert_text((54, 135), "Invoice Number: PB-2026-0716", fontsize=14)
    source_page.insert_text((54, 190), "Customer: Artifex Software", fontsize=14)
    source_page.insert_text((54, 245), "Document Processing    12    480", fontsize=14)
    source_page.insert_text((54, 300), "Layout Analysis         3    120", fontsize=14)
    source_page.insert_text((54, 355), "Grand Total                  600", fontsize=14)
    image = source_page.get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False).tobytes("png")
    source.close()

    document = pymupdf.open()
    page = document.new_page(width=612, height=792)
    page.insert_image(page.rect, stream=image)
    document.save(path)
    document.close()


def run_compatibility_check(sources: dict[str, dict[str, str]]) -> dict[str, Any]:
    import pymupdf

    build_provenance = verify_mupdf_build_source(
        pymupdf, sources["mupdf"]["repository"], sources["mupdf"]["resolved_sha"]
    )
    integrated_provenance = verify_integrated_build_sources(sources)

    import pymupdf.layout

    pymupdf.layout.activate()

    with tempfile.TemporaryDirectory(prefix="parsebench-pymupdf-compat-") as temp_dir:
        smoke_pdf = Path(temp_dir) / "compatibility.pdf"
        _make_smoke_pdf(smoke_pdf)
        with pymupdf.open(smoke_pdf) as document:
            chunks = document.to_markdown(
                page_chunks=True,
                show_progress=False,
                use_ocr=True,
                force_ocr=True,
                ocr_dpi=200,
                table_output="html",
            )

    if not isinstance(chunks, list) or len(chunks) != 1:
        raise RuntimeError(f"Expected one page chunk, received {type(chunks).__name__}: {chunks!r}")
    chunk = chunks[0]
    if not isinstance(chunk, dict):
        raise RuntimeError(f"Expected a dictionary page chunk, received {type(chunk).__name__}")
    text = chunk.get("text")
    if not isinstance(text, str):
        raise RuntimeError("End-to-end Layout/OCR check did not return text")
    missing_markers = [marker for marker in SMOKE_MARKERS if marker not in text.upper()]
    if missing_markers:
        raise RuntimeError(
            "End-to-end Layout/OCR check did not recognize expected text "
            f"{missing_markers!r}; extracted {len(text)} characters. "
            "The selected source stack or OCR runtime may be incompatible."
        )
    page_boxes = chunk.get("page_boxes")
    if not isinstance(page_boxes, list) or not page_boxes:
        raise RuntimeError("PyMuPDF4LLM output did not contain non-empty Layout page_boxes")
    return {
        "mupdf_build_provenance": build_provenance,
        "integrated_build_provenance": integrated_provenance,
        "layout_mode": True,
        "ocr_markers_found": list(SMOKE_MARKERS),
        "page_box_count": len(page_boxes),
        "page_chunk_count": len(chunks),
        "extracted_character_count": len(text),
    }


def parse_args(arguments: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    for name in COMPONENT_SPECS:
        option = name.replace("_", "-")
        for field in ("repository", "ref", "sha"):
            parser.add_argument(f"--{option}-{field}", required=True)
    return parser.parse_args(arguments)


def main(arguments: list[str] | None = None) -> int:
    args = parse_args(arguments)
    result: dict[str, Any] = {
        "python": platform.python_version(),
        "sources": _source_metadata(args),
    }
    try:
        result["installed_versions"] = _installed_versions()
        result["checks"] = run_compatibility_check(result["sources"])
        result["status"] = "compatible"
    except Exception as error:
        result["status"] = "incompatible"
        result["error"] = f"{type(error).__name__}: {error}"
        result["traceback"] = traceback.format_exc()
        if os.environ.get("GITHUB_ACTIONS") == "true":
            print(f"::error title=Incompatible PyMuPDF source stack::{_github_escape(result['error'])}")
    finally:
        write_json(args.output, result)
        print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["status"] == "compatible" else 1


if __name__ == "__main__":
    raise SystemExit(main())
