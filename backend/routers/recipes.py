"""Galley recipe book (v8: standalone reference, no inventory link).

Purpose: HTTP routes for recipes - CRUD, tags, ingredient parse/save, cook,
    and the metric-to-imperial text conversion proposal.
Version: v4 (2026-10-07) - v4: GET "" list filters (ingredients / methods / tags) declared as Query() - they were
    read as a GET body before. v3 (2026-09-23) - v3: POST /{id}/ingredients/changes ("Keep in recipe", tracker #71). v2 was 2026-09-18
Scope: PRODUCTION - mx-inv backend router.
Architecture: Mounted by backend/main.py under /api/recipes; a thin layer
    over data.py (list/get/update_recipe, parse_recipe_ingredients,
    make_recipe, convert_recipe_text_to_imperial). Called by the React
    recipes feature (frontend/src/features/recipes). v2: GET
    /{id}/convert-text (ephemeral proposal, nothing saved).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel

import data
from backend.util import df_records, not_found

router = APIRouter(prefix="/api/recipes", tags=["recipes"])


@router.get("")
def list_recipes(
    search: str | None = None,
    # Query(): a bare list[str] on a GET is read as a request BODY, which a browser cannot send (2026-10-07)
    ingredients: list[str] | None = Query(None),
    methods: list[str] | None = Query(None),
    tags: list[str] | None = Query(None),
) -> list[dict[str, Any]]:
    return df_records(data.list_recipes(
        search=search, ingredients=ingredients, methods=methods, tags=tags,
    ))


@router.get("/tags/{kind}")
def recipe_tag_values(kind: str) -> list[str]:
    return data.recipe_tag_values(kind)


@router.get("/{recipe_id}")
def get_recipe(recipe_id: int) -> dict[str, Any]:
    record = data.get_recipe(recipe_id)
    if record is None:
        raise not_found("recipe", recipe_id)
    return record


class RecipeCreate(BaseModel):
    title: str
    body: str
    source: str | None = None
    servings: str | None = None
    notes: str | None = None
    ingredients: list[str] | None = None
    methods: list[str] | None = None
    tags: list[str] | None = None


@router.post("")
def create_recipe(body: RecipeCreate) -> dict[str, int]:
    recipe_id = data.create_recipe(
        body.title, body.body, source=body.source, servings=body.servings,
        notes=body.notes, ingredients=body.ingredients, methods=body.methods,
        tags=body.tags,
    )
    return {"recipe_id": recipe_id}


@router.patch("/{recipe_id}")
def update_recipe(recipe_id: int, fields: dict[str, Any] = Body(...)) -> dict[str, str]:
    data.update_recipe(recipe_id, **fields)
    return {"status": "ok"}


@router.delete("/{recipe_id}")
def delete_recipe(recipe_id: int) -> dict[str, str]:
    data.delete_recipe(recipe_id)
    return {"status": "ok"}


# --------------------------------------------------------------------------
# v15: structured ingredients (parse once, reuse on every cook)
# --------------------------------------------------------------------------
@router.get("/{recipe_id}/parse-ingredients")
def parse_recipe_ingredients(recipe_id: int) -> list[dict[str, Any]]:
    """Ephemeral - reads the recipe body fresh each call, saves nothing."""
    return data.parse_recipe_ingredients(recipe_id)


@router.get("/{recipe_id}/convert-text")
def convert_recipe_text(recipe_id: int) -> dict[str, Any]:
    """Ephemeral proposal - reads the body fresh and returns
    ``{converted_body, changes: [{original, converted}]}``; saves nothing.
    Applying it is a normal PATCH of the recipe body (the metric original is
    discarded by design - the owner, 2026-09-18)."""
    record = data.get_recipe(recipe_id)
    if record is None:
        raise not_found("recipe", recipe_id)
    return data.convert_recipe_text_to_imperial(record["body"])


class IngredientSave(BaseModel):
    raw_text: str
    item_id: int | None = None
    quantity: float | None = None
    unit: str | None = None


@router.put("/{recipe_id}/ingredients")
def save_recipe_ingredients(recipe_id: int, body: list[IngredientSave]) -> dict[str, str]:
    data.save_recipe_ingredients(recipe_id, [i.model_dump() for i in body])
    return {"status": "ok"}


class IngredientLink(BaseModel):
    item_id: int | None  # nullable-required: null = reference only


@router.put("/ingredients/{recipe_ingredient_id}/item")
def set_recipe_ingredient_item(recipe_ingredient_id: int, body: IngredientLink) -> dict[str, str]:
    """(Re)link one saved ingredient line to a catalog item, e.g. right after the
    ingredient was added to the catalog at cook time."""
    try:
        data.set_recipe_ingredient_item(recipe_ingredient_id, body.item_id)
    except ValueError as exc:
        raise not_found("ingredient or item", str(exc))
    return {"status": "ok"}


class IngredientUpdate(BaseModel):
    recipe_ingredient_id: int
    item_id: int | None = None
    quantity: float | None = None


class IngredientAddition(BaseModel):
    item_id: int
    quantity: float | None = None


class IngredientChanges(BaseModel):
    updates: list[IngredientUpdate] = []
    additions: list[IngredientAddition] = []


@router.post("/{recipe_id}/ingredients/changes")
def apply_ingredient_changes(recipe_id: int, body: IngredientChanges) -> dict[str, Any]:
    """"Keep in recipe" from the plan/cook screen (tracker #71): re-link or re-quantify saved
    lines and append new ones, in one transaction. Only the fields actually sent are changed."""
    try:
        return data.apply_recipe_ingredient_changes(
            recipe_id,
            [u.model_dump(exclude_unset=True) for u in body.updates],
            [a.model_dump() for a in body.additions],
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc)})


@router.get("/{recipe_id}/ingredients")
def get_recipe_ingredients(recipe_id: int) -> list[dict[str, Any]]:
    return data.get_recipe_ingredients(recipe_id)


class MakeRecipeBody(BaseModel):
    occurred_on: str
    consumption: list[dict[str, Any]] | None = None


@router.post("/{recipe_id}/make")
def make_recipe(recipe_id: int, body: MakeRecipeBody) -> dict[str, Any]:
    return data.make_recipe(recipe_id, body.occurred_on, body.consumption)
