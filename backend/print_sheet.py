"""print_sheet.py - the print-on-demand sheet for one checklist (tracker #49).

Purpose: builds ONE standalone HTML page for a checklist, laid out to print on a single letter
    page (a laminate-ready operational card: blank tick boxes, a Date / Completed-by line).
Version: v3 (2026-09-24) - v3: boat name comes from Settings (blank = omitted), not hard-coded. v2 shows a step's parts / tools (its task_items) on the card; v1 (2026-09-20)
Scope: PRODUCTION - mx-inv backend; replaces the retired root-level checklist_print.py /
    export_checklists_print.py (Streamlit-era).
Architecture: Called by backend/routers/tasks.py (`GET /api/tasks/{id}/checklist/print`); the
    React ChecklistSteps header's "Print" button opens that URL in a new tab and the user uses the
    browser's Print / Save as PDF. Reads through data.get_checklist_items (steps AND linked tasks,
    in the on-screen order) and expands checklists it includes (a link to another checklist)
    inline, so the card is the whole procedure. Nothing is stored; every print is built fresh.

Design (the owner, 2026-09-20): print on demand, regular operational checklists (not the long
    commissioning / lay-up books). READABLE first, one page where that is possible: a few lines
    of inline JavaScript shrink the sheet's font only down to 85% to fit one page; a card that
    cannot (Engine Start) stays at full size and runs to a second page (print front and back).
    A "Force one page" toggle gives the old small-print behaviour (shrink to 60%, then two
    columns, then drop the how-to notes). The page has a screen-only toolbar (Print, a "how-to
    notes" toggle, Letterhead, Force one page, and what the fit chose). Tick boxes are always blank - a
    laminated card is a reusable template checked off with a dry-erase marker. There is no
    version / freshness machinery: the owner reprints when a change warrants it, so the footer is just
    "As of dd mmm yy" (the date printed).
"""
from __future__ import annotations

import base64
import html
from pathlib import Path
from typing import Any

import data


def _boat_name() -> str:
    """The boat name from Settings (blank until the owner sets it)."""
    return data.get_settings()["vessel_name"]


# The bow name artwork (colour version, Artwork/Name Decal -small.jpg, 1000x322 - swapped in 2026-09-21; needs a backend restart to load), embedded as a data: URI so the printed page
# stays one standalone file. Missing file = no letterhead (the sheet still prints).
_DECAL = Path(__file__).with_name("assets") / "name_decal.jpg"
_DECAL_URI = (
    "data:image/jpeg;base64," + base64.b64encode(_DECAL.read_bytes()).decode("ascii")
    if _DECAL.exists() else None
)

MAX_INCLUDE_DEPTH = 3  # a checklist including one that includes one ... stops here

# Printable box on a US-letter page with 0.6in margins, in CSS px (96 per inch): 7.3in x 9.8in.
_CSS = """
@page { size: letter; margin: 0.6in; }
* { box-sizing: border-box; }
body { margin: 0; color: #111; background: #e5e7eb;
       font-family: "Segoe UI", Arial, Helvetica, sans-serif; }
.toolbar { position: sticky; top: 0; z-index: 5; display: flex; gap: 1rem; align-items: center;
           flex-wrap: wrap; padding: 0.6rem 1rem; background: #0f172a; color: #e2e8f0; font-size: 14px; }
.toolbar button { font-size: 15px; padding: 0.4rem 0.9rem; cursor: pointer; }
.toolbar .fit { color: #94a3b8; }
.page { width: 7.3in; margin: 0.4in auto; padding: 0; background: #fff;
        box-shadow: 0 0 10px rgba(0,0,0,.25); }
#sheet { --s: 1; font-size: calc(12pt * var(--s)); line-height: 1.28; width: 7.3in; padding: 0; }
#sheet.cols2 .body { column-count: 2; column-gap: 0.3in; }
h1 { font-size: 1.7em; margin: 0 0 0.1em; }
.letterhead { display: flex; align-items: center; justify-content: space-between; gap: 0.8em;
              border-bottom: 2px solid #111; padding-bottom: 0.25em; margin-bottom: 0.35em; }
.letterhead img { width: 14em; height: auto; display: block; flex: 0 0 auto; }
.letterhead h1 { margin: 0; text-align: right; flex: 1 1 auto; }
#sheet.noletterhead .letterhead { border-bottom: 0; padding-bottom: 0; margin-bottom: 0; }
#sheet.noletterhead .letterhead img { display: none; }
#sheet.noletterhead .letterhead h1 { text-align: left; margin-bottom: 0.1em; }
.source { font-size: 0.75em; font-style: italic; color: #444; margin: 0 0 0.3em; }
.runsheet { font-size: 0.88em; color: #333; border-top: 1px solid #999; border-bottom: 1px solid #999;
            padding: 0.25em 0; margin-bottom: 0.5em; }
.runsheet span { display: inline-block; margin-right: 1.6em; }
.fill { display: inline-block; border-bottom: 1px solid #333; min-width: 5em; height: 1em; }
.group-header { font-size: 1.08em; font-weight: 700; margin: 0.7em 0 0.25em; padding-bottom: 0.08em;
                border-bottom: 2px solid #111; break-after: avoid; }
.group-header.incl { border-bottom-style: dashed; }
.body > .group-header:first-child { margin-top: 0.1em; }
.step { display: flex; align-items: flex-start; gap: 0.5em; margin-bottom: 0.4em; break-inside: avoid; }
.box { flex: 0 0 auto; width: 1.15em; height: 1.15em; border: 0.12em solid #111; margin-top: 0.05em; }
.step-title { font-weight: 700; }
.step-detail { font-size: 0.84em; color: #333; margin-top: 0.05em; }
#sheet.nonotes .step-detail { display: none; }
.footer { margin-top: 0.6em; font-size: 0.7em; color: #777; border-top: 1px solid #ccc; padding-top: 0.25em; }
@media print {
  body { background: #fff; }
  .toolbar { display: none; }
  .page { margin: 0; box-shadow: none; width: auto; }
}
"""

# Shrinks #sheet's font size until it fits ONE printable page (9.8in tall); if it will not fit
# in one column even small, tries two columns; last resort, drops the how-to notes. Re-fits
# when the notes toggle changes and just before printing.
_JS = """
(function () {
  var LIMIT = 9.8 * 96;              // printable height in px (letter, 0.6in margins)
  var sheet = document.getElementById('sheet');
  var status = document.getElementById('fit');
  var notes = document.getElementById('notes');
  function height() { return sheet.getBoundingClientRect().height; }
  function tryFit(minScale) {
    for (var s = 1; s >= minScale - 1e-9; s -= 0.02) {
      sheet.style.setProperty('--s', s.toFixed(2));
      if (height() <= LIMIT) return s;
    }
    return 0;
  }
  var FLOOR = 0.85;                  // never shrink below this in the default (readable) mode
  var force = document.getElementById('force');
  function pagesAt(s) {              // steps never split across a page, so allow a little slack
    sheet.style.setProperty('--s', s.toFixed(2));
    return Math.max(1, Math.ceil(height() * 1.04 / LIMIT));
  }
  function fitOnePage() {            // the "force one page" mode: shrink, then two columns, then hide notes
    sheet.classList.remove('cols2');
    var s = tryFit(0.6), how = '';
    if (!s) { sheet.classList.add('cols2'); s = tryFit(0.5); how = ', two columns'; }
    if (!s && notes.checked) {
      notes.checked = false; sheet.classList.add('nonotes'); sheet.classList.remove('cols2');
      s = tryFit(0.6); how = ', how-to notes hidden to fit';
      if (!s) { sheet.classList.add('cols2'); s = tryFit(0.5); how += ', two columns'; }
    }
    if (!s) { sheet.style.setProperty('--s', '0.5'); status.textContent = 'Too long for one page even at 50% - it will run onto a second page.'; return; }
    status.textContent = 'Forced onto one page at ' + Math.round(s * 100) + '%' + how + '.';
  }
  // Default (readable) mode (2026-09-20): keep the text readable (>= 85%). One page if it fits at
  // that size; otherwise full size flowing onto a second page (print front and back) - never tiny text.
  function fit() {
    sheet.classList.remove('cols2');
    if (force.checked) { fitOnePage(); return; }
    var s = tryFit(FLOOR);
    if (s) { status.textContent = 'One page at ' + Math.round(s * 100) + '%.'; return; }
    var pages = pagesAt(1.0), scale = 1.0;
    if (pages > 2) { pages = pagesAt(FLOOR); scale = FLOOR; }
    status.textContent = pages + ' pages at ' + Math.round(scale * 100) + '% (readable size)' +
      (pages === 2 ? ' - print front and back.' : ' - long checklist; tick "Force one page" for a small-print card.');
  }
  force.addEventListener('change', fit);
  notes.addEventListener('change', function () { sheet.classList.toggle('nonotes', !notes.checked); fit(); });
  var lh = document.getElementById('letterhead');
  if (lh) lh.addEventListener('change', function () { sheet.classList.toggle('noletterhead', !lh.checked); fit(); });
  window.addEventListener('beforeprint', fit);
  document.getElementById('print').addEventListener('click', function () { fit(); window.print(); });
  fit();
})();
"""


def _as_of(iso_day: str) -> str:
    """'2026-09-20' -> '20 Sep 26' (the owner's footer format: dd mmm yy)."""
    months = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    y, m, d = (int(p) for p in iso_day[:10].split("-"))
    return f"{d:02d} {months[m - 1]} {y % 100:02d}"


def _esc(value: object) -> str:
    return html.escape(str(value)) if value is not None else ""


def _checklist_row(checklist_id: int) -> dict[str, Any] | None:
    with data.connect() as conn:
        row = conn.execute(
            "SELECT task_id, task_name, caution_notes FROM tasks "
            "WHERE task_id = ? AND task_kind = 'checklist'", (checklist_id,),
        ).fetchone()
    return dict(row) if row else None


def _detail(item: dict[str, Any]) -> str:
    return ((item.get("caution_notes") or "").strip() or (item.get("task_description") or "").strip())


def _step_items(task_id: int) -> str:
    """One line naming the parts / tools / supplies a step needs (its task_items rows), or ''.
    v2 (2026-09-21): shown on the card under the step, with the how-to notes."""
    with data.connect() as conn:
        rows = conn.execute(
            "SELECT i.item_name, ti.quantity_required, ti.amount_note FROM task_items ti "
            "JOIN items i ON i.item_id = ti.item_id WHERE ti.task_id = ? ORDER BY i.item_name COLLATE NOCASE",
            (task_id,),
        ).fetchall()
    bits = []
    for r in rows:
        qty = r["quantity_required"]
        label = r["item_name"]
        if r["amount_note"]:
            label += f" ({r['amount_note']})"
        elif qty not in (None, 0, 1, 1.0):
            label += f" x{qty:g}"
        bits.append(label)
    return "; ".join(bits)


def _included_ids(checklist_id: int) -> list[int]:
    """Checklists this one includes (a kind='task' link to a checklist), in reference order -
    the same block the checklist screen shows above its own steps."""
    return [
        r["ref_task_id"] for r in data.get_task_references(checklist_id)
        if r["kind"] == "task" and r.get("ref_task_kind") == "checklist"
        and r["ref_task_id"] not in (None, checklist_id)
    ]


def _section_html(checklist_id: int, *, depth: int, seen: set[int], counter: list[int]) -> str:
    """The steps (grouped like the screen) of one checklist, preceded by every checklist it
    includes as its own headed block. ``seen`` stops a reference loop; ``counter[0]`` counts lines."""
    if checklist_id in seen or depth > MAX_INCLUDE_DEPTH:
        return ""
    seen.add(checklist_id)
    out: list[str] = []
    for inc in _included_ids(checklist_id):
        row = _checklist_row(inc)
        if row is None or inc in seen:
            continue
        out.append(f'<div class="group-header incl">{_esc(row["task_name"])}</div>')
        out.append(_section_html(inc, depth=depth + 1, seen=seen, counter=counter))
    for group_name, group_items in data.group_checklist_steps(data.get_checklist_items(checklist_id)):
        if group_name:
            out.append(f'<div class="group-header">{_esc(group_name)}</div>')
        for item in group_items:
            counter[0] += 1
            detail = _detail(item)
            out.append('<div class="step"><div class="box"></div><div>')
            out.append(f'<div class="step-title">{_esc(item.get("task_name"))}</div>')
            if detail:
                out.append(f'<div class="step-detail">{_esc(detail)}</div>')
            needs = _step_items(item["task_id"]) if item.get("task_id") is not None else ""
            if needs:
                out.append(f'<div class="step-detail step-parts">&#128297; Needs: {_esc(needs)}</div>')
            out.append("</div></div>")
    return "\n".join(out)


def render_checklist_sheet(checklist_id: int, *, today: str | None = None) -> str | None:
    """The full print page for a checklist, or None if it is not a checklist."""
    checklist = _checklist_row(checklist_id)
    if checklist is None:
        return None
    counter = [0]
    body = _section_html(checklist_id, depth=0, seen=set(), counter=counter)
    name = _esc(checklist["task_name"])
    source = (checklist.get("caution_notes") or "").strip()
    printed = _as_of(today or data._today())  # the app's local-date helper (not the server's UTC clock)
    boat = _esc(_boat_name())
    return "\n".join([
        "<!doctype html>",
        '<html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        f"<title>{name}</title>",
        f"<style>{_CSS}</style></head><body>",
        '<div class="toolbar">',
        '<button id="print" type="button">🖨️ Print</button>',
        '<label><input id="notes" type="checkbox" checked> Show how-to notes</label>',
        '<label><input id="letterhead" type="checkbox" checked> Letterhead</label>' if _DECAL_URI else "",
        '<label><input id="force" type="checkbox"> Force one page (smaller text)</label>',
        '<span id="fit" class="fit"></span>',
        "</div>",
        '<div class="page"><div id="sheet">',
        '<div class="letterhead">'
        + (f'<img src="{_DECAL_URI}" alt="{boat}">' if _DECAL_URI else "")
        + f"<h1>{name}</h1></div>",
        f'<p class="source">{_esc(source)}</p>' if source else "",
        '<div class="runsheet"><span>Date: <span class="fill"></span></span>'
        '<span>Completed by: <span class="fill"></span></span></div>',
        f'<div class="body">{body}</div>',
        f'<div class="footer">{boat + " - " if boat else ""}As of {printed} - tick boxes are blank; use a dry-erase '
        "marker and wipe between runs.</div>",
        f"</div></div><script>{_JS}</script></body></html>",
    ])
