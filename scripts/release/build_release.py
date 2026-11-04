"""
Purpose: Assemble the Vessel Ops Panel release package (a clean folder + zip) from an
    allowlist of this repo's files, then run the privacy gate on the result.
Version: v3 (2026-10-07) - v3: ships migrations/ (db_schema imports the runner at start since v37 - a zip without it
    would not start). v2 (2026-09-24) - v2: macOS launchers (.command) kept LF and zipped executable. v1 (2026-09-24)
Scope: STANDALONE UTILITY - release tooling; not shipped, not imported by the app.
Architecture: Copies ONLY the runtime app (backend/, data.py, db_schema.py,
    telemetry_sync.py, frontend source) plus example_data.py, load_starter_pack.py,
    docs/USER_GUIDE.md, docs/dev/ and everything under release_files/ (README, launchers,
    CLAUDE.md, INTEGRATIONS.md, starter packs, the generic research instructions) into
    <out>/vessel-ops-panel-<version>/. Never copies databases, backups, wiki/, history/,
    design/, references/ (except the generic research doc), scripts/, the legacy Streamlit
    UI, keys or logs. Then: builds frontend/dist inside the package (unless --no-build) so the
    privacy scan sees exactly what users will see, runs scripts/release/privacy_scan.py, and
    zips the folder (without node_modules / dist). A privacy hit fails the build: no zip.

Usage (from the repo root):
    python scripts/release/build_release.py --version 0.1.0 [--out DIR] [--no-build]
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import privacy_scan  # noqa: E402

# (source relative to REPO, destination relative to the package root)
ALLOW_FILES: list[tuple[str, str]] = [
    ("data.py", "data.py"),
    ("db_schema.py", "db_schema.py"),
    ("telemetry_sync.py", "telemetry_sync.py"),
    ("example_data.py", "example_data.py"),
    ("load_starter_pack.py", "load_starter_pack.py"),
    ("docs/USER_GUIDE.md", "docs/USER_GUIDE.md"),
    ("frontend/index.html", "frontend/index.html"),
    ("frontend/package.json", "frontend/package.json"),
    ("frontend/package-lock.json", "frontend/package-lock.json"),
    ("frontend/tsconfig.json", "frontend/tsconfig.json"),
    ("frontend/tsconfig.app.json", "frontend/tsconfig.app.json"),
    ("frontend/tsconfig.node.json", "frontend/tsconfig.node.json"),
    ("frontend/vite.config.ts", "frontend/vite.config.ts"),
    ("frontend/eslint.config.js", "frontend/eslint.config.js"),
]
ALLOW_DIRS: list[tuple[str, str]] = [
    ("backend", "backend"),
    ("migrations", "migrations"),
    ("frontend/src", "frontend/src"),
    ("frontend/public", "frontend/public"),
    ("docs/dev", "docs/dev"),
    ("release_files", "."),
]
# Never copied even from inside an allowed directory.
EXCLUDE_NAMES = {"__pycache__", "node_modules", "dist", "name_decal.jpg", "REVIEW.md"}
EXCLUDE_SUFFIXES = {".pyc", ".db", ".log"}
CRLF_SUFFIXES = {".bat", ".cmd"}  # cmd.exe misreads labels/goto in LF-only batch files
LF_SUFFIXES = {".command", ".sh"}  # macOS/Linux shell scripts: a stray CR breaks bash
EXEC_SUFFIXES = {".command", ".sh"}  # zipped with the Unix executable bit


def _copy_file(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.suffix.lower() in CRLF_SUFFIXES:
        text = src.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
        dst.write_bytes(text)
    elif src.suffix.lower() in LF_SUFFIXES:
        dst.write_bytes(src.read_bytes().replace(b"\r\n", b"\n"))
    else:
        shutil.copy2(src, dst)


def _copy_tree(src: Path, dst: Path) -> None:
    for path in sorted(src.rglob("*")):
        rel = path.relative_to(src)
        if EXCLUDE_NAMES.intersection(rel.parts) or path.suffix in EXCLUDE_SUFFIXES:
            continue
        if path.is_file():
            _copy_file(path, dst / rel)


def assemble(pkg: Path) -> None:
    if pkg.exists():
        shutil.rmtree(pkg)
    pkg.mkdir(parents=True)
    for src, dst in ALLOW_FILES:
        s = REPO / src
        if s.is_file():
            _copy_file(s, pkg / dst)
        else:
            print(f"  (skip, not present: {src})")
    for src, dst in ALLOW_DIRS:
        s = REPO / src
        if s.is_dir():
            _copy_tree(s, pkg / dst)
        else:
            print(f"  (skip, not present: {src}/)")


def build_frontend(pkg: Path) -> None:
    """Build dist inside the package so the privacy scan sees the real bundle. Reuses the
    repo's node_modules through a directory junction (removed afterwards) - no network."""
    fe = pkg / "frontend"
    nm = fe / "node_modules"
    src_nm = (REPO / "frontend" / "node_modules").resolve()
    subprocess.run(["cmd", "/c", "mklink", "/J", str(nm), str(src_nm)], check=True,
                   stdout=subprocess.DEVNULL)
    try:
        env = dict(os.environ, PATH=r"C:\Program Files\nodejs;" + os.environ.get("PATH", ""))
        subprocess.run("npm run build", cwd=fe, shell=True, check=True, env=env)
    finally:
        os.rmdir(nm)  # removes the junction only, never the target


def make_zip(pkg: Path) -> Path:
    zpath = pkg.parent / f"{pkg.name}.zip"  # not with_suffix: the version has dots
    if zpath.exists():
        zpath.unlink()
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(pkg.rglob("*")):
            rel = path.relative_to(pkg)
            if {"node_modules", "dist"}.intersection(rel.parts) or not path.is_file():
                continue
            # Unix permissions in the entry so macOS Archive Utility / unzip restore them
            # (a .command without +x will not open on double-click).
            info = zipfile.ZipInfo.from_file(path, str(Path(pkg.name) / rel))
            info.create_system = 3
            mode = 0o755 if path.suffix.lower() in EXEC_SUFFIXES else 0o644
            info.external_attr = (0o100000 | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, path.read_bytes())
    return zpath


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1].strip())
    ap.add_argument("--version", required=True)
    ap.add_argument("--out", default=str(REPO.parent / "mx-inv-release-out"))
    ap.add_argument("--no-build", action="store_true", help="skip the frontend build (scan source only)")
    args = ap.parse_args()

    pkg = Path(args.out).resolve() / f"vessel-ops-panel-{args.version}"
    print(f"Assembling {pkg}")
    assemble(pkg)
    if not args.no_build:
        print("Building the frontend inside the package (for the privacy scan)...")
        build_frontend(pkg)
    problems = privacy_scan.scan(pkg)
    for p in problems:
        print("  PRIVACY:", p)
    if problems:
        print(f"FAILED: {len(problems)} privacy problem(s) - no zip written.")
        return 1
    zpath = make_zip(pkg)
    n = sum(1 for p in pkg.rglob("*") if p.is_file() and not {"node_modules", "dist"}.intersection(p.relative_to(pkg).parts))
    print(f"OK: privacy scan clean; {n} files; zip = {zpath} ({zpath.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
