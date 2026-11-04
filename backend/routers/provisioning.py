"""Shopping list (task-driven shortfalls) and galley provisioning plan."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body

import data
from backend.util import df_records

router = APIRouter(prefix="/api/provisioning", tags=["provisioning"])


@router.get("/shopping-list")
def task_shopping_list() -> list[dict[str, Any]]:
    """Linked task items whose required quantity exceeds current on-hand.
    The Streamlit UI cross-references this against the active schedule
    (``/api/schedule``) to show each shortfall's due date."""
    return df_records(data.task_shopping_list())


@router.get("/plan")
def provisioning_plan(crew: int = 2, weeks: float = 2.0, order: str = "aisle") -> list[dict[str, Any]]:
    return df_records(data.provisioning_plan(crew, weeks, order))


@router.get("/food-cart")
def food_cart(
    crew: int = 2, weeks: float = 2.0, order: str = "aisle", expiring_days: int = 14,
) -> list[dict[str, Any]]:
    """The merged food shopping cart - baseline provisioning heuristic +
    meal-plan refinement, one list (the owner, 2026-09-17)."""
    return df_records(data.food_cart(crew, weeks, order, expiring_days))


@router.get("/prefs")
def get_provisioning_prefs() -> dict[str, float]:
    """Last-used crew/weeks, so the plan reopens where it was left - mirrors
    the Streamlit tab's `provision_crew`/`provision_weeks` system_config keys."""
    try:
        crew = int(data.get_config("provision_crew", "2"))
    except (TypeError, ValueError):
        crew = 2
    try:
        weeks = float(data.get_config("provision_weeks", "2"))
    except (TypeError, ValueError):
        weeks = 2.0
    return {"crew": crew, "weeks": weeks}


@router.put("/prefs")
def set_provisioning_prefs(crew: int = Body(...), weeks: float = Body(...)) -> dict[str, str]:
    data.set_config("provision_crew", crew)
    data.set_config("provision_weeks", weeks)
    return {"status": "ok"}


@router.get("/aisle-order")
def get_aisle_order() -> list[str]:
    return data.get_aisle_order()


@router.put("/aisle-order")
def set_aisle_order(categories: list[str] = Body(..., embed=True)) -> dict[str, str]:
    data.set_aisle_order(categories)
    return {"status": "ok"}
