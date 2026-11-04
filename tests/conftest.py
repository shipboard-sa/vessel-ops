"""
Purpose: pytest harness for mx-inv - gives every test its own throwaway SQLite database
    (fresh schema, or the fictional SV Example boat) and a FastAPI TestClient over it.
Version: v1 (2026-09-24)
Scope: PRODUCTION - test tooling for the live mx-inv app (hardening plan phase 1,
    design/ARCH_HARDENING_PLAN.md); run by CI's api job. Never touches vessel_local.db.
Architecture: VESSEL_DB_PATH is pointed at a temp file HERE, at conftest import - before any
    test module imports data.py / db_schema.py / backend.main - and the harness refuses to go
    on if data.DB_PATH could be the live file. Two template databases are built once per
    session (empty schema; example_data.py in a child process); each test gets a backup-API
    copy and data.DB_PATH / db_schema.DB_PATH are monkeypatched to it (data.connect() reads
    the module global on every call, so the whole app follows).
"""
from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
_SESSION_DIR = Path(tempfile.mkdtemp(prefix="mxinv-pytest-"))
os.environ["VESSEL_DB_PATH"] = str(_SESSION_DIR / "import-time.db")
# Integrations stay off in tests whatever the shell has set: no Influx pull, no /routing
# proxy, no webhooks.
for _var in ("MXINV_INFLUX_URL", "MXINV_ROUTING_URL", "VESSEL_LOG_ENABLED", "SAIL_CONFIG_ENABLED"):
    os.environ.pop(_var, None)
sys.path.insert(0, str(ROOT))

import db_schema  # noqa: E402
import data  # noqa: E402

_LIVE = (ROOT / "vessel_local.db").resolve()
assert Path(data.DB_PATH).resolve() != _LIVE, "refusing to test: data.DB_PATH is the live database"
assert Path(data.DB_PATH).resolve().parent == _SESSION_DIR.resolve(), f"unexpected DB_PATH {data.DB_PATH}"


def _copy_db(src: Path, dst: Path) -> None:
    """Copy with SQLite's backup API (safe for a WAL-mode source)."""
    s, d = sqlite3.connect(src), sqlite3.connect(dst)
    try:
        s.backup(d)
    finally:
        d.close()
        s.close()


@pytest.fixture(scope="session")
def _empty_template() -> Path:
    path = _SESSION_DIR / "template-empty.db"
    saved = (data.DB_PATH, db_schema.DB_PATH)
    data.DB_PATH = db_schema.DB_PATH = str(path)
    try:
        assert db_schema.ensure_initialised(), "fresh template was not initialised"
    finally:
        data.DB_PATH, db_schema.DB_PATH = saved
    return path


@pytest.fixture(scope="session")
def _example_template() -> Path:
    path = _SESSION_DIR / "template-example.db"
    # example_data.py parses argv and sets VESSEL_DB_PATH itself; it runs as a child.
    subprocess.run([sys.executable, str(ROOT / "example_data.py"), "--db", str(path)],
                   check=True, cwd=ROOT, capture_output=True)
    return path


def _point_at(monkeypatch: pytest.MonkeyPatch, path: Path) -> Path:
    monkeypatch.setattr(data, "DB_PATH", str(path))
    monkeypatch.setattr(db_schema, "DB_PATH", str(path))
    return path


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, _empty_template: Path) -> Path:
    """A fresh, empty database (schema only, generic compartments) for this test."""
    path = tmp_path / "vessel.db"
    _copy_db(_empty_template, path)
    return _point_at(monkeypatch, path)


@pytest.fixture
def example_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, _example_template: Path) -> Path:
    """A database holding the fictional SV Example boat, for this test."""
    path = tmp_path / "vessel.db"
    _copy_db(_example_template, path)
    return _point_at(monkeypatch, path)


@pytest.fixture(scope="session")
def _app():
    import backend.main as main
    return main.app


@pytest.fixture
def client(db: Path, _app):
    from fastapi.testclient import TestClient
    return TestClient(_app)


@pytest.fixture
def example_client(example_db: Path, _app):
    from fastapi.testclient import TestClient
    return TestClient(_app)
