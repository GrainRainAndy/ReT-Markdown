"""Collect installed runtime licenses conservatively from the pinned npm lock."""
import hashlib
import json
from pathlib import Path
root = Path(__file__).resolve().parent.parent
lock = root / "package-lock.json"
sections = ["# Third-party notices\n\nThis file records licenses shipped with the runtime packages in package-lock.json. It includes transitive packages conservatively; not every package is necessarily present in the final JavaScript bundle. Development-only packages are excluded.\n\nPackage lock SHA-256: `" + hashlib.sha256(lock.read_bytes()).hexdigest() + "`.\n"]
for path, package in sorted(json.loads(lock.read_text())["packages"].items()):
    if not path or package.get("dev"):
        continue
    directory = root / path
    candidates = sorted(p for p in directory.iterdir() if p.is_file() and p.name.lower().startswith(("license", "licence", "copying")))
    if not candidates:
        raise RuntimeError(f"Missing runtime license: {path}")
    license_file = candidates[0]
    name = path.split("node_modules/")[-1]
    sections.append(f"## {name} {package['version']}\n\nSource: `{license_file.relative_to(root)}`\n\n```text\n{license_file.read_text().rstrip()}\n```\n")
(root / "THIRD_PARTY_NOTICES.md").write_text("\n".join(sections))
