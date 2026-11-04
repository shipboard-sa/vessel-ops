"""
Purpose: Local-only "golden" regression check - snapshot what the main read endpoints return
    for a copy of the live database, then diff a later snapshot against it (proves a refactor
    changed no behaviour on REAL data).
Version: v1 (2026-09-24)
Scope: STANDALONE UTILITY - hardening plan phase 1 (design/ARCH_HARDENING_PLAN.md). Never in
    CI and never committed output: the snapshots are the owner's private boat data (var/ is ignored).
Architecture: Copies vessel_local.db with SQLite's backup API (read-only on the source, safe
    while the live server runs) into var/golden/, points VESSEL_DB_PATH at the COPY before
    importing anything, drives backend.main:app through TestClient, and writes one JSON file.
    Volatile fields (timestamps of the run itself) are dropped before saving.

Usage (from <your-project-dir>, with the venv):
    python scripts/golden_check.py save  before        # before a refactor
    python scripts/golden_check.py save  after         # after it (same day: dates are relative)
    python scripts/golden_check.py diff  before after  # prints differences, exit 1 if any
"""
from __future__ import annotations

import datetime
import json
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "var" / "golden"
LIVE = ROOT / "vessel_local.db"

ENDPOINTS = [
    # every route that reads a pandas DataFrame today (phase 3 rewrites these)
    "/api/tasks", "/api/items", "/api/items/below-minimum", "/api/items/food-expiring?days=60",
    "/api/items/stock-expiring?days=365", "/api/items/stock/movements?limit=100000",
    "/api/storage/locations", "/api/storage/containers", "/api/audits",
    "/api/provisioning/shopping-list", "/api/provisioning/plan", "/api/provisioning/food-cart",
    # the rest of the main screens
    "/api/schedule", "/api/projects", "/api/recipes", "/api/settings", "/api/tasks/systems",
    "/api/tasks/checklists", "/api/tasks/completions?days=0&limit=100000",
    "/api/tasks/completions/facets", "/api/storage/compartments", "/api/storage/containers/options",
    "/api/documents", "/api/units", "/api/meal-plan", "/api/meal-plan/shopping-list",
    "/api/items/fit-review", "/api/items/on-list",
]
VOLATILE = {"generated_at"}


def _strip(obj):
    if isinstance(obj, dict):
        return {k: _strip(v) for k, v in obj.items() if k not in VOLATILE}
    if isinstance(obj, list):
        return [_strip(v) for v in obj]
    return obj


def save(label: str) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    copy = OUT / f"{label}.db"
    src = sqlite3.connect(f"file:{LIVE}?mode=ro", uri=True)
    dst = sqlite3.connect(copy)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    os.environ["VESSEL_DB_PATH"] = str(copy)
    for var in ("MXINV_INFLUX_URL", "MXINV_ROUTING_URL", "VESSEL_LOG_ENABLED", "SAIL_CONFIG_ENABLED"):
        os.environ.pop(var, None)
    sys.path.insert(0, str(ROOT))
    import data  # noqa: E402
    assert Path(data.DB_PATH).resolve() == copy.resolve(), f"refusing: DB_PATH is {data.DB_PATH}"
    from fastapi.testclient import TestClient  # noqa: E402
    import backend.main as main  # noqa: E402

    client = TestClient(main.app)
    result: dict[str, object] = {"_taken": datetime.date.today().isoformat()}
    for path in ENDPOINTS:
        r = client.get(path)
        ok = r.status_code == 200 and r.headers.get("content-type", "").startswith("application/json")
        result[path] = _strip(r.json()) if ok else {"_error": r.status_code}
    out = OUT / f"{label}.json"
    out.write_text(json.dumps(result, indent=1, sort_keys=True, default=str), encoding="utf-8")
    copy.unlink()
    print(f"saved {out} ({len(ENDPOINTS)} endpoints)")
    return out


def diff(a: str, b: str) -> int:
    left = json.loads((OUT / f"{a}.json").read_text(encoding="utf-8"))
    right = json.loads((OUT / f"{b}.json").read_text(encoding="utf-8"))
    if left.get("_taken") != right.get("_taken"):
        print("WARNING: taken on different days - relative dates will differ")
    bad = 0
    for path in ENDPOINTS:
        if left.get(path) != right.get(path):
            bad += 1
            print(f"DIFFERS  {path}")
        else:
            print(f"same     {path}")
    print("no differences" if not bad else f"{bad} endpoint(s) differ")
    return 1 if bad else 0


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "save":
        save(sys.argv[2])
    elif len(sys.argv) == 4 and sys.argv[1] == "diff":
        sys.exit(diff(sys.argv[2], sys.argv[3]))
    else:
        print(__doc__)
        sys.exit(2)
