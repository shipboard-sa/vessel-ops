"""
Purpose: Tests for the logbook (schema v37): crew entries with a stamp and a fix task, failure status chain, the
    append-only triggers, the engine's event push (token, 409 on a repeat, simulated kept), "this watch", and the
    watch entry at handover.
Version: v1 (2026-10-05)
Scope: PRODUCTION - mx-inv test suite.
Architecture: conftest's example_client (example data - has systems); the boat stack is faked by patching
    backend.log_stamp.stamp / boat_link so no network is touched.
Invocation: .venv/Scripts/python -m pytest tests/test_logbook.py
"""
from __future__ import annotations

import sqlite3

import pytest

import data
from backend import boat_link, log_stamp

STAMP = {"lat": 30.02266, "lon": -90.03225, "sog_kn": 5.8, "cog_deg": 180, "mode": "SAIL",
         "wind_apparent_kn": 14, "baro_hpa": 1013.0, "sail_set": "Main reef 1 + Genoa full"}


@pytest.fixture
def boat(monkeypatch):
    monkeypatch.setattr(log_stamp, "stamp", lambda minutes_ago=0, with_card=False:
                        dict(STAMP, **({"card": {"sog_kn": 5.8}} if with_card else {})))
    monkeypatch.setenv("MXINV_EVENTS_TOKEN", "evtok")


def a_system():
    with data.connect() as c:
        return c.execute("SELECT name FROM systems WHERE parent_name IS NOT NULL LIMIT 1").fetchone()[0]


def test_failure_entry_stamp_status_and_fix_task(example_client, boat):
    sys_name = a_system()
    r = example_client.post("/api/logbook", json={
        "kind": "failure", "title": "Staysail sheet car jammed", "system": sys_name, "source": "cockpit",
        "minutes_ago": 10, "follow_on": {"task_name": "Free and service the staysail car", "urgency": "urgent"}})
    assert r.status_code == 200, r.text
    e = r.json()
    assert e["entry_ref"] == f"LOG-{e['entry_id']:05d}" and e["kind"] == "failure" and e["status"] == "broke"
    assert e["stamp"]["sail_set"] == "Main reef 1 + Genoa full" and e["stamp"]["lat"] == 30.02266
    assert e["follow_on_task_id"] and e["system"] == sys_name
    with data.connect() as c:
        t = c.execute("SELECT task_name, period FROM tasks WHERE task_id = ?", (e["follow_on_task_id"],)).fetchone()
    assert tuple(t) == ("Free and service the staysail car", "urgent")

    s = example_client.post(f"/api/logbook/{e['entry_id']}/status", json={"status": "parts-ordered", "note": "car"})
    assert s.json()["status"] == "parts-ordered" and len(s.json()["statuses"]) == 2
    assert [x["entry_id"] for x in example_client.get("/api/logbook?open=1").json()] == [e["entry_id"]]
    example_client.post(f"/api/logbook/{e['entry_id']}/status", json={"status": "fixed"})
    assert example_client.get("/api/logbook?open=1").json() == []


def test_bad_inputs(example_client, boat):
    assert example_client.post("/api/logbook", json={"kind": "watch", "title": "x"}).status_code == 400
    assert example_client.post("/api/logbook", json={"kind": "failure", "title": " "}).status_code == 400
    assert example_client.post("/api/logbook", json={"kind": "failure", "title": "x", "system": "Nope"}).status_code == 400
    obs = example_client.post("/api/logbook", json={"kind": "observation", "title": "chafe"}).json()
    assert obs["status"] is None
    assert example_client.post(f"/api/logbook/{obs['entry_id']}/status", json={"status": "fixed"}).status_code == 400
    assert example_client.get("/api/logbook/999999").status_code == 404


def test_append_only(example_client, boat):
    e = example_client.post("/api/logbook", json={"kind": "failure", "title": "x"}).json()
    with data.connect(write=True) as c:
        for sql in ("UPDATE logbook_entries SET title = 'y' WHERE entry_id = ?",
                    "DELETE FROM logbook_entries WHERE entry_id = ?",
                    "UPDATE logbook_status_updates SET status = 'fixed' WHERE entry_id = ?",
                    "DELETE FROM logbook_stamps WHERE entry_id = ?"):
            with pytest.raises(sqlite3.IntegrityError, match="append-only"):
                c.execute(sql, (e["entry_id"],))


EVENT = {"event_id": "6f1c-0001", "source": "your-pi-hostname-rules", "wf_id": "WF-111", "origin": "WF-111-SALON",
         "kind": "alarm", "severity": "P1", "time": "2026-10-05T13:05:00Z",
         "message": "P1 High water - salon, pump NOT running", "simulated": False, "data": None}


def test_engine_push(example_client, boat):
    assert example_client.post("/api/logbook/events", json=EVENT).status_code == 401
    bad = {"Authorization": "Bearer nope"}
    assert example_client.post("/api/logbook/events", json=EVENT, headers=bad).status_code == 401
    h = {"Authorization": "Bearer evtok"}
    r = example_client.post("/api/logbook/events", json=EVENT, headers=h)
    assert r.status_code == 200
    e = example_client.get(f"/api/logbook/{r.json()['entry_id']}").json()
    assert e["kind"] == "event" and e["severity"] == "P1" and e["source"] == "engine" and e["title"].startswith("P1 High")
    assert example_client.post("/api/logbook/events", json=EVENT, headers=h).status_code == 409   # delivered already
    test = dict(EVENT, event_id="6f1c-0002", simulated=True, kind="mode", severity=None, message="mode DOCK")
    t = example_client.post("/api/logbook/events", json=test, headers=h).json()
    got = example_client.get(f"/api/logbook/{t['entry_id']}").json()
    assert got["simulated"] is True and got["severity"] == "info"
    assert example_client.post("/api/logbook/events", json=dict(EVENT, event_id="x", time="soon"),
                               headers=h).status_code == 422


def test_events_token_from_engine_env(example_client, monkeypatch, tmp_path):
    monkeypatch.delenv("MXINV_EVENTS_TOKEN", raising=False)
    f = tmp_path / "engine.env"
    f.write_text("ENGINE_API_TOKEN=a\nMXINV_EVENTS_TOKEN= fromfile \n", encoding="utf-8")
    monkeypatch.setenv("MXINV_ENGINE_TOKEN_FILE", str(f))
    assert boat_link.events_token() == "fromfile"


def test_this_watch_and_watch_entry(example_client, boat):
    h = {"Authorization": "Bearer evtok"}
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    example_client.post("/api/logbook/events", json=dict(EVENT, event_id="w-1", time=now), headers=h)
    example_client.post("/api/logbook", json={"kind": "observation", "title": "Squall line to the west"})
    tw = example_client.get("/api/logbook/this-watch").json()
    assert tw["since_last_watch_entry"] is False and len(tw["entries"]) == 2
    w = example_client.post("/api/logbook/watch", json={"notables": "Ship passed 1 nm astern", "author": "skipper"}).json()
    assert w["author"] == "Skipper" and w["kind"] == "watch" and "Observations: Ship passed" in w["body"] and "P1 High water" in w["body"]
    assert "Squall line" in w["body"] and w["stamp"]["card"] == {"sog_kn": 5.8}
    after = example_client.get("/api/logbook/this-watch").json()
    assert after["since_last_watch_entry"] is True and after["entries"] == []     # same minute is not repeated
    example_client.post("/api/logbook", json={"kind": "observation", "title": "Wind backing", "minutes_ago": 3})
    assert [r["title"] for r in example_client.get("/api/logbook/this-watch").json()["entries"]] == ["Wind backing"]


def test_this_watch_reports_status_changes_not_the_register(example_client, boat):
    old = example_client.post("/api/logbook", json={"kind": "failure", "title": "Watermaker low output"}).json()
    example_client.post(f"/api/logbook/{old['entry_id']}/status", json={"status": "deferred", "note": "after the passage"})
    example_client.post("/api/logbook/watch", json={})                       # handover: the register starts here
    assert example_client.get("/api/logbook/this-watch").json()["status_changes"] == []   # deferred is NOT repeated
    example_client.post(f"/api/logbook/{old['entry_id']}/status", json={"status": "fixed", "note": "membrane"})
    new = example_client.post("/api/logbook", json={"kind": "failure", "title": "Reading light out"}).json()
    tw = example_client.get("/api/logbook/this-watch").json()
    assert [r["entry_id"] for r in tw["entries"]] == [new["entry_id"]]      # its own Broke is not a 'change'
    assert [(c["entry_ref"], c["previous"], c["status"]) for c in tw["status_changes"]] ==         [(old["entry_ref"], "deferred", "fixed")]
    w = example_client.post("/api/logbook/watch", json={}).json()
    assert "Watermaker low output: deferred -> fixed (membrane)" in w["body"] and "Reading light out" in w["body"]


def test_engine_entries_keep_the_second(example_client, boat):
    h = {"Authorization": "Bearer evtok"}
    for i, t in enumerate(["2026-10-05T13:05:07Z", "2026-10-05T13:05:41Z", "2026-10-05T13:05:12Z"]):
        example_client.post("/api/logbook/events", json=dict(EVENT, event_id=f"seq-{i}", time=t,
                                                            message=f"step {i}"), headers=h)
    got = [r for r in example_client.get("/api/logbook?kind=event").json() if r["title"].startswith("step")]
    assert [r["title"] for r in got] == ["step 1", "step 2", "step 0"]          # newest first, by the second
    assert all(len(r["occurred_at"]) == 19 for r in got)                       # YYYY-MM-DDTHH:MM:SS


def test_log_level_engine_entries_skip_the_handover(example_client, boat):
    h = {"Authorization": "Bearer evtok"}
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    example_client.post("/api/logbook/events", json=dict(EVENT, event_id="r-1", time=now, kind="action", severity=None,
                                                        message="SET io.water_heater_enable ON (ASSIST)",
                                                        record="log"), headers=h)
    example_client.post("/api/logbook/events", json=dict(EVENT, event_id="r-2", time=now), headers=h)
    titles = [r["title"] for r in example_client.get("/api/logbook/this-watch").json()["entries"]]
    assert titles == ["P1 High water - salon, pump NOT running"]                  # the heater is not in the handover
    logged = [r["title"] for r in example_client.get("/api/logbook?kind=event").json()]
    assert "SET io.water_heater_enable ON (ASSIST)" in logged                        # ...but it is in the ship's log


# -- the automatic deck log --------------------------------------------------------------------------------------
from datetime import datetime as _dt

from backend import deck_log


def test_due_slots():
    d = lambda h, m: _dt(2026, 10, 5, h, m)          # noqa: E731
    assert deck_log.due_slot(d(14, 0), "SAIL") == d(14, 0)
    assert deck_log.due_slot(d(14, 9), "MOTOR") == d(14, 0)        # within the grace after a restart
    assert deck_log.due_slot(d(14, 10), "SAIL") is None
    assert deck_log.due_slot(d(14, 0), "ANCHOR") is None
    assert deck_log.due_slot(d(8, 3), "DOCK") == d(8, 0) and deck_log.due_slot(d(20, 0), None) == d(20, 0)


def test_status_entry_written_once_per_slot(example_client, monkeypatch):
    card = {"wind_apparent_deg": -24, "baro_3h_change_hpa": -1.2, "depth_ft": 30.1,
            "fuel": {"gal": 67}, "water": {"gal": 28}, "distance_this_watch_nm": 31.5, "watch_hours": 6}
    monkeypatch.setattr(log_stamp, "stamp", lambda minutes_ago=0, with_card=False:
                        dict(STAMP, **({"card": card} if with_card else {})))
    e = deck_log.write_due(_dt(2026, 10, 5, 14, 1))
    assert e["kind"] == "status" and e["record"] == "log" and e["title"] == "Status 1400"
    assert e["occurred_at"] == "2026-10-05T14:00"
    assert e["body"].startswith("30°01.36'N 090°01.94'W · SAIL · SOG 5.8 kn COG 180°T")
    assert "wind 14 kn app 24° port" in e["body"] and "baro 1013.0 hPa (-1.2 / 3 h)" in e["body"]
    assert "fuel 67 gal" in e["body"] and "31.5 nm in 6 h" in e["body"]
    assert e["stamp"]["card"]["depth_ft"] == 30.1
    assert deck_log.write_due(_dt(2026, 10, 5, 14, 2)) is None                   # same slot - not twice
    assert example_client.get("/api/logbook/this-watch").json()["entries"] == []  # 'log' level: not in the handover


def test_engine_event_carries_where_she_was(example_client, boat):
    from datetime import timezone
    r = example_client.post("/api/logbook/events", headers={"Authorization": "Bearer evtok"},
                            json=dict(EVENT, event_id="pos-1", time=_dt.now(timezone.utc).isoformat()))
    e = example_client.get(f"/api/logbook/{r.json()['entry_id']}").json()
    assert e["stamp"]["lat"] == 30.02266 and e["body"].startswith("30°01.36'N 090°01.94'W · SAIL")
