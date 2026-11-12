import sys
from types import SimpleNamespace

import pytest

from parsebench_version_lab.model import DEFAULT_PIPELINE
from parsebench_version_lab.pipelines import VERSION_LAB_PIPELINES, VersionLabPyMuPDF4LLMProvider


@pytest.mark.parametrize("path", ["input.pdf", "input.jpg"])
def test_benchmark_calls_document_api_and_preserves_original_page_geometry(
    path: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    pipeline = next(spec for spec in VERSION_LAB_PIPELINES if spec.pipeline_name == DEFAULT_PIPELINE)
    provider = VersionLabPyMuPDF4LLMProvider(pipeline.provider_name, pipeline.config)
    engine = object()
    monkeypatch.setattr(provider, "_resolve_ocr_function", lambda: engine)
    rects = [SimpleNamespace(width=800, height=600), SimpleNamespace(width=300, height=400)]
    boxes = [{"class": "table", "bbox": (10, 20, 120, 80), "pos": (0, 15)}]

    class Document:
        is_closed = False

        def close(self):
            assert not self.is_closed
            self.is_closed = True

        def __iter__(self):
            return (SimpleNamespace(rect=rect) for rect in rects)

        def to_markdown(self, **options):
            if path.endswith(".jpg"):
                self.close()
            assert options == {
                "ocr_function": engine,
                "ocr_dpi": 150,
                "page_chunks": True,
                "show_progress": False,
                "table_output": "html",
            }
            rects[0].width, rects[0].height = 600, 800
            return [
                {"metadata": {"page_number": 1}, "text": "<table></table>", "page_boxes": boxes},
                {"metadata": {"page_number": 2}, "text": "", "page_boxes": []},
            ]

    document = Document()
    monkeypatch.setitem(sys.modules, "pymupdf", SimpleNamespace(open=lambda path: document))
    assert provider._extract(path) == {
        "num_pages": 2,
        "pages": [
            {
                "page_index": 0,
                "page_number": 1,
                "width": 800,
                "height": 600,
                "text": "<table></table>",
                "page_boxes": boxes,
            },
            {"page_index": 1, "page_number": 2, "width": 300, "height": 400, "text": "", "page_boxes": []},
        ],
    }
    assert document.is_closed
