#!/usr/bin/env python3
"""Fail if the tracked public artifact contains local state or likely credentials."""
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
try:
    tracked = subprocess.check_output(
        ["git", "ls-files", "-z"], cwd=ROOT, stderr=subprocess.DEVNULL
    ).decode().split("\0")
    tracked = [name for name in tracked if name]
except (FileNotFoundError, subprocess.CalledProcessError):
    # GitHub source archives do not contain .git; scan the extracted artifact.
    tracked = [str(path.relative_to(ROOT)) for path in ROOT.rglob("*") if path.is_file()]

blocked_names = {".env", "config.ini", "anycubic_slicer.crt", "anycubic_slicer.key"}
blocked_suffixes = {".gcode", ".3mf", ".db", ".sqlite", ".log", ".pem", ".key", ".crt"}
patterns = {
    "private key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "GitHub token": re.compile(rb"gh[pousr]_[A-Za-z0-9_]{20,}"),
    "AWS access key": re.compile(rb"AKIA[0-9A-Z]{16}"),
    "local service path": re.compile(rb"/Users/[^/\s]+/(?:services|\.hermes)|/volume\d+/docker"),
}
errors = []
for name in tracked:
    path = ROOT / name
    # The scanner necessarily contains its own detection patterns.
    if name == "scripts/release_check.py":
        continue
    lower = path.name.lower()
    if lower in blocked_names or path.suffix.lower() in blocked_suffixes or ".bak" in lower:
        errors.append(f"blocked tracked file: {name}")
        continue
    if path.is_symlink():
        errors.append(f"symlink not allowed in release: {name}")
        continue
    data = path.read_bytes()
    for label, pattern in patterns.items():
        if pattern.search(data):
            errors.append(f"{label}: {name}")
for required in ("LICENSE", "NOTICE.md", "README.md", "SECURITY.md",
                 "web/themes/default/lib/gridstack.LICENSE.txt",
                 "web/themes/default/lib/pickr.LICENSE.txt"):
    if required not in tracked:
        errors.append(f"missing required file: {required}")
readme = (ROOT / "README.md").read_text(encoding="utf-8")
if "based on [KX-Bridge by viewit]" not in readme:
    errors.append("README attribution missing")
if errors:
    print("\n".join(errors), file=sys.stderr)
    raise SystemExit(1)
print(f"release check: {len(tracked)} tracked files, no blocked state or secrets")
