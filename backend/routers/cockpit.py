"""Cockpit/deck GUI API - the `/cockpit` surface for the helm phone + companionway tablets.

Purpose: Backend for the /cockpit tablet UI (see wiki/Cockpit-GUI.md and the "Cockpit App -
    Scope & Architecture" scope doc): which features are available, a cheap heartbeat the
    tablet polls to show "connected / last contact", the watch-handover weather summary read
    from routing's newest briefing, the two brokered writes (sail plan, incident), and the link to
    the boat automation stack (boat status + alarms, the boat-mode tap, alarm ack, tank-fill sessions).
Version: v11 (2026-10-18) - v11: GET / POST /restock - the cold boxes' 'EXPECTED?' question (Ship's Automation WF-502 /
    D-128): when a box has been over its limit 10 min with no restock on record, the engine asks; the crew answers
    YES (2 h to cool down) or NO (the alarm now) here; /capabilities says `restock`. v10 (2026-10-09) - v10: POST /fill refuses (409) a tank the WATERMAKER is filling - a stop, or a tap session
    replacing it (which then times out after 20 min), would drop the 95 % HP-pump cut (D-130); the owner 10-09: the watermaker
    must never overflow a tank while the crew is busy elsewhere (same rule as the anchor box). v9 (2026-10-09) - v9: GET / POST /fill - the four tanks' levels + fill sessions from the rules engine and the
    crew 'Filling' / 'Stop' tap (Ship's Automation D-129: a fill is started by the crew, not guessed from the sloshing
    senders); the engine token stays on this server like the mode tap. v8 (2026-10-05) - v8 (the owner's Ship's Log review): Sail Plan is ALWAYS on - every change goes into the ship's log first (data.log_sail_change, signed), SignalK sails.activeSet is updated when it can be and the answer says which ('signalk'); GET /sail-plan falls back to the log; capabilities.sail_plan_signalk. v7 (2026-10-05) - v7: POST /incident removed - Break / Incident writes the mx-inv logbook
    (/api/logbook, schema v37); capabilities.incident is always true. v6 (2026-10-05) - v6: Sail Plan wired to OUR SignalK (Ship's Automation HB-09) - GET / POST /sail-plan write
    `sails.activeSet` (backend/sail_plan.py) with mx-inv's own SignalK token, back-dated by "changed N min ago";
    the history DB keeps it as state (the record - no mx-inv table). the previous developer's never-built sail-config webhook
    (backend/sail_config.py, POST /sail-plan-change) removed. v5 (2026-10-05) - v5: GET /watch-handover/boat - the pre-filled handover card (backend/handover_card.py:
    SignalK now + history-api 'since the watch began'); /capabilities says handover_live. v4 (2026-10-05) - v4: wired to the live boat stack through backend/boat_link.py -
    GET /boat (mode, alarms, health from the rules engine), POST /mode (the DOCK / ANCHOR / AWAY /
    MOTOR / SAIL tap, D-092: the tablet's own lock PIN is the guard, the engine token stays on this
    server), POST /ack (acks every alarm, like the panel button); /capabilities says boat / boat_write.
    v3 (2026-10-04) - v3 (cockpit production pass): GET /ping heartbeat; the weather
    summary is real now - the newest routing briefing's generated line, tropical headline and
    §3b model summary (wind / seas / pressure / source) are pulled out of the markdown, with
    its age, instead of a "TODO" placeholder; every part of that read is optional, so a
    missing, empty, unreadable or half-written briefing answers 200 with what was found (never
    a 500); the briefings folder can be pointed elsewhere with MXINV_ROUTING_BRIEFINGS_DIR.
    v2 (2026-09-24, release package): GET /capabilities. v1 (2026-09-17): scaffold.
Scope: PRODUCTION - mx-inv backend, served by backend/main.py.
Architecture: mx-inv router, prefix /api/cockpit.
    - Checklist running needs no endpoint here: the cockpit reuses /api/tasks/checklists and
      the ChecklistSteps component/API wholesale.
    - watch-handover/wx READS routing's last-generated briefing (`var/briefings/*.md` in the
      sibling routing checkout, newest by mtime) - never triggers a live `passage-planner brief`
      run. Plain line-by-line text matching against routing's own headings ("## 3. Weather
      Picture", "### 3a.", "### 3b."); if routing changes its layout the fields just come back
      empty and the tablet says so.
    - sail-plan -> backend/sail_plan.py + boat_link.signalk_publish (SignalK `sails.activeSet`; the
      tile shows when this server has a SignalK write token). Break / Incident writes the logbook
      (POST /api/logbook, backend/routers/logbook.py) - no route here any more.
    - boat / mode / ack / fill / restock -> backend/boat_link.py -> the rules engine API (GET /status, POST /mode,
      POST /ack, GET / POST /fill, GET / POST /restock). Tagged `api:cockpit` in the engine's audit log. Engine down = 502 in plain words.
Invocation: mounted by backend/main.py; tests in tests/test_cockpit.py.
"""
from __future__ import annotations

import datetime
import os
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import data
from backend import boat_link, handover_card, log_stamp, sail_plan

router = APIRouter(prefix="/api/cockpit", tags=["cockpit"])

# Sibling checkout (E:\boat\{vessel-ops,routing} on the Ship's PC). MXINV_ROUTING_BRIEFINGS_DIR
# overrides it - for a worktree / scratch copy whose parent folder holds no routing checkout.
_DEFAULT_BRIEFINGS_DIR = Path(__file__).resolve().parents[3] / "routing" / "var" / "briefings"

# A briefing older than this is flagged "old" on the tablet (routing is run before a passage,
# not continuously - an old one is normal at the dock, but the crew should see its age).
_OLD_AFTER_H = 24.0
# Never read more than this of a briefing (they are ~25 KB); guards a runaway file.
_MAX_BRIEFING_BYTES = 512 * 1024


def _briefings_dir() -> Path:
    override = os.environ.get("MXINV_ROUTING_BRIEFINGS_DIR", "").strip()
    return Path(override) if override else _DEFAULT_BRIEFINGS_DIR


@router.get("/capabilities")
def capabilities() -> dict[str, bool]:
    """Which cockpit features have somewhere to go (release package 2026-09-24). Sail Plan
    and Break / Incident only SEND to an outside logbook - with none configured they used to
    say "Logged" and store nothing - and the weather line needs a routing briefings folder.
    The cockpit hides whatever is False."""
    return {
        "sail_plan": True,         # v9: every change is logged in the ship's log (the owner 10-05) - SignalK or not
        "sail_plan_signalk": boat_link.signalk_can_write(),
        "incident": True,          # v7: the mx-inv logbook (schema v37) - always there
        "weather": _briefings_dir().is_dir(),
        "boat": boat_link.engine_enabled(),
        "boat_write": boat_link.engine_can_write(),
        "handover_live": boat_link.signalk_url() is not None,
        "fill": boat_link.engine_enabled(),       # v9: the Tanks tile (taps need boat_write too)
        "restock": boat_link.engine_enabled(),    # v11: the cold boxes' EXPECTED? question (answers need boat_write)
    }


@router.get("/ping")
def ping() -> dict[str, Any]:
    """Heartbeat for the tablet's connection banner - touches no database, so it answers even
    when something else is slow."""
    return {"ok": True, "server_time": datetime.datetime.now().astimezone().isoformat(timespec="seconds")}


def _strip_md(text: str) -> str:
    """Drop the markdown emphasis / code marks routing uses, keep the words."""
    text = re.sub(r"`\[[^\]]*\]`", "", text)          # trailing `[Primary model ...]` tags
    return re.sub(r"[*`>]", "", text).strip()   # not "_": names like best_match keep theirs


def parse_briefing(text: str) -> dict[str, Any]:
    """Pull the watch-handover summary out of a routing briefing (markdown). Every field is
    optional - None when that part is missing - so a half-written or re-laid-out briefing
    never raises."""
    out: dict[str, Any] = {
        "title": None, "generated_text": None, "tropical": None,
        "wind": None, "seas": None, "pressure": None, "source": None,
    }
    section = ""
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("# ") and out["title"] is None:
            out["title"] = _strip_md(line[2:]).removeprefix("Passage Briefing").strip(" -—")
            continue
        if line.startswith("#"):
            heading = line.lstrip("#").strip().lower()
            if heading.startswith("3a"):
                section = "3a"
            elif heading.startswith("3b"):
                section = "3b"
            elif re.match(r"^\d", heading):   # any other numbered section ends 3a/3b
                section = ""
            continue
        if out["generated_text"] is None and line.startswith("*Generated"):
            out["generated_text"] = _strip_md(line).split(" by ")[0].strip()
            continue
        if section == "3a" and out["tropical"] is None and line.startswith(">"):
            # The first quoted line is routing's one-line verdict; the NHC text follows later.
            verdict = _strip_md(line)
            if verdict:
                out["tropical"] = verdict
            continue
        if section == "3b" and line.startswith("-"):
            m = re.match(r"-\s*\*\*(\w+):\*\*\s*(.+)", line)
            if m and m.group(1).lower() in ("wind", "seas", "pressure", "source"):
                out[m.group(1).lower()] = _strip_md(m.group(2))
    return out


@router.get("/watch-handover/wx")
def watch_handover_wx() -> dict[str, Any]:
    """Weather summary for the shift-change screen, from routing's newest briefing.

    status: "ok" (a briefing was found and at least one weather field read), "PENDING" (no
    folder / no briefing / nothing readable in it - ``reason`` says which). Always 200."""
    folder = _briefings_dir()
    if not folder.is_dir():
        return {"status": "PENDING", "reason": "No routing briefings folder on this computer.", "briefing": None}

    newest: tuple[float, Path] | None = None
    try:
        for p in folder.glob("*.md"):
            try:
                mtime = p.stat().st_mtime
            except OSError:
                continue   # vanished / locked mid-listing
            if newest is None or mtime > newest[0]:
                newest = (mtime, p)
    except OSError:
        return {"status": "PENDING", "reason": "Could not list the routing briefings folder.", "briefing": None}
    if newest is None:
        return {"status": "PENDING", "reason": "No passage briefing generated yet.", "briefing": None}

    mtime, path = newest
    generated = datetime.datetime.fromtimestamp(mtime, tz=datetime.timezone.utc)
    age_h = max(0.0, (datetime.datetime.now(datetime.timezone.utc) - generated).total_seconds() / 3600)
    briefing: dict[str, Any] = {
        "stem": path.stem,
        "generated_at": generated.isoformat(),
        "age_hours": round(age_h, 1),
        "old": age_h > _OLD_AFTER_H,
    }
    try:
        with path.open("rb") as fh:
            text = fh.read(_MAX_BRIEFING_BYTES).decode("utf-8", errors="replace")
    except OSError:
        return {"status": "PENDING", "reason": "The newest briefing could not be read.", "briefing": briefing}

    briefing.update(parse_briefing(text))
    if not any(briefing[k] for k in ("tropical", "wind", "seas", "pressure")):
        return {"status": "PENDING", "reason": "The newest briefing has no weather section.", "briefing": briefing}
    return {"status": "ok", "reason": "", "briefing": briefing}


@router.get("/sail-plan")
def sail_plan_now() -> dict[str, Any]:
    """The sail set now: SignalK's sails.activeSet, else the newest one in history (SignalK forgets values when it
    restarts - then it is written back with its ORIGINAL time, so the polar keeps the right set)."""
    try:
        leaf = boat_link.signalk_get(sail_plan.PATH) if boat_link.signalk_url() else None
    except boat_link.BoatLinkError:
        leaf = None
    if leaf and isinstance(leaf.get("value"), dict):
        return {"current": leaf["value"], "since": leaf.get("timestamp"), "from": "signalk"}
    try:
        past = boat_link.history_latest(sail_plan.PATH)
    except boat_link.BoatLinkError:
        past = None
    if past and isinstance(past[1], dict):
        t, value = past
        if boat_link.signalk_can_write():
            try:
                boat_link.signalk_publish(sail_plan.PATH, value, t)
            except boat_link.BoatLinkError:
                pass                                   # still shown; the next tap writes it anyway
        return {"current": value, "since": datetime.datetime.fromtimestamp(t, tz=datetime.timezone.utc).isoformat(),
                "from": "history"}
    logged = data.propulsion_now()                      # v9: what the ship's log says (SignalK down / not set up)
    if logged["sail_set"]:
        return {"current": {"label": logged["sail_set"]}, "since": logged["sail_since"], "from": "log"}
    return {"current": None, "since": None, "from": None}


class SailPlanTap(BaseModel):
    main: str
    headsail: str = "none"
    headsail_state: str | None = None
    wing_on_wing: bool = False
    minutes_ago: int = 0          # Owner: log it once the boat is settled - the change happened N min ago
    author: str | None = None     # v9: signed from the crew list (default = whoever has the watch)


@router.post("/sail-plan")
def sail_plan_set(body: SailPlanTap) -> dict[str, Any]:
    try:
        value = sail_plan.build(body.main, body.headsail, body.headsail_state, body.wing_on_wing)
    except sail_plan.SailPlanError as e:
        raise HTTPException(400, str(e)) from e
    if not 0 <= body.minutes_ago <= 180:
        raise HTTPException(400, "minutes_ago must be 0-180")
    at = datetime.datetime.now().timestamp() - body.minutes_ago * 60
    occurred = datetime.datetime.fromtimestamp(at).isoformat(timespec="minutes")
    try:                                                # v9: the ship's log FIRST - it works with no boat stack
        entry = data.log_sail_change(value["label"], source="cockpit", author=body.author, occurred_at=occurred,
                                     stamp=log_stamp.stamp(body.minutes_ago))
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    signalk = "not set up on this server"
    if boat_link.signalk_can_write():
        try:
            boat_link.signalk_publish(sail_plan.PATH, value, at)
            signalk = "updated"
        except boat_link.BoatLinkError as e:
            signalk = f"not answering ({e})"
    return {"current": value, "since": datetime.datetime.fromtimestamp(at, tz=datetime.timezone.utc).isoformat(),
            "from": "signalk" if signalk == "updated" else "log", "entry_ref": entry["entry_ref"], "signalk": signalk}


# -- boat automation stack (rules engine) ------------------------------------------------------

_BOAT_MODES = ("DOCK", "ANCHOR", "AWAY", "MOTOR", "SAIL")   # engine builtins/mode.py MODES
_BY = "cockpit"                                            # -> 'api:cockpit' in the engine audit log


def _engine(call, *args):
    try:
        return call(*args)
    except boat_link.BoatLinkError as e:
        raise HTTPException(e.status, str(e)) from e


@router.get("/boat")
def boat_status() -> dict[str, Any]:
    """What the cockpit shows from the rules engine: the boat mode (and whether someone tapped it),
    the alarms, and whether the automation is healthy. Trimmed from the engine's /status - the
    rules / relays / signals tables stay on the System page."""
    st = _engine(boat_link.engine_get, "/status")
    test = st.get("test") or {}
    return {
        "mode": st.get("mode"),
        "mode_manual": st.get("mode_manual"),
        "alarms": [
            {k: a.get(k) for k in ("rule", "severity", "message", "acked", "simulated")}
            for a in st.get("alarms") or []
        ],
        "healthy": st.get("healthy"),
        "health_reasons": st.get("health_reasons") or [],
        "role": st.get("role"),
        "test_active": bool(test.get("active")),
        "can_write": boat_link.engine_can_write(),
    }


class ModeTap(BaseModel):
    mode: str


@router.post("/mode")
def boat_mode(body: ModeTap) -> dict[str, Any]:
    """The boat-mode tap (D-092 / SO-9). The tablet's own lock PIN is the guard (the owner 10-04); this
    server adds the engine token, so the tablet never holds it."""
    mode = body.mode.strip().upper()
    if mode not in _BOAT_MODES:
        raise HTTPException(400, f"mode must be one of {', '.join(_BOAT_MODES)}")
    return _engine(boat_link.engine_post, "/mode", {"mode": mode, "by": _BY})


@router.post("/ack")
def boat_ack() -> dict[str, Any]:
    """Ack every alarm - the same as the panel's ack button (the engine has one ack for all)."""
    return _engine(boat_link.engine_post, "/ack", {"by": _BY})


@router.get("/watch-handover/boat")
def watch_handover_boat() -> dict[str, Any]:
    """The pre-filled handover card (WF-602 / N-39): SignalK now, plus fuel / water used, distance run and the
    barometer trend over the watch from the history read API. A missing value is left out, never invented."""
    tree = _engine(boat_link.signalk_self)
    return handover_card.build_card(tree, boat_link.history_at)


# -- tank-fill sessions (v9, Ship's Automation D-129, engine api.py v9) ------------------------------------

FILL_TANKS = ("fuel_port", "fuel_stbd", "water_port", "water_stbd")   # engine builtins/fill.py TANKS (fuel first)


def _fill_view(raw: Any) -> dict[str, Any]:
    """The engine's GET /fill, as a fixed-order list (fuel first - the cockpit's fill is mostly fuel at the start or
    end of a passage) with the level rounded. A tank the engine does not configure is left out."""
    tanks = (raw or {}).get("tanks") or {}
    out = []
    for key in FILL_TANKS:
        t = tanks.get(key)
        if not isinstance(t, dict):
            continue
        lvl = t.get("level")
        s = t.get("session")
        out.append({
            "tank": key,
            "label": t.get("label") or key,
            "level": round(float(lvl), 1) if isinstance(lvl, (int, float)) else None,
            "session": {k: s.get(k) for k in ("source", "since", "by", "active")} if isinstance(s, dict) else None,
        })
    wm = (raw or {}).get("watermaker") or {}
    return {"tanks": out, "watermaker": {"running": bool(wm.get("running")), "watts": wm.get("watts")},
            "can_write": boat_link.engine_can_write()}


@router.get("/fill")
def fill_status() -> dict[str, Any]:
    """Each tank's level and fill session (crew tap or watermaker) and the watermaker, from the rules engine."""
    try:
        raw = boat_link.engine_get("/fill")
    except boat_link.BoatLinkError as e:
        if e.status == 404:                   # an engine older than api.py v9
            raise HTTPException(501, "The rules engine on the boat has no tank fills yet (it needs engine "
                                     "api.py v9).") from e
        raise HTTPException(e.status, str(e)) from e
    return _fill_view(raw)


class FillTap(BaseModel):
    tank: str
    on: bool = True


@router.post("/fill")
def fill_tap(body: FillTap) -> dict[str, Any]:
    """'Filling' (on) / 'Stop' (off) for one tank. The engine ends sessions by itself too (20 min with no rise,
    4 h, watermaker stopped); a second 'Filling' on a tank already filling changes nothing."""
    if body.tank not in FILL_TANKS:
        raise HTTPException(400, f"tank must be one of {', '.join(FILL_TANKS)}")
    # v10: never touch a watermaker session - it carries the 95 % HP-pump cut (D-130); it ends when the watermaker stops
    session = ((_engine(boat_link.engine_get, "/fill").get("tanks") or {}).get(body.tank) or {}).get("session") or {}
    if session.get("source") == "watermaker":
        raise HTTPException(409, "The watermaker is filling this tank - it stops itself at 95 %; stop the watermaker "
                                 "to end it.")
    return _fill_view(_engine(boat_link.engine_post, "/fill", {"tank": body.tank, "on": body.on, "by": _BY}))


# -- cold-box 'EXPECTED?' question (v11, Ship's Automation WF-502 / D-128, engine api.py v14) ----------------------

RESTOCK_BOXES = ("fridge", "engel", "fz_aft", "fz_fwd")   # engine builtins/restock.py BOXES


def _restock_view(raw: Any) -> dict[str, Any]:
    """The engine's GET /restock as a list; `asking` = WF-502 is asking 'expected?' for that box right now."""
    boxes = (raw or {}).get("boxes") or {}
    out = []
    for key in RESTOCK_BOXES:
        b = boxes.get(key)
        if not isinstance(b, dict):
            continue
        m = b.get("mark")
        out.append({"box": key, "label": b.get("label") or key, "asking": bool(b.get("asking")),
                    "alarm": bool(b.get("alarm")),
                    "mark": {k: m.get(k) for k in ("kind", "since", "until", "by", "source")} if isinstance(m, dict) else None})
    return {"boxes": out, "hold_h": (raw or {}).get("hold_h"), "can_write": boat_link.engine_can_write()}


@router.get("/restock")
def restock_status() -> dict[str, Any]:
    """Each cold box: is the engine asking 'expected?', is its alarm up, and its restock hold / 'not expected' mark."""
    try:
        raw = boat_link.engine_get("/restock")
    except boat_link.BoatLinkError as e:
        if e.status == 404:                   # an engine older than api.py v14
            raise HTTPException(501, "The rules engine on the boat has no restock watch yet (it needs engine "
                                     "api.py v14).") from e
        raise HTTPException(e.status, str(e)) from e
    return _restock_view(raw)


class RestockAnswer(BaseModel):
    box: str
    answer: str                               # yes | no


@router.post("/restock")
def restock_answer(body: RestockAnswer) -> dict[str, Any]:
    """The crew's answer: YES = warm food went in on purpose - its alarm waits 2 h; NO = not expected - the alarm now.
    409 (from the engine) = that box's alarm is already up - a YES cannot silence it."""
    if body.box not in RESTOCK_BOXES:
        raise HTTPException(400, f"box must be one of {', '.join(RESTOCK_BOXES)}")
    if body.answer not in ("yes", "no"):
        raise HTTPException(400, "answer must be yes or no")
    return _restock_view(_engine(boat_link.engine_post, "/restock", {"box": body.box, "answer": body.answer, "by": _BY}))
