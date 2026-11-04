"""Schedule projection - the 8-bucket due-date math ported out of the
Streamlit ``app.py`` (that module stays the reference implementation until
the Streamlit app is retired in the cutover phase; keep the two in sync
until then).

Server-side only, by design: the React frontend must not reimplement any
of this in JS. ``GET /api/schedule`` is the single source of truth.

The hrs-task deferral fix (commit ``d6045b8`` on ``master``) is already
folded in here - ``deferred_units`` on an ``hrs`` task holds *hours*, not
days, and is added to the remaining-hours budget in :func:`_project_hours`
rather than discarded.
"""
from __future__ import annotations

import datetime
from typing import Any

import data
from backend.util import clean_nan

# bucket day-count boundaries, matching app.py exactly
_WEEK = (1, 7)
_MONTH = (8, 31)
_QUARTER = (32, 92)


def _project_hours(
    row: dict[str, Any],
    e_hpy: float,
    g_hpy: float,
    hours_now: dict[str, "float | None"],
) -> tuple[int, str, str]:
    """(days_remaining_estimate, due_label, orig_due_label) for an hrs task."""
    meter = row.get("hours_meter")
    try:
        per_h = float(row.get("period"))
    except (TypeError, ValueError):
        per_h = 0.0
    if not meter or per_h <= 0:
        return 9999, "hrs — no meter", "hrs — no meter"
    now_h = hours_now.get(meter)
    done_h = row.get("hours_at_completion")
    if now_h is None:
        return 9999, f"hrs — {meter} hours unknown", "—"
    if done_h is None:
        # never serviced on this meter - needs a baseline before it can be
        # dated. 7777 keeps it out of Overdue but its own tab flags it.
        return 7777, f"⚙️ set a service baseline — {meter} at {now_h:.0f} h", "—"
    # deferred_units on an hrs task holds *hours* (set by the "Defer +N
    # hours" control), not days - fold it into the hours budget rather
    # than discarding it (the bug fixed in d6045b8).
    deferred_h = int(row["deferred_units"]) if row.get("deferred_units") else 0
    left_h = per_h - (now_h - float(done_h)) + deferred_h
    rate = (e_hpy if meter == "engine" else g_hpy) / 365.0
    rem = int(round(left_h / rate)) if rate else 9999
    lbl = f"~{left_h:.0f} h left  (≈ {rem} d)"
    if deferred_h:
        lbl += f"  [deferred +{deferred_h}h]"
    return rem, lbl, f"{float(done_h):.0f} h + {per_h:.0f}"


def _project_row(
    row: dict[str, Any],
    today: datetime.date,
    e_hpy: float,
    g_hpy: float,
    hours_now: dict[str, "float | None"],
) -> dict[str, Any]:
    """Return ``row`` augmented with the projected schedule fields, matching
    the columns ``app.py`` adds to its DataFrame."""
    kind = str(row.get("interval_type") or "").strip().lower()
    period_str = str(row.get("period")).strip()
    deferred = int(row["deferred_units"]) if row.get("deferred_units") else 0

    if kind == "break_fix":
        if "immediate" in period_str.lower():
            rem, due = -5, "⚠️ DROP EVERYTHING"
        elif "urgent" in period_str.lower():
            rem, due = 1, "⏳ Action Urgent"
        else:
            rem, due = 14, "🔧 Routine Repair"
        done_date = today
        never_done = False
        orig_due = due
        deferred = 0
    else:
        # v36: one rule, shared with data.defer_task - last completion, else the task's
        # schedule_from (clock started, e.g. a starter pack's load day), else 90 days ago.
        done_date, never_done = data.task_baseline_date(
            row.get("last_completed_date"), row.get("schedule_from"), today)

        if kind == "days":
            try:
                period_val = float(row["period"]) if row.get("period") else 0.0
            except ValueError:
                period_val = 0.0
            cycle = int(period_val) if period_val > 0 else 30
            base_due = done_date + datetime.timedelta(days=cycle)
            next_due = base_due + datetime.timedelta(days=deferred)
            rem = (next_due - today).days
            due = next_due.strftime("%Y-%m-%d")
            orig_due = base_due.strftime("%Y-%m-%d")
        elif kind == "hrs":
            rem, due, orig_due = _project_hours(row, e_hpy, g_hpy, hours_now)
            # deferred (hours) is already folded into _project_hours' rem -
            # keep the raw value below for the "Deferred Days" column/UI
            # badge, same as the days-kind branch.
        else:
            rem, due = 9999, "Event Driven"
            orig_due = due
            deferred = 0

    out = dict(row)
    out["interval_type_clean"] = kind
    out["days_remaining"] = rem
    out["calculated_due_date"] = due
    out["original_due_date"] = orig_due
    out["deferred_days"] = deferred
    # A never-done task has no real "last done" - its baseline is only an assumption, so the
    # card says "not done yet" instead of printing the assumed date as if it happened.
    out["never_done"] = bool(never_done) and kind != "break_fix"
    out["formatted_last_done"] = "" if out["never_done"] else done_date.strftime("%Y-%m-%d")
    return out


def schedule_snapshot() -> dict[str, Any]:
    """The full 8-bucket board, pre-computed server-side.

    Mirrors ``app.py``'s Maintenance branch filtering: parked tasks (on a
    planned/cancelled project) and subtasks (checklist steps / child tasks)
    drop out of the rolling schedule; completed break/fix tasks move to
    ``history`` instead of ``active``.
    """
    today = datetime.date.today()

    try:
        if data.telemetry_should_sync():
            import telemetry_sync
            telemetry_sync.sync(quiet=True)
    except Exception:  # noqa: BLE001 - telemetry is best-effort, never blocks the schedule
        pass

    hours_now = {m: data.current_hours(m) for m in ("engine", "genset")}
    engine_hpy = data.hours_per_year("engine")
    genset_hpy = data.hours_per_year("genset")

    df_raw = data.load_tasks_dataframe()
    rows = [
        _project_row(r, today, engine_hpy, genset_hpy, hours_now)
        for r in clean_nan(df_raw.to_dict(orient="records"))
    ]

    # Every task with its projected due-date fields, before any bucket
    # filtering - parked tasks (e.g. on a not-yet-active service_period
    # project) still need a real due date for views like the Projects tab's
    # send-out queue, even though they're excluded from the buckets below.
    all_projected = rows

    n_parked = sum(1 for r in rows if r.get("parked")) if rows else 0
    rows = [r for r in rows if not r.get("parked")]

    # v30 / tracker #66: a retired task keeps its master row (so the MX log keeps
    # its thread back to the job) but is done with - it drops out of every bucket,
    # exactly like a parked one.
    n_retired = sum(1 for r in rows if r.get("retired")) if rows else 0
    rows = [r for r in rows if not r.get("retired")]

    n_sub = sum(1 for r in rows if r.get("parent_task_id") is not None)
    rows = [r for r in rows if r.get("parent_task_id") is None]

    def is_completed_break_fix(r: dict[str, Any]) -> bool:
        return (
            r["interval_type_clean"] == "break_fix"
            and bool(str(r.get("last_completed_date") or "").strip())
        )

    active = [r for r in rows if not is_completed_break_fix(r)]
    history = [r for r in rows if is_completed_break_fix(r)]

    crit = [r for r in active if int(r.get("is_critical") or 0) == 1]
    crit_ids = {r["task_id"] for r in crit}

    cal = [r for r in active if r["interval_type_clean"] in ("days", "break_fix")]
    today_b = [r for r in cal if r["days_remaining"] == 0]
    week_b = [r for r in cal if _WEEK[0] <= r["days_remaining"] <= _WEEK[1]]
    month_b = [r for r in cal if _MONTH[0] <= r["days_remaining"] <= _MONTH[1]]
    quarter_b = [r for r in cal if _QUARTER[0] <= r["days_remaining"] <= _QUARTER[1]]
    hours_b = [r for r in active if r["interval_type_clean"] == "hrs"]
    use_b = [r for r in active if r["interval_type_clean"] == "use"]

    overdue_b = [
        r for r in active
        if r["interval_type_clean"] in ("days", "break_fix", "hrs")
        and -9000 < r["days_remaining"] < 0
    ]

    # Critical = a task flagged is_critical (safety / float-the-boat / finish-the-passage)
    # that is OVERDUE right now - i.e. the flagged subset of the Overdue bucket. the owner
    # (2026-09-19): "a critical overdue task is one that really needs to get done now,
    # not a routine task that is just languishing". It used to be every flagged task
    # overdue OR due within 92 days (107 rows, mostly routine and weeks away), which
    # buried the urgent ones and made a just-completed task reappear with its next
    # due date. A flagged as-used ('use') task has no due date to be overdue against, so
    # it is not here; it stays on the As-used tab.
    critical_b = [r for r in overdue_b if r["task_id"] in crit_ids]

    # Within a bucket, surface the most urgent work first: critical tasks
    # before non-critical, then most-overdue/soonest-due first. the owner's ask
    # (2026-09-16) - "some combination of critical and due age" - rather
    # than the prior arbitrary (effectively DB insertion) order.
    for bucket in (critical_b, overdue_b, today_b, week_b, month_b, quarter_b, hours_b, use_b):
        bucket.sort(key=lambda r: (r["task_id"] not in crit_ids, r["days_remaining"]))

    return {
        "generated_at": today.isoformat(),
        "meta": {
            "parked_count": n_parked,
            "retired_count": n_retired,
            "subtask_count": n_sub,
            "active_count": len(active),
        },
        "buckets": {
            "critical": critical_b,
            "overdue": overdue_b,
            "today": today_b,
            "week": week_b,
            "month": month_b,
            "quarter": quarter_b,
            "hours": hours_b,
            "checklists": use_b,
        },
        "history": history,
        "all_projected": all_projected,
    }
