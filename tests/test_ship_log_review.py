"""
Purpose: Tests for the owner's Ship's Log review items (2026-10-05, schema v39): entries signed from the crew list
    (server-enforced), the watchkeeper (first watch at departure, handover "A -> B", none alongside), status changes
    listed on the day they happened, fix-task -> its open failures, engine on / off by hand (refuses a repeat), the
    apparent wind angle on the stamp, and the printout's status-change lines.
Version: v1 (2026-10-05)
Scope: PRODUCTION - mx-inv test suite.
Architecture: conftest's example_client (example crew: Skipper, First Mate - people; Harbor Marine Service - vendor);
    the boat stack faked by patching backend.log_stamp.stamp.
Invocation: .venv/Scripts/python -m pytest tests/test_ship_log_review.py
"""
from __future__ import annotations

import datetime as dt

import pytest

from backend import log_stamp


@pytest.fixture
def boat(monkeypatch):
    monkeypatch.setattr(log_stamp, "stamp", lambda minutes_ago=0, with_card=False: {
        "lat": 30.0, "lon": -89.0, "sog_kn": 6.0, "mode": "SAIL", "wind_apparent_kn": 14, "wind_apparent_deg": -41})


def test_entries_are_signed_from_the_crew_list(example_client, boat):
    ok = example_client.post("/api/logbook", json={"kind": "observation", "title": "Chafe", "author": "first mate"})
    assert ok.status_code == 200 and ok.json()["author"] == "First Mate"            # roster spelling
    bad = example_client.post("/api/logbook", json={"kind": "observation", "title": "x", "author": "Stranger"})
    assert bad.status_code == 400 and "crew list" in bad.json()["detail"]
    vendor = example_client.post("/api/logbook", json={"kind": "observation", "title": "x",
                                                      "author": "Harbor Marine Service"})
    assert vendor.status_code == 400                                                  # people sign the log
    assert example_client.get("/api/logbook/watchkeeper").json()["crew"] == ["Skipper", "First Mate"]


def test_watchkeeper_flow(example_client, boat):
    assert example_client.get("/api/logbook/watchkeeper").json()["watchkeeper"] is None   # alongside: no watch
    example_client.post("/api/logbook/departure", json={"port": "New Orleans", "bound_for": "Pensacola",
                                                       "author": "Skipper", "first_watch": "Skipper"})
    wk = example_client.get("/api/logbook/watchkeeper").json()["watchkeeper"]
    assert wk["on_watch"] == "Skipper"
    w = example_client.post("/api/logbook/watch", json={"author": "Skipper", "on_watch": "first_mate"})
    assert w.status_code == 200 and w.json()["title"] == "Watch handover: Skipper → first_mate"
    assert w.json()["on_watch"] == "First Mate"
    assert example_client.get("/api/logbook/watchkeeper").json()["watchkeeper"]["on_watch"] == "First Mate"
    assert example_client.post("/api/logbook/watch", json={"on_watch": "Nobody"}).status_code == 400
    example_client.post("/api/logbook/arrival", json={"port": "Pensacola"})
    assert example_client.get("/api/logbook/watchkeeper").json()["watchkeeper"] is None


def test_status_changes_by_day_and_raised_by(example_client, boat):
    import data
    with data.connect() as c:
        sysname = c.execute("SELECT name FROM systems WHERE parent_name IS NOT NULL LIMIT 1").fetchone()[0]
    f = example_client.post("/api/logbook", json={
        "kind": "failure", "title": "Float stuck", "system": sysname,
        "follow_on": {"task_name": "Replace float", "urgency": "urgent"}}).json()
    example_client.post(f"/api/logbook/{f['entry_id']}/status", json={"status": "parts-ordered", "note": "Defender"})
    today = dt.date.today()
    since, until = today.isoformat(), (today + dt.timedelta(days=1)).isoformat()
    ch = example_client.get(f"/api/logbook/status-changes?since={since}&until={until}").json()
    assert [(c["previous"], c["status"], c["entry_ref"]) for c in ch] == [("broke", "parts-ordered", f["entry_ref"])]
    raised = example_client.get(f"/api/logbook/raised-by/{f['follow_on_task_id']}").json()
    assert [r["entry_id"] for r in raised] == [f["entry_id"]]
    example_client.post(f"/api/logbook/{f['entry_id']}/status", json={"status": "fixed", "author": "Harbor Marine Service"})
    assert example_client.get(f"/api/logbook/raised-by/{f['follow_on_task_id']}").json() == []
    page = example_client.get(f"/api/report/logbook?day={since}").text
    assert "Parts Ordered → Fixed" in page and "Broke → Parts Ordered" in page and "k-change" in page


def test_engine_on_off_and_wind_angle(example_client, boat):
    on = example_client.post("/api/logbook/engine", json={"on": True, "author": "Skipper"})
    assert on.status_code == 200 and on.json()["title"] == "Engine on - motoring"
    assert on.json()["stamp"]["wind_apparent_deg"] == -41
    assert example_client.post("/api/logbook/engine", json={"on": True}).status_code == 409
    example_client.post("/api/cockpit/sail-plan", json={"main": "reef1", "headsail": "genoa", "headsail_state": "full"})
    off = example_client.post("/api/logbook/engine", json={"on": False})
    assert off.json()["title"] == "Engine off - sailing (Main reef 1 + Genoa full)"
    p = example_client.get("/api/logbook/propulsion").json()
    assert p["engine_on"] is False and p["sail_set"] == "Main reef 1 + Genoa full"
    on2 = example_client.post("/api/logbook/engine", json={"on": True}).json()
    assert on2["title"] == "Engine on - motor-sailing (Main reef 1 + Genoa full)"
    page = example_client.get(f"/api/report/logbook?day={dt.date.today().isoformat()}").text
    assert "41° port" in page and "Sail plan" in page and "Engine on - motoring" in page


def test_engine_hours_one_reading_two_uses(example_client, boat):
    import data
    data.set_hours_reading("engine", 1242.0, "2026-10-01")
    p = example_client.get("/api/logbook/propulsion").json()
    assert p["engine_hours_last"] == 1242.0 and p["engine_hours_now"] >= 1242.0          # projection offered
    example_client.post("/api/logbook/departure", json={"port": "Pensacola", "bound_for": "Tampa", "minutes_ago": 240})
    on = example_client.post("/api/logbook/engine", json={"on": True, "hours": 1250.4, "minutes_ago": 180})
    assert on.status_code == 200 and on.json()["stamp"]["engine_hours"] == 1250.4
    assert data.get_hours_reading("engine")[0] == 1250.4                                 # maintenance meter moved
    back = example_client.post("/api/logbook/engine", json={"on": False, "hours": 1249})
    assert back.status_code == 400 and "last read 1250.4" in back.json()["detail"]       # never backwards
    example_client.post("/api/logbook/engine", json={"on": False, "hours": 1256.6})
    example_client.post("/api/logbook/arrival", json={"port": "Tampa"})
    leg = example_client.get("/api/logbook/passages").json()[0]
    assert leg["engine_hours_run"] == 6.2
    page = example_client.get(f"/api/report/logbook?passage={leg['passage_id']}").text
    assert "6.2 h (hour meter" in page and "engine 1256.6 h" in page
