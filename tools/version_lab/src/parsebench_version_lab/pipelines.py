"""Version Lab-only PyMuPDF4LLM pipeline variants."""

from __future__ import annotations

import importlib
from collections.abc import Callable
from typing import Any, cast

from parse_bench.evaluation.layout_adapters.adapters import PyMuPDF4LLMLayoutAdapter  # type: ignore[import-untyped]
from parse_bench.evaluation.layout_adapters.registry import register_layout_adapter  # type: ignore[import-untyped]
from parse_bench.inference.pipelines import register_pipeline  # type: ignore[import-untyped]
from parse_bench.inference.providers.base import ProviderConfigError  # type: ignore[import-untyped]
from parse_bench.inference.providers.parse.pymupdf4llm import PyMuPDF4LLMProvider  # type: ignore[import-untyped]
from parse_bench.inference.providers.registry import register_provider  # type: ignore[import-untyped]
from parse_bench.schemas.pipeline import PipelineSpec  # type: ignore[import-untyped]
from parse_bench.schemas.product import ProductType  # type: ignore[import-untyped]

VERSION_LAB_PROVIDER = "version_lab_pymupdf4llm"
register_layout_adapter(VERSION_LAB_PROVIDER, priority=90)(PyMuPDF4LLMLayoutAdapter)
_OCR_BACKEND_MODULES = {
    "rapidocr": "pymupdf4llm.ocr.rapidocr_api",
    "rapidocr_modern": "pymupdf4llm.ocr.rapidocr_api",
    "tesseract": "pymupdf4llm.ocr.tesseract_api",
}


@register_provider(VERSION_LAB_PROVIDER)
class VersionLabPyMuPDF4LLMProvider(PyMuPDF4LLMProvider):
    """Use upstream transformation logic with Version Lab OCR selection."""

    def __init__(self, provider_name: str, base_config: dict[str, Any] | None = None):
        config = dict(base_config or {})
        raw_backend = config.pop("ocr_backend", None)
        if raw_backend is not None and not isinstance(raw_backend, str):
            raise ProviderConfigError("PyMuPDF4LLM 'ocr_backend' must be a string")
        self._version_lab_ocr_backend = raw_backend.strip().lower() if isinstance(raw_backend, str) else None
        if self._version_lab_ocr_backend not in {None, "auto", *_OCR_BACKEND_MODULES}:
            supported = ", ".join(["auto", *_OCR_BACKEND_MODULES])
            raise ProviderConfigError(
                f"Unsupported PyMuPDF4LLM OCR backend '{raw_backend}'. Supported backends: {supported}"
            )
        super().__init__(provider_name, config)

    def _resolve_ocr_function(self) -> Callable[..., Any] | None:
        backend = self._version_lab_ocr_backend
        if backend in {None, "auto"}:
            return None
        assert backend is not None

        if backend == "rapidocr_modern":
            try:
                detector_module = importlib.import_module("pymupdf4llm.ocr.detect_rapidocr")
                detected_backend = detector_module.detect_rapidocr_backend()
            except (ImportError, AttributeError) as error:
                raise ProviderConfigError(
                    "PyMuPDF4LLM OCR backend 'rapidocr_modern' requires modern RapidOCR support"
                ) from error
            if detected_backend != "rapidocr":
                raise ProviderConfigError(
                    "PyMuPDF4LLM OCR backend 'rapidocr_modern' requires the modern 'rapidocr' package"
                )

        module_name = _OCR_BACKEND_MODULES[backend]
        try:
            ocr_module = importlib.import_module(module_name)
        except (ImportError, RuntimeError) as error:
            raise ProviderConfigError(f"PyMuPDF4LLM OCR backend '{backend}' is unavailable: {error}") from error
        ocr_function = getattr(ocr_module, "exec_ocr", None)
        if not callable(ocr_function):
            raise ProviderConfigError(f"PyMuPDF4LLM OCR backend '{backend}' does not expose exec_ocr")
        if backend == "tesseract" and getattr(ocr_module, "TESSDATA", True) is None:
            raise ProviderConfigError("PyMuPDF4LLM OCR backend 'tesseract' has no language data")
        return cast(Callable[..., Any], ocr_function)


VERSION_LAB_PIPELINES = (
    PipelineSpec(
        pipeline_name="pymupdf4llm_markdown_150dpi",
        provider_name=VERSION_LAB_PROVIDER,
        product_type=ProductType.PARSE,
        config={"ocr_dpi": 150},
    ),
    PipelineSpec(
        pipeline_name="pymupdf4llm_markdown_tesseract",
        provider_name=VERSION_LAB_PROVIDER,
        product_type=ProductType.PARSE,
        config={"ocr_backend": "tesseract"},
    ),
    PipelineSpec(
        pipeline_name="pymupdf4llm_markdown_rapidocr",
        provider_name=VERSION_LAB_PROVIDER,
        product_type=ProductType.PARSE,
        config={"ocr_backend": "rapidocr"},
    ),
    PipelineSpec(
        pipeline_name="pymupdf4llm_markdown_no_ocr",
        provider_name=VERSION_LAB_PROVIDER,
        product_type=ProductType.PARSE,
        config={"use_ocr": False},
    ),
    PipelineSpec(
        pipeline_name="pymupdf4llm_html_tables",
        provider_name=VERSION_LAB_PROVIDER,
        product_type=ProductType.PARSE,
        config={"ocr_dpi": 150, "table_output": "html"},
    ),
    PipelineSpec(
        pipeline_name="pymupdf4llm_html_tables_rapidocr_v3",
        provider_name=VERSION_LAB_PROVIDER,
        product_type=ProductType.PARSE,
        config={"ocr_backend": "rapidocr_modern", "ocr_dpi": 150, "table_output": "html"},
    ),
)


def register_version_lab_pipelines() -> None:
    """Add local variants while leaving upstream's canonical pipeline intact."""
    for pipeline in VERSION_LAB_PIPELINES:
        register_pipeline(pipeline)
