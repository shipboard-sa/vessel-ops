"""Printable reports built server-side and opened in a new browser tab.

Purpose: HTTP surface for the printable reports: the maintenance-history ("CARFAX") report (tracker #44) and
    the ship's log for a day or a passage (logbook, schema v37).
Version: v3 (2026-10-05) - v3: /logbook?passage=<id> (one passage, schema v38). v2 (2026-10-05) - v2: GET /api/report/logbook. v1 (2026-09-22)
Scope: PRODUCTION - mx-inv backend.
Architecture: Mounted by backend/main.py. Renders through backend/history_report.py (data.list_completions /
    data.list_systems) and backend/logbook_report.py (data.list_log_entries / get_log_entry). Returns a standalone HTML page (the user
    prints or saves it as PDF from the browser), not JSON - same pattern as the checklist print
    sheet at /api/tasks/{id}/checklist/print.
Invocation: mounted by backend/main.py; opened from the Log tab and the Ship's Log tab.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

from backend import history_report, logbook_report

router = APIRouter(prefix="/api/report", tags=["reports"])


@router.get("/history", response_class=HTMLResponse)
def history_report_page(
    system: str | None = None,
    device: str | None = None,
    cost: int = 0,
) -> HTMLResponse:
    """The vessel's service history, printable. ``system`` limits to one top-level system and
    its devices, ``device`` to one exact device, neither = the whole boat.

    ``cost=1`` opts INTO showing cost and vendor. They are off by default on purpose: what the
    boat had done is a different disclosure from what the owner paid, and a report is a thing
    that gets emailed (the owner's privacy question, 2026-09-16, still open).
    """
    return HTMLResponse(history_report.render_history_report(
        system=system, device=device, include_cost=bool(cost),
    ))


@router.get("/logbook", response_class=HTMLResponse)
def logbook_report_page(day: str | None = None, to: str | None = None, passage: int | None = None,
                        tests: int = 0) -> HTMLResponse:
    """The ship's log, printable: ``passage`` = one passage (its departure entry id); else ``day`` (YYYY-MM-DD)
    alone = that day, with ``to`` = the whole run of days. Engine TEST events are left out unless ``tests=1``."""
    if passage is not None:
        try:
            return HTMLResponse(logbook_report.render_logbook_report(passage_id=passage, include_tests=bool(tests)))
        except LookupError as e:
            raise HTTPException(404, str(e)) from e
    if not day:
        raise HTTPException(400, "give day=YYYY-MM-DD (and optionally to=), or passage=<id>")
    try:
        dt.date.fromisoformat(day)
        if to:
            dt.date.fromisoformat(to)
    except ValueError as e:
        raise HTTPException(400, "day / to must be YYYY-MM-DD") from e
    return HTMLResponse(logbook_report.render_logbook_report(day_from=day, day_to=to, include_tests=bool(tests)))
