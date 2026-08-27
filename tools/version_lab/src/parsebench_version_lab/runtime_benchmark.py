"""Dataset and benchmark phases executed inside the selected target environment."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from .coverage import inspect_dataset
from .evaluation_diagnostics import write_diagnostics_from_report
from .util import required_env

DATASET_MARKER = ".parsebench-dataset-revision.json"


def run(*arguments: str) -> None:
    subprocess.run(arguments, check=True)


def parse_bench(*arguments: str) -> None:
    run(sys.executable, "-m", "parsebench_version_lab.parse_bench_cli", *arguments)


def download() -> None:
    from huggingface_hub import snapshot_download
    from parse_bench.data.download import is_dataset_ready  # type: ignore[import-untyped]

    data_dir = Path(required_env("DATA_DIR"))
    repository = required_env("DATASET_REPOSITORY")
    revision = required_env("DATASET_SHA")
    marker_path = data_dir / DATASET_MARKER
    expected_marker = {"repository": repository, "resolved_sha": revision}
    try:
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        marker = None
    if marker == expected_marker and is_dataset_ready(data_dir):
        print(f"Reusing cached immutable dataset snapshot: {repository}@{revision}")
    else:
        if data_dir.exists():
            print("Cached dataset is absent, incomplete, or for a different revision; downloading it again.")
            shutil.rmtree(data_dir)
        print(f"Downloading immutable dataset snapshot: {repository}@{revision}")
        snapshot_download(
            repo_id=repository,
            repo_type="dataset",
            local_dir=str(data_dir),
            revision=revision,
            force_download=True,
        )
        if not is_dataset_ready(data_dir):
            raise SystemExit(f"Dataset snapshot {repository}@{revision} is incomplete at {data_dir}")
        marker_path.write_text(json.dumps(expected_marker, indent=2) + "\n", encoding="utf-8")

    output_dir = os.environ.get("OUTPUT_DIR")
    if output_dir:
        dataset_path = Path(output_dir) / "_dataset.json"
        if dataset_path.is_file():
            dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
            dataset["manifest"] = inspect_dataset(data_dir)
            dataset_path.write_text(json.dumps(dataset, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def inference() -> None:
    arguments = [
        "inference",
        "run",
        required_env("PIPELINE"),
        "--input_dir",
        required_env("DATA_DIR"),
        "--output_dir",
        required_env("OUTPUT_DIR"),
        "--max_concurrent",
        "1",
    ]
    if required_env("GROUP") != "all":
        arguments.extend(("--group", required_env("GROUP")))
    parse_bench(*arguments)


def evaluation_groups(pipeline_output_dir: Path) -> list[str]:
    groups = {result.parent.name for result in pipeline_output_dir.glob("*/*.result.json")}
    if not groups:
        raise SystemExit(f"No inference result groups found in {pipeline_output_dir}")
    if "text" in groups:
        groups.remove("text")
        groups.update(("text_content", "text_formatting"))
    return sorted(groups)


def evaluate_group(group: str, report_dir: Path) -> None:
    parse_bench(
        "evaluation",
        "run",
        "--output_dir",
        str(Path(required_env("OUTPUT_DIR")) / required_env("PIPELINE")),
        "--test_cases_dir",
        required_env("DATA_DIR"),
        "--group",
        group,
        "--report_dir",
        str(report_dir),
        "--export_csv=False",
        "--export_rule_csv=False",
        "--export_markdown=False",
        "--export_html=False",
    )
    diagnostic_index = write_diagnostics_from_report(
        report_dir,
        test_cases_dir=Path(required_env("DATA_DIR")),
        dimension=group,
    )
    print(f"Version Lab diagnostics saved to: {diagnostic_index.resolve()}")


def evaluate() -> None:
    pipeline_output_dir = Path(required_env("OUTPUT_DIR")) / required_env("PIPELINE")
    group = required_env("GROUP")
    if group != "all":
        evaluate_group(group, pipeline_output_dir)
        return
    groups = evaluation_groups(pipeline_output_dir)
    (pipeline_output_dir / "_eval_groups.txt").write_text("\n".join(groups) + "\n", encoding="utf-8")
    for evaluation_group in groups:
        evaluate_group(evaluation_group, pipeline_output_dir / evaluation_group)


def regenerate(evaluation_dir: Path, report_dir: Path) -> None:
    pipeline_output_dir = Path(required_env("OUTPUT_DIR")) / required_env("PIPELINE")
    parse_bench(
        "evaluation",
        "regenerate_report",
        "--evaluation_dir",
        str(evaluation_dir),
        "--test_cases_dir",
        required_env("DATA_DIR"),
        "--output_dir",
        str(pipeline_output_dir),
        "--report_dir",
        str(report_dir),
    )


def report() -> None:
    output_dir = Path(required_env("OUTPUT_DIR"))
    pipeline = required_env("PIPELINE")
    pipeline_output_dir = output_dir / pipeline
    if required_env("GROUP") != "all":
        regenerate(pipeline_output_dir, pipeline_output_dir)
        return
    groups_file = pipeline_output_dir / "_eval_groups.txt"
    for group in groups_file.read_text(encoding="utf-8").splitlines():
        if group:
            regenerate(pipeline_output_dir / group, pipeline_output_dir / group)
    parse_bench(
        "analysis",
        "generate_dashboard",
        "--evaluation_dir",
        str(pipeline_output_dir),
        "--pipeline_name",
        pipeline,
    )
    parse_bench("analysis", "generate_leaderboard", "--output_dir", str(output_dir))


COMMANDS = {"download": download, "inference": inference, "evaluate": evaluate, "report": report}


def main(arguments: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=COMMANDS)
    args = parser.parse_args(arguments)
    COMMANDS[args.command]()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
