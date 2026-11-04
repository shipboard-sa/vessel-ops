"""
Purpose: Privacy gate for the release package - fail if any user-visible text still
    names the original owner's boat, people, places, hosts or private paths.
Version: v2 (2026-09-24) - v2: 'brownie' next to cooking words (the dessert) is not a hit. v1 (2026-09-24)
Scope: STANDALONE UTILITY - release tooling; run by build_release.py, never by the app.
Architecture: Scans (a) the built frontend bundle (Vite strips comments, so what is left
    is what a user can see) and (b) Python STRING values in the shipped .py files, skipping
    comments and docstrings (developer notes, not screen text), plus (c) every other shipped
    text file (docs, .bat, .md, .json) in full. Exit 1 with file:line hits on any match.

Usage: python scripts/release/privacy_scan.py <release_dir>
"""
from __future__ import annotations

import io
import re
import sys
import tokenize
from pathlib import Path

# Whole-word, case-insensitive. Keep this list in step with Owner's memory of what is
# private: people, the boat and its prior names, yards/vendors, places, hosts, call sign.
BANNED = re.compile(
    r"\b(Owner|Crew|Crew|Owner|shipboard-sa|the automation developer||your-pi-hostname|the boat|"
    r"Unladen\s+Swallow|Sea\s+Passion|Beneteau|Seabrook|Gulf\s+Solutions|Sailing\s+Services|"
    r"Coastal\s+Climate|Captain'?s\s+Locker|Grenada|Carriacou|lee-lenova|WDQ3767|"
    r"boat-auto||owner)\b"
    r"|D:\\\\?Documents|192\.168\.50\.",
    re.IGNORECASE,
)
# "Crew" is also a person's name - a hit is only let through when cooking words sit right
# next to it (the dessert in the recipe book). Anything else still fails the gate.
_FOOD_NEAR = re.compile(
    r"mix|chocolate|fudge|bak|cockaigne|square|pan|batter|dessert|confection|cocoa|oven|recipe|trifle",
    re.IGNORECASE,
)


def _real_hits(text: str) -> list[re.Match[str]]:
    out = []
    for m in BANNED.finditer(text):
        if m.group(0).lower().startswith("brownie") and _FOOD_NEAR.search(
                text[max(0, m.start() - 80):m.end() + 80]):
            continue
        out.append(m)
    return out


TEXT_SUFFIXES = {".md", ".txt", ".bat", ".cmd", ".json", ".html", ".css", ".toml", ".cfg", ".ini"}
SKIP_DIRS = {"node_modules", ".venv", "__pycache__", ".git"}


def _python_hits(path: Path) -> list[tuple[int, str]]:
    hits: list[tuple[int, str]] = []
    src = path.read_text(encoding="utf-8")
    prev_significant = tokenize.NEWLINE
    for tok in tokenize.generate_tokens(io.StringIO(src).readline):
        if tok.type == tokenize.STRING:
            # A string that starts a logical line on its own is a docstring / bare note.
            is_doc = prev_significant in (tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT)
            if not is_doc and _real_hits(tok.string):
                hits.append((tok.start[0], tok.string.strip()[:120]))
        if tok.type not in (tokenize.COMMENT, tokenize.NL):
            prev_significant = tok.type
    return hits


def _text_hits(path: Path) -> list[tuple[int, str]]:
    out = []
    for n, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        if _real_hits(line):
            out.append((n, line.strip()[:120]))
    return out


def scan(root: Path) -> list[str]:
    problems: list[str] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or SKIP_DIRS.intersection(path.relative_to(root).parts):
            continue
        rel = path.relative_to(root)
        if path.suffix == ".py":
            hits = _python_hits(path)
        elif path.suffix == ".js" and "dist" in rel.parts:
            text = path.read_text(encoding="utf-8", errors="replace")
            hits = [(0, text[max(0, m.start() - 50):m.end() + 30]) for m in _real_hits(text)]
        elif path.suffix in TEXT_SUFFIXES:
            hits = _text_hits(path)
        else:
            continue
        problems.extend(f"{rel}:{line}: {snippet}" for line, snippet in hits)
    # Files that must never ship at all.
    for bad in ("pi-ssh-key", "pi-ssh-key.pub", "vessel_local.db", "name_decal.jpg"):
        problems.extend(f"{p.relative_to(root)}: forbidden file" for p in root.rglob(bad))
    return problems


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    found = scan(target)
    for line in found:
        print(line)
    print(f"privacy scan: {len(found)} problem(s) in {target}")
    sys.exit(1 if found else 0)
