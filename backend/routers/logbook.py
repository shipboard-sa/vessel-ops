"""
Purpose: The logbook API (schema v37, option C - design/LOGBOOK_DESIGN.md): crew entries (failure / observation /
    incident) from the cockpit and desktop, failure status updates, the watch entry at handover, the Ship's Automation
    rules engine's event push, the notification journal (WF-807), and "what happened this watch" for the Watch
    Handover screen.
Version: v6 (2026-10-30) - v6: WF-807 notification journal - GET /notifications lists engine events with parsed N2K
    notification detail (path, device message, notification state) and position, filterable by severity/date/text.
    v5 (2026-10-30) - v5: WF-803 Post-passage tasks — on arrival, draft check tasks for P1/P2 alarms during the passage (backend/post_passage.py). v4 (2026-10-05) - v4: the owner's Ship's Log review - GET /watchkeeper (who has the watch + the crew list), /status-changes (each on the day it happened), /raised-by/{task_id} (fix task done -> offer Fixed), /propulsion, POST /engine (on / off by hand); the watch entry records who TOOK the watch, a departure the first watch; entries are signed from the crew list (400 otherwise). v3 (2026-10-05) - v3: PASSAGES (schema v38, Owner: each leg is a passage) - GET /passages, /passages/current,
    /ports, POST /departure and /arrival (409 when out of order: no departure while under way, no arrival without
    a departure). v2 (2026-10-05) - v2: this-watch is a CHANGE report (the owner): new entries + status changes on older
    failures since the last watch entry, by WRITE ORDER (no clock precision); the owner's statuses. v1 (2026-10-05)
Scope: PRODUCTION - mx-inv backend, served by backend/main.py.
Architecture: mx-inv router, prefix /api/logbook. Storage = data.py (append-only logbook tables); stamps come from
    backend/log_stamp.py (boat stack via boat_link). POST /events is the engine contract (Ship's Automation
    spec/04-Interfaces/mxinv-events.md - authoritative copy now design/LOGBOOK_DESIGN.md section 6): bearer
    MXINV_EVENTS_TOKEN (or the same key in engine.env), 2xx = stored, 409 = already stored (the engine treats both
    as delivered), 401 = wrong / missing token, 422 = a body we will never accept.
Invocation: mounted by backend/main.py; tests in tests/test_logbook.py.
"""
from __future__ import annotations

import hmac
import json
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

import data
from backend import boat_link, deck_log, log_stamp, post_passage

router = APIRouter(prefix="/api/logbook", tags=["logbook"])


def _err(e: Exception) -> HTTPException:
    return HTTPException(404 if isinstance(e, LookupError) else 400, str(e))


@router.get("")
def list_entries(kind: str | None = None, system: str | None = None, open: bool = False,  # noqa: A002
                 since: str | None = None, until: str | None = None, simulated: bool = True,
                 limit: int = 200) -> list[dict[str, Any]]:
    return data.list_log_entries(kind=kind, system=system, open_only=open, since=since, until=until,
                                 include_simulated=simulated, limit=limit)


@router.get("/this-watch")
def this_watch() -> dict[str, Any]:
    """A CHANGE report since the last watch entry (the owner 10-05: "what's changed since last time" - the standing
    Deferred / Accepted register is NOT repeated here): new entries (crew + engine events) and status changes on
    older failures. No watch entry yet = the last 6 h."""
    watches = data.list_log_entries(kind="watch", limit=1)
    if watches:
        w = data.get_log_entry(watches[0]["entry_id"])
        since, after = w["occurred_at"], w["entry_id"]
        rows = [r for r in data.list_log_entries(limit=500, since=(datetime.fromisoformat(since)
                                                                  - timedelta(hours=24)).isoformat(timespec="minutes"))
                if r["entry_id"] > w["entry_id"]]          # logged after the last watch entry (back-dated ones too)
    else:
        since = (datetime.now() - timedelta(hours=6)).isoformat(timespec="minutes")
        rows = [r for r in data.list_log_entries(since=since, limit=500) if r["kind"] != "watch"]
    rows = [r for r in rows if r.get("record") != "log"]   # D-114: 'log'-level engine entries skip the handover
    new_ids = {r["entry_id"] for r in rows}
    if watches:
        changes = data.list_log_status_changes(after)
    else:                     # no watch entry yet: the last 6 h by the minute is plenty
        changes = [c for c in data.list_log_status_changes(0) if c["at"] >= since]
    changes = [c for c in changes if c["entry_id"] not in new_ids]
    return {"since": since, "since_last_watch_entry": bool(watches), "entries": rows, "status_changes": changes}


@router.get("/watchkeeper")
def watchkeeper() -> dict[str, Any]:
    """Who has the watch (None alongside / at anchor) and the names an entry can be signed with."""
    return {"watchkeeper": data.current_watchkeeper(), "crew": data.crew_people()}


@router.get("/status-changes")
def status_changes(since: str, until: str) -> list[dict[str, Any]]:
    """Failure status changes that happened in [since, until), newest first - shown on their own day (the owner 10-05)."""
    return data.list_status_changes_between(since, until)


@router.get("/raised-by/{task_id}")
def raised_by(task_id: int) -> list[dict[str, Any]]:
    """Open failures whose fix task is task_id - the desktop offers to mark them Fixed when the task completes."""
    return data.open_failures_raised_by(task_id)


@router.get("/propulsion")
def propulsion() -> dict[str, Any]:
    """The sail set and engine state as logged by hand."""
    return data.propulsion_now()


class EngineTap(BaseModel):
    on: bool
    hours: float | None = Field(None, ge=0, le=100000)    # the hour meter as read now (also the maintenance reading)
    author: str | None = None
    source: str = "cockpit"
    minutes_ago: int = Field(0, ge=0, le=180)


@router.post("/engine")
def engine(body: EngineTap) -> dict[str, Any]:
    occurred = (datetime.now() - timedelta(minutes=body.minutes_ago)).isoformat(timespec="minutes")
    try:
        return data.log_engine(body.on, source=body.source, author=body.author, occurred_at=occurred,
                               stamp=log_stamp.stamp(body.minutes_ago), hours=body.hours)
    except data.PassageOrderError as e:
        raise HTTPException(409, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.get("/passages")
def passages(limit: int = 100) -> list[dict[str, Any]]:
    """Every passage (one leg: a departure to the next arrival), newest first, with its facts."""
    return data.list_passages(limit)


@router.get("/passages/current")
def passage_now() -> dict[str, Any]:
    """{'passage': the leg under way, or None} - the cockpit's Depart / Arrive tile."""
    return {"passage": data.current_passage()}


@router.get("/ports")
def ports() -> list[str]:
    """Ports named so far, most recent first - the pick list for a departure / arrival."""
    return data.passage_ports()


class PassageEnd(BaseModel):
    port: str
    bound_for: str | None = None                # departure only
    first_watch: str | None = None              # departure only: who takes the first watch (crew list)
    body: str | None = None
    author: str | None = None
    source: str = "desktop"                     # the cockpit sends 'cockpit'
    minutes_ago: int = Field(0, ge=0, le=24 * 60)


def _passage_end(kind: str, body: PassageEnd) -> dict[str, Any]:
    occurred = (datetime.now() - timedelta(minutes=body.minutes_ago)).isoformat(timespec="minutes")
    try:
        return data.log_passage_end(kind, body.port, source=body.source, bound_for=body.bound_for, body=body.body,
                                    author=body.author, occurred_at=occurred,
                                    stamp=log_stamp.stamp(body.minutes_ago), first_watch=body.first_watch)
    except data.PassageOrderError as e:
        raise HTTPException(409, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/departure")
def departure(body: PassageEnd) -> dict[str, Any]:
    return _passage_end("departure", body)


@router.post("/arrival")
def arrival(body: PassageEnd) -> dict[str, Any]:
    result = _passage_end("arrival", body)
    # WF-803: draft post-passage check tasks for any P1/P2 alarms during the passage
    try:
        passage = data.current_passage()  # None now — it just closed
        if passage is None:
            # The arrival closed the passage; get the most recent completed one
            ps = data.list_passages(1)
            passage = ps[0] if ps else None
        if passage and passage.get("arrived_at"):
            tasks = post_passage.draft_post_passage_tasks(passage)
            if tasks:
                result["wf803_tasks"] = tasks
    except Exception:
        import logging
        logging.getLogger(__name__).exception("WF-803: post-passage task drafting failed (arrival still recorded)")
    return result


@router.get("/{entry_id}")
def get_entry(entry_id: int) -> dict[str, Any]:
    try:
        return data.get_log_entry(entry_id)
    except LookupError as e:
        raise _err(e) from e


class FollowOn(BaseModel):
    task_name: str
    urgency: str = "routine"
    description: str | None = None


class CrewEntry(BaseModel):
    kind: str                                   # failure / observation / incident
    title: str
    body: str | None = None
    system: str | None = None
    severity: str | None = None
    author: str | None = None
    source: str = "desktop"                     # the cockpit sends 'cockpit'
    minutes_ago: int = Field(0, ge=0, le=24 * 60)
    follow_on: FollowOn | None = None


@router.post("")
def add_entry(body: CrewEntry) -> dict[str, Any]:
    if body.kind not in data.LOG_CREW_KINDS:
        raise HTTPException(400, f"kind must be one of {', '.join(data.LOG_CREW_KINDS)}")
    if body.source not in ("cockpit", "desktop"):
        raise HTTPException(400, "source must be cockpit or desktop")
    occurred = (datetime.now() - timedelta(minutes=body.minutes_ago)).isoformat(timespec="minutes")
    try:
        return data.create_log_entry(
            body.kind, body.title, source=body.source, body=body.body, system=body.system, severity=body.severity,
            author=body.author, occurred_at=occurred, stamp=log_stamp.stamp(body.minutes_ago),
            follow_on=body.follow_on.model_dump() if body.follow_on else None)
    except (ValueError, LookupError) as e:
        raise _err(e) from e


class StatusUpdate(BaseModel):
    status: str
    note: str | None = None
    author: str | None = None


@router.post("/{entry_id}/status")
def add_status(entry_id: int, body: StatusUpdate) -> dict[str, Any]:
    try:
        return data.add_log_status(entry_id, body.status, note=body.note, author=body.author)
    except (ValueError, LookupError) as e:
        raise _err(e) from e


class WatchEntry(BaseModel):
    notables: str | None = None
    author: str | None = None                   # who hands over (signs the entry)
    on_watch: str | None = None                 # who TAKES the watch (the owner 10-05) - the default signature from now on


@router.post("/watch")
def add_watch(body: WatchEntry) -> dict[str, Any]:
    """The watch entry at handover (the owner's Watch Log, 2026-09-11): the handover card as it stood + the crew's
    notables; the events / entries since the last watch entry are listed in the body so the entry reads on its own."""
    tw = this_watch()
    lines = [f"- {r['occurred_at'][11:19 if r['source'] == 'engine' else 16]} {r['severity'] or r['kind']}: "
             f"{r['title']}"
             + (" (TEST)" if r["simulated"] else "") for r in reversed(tw["entries"])]
    lines += [f"- {c['at'][11:16]} {c['entry_ref']} {c['title']}: {c['previous']} -> {c['status']}"
              + (f" ({c['note']})" if c["note"] else "") for c in tw["status_changes"]]
    obs = (body.notables or "").strip()        # the watchkeeper's observations (Owner: a comment opportunity)
    text = "\n".join(filter(None, [f"Observations: {obs}" if obs else None,
                                   ("This watch:\n" + "\n".join(lines)) if lines else "Nothing logged this watch."]))
    st = log_stamp.stamp(0, with_card=True)
    if st and "card" in st:
        st["card_json"] = json.dumps(st.pop("card"))
    title = "Watch handover" + (f": {body.author} → {body.on_watch}" if body.author and body.on_watch
                                else f" to {body.on_watch}" if body.on_watch else "")
    try:
        return data.create_log_entry("watch", title, source="cockpit", body=text, author=body.author, stamp=st,
                                     on_watch=body.on_watch)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


class EngineEvent(BaseModel):
    event_id: str
    source: str = "your-pi-hostname-rules"
    wf_id: str | None = None
    origin: str | None = None
    kind: str
    severity: str | None = None
    time: str
    message: str
    simulated: bool = False
    data: dict[str, Any] | None = None
    record: str = "handover"                    # the rule's record: level (D-114) - handover or log


def _local(iso_utc: str) -> str:
    """The engine's fire time, local, TO THE SECOND (the owner 10-05: engine entries keep the order things fired in a
    critical sequence - crew entries stay to the minute)."""
    try:
        return datetime.fromisoformat(iso_utc.replace("Z", "+00:00")).astimezone().replace(tzinfo=None) \
            .isoformat(timespec="seconds")
    except ValueError as e:
        raise HTTPException(422, f"time is not ISO-8601: {iso_utc!r}") from e


@router.post("/events")
def engine_event(body: EngineEvent, authorization: str | None = Header(None)) -> dict[str, Any]:
    """The rules engine's push (one event per POST). Stored as kind 'event'."""
    want = boat_link.events_token()
    got = (authorization or "").removeprefix("Bearer ").strip()
    if not want or not hmac.compare_digest(got.encode(), want.encode()):
        raise HTTPException(401, "bad or missing bearer token")
    detail = {k: v for k, v in {"kind": body.kind, "origin": body.origin, "wf_id": body.wf_id,
                                "data": body.data}.items() if v}
    # the ship's log: every engine event carries where the boat was and how she was going WHEN IT FIRED -
    # live if it is fresh, from the history read API if the engine's outbox delivered it late
    occurred = _local(body.time)
    late_min = max(0, int((datetime.now() - datetime.fromisoformat(occurred)).total_seconds() // 60))
    stamp = log_stamp.stamp(late_min if late_min >= 2 else 0, with_card=late_min < 2)
    line = deck_log.status_line(stamp) if stamp else None
    if stamp and "card" in stamp:
        stamp["card_json"] = json.dumps(stamp.pop("card"))
    try:
        e = data.create_log_entry(
            "event", body.message or body.kind, source="engine", severity=body.severity or "info",
            author="engine", occurred_at=occurred,
            body=(line + "\n" if line else "") + json.dumps(detail, default=str), stamp=stamp,
            source_event_id=body.event_id, simulated=body.simulated,
            record=body.record if body.record in ("handover", "log") else "handover")
    except data.DuplicateEvent as e:
        raise HTTPException(409, str(e)) from e
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    return {"entry_id": e["entry_id"], "entry_ref": e["entry_ref"]}


def _parse_notification_detail(body_text: str | None) -> dict[str, Any]:
    """Extract the N2K notification detail from an engine event's body (the JSON blob after the deck-log line)."""
    if not body_text:
        return {}
    for line in body_text.split("\n"):
        line = line.strip()
        if line.startswith("{"):
            try:
                detail = json.loads(line)
                cause = (detail.get("data") or {}).get("cause") or {}
                return {
                    "event_kind": detail.get("kind"),
                    "origin": detail.get("origin"),
                    "wf_id": detail.get("wf_id"),
                    "n2k_path": cause.get("path"),
                    "n2k_state": cause.get("state"),
                    "device_message": cause.get("device_message"),
                    "n2k_source": cause.get("source"),
                }
            except (json.JSONDecodeError, TypeError):
                pass
    return {}


@router.get("/notifications")
def list_notifications(severity: str | None = None, since: str | None = None, until: str | None = None,
                       simulated: bool = True, q: str | None = None,
                       limit: int = 500) -> list[dict[str, Any]]:
    """WF-807: the notification journal - every engine event (N2K alarms, BMS alerts, mode changes, etc.)
    with its position stamp and parsed notification detail, filterable by severity/date/text."""
    entries = data.list_log_entries(kind="event", since=since, until=until,
                                   include_simulated=simulated, limit=limit)
    if severity:
        sev_set = {s.strip().upper() for s in severity.split(",")}
        entries = [e for e in entries if (e.get("severity") or "").upper() in sev_set]
    stamps = data.get_log_stamps([e["entry_id"] for e in entries])
    out = []
    for e in entries:
        detail = _parse_notification_detail(e.get("body"))
        if q:
            needle = q.lower()
            haystack = " ".join(str(v) for v in [e.get("title"), e.get("body"),
                                                  detail.get("n2k_path"), detail.get("device_message")] if v).lower()
            if needle not in haystack:
                continue
        rec: dict[str, Any] = {
            "entry_id": e["entry_id"], "entry_ref": e["entry_ref"],
            "occurred_at": e["occurred_at"], "title": e["title"],
            "severity": e.get("severity"), "simulated": e.get("simulated", False),
            "record": e.get("record"),
        }
        rec.update(detail)
        st = stamps.get(e["entry_id"]) or {}
        rec["lat"] = st.get("lat")
        rec["lon"] = st.get("lon")
        rec["mode"] = st.get("mode")
        rec["sog_kn"] = st.get("sog_kn")
        out.append(rec)
    return out
