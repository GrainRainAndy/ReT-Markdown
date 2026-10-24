#!/usr/bin/env python3
"""Bind the final committed inputs and actual candidate bundle, without launching it."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import re
import subprocess
root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("output", type=Path)
parser.add_argument("--expected-build", required=True)
parser.add_argument("--evidence-root", required=True, type=Path)
args = parser.parse_args()
evidence_root = args.evidence_root.resolve()
if not evidence_root.is_dir():
    parser.error("Evidence root must exist")

def command(*args):
    return subprocess.check_output(args, cwd=root).decode().strip()

def digest(data):
    return hashlib.sha256(data).hexdigest()

def item(path, base):
    data = path.read_bytes()
    return {"path": path.relative_to(base).as_posix(), "bytes": len(data), "sha256": digest(data)}

head = command("git", "rev-parse", "HEAD")
tracked = command("git", "ls-files").splitlines()
roots = ("editor/", "native/Sources/", "native/Tests/", "scripts/", "shared/", "tests/", "fixtures/")
names = {"native/Package.swift", "package.json", "package-lock.json", "tsconfig.json", "THIRD_PARTY_NOTICES.md", "playwright.config.ts"}
inputs = []
for name in sorted(p for p in tracked if p.startswith(roots) or p in names):
    path = root / name
    if path.is_symlink():
        raise RuntimeError("Unexpected source symlink: " + name)
    committed = subprocess.check_output(["git", "show", head + ":" + name], cwd=root)
    if path.read_bytes() != committed:
        raise RuntimeError("Uncommitted input: " + name)
    inputs.append(item(path, root))
version = json.loads((root / "package.json").read_text())["version"]
app = root / "build/rewrite" / version / "ReT Markdown Preview.app"
plist = plistlib.loads((app / "Contents/Info.plist").read_bytes())
assert plist["CFBundleShortVersionString"] == version
assert plist["CFBundleVersion"] == args.expected_build
bundle = [item(p, app) for p in sorted(app.rglob("*")) if p.is_file()]
web = app / "Contents/Resources/web"
dist = root / "dist/web"
assert {p.relative_to(web) for p in web.rglob("*") if p.is_file()} == {p.relative_to(dist) for p in dist.rglob("*") if p.is_file()}
for path in dist.rglob("*"):
    if path.is_file() and path.read_bytes() != (web / path.relative_to(dist)).read_bytes():
        raise RuntimeError("Bundle/dist mismatch: " + str(path))
release = Path(command("swift", "build", "--package-path", "native", "-c", "release", "--show-bin-path")) / "ReTPreview"
# codesign mutates Mach-O; compare unsigned code content via codesign identity and
# keep both file digests, rather than falsely asserting raw byte equality.
subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
release_uuid = re.search(r"UUID: ([A-Fa-f0-9-]+)", command("dwarfdump", "--uuid", str(release))).group(1)
bundle_uuid = re.search(r"UUID: ([A-Fa-f0-9-]+)", command("dwarfdump", "--uuid", str(app / "Contents/MacOS/ReTPreview"))).group(1)
assert release_uuid == bundle_uuid, "Native release/bundle UUID mismatch"
signature = subprocess.run(["codesign", "-d", "--verbose=4", str(app)], capture_output=True, text=True, check=True).stderr
canonical = lambda value: json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
node = Path(command("which", "node")).resolve()
record = {"sourceCommit": head, "version": version, "build": plist["CFBundleVersion"], "bundleID": plist["CFBundleIdentifier"], "appPath": str(app), "macOS": command("sw_vers", "-productVersion"), "osBuild": command("sw_vers", "-buildVersion"), "architecture": command("uname", "-m"), "node": {"path": str(node), "version": command(str(node), "--version"), "sha256": digest(node.read_bytes())}, "nativeReleaseBinary": {"path": str(release), "sha256": digest(release.read_bytes()), "uuid": release_uuid}, "nativeBundleUUID": bundle_uuid, "signature": signature, "inputManifestSHA256": digest(canonical(inputs)), "bundleManifestSHA256": digest(canonical(bundle)), "bundleBytes": sum(p["bytes"] for p in bundle), "inputsMatchCommit": True, "bundledWebMatchesDist": True, "testWebEntry": str(web / "index.html"), "digestAlgorithm": "SHA256 of compact UTF8 JSON sorted keys and path-ordered entries, ensure_ascii=False", "inputs": inputs, "bundle": bundle}
evidence_paths = list(evidence_root.glob("*.log"))
evidence_paths += list(evidence_root.glob("*.jsonl"))
evidence_paths += list(evidence_root.glob("*.md"))
evidence_paths += list(evidence_root.glob("*.txt"))
for directory in ("pdf", "lifecycle", "saved", "native-qa"):
    evidence_paths += [p for p in (evidence_root / directory).rglob("*") if p.is_file()]
evidence = [item(p, evidence_root) for p in sorted(set(evidence_paths))]
record["evidence"] = evidence
record["evidenceManifestSHA256"] = digest(canonical(evidence))
record["evidenceSourceCommit"] = head
record["evidenceRoot"] = str(evidence_root)
out = args.output; out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({k: v for k, v in record.items() if k not in ("inputs", "bundle", "signature", "evidence")}, ensure_ascii=False, indent=2))
