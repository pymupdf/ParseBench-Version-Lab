"""Command-line adapter for native local Version Lab runs."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .benchmark_index import backfill_repository
from .local import LocalRun, create_paths, doctor, ensure_ready
from .model import COMPONENT_SPECS, GROUPS, PIPELINES, RUN_SCOPES, STANDARD_REF, RunConfig
from .util import repository_root


class HelpFormatter(argparse.ArgumentDefaultsHelpFormatter):
    """Show meaningful defaults while omitting argparse's internal None values."""

    def _get_help_string(self, action: argparse.Action) -> str:
        if action.default is None:
            return action.help or ""
        return super()._get_help_string(action)


def add_run_options(parser: argparse.ArgumentParser) -> None:
    for name, component in COMPONENT_SPECS.items():
        parser.add_argument(
            f"--{name.replace('_', '-')}-ref",
            default=STANDARD_REF,
            help=f"{component.label} tag, branch, or full commit SHA",
        )
    parser.add_argument(
        "--dataset-ref",
        default="current",
        help="ParseBench dataset revision: 'current' or a full 40-character commit SHA",
    )
    parser.add_argument(
        "--pipeline",
        choices=PIPELINES,
        default=PIPELINES[0],
        help="Registered PyMuPDF4LLM pipeline to benchmark",
    )
    parser.add_argument(
        "--scope",
        choices=RUN_SCOPES,
        default="quick",
        help="Dataset size: the 15-document quick test or the complete benchmark",
    )
    parser.add_argument(
        "--group",
        choices=GROUPS,
        default="all",
        help="Document category to benchmark, or all categories",
    )
    latest = parser.add_mutually_exclusive_group()
    latest.add_argument(
        "--all-latest",
        action="store_true",
        help="Use the latest commit on every component's default branch; ignore explicit component refs",
    )
    latest.add_argument(
        "--latest-any-branch",
        action="store_true",
        help="Use each component's newest branch-head commit; ignore explicit component refs",
    )
    parser.add_argument(
        "--python",
        default="3.12",
        help="Python version or executable understood by uv for the isolated benchmark environment",
    )


def config_from_args(args: argparse.Namespace) -> RunConfig:
    return RunConfig(
        **{f"{name}_ref": getattr(args, f"{name}_ref") for name in COMPONENT_SPECS},
        dataset_ref=args.dataset_ref,
        pipeline=args.pipeline,
        scope=args.scope,
        group=args.group,
        all_latest=args.all_latest,
        latest_any_branch=args.latest_any_branch,
        python=args.python,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="version-lab", description=__doc__, formatter_class=HelpFormatter)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser(
        "doctor",
        help="Check native platform prerequisites",
        description="Check the current platform and required native build tools.",
        formatter_class=HelpFormatter,
    )

    plan = subparsers.add_parser(
        "plan",
        help="Print a normalized run plan without changing files",
        description="Normalize and print the selected source and benchmark configuration without running it.",
        formatter_class=HelpFormatter,
    )
    add_run_options(plan)

    run = subparsers.add_parser(
        "run",
        help="Resolve, build, verify, and benchmark the selected stack",
        description="Resolve, build, verify, and benchmark the selected source stack in an isolated environment.",
        formatter_class=HelpFormatter,
    )
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
    backfill = subparsers.add_parser(
        "backfill-index",
        help="Index historical GitHub Actions and GCS benchmark runs in Supabase",
        description=(
            "Build a local GCS run inventory and idempotently upsert GitHub workflow metadata, "
            "scores, document results, metrics, and errors into Supabase."
        ),
        formatter_class=HelpFormatter,
    )
    backfill.add_argument(
        "--repository",
        default="pymupdf/ParseBench-Version-Lab",
        help="GitHub repository whose Actions runs should be indexed",
    )
    backfill.add_argument(
        "--bucket",
        required=True,
        help="Google Cloud Storage bucket containing published ParseBench runs",
    )
    backfill.add_argument(
        "--workflow",
        default="pymupdf-source-stack-parsebench.yml",
        help="Benchmark workflow file or numeric workflow ID",
    )
    backfill.add_argument(
        "--workspace",
        type=Path,
        help="Ignored directory for the GCS inventory and backfill result",
    )
    return parser


def main(arguments: list[str] | None = None) -> int:
    args = build_parser().parse_args(arguments)
    if args.command == "doctor":
        status = doctor()
        print(json.dumps(status, indent=2, sort_keys=True))
        return 0 if status["ready"] else 1
    if args.command == "backfill-index":
        repository = repository_root()
        workspace = (args.workspace or repository / ".version-lab" / "benchmark-index-backfill").resolve()
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_secret_key = os.environ.get("SUPABASE_SECRET_KEY")
        if not supabase_url or not supabase_secret_key:
            print("SUPABASE_URL and SUPABASE_SECRET_KEY are required", file=sys.stderr)
            return 2
        result = backfill_repository(
            github_repository=args.repository,
            bucket=args.bucket,
            workflow=args.workflow,
            supabase_url=supabase_url,
            supabase_secret_key=supabase_secret_key,
            workspace=workspace,
        )
        print(json.dumps(result, indent=2, sort_keys=True))
        print(f"Backfill inventory: {workspace / 'gcs-run-inventory.json'}")
        return 0 if result["runs_failed"] == 0 else 1
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
