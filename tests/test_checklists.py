"""
Purpose: Tests for checklists - one shared step/link order, linked-task ticks that are real
    completions, and un-ticks that void rather than blank.
Version: v1 (2026-09-24)
Scope: PRODUCTION - mx-inv test suite (hardening plan phase 1).
Architecture: data.py functions on a per-test database with raw-SQL read-back (helpers.sql).
"""
from __future__ import annotations

import data
from helpers import d, days_task, one, sql, write


def test_steps_are_appended_in_order(db):
    cid = data.create_checklist("Departure")
    ids = [data.add_checklist_step(cid, f"Step {i}") for i in range(3)]
    orders = [one("SELECT sort_order FROM tasks WHERE task_id = ?", (i,)) for i in ids]
    assert orders == sorted(orders) and len(set(orders)) == 3


def test_unnumbered_old_steps_are_numbered_before_a_new_one_lands_last(db):
    cid = data.create_checklist("Departure")
    old = data.add_checklist_step(cid, "Old step")
    write("UPDATE tasks SET sort_order = NULL WHERE task_id = ?", (old,))
    new = data.add_checklist_step(cid, "New step")
    assert one("SELECT sort_order FROM tasks WHERE task_id = ?", (old,)) < \
        one("SELECT sort_order FROM tasks WHERE task_id = ?", (new,))


def test_linked_task_shares_the_numbering(db):
    cid = data.create_checklist("Departure")
    step = data.add_checklist_step(cid, "Close seacocks")
    master = days_task("Check bilge pump", sys_name="Bilge")
    ref = data.add_task_reference(cid, "task", "", ref_task_id=master)
    link_order = one("SELECT sort_order FROM task_references WHERE ref_id = ?", (ref,))
    assert link_order > one("SELECT sort_order FROM tasks WHERE task_id = ?", (step,))
    after = data.add_checklist_step(cid, "Cast off")
    assert one("SELECT sort_order FROM tasks WHERE task_id = ?", (after,)) > link_order


def test_tick_completes_the_master_and_untick_voids_it(db):
    cid = data.create_checklist("Departure")
    master = days_task("Check bilge pump", sys_name="Bilge", last_done=d(-20))
    ref = data.add_task_reference(cid, "task", "", ref_task_id=master)
    res = data.tick_checklist_link(ref, d(0), performed_by="crew member")
    assert res["already"] is False
    assert one("SELECT last_completed_date FROM tasks WHERE task_id = ?", (master,)) == d(0)
    c = sql("SELECT notes, performed_by FROM task_completions WHERE completion_id = ?", (res["completion_id"],))[0]
    assert "Departure" in c["notes"] and c["performed_by"] == "crew member"
    # ticking again is a no-op
    assert data.tick_checklist_link(ref, d(0))["already"] is True
    assert one("SELECT COUNT(*) FROM task_completions WHERE task_id = ?", (master,)) == 1
    data.untick_checklist_link(ref)
    assert one("SELECT last_completed_date FROM tasks WHERE task_id = ?", (master,)) == d(-20)
    assert one("SELECT voided_at IS NOT NULL FROM task_completions WHERE completion_id = ?", (res["completion_id"],)) == 1
    assert one("SELECT done_completion_id FROM task_references WHERE ref_id = ?", (ref,)) is None


def test_reset_checklist_clears_the_run(db):
    cid = data.create_checklist("Departure")
    step = data.add_checklist_step(cid, "Close seacocks")
    data.complete_task(step, d(0))
    data.reset_checklist(cid)
    assert (one("SELECT last_completed_date FROM tasks WHERE task_id = ?", (step,)) or "") == ""
