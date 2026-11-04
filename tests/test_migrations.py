"""
Purpose: Tests for the migration runner (hardening phase 2) - no-op at the target, a step applied with a verified
    backup and the version bumped, dry run leaves the file untouched, a failing step rolls back, a newer database
    is refused, and the code's SCHEMA_VERSION equals the runner's target.
Version: v1 (2026-10-05)
Scope: PRODUCTION - mx-inv test suite.
Architecture: migrations.run() on throwaway SQLite files in tmp_path; fake steps are patched into STEPS.
Invocation: .venv/Scripts/python -m pytest tests/test_migrations.py
"""
from __future__ import annotations

import sqlite3

import pytest

import db_schema
import migrations


def make_db(path, version=36):
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE system_config (key TEXT PRIMARY KEY, value TEXT)")
    c.execute("INSERT INTO system_config VALUES ('schema_version', ?)", (str(version),))
    c.execute("CREATE TABLE things (id INTEGER PRIMARY KEY, name TEXT)")
    c.executemany("INSERT INTO things(name) VALUES (?)", [("a",), ("b",)])
    c.commit()
    c.close()


def version(path):
    c = sqlite3.connect(path)
    try:
        return migrations.db_version(c)
    finally:
        c.close()


def step_37(conn):
    conn.execute("CREATE TABLE logbook_test (id INTEGER PRIMARY KEY, text TEXT NOT NULL)")


def test_code_and_runner_agree():
    assert db_schema.SCHEMA_VERSION == migrations.target_version()


def test_nothing_to_do(tmp_path):
    db = tmp_path / "v.db"
    make_db(db, version=migrations.target_version())
    assert migrations.run(str(db), log=lambda m: None) == []
    assert not list(tmp_path.glob("*.bak-*"))


def test_step_applied_with_verified_backup(tmp_path, monkeypatch):
    monkeypatch.setattr(migrations, "STEPS", {37: step_37})
    db = tmp_path / "v.db"
    make_db(db)
    assert migrations.run(str(db), log=lambda m: None) == [37]
    assert version(db) == 37
    baks = list(tmp_path.glob("v.db.bak-premigrate-v36-*"))
    assert len(baks) == 1 and version(baks[0]) == 36
    c = sqlite3.connect(db)
    assert c.execute("SELECT count(*) FROM logbook_test").fetchone()[0] == 0
    c.close()


def test_dry_run_leaves_file(tmp_path, monkeypatch):
    monkeypatch.setattr(migrations, "STEPS", {37: step_37})
    db = tmp_path / "v.db"
    make_db(db)
    assert migrations.run(str(db), apply=False, log=lambda m: None) == [37]
    assert version(db) == 36 and not list(tmp_path.glob("*.bak-*"))


def test_failing_step_rolls_back(tmp_path, monkeypatch):
    def bad(conn):
        conn.execute("CREATE TABLE half_done (id INTEGER)")
        raise RuntimeError("boom")
    monkeypatch.setattr(migrations, "STEPS", {37: bad})
    db = tmp_path / "v.db"
    make_db(db)
    with pytest.raises(RuntimeError, match="boom"):
        migrations.run(str(db), log=lambda m: None)
    c = sqlite3.connect(db)
    assert version(db) == 36
    assert c.execute("SELECT count(*) FROM sqlite_master WHERE name = 'half_done'").fetchone()[0] == 0
    c.close()


def test_newer_database_refused(tmp_path):
    db = tmp_path / "v.db"
    make_db(db, version=99)
    with pytest.raises(migrations.SchemaTooNew):
        migrations.run(str(db), log=lambda m: None)
