#!/usr/bin/env python3
"""Publish a built macOS bundle to the single, stable local QA entry point."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import plistlib
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
QA_PATH = ROOT / "build/qa/ReT Markdown QA.app"
QA_ID = "net.ret-markdown.qa"
QA_NAME = "ReT Markdown QA"


def running_pids(destination):
    # Fail closed if process inspection is unavailable. Never replace a running QA.
    result = subprocess.run(["/bin/ps", "-axo", "pid=,comm="], check=True,
                            capture_output=True, text=True)
    prefix = str(destination) + "/Contents/MacOS/"
    return [int(fields[0]) for line in result.stdout.splitlines()
            if len(fields := line.strip().split(None, 1)) == 2
            and fields[1].startswith(prefix)]


def qa_plist(original, source, identity):
    if not re.fullmatch(r"[0-9a-f]{64}", identity):
        raise ValueError("source identity must be a full lowercase SHA-256")
    result = dict(original)
    result.update(CFBundleIdentifier=QA_ID, CFBundleName=QA_NAME,
                  CFBundleDisplayName=QA_NAME, ReTQASourceIdentity=identity,
                  ReTQASourceBundlePath=str(source))
    return result


def publish(source, identity, destination=QA_PATH):
    source = source.resolve(strict=True)
    if destination.is_symlink() or destination.parent.is_symlink():
        raise ValueError("QA destination must not be a symlink")
    destination = destination.resolve()
    if source == destination:
        raise ValueError("source and QA destination must differ")
    with (source / "Contents/Info.plist").open("rb") as stream:
        info = qa_plist(plistlib.load(stream), source, identity)
    if pids := running_pids(destination):
        raise RuntimeError(f"QA is running (PIDs {pids}); preserve documents and quit it manually before updating")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".prepare-", dir=destination.parent) as stage:
        staged = Path(stage) / QA_PATH.name
        subprocess.run(["/usr/bin/ditto", str(source), str(staged)], check=True)
        with (staged / "Contents/Info.plist").open("wb") as stream:
            plistlib.dump(info, stream)
        subprocess.run(["/usr/bin/codesign", "--force", "--deep", "--sign", "-", str(staged)], check=True)
        subprocess.run(["/usr/bin/codesign", "--verify", "--strict", "--deep", str(staged)], check=True)
        # Check again after staging, in case the previous QA was opened meanwhile.
        if running_pids(destination):
            raise RuntimeError("QA was launched while staging; existing bundle was not replaced")
        previous = None
        if destination.exists():
            history = destination.parent / "history"
            history.mkdir(exist_ok=True)
            previous = Path(tempfile.mkdtemp(prefix=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ-"), dir=history)) / QA_PATH.name
            destination.rename(previous)
        try:
            staged.rename(destination)
        except BaseException:
            if previous is not None:
                previous.rename(destination)
            raise
    manifest = dict(qaPath=str(destination), qaBundleID=QA_ID,
                    sourceIdentity=identity, sourceBundlePath=str(source),
                    releaseVersion=info.get("ReTReleaseVersion", info.get("CFBundleShortVersionString")),
                    executableSHA256=hashlib.sha256((destination / "Contents/MacOS" / info["CFBundleExecutable"]).read_bytes()).hexdigest(),
                    previousQAPath=str(previous) if previous else None)
    (destination.parent / "current.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="immutable, already-built canonical .app")
    parser.add_argument("--source-identity", required=True, help="full source SHA-256 from the build evidence")
    args = parser.parse_args()
    print(json.dumps(publish(args.source, args.source_identity), indent=2))
