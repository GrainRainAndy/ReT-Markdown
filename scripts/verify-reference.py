#!/usr/bin/env python3
"""Verify the local Typora reference against the tracked research provenance."""

import hashlib
import json
from pathlib import Path
import sys


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def verify(root):
    provenance = json.loads((root / "docs/research/typora-provenance.json").read_text())
    app = root / provenance["reference_root"]
    if not app.is_dir():
        raise ValueError("Local reference missing: Typora.app")

    entries = []
    for path in sorted(app.rglob("*")):
        relative = str(path.relative_to(app))
        if path.is_symlink():
            entries.append({"path": relative, "kind": "symlink", "target": str(path.readlink())})
        elif path.is_file():
            entries.append({
                "path": relative, "kind": "file", "sha256": sha256(path.read_bytes()),
                "size": path.stat().st_size, "executable": bool(path.stat().st_mode & 0o111),
            })
    digest = sha256(json.dumps(entries, sort_keys=True, separators=(",", ":")).encode())
    if digest != provenance["manifest_sha256"] or len(entries) != provenance["entry_count"]:
        raise ValueError("Reference bundle differs from the recorded file/symlink manifest")

    by_path = {item["path"]: item for item in entries}
    for expected in provenance["key_files"]:
        if by_path.get(expected["path"]) != expected:
            raise ValueError("Reference identity mismatch: " + expected["path"])

    bundles = {}
    for module in provenance["selected_modules"]:
        path = root / module["input_path"]
        if path not in bundles:
            bundles[path] = path.read_bytes()
        data = bundles[path]
        if sha256(data) != module["bundle_sha256"]:
            raise ValueError("Source bundle mismatch: " + module["input_path"])
        span = module["source_utf8"]
        sliced = data[span["start"]:span["end"]]
        if sha256(sliced) != module["sha256"] or len(sliced) != module["bytes"]:
            raise ValueError("Source slice mismatch: " + module["analysis_alias"])
        utf16 = data.decode("utf-8").encode("utf-16-le")
        location = module["source_utf16"]
        from_utf16 = utf16[location["start"] * 2:location["end"] * 2].decode("utf-16-le").encode("utf-8")
        if from_utf16 != sliced:
            raise ValueError("UTF-16/UTF-8 location mismatch: " + module["analysis_alias"])
        focus = root / module["focus_path"]
        if focus.exists() and focus.read_bytes() != sliced:
            raise ValueError("Local REA input differs: " + module["focus_path"])

    print(json.dumps({
        "status": "verified", "bundle": provenance["bundle_info"],
        "manifest_sha256": digest, "entries": len(entries),
        "selected_modules_verified": len(provenance["selected_modules"]),
        "scope": "static artifact identity and exact source ranges; no runtime behavior verified",
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        verify(Path(__file__).resolve().parents[1])
    except (OSError, ValueError, KeyError) as error:
        print("Reference verification failed: " + str(error), file=sys.stderr)
        sys.exit(1)
