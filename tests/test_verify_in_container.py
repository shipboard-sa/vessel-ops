"""
Purpose: Tests for Work a Container's "verified here" tick (data.verify_in_container, POST /api/audits/{id}/verify):
    a lasting audit_lines record in the open audit, no stock change, lots-only items not duplicated, un-tick only
    removes a pure verification, and list_items(container_id) reports last_verified_on.
Version: v2 (2026-10-08) - v2: move_to_unassigned (the finish step). v1 (2026-10-08)
Scope: PRODUCTION - mx-inv test suite.
Architecture: data.py functions + the audits router on a per-test database (conftest db / client), raw-SQL
    read-back via helpers.
Invocation: .venv/Scripts/python -m pytest tests/test_verify_in_container.py
"""
from __future__ import annotations

import pytest

import data
from helpers import container, d, one, part


def _stock_snapshot(item: int) -> list[tuple]:
    from helpers import sql
    return [tuple(r) for r in sql(
        "SELECT stock_id, container_id, quantity, expiry_date FROM stock WHERE item_id = ? ORDER BY stock_id", (item,))]


def test_tick_writes_lasting_audit_line_and_leaves_stock_alone(db):
    item, bin_ = part(), container()
    data.add_stock(item, bin_, 3)
    before = _stock_snapshot(item)
    aid = data.create_audit("Walk")
    r = data.verify_in_container(aid, item, bin_)
    assert r["verified"] and r["quantity"] == 3
    assert _stock_snapshot(item) == before
    assert one("SELECT COUNT(*) FROM stock_movements WHERE audit_id = ?", (aid,)) == 0
    assert one("SELECT counted_qty FROM audit_lines WHERE audit_id = ? AND item_id = ?", (aid, item)) == 3
    row = data.list_items(container_id=bin_).to_dict("records")[0]
    assert row["last_verified_on"] == d(0)
    # closing the audit keeps the record and stamps the container as audited
    data.close_audit(aid)
    assert data.list_items(container_id=bin_).to_dict("records")[0]["last_verified_on"] == d(0)
    assert one("SELECT last_audited_on FROM storage_containers WHERE container_id = ?", (bin_,)) == d(0)


def test_lots_only_item_is_not_duplicated(db):
    item, bin_ = part(), container()
    data.add_stock(item, bin_, 1, expiry_date=d(100))
    data.add_stock(item, bin_, 2, expiry_date=d(200))
    before = _stock_snapshot(item)
    aid = data.create_audit("Walk")
    assert data.verify_in_container(aid, item, bin_)["quantity"] == 3
    assert _stock_snapshot(item) == before


def test_untick_removes_only_a_pure_verification(db):
    item, other, bin_ = part(), part("Impeller"), container()
    data.add_stock(item, bin_, 2)
    data.add_stock(other, bin_, 5)
    aid = data.create_audit("Walk")
    data.verify_in_container(aid, item, bin_)
    data.verify_in_container(aid, item, bin_, verified=False)
    assert one("SELECT COUNT(*) FROM audit_lines WHERE audit_id = ? AND item_id = ?", (aid, item)) == 0
    data.record_count(aid, other, bin_, 4)          # a real count with a discrepancy
    data.verify_in_container(aid, other, bin_, verified=False)
    assert one("SELECT counted_qty FROM audit_lines WHERE audit_id = ? AND item_id = ?", (aid, other)) == 4


def test_refused_without_open_audit_or_stock(db):
    item, bin_ = part(), container()
    aid = data.create_audit("Walk")
    with pytest.raises(ValueError):
        data.verify_in_container(aid, item, bin_)   # nothing stowed here
    data.add_stock(item, bin_, 1)
    data.abandon_audit(aid)
    with pytest.raises(ValueError):
        data.verify_in_container(aid, item, bin_)   # audit no longer in progress


def test_api_verify(client):
    item, bin_ = part(), container()
    data.add_stock(item, bin_, 1)
    aid = data.create_audit("Walk")
    r = client.post(f"/api/audits/{aid}/verify", json={"item_id": item, "container_id": bin_})
    assert r.status_code == 200 and r.json()["verified"] is True, r.text
    rows = client.get("/api/items", params={"container_id": bin_}).json()
    assert rows[0]["last_verified_on"] == d(0)
    data.abandon_audit(aid)
    r = client.post(f"/api/audits/{aid}/verify", json={"item_id": item, "container_id": bin_})
    assert r.status_code == 409 and "not in progress" in r.json()["detail"]


# ---- v2: the finish step - un-ticked items move to Unassigned (data.move_to_unassigned) ----

def test_move_plain_lots_and_home_rows_to_unassigned(db):
    bin_ = container()
    plain, lots, home = part(), part("Impeller"), part("Belt")
    data.add_stock(plain, bin_, 2)
    data.add_stock(plain, None, 1)                       # Unassigned already has 1 -> merge
    data.add_stock(lots, bin_, 1, expiry_date=d(100))
    data.add_stock(lots, bin_, 2, expiry_date=d(200))
    data.add_stock(home, bin_, 0)                        # "lives here", nothing on hand
    un = data._unassigned_container_id()
    total_before = one("SELECT SUM(quantity) FROM stock")
    r = data.move_to_unassigned(bin_, [plain, lots, home])
    assert r == {"moved_items": 2, "moved_rows": 3, "homes_cleared": 1}
    assert one("SELECT COUNT(*) FROM stock WHERE container_id = ?", (bin_,)) == 0
    assert one("SELECT quantity FROM stock WHERE item_id = ? AND container_id = ?", (plain, un)) == 3
    assert one("SELECT COUNT(*) FROM stock WHERE item_id = ? AND container_id = ?", (lots, un)) == 2
    assert one("SELECT SUM(quantity) FROM stock") == total_before     # moved, nothing lost
    assert one("SELECT ROUND(SUM(delta), 6) FROM stock_movements WHERE reason = 'transfer'") == 0
    assert one("SELECT COUNT(*) FROM audit_lines") == 0


def test_move_is_all_or_nothing(db):
    bin_ = container()
    a, b = part(), part("Impeller")
    data.add_stock(a, bin_, 2)
    with pytest.raises(ValueError):
        data.move_to_unassigned(bin_, [a, b])            # b has no stock here
    assert one("SELECT quantity FROM stock WHERE item_id = ? AND container_id = ?", (a, bin_)) == 2


def test_api_move_to_unassigned(client):
    bin_, item = container(), part()
    data.add_stock(item, bin_, 4)
    r = client.post("/api/items/move-to-unassigned", json={"container_id": bin_, "item_ids": [item]})
    assert r.status_code == 200 and r.json()["moved_items"] == 1, r.text
    assert client.get("/api/items", params={"container_id": bin_}).json() == []
