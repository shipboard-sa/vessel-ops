"""
Purpose: Tests for the desktop Ship's Log tab's server side: the printable log for a day / a passage
    (GET /api/report/logbook) - entries in time order with stamps and status chains, engine TEST events left out
    by default, the open-failure register, and bad dates refused - plus the list filters the tab leans on.
Version: v1 (2026-10-05)
Scope: PRODUCTION - mx-inv test suite.
Architecture: conftest's example_client; the boat stack is faked by patching backend.log_stamp.stamp (no network).
Invocation: .venv/Scripts/python -m pytest tests/test_logbook_page.py
"""
from __future__ import annotations

import datetime as dt

import pytest

import data
from backend import log_stamp

STAMP = {"lat": 30.02266, "lon": -90.03225, "sog_kn": 5.8, "cog_deg": 180, "mode": "SAIL",
         "wind_apparent_kn": 14, "baro_hpa": 1013.0, "sail_set": "Main reef 1 + Genoa full"}


@pytest.fixture
def boat(monkeypatch):
    monkeypatch.setattr(log_stamp, "stamp", lambda minutes_ago=0, with_card=False: dict(STAMP))
    monkeypatch.setenv("MXINV_EVENTS_TOKEN", "evtok")


def a_system():
    with data.connect() as c:
        return c.execute("SELECT name FROM systems WHERE parent_name IS NOT NULL LIMIT 1").fetchone()[0]


def test_printable_day(example_client, boat):
    sys_name = a_system()
    f = example_client.post("/api/logbook", json={"kind": "failure", "title": "Bilge pump float stuck",
                                                  "system": sys_name, "body": "Freed by hand"}).json()
    example_client.post(f"/api/logbook/{f['entry_id']}/status", json={"status": "parts-ordered", "note": "float"})
    example_client.post("/api/logbook", json={"kind": "observation", "title": "Chafe at the fairlead"})
    hdr = {"Authorization": "Bearer evtok"}
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    example_client.post("/api/logbook/events", headers=hdr, json={
        "event_id": "e-real", "kind": "alarm", "severity": "P1", "time": now, "message": "High water - salon"})
    example_client.post("/api/logbook/events", headers=hdr, json={
        "event_id": "e-test", "kind": "alarm", "severity": "P2", "time": now, "message": "Simulated thing",
        "simulated": True})

    today = dt.date.today().isoformat()
    r = example_client.get(f"/api/report/logbook?day={today}")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    page = r.text
    assert "Ship&#x27;s log" in page or "Ship's log" in page
    assert "Bilge pump float stuck" in page and "Chafe at the fairlead" in page and "High water - salon" in page
    assert "Simulated thing" not in page                        # tests left out by default
    assert "Parts Ordered" in page and "Freed by hand" in page  # status chain + body
    assert "SAIL" in page and "Main reef 1 + Genoa full" in page  # the stamp line
    assert "Failure register" in page and f["entry_ref"] in page
    assert '"kind"' not in page                                 # the engine's JSON detail is not printed
    # bodies print in time order (oldest first)
    assert page.index("Bilge pump float stuck") < page.index("Chafe at the fairlead")
    assert "Simulated thing" in example_client.get(f"/api/report/logbook?day={today}&tests=1").text


def test_printable_passage_range_and_empty(example_client, boat):
    example_client.post("/api/logbook", json={"kind": "incident", "title": "Lost steerage 4 min"})
    today = dt.date.today()
    page = example_client.get(f"/api/report/logbook?day={(today - dt.timedelta(days=3)).isoformat()}"
                              f"&to={today.isoformat()}").text
    assert "Lost steerage 4 min" in page and " to " in page
    empty = example_client.get("/api/report/logbook?day=2020-01-01").text
    assert "Nothing was logged in this period." in empty and "No open failures." in empty
    assert example_client.get("/api/report/logbook?day=yesterday").status_code == 400


def test_list_filters_the_tab_uses(example_client, boat):
    sys_name = a_system()
    a = example_client.post("/api/logbook", json={"kind": "failure", "title": "A", "system": sys_name}).json()
    example_client.post("/api/logbook", json={"kind": "observation", "title": "B"})
    assert [e["title"] for e in example_client.get("/api/logbook?kind=failure").json()] == ["A"]
    assert [e["title"] for e in example_client.get(f"/api/logbook?system={sys_name}").json()] == ["A"]
    today = dt.date.today()
    since, until = today.isoformat(), (today + dt.timedelta(days=1)).isoformat()
    assert len(example_client.get(f"/api/logbook?since={since}&until={until}").json()) == 2
    assert example_client.get("/api/logbook?since=2020-01-01&until=2020-01-02").json() == []
    example_client.post(f"/api/logbook/{a['entry_id']}/status", json={"status": "deferred"})
    assert [e["status"] for e in example_client.get("/api/logbook?open=1").json()] == ["deferred"]
