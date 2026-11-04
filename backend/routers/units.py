"""Units picklist API (schema v21): the governed list items.unit and
recipe_ingredients.unit reference.

Purpose: CRUD for the `units` lookup table (GET/POST /api/units,
    PATCH/DELETE /api/units/{unit_key}). Rows carry `offered` (bool): false
    = legacy/hidden from pickers but still valid, so existing items using
    it keep saving.
Version: v1 (2026-09-18)
Scope: PRODUCTION - part of the mx-inv FastAPI+React app; the frontend's
    unit pickers and the Units admin screen read/write through this.
Architecture: mx-inv backend router, thin wrapper over data.list_units /
    create_unit / update_unit / delete_unit; mounted by backend/main.py.
    Error mapping: blank key / bad dimension -> 422, unknown key -> 404,
    duplicate key (case-insensitive) or unit still in use -> 409.
    (The 422 for a unit not in `units` on other endpoints - items, recipe
    ingredients - is an app-level handler in backend/main.py.)
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import data

router = APIRouter(prefix="/api/units", tags=["units"])


def _http(exc: data.UnitError) -> HTTPException:
    if isinstance(exc, data.UnitNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, (data.UnitExistsError, data.UnitInUseError)):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=422, detail=str(exc))


@router.get("")
def list_units() -> list[dict[str, Any]]:
    return data.list_units()


class UnitCreate(BaseModel):
    unit_key: str
    label: str | None = None
    dimension: str = "count"
    description: str | None = None
    offered: bool = True


@router.post("")
def create_unit(body: UnitCreate) -> dict[str, Any]:
    try:
        return data.create_unit(
            body.unit_key, body.label, body.dimension, body.description, body.offered,
        )
    except data.UnitError as exc:
        raise _http(exc) from exc


class UnitUpdate(BaseModel):
    new_key: str | None = None
    label: str | None = None
    dimension: str | None = None
    description: str | None = None
    offered: bool | None = None


@router.patch("/{unit_key}")
def update_unit(unit_key: str, body: UnitUpdate) -> dict[str, str]:
    try:
        data.update_unit(
            unit_key, new_key=body.new_key, label=body.label,
            dimension=body.dimension, description=body.description,
            offered=body.offered,
        )
    except data.UnitError as exc:
        raise _http(exc) from exc
    return {"status": "ok"}


@router.delete("/{unit_key}")
def delete_unit(unit_key: str) -> dict[str, str]:
    try:
        data.delete_unit(unit_key)
    except data.UnitError as exc:
        raise _http(exc) from exc
    return {"status": "ok"}
