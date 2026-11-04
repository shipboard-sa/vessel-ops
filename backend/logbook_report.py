"""logbook_report.py - the printable ship's log for one day, a run of days, or one passage.

Purpose: builds ONE standalone HTML page of the logbook (schema v37) for a date range - every entry in time
    order, oldest first, with its boat stamp (position, speed, mode, sail set, wind, barometer) and, for a
    failure, its status chain; then the failure register (everything still open) as it stands at print time.
Version: v3 (2026-10-05) - v3 (the owner's review): status changes print on the DAY they happened, tied to their failure; sail-plan and engine lines; rules-engine entries are 'Automation' (Engine = the Yanmar); the stamp line carries the apparent wind angle. v2 (2026-10-05) - v2: ?passage=<id> prints ONE PASSAGE (schema v38: a departure to the next arrival,
    Owner: each leg is a passage) - its window, a passage summary (from / to, departed / arrived, duration, logged
    distance) and the register. v1 (2026-10-05)
Scope: PRODUCTION - mx-inv backend.
Architecture: Called by backend/routers/reports.py (`GET /api/report/logbook`); the desktop Ship's Log tab's
    "Print this day" / "Print these days" buttons open that URL in a new tab and the user prints or saves a PDF.
    Reads data.list_log_entries / data.get_log_entry (the same append-only tables the tab shows) and reuses
    history_report's letterhead and page CSS so the two printouts look like one set. Nothing is stored.
Invocation: imported by backend/routers/reports.py; tests in tests/test_logbook_page.py.

Design (the owner 2026-10-05, "this is the ship's log - no more paper"):
  * Oldest first, grouped by day - a log book reads forward, like the paper one it replaces. (The tab itself
    is newest first; that answers "what happened lately".)
  * A passage = one leg, from a Departure entry to the next Arrival (the owner 10-05, option B); printed by its id.
    A from / to date range still prints any run of days.
  * Engine entries print to the SECOND they fired, crew entries to the minute (the owner 10-05).
  * Engine TEST events (simulated) are left out unless ?tests=1 - a test is not something that happened.
  * Nothing invented: a stamp value the boat did not report is simply absent.
"""
from __future__ import annotations

import datetime as dt
from typing import Any

import data
from backend import deck_log
from backend.history_report import _CSS, _DECAL_URI, _boat_name, _esc, _pretty_day

STATUS_LABEL = {"broke": "Broke", "parts-ordered": "Parts Ordered", "deferred": "Deferred",
                "accepted": "Accepted", "fixed": "Fixed"}
KIND_LABEL = {"failure": "Failure", "observation": "Observation", "incident": "Incident", "watch": "Watch",
              "event": "Automation", "status": "Deck log", "departure": "Departure", "arrival": "Arrival",
              "sail": "Sail plan", "engine": "Engine"}

_LOG_CSS = """
.entry.k-failure { border-left-color: #b91c1c; }
.entry.k-incident { border-left-color: #c2410c; }
.entry.k-observation { border-left-color: #0369a1; }
.entry.k-watch { border-left-color: #15803d; }
.entry.k-event { border-left-color: #6d28d9; }
.entry.k-sail { border-left-color: #0284c7; }
.entry.k-engine { border-left-color: #64748b; }
.entry.k-change { border-left-color: #b91c1c; border-left-style: dotted; font-size: 0.95em; }
.entry.k-departure, .entry.k-arrival { border-left-color: #0f766e; border-left-width: 5px; }
.entry.k-departure .what, .entry.k-arrival .what { font-size: 1.08em; }
.entry.k-status { border-left-color: #e2e8f0; padding-top: 0; padding-bottom: 0; margin-bottom: 0.15em;
                  font-size: 0.9em; color: #334155; }
.entry .body { white-space: pre-wrap; margin: 0.15em 0 0; font-size: 0.95em; }
.entry .stamp { color: #475569; font-size: 0.88em; margin: 0.1em 0 0; }
.chain { margin: 0.15em 0 0; padding-left: 1.1em; font-size: 0.92em; }
.badge.P1 { border-color: #b91c1c; color: #b91c1c; }
.badge.P2 { border-color: #c2410c; color: #c2410c; }
.badge.test { border-color: #a16207; color: #a16207; }
.register td, .register th { text-align: left; padding: 0.15em 0.5em 0.15em 0; vertical-align: top;
                             font-size: 0.92em; }
.register { border-collapse: collapse; width: 100%; }
.register th { border-bottom: 1px solid #94a3b8; color: #475569; }
"""


def _time(e: dict[str, Any]) -> str:
    """HH:MM, or HH:MM:SS for an engine entry (Owner: the firing order of a critical sequence)."""
    t = str(e.get("occurred_at") or "")
    return t[11:19] if e.get("source") == "engine" and len(t) >= 19 else t[11:16]


def _stamp_line(st: dict[str, Any] | None) -> str:
    return deck_log.status_line(st) if st else ""


def _entry_html(e: dict[str, Any]) -> str:
    kind = e["kind"]
    if kind == "status":       # the automatic deck log: one compact line
        return (f'<div class="entry k-status"><span class="dtg">{_esc(_time(e))}</span> '
                f'{_esc(e.get("body") or e["title"])}</div>')
    badges = [f'<span class="badge">{_esc(KIND_LABEL.get(kind, kind))}</span>']
    if e.get("severity") and e["severity"] != "info":
        badges.append(f'<span class="badge {_esc(e["severity"])}">{_esc(e["severity"])}</span>')
    if e.get("simulated"):
        badges.append('<span class="badge test">Test</span>')
    if kind == "failure" and e.get("status"):
        badges.append(f'<span class="badge">{_esc(STATUS_LABEL.get(e["status"], e["status"]))}</span>')
    meta = [f"<span>{_esc(e['entry_ref'])}</span>"]
    if e.get("system"):
        meta.append(f"<span>{_esc(e['system'])}</span>")
    if e.get("author"):
        meta.append(f"<span>by {_esc(e['author'])}</span>")
    if str(e.get("recorded_at") or "")[:16] != str(e.get("occurred_at") or "")[:16] and e.get("source") != "engine":
        meta.append(f"<span>noted {_esc(str(e['recorded_at'])[11:16])}</span>")
    if e.get("follow_on_task_id"):
        meta.append(f"<span>fix task #{_esc(e['follow_on_task_id'])}</span>")
    body = e.get("body") or ""
    if kind == "event":        # the engine's body = deck line + a JSON detail blob; print the line only
        body = "\n".join(ln for ln in body.splitlines() if not ln.lstrip().startswith("{"))
    parts = [f'<div class="entry k-{_esc(kind)}">',
             f'<span class="dtg">{_esc(_time(e))}</span> <span class="what">{_esc(e["title"])}</span> '
             + " ".join(badges),
             f'<div class="meta">{"".join(meta)}</div>']
    if body.strip():
        parts.append(f'<div class="body">{_esc(body.strip())}</div>')
    stamp = _stamp_line(e.get("stamp")) if kind != "event" else ""   # an engine entry's body already has it
    if stamp:
        parts.append(f'<div class="stamp">⚓ {_esc(stamp)}</div>')
    if kind == "failure" and len(e.get("statuses") or []) > 1:
        parts.append('<ul class="chain">' + "".join(
            f"<li>{_esc(str(s['at'])[:16].replace('T', ' '))} {_esc(STATUS_LABEL.get(s['status'], s['status']))}"
            + (f" - {_esc(s['note'])}" if s.get("note") else "") + "</li>" for s in e["statuses"]) + "</ul>")
    parts.append("</div>")
    return "".join(parts)


def _change_html(c: dict[str, Any]) -> str:
    """A failure status change on the day it happened, tied back to its failure (the owner 10-05)."""
    prev, new = STATUS_LABEL.get(c["previous"], c["previous"]), STATUS_LABEL.get(c["status"], c["status"])
    return (f'<div class="entry k-change"><span class="dtg">{_esc(str(c["at"])[11:16])}</span> '
            f'<span class="what">{_esc(c["entry_ref"])} {_esc(c["title"])}: {_esc(prev)} → {_esc(new)}</span> '
            f'<span class="badge">Status</span>'
            + (f'<div class="body">{_esc(c["note"])}</div>' if c.get("note") else "")
            + (f'<div class="meta"><span>by {_esc(c["author"])}</span></div>' if c.get("author") else "")
            + "</div>")


def _register_html(today: str) -> str:
    """Every failure still open (newest status not Fixed / Accepted) - Owner: the register lives on the desktop
    page, not at handover, and it will get long."""
    rows = data.list_log_entries(kind="failure", open_only=True, limit=2000)
    if not rows:
        return '<h2>Failure register</h2><p class="empty">No open failures.</p>'
    order = list(STATUS_LABEL)
    rows.sort(key=lambda r: (order.index(r["status"]) if r["status"] in order else 99, r["occurred_at"]))
    trs = "".join(
        f"<tr><td>{_esc(STATUS_LABEL.get(r['status'], r['status']))}</td><td>{_esc(r['entry_ref'])}</td>"
        f"<td>{_esc(str(r['occurred_at'])[:10])}</td><td>{_esc(r.get('system') or '')}</td>"
        f"<td>{_esc(r['title'])}</td></tr>" for r in rows)
    return (f"<h2>Failure register - open as at {_esc(_pretty_day(today))}</h2>"
            '<table class="register"><tr><th>Status</th><th>Ref</th><th>Since</th><th>System</th><th>What</th></tr>'
            f"{trs}</table>")


def _hours(h: float) -> str:
    d, rem = divmod(round(h * 60), 24 * 60)
    return (f"{d} d " if d else "") + f"{rem // 60} h {rem % 60:02d} min"


def render_logbook_report(*, day_from: str | None = None, day_to: str | None = None, passage_id: int | None = None,
                          include_tests: bool = False, today: str | None = None) -> str:
    """The printable log: one PASSAGE (passage_id = its departure entry), or day_from..day_to inclusive (local days,
    YYYY-MM-DD; one day when day_to is omitted)."""
    passage = data.get_passage(passage_id) if passage_id is not None else None
    if passage:
        since = passage["departed_at"][:16]
        # inclusive of the arrival minute (and any engine second inside it): 'HH:MM' < 'HH:MM:SS' < 'HH:MM:99'
        until = (passage["arrived_at"][:16] + ":99") if passage["arrived_at"] else "9999"
        d0 = dt.date.fromisoformat(since[:10])
        d1 = dt.date.fromisoformat((passage["arrived_at"] or dt.datetime.now().isoformat())[:10])
    else:
        d0 = dt.date.fromisoformat(day_from or data._today())
        d1 = dt.date.fromisoformat(day_to) if day_to else d0
        if d1 < d0:
            d0, d1 = d1, d0
        since, until = d0.isoformat(), (d1 + dt.timedelta(days=1)).isoformat()
    rows = data.list_log_entries(since=since, until=until, include_simulated=include_tests, limit=2000)
    if passage:
        rows = [r for r in rows if data.in_passage(passage, r["entry_id"], r["occurred_at"])]
    rows.sort(key=lambda r: (r["occurred_at"], r["entry_id"]))
    # the list query carries no stamp / status chain - fetch each entry whole (a day is tens of rows)
    full = [data.get_log_entry(r["entry_id"]) for r in rows]

    changes = data.list_status_changes_between(since, until)
    if passage:
        changes = [c for c in changes if c["at"][:16] >= passage["departed_at"][:16]
                   and (not passage["arrived_at"] or c["at"][:16] <= passage["arrived_at"][:16])]
    # one time line per day: entries and status changes together, oldest first
    by_day: dict[str, list[tuple[str, int, str]]] = {}
    for e in full:
        by_day.setdefault(str(e["occurred_at"])[:10], []).append((str(e["occurred_at"]), 0, _entry_html(e)))
    for c in changes:
        by_day.setdefault(str(c["at"])[:10], []).append((str(c["at"]), 1, _change_html(c)))
    body: list[str] = []
    for day in sorted(by_day):
        body.append(f"<h2>{_esc(dt.date.fromisoformat(day).strftime('%A %d %b %Y'))}</h2>")
        body.extend(html for _t, _o, html in sorted(by_day[day], key=lambda x: (x[0][:16], x[1])))
    if not body:
        body.append('<p class="empty">Nothing was logged in this period.</p>')
    printed = today or data._today()
    body.append(_register_html(printed))

    count = lambda k: sum(1 for e in full if e["kind"] == k)  # noqa: E731
    period = _pretty_day(d0.isoformat()) + ("" if d1 == d0 else f" to {_pretty_day(d1.isoformat())}")
    summary: list[tuple[str, str]] = []
    if passage:
        leg = f"{passage['from_port']} → {passage['to_port'] or passage['bound_for']}"
        summary += [("Passage", f"{leg} ({passage['passage_ref']})"),
                    ("Departed", passage["departed_at"][:16].replace("T", " ")),
                    ("Arrived", passage["arrived_at"][:16].replace("T", " ") if passage["arrived_at"]
                     else f"under way (bound for {passage['bound_for']})"),
                    ("Duration", _hours(passage["hours"]) + ("" if passage["arrived_at"] else " so far")),
                    ("Engine hours run", f"{passage['engine_hours_run']:g} h (hour meter at Engine on / off)"
                     if passage.get("engine_hours_run") is not None else "no hour-meter readings logged"),
                    ("Logged distance", f"{passage['distance_nm']} nm (between {passage['fixes']} logged positions"
                                        " - a floor, not the track)" if passage["distance_nm"] is not None
                     else "not enough logged positions")]
        period = f"Passage {leg}"
    summary += [("Period", _pretty_day(d0.isoformat()) + ("" if d1 == d0 else f" to {_pretty_day(d1.isoformat())}")),
               ("Entries", f"{len(full)} ({count('status')} deck log, {count('event')} engine)"),
               ("Failures / incidents / observations", f"{count('failure')} / {count('incident')} / "
                                                         f"{count('observation')}"),
               ("Watch handovers", str(count("watch")))]
    if not include_tests:
        summary.append(("Engine test events", "left out (add &tests=1 to the address to include them)"))
    summary_html = "".join(f"<dt>{_esc(k)}</dt><dd>{_esc(v)}</dd>" for k, v in summary)
    boat = _boat_name()
    title = f"Ship's log - {period}"
    return "\n".join([
        "<!doctype html>",
        '<html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        f"<title>{_esc(title)}</title>",
        f"<style>{_CSS}{_LOG_CSS}</style></head><body>",
        '<div class="toolbar">',
        '<button id="print" type="button">🖨️ Print / Save as PDF</button>',
        f"<span>{_esc(period)} — {len(full)} entr{'y' if len(full) == 1 else 'ies'}</span>",
        "</div>",
        '<div class="page">',
        '<div class="letterhead">'
        + (f'<img src="{_DECAL_URI}" alt="{_esc(boat)}">' if _DECAL_URI else "")
        + "<h1>Ship's log</h1></div>",
        f'<p class="scope">{_esc(boat) + " — " if boat else ""}{_esc(period)}</p>',
        f'<div class="summary"><dl>{summary_html}</dl></div>',
        *body,
        f'<div class="footer">{_esc(boat) + " — " if boat else ""}printed {_esc(_pretty_day(printed))}. '
        "Times are boat local; engine entries to the second they fired, crew entries to the minute. "
        "The log is append-only: a failure's progress is its chain of status updates, a correction is a new "
        "entry, never an edit. ⚓ lines are what the boat's instruments said at that moment.</div>",
        "</div>",
        "<script>document.getElementById('print').addEventListener('click',function(){window.print();});</script>",
        "</body></html>",
    ])

