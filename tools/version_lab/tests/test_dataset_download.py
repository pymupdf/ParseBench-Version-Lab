from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import Mock

import httpx
import pytest
from huggingface_hub.errors import HfHubHTTPError

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from parsebench_version_lab import runtime_benchmark  # noqa: E402

REVISION = "a" * 40
MARKER = {"repository": "llamaindex/ParseBench", "resolved_sha": REVISION}


def complete_dataset(data_dir: Path) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    for group in ("chart", "layout", "table", "text_content", "text_formatting"):
        (data_dir / f"{group}.jsonl").touch()
    for group in ("chart", "layout", "table", "text"):
        docs = data_dir / "docs" / group
        docs.mkdir(parents=True, exist_ok=True)
        (docs / "sample.pdf").touch()


@pytest.fixture
def download_setup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    data_dir = tmp_path / "data"
    monkeypatch.setenv("DATA_DIR", str(data_dir))
    monkeypatch.setenv("DATASET_REPOSITORY", MARKER["repository"])
    monkeypatch.setenv("DATASET_SHA", REVISION)
    monkeypatch.delenv("OUTPUT_DIR", raising=False)
    snapshot = Mock()
    sleep = Mock()
    monkeypatch.setattr("huggingface_hub.snapshot_download", snapshot)
    monkeypatch.setattr(runtime_benchmark.time, "sleep", sleep)
    return data_dir, snapshot, sleep


@pytest.mark.parametrize("xet", [False, True])
def test_rate_limit_resumes_partial_snapshot(download_setup, xet: bool) -> None:
    data_dir, snapshot, sleep = download_setup
    error = (
        ConnectionError("Network error: HTTP status client error (429 Too Many Requests)")
        if xet
        else HfHubHTTPError(
            "rate limited",
            response=httpx.Response(
                429, headers={"Retry-After": "600"}, request=httpx.Request("GET", "https://huggingface.co")
            ),
        )
    )
    partial_file = data_dir / "already-downloaded.pdf"

    def fetch(**kwargs):
        assert kwargs["revision"] == REVISION
        assert kwargs["force_download"] is False
        if snapshot.call_count == 1:
            data_dir.mkdir()
            partial_file.write_bytes(b"downloaded content")
            raise error
        assert partial_file.read_bytes() == b"downloaded content"
        assert not (data_dir / runtime_benchmark.DATASET_MARKER).exists()
        complete_dataset(data_dir)

    snapshot.side_effect = fetch
    runtime_benchmark.download()

    assert snapshot.call_count == 2
    sleep.assert_called_once_with(310 if xet else 600)
    assert json.loads((data_dir / runtime_benchmark.DATASET_MARKER).read_text()) == MARKER


def test_rate_limit_retries_are_bounded_and_do_not_mark_complete(download_setup) -> None:
    data_dir, snapshot, sleep = download_setup
    snapshot.side_effect = ConnectionError("HTTP status client error (429 Too Many Requests)")

    with pytest.raises(ConnectionError, match="429"):
        runtime_benchmark.download()

    assert snapshot.call_count == 4
    assert sleep.call_count == 3
    assert not (data_dir / runtime_benchmark.DATASET_MARKER).exists()


@pytest.mark.parametrize("status", [401, 403, 404])
def test_permanent_http_errors_are_not_retried(download_setup, status: int) -> None:
    data_dir, snapshot, sleep = download_setup
    snapshot.side_effect = HfHubHTTPError(
        "request failed", response=httpx.Response(status, request=httpx.Request("GET", "https://huggingface.co"))
    )

    with pytest.raises(HfHubHTTPError):
        runtime_benchmark.download()

    snapshot.assert_called_once()
    sleep.assert_not_called()
    assert not (data_dir / runtime_benchmark.DATASET_MARKER).exists()


def test_complete_matching_cache_skips_download(download_setup) -> None:
    data_dir, snapshot, sleep = download_setup
    complete_dataset(data_dir)
    (data_dir / runtime_benchmark.DATASET_MARKER).write_text(json.dumps(MARKER))

    runtime_benchmark.download()

    snapshot.assert_not_called()
    sleep.assert_not_called()


def test_different_revision_is_cleared_before_download(download_setup) -> None:
    data_dir, snapshot, _sleep = download_setup
    complete_dataset(data_dir)
    (data_dir / "obsolete.pdf").touch()
    marker_path = data_dir / runtime_benchmark.DATASET_MARKER
    marker_path.write_text(json.dumps({**MARKER, "resolved_sha": "b" * 40}))

    def fetch(**_kwargs):
        assert not (data_dir / "obsolete.pdf").exists()
        assert not marker_path.exists()
        complete_dataset(data_dir)

    snapshot.side_effect = fetch
    runtime_benchmark.download()

    snapshot.assert_called_once()
    assert json.loads(marker_path.read_text()) == MARKER


def test_incomplete_snapshot_is_not_marked_complete(download_setup) -> None:
    data_dir, snapshot, _sleep = download_setup
    snapshot.side_effect = lambda **_kwargs: data_dir.mkdir()

    with pytest.raises(SystemExit, match="incomplete"):
        runtime_benchmark.download()

    assert not (data_dir / runtime_benchmark.DATASET_MARKER).exists()
