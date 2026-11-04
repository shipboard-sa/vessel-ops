"""The 8-bucket schedule board - the highest-traffic view in the app.

Business logic lives in :mod:`backend.scheduling`, not here or in the
frontend.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from backend.scheduling import schedule_snapshot

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


@router.get("")
def get_schedule() -> dict[str, Any]:
    return schedule_snapshot()
