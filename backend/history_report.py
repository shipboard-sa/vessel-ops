"""history_report.py - the printable maintenance-history ("CARFAX") report (tracker #44).

Purpose: builds ONE standalone HTML page telling the service story of the whole vessel, or of
    one system, or of one device - every history entry the app holds, in chronological order,
    with what was done, by whom, how late it was, the spares used and the notes.
Version: v6 (2026-09-24) - v6: boat name comes from Settings (blank = omitted), not hard-coded. v5: an entry's EVENT KIND (haul-out, survey, grounding, ...;
    plain service is not badged) and its evidence path (photo / PDF on disk) are shown. v4 (2026-09-22) - v4: an entry's OUTCOME ("problem found" / "partly done") and how many
    follow-on tasks it raised (open vs closed) are badged. v3: with cost opted in, each entry says which invoice it was paid
    under and an "Invoices on file" section lists the invoices (schema v33 documents), each
    total once, never apportioned. v2 prints the DEVICE'S OWN IDENTITY (make/model, installed on,
    serial, warranty - schema v32) above its service events, so the report says which physical
    unit the story is about. v1 (2026-09-22): first version.
Scope: PRODUCTION - mx-inv backend.
Architecture: Called by backend/routers/reports.py (`GET /api/report/history`); the Log tab's
    "Printable report" button opens that URL in a new tab and the user uses the browser's
    Print / Save as PDF. Reads through data.list_completions (the same append-only
    task_completions trail the Log tab shows, including source='historical' backfill entries)
    and data.list_systems for the tree. Nothing is stored; every report is built fresh.

Design (the owner, 2026-09-19, "remember CARFAX report"):
  * CHRONOLOGICAL, oldest first, within each device - a service history reads as a story, the
    way a vehicle history report does. (The in-app Log tab stays newest-first; that answers a
    different question, "what happened lately".)
  * Every entry says where it came from. A ticked completion and a typed-in historical record
    are both facts, but they are not the same KIND of fact, and a surveyor should be able to
    tell them apart at a glance.
  * VOIDED entries are shown, struck through, with the reason. Hiding them would make the
    report a summary of the trail rather than the trail itself - the append-only rule exists
    precisely so that corrections are visible.
  * COST AND VENDOR ARE OFF BY DEFAULT (the privacy question the owner raised 2026-09-16 and left
    open): `?cost=1` opts in. What the boat had done is a different disclosure from what the
    boat's owner paid, and the second one should never leave the laptop by accident. WHO did
    the work (`performed_by`) always shows - that is the maintenance fact; the vendor line,
    which carries the invoice reference, rides with cost behind the opt-in.
  * Nothing is invented. A field the trail does not hold for an entry is simply absent - a
    historical backfill has no due date, no meter reading and no lateness, and the report
    must not imply otherwise.
"""
from __future__ import annotations

import base64
import datetime as dt
import html
from pathlib import Path
from typing import Any

import data


def _boat_name() -> str:
    """The boat name from Settings (blank until the owner sets it)."""
    return data.get_settings()["vessel_name"]


# Same bow-name artwork the checklist print sheet uses, embedded so the report stays one
# standalone file you can email or archive. Missing file = no letterhead, report still prints.
_DECAL = Path(__file__).with_name("assets") / "name_decal.jpg"
_DECAL_URI = (
    "data:image/jpeg;base64," + base64.b64encode(_DECAL.read_bytes()).decode("ascii")
    if _DECAL.exists() else None
)

_MONTHS = ("JAN", "FEB", "MAR", "APR", "MAY", "JUN",
           "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")

_CSS = """
@page { size: letter; margin: 0.6in; }
* { box-sizing: border-box; }
body { margin: 0; color: #111; background: #e5e7eb;
       font-family: "Segoe UI", Arial, Helvetica, sans-serif; }
.toolbar { position: sticky; top: 0; z-index: 5; display: flex; gap: 1rem; align-items: center;
           flex-wrap: wrap; padding: 0.6rem 1rem; background: #0f172a; color: #e2e8f0; font-size: 14px; }
.toolbar button { font-size: 15px; padding: 0.4rem 0.9rem; cursor: pointer; }
.toolbar a { color: #93c5fd; }
.page { width: 7.3in; margin: 0.4in auto; padding: 0.1in 0; background: #fff;
        box-shadow: 0 0 10px rgba(0,0,0,.25); font-size: 10.5pt; line-height: 1.35; }
.letterhead { display: flex; align-items: center; justify-content: space-between; gap: 0.8em;
              border-bottom: 2px solid #111; padding-bottom: 0.4em; margin-bottom: 0.6em; }
.letterhead img { width: 13em; height: auto; display: block; flex: 0 0 auto; }
.letterhead h1 { margin: 0; text-align: right; flex: 1 1 auto; font-size: 1.5em; }
.scope { color: #444; margin: 0 0 0.2em; }
.summary { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 0.5em 0.7em; margin: 0 0 1em; }
.summary dl { display: grid; grid-template-columns: auto 1fr; gap: 0.15em 0.8em; margin: 0; }
.summary dt { color: #475569; }
.summary dd { margin: 0; font-weight: 600; }
h2 { font-size: 1.15em; margin: 1.1em 0 0.1em; border-bottom: 1px solid #94a3b8;
     padding-bottom: 0.1em; break-after: avoid; }
h3 { font-size: 1em; margin: 0.7em 0 0.2em; color: #334155; break-after: avoid; }
.entry { border-left: 3px solid #cbd5e1; padding: 0.25em 0 0.25em 0.6em; margin: 0 0 0.45em;
         break-inside: avoid; }
.entry.historical { border-left-color: #b45309; }
.entry.voided { opacity: 0.65; }
.entry.voided .what { text-decoration: line-through; }
.entry .when { font-weight: 600; }
.entry .dtg { color: #64748b; font-family: Consolas, "Courier New", monospace; font-size: 0.85em; }
.entry .what { font-weight: 600; }
.badge { display: inline-block; font-size: 0.72em; text-transform: uppercase; letter-spacing: .04em;
         border: 1px solid #94a3b8; border-radius: 3px; padding: 0 0.35em; color: #475569;
         vertical-align: 0.1em; }
.badge.historical { border-color: #b45309; color: #b45309; }
.badge.late { border-color: #b91c1c; color: #b91c1c; }
.badge.critical { border-color: #7c2d12; color: #7c2d12; }
.identity { margin: 0.1em 0 0.4em; color: #334155; font-size: 0.92em; }
.identity .expired { color: #b91c1c; }
.meta { color: #475569; font-size: 0.92em; }
.meta span + span::before { content: " · "; color: #94a3b8; }
.note { margin: 0.15em 0 0; }
.parts { margin: 0.15em 0 0; padding-left: 1.1em; }
.parts li { font-size: 0.92em; }
.void-reason { color: #b91c1c; font-size: 0.9em; }
.empty { color: #64748b; font-style: italic; }
.footer { border-top: 1px solid #94a3b8; margin-top: 1.2em; padding-top: 0.4em;
          color: #475569; font-size: 0.85em; }
@media print { .toolbar { display: none; } body { background: #fff; }
               .page { width: auto; margin: 0; box-shadow: none; } }
"""


def _esc(value: object) -> str:
    return html.escape("" if value is None else str(value))


def _dtg(recorded_at: str | None) -> str:
    """Military date-time group from the stored UTC timestamp, e.g. 192215ZSEP26.

    the owner asked for this alongside the local date (#44). The timestamp has always been
    stored; only the formatting was missing.
    """
    if not recorded_at:
        return ""
    try:
        stamp = dt.datetime.strptime(recorded_at[:19], "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return ""
    return f"{stamp.day:02d}{stamp.hour:02d}{stamp.minute:02d}Z{_MONTHS[stamp.month - 1]}{stamp.year % 100:02d}"


def _pretty_day(iso_day: str | None) -> str:
    if not iso_day:
        return ""
    try:
        return dt.date.fromisoformat(iso_day).strftime("%d %b %Y")
    except ValueError:
        return str(iso_day)


def _identity_html(row: dict[str, Any] | None) -> str:
    """A device's own identity line - what it IS, above what has been done to it.

    A vehicle history report opens with the VIN and the model year; without this a
    per-device report is a list of events with nothing saying which unit they happened to.
    Every field is optional and simply absent when unrecorded (schema v32 shipped empty -
    most of it comes off nameplates at the audit walk), so a device with nothing known
    prints no line at all rather than a row of dashes.
    """
    if not row:
        return ""
    bits: list[str] = []
    if row.get("make_model"):
        bits.append(_esc(row["make_model"]))
    if row.get("installed_qty") and int(row["installed_qty"]) > 1:
        bits.append(f"x{int(row['installed_qty'])} installed")
    if row.get("installed_on"):
        bits.append(f"installed {_esc(_pretty_day(row['installed_on']))}")
    if row.get("serial"):
        bits.append(f"s/n {_esc(row['serial'])}")
    if row.get("warranty_until"):
        bits.append(_warranty_phrase(row["warranty_until"]))
    if not bits:
        return ""
    return f'<p class="identity">{" &middot; ".join(bits)}</p>'


def _warranty_phrase(until: str) -> str:
    """warranty to 14 Mar 2027 / warranty expired 2 Jan 2025 - stated as of the print date,
    because a report is read long after it is made and a bare "in warranty" would age into
    a lie."""
    try:
        end = dt.date.fromisoformat(until)
    except ValueError:
        return f"warranty {_esc(until)}"
    if end < dt.date.today():
        return f'<span class="expired">warranty expired {_pretty_day(until)}</span>'
    return f"warranty to {_pretty_day(until)}"


def _lateness(entry: dict[str, Any]) -> str:
    """How late it was, in the words the Log tab uses. Absent when there was no schedule
    to be late against - which is every historical backfill and every break/fix task."""
    days = entry.get("days_past_due")
    hours = entry.get("hours_past_due")
    if days is not None:
        d = int(days)
        if d > 0:
            return f"{d} d late"
        if d < 0:
            return f"{-d} d early"
        return "on time"
    if hours is not None and float(hours) > 0:
        return f"{float(hours):g} h past due"
    return ""


# v4: how the job went (schema v32 column, captured from v34). 'done_ok' / not stated print nothing.
_OUTCOME_BADGE = {"problem_found": "problem found", "partial": "partly done"}
_EVENT_KIND_LABEL = {"grounding": "grounding", "survey": "survey", "haul_out": "haul-out",
                     "modification": "modification", "incident": "incident"}


def _entry_html(entry: dict[str, Any], *, include_cost: bool) -> str:
    historical = entry.get("source") == "historical"
    voided = bool(entry.get("voided_at"))
    classes = "entry" + (" historical" if historical else "") + (" voided" if voided else "")

    badges = []
    if historical:
        badges.append('<span class="badge historical">recorded from records</span>')
    if entry.get("was_critical"):
        badges.append('<span class="badge critical">critical</span>')
    kind = entry.get("event_kind")
    if kind in _EVENT_KIND_LABEL:
        badges.append(f'<span class="badge">{_EVENT_KIND_LABEL[kind]}</span>')
    outcome = entry.get("outcome")
    if outcome in _OUTCOME_BADGE:
        badges.append(f'<span class="badge late">{_OUTCOME_BADGE[outcome]}</span>')
    follow = entry.get("follow_ons") or []
    if follow:
        open_n = sum(1 for f in follow if not f.get("done") and not f.get("retired"))
        badges.append(f'<span class="badge">{len(follow)} follow-on task(s)'
                      f'{f", {open_n} open" if open_n else ", all closed"}</span>')
    late = _lateness(entry)
    if late and late != "on time":
        cls = "badge late" if late.endswith(("late", "past due")) else "badge"
        badges.append(f'<span class="{cls}">{_esc(late)}</span>')

    meta: list[str] = []
    if entry.get("performed_by"):
        # WHO did the work is the substance of a service history and always shows. The
        # vendor line (which carries the invoice reference) rides with cost behind the
        # opt-in, because that pair is the commercial disclosure, not the maintenance fact.
        meta.append(f"by {_esc(entry['performed_by'])}")
    if include_cost and entry.get("vendor"):
        meta.append(_esc(entry["vendor"]))
    if entry.get("project_name"):
        meta.append(f"project: {_esc(entry['project_name'])}")
    if entry.get("evidence_path"):
        meta.append(f"evidence on file: {_esc(entry['evidence_path'])}")
    # Meter readings only for work that is actually scheduled on run hours. Both meters are
    # captured on EVERY completion, so on a calendar task they are just "what the meters read
    # that day" - identical across every entry ticked the same afternoon, and actively silly
    # on a passport renewal. They stay in the trail; they do not belong in the story.
    if entry.get("interval_type") == "hrs" or entry.get("hours_at_completion") is not None:
        if entry.get("hours_at_completion") is not None:
            meta.append(f"at {float(entry['hours_at_completion']):g} h on the meter")
        if entry.get("engine_hours") is not None:
            meta.append(f"engine {float(entry['engine_hours']):g} h")
        if entry.get("genset_hours") is not None:
            meta.append(f"genset {float(entry['genset_hours']):g} h")
    if include_cost and entry.get("cost") is not None:
        meta.append(f"cost ${float(entry['cost']):,.2f}")
    if include_cost and entry.get("document_id") is not None:
        num = f" #{entry['document_number']}" if entry.get("document_number") else ""
        meta.append(f"paid under {_esc(entry.get('document_vendor'))}{_esc(num)}")

    parts = entry.get("parts") or []
    parts_html = ""
    if parts:
        lines = []
        for p in parts:
            qty = p.get("quantity")
            qty_txt = f"{float(qty):g} {_esc(p.get('unit') or '')}".strip() if qty is not None else ""
            pn = f" (p/n {_esc(p['part_number'])})" if p.get("part_number") else ""
            lines.append(f"<li>{qty_txt + ' ' if qty_txt else ''}{_esc(p.get('item_name'))}{pn}</li>")
        parts_html = f'<ul class="parts">{"".join(lines)}</ul>'

    note = entry.get("notes")
    return "".join([
        f'<div class="{classes}">',
        f'<div><span class="when">{_esc(_pretty_day(entry.get("completed_on")))}</span> ',
        f'<span class="dtg">{_esc(_dtg(entry.get("recorded_at")))}</span></div>',
        f'<div><span class="what">{_esc(entry.get("task_name"))}</span> {" ".join(badges)}</div>',
        f'<div class="meta">{"".join(f"<span>{m}</span>" for m in meta)}</div>' if meta else "",
        f'<p class="note">{_esc(note)}</p>' if note else "",
        parts_html,
        (f'<div class="void-reason">VOIDED: {_esc(entry.get("void_reason") or "no reason given")}</div>'
         if voided else ""),
        "</div>",
    ])


def _invoices_html(entries: list[dict[str, Any]], *, whole_vessel: bool) -> str:
    """The invoices behind this history (schema v33) - only ever called with cost opted in.

    For a system / device report: the invoices its entries are filed under. For the whole
    vessel: every invoice on file, including ones with no work filed (money out, nothing
    received is part of the story too). Totals are each invoice's own total, stated once; an
    invoice covering many jobs is never apportioned, so a per-device figure is deliberately
    absent. Headed "invoices on file" - the bank statement is the financial authority."""
    if whole_vessel:
        docs = data.list_documents()
    else:
        ids = {e["document_id"] for e in entries if e.get("document_id") is not None
               and not e.get("voided_at")}
        docs = [d for d in data.list_documents() if d["document_id"] in ids]
    if not docs:
        return ""
    docs.sort(key=lambda d: (str(d.get("doc_day") or ""), d["document_id"]))
    rows = []
    for d in docs:
        when = d.get("doc_date") or " – ".join(
            _pretty_day(x) for x in (d.get("period_start"), d.get("period_end")) if x)
        if d.get("doc_date"):
            when = _pretty_day(when)
        total = "" if d.get("total") is None else f"${float(d['total']):,.2f}"
        num = f" #{d['doc_number']}" if d.get("doc_number") else ""
        filed = d.get("completion_count") or 0
        rows.append(
            f'<div class="entry"><div><span class="when">{_esc(when)}</span> '
            f'<span class="what">{_esc(d["vendor"])}{_esc(num)}</span> {_esc(total)}</div>'
            f'<div class="meta">'
            + "".join(f"<span>{_esc(m)}</span>" for m in (
                d.get("expense_class"), d.get("project_name") and f"project: {d['project_name']}",
                f"{filed} job(s) filed" if filed else "no work filed under it") if m)
            + "</div>"
            + (f'<p class="note">{_esc(d["notes"])}</p>' if d.get("notes") else "")
            + "</div>")
    return ("<h2>Invoices on file</h2>"
            '<p class="scope">Each invoice once, with its own total; one invoice can cover many '
            "jobs and is never split between them. An index of the paper, not the accounts.</p>"
            + "".join(rows))


def render_history_report(
    *, system: str | None = None, device: str | None = None,
    include_cost: bool = False, today: str | None = None,
) -> str:
    """The full printable history page. ``system`` limits it to one top-level system and its
    devices; ``device`` to one exact device. Neither = the whole vessel."""
    entries = data.list_completions(
        0, 100000, year=None, system=system, device=device,  # days<=0 = all time
    )
    # data.list_completions returns newest-first; a service history reads oldest-first.
    entries = sorted(
        entries,
        key=lambda e: (str(e.get("completed_on") or ""), str(e.get("recorded_at") or ""),
                       e.get("completion_id") or 0),
    )

    systems = {s["name"]: s for s in data.list_systems()}

    def top_of(name: str) -> str:
        row = systems.get(name)
        return (row.get("parent_name") or name) if row else name

    grouped: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for e in entries:
        snapshot = str(e.get("system") or "(unfiled)")
        grouped.setdefault(top_of(snapshot), {}).setdefault(snapshot, []).append(e)

    live = [e for e in entries if not e.get("voided_at")]
    historical_n = sum(1 for e in live if e.get("source") == "historical")
    days = [str(e.get("completed_on")) for e in live if e.get("completed_on")]
    scope = (f"Device: {device}" if device else f"System: {system}" if system else "Whole vessel")
    printed = _pretty_day(today or data._today())

    body: list[str] = []
    for top in sorted(grouped, key=str.casefold):
        body.append(f"<h2>{_esc(top)}</h2>")
        devices = grouped[top]
        if list(devices) == [top]:
            # entries filed directly on a top-level system, no device below it
            body.append(_identity_html(systems.get(top)))
        for dev in sorted(devices, key=str.casefold):
            if dev != top:
                body.append(f"<h3>{_esc(dev)}</h3>")
                body.append(_identity_html(systems.get(dev)))
            body.extend(_entry_html(e, include_cost=include_cost) for e in devices[dev])
    if not body:
        body.append('<p class="empty">No history has been recorded for this scope yet.</p>')
    if include_cost:
        body.append(_invoices_html(entries, whole_vessel=not (system or device)))

    summary = [
        ("Scope", scope),
        ("Service events", str(len(live)) + (f" (+{len(entries) - len(live)} voided)"
                                             if len(entries) != len(live) else "")),
        ("Covering", f"{_pretty_day(min(days))} to {_pretty_day(max(days))}" if days else "—"),
        ("From earlier records", str(historical_n)),
    ]
    summary_html = "".join(f"<dt>{_esc(k)}</dt><dd>{_esc(v)}</dd>" for k, v in summary)

    title = f"Maintenance history - {scope}"
    cost_note = ("" if include_cost else
                 " Costs and vendors are omitted; add <code>&amp;cost=1</code> to the address to include them.")
    return "\n".join([
        "<!doctype html>",
        '<html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        f"<title>{_esc(title)}</title>",
        f"<style>{_CSS}</style></head><body>",
        '<div class="toolbar">',
        '<button id="print" type="button">🖨️ Print / Save as PDF</button>',
        f'<span>{_esc(scope)} — {len(live)} event(s)</span>',
        ('<span>Costs shown</span>' if include_cost else ''),
        "</div>",
        '<div class="page">',
        '<div class="letterhead">'
        + (f'<img src="{_DECAL_URI}" alt="{_esc(_boat_name())}">' if _DECAL_URI else "")
        + "<h1>Maintenance history</h1></div>",
        f'<p class="scope">{_esc(_boat_name()) + " — " if _boat_name() else ""}{_esc(scope)}</p>',
        f'<div class="summary"><dl>{summary_html}</dl></div>',
        *body,
        f'<div class="footer">{_esc(_boat_name()) + " — " if _boat_name() else ""}printed {_esc(printed)}. '
        "Entries are in date order, oldest first. The record is append-only: a correction is a "
        "voided entry (shown struck through, with its reason) plus a new one, never a silent "
        "edit. Entries marked <em>recorded from records</em> were entered from paper or invoices "
        "after the fact and carry no schedule or meter reading."
        + cost_note + "</div>",
        "</div>",
        "<script>document.getElementById('print').addEventListener('click',function(){window.print();});</script>",
        "</body></html>",
    ])
