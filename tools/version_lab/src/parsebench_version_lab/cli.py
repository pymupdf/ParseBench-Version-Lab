"""Command-line adapter for native local Version Lab runs."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .local import LocalRun, create_paths, doctor, ensure_ready
from .model import GROUPS, RUN_SCOPES, RunConfig
from .util import repository_root


def add_run_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--mupdf-ref", default="1.28.0")
    parser.add_argument("--pymupdf-ref", default="1.28.0")
    parser.add_argument("--pymupdf-layout-ref", default="1.28.0")
    parser.add_argument("--pymupdf4llm-ref", default="1.28.0")
    parser.add_argument("--dataset-ref", default="current")
    parser.add_argument("--scope", choices=RUN_SCOPES, default="quick")
    parser.add_argument("--group", choices=GROUPS, default="all")
    latest = parser.add_mutually_exclusive_group()
    latest.add_argument("--all-latest", action="store_true")
    latest.add_argument("--latest-any-branch", action="store_true")
    parser.add_argument("--python", default="3.12", help="Python version or executable understood by uv")


def config_from_args(args: argparse.Namespace) -> RunConfig:
    return RunConfig(
        mupdf_ref=args.mupdf_ref,
        pymupdf_ref=args.pymupdf_ref,
        pymupdf_layout_ref=args.pymupdf_layout_ref,
        pymupdf4llm_ref=args.pymupdf4llm_ref,
        dataset_ref=args.dataset_ref,
        scope=args.scope,
        group=args.group,
        all_latest=args.all_latest,
        latest_any_branch=args.latest_any_branch,
        python=args.python,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="version-lab", description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("doctor", help="Check native platform prerequisites")

    plan = subparsers.add_parser("plan", help="Print a normalized run plan without changing files")
    add_run_options(plan)

    run = subparsers.add_parser("run", help="Resolve, build, verify, and benchmark the selected stack")
    add_run_options(run)
    run.add_argument(
        "--workspace",
        type=Path,
        help="Persistent run/cache root (default: REPOSITORY/.version-lab)",
    )
    run.add_argument(
        "--resolve-only",
        action="store_true",
        help="Resolve and checkout exact source/dataset commits without building",
    )
    return parser


def main(arguments: list[str] | None = None) -> int:
    args = build_parser().parse_args(arguments)
    if args.command == "doctor":
        status = doctor()
        print(json.dumps(status, indent=2, sort_keys=True))
        return 0 if status["ready"] else 1
    config = config_from_args(args)
    if args.command == "plan":
        print(json.dumps(config.to_dict(), indent=2, sort_keys=True))
        return 0
    repository = repository_root()
    ensure_ready(resolve_only=args.resolve_only)
    workspace = (args.workspace or repository / ".version-lab").resolve()
    paths = create_paths(repository, workspace)
    print(f"Version Lab run directory: {paths.run}")
    local_run = LocalRun(config, paths)
    try:
        local_run.run(resolve_only=args.resolve_only)
    except Exception as error:
        local_run.record_manifest(status="failed")
        print(f"Version Lab failed: {error}", file=sys.stderr)
        print(f"Run diagnostics: {paths.run}", file=sys.stderr)
        return 1
    print(f"Version Lab completed: {paths.run}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
