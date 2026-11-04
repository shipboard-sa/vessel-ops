"""
Purpose: Schema v37 - the logbook tables (option C, design/LOGBOOK_DESIGN.md): logbook_entries,
    logbook_status_updates, logbook_stamps, their indexes and the append-only triggers.
Version: v1 (2026-10-05)
Scope: PRODUCTION - mx-inv migration step (the first one through the migrations/ runner).
Architecture: Runs the same DDL a fresh install gets (db_schema._DDL_LOGBOOK), so the two can never drift. Purely
    additive: new tables only, nothing existing is touched.
Invocation: registered in migrations.STEPS[37]; run by db_schema.ensure_current() at server start or
    `python -m migrations --apply`.
"""
from __future__ import annotations

import sqlite3


def migrate(conn: sqlite3.Connection) -> None:
    import db_schema
    for statement in db_schema._DDL_LOGBOOK:
        conn.execute(statement)
