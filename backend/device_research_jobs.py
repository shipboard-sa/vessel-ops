"""device_research_jobs.py - in-memory registry for background device-manual-research jobs.

Purpose: Run research_device() once per job on a background thread, expose progress as a plain
    dict for the web UI to poll, support cancelling a running job, and write the finished draft to
    disk the moment it lands so a server restart or closed tab never loses paid-for research.
Version: v1 (2026-09-22)
Scope: PRODUCTION - mx-inv feature (backend/routers/device_research.py exposes this as
    /api/device-research; a frontend review panel drives it).
Architecture: mx-inv backend support module between device_research.py (one device, one
    subprocess) and the FastAPI router (HTTP). Mirrors  research_jobs.py, simplified
    from a list-of-ports-per-job down to one device per job (a device-research run is triggered per
    button click on one device's screen, not a batch).

Rules encoded here (same as  design, see wiki/Logistics-Research-Design.md there):

* One active job at a time (:class:`DeviceResearchBusyError`, the web layer's 409) - a rate-limited
  subscription is the worst case for concurrent runs.
* Cancel sets a shared event; the running subprocess's process tree is killed.
* An ``ok`` draft is written to ``var/device_research/research_<id>_<slug>.json`` the moment it
  finishes. A failed job's incomplete placeholder is not saved - nothing worth keeping.
"""
from __future__ import annotations

import re
import threading
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from .device_research import CANCELLED, DeviceResearchError, DeviceResearchUnavailableError, DeviceResult, research_device

JobStatus = Literal["running", "done", "cancelled", "error"]

# Signature of research_device(); a test passes a fake with the same shape.
ResearchFn = Callable[..., DeviceResult]


class DeviceResearchBusyError(DeviceResearchError):
    """A device-research job is already running; only one may be active at a time."""


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "device"


@dataclass(slots=True)
class ResearchJob:
    id: str
    device_name: str
    manual_paths: list[str]
    status: JobStatus = "running"
    result: DeviceResult | None = None
    error: str | None = None
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    finished_at: datetime | None = None
    saved_path: Path | None = None
    cancel: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None

    def to_dict(self) -> dict[str, Any]:
        r = self.result
        d = r.draft if r else None
        return {
            "id": self.id,
            "device_name": self.device_name,
            "manual_paths": self.manual_paths,
            "status": self.status,
            "error": self.error,
            "started_at": self.started_at.isoformat(),
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "draft": None if d is None else {
                "device_name": d.device_name,
                "make_model": d.make_model,
                "manual_ref": d.manual_ref,
                "key_specs": list(d.key_specs),
                "tasks": list(d.tasks),
                "spares": list(d.spares),
                "notes": d.notes,
                "needs_your_answer": list(d.needs_your_answer),
                "sources_used": list(d.sources_used),
                "incomplete": d.incomplete,
            },
            "run_status": r.status if r else None,
            "run_error": r.error if r else None,
            "seconds": r.duration_s if r else 0.0,
            "cost_usd": r.cost_usd if r else 0.0,
            "turns": r.turns if r else None,
            "warnings": list(r.warnings) if r else [],
            "saved_as": self.saved_path.name if self.saved_path else None,
        }


class DeviceResearchJobs:
    """The job index. Single-user LAN tool, so it is one object in the backend process; a restart
    loses the index but not a saved draft file."""

    def __init__(
        self,
        out_dir: Path,
        *,
        research: ResearchFn = research_device,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._out_dir = out_dir
        self._research = research
        self._now = now or (lambda: datetime.now(UTC))
        self._jobs: dict[str, ResearchJob] = {}
        self._lock = threading.Lock()

    # -- starting and stopping ------------------------------------------------

    def start(
        self,
        device_name: str,
        *,
        exe: Path,
        manual_paths: list[str] | None = None,
        parent_system: str | None = None,
        existing_make_model: str | None = None,
        existing_notes: str | None = None,
        env: Mapping[str, str] | None = None,
    ) -> str:
        """Start a job for one device and return its id. Raises
        :class:`DeviceResearchBusyError` if one is already running and ``ValueError`` if
        ``device_name`` is blank."""
        name = device_name.strip()
        if not name:
            raise ValueError("give a device name")
        paths = [p.strip() for p in (manual_paths or []) if p.strip()]
        with self._lock:
            if any(j.status == "running" for j in self._jobs.values()):
                raise DeviceResearchBusyError("a device-research job is already running")
            job = ResearchJob(id=uuid.uuid4().hex[:12], device_name=name, manual_paths=paths,
                               started_at=self._now())
            job.thread = threading.Thread(
                target=self._run,
                args=(job, exe, parent_system, existing_make_model, existing_notes, env),
                name=f"device-research-{job.id}",
                daemon=True,
            )
            self._jobs[job.id] = job
            job.thread.start()
        return job.id

    def cancel(self, job_id: str) -> bool:
        """Ask a running job to stop. ``False`` if the id is unknown; cancelling a job that
        already finished is a harmless no-op that returns ``True``."""
        job = self._jobs.get(job_id)
        if job is None:
            return False
        job.cancel.set()
        return True

    # -- reading --------------------------------------------------------------

    def snapshot(self, job_id: str) -> dict[str, Any] | None:
        job = self._jobs.get(job_id)
        if job is None:
            return None
        with self._lock:
            return job.to_dict()

    def wait(self, job_id: str, timeout: float = 5.0) -> None:
        """Block until the job's thread ends (tests; the web layer polls instead)."""
        job = self._jobs.get(job_id)
        if job is not None and job.thread is not None:
            job.thread.join(timeout)

    # -- the worker thread ----------------------------------------------------

    def _finish(self, job: ResearchJob, status: JobStatus, error: str | None = None) -> None:
        with self._lock:
            job.status = status
            job.error = error
            job.finished_at = self._now()

    def _save(self, job: ResearchJob, result: DeviceResult) -> Path | None:
        """Write an ``ok`` draft to disk at once. A disk problem must not lose the in-memory
        result, so it is swallowed (the panel still has it)."""
        import json
        try:
            self._out_dir.mkdir(parents=True, exist_ok=True)
            path = self._out_dir / f"research_{job.id}_{_slug(job.device_name)}.json"
            path.write_text(
                json.dumps(job.to_dict(), indent=2, default=str), encoding="utf-8",
            )
        except OSError:
            return None
        return path

    def _run(
        self,
        job: ResearchJob,
        exe: Path,
        parent_system: str | None,
        existing_make_model: str | None,
        existing_notes: str | None,
        env: Mapping[str, str] | None,
    ) -> None:
        try:
            if job.cancel.is_set():
                self._finish(job, "cancelled")
                return
            try:
                result = self._research(
                    job.device_name, exe=exe, manual_paths=job.manual_paths or None,
                    parent_system=parent_system, existing_make_model=existing_make_model,
                    existing_notes=existing_notes, env=env, cancel=job.cancel,
                )
            except DeviceResearchUnavailableError as exc:
                self._finish(job, "error", str(exc))
                return
            with self._lock:
                job.result = result
            saved = self._save(job, result) if result.status == "ok" else None
            with self._lock:
                job.saved_path = saved
            if result.error == CANCELLED:
                self._finish(job, "cancelled")
            elif result.status == "ok":
                self._finish(job, "done")
            else:
                self._finish(job, "error", result.error)
        except Exception as exc:  # a worker thread must never die silently
            self._finish(job, "error", f"{type(exc).__name__}: {exc}")
