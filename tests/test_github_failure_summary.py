from __future__ import annotations

import importlib.util
import io
import zipfile
from pathlib import Path


def _load_module():
    path = Path(__file__).parents[1] / "scripts" / "write_github_failure_summary.py"
    spec = importlib.util.spec_from_file_location("write_github_failure_summary", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


summary_module = _load_module()


def test_extract_error_details_keeps_complete_traceback() -> None:
    log = """\
2026-07-15T00:00:00Z starting
2026-07-15T00:00:01Z Traceback (most recent call last):
2026-07-15T00:00:01Z   File \"check.py\", line 5, in main
2026-07-15T00:00:01Z     run_check()
2026-07-15T00:00:01Z TypeError: unexpected option
2026-07-15T00:00:02Z ##[error]Process completed with exit code 1.
"""

    details = summary_module.extract_error_details(log)

    assert 'File "check.py", line 5, in main' in details
    assert "TypeError: unexpected option" in details
    assert "Process completed with exit code 1" in details


def test_decode_job_log_accepts_zip_archive() -> None:
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr("1_first.txt", "first error")
        archive.writestr("2_second.txt", "second error")

    assert summary_module.decode_job_log(stream.getvalue()) == "first error\nsecond error"


def test_build_summary_includes_compatibility_traceback_and_failed_step(tmp_path: Path) -> None:
    diagnostics = tmp_path / "diagnostics"
    diagnostics.mkdir()
    (diagnostics / "_compatibility.json").write_text(
        """{
  "status": "incompatible",
  "error": "TypeError: incompatible API",
  "traceback": "Traceback (most recent call last):\\n  File \\\"check.py\\\", line 5\\nTypeError: incompatible API\\n"
}
""",
        encoding="utf-8",
    )
    jobs = [
        {
            "id": 42,
            "name": "Check compatibility and run benchmark",
            "conclusion": "failure",
            "steps": [{"name": "Check source stack compatibility", "conclusion": "failure"}],
        }
    ]

    summary = summary_module.build_summary(
        jobs=jobs,
        logs={42: "##[error]Process completed with exit code 1."},
        diagnostics=diagnostics,
        run_url="https://github.example/actions/runs/7",
        benchmark_result="failure",
        publish_result="success",
    )

    assert "## Why this workflow failed" in summary
    assert "Check source stack compatibility" in summary
    assert "TypeError: incompatible API" in summary
    assert 'File "check.py", line 5' in summary
    assert "https://github.example/actions/runs/7" in summary
