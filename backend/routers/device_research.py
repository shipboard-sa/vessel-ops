"""device_research.py (router) - HTTP surface for the manual-research background job.

Purpose: Exposes device_research_jobs.DeviceResearchJobs over HTTP: a status check for the GUI
    button, start a job, poll it, cancel it. Never writes to the systems tree itself - the frontend
    applies individual fields from the draft through the ordinary systems/tasks/items endpoints
    once the owner has reviewed it, exactly like the routing "Research with Claude" panel never
    auto-commits.
Version: v1 (2026-09-22)
Scope: PRODUCTION - mx-inv backend router (tracker #50 - the GUI build the owner asked for after the
    chat-driven calibration round, see CHECKPOINT.md).
Architecture: Mounted by backend/main.py. Thin HTTP layer over one module-level
    DeviceResearchJobs singleton (mirrors  backend/main.py `_RESEARCH` singleton -
    single-user LAN tool, in-memory is fine).
"""
from __future__ import annotations

from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Form, HTTPException

from backend.device_research import (
    DeviceResearchUnavailableError,
    find_claude_exe,
    research_status,
)
from backend.device_research_jobs import DeviceResearchBusyError, DeviceResearchJobs

router = APIRouter(prefix="/api/device-research", tags=["device-research"])

_OUT_DIR = Path(__file__).resolve().parents[2] / "var" / "device_research"
_JOBS = DeviceResearchJobs(_OUT_DIR)


@router.get("/status")
def device_research_status() -> dict[str, Any]:
    st = research_status()
    return {"available": st.available, "reason": st.reason}


@router.post("")
def start_device_research(
    device_name: Annotated[str, Form()],
    manual_paths: Annotated[str, Form()] = "",
    parent_system: Annotated[str | None, Form()] = None,
    existing_make_model: Annotated[str | None, Form()] = None,
    existing_notes: Annotated[str | None, Form()] = None,
) -> dict[str, str]:
    """Start a research job. ``manual_paths`` is newline-separated, each relative to
    D:\\Documents\\sailboat\\Manuals\\ (blank is fine - the model searches for one itself)."""
    paths = [p.strip() for p in manual_paths.splitlines() if p.strip()]
    st = research_status()
    if not st.available:
        raise HTTPException(status_code=503, detail=st.reason)
    try:
        exe = find_claude_exe()
    except DeviceResearchUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if exe is None:
        raise HTTPException(status_code=503, detail="Claude Code CLI not found")
    try:
        job_id = _JOBS.start(
            device_name, exe=exe, manual_paths=paths, parent_system=parent_system,
            existing_make_model=existing_make_model, existing_notes=existing_notes,
        )
    except DeviceResearchBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": job_id}


@router.get("/{job_id}")
def device_research_status_poll(job_id: str) -> dict[str, Any]:
    snap = _JOBS.snapshot(job_id)
    if snap is None:
        raise HTTPException(status_code=404, detail="no such research job")
    return snap


@router.delete("/{job_id}")
def cancel_device_research(job_id: str) -> dict[str, bool]:
    if not _JOBS.cancel(job_id):
        raise HTTPException(status_code=404, detail="no such research job")
    return {"cancelling": True}
