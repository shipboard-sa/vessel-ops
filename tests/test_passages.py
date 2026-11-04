"""
Purpose: Tests for passages (schema v38, the owner 2026-10-05: each leg is a passage): the v37 -> v38 table rebuild keeps
    every logbook row / id / sequence / child link and the append-only triggers; departure / arrival in order
    (409 otherwise); passages derived with duration, logged distance and counts; the port pick list; the printable
    passage.
Version: v2 (2026-10-05) - v2: the migration test runs v37 -> v38 -> v39. v1 (2026-10-05)
Scope: PRODUCTION - mx-inv test suite.
Architecture: conftest's example_client (a fresh v38 database); the boat stack faked by patching
    backend.log_stamp.stamp. The migration test builds a minimal v37-shaped database by hand and runs the real
    migrations runner on it.
Invocation: .venv/Scripts/python -m pytest tests/test_passages.py
"""
from __future__ import annotations

import re
import sqlite3

import pytest

import data
import db_schema
import migrations
from backend import log_stamp

POS = iter([])


@pytest.fixture
def boat(monkeypatch):
    fixes = [(30.0, -90.0), (30.0, -89.5), (30.2, -88.9), (30.4, -87.2)]   # NOLA-ish -> Pensacola-ish
    state = {"i": 0}

    def stamp(minutes_ago=0, with_card=False):
        lat, lon = fixes[min(state["i"], len(fixes) - 1)]
        state["i"] += 1
        return {"lat": lat, "lon": lon, "sog_kn": 6.0, "mode": "SAIL"}
    monkeypatch.setattr(log_stamp, "stamp", stamp)


# ---------------------------------------------------------------------------------------------- migration v37->v38

def _v37_db(path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE system_config (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO system_config VALUES ('schema_version', '37');
        CREATE TABLE systems (name TEXT PRIMARY KEY);
        INSERT INTO systems VALUES ('Bilge');
        CREATE TABLE tasks (task_id INTEGER PRIMARY KEY);
    """)
    for stmt in db_schema._DDL_LOGBOOK:
        if "logbook_passage_ends" in stmt or "logbook_watch_turns" in stmt:
            continue                                         # v38 / v39 tables - not there in v37
        stmt = re.sub(r",\s*'departure','arrival'(,'sail','engine')?\)", ")", stmt)       # back to v37's kinds
        stmt = re.sub(r"\n\s*wind_apparent_deg REAL,[^\n]*", "", stmt)                    # v39's stamp column
        conn.execute(stmt)
    sql = conn.execute("SELECT sql FROM sqlite_master WHERE name = 'logbook_entries'").fetchone()[0]
    assert "departure" not in sql                             # really the v37 shape
    conn.executescript("""
        INSERT INTO logbook_entries (entry_id, kind, occurred_at, recorded_at, system_name, title, source)
            VALUES (1, 'failure', '2026-10-04T09:00', '2026-10-04T09:00', 'Bilge', 'Float stuck', 'cockpit'),
                   (2, 'observation', '2026-10-04T10:00', '2026-10-04T10:00', NULL, 'Chafe', 'cockpit'),
                   (5, 'event', '2026-10-04T10:00:30', '2026-10-04T10:00', NULL, 'P1 water', 'engine');
        INSERT INTO logbook_status_updates (entry_id, at, status, after_entry_id) VALUES (1, '2026-10-04T09:00', 'broke', 1),
                                                                                         (1, '2026-10-04T11:00', 'fixed', 5);
        INSERT INTO logbook_stamps (entry_id, lat, lon) VALUES (1, 30.0, -90.0), (5, 30.1, -90.1);
    """)
    conn.commit()
    return conn


def test_v38_rebuild_keeps_everything(tmp_path):
    db = tmp_path / "v37.db"
    _v37_db(db).close()
    seq_before = sqlite3.connect(db).execute("SELECT seq FROM sqlite_sequence WHERE name='logbook_entries'").fetchone()
    assert migrations.run(str(db), apply=True, log=lambda m: None) == [38, 39]
    c = sqlite3.connect(db)
    c.execute("PRAGMA foreign_keys = ON")
    assert c.execute("SELECT value FROM system_config WHERE key='schema_version'").fetchone()[0] == "39"
    assert "wind_apparent_deg" in {r[1] for r in c.execute("PRAGMA table_info(logbook_stamps)")}
    assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert c.execute("PRAGMA foreign_key_check").fetchall() == []
    assert [r[0] for r in c.execute("SELECT entry_id FROM logbook_entries ORDER BY 1")] == [1, 2, 5]
    assert c.execute("SELECT count(*) FROM logbook_status_updates").fetchone()[0] == 2
    assert c.execute("SELECT count(*) FROM logbook_stamps").fetchone()[0] == 2
    assert c.execute("SELECT seq FROM sqlite_sequence WHERE name='logbook_entries'").fetchone() == seq_before
    assert c.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    # the new kinds go in; the append-only rules still hold on the rebuilt table
    c.execute("INSERT INTO logbook_entries (kind, occurred_at, recorded_at, title, source) "
              "VALUES ('departure', '2026-10-05T07:00', '2026-10-05T07:00', 'Departed NOLA', 'cockpit')")
    with pytest.raises(sqlite3.IntegrityError):
        c.execute("DELETE FROM logbook_entries WHERE entry_id = 2")
    with pytest.raises(sqlite3.IntegrityError):
        c.execute("UPDATE logbook_entries SET title = 'x' WHERE entry_id = 2")
    with pytest.raises(sqlite3.IntegrityError):
        c.execute("INSERT INTO logbook_stamps (entry_id) VALUES (999)")       # foreign keys are back on
    assert {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'ix_logbook%'")} \
        >= {"ix_logbook_occurred", "ix_logbook_kind"}


# ---------------------------------------------------------------------------------------------- departure / arrival

def test_order_is_enforced(example_client, boat):
    assert example_client.post("/api/logbook/arrival", json={"port": "Pensacola"}).status_code == 409
    assert example_client.post("/api/logbook/departure", json={"port": "New Orleans"}).status_code == 400  # bound for?
    d = example_client.post("/api/logbook/departure", json={"port": " New  Orleans ", "bound_for": "Pensacola",
                                                           "source": "cockpit", "minutes_ago": 120})
    assert d.status_code == 200, d.text
    assert d.json()["title"] == "Departed New Orleans, bound for Pensacola" and d.json()["port"] == "New Orleans"
    again = example_client.post("/api/logbook/departure", json={"port": "New Orleans", "bound_for": "Mobile"})
    assert again.status_code == 409 and "still under way from New Orleans" in again.json()["detail"]
    cur = example_client.get("/api/logbook/passages/current").json()["passage"]
    assert cur["from_port"] == "New Orleans" and cur["underway"] and cur["bound_for"] == "Pensacola"
    a = example_client.post("/api/logbook/arrival", json={"port": "Pensacola", "bound_for": "ignored"})
    assert a.status_code == 200 and a.json()["title"] == "Arrived Pensacola from New Orleans"
    assert a.json()["bound_for"] is None
    assert example_client.get("/api/logbook/passages/current").json()["passage"] is None
    # a departure back-dated to before the last arrival is refused
    early = example_client.post("/api/logbook/departure", json={"port": "Pensacola", "bound_for": "Tampa",
                                                               "minutes_ago": 600})
    assert early.status_code == 409 and "before the last arrival" in early.json()["detail"]


def test_passages_are_derived_with_facts(example_client, boat):
    example_client.post("/api/logbook/departure", json={"port": "New Orleans", "bound_for": "Pensacola",
                                                       "minutes_ago": 300})
    example_client.post("/api/logbook", json={"kind": "failure", "title": "Float stuck", "minutes_ago": 200})
    example_client.post("/api/logbook", json={"kind": "observation", "title": "Chafe", "minutes_ago": 100})
    example_client.post("/api/logbook/arrival", json={"port": "Pensacola"})
    example_client.post("/api/logbook/departure", json={"port": "Pensacola", "bound_for": "Tampa"})
    ps = example_client.get("/api/logbook/passages").json()
    assert [(p["from_port"], p["to_port"], p["underway"]) for p in ps] == [("Pensacola", None, True),
                                                                         ("New Orleans", "Pensacola", False)]
    leg1 = ps[1]
    assert leg1["failures"] == 1 and leg1["observations"] == 1 and leg1["hours"] == 5.0
    assert leg1["fixes"] == 4 and leg1["distance_nm"] and 140 < leg1["distance_nm"] < 200   # ~2.8 deg of longitude
    assert example_client.get("/api/logbook/ports").json()[:3] == ["Tampa", "Pensacola", "New Orleans"]
    # the generic crew-entry route cannot write passage ends
    assert example_client.post("/api/logbook", json={"kind": "departure", "title": "x"}).status_code == 400


def test_printable_passage(example_client, boat):
    d = example_client.post("/api/logbook/departure", json={"port": "New Orleans", "bound_for": "Pensacola",
                                                           "minutes_ago": 90}).json()
    example_client.post("/api/logbook", json={"kind": "incident", "title": "Lost steerage", "minutes_ago": 30})
    example_client.post("/api/logbook/arrival", json={"port": "Pensacola"})
    example_client.post("/api/logbook", json={"kind": "observation", "title": "After arrival"})   # outside
    page = example_client.get(f"/api/report/logbook?passage={d['entry_id']}")
    assert page.status_code == 200
    t = page.text
    assert "Passage New Orleans → Pensacola" in t and "Lost steerage" in t and "Arrived Pensacola" in t
    assert "Departed New Orleans, bound for Pensacola" in t and "1 h 30 min" in t
    assert "After arrival" not in t
    assert example_client.get("/api/report/logbook?passage=99999").status_code == 404
    assert example_client.get("/api/report/logbook").status_code == 400
