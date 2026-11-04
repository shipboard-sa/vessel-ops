"""Projects (v4: the send-out/haul-out task grouping) and their phases (v23)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body
from pydantic import BaseModel

import data
from backend.util import not_found

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("")
def list_projects(include_done: bool = True) -> list[dict[str, Any]]:
    return data.list_projects(include_done)


@router.get("/{project_id}")
def get_project(project_id: int) -> dict[str, Any]:
    record = data.get_project(project_id)
    if record is None:
        raise not_found("project", project_id)
    return record


class ProjectCreate(BaseModel):
    name: str
    kind: str = "other"
    description: str | None = None
    target_start: str | None = None
    target_end: str | None = None
    notes: str | None = None


@router.post("")
def create_project(body: ProjectCreate) -> dict[str, int]:
    project_id = data.create_project(
        body.name, kind=body.kind, description=body.description,
        target_start=body.target_start, target_end=body.target_end,
        notes=body.notes,
    )
    return {"project_id": project_id}


@router.patch("/{project_id}")
def update_project(project_id: int, fields: dict[str, Any] = Body(...)) -> dict[str, str]:
    data.update_project(project_id, **fields)
    return {"status": "ok"}


@router.delete("/{project_id}")
def delete_project(project_id: int) -> dict[str, str]:
    """Tasks on the project keep existing; their project_id is set NULL."""
    data.delete_project(project_id)
    return {"status": "ok"}


@router.get("/{project_id}/tasks")
def project_tasks(project_id: int) -> list[dict[str, Any]]:
    return data.project_tasks(project_id)


# --------------------------------------------------------------------------
# v23: phases - a per-project ordered list of stages. Rule violations raise
# data.PhaseError, which backend/main.py maps to a 400 with the message.
# --------------------------------------------------------------------------
@router.get("/{project_id}/phases")
def list_phases(project_id: int) -> list[dict[str, Any]]:
    return data.list_phases(project_id)


class PhaseCreate(BaseModel):
    name: str
    notes: str | None = None
    target_start: str | None = None
    target_end: str | None = None


@router.post("/{project_id}/phases")
def create_phase(project_id: int, body: PhaseCreate) -> dict[str, int]:
    phase_id = data.create_phase(
        project_id, body.name, notes=body.notes,
        target_start=body.target_start, target_end=body.target_end,
    )
    return {"phase_id": phase_id}


class PhaseOrder(BaseModel):
    phase_ids: list[int]


@router.put("/{project_id}/phases/order")
def reorder_phases(project_id: int, body: PhaseOrder) -> dict[str, str]:
    data.reorder_phases(project_id, body.phase_ids)
    return {"status": "ok"}


phases_router = APIRouter(prefix="/api/phases", tags=["projects"])


@phases_router.patch("/{phase_id}")
def update_phase(phase_id: int, fields: dict[str, Any] = Body(...)) -> dict[str, str]:
    data.update_phase(phase_id, **fields)
    return {"status": "ok"}


@phases_router.delete("/{phase_id}")
def delete_phase(phase_id: int) -> dict[str, str]:
    """Its tasks stay on the project with no phase."""
    data.delete_phase(phase_id)
    return {"status": "ok"}
