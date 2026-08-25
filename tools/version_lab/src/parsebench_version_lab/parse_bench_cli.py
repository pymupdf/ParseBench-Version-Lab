"""ParseBench CLI with Version Lab-only pipelines registered."""

from parse_bench.cli import main as parse_bench_main  # type: ignore[import-untyped]

from .pipelines import register_version_lab_pipelines


def main() -> int:
    register_version_lab_pipelines()
    return int(parse_bench_main())


if __name__ == "__main__":
    raise SystemExit(main())
