"""
Purpose: Owner settings API - boat name, hour-meter labels, manuals folder.
Version: v1 (2026-09-24)
Scope: PRODUCTION - mx-inv backend router (added for the release package).
Architecture: Mounted by backend/main.py at /api/settings. Thin wrapper over
    data.get_settings / data.update_settings (system_config rows). Read by the
    frontend header + ⚙ Settings screen, the telemetry widget labels, and on the
    server side by print_sheet.py, history_report.py and device_research.py.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import data

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsUpdate(BaseModel):
    vessel_name: str | None = None
    engine_label: str | None = None
    genset_label: str | None = None
    manuals_root: str | None = None


@router.get("")
def get_settings() -> dict[str, str]:
    return data.get_settings()


@router.put("")
def put_settings(body: SettingsUpdate) -> dict[str, str]:
    changes = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        return data.update_settings(changes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
