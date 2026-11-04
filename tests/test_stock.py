"""
Purpose: Tests for stock and storage rules - plain-row merge into a zero "home" row,
    Unassigned resolution, receive (split, all-or-nothing, older_expiry), storage deletes that
    refuse to orphan stock, container moves.
Version: v3 (2026-10-08) - v3: stow results carry moved_between (data.py v49). v2 (2026-09-27) - v2: stow moves out of Unassigned (data.py v43). v1 (2026-09-24)
Scope: PRODUCTION - mx-inv test suite (hardening plan phase 1).
Architecture: data.py functions on a per-test database with raw-SQL read-back (helpers.sql).
"""
from __future__ import annotations

import sqlite3

import pytest

import data
from helpers import container, d, one, part, sql, write


def test_plain_stock_merges_into_the_existing_row(db):
    item, bin_ = part(), container()
    a = data.add_stock(item, bin_, 0)          # a "home" row
    b = data.add_stock(item, bin_, 3)
    c = data.add_stock(item, bin_, 2)
    assert a == b == c
    assert one("SELECT quantity FROM stock WHERE stock_id = ?", (a,)) == 5
    assert one("SELECT COUNT(*) FROM stock_movements WHERE item_id = ?", (item,)) == 2  # none for the 0 row


def test_dated_lots_merge_only_on_the_same_date(db):
    item, bin_ = part(), container()
    a = data.add_stock(item, bin_, 1, expiry_date=d(100))
    b = data.add_stock(item, bin_, 1, expiry_date=d(100))
    c = data.add_stock(item, bin_, 1, expiry_date=d(200))
    assert a == b != c


def test_second_plain_row_is_blocked_by_the_index(db):
    item, bin_ = part(), container()
    data.add_stock(item, bin_, 1)
    with pytest.raises(sqlite3.IntegrityError):
        write("INSERT INTO stock (item_id, container_id, quantity) VALUES (?, ?, 1)", (item, bin_))


def test_no_container_means_unassigned_not_null(db):
    item = part()
    sid = data.add_stock(item, None, 2)
    row = sql("SELECT container_id, compartment_name, location_name FROM v_stock_located WHERE stock_id = ?", (sid,))[0]
    assert row["container_id"] is not None
    assert (row["compartment_name"], row["location_name"]) == (data.UNASSIGNED_COMPARTMENT, data.UNASSIGNED_LOCATION)
    # and a second call reuses the same container
    sid2 = data.receive_stock(item, [{"container_id": None, "quantity": 1}])[0]
    assert sid2 == sid and one("SELECT quantity FROM stock WHERE stock_id = ?", (sid,)) == 3


def test_negative_quantity_refused(db):
    with pytest.raises(ValueError):
        data.add_stock(part(), container(), -1)


def test_receive_splits_across_containers(db):
    item = part("Cheese")
    fridge, freezer = container("Fridge", "refrigerated"), container("Freezer", "frozen")
    ids = data.receive_stock(item, [{"container_id": fridge, "quantity": 1},
                                    {"container_id": freezer, "quantity": 2, "expiry_date": d(90)}],
                             vendor="Market")
    assert len(ids) == 2
    got = {r["container_id"]: r["quantity"] for r in sql("SELECT container_id, quantity FROM stock WHERE item_id = ?", (item,))}
    assert got == {fridge: 1, freezer: 2}


def test_receive_is_all_or_nothing(db):
    item, bin_ = part(), container()
    with pytest.raises(ValueError):
        data.receive_stock(item, [{"container_id": bin_, "quantity": 1},
                                  {"container_id": bin_, "quantity": 0}])
    with pytest.raises(ValueError):
        data.receive_stock(item, [{"container_id": bin_, "quantity": 1},
                                  {"container_id": 99999, "quantity": 1}])
    assert one("SELECT COUNT(*) FROM stock WHERE item_id = ?", (item,)) == 0


def test_receive_dates_older_undated_stock_when_asked(db):
    item, bin_ = part(), container()
    old = data.add_stock(item, bin_, 2)
    data.receive_stock(item, [{"container_id": bin_, "quantity": 1, "expiry_date": d(60)}], older_expiry=d(30))
    assert one("SELECT expiry_date FROM stock WHERE stock_id = ?", (old,)) == d(30)


def test_restock_clears_the_on_list_flag(db):
    item = part()
    data.set_item_on_list(item, True)
    data.add_stock(item, container(), 1)
    assert one("SELECT on_list_since FROM items WHERE item_id = ?", (item,)) is None


def test_storage_delete_refuses_to_orphan_stock(db):
    bin_ = container()
    data.add_stock(part(), bin_, 1)
    with pytest.raises(Exception):
        data.delete_container(bin_)
    assert one("SELECT COUNT(*) FROM storage_containers WHERE container_id = ?", (bin_,)) == 1


def test_moving_a_container_takes_its_stock(db):
    bin_ = container("Bin A")
    item = part()
    data.add_stock(item, bin_, 4)
    comp = data.create_compartment("Test hold")
    new_loc = data.add_location("Port side", comp)
    data.update_container(bin_, location_id=new_loc)
    row = sql("SELECT location_name, quantity FROM v_stock_located WHERE item_id = ?", (item,))[0]
    assert row["location_name"] == "Port side" and row["quantity"] == 4


def test_duplicate_item_name_is_refused(db):
    part("Oil filter")
    with pytest.raises(data.DuplicateItemError):
        data.create_item("oil filter", "part")


def test_unknown_unit_is_refused(db):
    with pytest.raises(data.UnknownUnitError):
        data.create_item("Mystery goo", "supply", unit="furlongs")


# --- v43 (2026-09-27): stowing MOVES stock out of the Unassigned container -------------------

def _unassigned_qty(item: int) -> float:
    return one(
        "SELECT COALESCE(SUM(s.quantity), 0) FROM stock s WHERE s.item_id = ? AND s.container_id = ?",
        (item, data._unassigned_container_id()),
    )


def test_stow_moves_the_whole_unassigned_row_and_keeps_its_purchase_facts(db):
    item, bin_ = part(), container()
    sid = data.add_stock(item, None, 4, acquired_on="2025-03-01", vendor="Amazon", unit_cost=9.5)
    res = data.stow_items(bin_, [{"item_id": item, "quantity": 4}])
    assert res["moved"] == 1
    assert _unassigned_qty(item) == 0
    row = sql("SELECT stock_id, container_id, quantity, acquired_on, vendor, unit_cost FROM stock WHERE item_id = ?", (item,))
    assert len(row) == 1
    r = row[0]
    assert (r["stock_id"], r["container_id"], r["quantity"]) == (sid, bin_, 4)
    assert (r["acquired_on"], r["vendor"], r["unit_cost"]) == ("2025-03-01", "Amazon", 9.5)
    # a move is not new stock: the transfer pair nets to zero
    assert one("SELECT SUM(delta) FROM stock_movements WHERE item_id = ? AND reason = 'transfer'", (item,)) == 0


def test_stow_part_of_the_unassigned_row_leaves_the_rest(db):
    item, bin_ = part(), container()
    data.add_stock(item, None, 4)
    data.stow_items(bin_, [{"item_id": item, "quantity": 1}])
    assert _unassigned_qty(item) == 3
    assert one("SELECT quantity FROM stock WHERE item_id = ? AND container_id = ?", (item, bin_)) == 1
    assert one("SELECT SUM(quantity) FROM stock WHERE item_id = ?", (item,)) == 4


def test_stow_more_than_unassigned_holds_counts_only_the_excess_as_new(db):
    item, bin_ = part(), container()
    data.add_stock(item, None, 2)
    data.stow_items(bin_, [{"item_id": item, "quantity": 5}])
    assert _unassigned_qty(item) == 0
    assert one("SELECT SUM(quantity) FROM stock WHERE item_id = ?", (item,)) == 5
    assert one("SELECT SUM(delta) FROM stock_movements WHERE item_id = ? AND reason = 'restock'", (item,)) == 2 + 3


def test_stow_into_a_container_that_already_holds_it_still_draws_from_unassigned(db):
    item, bin_ = part(), container()
    data.add_stock(item, bin_, 1)
    data.add_stock(item, None, 3)
    res = data.stow_items(bin_, [{"item_id": item, "quantity": 3}])
    assert res == {"added": 0, "merged": 1, "homes": 0, "moved": 1, "moved_between": 0}
    assert _unassigned_qty(item) == 0
    assert one("SELECT quantity FROM stock WHERE item_id = ? AND container_id = ?", (item, bin_)) == 4


def test_stow_without_unassigned_stock_is_unchanged(db):
    item, bin_ = part(), container()
    res = data.stow_items(bin_, [{"item_id": item, "quantity": 2}])
    assert res == {"added": 1, "merged": 0, "homes": 0, "moved": 0, "moved_between": 0}
    assert one("SELECT SUM(delta) FROM stock_movements WHERE item_id = ? AND reason = 'restock'", (item,)) == 2


def test_stow_is_still_all_or_nothing_after_a_move(db):
    item, bin_ = part(), container()
    data.add_stock(item, None, 2)
    with pytest.raises(ValueError):
        data.stow_items(bin_, [{"item_id": item, "quantity": 2}, {"item_id": 999999, "quantity": 1}])
    assert _unassigned_qty(item) == 2


def test_locker_list_filtered_to_a_container_reports_what_it_holds(db):
    item, bin_ = part(), container()
    data.add_stock(item, bin_, 2)
    data.add_stock(item, None, 5)
    rows = data.list_items(container_id=data._unassigned_container_id()).to_dict("records")
    assert [(r["item_id"], r["qty_in_container"]) for r in rows] == [(item, 5)]
    assert "qty_in_container" not in data.list_items().columns
