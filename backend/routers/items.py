"""
Purpose: HTTP routes for the item catalog and stock lots (parts, food, tools/accessories), plus the
    Audit tab's review lists (parts linked to no device; spares fit check; tool accessories with
    no linked tool).
Version: v9 (2026-10-18) - v9: food going into a cold box (receive / stow / add stock / a stock move into one of the
    five cold-box places) tells the rules engine that box was RESTOCKED - a background task through
    backend/restock_link.py (Ship's Automation WF-502 / D-128: its alarm waits 2 h while it cools down).
    v8 (2026-10-08) - v8: /stow lines take mode ("move" + from_container_id | "extra").
    v7 (2026-10-08) - v7 adds POST /move-to-unassigned (Work a Container's finish step,
    data.move_to_unassigned). v6 (2026-09-23) - v6 adds GET /{id}/accessories (a tool's accessories, the reverse of
    /{id}/tool-links - tracker #76). v5 (2026-09-22) adds container_id to GET "" (tracker #63 - filter the Locker list to
    one container). v4 (2026-09-22) added GET/PUT /{id}/tool-links (v29 many-to-many
    accessory<->tool, same shape as /{id}/systems). v3 (2026-09-22) added /unlinked-tool-accessories.
    v2 (2026-09-21) added /fit-review, PUT /{id}/fit and POST /{id}/stage-for-removal.
Scope: PRODUCTION - part of the mx-inv FastAPI backend.
Architecture: Mounted by backend/main.py under /api/items; thin wrappers over data.* (data.py holds
    the logic); called by the React warehouse feature (frontend/src/features/warehouse). Cold-box restocks go to
    the boat through backend/restock_link.py after the write (never blocks or fails it).
Invocation: mounted by backend/main.py; tests in tests/test_stock.py, tests/test_restock_link.py.
"""
from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Body, HTTPException
from pydantic import BaseModel

import data
from backend import restock_link
from backend.util import df_records, not_found

router = APIRouter(prefix="/api/items", tags=["items"])


@router.get("")
def list_items(
    item_type: str | None = None, search: str | None = None, container_id: int | None = None
) -> list[dict[str, Any]]:
    return df_records(data.list_items(item_type, search, container_id))


@router.get("/options")
def item_options(item_type: str | None = None) -> dict[str, int]:
    return data.item_options(item_type)


@router.get("/types")
def item_types() -> list[dict[str, Any]]:
    """The item_types lookup table - what item_type values exist and what
    they mean. Adding a type is a data change (INSERT into the lookup
    table), not a schema migration."""
    return data.list_item_types()


@router.get("/policies")
def stocking_policies() -> list[dict[str, Any]]:
    """The stocking_policies lookup table - same idea as /types."""
    return data.list_stocking_policies()


@router.get("/proteins")
def list_proteins() -> list[dict[str, Any]]:
    """Food items in the meat category - the "protein" pick list when planning a recipe."""
    return data.list_proteins()


@router.get("/below-minimum")
def items_below_minimum() -> list[dict[str, Any]]:
    """The Restock List. Each row also carries ``serves``: the systems/devices the item
    is linked to (v22 item_systems), [] when it is linked to none."""
    rows = df_records(data.items_below_minimum())
    served = data.systems_served_by_items([r["item_id"] for r in rows])
    for r in rows:
        r["serves"] = served.get(r["item_id"], [])
    return rows


@router.get("/unlinked-parts")
def unlinked_parts() -> list[dict[str, Any]]:
    """Parts / spare units linked to no system or device - the Audit tab's review list."""
    return data.list_unlinked_parts()


@router.get("/unlinked-tool-accessories")
def unlinked_tool_accessories() -> list[dict[str, Any]]:
    """Tool accessories with no parent tool recorded - the Audit tab's review list."""
    return data.list_unlinked_tool_accessories()


@router.get("/fit-review")
def fit_review() -> list[dict[str, Any]]:
    """Parts / spare units with the device they serve and any computed fit flags - the Audit
    tab's "Spares fit check" list (schema v28)."""
    return data.list_fit_review()


class FitSet(BaseModel):
    fit_status: str | None = None  # 'fits' | 'wrong_model' | 'not_applicable' | None = back to unchecked
    note: str | None = None


@router.put("/{item_id}/fit")
def set_item_fit(item_id: int, body: FitSet) -> dict[str, str]:
    try:
        data.set_item_fit(item_id, body.fit_status, body.note)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"message": str(e)}) from e
    return {"status": "ok"}


@router.post("/{item_id}/stage-for-removal")
def stage_for_removal(item_id: int) -> dict[str, int]:
    """Move all of a (wrong-model) item's stock into 'To remove from boat > Trade or scrap'."""
    try:
        return {"moved": data.stage_item_for_removal(item_id)}
    except sqlite3.IntegrityError as e:
        raise HTTPException(status_code=409, detail={"message": (
            "Could not move a lot into the removal place - it may already hold a plain lot of this "
            "item; move it by hand on the item screen.")}) from e


@router.get("/food-expiring")
def food_expiring_within(days: int = 14) -> list[dict[str, Any]]:
    return df_records(data.food_expiring_within(days))


@router.get("/stock-expiring")
def stock_expiring_within(
    days: int = 90, item_type: str | None = None, exclude_item_type: str | None = None,
) -> list[dict[str, Any]]:
    """Generalized form of /food-expiring - any item type with an expiry
    date, e.g. spares/parts with a shelf life or inspection-due date
    (safety gear, medical kit contents)."""
    return df_records(data.stock_expiring_within(days, item_type=item_type, exclude_item_type=exclude_item_type))


@router.get("/on-list")
def items_on_list() -> list[dict[str, Any]]:
    """Items somebody asked for ("we need more of this"), oldest request first."""
    return data.items_on_list()


class OnListBody(BaseModel):
    on_list: bool  # required, not embedded, same reason as the other PUT bodies


@router.put("/{item_id}/on-list")
def set_item_on_list(item_id: int, body: OnListBody) -> dict[str, str]:
    """Put the item on the shopping list or take it off; receiving stock clears it."""
    try:
        data.set_item_on_list(item_id, body.on_list)
    except ValueError:
        raise not_found("item", item_id)
    return {"status": "ok"}


@router.get("/{item_id}")
def get_item(item_id: int) -> dict[str, Any]:
    record = data.get_item(item_id)
    if record is None:
        raise not_found("item", item_id)
    return record


class ItemCreate(BaseModel):
    item_name: str
    item_type: str
    unit: str = "ea"
    min_quantity: float = 0.0
    target_quantity: float | None = None
    notes: str | None = None
    details: dict[str, Any] | None = None


@router.post("")
def create_item(body: ItemCreate) -> dict[str, int]:
    try:
        item_id = data.create_item(
            body.item_name, body.item_type, unit=body.unit,
            min_quantity=body.min_quantity, target_quantity=body.target_quantity,
            notes=body.notes, details=body.details,
        )
    except data.DuplicateItemError as e:
        raise HTTPException(
            status_code=409,
            detail={"item_id": e.item_id, "item_name": e.item_name, "message": str(e)},
        ) from e
    return {"item_id": item_id}


@router.patch("/{item_id}")
def update_item(item_id: int, fields: dict[str, Any] = Body(...)) -> dict[str, str]:
    try:
        data.update_item(item_id, **fields)
    except data.DuplicateItemError as e:
        raise HTTPException(
            status_code=409,
            detail={"item_id": e.item_id, "item_name": e.item_name, "message": str(e)},
        ) from e
    except data.UnitError:
        raise  # keep the app-level 422 "did you mean" handling for units
    except ValueError as e:  # blank name, unknown type/policy, tool with accessories...
        raise HTTPException(status_code=400, detail={"message": str(e)}) from e
    return {"status": "ok"}


@router.delete("/{item_id}")
def delete_item(item_id: int) -> dict[str, str]:
    data.delete_item(item_id)
    return {"status": "ok"}


# --------------------------------------------------------------------------
# stock lots
# --------------------------------------------------------------------------
@router.get("/{item_id}/stock")
def get_item_stock(item_id: int) -> list[dict[str, Any]]:
    return data.get_item_stock(item_id)


class StockCreate(BaseModel):
    container_id: int | None
    quantity: float
    expiry_date: str | None = None
    opened_on: str | None = None
    lot_note: str | None = None
    acquired_on: str | None = None
    vendor: str | None = None
    unit_cost: float | None = None
    reason: str = "restock"


class StowLine(BaseModel):
    item_id: int
    quantity: float
    mode: str | None = None               # None | "move" | "extra" (data.stow_items v49)
    from_container_id: int | None = None  # with mode "move"


class StowBody(BaseModel):
    container_id: int
    lines: list[StowLine]


@router.post("/stow")
def stow_items(body: StowBody, bg: BackgroundTasks) -> dict[str, int]:
    """Put many items into one container at once (all-or-nothing)."""
    try:
        out = data.stow_items(
            body.container_id, [ln.model_dump() for ln in body.lines]
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"message": str(e)}) from e
    bg.add_task(restock_link.notify, [(body.container_id, ln.item_id, ln.quantity) for ln in body.lines], "stow")
    return out


class MoveToUnassignedBody(BaseModel):
    container_id: int
    item_ids: list[int]


@router.post("/move-to-unassigned")
def move_to_unassigned(body: MoveToUnassignedBody) -> dict[str, int]:
    """Work a Container's finish step: un-ticked items' stock here moves to Unassigned (all-or-nothing)."""
    try:
        return data.move_to_unassigned(body.container_id, body.item_ids)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"message": str(e)}) from e


class SystemsBody(BaseModel):
    systems: list[str]


@router.get("/{item_id}/systems")
def get_item_systems(item_id: int) -> list[str]:
    """The systems/devices this item serves (a part OF them, or a spare unit that
    can replace them - the item's type says which)."""
    return data.get_item_systems(item_id)


@router.put("/{item_id}/systems")
def set_item_systems(item_id: int, body: SystemsBody) -> dict[str, str]:
    try:
        data.set_item_systems(item_id, body.systems)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"message": str(e)}) from e
    return {"status": "ok"}


class ToolLinksBody(BaseModel):
    tool_item_ids: list[int]


@router.get("/{item_id}/tool-links")
def get_accessory_tools(item_id: int) -> list[int]:
    """The tool item_ids this accessory belongs to (v29, many-to-many)."""
    return data.get_accessory_tools(item_id)


@router.get("/{item_id}/accessories")
def get_tool_accessories(item_id: int) -> list[dict[str, Any]]:
    """The accessories linked to this tool - [{item_id, item_name}] (reverse of /tool-links)."""
    return data.get_tool_accessories(item_id)


@router.put("/{item_id}/tool-links")
def set_accessory_tools(item_id: int, body: ToolLinksBody) -> dict[str, str]:
    try:
        data.set_accessory_tools(item_id, body.tool_item_ids)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"message": str(e)}) from e
    return {"status": "ok"}


@router.post("/{item_id}/stock")
def add_stock(item_id: int, body: StockCreate, bg: BackgroundTasks) -> dict[str, int]:
    try:
        stock_id = data.add_stock(
            item_id, body.container_id, body.quantity,
            expiry_date=body.expiry_date, opened_on=body.opened_on,
            lot_note=body.lot_note, acquired_on=body.acquired_on,
            vendor=body.vendor, unit_cost=body.unit_cost, reason=body.reason,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"message": str(e)}) from e
    bg.add_task(restock_link.notify, [(body.container_id, item_id, body.quantity)], "add stock")
    return {"stock_id": stock_id}


@router.get("/{item_id}/receive-targets")
def receive_targets(item_id: int) -> list[dict[str, Any]]:
    """Containers a received purchase of this item can go to (its existing rows),
    zero-quantity 'home' rows first. Empty = no recorded place yet."""
    return data.receive_targets(item_id)


@router.get("/{item_id}/receive-info")
def receive_info(item_id: int) -> dict[str, Any]:
    """Receive form data in one call: places (targets), suggested expiry (today + shelf
    life, if the item has one) and the undated stock aboard (offered a date when a dated
    batch is added beside it)."""
    return data.receive_info(item_id)


class ReceiveLine(BaseModel):
    container_id: int | None = None
    quantity: float
    expiry_date: str | None = None


class ReceiveBody(BaseModel):
    lines: list[ReceiveLine]
    acquired_on: str | None = None
    older_expiry: str | None = None


@router.post("/{item_id}/receive")
def receive_stock(item_id: int, body: ReceiveBody, bg: BackgroundTasks) -> dict[str, list[int]]:
    """Receive a purchase into one or several containers in one all-or-nothing call
    (a plain line merges into the container's existing / zero-quantity row)."""
    try:
        ids = data.receive_stock(
            item_id, [ln.model_dump() for ln in body.lines], acquired_on=body.acquired_on,
            older_expiry=body.older_expiry,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"message": str(e)}) from e
    bg.add_task(restock_link.notify, [(ln.container_id, item_id, ln.quantity) for ln in body.lines], "receive")
    return {"stock_ids": ids}


@router.patch("/stock/{stock_id}")
def update_stock(
    stock_id: int,
    bg: BackgroundTasks,
    reason: str = Body("manual_adjust"),
    fields: dict[str, Any] = Body(default_factory=dict),
) -> dict[str, str]:
    data.update_stock(stock_id, reason=reason, **fields)
    if fields.get("container_id") is not None:   # a move - into a cold box = a restock
        with data.connect() as conn:
            row = conn.execute("SELECT item_id, container_id, quantity FROM stock WHERE stock_id = ?",
                               (stock_id,)).fetchone()
        if row is not None:
            bg.add_task(restock_link.notify, [(row["container_id"], row["item_id"], row["quantity"])], "move")
    return {"status": "ok"}


@router.delete("/stock/{stock_id}")
def delete_stock(stock_id: int, reason: str = "manual_adjust", note: str = "lot removed") -> dict[str, str]:
    data.delete_stock(stock_id, reason=reason, note=note)
    return {"status": "ok"}


@router.get("/stock/movements")
def stock_movements(item_id: int | None = None, limit: int = 200) -> list[dict[str, Any]]:
    return df_records(data.stock_movements(item_id, limit))


@router.get("/{item_id}/consumption-rate")
def consumption_rate(item_id: int, days: int = 365) -> dict[str, float]:
    return {"per_30_days": data.consumption_rate(item_id, days)}
