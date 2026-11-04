"""
Purpose: Tests for the HTTP edges of backend/main.py - health, unmatched /api paths 404 as
    JSON (not the SPA page), static files never served from outside frontend/dist, pragmas.
Version: v1 (2026-09-24)
Scope: PRODUCTION - mx-inv test suite (hardening plan phases 0-1).
Architecture: Drives backend.main:app through TestClient on a per-test database (conftest.py).
    The dist tests skip when frontend/dist is not built (CI's api job).
"""
from __future__ import annotations

from pathlib import Path

import pytest

import data

DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"
needs_dist = pytest.mark.skipif(not (DIST / "index.html").is_file(), reason="frontend/dist not built")


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}


def test_connection_pragmas(db):
    with data.connect() as conn:
        assert conn.execute("PRAGMA synchronous").fetchone()[0] == 2  # FULL
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


@needs_dist
@pytest.mark.parametrize("path", ["/api/nope", "/api/tasks/systems-typo/x/y", "/api"])
def test_unmatched_api_get_is_404_json(client, path):
    r = client.get(path)
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/json")


@needs_dist
def test_spa_fallback_still_serves_the_page(client):
    r = client.get("/cockpit/watch")
    assert r.status_code == 200 and '<div id="root"' in r.text


@needs_dist
@pytest.mark.parametrize("path", ["/..%2Fpackage.json", "/..%2F..%2Fdata.py", "/assets%2F..%2F..%2Fpackage.json"])
def test_no_file_outside_dist_is_served(client, path):
    r = client.get(path)
    assert '"dependencies"' not in r.text and "def connect(" not in r.text
