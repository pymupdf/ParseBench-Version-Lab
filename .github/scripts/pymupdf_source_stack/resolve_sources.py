#!/usr/bin/env python3
"""Verify pinned source checkouts and locate their installable packages."""

from __future__ import annotations

import json
from pathlib import Path

from common import COMPONENT_SPECS, env, git_sha, mupdf_build_spec, write_github_outputs, write_json
from parsebench_version_lab.local import package_dir
from parsebench_version_lab.sources import ResolvedSource


def main() -> int:
    output_dir = Path(env("OUTPUT_DIR"))
    request = json.loads((output_dir / "_source_request.json").read_text(encoding="utf-8"))
    outputs = {}
    for name, component in COMPONENT_SPECS.items():
        root = Path(".source") / component.checkout_dir
        sha = git_sha(root)
        source = ResolvedSource(name, component.label, component.repository, request[name]["ref"], sha, root)
        try:
            if sha != request[name]["resolved_sha"]:
                raise RuntimeError(f"{component.label} checkout {sha} differs from the resolved commit.")
            package = root if name == "mupdf" else package_dir(source)
        except RuntimeError as error:
            write_json(
                output_dir / "_failure.json",
                {
                    "title": f"Cannot build {component.label}",
                    "error": str(error),
                    "component": component.label,
                    "requested_ref": request[name]["ref"],
                    "resolved_sha": sha,
                },
            )
            raise SystemExit(str(error)) from error
        outputs[f"{name}_dir"] = str(package)
        outputs[f"{name}_sha"] = sha
    outputs["mupdf_build"] = mupdf_build_spec(outputs["mupdf_sha"])
    write_github_outputs(outputs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
