"""
Purpose: Tests for the maintenance history - complete_task, void, the append-only triggers,
    past service records, invoices on file (cost OR document), follow-ons, delete vs retire.
Version: v1 (2026-09-24)
Scope: PRODUCTION - mx-inv test suite (hardening plan phase 1).
Architecture: data.py functions on a per-test database, with raw-SQL read-back (helpers.sql)
    and raw-SQL attacks on the triggers - the history's rules live in the schema, so the
    tests go around the app to prove it.
"""
from __future__ import annotations

import sqlite3

import pytest

import data
from helpers import container, d, days_task, one, part, sql, system, write


def test_complete_resets_clock_and_logs_timing(db):
    tid = days_task(period=30, last_done=d(-35))
    data.defer_task(tid, 3)
    res = data.complete_task(tid, d(0), notes="  changed it  ", performed_by="Owner")
    t = sql("SELECT last_completed_date, deferred_units FROM tasks WHERE task_id = ?", (tid,))[0]
    assert t["last_completed_date"] == d(0) and t["deferred_units"] == 0
    c = sql("SELECT * FROM task_completions WHERE completion_id = ?", (res["completion_id"],))[0]
    assert c["source"] == "schedule"
    assert c["previous_completed_on"] == d(-35)
    assert c["notes"] == "changed it" and c["performed_by"] == "Owner"
    assert c["days_past_due"] == res["days_past_due"]
    assert c["due_on"] is not None


def test_consumption_draws_undated_first_then_earliest_expiry(db):
    tid = days_task()
    item = part("Zinc")
    bin_ = container()
    undated = data.add_stock(item, bin_, 1)
    late = data.add_stock(item, bin_, 2, expiry_date=d(300))
    early = data.add_stock(item, bin_, 2, expiry_date=d(100))
    res = data.complete_task(tid, d(0), [{"item_id": item, "quantity": 2}])
    assert [t["stock_id"] for t in res["consumed"]] == [undated, early]
    assert res["shortfalls"] == []
    left = {r["stock_id"]: r["quantity"] for r in sql("SELECT stock_id, quantity FROM stock WHERE item_id = ?", (item,))}
    assert left[undated] == 0          # plain row stays as the item's home
    assert left[early] == 1
    assert left[late] == 2
    moves = sql("SELECT delta, reason, task_id FROM stock_movements WHERE item_id = ? AND delta < 0", (item,))
    assert sorted(m["delta"] for m in moves) == [-1, -1]
    assert {m["reason"] for m in moves} == {"task_consume"} and {m["task_id"] for m in moves} == {tid}
    parts = sql("SELECT item_id, quantity FROM task_completion_parts WHERE completion_id = ?", (res["completion_id"],))
    assert [(p["item_id"], p["quantity"]) for p in parts] == [(item, 2)]


def test_consumption_shortfall_is_reported_not_negative(db):
    tid = days_task()
    item = part()
    data.add_stock(item, container(), 1)
    res = data.complete_task(tid, d(0), [{"item_id": item, "quantity": 3}])
    assert res["shortfalls"][0]["short_by"] == pytest.approx(2)
    assert one("SELECT MIN(quantity) FROM stock WHERE item_id = ?", (item,)) == 0
    # the history records what the user SAID was used
    assert one("SELECT quantity FROM task_completion_parts WHERE completion_id = ?", (res["completion_id"],)) == 3


def test_nothing_consumed_unless_asked(db):
    tid = days_task()
    item = part()
    data.set_task_item_link(tid, item, 1)      # linked as needed - still not drawn unless asked
    data.add_stock(item, container(), 5)
    data.complete_task(tid, d(0))
    assert one("SELECT SUM(quantity) FROM stock WHERE item_id = ?", (item,)) == 5


def test_void_latest_restores_previous_date(db):
    tid = days_task(last_done=d(-40))
    first = data.complete_task(tid, d(-10))["completion_id"]
    second = data.complete_task(tid, d(0))["completion_id"]
    assert data.void_completion(second, "wrong day") == {"restored": True}
    assert one("SELECT last_completed_date FROM tasks WHERE task_id = ?", (tid,)) == d(-10)
    assert data.void_completion(first, "also wrong") == {"restored": True}
    assert one("SELECT last_completed_date FROM tasks WHERE task_id = ?", (tid,)) == d(-40)


def test_void_older_entry_only_marks_it(db):
    tid = days_task()
    first = data.complete_task(tid, d(-10))["completion_id"]
    data.complete_task(tid, d(0))
    assert data.void_completion(first, "dup") == {"restored": False}
    assert one("SELECT last_completed_date FROM tasks WHERE task_id = ?", (tid,)) == d(0)


def test_void_needs_reason_and_happens_once(db):
    cid = data.complete_task(days_task(), d(0))["completion_id"]
    with pytest.raises(ValueError):
        data.void_completion(cid, "  ")
    data.void_completion(cid, "x")
    with pytest.raises(ValueError):
        data.void_completion(cid, "again")


@pytest.mark.parametrize("stmt", [
    "UPDATE task_completions SET notes = 'rewritten' WHERE completion_id = ?",
    "UPDATE task_completions SET completed_on = '2000-01-01' WHERE completion_id = ?",
    "DELETE FROM task_completions WHERE completion_id = ?",
])
def test_history_is_append_only_at_the_sql_level(db, stmt):
    cid = data.complete_task(days_task(), d(0))["completion_id"]
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        write(stmt, (cid,))


def test_completion_parts_are_append_only(db):
    tid, item = days_task(), part()
    data.add_stock(item, container(), 2)
    cid = data.complete_task(tid, d(0), [{"item_id": item, "quantity": 1}])["completion_id"]
    with pytest.raises(sqlite3.IntegrityError):
        write("UPDATE task_completion_parts SET quantity = 9 WHERE completion_id = ?", (cid,))
    with pytest.raises(sqlite3.IntegrityError):
        write("DELETE FROM task_completion_parts WHERE completion_id = ?", (cid,))


def test_historical_record_never_reschedules(db):
    tid = days_task(sys_name="Rigging", last_done=d(-5))
    cid = data.add_historical_record(system="Rigging", what_was_done="Re-stepped mast",
                                     completed_on=d(-400), vendor="Yard", cost=1200.0)
    c = sql("SELECT * FROM task_completions WHERE completion_id = ?", (cid,))[0]
    assert c["source"] == "historical" and c["task_id"] is None
    assert c["due_on"] is None and c["days_past_due"] is None and c["interval_type"] is None
    assert one("SELECT last_completed_date FROM tasks WHERE task_id = ?", (tid,)) == d(-5)


def test_historical_record_needs_a_real_system(db):
    with pytest.raises(ValueError):
        data.add_historical_record(system="No such system", what_was_done="x", completed_on=d(0))


def test_cost_or_document_never_both(db):
    system("Hull")
    doc = data.create_document(vendor="Yard", doc_number="42", doc_date=d(-30), total=500.0)
    costed = data.add_historical_record(system="Hull", what_was_done="Paint", completed_on=d(-30), cost=100.0)
    with pytest.raises(ValueError):
        data.set_completion_document(costed, doc)
    with pytest.raises(ValueError):
        data.add_historical_record(system="Hull", what_was_done="x", completed_on=d(-30), cost=1.0, document_id=doc)
    # and the trigger holds even if the app is bypassed
    with pytest.raises(sqlite3.IntegrityError, match="never both"):
        write("UPDATE task_completions SET document_id = ? WHERE completion_id = ?", (doc, costed))


def test_filing_moving_detaching_an_entry(db):
    system("Hull")
    a = data.create_document(vendor="Yard", doc_number="1", doc_date=d(-30), total=10.0)
    b = data.create_document(vendor="Yard", doc_number="2", doc_date=d(-20), total=20.0)
    cid = data.add_historical_record(system="Hull", what_was_done="Paint", completed_on=d(-30))
    data.set_completion_document(cid, a)
    data.set_completion_document(cid, b)
    assert one("SELECT document_id FROM task_completions WHERE completion_id = ?", (cid,)) == b
    with pytest.raises(ValueError):
        data.delete_document(b)          # refused while something is filed under it
    data.set_completion_document(cid, None)
    data.delete_document(b)


def test_voided_entry_cannot_be_filed(db):
    system("Hull")
    doc = data.create_document(vendor="Yard", doc_number="1", doc_date=d(-30), total=10.0)
    cid = data.add_historical_record(system="Hull", what_was_done="Paint", completed_on=d(-30))
    data.void_completion(cid, "typo")
    with pytest.raises(ValueError):
        data.set_completion_document(cid, doc)


def test_follow_ons_point_back_at_the_job(db):
    tid = days_task(sys_name="Engine")
    res = data.complete_task(tid, d(0), outcome="problem_found",
                             follow_ons=[{"task_name": "Replace hose"}])
    (fid,) = res["follow_on_task_ids"]
    t = sql("SELECT system, origin_completion_id FROM tasks WHERE task_id = ?", (fid,))[0]
    assert t["origin_completion_id"] == res["completion_id"] and t["system"] == "Engine"
    assert one("SELECT outcome FROM task_completions WHERE completion_id = ?", (res["completion_id"],)) == "problem_found"


def test_bad_outcome_writes_nothing(db):
    tid = days_task(last_done=d(-5))
    with pytest.raises(ValueError):
        data.complete_task(tid, d(0), outcome="meh")
    assert one("SELECT COUNT(*) FROM task_completions") == 0
    assert one("SELECT last_completed_date FROM tasks WHERE task_id = ?", (tid,)) == d(-5)


def test_delete_refused_once_there_is_history_retire_instead(db):
    tid = days_task()
    data.complete_task(tid, d(0))
    with pytest.raises(ValueError, match="retire"):
        data.delete_task(tid)
    data.retire_task(tid, "gone")
    assert one("SELECT retired_reason FROM tasks WHERE task_id = ?", (tid,)) == "gone"


def test_delete_allowed_with_no_history(db):
    tid = days_task()
    data.delete_task(tid)
    assert one("SELECT COUNT(*) FROM tasks WHERE task_id = ?", (tid,)) == 0
