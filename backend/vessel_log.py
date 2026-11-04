"""Outbound "vessel log" integration - feeds task/checklist completions to
the previous developer's existing `logbook` InfluxDB measurement on `your-pi-hostname`
(wiki.your-pi-hostname.example.com/#/Logbook, live since PR #199-#210).

Deliberately NOT a direct InfluxDB writer. Per the owner (2026-09-16): "let him
broker the writes" - this app should never hold an InfluxDB write token,
even a narrowly-scoped one. Instead this POSTs a small JSON payload to a
webhook the previous developer stands up on his side; he owns turning that into a real
`logbook` point using his own CLI/ingest logic. Until that endpoint exists,
this module is a documented no-op - set VESSEL_LOG_ENABLED=1 and
VESSEL_LOG_ENDPOINT (+ optionally VESSEL_LOG_TOKEN for a bearer header,
a small shared secret scoped to just this integration, not a boat-wide
credential) once it does.

Every call is best-effort: logging failure never blocks or fails the
caller's own task completion, same fail-safe posture as telemetry_sync.

Payload shape mirrors his `logbook` CLI flags as closely as a free-text
maintenance app can (see the wiki page's Schema section):
    entry_type      "maintenance" | "failure" | "observation"
    system          one of his fixed tag values (mapped, see
                     _map_system below - "other" if nothing matches)
    description     free text
    status          "fixed" for everything we send (see NOTE below)
    engine_hours / genset_hours   the actual meter reading at completion,
                     from tasks.hours_at_completion, only when
                     tasks.hours_meter says which meter (an absolute
                     value, e.g. "1245.5", not the recurrence interval)
    next_due_hours / next_due_date   the recurrence interval applied
                     forward one cycle from this completion (period +
                     hours_at_completion, or period days + completed_on) -
                     simple arithmetic, not a call into
                     backend/scheduling.py's full due-date engine (which
                     also accounts for deferrals - this is always the
                     undeferred next cycle, matching what a hand-typed
                     CLI entry would use)
    cost_usd / parts / performed_by   always null - deliberately unwired
                     (the owner, 2026-09-16: cost tracking raises privacy
                     questions to work out later; "who did it" has no
                     crew/roster concept in this app yet, though one
                     exists in the routing project's config/crew.toml
                     and could eventually feed a picklist here)
    source / source_task_id / completed_on   provenance, so a future
                     reconciliation pass can tell an ops-panel-sourced
                     entry from a hand-typed CLI one

NOTE on entry_type: every completion maps to "maintenance" for now,
including break_fix (unscheduled repair) tasks. A break_fix completion is
arguably a "failure" entry that should have opened when the problem was
first noticed, not just logged at fix time - but this app has no
"currently broken, not yet fixed" state to log a failure from earlier.
Flagged as an open gap, not solved here; see the mx-inv-webapp-rewrite
project notes for the fuller discussion.
"""
from __future__ import annotations

import datetime
import os
from typing import Any

import requests

_ENDPOINT = os.environ.get("VESSEL_LOG_ENDPOINT")
_TOKEN = os.environ.get("VESSEL_LOG_TOKEN")
_ENABLED = os.environ.get("VESSEL_LOG_ENABLED", "").strip().lower() in ("1", "true", "yes")
_TIMEOUT_S = 3.0


def is_enabled() -> bool:
    """True when a logbook endpoint is configured (the cockpit hides Break / Incident otherwise)."""
    return bool(_ENABLED and _ENDPOINT)

# Best-effort free-text -> the previous developer's fixed `system` tag values (engine,
# generator, watermaker, refrigeration, electrical, electronics, rigging,
# hull, nav, comms, safety, tankage, plumbing, other). Our tasks.system is
# a free-text catalog (78 distinct values as of schema v12+), his is a
# closed enum - this is necessarily approximate. Refine with the previous developer once
# real entries are flowing and mismatches are visible in his dashboard.
_SYSTEM_KEYWORDS: tuple[tuple[str, str], ...] = (
    ("yanmar", "engine"), ("engine", "engine"), ("propulsion", "engine"),
    ("westerbeke", "generator"), ("genset", "generator"), ("generator", "generator"),
    ("watermaker", "watermaker"), ("seawater pro", "watermaker"),
    ("refrigerat", "refrigeration"), ("freezer", "refrigeration"),
    ("frigoboat", "refrigeration"), ("engel", "refrigeration"),
    ("victron", "electrical"), ("battery", "electrical"), ("solar", "electrical"),
    ("inverter", "electrical"), ("cerbo", "electrical"), ("wiring", "electrical"),
    ("ais", "electronics"), ("radar", "electronics"), ("chartplotter", "electronics"),
    ("autopilot", "electronics"), ("vhf", "electronics"), ("wind ex", "electronics"),
    ("rigging", "rigging"), ("sail", "rigging"), ("winch", "rigging"),
    ("furling", "rigging"), ("mast", "rigging"), ("headsail", "rigging"),
    ("hull", "hull"), ("thru hull", "hull"), ("bonding", "hull"), ("zinc", "hull"),
    ("gps", "nav"), ("compass", "nav"), ("dst 810", "nav"),
    ("starlink", "comms"), ("radio", "comms"),
    ("liferaft", "safety"), ("pfd", "safety"), ("fire", "safety"),
    ("epirb", "safety"), ("jackline", "safety"), ("mob", "safety"),
    ("fuel tank", "tankage"), ("water tank", "tankage"), ("black water", "tankage"),
    ("bilge", "plumbing"), ("head", "plumbing"), ("pump", "plumbing"),
)
# Devices are named by function (the owner, 2026-09-18) - the make/model keywords
# above no longer appear in system names, so map the function names too.
# Kept as a second tuple, checked BEFORE the make/model list, so an old-style
# entry (or a name that still carries a brand) keeps resolving as before.
_FUNCTION_KEYWORDS: tuple[tuple[str, str], ...] = (
    ("main engine", "engine"), ("transmission", "engine"), ("propeller", "engine"),
    ("power electronics", "electrical"), ("power monitoring", "electrical"),
    ("wind sensor", "electronics"), ("transducer", "nav"), ("temperature sensor", "electronics"),
    ("antifouling", "hull"), ("keel-cooled", "refrigeration"), ("fridge", "refrigeration"),
    ("windlass", "rigging"), ("winches", "rigging"), ("inflatable pfd", "safety"),
    ("shower sump", "plumbing"), ("washdown", "plumbing"), ("water filter", "plumbing"),
    ("fuel filter", "engine"),
)


def _map_system(system: str) -> str:
    s = system.lower()
    for keyword, mapped in (*_FUNCTION_KEYWORDS, *_SYSTEM_KEYWORDS):
        if keyword in s:
            return mapped
    return "other"


def _next_due(
    interval_type: str,
    period: str | None,
    completed_on: str,
    hours_at_completion: float | None,
    hours_meter: str | None,
) -> tuple[float | None, str | None]:
    """(next_due_hours, next_due_date) - the recurrence interval applied
    forward one cycle, undeferred. None/None for interval types with no
    fixed cycle (``use``, ``break_fix``) or an unparseable period."""
    if interval_type == "hrs" and hours_meter and hours_at_completion is not None:
        try:
            return hours_at_completion + float(period or ""), None
        except ValueError:
            return None, None
    if interval_type == "days":
        try:
            days = float(period or "")
        except ValueError:
            return None, None
        base = datetime.date.fromisoformat(completed_on)
        return None, (base + datetime.timedelta(days=days)).isoformat()
    return None, None


def log_completion(
    *,
    task_id: int,
    system: str,
    task_name: str,
    task_kind: str,
    interval_type: str,
    completed_on: str,
    hours_at_completion: float | None = None,
    hours_meter: str | None = None,
    period: str | None = None,
    project_name: str | None = None,
) -> None:
    """Fire-and-forget notification that a task/checklist/break-fix item
    was completed. No-ops silently when disabled or unconfigured; swallows
    any request failure - this must never be why a Complete action fails
    in the UI.

    ``project_name``: the project this task belonged to *at the moment it
    was completed*, if any - callers must capture this before calling
    data.complete_task(), not after, because completion detaches a
    `recurring` task from its project as a side effect (see
    data.complete_task's clear_project logic). Per the owner (2026-09-16): no
    separate "finish project" event exists or is wanted - a project's
    progress is just the sum of its tagged task completions, so tagging
    each entry is the whole mechanism.
    """
    if not _ENABLED or not _ENDPOINT:
        return

    entry_type = "maintenance"  # see module docstring NOTE
    description = f"{task_name} ({task_kind})" if task_kind == "checklist" else task_name
    if project_name:
        description = f"{description} [project: {project_name}]"

    next_due_hours, next_due_date = _next_due(
        interval_type, period, completed_on, hours_at_completion, hours_meter,
    )

    payload: dict[str, Any] = {
        "entry_type": entry_type,
        "system": _map_system(system),
        "description": description,
        "status": "fixed",
        "engine_hours": hours_at_completion if hours_meter == "engine" else None,
        "genset_hours": hours_at_completion if hours_meter == "genset" else None,
        "next_due_hours": next_due_hours,
        "next_due_date": next_due_date,
        "cost_usd": None,
        "parts": None,
        "performed_by": None,
        "project": project_name,
        "source": "mx-inv-webapp",
        "source_task_id": task_id,
        "completed_on": completed_on,
    }

    headers = {"Authorization": f"Bearer {_TOKEN}"} if _TOKEN else {}
    try:
        requests.post(_ENDPOINT, json=payload, headers=headers, timeout=_TIMEOUT_S)
    except requests.RequestException:
        pass


def log_incident(
    *,
    entry_type: str,
    system: str,
    description: str,
    occurred_at: str,
) -> None:
    """Fire-and-forget notification of a break/incident logged from the
    cockpit - the cockpit app's "second consumer" of this same webhook per
    the scope doc (Cockpit App - Scope & Architecture, "Broker endpoints"):
    no new endpoint asked of the previous developer for this, just a second call site into
    the one `vessel_log.py` already brokers.

    Unlike ``log_completion()`` this has no source task - there's no
    ops-panel row backing an incident report, it's a raw field entry. Kept
    deliberately thin (no next-due computation, no project tagging) since
    there's nothing in the ops-panel schema to derive those from yet.

    ``entry_type``: "failure" or "observation" (see module docstring NOTE
    on why ``log_completion`` always sends "maintenance" instead - an
    incident logged in the moment is exactly the case that NOTE says this
    app currently can't represent well; this function is the fix for that
    gap, at least for entries that originate underway rather than at
    fix-time).
    ``system``: free text, run through the same ``_map_system`` best-effort
    mapping as completions.

    No-ops silently when disabled or unconfigured; swallows any request
    failure - same fail-safe posture as ``log_completion()``.
    """
    if not _ENABLED or not _ENDPOINT:
        return

    payload: dict[str, Any] = {
        "entry_type": entry_type,
        "system": _map_system(system),
        "description": description,
        "status": "open" if entry_type == "failure" else "fixed",
        "engine_hours": None,
        "genset_hours": None,
        "next_due_hours": None,
        "next_due_date": None,
        "cost_usd": None,
        "parts": None,
        "performed_by": None,
        "project": None,
        "source": "mx-inv-webapp-cockpit",
        "source_task_id": None,
        "completed_on": occurred_at,
    }

    headers = {"Authorization": f"Bearer {_TOKEN}"} if _TOKEN else {}
    try:
        requests.post(_ENDPOINT, json=payload, headers=headers, timeout=_TIMEOUT_S)
    except requests.RequestException:
        pass
