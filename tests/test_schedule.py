"""
Purpose: Tests for the 8-bucket schedule projection (backend/scheduling.py) - bucket
    boundaries, never-done baselines, deferral, critical, and what drops off the board.
Version: v1 (2026-09-24)
Scope: PRODUCTION - mx-inv test suite (hardening plan phase 1).
Architecture: Builds tasks through data.py on a per-test database, then reads
    scheduling.schedule_snapshot() - the same function GET /api/schedule returns.
"""
from __future__ import annotations

import pytest

import data
from backend import scheduling
from helpers import d, days_task, system, write


def _where(snap: dict, task_id: int) -> set[str]:
    return {name for name, rows in snap["buckets"].items() if any(r["task_id"] == task_id for r in rows)}


def _row(snap: dict, task_id: int) -> dict:
    return next(r for r in snap["all_projected"] if r["task_id"] == task_id)


@pytest.mark.parametrize("days_ago, period, bucket", [
    (30, 30, "today"),     # due exactly today
    (29, 30, "week"),      # 1 day left
    (23, 30, "week"),      # 7 days left
    (22, 30, "month"),     # 8 days left
    (0, 31, "month"),      # 31 days left
    (0, 32, "quarter"),    # 32 days left
    (0, 92, "quarter"),
    (31, 30, "overdue"),   # 1 day late
])
def test_days_task_bucket_boundaries(db, days_ago, period, bucket):
    tid = days_task(period=period, last_done=d(-days_ago))
    snap = scheduling.schedule_snapshot()
    assert _where(snap, tid) == {bucket}
    assert _row(snap, tid)["days_remaining"] == period - days_ago


def test_beyond_a_quarter_is_on_no_board(db):
    tid = days_task(period=93, last_done=d(0))
    assert _where(scheduling.schedule_snapshot(), tid) == set()


def test_never_done_counts_from_90_days_ago(db):
    tid = days_task(period=30)
    row = _row(scheduling.schedule_snapshot(), tid)
    assert row["never_done"] is True
    assert row["formatted_last_done"] == ""
    assert row["days_remaining"] == 30 - 90


def test_never_done_with_schedule_from_counts_from_that_day(db):
    tid = days_task(period=30, schedule_from=d(-10))
    row = _row(scheduling.schedule_snapshot(), tid)
    assert row["never_done"] is True
    assert row["days_remaining"] == 20


def test_deferring_an_overdue_task_counts_from_today(db):
    # tracker #68: +10 on a task 5 days overdue lands it 10 days from TODAY
    tid = days_task(period=30, last_done=d(-35))
    data.defer_task(tid, 10)
    row = _row(scheduling.schedule_snapshot(), tid)
    assert row["days_remaining"] == 10
    assert row["deferred_days"] == 15          # offset from the undeferred due point
    assert row["original_due_date"] == d(-5)


def test_deferring_a_task_not_yet_due_pushes_past_its_due_date(db):
    tid = days_task(period=30, last_done=d(-20))
    data.defer_task(tid, 10)
    assert _row(scheduling.schedule_snapshot(), tid)["days_remaining"] == 20


def test_critical_is_only_the_overdue_flagged_subset(db):
    late = days_task("Late", period=30, last_done=d(-40), critical=True)
    soon = days_task("Soon", period=30, last_done=d(-25), critical=True)
    routine = days_task("Routine", period=30, last_done=d(-40))
    snap = scheduling.schedule_snapshot()
    assert _where(snap, late) == {"critical", "overdue"}
    assert _where(snap, soon) == {"week"}
    assert _where(snap, routine) == {"overdue"}
    # critical first within a bucket
    assert [r["task_id"] for r in snap["buckets"]["overdue"]][0] == late


def test_break_fix_urgency(db):
    system("Engine")
    now = data.create_task("Engine", "Leak", period="immediate", interval_type="break_fix")
    urgent = data.create_task("Engine", "Squeak", period="urgent", interval_type="break_fix")
    routine = data.create_task("Engine", "Scuff", period="routine", interval_type="break_fix")
    snap = scheduling.schedule_snapshot()
    assert _where(snap, now) == {"overdue"}
    assert _where(snap, urgent) == {"week"}
    assert _where(snap, routine) == {"month"}


def test_completed_break_fix_moves_to_history(db):
    system("Engine")
    tid = data.create_task("Engine", "Leak", period="immediate", interval_type="break_fix")
    data.complete_task(tid, d(0))
    snap = scheduling.schedule_snapshot()
    assert _where(snap, tid) == set()
    assert any(r["task_id"] == tid for r in snap["history"])


def test_use_task_is_on_the_checklists_tab(db):
    cid = data.create_checklist("Departure")
    assert _where(scheduling.schedule_snapshot(), cid) == {"checklists"}


def test_hours_task_without_meter_reading(db):
    system("Engine")
    tid = data.create_task("Engine", "Impeller", period="250", interval_type="hrs",
                           task_kind="recurring", hours_meter="engine")
    snap = scheduling.schedule_snapshot()
    assert _where(snap, tid) == {"hours"}
    assert _row(snap, tid)["days_remaining"] == 9999


def test_hours_task_projects_from_the_meter(db):
    system("Engine")
    tid = data.create_task("Engine", "Impeller", period="250", interval_type="hrs",
                           task_kind="recurring", hours_meter="engine")
    data.set_hours_reading("engine", 1000.0)
    data.set_task_hours_baseline(tid, 900.0)
    row = _row(scheduling.schedule_snapshot(), tid)
    assert "150 h left" in row["calculated_due_date"]


def test_parked_retired_and_subtasks_drop_off(db):
    parked = days_task("Parked", period=30, last_done=d(-40))
    pid = data.create_project("Haul-out", kind="haul_out")
    data.set_task_project(parked, pid)            # project is 'planned' -> parked
    retired = days_task("Retired", period=30, last_done=d(-40))
    data.retire_task(retired, "sold the widget")
    cid = data.create_checklist("Departure")
    step = data.add_checklist_step(cid, "Close seacocks")
    snap = scheduling.schedule_snapshot()
    for tid in (parked, retired, step):
        assert _where(snap, tid) == set(), tid
    assert snap["meta"]["parked_count"] == 1
    assert snap["meta"]["retired_count"] == 1
    assert snap["meta"]["subtask_count"] == 1
    # parked still gets a projected due date for the Projects tab
    assert _row(snap, parked)["days_remaining"] == -10


def test_unretire_puts_it_back(db):
    tid = days_task(period=30, last_done=d(-40))
    data.retire_task(tid)
    data.unretire_task(tid)
    assert _where(scheduling.schedule_snapshot(), tid) == {"overdue"}


def test_schedule_endpoint_matches(example_client):
    r = example_client.get("/api/schedule")
    assert r.status_code == 200
    body = r.json()
    assert set(body["buckets"]) == {"critical", "overdue", "today", "week", "month",
                                    "quarter", "hours", "checklists"}
    assert body["meta"]["active_count"] > 0
