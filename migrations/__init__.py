"""
Purpose: mx-inv's schema migration runner (hardening plan phase 2) - brings a database from its stored
    schema_version up to the code's db_schema.SCHEMA_VERSION, one step per version, each in its own transaction,
    after a VERIFIED backup. Refuses a database NEWER than the code (protects a rollback).
Version: v4 (2026-10-05) - v4: v39 (Ship's Log review) registered. v3 (2026-10-05) - v3: v38 passages registered; a step can declare fk_off (a table rebuild: foreign keys off for that step, proven by foreign_key_check before COMMIT). v2 (2026-10-05) - v2: v37 logbook registered. v1 (2026-10-05)
Scope: PRODUCTION - mx-inv data layer.
Architecture: Baseline = v36 (live and every v0.1.x install). The v7-v36 scripts stay in scripts/oneoff/ as history.
    Each later version is a module `vNNN_<name>.py` in this package exposing `migrate(conn)`, registered in STEPS.
    Called at server start by db_schema.ensure_current() (backend/main.py), by the release setup and by the Pi
    image; `python -m migrations` is the manual dry run / apply. A fresh database is still created at the current
    version by db_schema (create_schema), never migrated.
Invocation: imported by db_schema.ensure_current(); CLI: `python -m migrations [--apply] [--db PATH]`
    (dry run on an in-memory copy is the default).
"""
from __future__ import annotations

import sqlite3
import time
from pathlib import Path
from typing import Callable

BASELINE = 36

from . import v037_logbook, v038_passages, v039_review  # noqa: E402

# version -> migrate(conn), one module per version.
STEPS: dict[int, Callable[[sqlite3.Connection], None]] = {
    37: v037_logbook.migrate,           # the logbook (option C)
    38: v038_passages.migrate,          # passages: departure / arrival entries (option B)
    39: v039_review.migrate,            # Ship's Log review: sail / engine kinds, wind angle, watch turns
}


class SchemaTooNew(RuntimeError):
    """The database was migrated by NEWER code - running older code on it could corrupt it."""


def target_version() -> int:
    return max(STEPS, default=BASELINE)


def db_version(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT value FROM system_config WHERE key = 'schema_version'").fetchone()
    return int(row[0]) if row else 0


def _counts(conn: sqlite3.Connection) -> dict[str, int]:
    names = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    return {n: conn.execute(f'SELECT count(*) FROM "{n}"').fetchone()[0] for n in names}


def verified_backup(db_path: str, label: str) -> Path:
    """Copy with SQLite's backup API, then prove the copy: integrity_check ok and every table's row count equal."""
    src = sqlite3.connect(db_path)
    dest_path = Path(f"{db_path}.bak-{label}-{time.strftime('%Y%m%d-%H%M%S')}")
    dst = sqlite3.connect(dest_path)
    try:
        src.backup(dst)
        if dst.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError(f"backup {dest_path} failed its integrity check")
        if _counts(src) != _counts(dst):
            raise RuntimeError(f"backup {dest_path} row counts differ from the live database")
    finally:
        dst.close()
        src.close()
    return dest_path


def _apply(conn: sqlite3.Connection, start: int, log: Callable[[str], None]) -> list[int]:
    done = []
    conn.isolation_level = None                      # explicit transactions: one per step, DDL included
    for v in sorted(k for k in STEPS if k > start):
        # A step that REBUILDS a table (SQLite's documented 12-step procedure) declares fk_off: foreign keys are
        # switched off for it (only possible outside a transaction) and the foreign_key_check below proves the
        # links before COMMIT; they are switched back on after. Every other step runs with them as they were.
        fk_off = getattr(STEPS[v], "fk_off", False)
        fk_was = conn.execute("PRAGMA foreign_keys").fetchone()[0]
        if fk_off:
            conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute("BEGIN IMMEDIATE")
        try:
            STEPS[v](conn)
            conn.execute("UPDATE system_config SET value = ? WHERE key = 'schema_version'", (str(v),))
            bad = conn.execute("PRAGMA foreign_key_check").fetchall()
            if bad:
                raise RuntimeError(f"v{v} leaves {len(bad)} foreign-key violations, e.g. {bad[0]}")
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        finally:
            if fk_off:
                conn.execute(f"PRAGMA foreign_keys = {'ON' if fk_was else 'OFF'}")
        log(f"schema v{v} applied")
        done.append(v)
    return done


def run(db_path: str, apply: bool = True, log: Callable[[str], None] = print) -> list[int]:
    """Migrate db_path to the code's version. apply=False = dry run on an in-memory copy (the file is untouched).
    Returns the versions applied (or that would be)."""
    conn = sqlite3.connect(db_path)
    try:
        have, want = db_version(conn), target_version()
        if have > want:
            raise SchemaTooNew(f"database {db_path} is schema v{have} but this code only knows v{want} - "
                               f"run the newer code, or restore the backup taken before v{have}")
        if have == want:
            return []
        if have < BASELINE:
            raise RuntimeError(f"database is schema v{have}; the runner starts at v{BASELINE} - "
                               f"use the scripts/oneoff migrate_schema_vN.py scripts first")
        if not apply:
            mem = sqlite3.connect(":memory:")
            conn.backup(mem)
            try:
                return _apply(mem, have, log)
            finally:
                mem.close()
    finally:
        conn.close()
    log(f"backup before migrating: {verified_backup(db_path, f'premigrate-v{have}')}")
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        return _apply(conn, have, log)
    finally:
        conn.close()
