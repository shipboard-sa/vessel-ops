"""
Purpose: Tests for stow_items' per-line "move" / "extra" modes (data.py v49, the owner 2026-10-08: an item already stowed
    in another container is either MOVED from there or ADDED as extra stock here - no default): a move takes plain
    then lots oldest-first, keeps lot identity, refuses more than is there, conserves the total; extra is logged as
    found aboard (not a restock) and leaves the shopping-list flag; no mode = unchanged behaviour.
Version: v1 (2026-10-08)
Scope: PRODUCTION - mx-inv test suite.
Architecture: data.py functions + POST /api/items/stow on a per-test database (conftest db / client), raw-SQL
    read-back via helpers.
Invocation: .venv/Scripts/python -m pytest tests/test_stow_modes.py
"""
from __future__ import annotations

import pytest

import data
from helpers import container, d, one, part, sql


def _qty(item: int, cont: int) -> float:
    return one("SELECT COALESCE(SUM(quantity), 0) FROM stock WHERE item_id = ? AND container_id = ?", (item, cont))


def test_move_takes_plain_then_oldest_lot_and_conserves(db):
    port, here, item = container("Port"), container("Here"), part()
    data.add_stock(item, port, 2)
    data.add_stock(item, port, 3, expiry_date=d(200))
    data.add_stock(item, port, 1, expiry_date=d(50))
    total = one("SELECT SUM(quantity) FROM stock WHERE item_id = ?", (item,))
    restocks = one("SELECT COUNT(*) FROM stock_movements WHERE item_id = ? AND reason = 'restock'", (item,))
    r = data.stow_items(here, [{"item_id": item, "quantity": 4, "mode": "move", "from_container_id": port}])
    assert r["moved_between"] == 1
    assert one("SELECT SUM(quantity) FROM stock WHERE item_id = ?", (item,)) == total
    assert _qty(item, here) == 4 and _qty(item, port) == 2
    moved = sql("SELECT quantity, expiry_date FROM stock WHERE item_id = ? AND container_id = ? "
                "ORDER BY expiry_date IS NULL, expiry_date", (item, here))
    assert [(r["quantity"], r["expiry_date"]) for r in moved] == [(1, d(50)), (1, d(200)), (2, None)]
    assert one("SELECT ROUND(SUM(delta), 6) FROM stock_movements WHERE item_id = ? AND reason = 'transfer'", (item,)) == 0
    assert one("SELECT COUNT(*) FROM stock_movements WHERE item_id = ? AND reason = 'restock'", (item,)) == restocks


def test_move_refuses_more_than_is_there_and_rolls_back(db):
    port, here, a, b = container("Port"), container("Here"), part(), part("Impeller")
    data.add_stock(a, port, 1)
    data.add_stock(b, port, 5)
    with pytest.raises(ValueError):
        data.stow_items(here, [
            {"item_id": b, "quantity": 2, "mode": "move", "from_container_id": port},
            {"item_id": a, "quantity": 3, "mode": "move", "from_container_id": port},
        ])
    assert _qty(b, port) == 5 and _qty(b, here) == 0


def test_extra_is_found_aboard_not_restock(db):
    port, here, item = container("Port"), container("Here"), part()
    data.add_stock(item, port, 2)
    data.set_item_on_list(item, True)
    data.stow_items(here, [{"item_id": item, "quantity": 1, "mode": "extra"}])
    assert _qty(item, port) == 2 and _qty(item, here) == 1
    mv = sql("SELECT reason, note FROM stock_movements WHERE item_id = ? ORDER BY movement_id DESC LIMIT 1", (item,))[0]
    assert (mv["reason"], mv["note"]) == ("manual_adjust", "found aboard - extra stock here")
    assert one("SELECT on_list_since FROM items WHERE item_id = ?", (item,)) is not None


def test_no_mode_unchanged(db):
    port, here, item = container("Port"), container("Here"), part()
    data.add_stock(item, port, 2)
    data.stow_items(here, [{"item_id": item, "quantity": 1}])
    assert _qty(item, port) == 2 and _qty(item, here) == 1
    assert one("SELECT reason FROM stock_movements WHERE item_id = ? ORDER BY movement_id DESC LIMIT 1", (item,)) == "restock"


def test_api_stow_move(client):
    port, here, item = container("Port"), container("Here"), part()
    data.add_stock(item, port, 3)
    r = client.post("/api/items/stow", json={"container_id": here, "lines": [
        {"item_id": item, "quantity": 3, "mode": "move", "from_container_id": port}]})
    assert r.status_code == 200 and r.json()["moved_between"] == 1, r.text
    assert _qty(item, port) == 0 and _qty(item, here) == 3
    bad = client.post("/api/items/stow", json={"container_id": here, "lines": [
        {"item_id": item, "quantity": 1, "mode": "move", "from_container_id": port}]})
    assert bad.status_code == 400
