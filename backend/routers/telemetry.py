"""Engine/genset hours + tank levels (v9: InfluxDB-backed, hand-reading
fallback). ``telemetry_sync.py`` itself is untouched - this just exposes
its cached results plus the manual-reading path."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body

import data

router = APIRouter(prefix="/api/telemetry", tags=["telemetry"])


@router.get("/snapshot")
def telemetry_snapshot() -> dict[str, dict[str, Any]]:
    return data.telemetry_snapshot()


@router.get("/{meter}/status")
def telemetry_status(meter: str) -> dict[str, Any]:
    source, hours, observed_at = data.telemetry_status(meter)
    return {"source": source, "hours": hours, "observed_at": observed_at}


@router.get("/{meter}/hours-per-year")
def hours_per_year(meter: str) -> dict[str, float]:
    return {"hours_per_year": data.hours_per_year(meter)}


@router.put("/{meter}/reading")
def set_hours_reading(
    meter: str, hours: float = Body(...), on_date: str | None = Body(None),
) -> dict[str, str]:
    data.set_hours_reading(meter, hours, on_date)
    return {"status": "ok"}


@router.put("/tasks/{task_id}/hours-baseline")
def set_task_hours_baseline(task_id: int, hours: float = Body(..., embed=True)) -> dict[str, str]:
    data.set_task_hours_baseline(task_id, hours)
    return {"status": "ok"}
