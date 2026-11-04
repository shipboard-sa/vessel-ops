"""
Purpose: WF-803 Post-passage tasks — when a passage ends (arrival logged), scan the passage window
    for EMERGENCY/ALARM (P1/P2) engine events and auto-draft one mx-inv check task per unique alarm
    origin for the crew to review, confirm or dismiss.
Version: v1 (2026-10-30)
Scope: PRODUCTION - mx-inv backend, called from the logbook router on arrival.
Architecture: Reads logbook_entries for engine events during the passage, creates draft tasks via
    data.create_task(). The crew sees these as one-off break_fix tasks and confirms or deletes them.
Invocation: called by backend/routers/logbook.py after a successful arrival; never called standalone.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import data

log = logging.getLogger(__name__)


def draft_post_passage_tasks(passage: dict[str, Any]) -> list[dict[str, Any]]:
    """Given a completed passage (with departed_at, arrived_at, passage_id), query the logbook for
    P1/P2 engine events during that window and create one draft check task per unique alarm origin.

    Returns a list of {task_id, task_name, system, origin, entry_ref} for each created task.
    """
    departed = passage["departed_at"]
    arrived = passage["arrived_at"]
    if not departed or not arrived:
        return []

    # Use arrived_at + 1 second as the upper bound so the arrival entry itself is included
    # in the window (list_log_entries uses < for until)
    events = data.list_log_entries(
        kind="event", since=departed, until=arrived, include_simulated=False, limit=2000,
    )

    alarm_events = [e for e in events if e.get("severity") in ("P1", "P2")]
    if not alarm_events:
        return []

    # Group by origin (from the JSON body) — one task per unique alarm source
    seen_origins: dict[str, dict[str, Any]] = {}
    for ev in alarm_events:
        origin = _extract_origin(ev)
        if origin not in seen_origins:
            seen_origins[origin] = ev

    created = []
    for origin, first_event in seen_origins.items():
        system = _resolve_system(first_event.get("system"))
        sev = first_event.get("severity", "ALARM")
        entry_ref = first_event.get("entry_ref", "")
        msg = first_event.get("title", origin)

        task_name = f"Post-passage check: {msg}"
        if len(task_name) > 200:
            task_name = task_name[:197] + "..."

        count = sum(1 for e in alarm_events if _extract_origin(e) == origin)
        desc_lines = [
            f"WF-803 auto-draft: {sev} alarm fired during passage "
            f"({departed[:16]} to {arrived[:16]}).",
            f"Origin: {origin}",
            f"First occurrence: {entry_ref} — {msg}",
        ]
        if count > 1:
            desc_lines.append(f"Fired {count} times during this passage.")
        desc_lines.append("Review, confirm the check is done, or delete if not needed.")
        description = "\n".join(desc_lines)

        try:
            task_id = data.create_task(
                system=system,
                task_name=task_name,
                description=description,
                period="immediate",
                interval_type="break_fix",
                task_kind="one_off",
            )
            created.append({
                "task_id": task_id,
                "task_name": task_name,
                "system": system,
                "origin": origin,
                "entry_ref": entry_ref,
            })
        except Exception:
            log.exception("WF-803: failed to create task for origin=%r", origin)

    if created:
        log.info("WF-803: drafted %d post-passage check task(s) for passage %s→%s",
                 len(created), departed[:16], arrived[:16])

    return created


def _resolve_system(system_name: str | None) -> str:
    """Resolve the system for a draft task. If the event has a system_name that exists in the
    systems table, use it. Otherwise fall back to a top-level system (one with no parent)."""
    with data.connect() as conn:
        if system_name:
            row = conn.execute("SELECT name FROM systems WHERE name = ?", (system_name,)).fetchone()
            if row:
                return row[0]
        # Fall back to the first top-level system alphabetically
        row = conn.execute("SELECT name FROM systems WHERE parent_name IS NULL ORDER BY name LIMIT 1").fetchone()
        return row[0] if row else "Vessel"


def _extract_origin(event: dict[str, Any]) -> str:
    """Extract the alarm origin from an engine event's body JSON. The body starts with an optional
    deck-log status line, then a JSON object with {kind, origin, wf_id, data}."""
    body = event.get("body") or ""
    # The JSON is after the optional status line — find the first '{'
    idx = body.find("{")
    if idx >= 0:
        try:
            detail = json.loads(body[idx:])
            origin = detail.get("origin") or detail.get("wf_id") or detail.get("kind", "")
            if origin:
                return str(origin)
        except (json.JSONDecodeError, TypeError):
            pass
    # Fallback: use the event title
    return event.get("title", "unknown")
