"""
Purpose: Inventory audits API - walk the boat, count what's really there; Work a Container's "verified here" tick.
Version: v2 (2026-10-08) - v2: POST /{audit_id}/verify (data.verify_in_container - Owner: a tick is a lasting
    "verified here on <date>" record that counts as an audit). v1: audits v5 (list / open / create / abandon /
    progress / unverified / container view / count / close).
Scope: PRODUCTION - mx-inv backend router.
Architecture: mounted by backend/main.py under /api/audits; thin wrapper over data.py's audit functions.
Invocation: imported by backend/main.py.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel

import data
from backend.util import df_records

router = APIRouter(prefix="/api/audits", tags=["audits"])


@router.get("")
def list_audits() -> list[dict[str, Any]]:
    return df_records(data.list_audits())


@router.get("/open")
def get_open_audit() -> dict[str, Any] | None:
    return data.get_open_audit()


class AuditCreate(BaseModel):
    name: str
    scope: str = "full"
    notes: str | None = None


@router.post("")
def create_audit(body: AuditCreate) -> dict[str, int]:
    return {"audit_id": data.create_audit(body.name, scope=body.scope, notes=body.notes)}


@router.post("/{audit_id}/abandon")
def abandon_audit(audit_id: int) -> dict[str, str]:
    data.abandon_audit(audit_id)
    return {"status": "ok"}


@router.get("/{audit_id}/progress")
def audit_progress(audit_id: int) -> dict[str, Any]:
    return data.audit_progress(audit_id)


@router.get("/{audit_id}/unverified")
def audit_unverified(audit_id: int, item_type: str | None = None) -> list[dict[str, Any]]:
    return df_records(data.audit_unverified(audit_id, item_type=item_type))


@router.get("/{audit_id}/containers/{container_id}")
def audit_container_view(audit_id: int, container_id: int) -> list[dict[str, Any]]:
    return data.audit_container_view(audit_id, container_id)


class RecordCount(BaseModel):
    item_id: int
    container_id: int
    counted_qty: float
    note: str | None = None
    occurred_on: str | None = None


@router.post("/{audit_id}/count")
def record_count(audit_id: int, body: RecordCount) -> dict[str, Any]:
    return data.record_count(
        audit_id, body.item_id, body.container_id, body.counted_qty,
        note=body.note, occurred_on=body.occurred_on,
    )


class CloseAudit(BaseModel):
    absent_item_ids: list[int] = []
    notes: str | None = None


@router.post("/{audit_id}/close")
def close_audit(audit_id: int, body: CloseAudit) -> dict[str, Any]:
    return data.close_audit(
        audit_id, absent_item_ids=body.absent_item_ids, notes=body.notes,
    )


class VerifyHere(BaseModel):
    item_id: int
    container_id: int
    verified: bool = True


@router.post("/{audit_id}/verify")
def verify_in_container(audit_id: int, body: VerifyHere) -> dict[str, Any]:
    try:
        return data.verify_in_container(
            audit_id, body.item_id, body.container_id, verified=body.verified,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
