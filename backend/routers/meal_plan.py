"""Meal plan (v16): a pure working list of picked recipes, feeding both
provisioning (shortfall shopping list) and inventory (draw-down on cook) -
see data.py's module docstring above list_meal_plan() for the design."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import data

router = APIRouter(prefix="/api/meal-plan", tags=["meal-plan"])


@router.get("")
def list_meal_plan() -> list[dict[str, Any]]:
    return data.list_meal_plan()


@router.post("/pantry-check")
def add_pantry_check_to_plan() -> dict[str, int]:
    """Put the standing pantry-check recipe (every bulk item) on the plan, creating
    it the first time. Returns {meal_plan_id, recipe_id}."""
    return data.add_pantry_check_to_plan()


class MealPlanCreate(BaseModel):
    recipe_id: int
    planned_for: str | None = None
    notes: str | None = None
    # A chosen protein: replaces the recipe's own protein line, else is added (data._protein_picks).
    protein_item_id: int | None = None


@router.post("")
def add_to_meal_plan(body: MealPlanCreate) -> dict[str, int]:
    try:
        meal_plan_id = data.add_to_meal_plan(
            body.recipe_id, body.planned_for, body.notes, body.protein_item_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"meal_plan_id": meal_plan_id}


@router.delete("/{meal_plan_id}")
def remove_from_meal_plan(meal_plan_id: int) -> dict[str, str]:
    data.remove_from_meal_plan(meal_plan_id)
    return {"status": "ok"}


class MealPlanOverrides(BaseModel):
    overrides: list[dict[str, Any]] | None = None


class MealPlanProtein(BaseModel):
    protein_item_id: int | None = None  # None = back to the recipe's own protein


@router.put("/{meal_plan_id}/protein")
def set_meal_plan_protein(meal_plan_id: int, body: MealPlanProtein) -> dict[str, str]:
    """Change the protein of a plan entry, keeping its other saved picks (the dedicated protein control)."""
    try:
        data.set_meal_plan_protein(meal_plan_id, body.protein_item_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}


@router.put("/{meal_plan_id}/overrides")
def save_meal_plan_overrides(meal_plan_id: int, body: MealPlanOverrides) -> dict[str, str]:
    try:
        data.save_meal_plan_overrides(meal_plan_id, body.overrides)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


class MealPlanComplete(BaseModel):
    occurred_on: str
    consumption: list[dict[str, Any]] | None = None


@router.post("/{meal_plan_id}/complete")
def complete_meal_plan_entry(meal_plan_id: int, body: MealPlanComplete) -> dict[str, Any]:
    try:
        return data.complete_meal_plan_entry(meal_plan_id, body.occurred_on, body.consumption)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/shopping-list")
def meal_plan_shopping_list() -> list[dict[str, Any]]:
    return data.meal_plan_shopping_list()
