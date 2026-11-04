"""Storage compartments, locations and containers (the physical structure
stock lives in).

Purpose: REST endpoints for the compartment -> location -> container
    storage hierarchy.
Version: v4 (2026-09-20) - container PATCH reports a name clash (409) / bad location (400) when moving
Scope: PRODUCTION - mx-inv backend, mounted by backend/main.py.
Architecture: mx-inv backend router. Thin wrapper over data.py's
    compartment/location/container functions; StorageStructureTab.tsx is
    the only frontend consumer of the compartments endpoints.
"""
from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel

import data
from backend.util import df_records

router = APIRouter(prefix="/api/storage", tags=["storage"])


@router.get("/compartments")
def list_compartments() -> list[dict[str, Any]]:
    return data.list_compartments()


@router.post("/compartments")
def add_compartment(name: str = Body(..., embed=True)) -> dict[str, int]:
    return {"compartment_id": data.create_compartment(name)}


@router.patch("/compartments/{compartment_id}")
def rename_compartment(compartment_id: int, name: str = Body(..., embed=True)) -> dict[str, str]:
    data.rename_compartment(compartment_id, name)
    return {"status": "ok"}


@router.delete("/compartments/{compartment_id}")
def delete_compartment(compartment_id: int, reassign_to: int | None = None) -> dict[str, str]:
    data.delete_compartment(compartment_id, reassign_to=reassign_to)
    return {"status": "ok"}


def _in_use_409(e: "data.StorageInUseError") -> HTTPException:
    return HTTPException(
        status_code=409, detail={"message": str(e), "blockers": e.blockers},
    )


def _name_taken_409() -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={"message": "That compartment already has a location with this name."},
    )


@router.get("/locations")
def list_locations() -> list[dict[str, Any]]:
    return df_records(data.list_locations())


class LocationCreate(BaseModel):
    name: str
    compartment_id: int


@router.post("/locations")
def add_location(body: LocationCreate) -> dict[str, int]:
    try:
        return {"location_id": data.add_location(body.name, body.compartment_id)}
    except sqlite3.IntegrityError as e:
        raise _name_taken_409() from e


@router.patch("/locations/{location_id}")
def update_location(location_id: int, fields: dict[str, Any] = Body(...)) -> dict[str, str]:
    try:
        data.update_location(location_id, **fields)
    except sqlite3.IntegrityError as e:
        raise _name_taken_409() from e
    return {"status": "ok"}


@router.delete("/locations/{location_id}")
def delete_location(location_id: int) -> dict[str, str]:
    """Deletes the location and its empty containers; 409 if any container
    still holds stock (never orphans stock)."""
    try:
        data.delete_location(location_id)
    except data.StorageInUseError as e:
        raise _in_use_409(e) from e
    return {"status": "ok"}


@router.get("/containers")
def list_containers() -> list[dict[str, Any]]:
    return df_records(data.list_containers())


@router.get("/containers/options")
def container_options(favorites_only: bool = False) -> dict[str, int]:
    return data.container_options(favorites_only=favorites_only)


class ContainerCreate(BaseModel):
    location_id: int
    name: str
    container_type: str = "dry"
    notes: str | None = None


@router.post("/containers")
def add_container(body: ContainerCreate) -> dict[str, int]:
    container_id = data.add_container(
        body.location_id, body.name, body.container_type, body.notes,
    )
    return {"container_id": container_id}


@router.patch("/containers/{container_id}")
def update_container(container_id: int, fields: dict[str, Any] = Body(...)) -> dict[str, str]:
    """Rename / retype / favorite a container, or MOVE it (``location_id``) - its
    stock rows travel with it (stock references the container, not the location)."""
    try:
        data.update_container(container_id, **fields)
    except sqlite3.IntegrityError as e:
        raise HTTPException(
            status_code=409,
            detail={"message": "That location already has a container with this name - rename one of them first."},
        ) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"message": str(e)}) from e
    return {"status": "ok"}


@router.delete("/containers/{container_id}")
def delete_container(container_id: int) -> dict[str, str]:
    try:
        data.delete_container(container_id)
    except data.StorageInUseError as e:
        raise _in_use_409(e) from e
    return {"status": "ok"}
