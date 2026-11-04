"""
Purpose: Tests for the /cockpit API - capabilities, heartbeat, the watch-handover weather read
    (missing / empty / unreadable / partial / full routing briefings never 500), and the two
    brokered writes answering ok (or 422 on a malformed body) while their broker is off.
Version: v6 (2026-10-18) - v6: capabilities carry `restock` (the cold boxes' EXPECTED? question, WF-502). v5 (2026-10-09) - v5: a watermaker session cannot be stopped or replaced (409). v4 (2026-10-09) - v4: tank-fill sessions (GET / POST /fill -> the engine, D-129). v3 (2026-10-05) - v3: Sail Plan is always on and logs to the ship's log; SignalK is reported, never blocks (the owner's review). v2 (2026-10-05) - v2: boat automation link (status, mode tap, ack, engine down, no token). v1 (2026-10-04)
Scope: PRODUCTION - mx-inv test suite.
Architecture: FastAPI TestClient (conftest's `client`) over backend/routers/cockpit.py; the
    briefings folder is pointed at a tmp dir with MXINV_ROUTING_BRIEFINGS_DIR per test.
Invocation: .venv\\Scripts\\python -m pytest tests/test_cockpit.py
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from backend.routers.cockpit import parse_briefing

FULL = """# Passage Briefing — FLD to T&C

*Generated 2026-09-22 09:46 EDT by passage-planner v0.1.0 · 2 analysis iteration(s)*

## 1. Executive Voyage Briefing

- **Route:** FLD to T&C — 12 legs

## 3. Weather Picture

### 3a. Tropical outlook

> **Active systems present but clear of the corridor.** Recheck before departure.

> Tropical Weather Outlook

### 3b. Model summary (along the route)

- **Wind:** 2–17 kn, gusts to 21 kn, generally from the SW
- **Seas:** Hs 0.3–1.8 m
- **Pressure:** 1013 → 1015 hPa over the passage (rising +1 hPa)
- **Source:** Open-Meteo (best_match), issued 2026-09-22 09:46 EDT `[Primary model via Open-Meteo]`

### 3c. Forecast confidence

> **PENDING** — run with `--compare`

## 4. Step-by-Step Weather Routing Analysis

- **Wind:** this is a leg table, not the summary
"""


@pytest.fixture
def briefings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    folder = tmp_path / "briefings"
    folder.mkdir()
    monkeypatch.setenv("MXINV_ROUTING_BRIEFINGS_DIR", str(folder))
    return folder


def test_capabilities_shape(client, briefings, monkeypatch):
    monkeypatch.delenv("MXINV_ENGINE_URL", raising=False)
    monkeypatch.delenv("MXINV_SIGNALK_URL", raising=False)
    caps = client.get("/api/cockpit/capabilities").json()
    assert caps == {"sail_plan": True, "sail_plan_signalk": False, "incident": True, "weather": True,
                    "boat": False, "boat_write": False, "handover_live": False, "fill": False,
                    "restock": False}


def test_ping(client):
    body = client.get("/api/cockpit/ping").json()
    assert body["ok"] is True and body["server_time"]


def test_wx_no_folder(client, tmp_path, monkeypatch):
    monkeypatch.setenv("MXINV_ROUTING_BRIEFINGS_DIR", str(tmp_path / "nowhere"))
    r = client.get("/api/cockpit/watch-handover/wx")
    assert r.status_code == 200
    assert r.json()["status"] == "PENDING" and r.json()["briefing"] is None
    assert client.get("/api/cockpit/capabilities").json()["weather"] is False


def test_wx_empty_folder(client, briefings):
    body = client.get("/api/cockpit/watch-handover/wx").json()
    assert body["status"] == "PENDING" and body["briefing"] is None


def test_wx_full_briefing(client, briefings):
    (briefings / "fld_to_tc.md").write_text(FULL, encoding="utf-8")
    body = client.get("/api/cockpit/watch-handover/wx").json()
    assert body["status"] == "ok"
    b = body["briefing"]
    assert b["stem"] == "fld_to_tc" and b["title"] == "FLD to T&C"
    assert b["generated_text"] == "Generated 2026-09-22 09:46 EDT"
    assert b["tropical"].startswith("Active systems present but clear")
    assert b["wind"].startswith("2–17 kn") and b["seas"] == "Hs 0.3–1.8 m"
    assert b["pressure"].startswith("1013") and "Primary model" not in b["source"]
    assert b["old"] is False and b["age_hours"] >= 0


def test_wx_picks_newest_and_flags_old(client, briefings):
    old = briefings / "old.md"
    old.write_text(FULL, encoding="utf-8")
    os.utime(old, (1_700_000_000, 1_700_000_000))           # 2023
    newer = briefings / "newer.md"
    newer.write_text(FULL, encoding="utf-8")
    os.utime(newer, (1_750_000_000, 1_750_000_000))        # 2025 - still > 24 h ago
    b = client.get("/api/cockpit/watch-handover/wx").json()["briefing"]
    assert b["stem"] == "newer" and b["old"] is True


def test_wx_briefing_without_weather_is_pending_not_500(client, briefings):
    (briefings / "half.md").write_text("# Passage Briefing — X\n\n## 1. Exec\n- **Route:** x\n", encoding="utf-8")
    r = client.get("/api/cockpit/watch-handover/wx")
    assert r.status_code == 200
    assert r.json()["status"] == "PENDING" and r.json()["briefing"]["title"] == "X"


def test_wx_garbage_bytes_do_not_500(client, briefings):
    (briefings / "junk.md").write_bytes(b"\xff\xfe\x00\x81 not utf-8 \x00" * 50)
    r = client.get("/api/cockpit/watch-handover/wx")
    assert r.status_code == 200 and r.json()["status"] == "PENDING"


def test_parse_partial_sections():
    got = parse_briefing("## 3. Weather Picture\n### 3b. Model\n- **Seas:** 1 m\n")
    assert got["seas"] == "1 m" and got["wind"] is None and got["tropical"] is None
    # a later numbered section's bullets are not mistaken for the summary
    assert parse_briefing(FULL)["wind"].startswith("2–17")


def test_sail_plan_rejects_missing_fields_with_422(client):
    assert client.post("/api/cockpit/sail-plan", json={}).status_code == 422


def test_checklists_endpoint_used_by_cockpit(example_client):
    rows = example_client.get("/api/tasks/checklists").json()
    assert isinstance(rows, list)
    for r in rows:
        assert {"task_id", "task_name", "last_completed_date", "retired_at",
                "step_count", "open_step_count"} <= set(r)


# -- boat automation link (v4, 2026-10-05): the rules engine is faked with a stub httpx --------

import httpx

from backend import boat_link


class _Resp:
    def __init__(self, status: int, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


STATUS = {"role": "standby", "healthy": False, "health_reasons": ["io.x stale"], "mode": "DOCK",
          "mode_manual": "DOCK", "test": {"active": False}, "rules": {}, "relays": {},
          "alarms": [{"rule": "WF-501-FRIDGE", "severity": "P2", "message": "P2 fridge warm",
                      "acked": False, "simulated": False}]}


@pytest.fixture
def engine(monkeypatch, tmp_path):
    """Engine configured with a token file (with the stray-space trap); records every call."""
    calls: list[tuple] = []
    tok = tmp_path / "engine.env"
    tok.write_text("PUSHOVER_APP_TOKEN=x\nENGINE_API_TOKEN= s3cret \n", encoding="utf-8")
    monkeypatch.setenv("MXINV_ENGINE_URL", "http://engine.test:8200/")
    monkeypatch.setenv("MXINV_ENGINE_TOKEN_FILE", str(tok))
    monkeypatch.delenv("MXINV_ENGINE_TOKEN", raising=False)

    def get(url, **kw):
        calls.append(("GET", url, None, kw.get("headers")))
        return _Resp(200, STATUS)

    def post(url, json=None, headers=None, **kw):
        calls.append(("POST", url, json, headers))
        if url.endswith("/mode"):
            return _Resp(200, {"mode": json["mode"], "manual": True})
        return _Resp(200, {"acked": ["WF-501-FRIDGE"]})

    monkeypatch.setattr(boat_link.httpx, "get", get)
    monkeypatch.setattr(boat_link.httpx, "post", post)
    return calls


def test_capabilities_boat_off_without_config(client, monkeypatch):
    for v in ("MXINV_ENGINE_URL", "MXINV_ENGINE_TOKEN", "MXINV_ENGINE_TOKEN_FILE"):
        monkeypatch.delenv(v, raising=False)
    caps = client.get("/api/cockpit/capabilities").json()
    assert caps["boat"] is False and caps["boat_write"] is False
    assert client.get("/api/cockpit/boat").status_code == 503
    assert client.post("/api/cockpit/mode", json={"mode": "DOCK"}).status_code == 503


def test_capabilities_and_status(client, engine):
    caps = client.get("/api/cockpit/capabilities").json()
    assert caps["boat"] is True and caps["boat_write"] is True
    st = client.get("/api/cockpit/boat").json()
    assert st["mode"] == "DOCK" and st["mode_manual"] == "DOCK" and st["can_write"] is True
    assert st["alarms"][0]["rule"] == "WF-501-FRIDGE" and "rules" not in st
    assert engine[-1][1] == "http://engine.test:8200/status"


def test_mode_tap_sends_token_and_by(client, engine):
    r = client.post("/api/cockpit/mode", json={"mode": "anchor"})
    assert r.status_code == 200 and r.json()["mode"] == "ANCHOR"
    method, url, body, headers = engine[-1]
    assert (method, url) == ("POST", "http://engine.test:8200/mode")
    assert body == {"mode": "ANCHOR", "by": "cockpit"}
    assert headers == {"Authorization": "Bearer s3cret"}   # stripped


def test_mode_rejects_unknown(client, engine):
    assert client.post("/api/cockpit/mode", json={"mode": "PARTY"}).status_code == 400
    assert engine == []


def test_ack(client, engine):
    r = client.post("/api/cockpit/ack")
    assert r.status_code == 200 and r.json()["acked"] == ["WF-501-FRIDGE"]
    assert engine[-1][2] == {"by": "cockpit"}


def test_engine_down_is_502_plain_words(client, engine, monkeypatch):
    def down(*a, **k):
        raise httpx.ConnectError("refused")
    monkeypatch.setattr(boat_link.httpx, "get", down)
    r = client.get("/api/cockpit/boat")
    assert r.status_code == 502 and "not answering" in r.json()["detail"]


def test_no_token_read_only(client, engine, monkeypatch):
    monkeypatch.delenv("MXINV_ENGINE_TOKEN_FILE")
    assert client.get("/api/cockpit/capabilities").json()["boat_write"] is False
    assert client.get("/api/cockpit/boat").json()["can_write"] is False
    assert client.post("/api/cockpit/ack").status_code == 503


# -- Sail Plan (v6, 2026-10-05): SignalK sails.activeSet, HB-09 rules --------------------------------------

from backend import sail_plan


def test_sail_rules():
    v = sail_plan.build("reef1", "genoa", "full", True)
    assert v == {"main": "reef1", "headsail": "genoa", "headsailState": "full", "wingOnWing": True,
                 "label": "Main reef 1 + Genoa full, wing-on-wing"}
    assert sail_plan.build("down", "none", "reef2", False)["label"] == "No sail (bare poles)"
    assert sail_plan.build("down", "none", "reef2", False)["headsailState"] is None
    assert sail_plan.build("full", "staysail", "reef2", False)["label"] == "Main full + Staysail reef 2"
    for bad in [("reef4", "none", None, False), ("full", "jib", "full", False), ("full", "genoa", None, False),
                ("full", "staysail", "full", True), ("down", "genoa", "full", True)]:
        with pytest.raises(sail_plan.SailPlanError):
            sail_plan.build(*bad)


@pytest.fixture
def sk(monkeypatch):
    """SignalK faked at the boat_link level: a dict of leaves; publish records (path, value, at)."""
    state: dict = {"leaves": {}, "published": [], "history": None}
    monkeypatch.setenv("MXINV_SIGNALK_URL", "http://sk.test:3000")
    monkeypatch.setenv("MXINV_SIGNALK_TOKEN", "tok")
    monkeypatch.setattr(boat_link, "signalk_get", lambda p: state["leaves"].get(p))

    def publish(path, value, at, label="mx-inv-cockpit"):
        state["published"].append((path, value, at))
        state["leaves"][path] = {"value": value, "timestamp": "2026-10-05T12:00:00Z"}
    monkeypatch.setattr(boat_link, "signalk_publish", publish)
    monkeypatch.setattr(boat_link, "history_latest", lambda p: state["history"])
    return state


def test_sail_plan_tile_always_on_signalk_flag_needs_token(client, monkeypatch):
    monkeypatch.setenv("MXINV_SIGNALK_URL", "http://sk.test:3000")
    monkeypatch.delenv("MXINV_SIGNALK_TOKEN", raising=False)
    monkeypatch.delenv("MXINV_SIGNALK_TOKEN_FILE", raising=False)
    caps = client.get("/api/cockpit/capabilities").json()
    assert caps["sail_plan"] is True and caps["sail_plan_signalk"] is False
    monkeypatch.setenv("MXINV_SIGNALK_TOKEN", "tok")
    assert client.get("/api/cockpit/capabilities").json()["sail_plan_signalk"] is True


def test_sail_plan_logs_without_signalk(client, monkeypatch):
    monkeypatch.delenv("MXINV_SIGNALK_URL", raising=False)
    r = client.post("/api/cockpit/sail-plan", json={"main": "reef1", "headsail": "genoa", "headsail_state": "full"})
    assert r.status_code == 200 and r.json()["signalk"] == "not set up on this server" and r.json()["entry_ref"]
    r2 = client.post("/api/cockpit/sail-plan", json={"main": "reef2", "headsail": "staysail", "headsail_state": "full"})
    log = client.get("/api/logbook?kind=sail").json()
    assert [e["title"] for e in log] == ["Sail plan: Main reef 1 + Genoa full → Main reef 2 + Staysail full",
                                         "Sail plan: Main reef 1 + Genoa full"]
    now = client.get("/api/cockpit/sail-plan").json()
    assert now["from"] == "log" and now["current"]["label"] == "Main reef 2 + Staysail full"
    assert r2.status_code == 200


def test_sail_plan_set_and_read(client, sk):
    import time
    assert client.get("/api/cockpit/sail-plan").json() == {"current": None, "since": None, "from": None}
    r = client.post("/api/cockpit/sail-plan", json={"main": "reef1", "headsail": "genoa", "headsail_state": "full",
                                                     "minutes_ago": 10})
    assert r.status_code == 200 and r.json()["current"]["label"] == "Main reef 1 + Genoa full"
    path, value, at = sk["published"][-1]
    assert path == "sails.activeSet" and abs((time.time() - at) - 600) < 5      # back-dated 10 min
    assert client.get("/api/cockpit/sail-plan").json()["from"] == "signalk"


def test_sail_plan_bad_tap_400(client, sk):
    r = client.post("/api/cockpit/sail-plan", json={"main": "down", "headsail": "genoa", "headsail_state": "full",
                                                     "wing_on_wing": True})
    assert r.status_code == 400 and "wing-on-wing" in r.json()["detail"] and sk["published"] == []
    assert client.post("/api/cockpit/sail-plan", json={"main": "full", "minutes_ago": 500}).status_code == 400


def test_sail_plan_restored_from_history(client, sk):
    v = sail_plan.build("full", "staysail", "reef1", False)
    sk["history"] = (1_790_000_000.0, v)
    got = client.get("/api/cockpit/sail-plan").json()
    assert got["from"] == "history" and got["current"] == v
    assert sk["published"] == [("sails.activeSet", v, 1_790_000_000.0)]   # written back with its ORIGINAL time


def test_sail_plan_signalk_refusal_still_logs(client, sk, monkeypatch):
    def refuse(*a, **k):
        raise boat_link.BoatLinkError("SignalK did not take the change - token not approved")
    monkeypatch.setattr(boat_link, "signalk_publish", refuse)
    r = client.post("/api/cockpit/sail-plan", json={"main": "full"})
    assert r.status_code == 200 and "not answering" in r.json()["signalk"] and "token" in r.json()["signalk"]
    assert client.get("/api/logbook?kind=sail").json()[0]["title"] == "Sail plan: Main full"   # logged anyway


# -- tank-fill sessions (cockpit v9, Ship's Automation D-129) -------------------------------------------------

FILL = {"tanks": {
    "water_port": {"label": "Water port", "level": 61.04, "session": None},
    "water_stbd": {"label": "Water stbd", "level": 40.0,
                   "session": {"source": "watermaker", "since": "2026-10-09T14:00:00Z", "by": "", "active": False}},
    "fuel_port": {"label": "Fuel port", "level": 72.55,
                  "session": {"source": "tap", "since": "2026-10-09T15:00:00Z", "by": "api:cockpit", "active": True}},
    "fuel_stbd": {"label": "Fuel stbd", "level": None, "session": None}},
    "watermaker": {"running": True, "watts": 640.0}}


@pytest.fixture
def fill_engine(monkeypatch, engine):
    """The `engine` stub answering /fill like engine api.py v9."""
    calls = engine

    def get(url, **kw):
        calls.append(("GET", url, None, kw.get("headers")))
        return _Resp(200, FILL if url.endswith("/fill") else STATUS)

    def post(url, json=None, headers=None, **kw):
        calls.append(("POST", url, json, headers))
        if url.endswith("/fill") and json["tank"] not in FILL["tanks"]:
            return _Resp(400, {"detail": "tank must be one of ..."})
        return _Resp(200, FILL)

    monkeypatch.setattr(boat_link.httpx, "get", get)
    monkeypatch.setattr(boat_link.httpx, "post", post)
    return calls


def test_fill_view_fuel_first_and_trimmed(client, fill_engine):
    assert client.get("/api/cockpit/capabilities").json()["fill"] is True
    v = client.get("/api/cockpit/fill").json()
    assert [t["tank"] for t in v["tanks"]] == ["fuel_port", "fuel_stbd", "water_port", "water_stbd"]
    fp = v["tanks"][0]
    assert fp["label"] == "Fuel port" and fp["level"] in (72.5, 72.6)
    assert fp["session"] == {"source": "tap", "since": "2026-10-09T15:00:00Z", "by": "api:cockpit", "active": True}
    assert v["tanks"][1]["level"] is None and v["tanks"][1]["session"] is None
    assert v["tanks"][3]["session"]["active"] is False
    assert v["watermaker"] == {"running": True, "watts": 640.0} and v["can_write"] is True
    assert fill_engine[-1][:2] == ("GET", "http://engine.test:8200/fill")


def test_fill_tap_sends_token_tank_on_and_by(client, fill_engine):
    r = client.post("/api/cockpit/fill", json={"tank": "fuel_stbd", "on": True})
    assert r.status_code == 200 and len(r.json()["tanks"]) == 4
    method, url, body, headers = fill_engine[-1]
    assert (method, url) == ("POST", "http://engine.test:8200/fill")
    assert body == {"tank": "fuel_stbd", "on": True, "by": "cockpit"}
    assert headers == {"Authorization": "Bearer s3cret"}
    client.post("/api/cockpit/fill", json={"tank": "fuel_port", "on": False})
    assert fill_engine[-1][2] == {"tank": "fuel_port", "on": False, "by": "cockpit"}


def test_fill_tap_unknown_tank_400_never_reaches_engine(client, fill_engine):
    assert client.post("/api/cockpit/fill", json={"tank": "holding", "on": True}).status_code == 400
    assert not [c for c in fill_engine if c[0] == "POST"]


def test_fill_no_token_read_only(client, fill_engine, monkeypatch):
    monkeypatch.delenv("MXINV_ENGINE_TOKEN_FILE")
    assert client.get("/api/cockpit/fill").json()["can_write"] is False
    assert client.post("/api/cockpit/fill", json={"tank": "fuel_port"}).status_code == 503


def test_fill_old_engine_is_501_plain_words(client, engine, monkeypatch):
    monkeypatch.setattr(boat_link.httpx, "get", lambda url, **kw: _Resp(404, {"detail": "Not Found"}))
    r = client.get("/api/cockpit/fill")
    assert r.status_code == 501 and "no tank fills yet" in r.json()["detail"]


def test_fill_engine_down_502(client, engine, monkeypatch):
    def down(*a, **k):
        raise httpx.ConnectError("refused")
    monkeypatch.setattr(boat_link.httpx, "get", down)
    r = client.get("/api/cockpit/fill")
    assert r.status_code == 502 and "not answering" in r.json()["detail"]


def test_fill_bad_token_says_so(client, engine, monkeypatch):
    monkeypatch.setattr(boat_link.httpx, "post", lambda url, **kw: _Resp(401, {"detail": "bad or missing bearer token"}))
    r = client.post("/api/cockpit/fill", json={"tank": "water_port", "on": True})
    assert r.status_code == 502 and "token" in r.json()["detail"]


def test_fill_watermaker_session_cannot_be_stopped_or_replaced(client, fill_engine):
    """water_stbd has a watermaker session (FILL): neither Stop nor Filling may reach the engine - either would drop
    the 95 % HP-pump cut (D-130, the owner 10-09)."""
    for on in (False, True):
        r = client.post("/api/cockpit/fill", json={"tank": "water_stbd", "on": on})
        assert r.status_code == 409 and "watermaker" in r.json()["detail"]
    assert not [c for c in fill_engine if c[0] == "POST"]
