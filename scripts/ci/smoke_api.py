"""
Purpose: CI smoke test for the mx-inv server - fresh DB, fictional example boat, then the
    main API routes must answer with REAL bodies (not the SPA catch-all's index.html).
Version: v1 (2026-09-24)
Scope: STANDALONE UTILITY - run by .github/workflows/ci.yml; never touches vessel_local.db.
Architecture: mx-inv CI. Points VESSEL_DB_PATH at a temp file BEFORE importing anything
    that imports data.py (so it can never hit the live DB), loads example_data.py (SV
    Example, in a child process), then drives backend.main:app through FastAPI's TestClient. Also checks the
    connection pragmas the Docker spec relies on (WAL, synchronous = FULL).
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TMP = Path(tempfile.mkdtemp(prefix="mxinv-ci-"))
os.environ["VESSEL_DB_PATH"] = str(TMP / "vessel_local.db")
sys.path.insert(0, str(ROOT))

import subprocess  # noqa: E402

# example_data.py parses its own argv at import, so it runs as a child process.
subprocess.run([sys.executable, str(ROOT / "example_data.py"), "--db", os.environ["VESSEL_DB_PATH"]],
               check=True, cwd=ROOT)

from fastapi.testclient import TestClient  # noqa: E402

import backend.main as main  # noqa: E402
import data  # noqa: E402

assert Path(data.DB_PATH) == TMP / "vessel_local.db", f"refusing: DB_PATH is {data.DB_PATH}"

with data.connect() as conn:
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal", "journal_mode is not WAL"
    assert conn.execute("PRAGMA synchronous").fetchone()[0] == 2, "synchronous is not FULL (2)"

client = TestClient(main.app)
failures = []
for path, want in [
    ("/api/health", "status"),
    ("/api/schedule", None),
    ("/api/items", None),
    ("/api/projects", None),
    ("/api/recipes", None),
    ("/api/settings", None),
]:
    r = client.get(path)
    ctype = r.headers.get("content-type", "")
    if r.status_code != 200 or "application/json" not in ctype:
        failures.append(f"{path}: {r.status_code} {ctype}")
    elif want and want not in r.json():
        failures.append(f"{path}: body lacks {want!r}")
    else:
        print(f"ok  {path}")

if failures:
    print("FAILED:\n  " + "\n  ".join(failures))
    sys.exit(1)
print("smoke: all routes answered with JSON")
