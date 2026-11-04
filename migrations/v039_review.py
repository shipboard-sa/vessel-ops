"""
Purpose: Schema v39 - the owner's Ship's Log review (2026-10-05): entry kinds 'sail' and 'engine', the apparent wind
    ANGLE and the ENGINE HOURS on each stamp, and logbook_watch_turns (who took the watch).
Version: v1 (2026-10-05)
Scope: PRODUCTION - mx-inv migration step.
Architecture: Same rebuild as v038 (SQLite cannot alter a CHECK): the entries' append-only triggers and indexes are
    dropped, a new table is created from db_schema._DDL_LOGBOOK, every row copied with its id, the old table dropped,
    the new one renamed, the AUTOINCREMENT sequence carried over, and every logbook index / trigger / table recreated
    from the fresh-install DDL. logbook_stamps gains wind_apparent_deg + engine_hours by ALTER TABLE ADD COLUMN (no rebuild). fk_off:
    the runner switches foreign keys off for this step and proves every link with foreign_key_check before COMMIT.
Invocation: registered in migrations.STEPS[39]; run by db_schema.ensure_current() at server start or
    `python -m migrations --apply`.
"""
from __future__ import annotations

import sqlite3

_TRIGGERS = ("trg_logbook_entries_no_update", "trg_logbook_entries_no_delete")
_INDEXES = ("ix_logbook_occurred", "ix_logbook_kind")


def migrate(conn: sqlite3.Connection) -> None:
    import db_schema
    before = conn.execute("SELECT count(*), coalesce(max(entry_id), 0) FROM logbook_entries").fetchone()
    seq = conn.execute("SELECT seq FROM sqlite_sequence WHERE name = 'logbook_entries'").fetchone()
    for t in _TRIGGERS:
        conn.execute(f"DROP TRIGGER IF EXISTS {t}")
    for i in _INDEXES:
        conn.execute(f"DROP INDEX IF EXISTS {i}")
    entries_ddl = next(s for s in db_schema._DDL_LOGBOOK if "CREATE TABLE IF NOT EXISTS logbook_entries" in s)
    conn.execute(entries_ddl.replace("CREATE TABLE IF NOT EXISTS logbook_entries", "CREATE TABLE logbook_entries_v39"))
    cols = ", ".join(r[1] for r in conn.execute("PRAGMA table_info(logbook_entries)"))
    conn.execute(f"INSERT INTO logbook_entries_v39 ({cols}) SELECT {cols} FROM logbook_entries")  # noqa: S608
    conn.execute("DROP TABLE logbook_entries")
    conn.execute("ALTER TABLE logbook_entries_v39 RENAME TO logbook_entries")
    if seq is not None:
        conn.execute("UPDATE sqlite_sequence SET seq = max(seq, ?) WHERE name = 'logbook_entries'", (seq[0],))
    stamp_cols = {r[1] for r in conn.execute("PRAGMA table_info(logbook_stamps)")}
    for col in ("wind_apparent_deg", "engine_hours"):
        if col not in stamp_cols:
            conn.execute(f"ALTER TABLE logbook_stamps ADD COLUMN {col} REAL")
    for statement in db_schema._DDL_LOGBOOK:                 # indexes, triggers, watch_turns (IF NOT EXISTS)
        conn.execute(statement)
    after = conn.execute("SELECT count(*), coalesce(max(entry_id), 0) FROM logbook_entries").fetchone()
    if tuple(after) != tuple(before):
        raise RuntimeError(f"v39 rebuild changed the logbook: {tuple(before)} -> {tuple(after)}")


migrate.fk_off = True   # type: ignore[attr-defined]
