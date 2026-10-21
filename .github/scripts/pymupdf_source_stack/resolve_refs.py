#!/usr/bin/env python3
"""Resolve supported source selections to immutable commits before checkout."""

from __future__ import annotations

import json
from pathlib import Path

from common import COMPONENT_SPECS, env, write_github_outputs, write_json
from parsebench_version_lab.process import CommandRunner
from parsebench_version_lab.sources import SourceManager


def main() -> int:
    output_dir = Path(env("OUTPUT_DIR"))
    request_path = output_dir / "_source_request.json"
    request = json.loads(request_path.read_text(encoding="utf-8"))
    manager = SourceManager(CommandRunner())
    outputs = {}
    resolved = {}
    for name, component in COMPONENT_SPECS.items():
        selection = request[name]["ref"]
        try:
            if name == "pymupdf":
                source = manager.resolve_branch(component, selection)
            elif name == "mupdf":
                source = manager.resolve_mupdf(resolved["pymupdf"])
            else:
                source = manager.resolve_branch(component, component.default_branch)
            resolved[name] = source
        except (OSError, RuntimeError, ValueError) as error:
            message = f"Cannot resolve {component.label} selection {selection!r}: {error}"
            write_json(
                output_dir / "_failure.json",
                {
                    "title": "Cannot resolve source selection",
                    "error": message,
                    "component": component.label,
                    "repository": component.repository,
                    "requested_ref": selection,
                },
            )
            raise SystemExit(message) from error
        request[name] = {
            "selection": selection,
            "repository": source.repository,
            "ref": source.requested_ref,
            "branch": source.selected_branch,
            "resolved_sha": source.resolved_sha,
        }
        outputs[f"{name}_ref"] = source.requested_ref
        outputs[f"{name}_sha"] = source.resolved_sha
        # Keep successfully resolved provenance if a later component fails.
        write_json(request_path, request)

    write_github_outputs(outputs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
