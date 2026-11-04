"""
Purpose: Schema v38 - passages in the logbook (the owner 2026-10-05, option B: each leg is a passage): the entry kinds
    'departure' and 'arrival' and the logbook_passage_ends table (the port of each end).
Version: v1 (2026-10-05)
Scope: PRODUCTION - mx-inv migration step.
Architecture: SQLite cannot alter a CHECK constraint, so logbook_entries is REBUILT in this step's transaction:
    the append-only triggers are dropped (so the copy-and-drop cannot trip them), a new table is created from
    db_schema._DDL_LOGBOOK, every row is copied with its entry_id, the old table is dropped and the new one renamed,
    the AUTOINCREMENT sequence is carried over, and the indexes / triggers / passage_ends table are recreated from
    the same DDL a fresh install gets. Child tables (status updates, stamps) keep pointing at logbook_entries by
    name. migrate.fk_off = True: the runner switches foreign keys OFF for this step (SQLite's documented rebuild
    procedure - a DROP of the parent would otherwise leave the deferred-violation counter non-zero even after the
    rename re-links the children) and its foreign_key_check proves every link before COMMIT.
Invocation: registered in migrations.STEPS[38]; run by db_schema.ensure_current() at server start or
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
    conn.execute(entries_ddl.replace("CREATE TABLE IF NOT EXISTS logbook_entries", "CREATE TABLE logbook_entries_v38"))
    cols = [r[1] for r in conn.execute("PRAGMA table_info(logbook_entries)")]
    col_list = ", ".join(cols)
    conn.execute(f"INSERT INTO logbook_entries_v38 ({col_list}) SELECT {col_list} FROM logbook_entries")  # noqa: S608
    conn.execute("DROP TABLE logbook_entries")
    conn.execute("ALTER TABLE logbook_entries_v38 RENAME TO logbook_entries")
    if seq is not None:
        conn.execute("UPDATE sqlite_sequence SET seq = max(seq, ?) WHERE name = 'logbook_entries'", (seq[0],))
    for statement in db_schema._DDL_LOGBOOK:                 # indexes, triggers, passage_ends (IF NOT EXISTS)
        conn.execute(statement)
    after = conn.execute("SELECT count(*), coalesce(max(entry_id), 0) FROM logbook_entries").fetchone()
    if tuple(after) != tuple(before):
        raise RuntimeError(f"v38 rebuild changed the logbook: {tuple(before)} -> {tuple(after)}")


migrate.fk_off = True   # type: ignore[attr-defined]
