"""
Purpose: Tests for WF-803 Post-passage tasks — arrival with P1/P2 engine events during the passage
    drafts check tasks; no alarms = no tasks; simulated events are excluded.
Version: v1 (2026-10-30)
Scope: PRODUCTION - mx-inv test suite.
Architecture: conftest's example_client; boat stack faked (log_stamp, events token).
Invocation: .venv/Scripts/python -m pytest tests/test_wf803.py
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

import data
from backend import log_stamp

STAMP = {"lat": 30.0, "lon": -90.0, "sog_kn": 6.0, "mode": "SAIL"}

EVENT_BASE: dict[str, Any] = {
    "source": "your-pi-hostname-rules", "kind": "alarm", "simulated": False, "data": None, "record": "handover",
}


def _utc_iso(minutes_ago: int) -> str:
    """A UTC ISO timestamp N minutes before now — the engine sends UTC."""
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat(timespec="seconds").replace("+00:00", "Z")


@pytest.fixture
def boat(monkeypatch):
    monkeypatch.setattr(log_stamp, "stamp", lambda minutes_ago=0, with_card=False: dict(STAMP))
    monkeypatch.setenv("MXINV_EVENTS_TOKEN", "evtok")


def _push_event(client, event_id: str, severity: str, message: str, origin: str, time: str,
                wf_id: str | None = None, simulated: bool = False) -> dict:
    body = dict(EVENT_BASE, event_id=event_id, severity=severity, message=message,
                origin=origin, time=time, simulated=simulated)
    if wf_id:
        body["wf_id"] = wf_id
    r = client.post("/api/logbook/events", json=body, headers={"Authorization": "Bearer evtok"})
    assert r.status_code == 200, r.text
    return r.json()


def test_arrival_with_alarms_drafts_tasks(example_client, boat):
    """A passage with P1/P2 events -> arrival creates draft check tasks."""
    c = example_client
    # Depart 5 hours ago
    d = c.post("/api/logbook/departure", json={"port": "New Orleans", "bound_for": "Pensacola",
                                               "source": "cockpit", "minutes_ago": 300})
    assert d.status_code == 200, d.text

    # Push two different alarm events during the passage (times within the window)
    _push_event(c, "ev-803-1", "P1", "P1 High water - salon", "WF-111-SALON",
                _utc_iso(200), wf_id="WF-111")
    _push_event(c, "ev-803-2", "P2", "P2 Fridge temp high", "WF-301-FRIDGE",
                _utc_iso(150), wf_id="WF-301")
    # Push a duplicate origin — should NOT create a second task
    _push_event(c, "ev-803-3", "P1", "P1 High water - salon (2nd)", "WF-111-SALON",
                _utc_iso(100), wf_id="WF-111")

    # Arrive
    a = c.post("/api/logbook/arrival", json={"port": "Pensacola", "source": "cockpit"})
    assert a.status_code == 200, a.text
    result = a.json()

    # Check that WF-803 drafted tasks
    assert "wf803_tasks" in result, f"Expected wf803_tasks in arrival response, got: {list(result.keys())}"
    tasks = result["wf803_tasks"]
    assert len(tasks) == 2, f"Expected 2 tasks (one per unique origin), got {len(tasks)}"

    origins = {t["origin"] for t in tasks}
    assert origins == {"WF-111-SALON", "WF-301-FRIDGE"}

    # Verify the tasks exist in the database
    for t in tasks:
        task_id = t["task_id"]
        with data.connect() as conn:
            row = conn.execute("SELECT task_name, task_description, task_kind, interval_type FROM tasks WHERE task_id = ?",
                               (task_id,)).fetchone()
        assert row is not None, f"Task {task_id} not found"
        assert row["task_kind"] == "one_off"
        assert row["interval_type"] == "break_fix"
        assert "Post-passage check:" in row["task_name"]
        assert "WF-803" in row["task_description"]


def test_arrival_without_alarms_no_tasks(example_client, boat):
    """A clean passage (no P1/P2) -> no draft tasks."""
    c = example_client
    c.post("/api/logbook/departure", json={"port": "New Orleans", "bound_for": "Pensacola",
                                          "source": "cockpit", "minutes_ago": 120})
    # Push only an info-level event (not P1/P2)
    _push_event(c, "ev-803-info", "info", "Mode changed to SAIL", "mode-change",
                _utc_iso(60))

    a = c.post("/api/logbook/arrival", json={"port": "Pensacola", "source": "cockpit"})
    assert a.status_code == 200
    assert "wf803_tasks" not in a.json()


def test_simulated_events_excluded(example_client, boat):
    """Simulated (test) events should NOT generate post-passage tasks."""
    c = example_client
    c.post("/api/logbook/departure", json={"port": "New Orleans", "bound_for": "Pensacola",
                                          "source": "cockpit", "minutes_ago": 120})
    _push_event(c, "ev-803-sim", "P1", "P1 TEST alarm", "WF-TEST",
                _utc_iso(60), simulated=True)

    a = c.post("/api/logbook/arrival", json={"port": "Pensacola", "source": "cockpit"})
    assert a.status_code == 200
    assert "wf803_tasks" not in a.json()


def test_task_description_includes_count(example_client, boat):
    """When the same origin fires multiple times, the description says so."""
    c = example_client
    c.post("/api/logbook/departure", json={"port": "New Orleans", "bound_for": "Pensacola",
                                          "source": "cockpit", "minutes_ago": 300})
    _push_event(c, "ev-803-m1", "P1", "P1 Bilge high", "WF-111-BILGE", _utc_iso(200))
    _push_event(c, "ev-803-m2", "P1", "P1 Bilge high (2)", "WF-111-BILGE", _utc_iso(150))
    _push_event(c, "ev-803-m3", "P1", "P1 Bilge high (3)", "WF-111-BILGE", _utc_iso(100))

    a = c.post("/api/logbook/arrival", json={"port": "Pensacola", "source": "cockpit"})
    tasks = a.json().get("wf803_tasks", [])
    assert len(tasks) == 1
    with data.connect() as conn:
        row = conn.execute("SELECT task_description FROM tasks WHERE task_id = ?",
                           (tasks[0]["task_id"],)).fetchone()
    assert "3 times" in row["task_description"]
