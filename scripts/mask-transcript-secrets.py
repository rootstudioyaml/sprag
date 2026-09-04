#!/usr/bin/env python3
"""Mask credential values inside Claude Code transcript logs.

Pasting a .env line into a session puts the real token into
~/.claude/projects/**/*.jsonl in plaintext, where it outlives the session and
gets picked up by backups and by anything that reads the logs. This rewrites
the token value in place and leaves everything else byte-identical.

No backup is written on purpose: a .bak holding the original token would
defeat the point. The edit is therefore irreversible.

The file for a session that is still running is skipped unless --force is
given, because truncating a log that Claude Code is appending to can drop the
lines written in between and break --resume.

Usage:
    mask-transcript-secrets.py --dry-run            # report only
    mask-transcript-secrets.py                      # mask finished sessions
    mask-transcript-secrets.py --force <file.jsonl> # include a named file
"""

import argparse
import os
import re
import sys
from pathlib import Path

# Each pattern keeps its recognizable prefix so a reader can still tell which
# credential was there, and replaces the secret part only.
PATTERNS = [
    (re.compile(r"npm_[A-Za-z0-9]{30,}"), "npm_***REDACTED***"),
    (re.compile(r"github_pat_[A-Za-z0-9_]{40,}"), "github_pat_***REDACTED***"),
    (re.compile(r"ghp_[A-Za-z0-9]{30,}"), "ghp_***REDACTED***"),
    (re.compile(r"sk-ant-[A-Za-z0-9\-_]{40,}"), "sk-ant-***REDACTED***"),
    (re.compile(r"sk-proj-[A-Za-z0-9\-_]{40,}"), "sk-proj-***REDACTED***"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "AKIA***REDACTED***"),
    (re.compile(r"xox[bpasr]-[0-9A-Za-z-]{20,}"), "xoxb-***REDACTED***"),
    (re.compile(r"AIza[0-9A-Za-z\-_]{35}"), "AIza***REDACTED***"),
    (re.compile(r"1//[0-9A-Za-z\-_]{40,}"), "1//***REDACTED***"),  # Google OAuth refresh token
]

def mask(text):
    """Return the masked text and how many replacements were made."""
    total = 0
    for pattern, replacement in PATTERNS:
        text, n = pattern.subn(replacement, text)
        total += n
    return text, total

def current_session_files():
    """Transcript files that a running Claude Code process holds open."""
    open_files = set()
    try:
        import subprocess
        out = subprocess.run(
            ["lsof", "-c", "claude", "-Fn"], capture_output=True, text=True, timeout=20
        ).stdout
        for line in out.splitlines():
            if line.startswith("n") and line.endswith(".jsonl"):
                open_files.add(os.path.realpath(line[1:]))
    except Exception:
        pass  # without lsof we fall back to skipping nothing
    return open_files

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*", help="files to scan (default: all transcripts)")
    ap.add_argument("--dry-run", action="store_true", help="report matches, change nothing")
    ap.add_argument("--force", action="store_true", help="also rewrite logs of running sessions")
    args = ap.parse_args()

    if args.files:
        targets = [Path(f) for f in args.files]
    else:
        targets = sorted(Path.home().glob(".claude/projects/*/*.jsonl"))

    live = set() if args.force else current_session_files()
    changed = skipped = 0

    for path in targets:
        try:
            text = path.read_text(encoding="utf-8", errors="surrogateescape")
        except OSError as e:
            print(f"  skip {path}: {e}", file=sys.stderr)
            continue
        masked, n = mask(text)
        if not n:
            continue
        if os.path.realpath(path) in live:
            print(f"  LIVE {path}: {n} match(es) — session still running, left alone")
            skipped += 1
            continue
        if args.dry_run:
            print(f"  would mask {n} in {path}")
            continue
        path.write_text(masked, encoding="utf-8", errors="surrogateescape")
        print(f"  masked {n} in {path}")
        changed += 1

    verb = "would change" if args.dry_run else "changed"
    print(f"{verb} {changed} file(s); {skipped} skipped as live")

if __name__ == "__main__":
    main()
