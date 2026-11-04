"""Tasks - and, per the unified-management UX decision, checklists too.

A checklist is a task with ``task_kind='checklist'``; its steps are tasks
with ``parent_task_id`` pointing at it. Rather than a parallel
``/api/checklists`` endpoint family, checklist-specific actions live under
``/api/tasks/...`` sub-routes so the frontend's task and checklist views
share one consistent API shape (the decision recorded in the
``mx-inv-webapp-rewrite`` project memory / plan doc).
"""
from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

import data
from backend import print_sheet, vessel_log
from backend.util import df_records

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


# --------------------------------------------------------------------------
# core task list / CRUD
# --------------------------------------------------------------------------
@router.get("")
def list_tasks() -> list[dict[str, Any]]:
    """Full raw task table (project/subtask fields included, unfiltered) -
    the source for the Management view and the schedule board's own fetch
    of ``/api/schedule`` builds on the same query."""
    return df_records(data.load_tasks_dataframe())


@router.get("/completions")
def list_completions(
    days: int = 30, limit: int = 300,
    year: int | None = None, system: str | None = None, device: str | None = None,
) -> list[dict[str, Any]]:
    """The completion audit trail (schema v26), newest first. Filters (Log tab): ``year`` (by
    the date logged; replaces ``days``), ``days`` <= 0 for all time, ``system`` (top-level,
    includes its devices), ``device`` (exact)."""
    return data.list_completions(days, limit, year=year, system=system, device=device)


@router.get("/completions/performed-by")
def performed_by_choices() -> list[dict[str, Any]]:
    """What to offer in a "who did the work" box: the crew roster PLUS every name already
    used in the history, deduplicated case-insensitively (tracker #44). Free text is still
    accepted on the way in - this only makes the common answers one tap away, which is what
    keeps the spelling consistent."""
    return data.list_performed_by_choices()


@router.get("/completions/facets")
def completion_facets() -> dict[str, Any]:
    """The Log tab's filter choices: years with entries, and systems with their devices."""
    return data.completion_facets()


class VoidBody(BaseModel):
    reason: str


class HistoricalRecord(BaseModel):
    """A past service record typed in after the fact - a yard invoice, a rigger's job,
    work done before the app existed. No task behind it (tracker #44)."""
    system: str
    what_was_done: str
    completed_on: str
    performed_by: str | None = None
    vendor: str | None = None
    cost: float | None = None
    notes: str | None = None
    parts: list[dict[str, Any]] | None = None
    # schema v33: file it under an invoice on record instead of giving it its own cost
    document_id: int | None = None
    # v34: how it went + follow-on task(s) (dicts: task_name, system?, description?, is_critical?)
    outcome: str | None = None
    follow_ons: list[dict[str, Any]] | None = None
    # v32 columns, first written here: what sort of event, and a path to its photo / PDF
    event_kind: str | None = None
    evidence_path: str | None = None


@router.post("/completions/historical")
def add_historical_record(body: HistoricalRecord) -> dict[str, int]:
    """Record work the app never saw. It lands in the same append-only history as a ticked
    completion, marked source='historical', and does NOT reschedule anything."""
    try:
        completion_id = data.add_historical_record(
            system=body.system, what_was_done=body.what_was_done,
            completed_on=body.completed_on, performed_by=body.performed_by,
            vendor=body.vendor, cost=body.cost, notes=body.notes, parts=body.parts,
            document_id=body.document_id, outcome=body.outcome, follow_ons=body.follow_ons,
            event_kind=body.event_kind, evidence_path=body.evidence_path,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"message": str(exc)}) from exc
    return {"completion_id": completion_id}


class FollowOnsBody(BaseModel):
    follow_ons: list[dict[str, Any]]


@router.post("/completions/{completion_id}/follow-ons")
def add_follow_ons(completion_id: int, body: FollowOnsBody) -> dict[str, list[int]]:
    """Raise follow-on task(s) from an existing history entry (schema v34) - the history row
    itself is not touched; each new task points back at it."""
    try:
        return {"task_ids": data.create_follow_on_tasks(completion_id, body.follow_ons)}
    except LookupError as exc:
        raise HTTPException(status_code=404, detail={"message": str(exc)}) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"message": str(exc)}) from exc


class CompletionDocument(BaseModel):
    document_id: int | None = None


@router.put("/completions/{completion_id}/document")
def set_completion_document(completion_id: int, body: CompletionDocument) -> dict[str, bool]:
    """File a history entry under an invoice, move it, or detach it (document_id null). The one
    change the append-only history allows besides voiding - it is a cross-reference, not an
    edit of what happened (schema v33)."""
    try:
        data.set_completion_document(completion_id, body.document_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail={"message": str(exc)}) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"message": str(exc)}) from exc
    return {"ok": True}


@router.post("/completions/{completion_id}/void")
def void_completion(completion_id: int, body: VoidBody) -> dict[str, Any]:
    """Void a history entry (append-only correction). If it was the task's latest
    completion, the task's last-done date is restored."""
    try:
        return data.void_completion(completion_id, body.reason)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class TaskCreate(BaseModel):
    system: str
    task_name: str
    description: str | None = None
    period: str = "immediate"
    interval_type: str = "break_fix"
    task_kind: str = "one_off"
    project_id: int | None = None
    parent_task_id: int | None = None
    caution_notes: str | None = None
    checklist_group: str | None = None
    phase_id: int | None = None
    hours_meter: str | None = None  # 'engine' / 'genset' for an hrs task (default engine)


@router.post("")
def create_task(body: TaskCreate) -> dict[str, int]:
    task_id = data.create_task(
        body.system, body.task_name,
        description=body.description, period=body.period,
        interval_type=body.interval_type, task_kind=body.task_kind,
        project_id=body.project_id, parent_task_id=body.parent_task_id,
        caution_notes=body.caution_notes, checklist_group=body.checklist_group,
        phase_id=body.phase_id, hours_meter=body.hours_meter,
    )
    return {"task_id": task_id}


# --------------------------------------------------------------------------
# systems picklist (schema v14 - tasks.system's governed picklist)
# --------------------------------------------------------------------------
@router.get("/systems")
def list_systems() -> list[dict[str, Any]]:
    return data.list_systems()


class SystemCreate(BaseModel):
    name: str
    parent_name: str | None = None
    sort_order: int | None = None
    notes: str | None = None


@router.post("/systems")
def create_system(body: SystemCreate) -> dict[str, str]:
    try:
        data.create_system(
            body.name, parent_name=body.parent_name,
            sort_order=body.sort_order, notes=body.notes,
        )
    except ValueError as exc:  # blank name / bad parent (nesting rules)
        raise HTTPException(status_code=400, detail={"message": str(exc)}) from exc
    except sqlite3.IntegrityError as exc:  # systems.name is the primary key
        raise HTTPException(
            status_code=409,
            detail={"message": f"a system named {body.name.strip()!r} already exists"},
        ) from exc
    return {"status": "ok"}


class SystemUpdate(BaseModel):
    parent_name: str | None = None
    sort_order: int | None = None
    notes: str | None = None
    # v22 device details
    make_model: str | None = None
    manual_ref: str | None = None
    installed_qty: int | None = None
    no_spares_needed: bool | None = None
    # v32 device identity (tracker #44). A field missing from this model is silently
    # DROPPED by model_dump(exclude_unset=True) and the PATCH still answers 200, so
    # every column added to _SYSTEM_MUTABLE has to be added here too.
    installed_on: str | None = None
    serial: str | None = None
    warranty_until: str | None = None


# A system/device name can contain a slash - 22 of the 147 on the boat do ("Berth A/C",
# "Fuel/ Oil", "Solar Controller - MPPT 150/45"...). A plain {name} compiles to [^/]+, so an
# encoded %2F (which the server decodes BEFORE routing) made the path one segment too long,
# no API route matched, and the request fell through to the SPA catch-all - which answers 200
# with index.html. That looked like a working request and silently did nothing. {name:path}
# matches across slashes; the trailing literal segments still bind correctly by backtracking.
@router.patch("/systems/{name:path}")
def update_system(name: str, body: SystemUpdate = Body(...)) -> dict[str, str]:
    try:
        data.update_system(name, **body.model_dump(exclude_unset=True))
    except ValueError as exc:  # unknown system / nesting rules
        raise HTTPException(status_code=400, detail={"message": str(exc)}) from exc
    return {"status": "ok"}


@router.get("/systems/{name:path}/items")
def system_items(name: str) -> list[dict[str, Any]]:
    """A device's parts and spare units (items linked to it) with on-hand."""
    return data.list_system_items(name)


class SystemRename(BaseModel):
    new_name: str


@router.post("/systems/{name:path}/rename")
def rename_system(name: str, body: SystemRename) -> dict[str, str]:
    try:
        data.rename_system(name, body.new_name)
    except ValueError as exc:  # blank name
        raise HTTPException(status_code=400, detail={"message": str(exc)}) from exc
    except sqlite3.IntegrityError as exc:  # systems.name is the primary key
        raise HTTPException(
            status_code=409,
            detail={"message": f"a system or device named {body.new_name.strip()!r} already exists"},
        ) from exc
    return {"status": "ok"}


class SystemClone(BaseModel):
    new_name: str
    copy_tasks: bool = True
    copy_parts: bool = True


@router.post("/systems/{name:path}/clone")
def clone_system(name: str, body: SystemClone) -> dict[str, Any]:
    """Duplicate a fully set-up device under a new name, with its part links and its
    own independent copies of its tasks (tracker #67). Returns a summary of what was
    copied - and what was skipped - so the UI can say so rather than guess."""
    try:
        return data.clone_system(
            name, body.new_name,
            copy_tasks=body.copy_tasks, copy_parts=body.copy_parts,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"message": str(exc)}) from exc
    except sqlite3.IntegrityError as exc:
        raise HTTPException(
            status_code=409,
            detail={"message": f"a system or device named {body.new_name.strip()!r} already exists"},
        ) from exc


class SystemDelete(BaseModel):
    reassign_to: str | None = None


@router.post("/systems/{name:path}/delete")
def delete_system(name: str, body: SystemDelete = Body(SystemDelete())) -> dict[str, str]:
    try:
        data.delete_system(name, reassign_to=body.reassign_to)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"status": "ok"}


@router.patch("/{task_id}")
def patch_task(task_id: int, fields: dict[str, Any] = Body(...)) -> dict[str, str]:
    try:
        data.update_task(task_id, **fields)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}


@router.delete("/{task_id}")
def remove_task(task_id: int) -> dict[str, str]:
    """Hard delete - refused (409) once the task has logged history. The UI offers
    Retire instead in that case; see data.task_delete_blockers (tracker #66)."""
    try:
        data.delete_task(task_id)
    except ValueError as e:
        raise HTTPException(
            status_code=409,
            detail={"message": str(e), "blockers": data.task_delete_blockers(task_id)},
        ) from e
    return {"status": "ok"}


class RetireBody(BaseModel):
    reason: str | None = None


@router.post("/{task_id}/retire")
def retire_task(task_id: int, body: RetireBody | None = None) -> dict[str, str]:
    """Take a task off the schedule and out of the pick lists, keeping its master
    row so task_completions stays threaded to it. Reversible."""
    data.retire_task(task_id, body.reason if body else None)
    return {"status": "ok"}


@router.post("/{task_id}/unretire")
def unretire_task(task_id: int) -> dict[str, str]:
    data.unretire_task(task_id)
    return {"status": "ok"}


@router.get("/{task_id}/referenced-by")
def get_task_referenced_by(task_id: int) -> dict[str, Any]:
    """Everywhere this task is spoken for - project, parent checklist, every inbound
    kind='task' link, its own native steps, and what its history would cost a delete.
    Feeds the consolidated "Referenced by" panel on TaskDetail (tracker #66)."""
    try:
        return data.get_task_referenced_by(task_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail={"message": str(e)}) from e


# --------------------------------------------------------------------------
# completion / deferral
# --------------------------------------------------------------------------
class CompleteBody(BaseModel):
    completed_on: str
    consumption: list[dict[str, Any]] | None = None
    close_subtasks: bool = False
    notes: str | None = None  # free text for THIS completion (audit trail)
    performed_by: str | None = None  # who did it - free text, offered from /crew (#44)
    # v34: how it went, and the follow-on task(s) it raised (one completion -> many)
    outcome: str | None = None
    follow_ons: list["FollowOn"] | None = None


class FollowOn(BaseModel):
    """A follow-on task raised from a history entry (schema v34). ``system`` defaults to the
    entry's own system/device."""
    task_name: str
    system: str | None = None
    description: str | None = None
    is_critical: bool = False
    urgency: str | None = None  # 'routine' (default) / 'urgent' / 'immediate' - tracker #70


CompleteBody.model_rebuild()


def _log_completed(task_id: int, completed_on: str, project_name: str | None) -> None:
    """The outbound completion webhook (a no-op until the previous developer gives an endpoint)."""
    task = data.get_task(task_id)  # fetched after, so hours_at_completion is fresh
    if task is not None:
        vessel_log.log_completion(
            task_id=task_id,
            system=task["system"],
            task_name=task["task_name"],
            task_kind=task["task_kind"],
            interval_type=task["interval_type"],
            completed_on=completed_on,
            hours_at_completion=task["hours_at_completion"],
            hours_meter=task["hours_meter"],
            period=task["period"],
            project_name=project_name,
        )


def _project_name_of(task_id: int) -> str | None:
    # Captured BEFORE completion: a recurring task's project_id gets cleared as a side effect
    # of completing it (data.complete_task's clear_project logic), so reading it after would
    # silently lose which project this completion belonged to.
    before = data.get_task(task_id)
    if before is not None and before["project_id"] is not None:
        project = data.get_project(before["project_id"])
        return project["name"] if project else None
    return None


@router.post("/{task_id}/complete")
def complete_task(task_id: int, body: CompleteBody) -> dict[str, Any]:
    project_name = _project_name_of(task_id)
    try:
        result = data.complete_task(
            task_id, body.completed_on, body.consumption,
            close_subtasks=body.close_subtasks, notes=body.notes,
            performed_by=body.performed_by, outcome=body.outcome,
            follow_ons=[f.model_dump() for f in body.follow_ons or []],
        )
    except ValueError as exc:  # bad outcome / follow-on system - nothing was written
        raise HTTPException(status_code=400, detail={"message": str(exc)}) from exc
    _log_completed(task_id, body.completed_on, project_name)
    return result


class TickBody(BaseModel):
    completed_on: str
    consumption: list[dict[str, Any]] | None = None
    performed_by: str | None = None


@router.post("/references/{ref_id}/tick")
def tick_checklist_link(ref_id: int, body: TickBody) -> dict[str, Any]:
    """Tick a linked task in a checklist run: a real completion of the linked task (noted
    with the checklist), remembered on the link so this run shows it done."""
    try:
        link = data.get_task_reference(ref_id)
        project_name = _project_name_of(link["ref_task_id"]) if link and link["ref_task_id"] else None
        result = data.tick_checklist_link(ref_id, body.completed_on, body.consumption,
                                          performed_by=body.performed_by)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"message": str(e)}) from e
    if not result["already"]:
        _log_completed(result["ref_task_id"], body.completed_on, project_name)
    return result


@router.post("/references/{ref_id}/untick")
def untick_checklist_link(ref_id: int) -> dict[str, str]:
    """Un-tick a linked task: voids the completion the tick recorded (the linked task's
    last-done date goes back) and reopens the link for this run."""
    try:
        data.untick_checklist_link(ref_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"message": str(e)}) from e
    return {"status": "ok"}


@router.post("/{task_id}/defer")
def defer_task(task_id: int, extra_units: int = Body(..., embed=True)) -> dict[str, str]:
    data.defer_task(task_id, extra_units)
    return {"status": "ok"}


@router.put("/{task_id}/deferral")
def set_deferral(task_id: int, units: int = Body(..., embed=True)) -> dict[str, str]:
    data.set_deferral(task_id, units)
    return {"status": "ok"}


@router.delete("/{task_id}/deferral")
def clear_deferral(task_id: int) -> dict[str, str]:
    data.clear_deferral(task_id)
    return {"status": "ok"}


@router.post("/{task_id}/clear-completion")
def clear_completion(task_id: int) -> dict[str, str]:
    """Un-check a single task (e.g. a checklist step ticked by mistake)."""
    data.clear_completion(task_id)
    return {"status": "ok"}


# --------------------------------------------------------------------------
# task <-> item requirement links
# --------------------------------------------------------------------------
@router.get("/{task_id}/items")
def get_task_items(task_id: int) -> list[dict[str, Any]]:
    return data.get_task_item_links(task_id)


@router.get("/{task_id}/items-demand")
def get_task_items_demand(task_id: int) -> list[dict[str, Any]]:
    """Every catalog item a task needs, with on-hand totals/shortfall/stow
    location - what the schedule card's "tick what you used up" consumption
    checklist needs. Distinct from GET /items above (task_item_links, the
    plain requirement-editing shape with no onhand data)."""
    return data.get_task_items(task_id)


class TaskItemLink(BaseModel):
    quantity_required: float = 1.0
    amount_note: str | None = None


@router.put("/{task_id}/items/{item_id}")
def set_task_item(task_id: int, item_id: int, body: TaskItemLink) -> dict[str, str]:
    data.set_task_item_link(task_id, item_id, body.quantity_required, body.amount_note)
    return {"status": "ok"}


@router.delete("/{task_id}/items/{item_id}")
def remove_task_item(task_id: int, item_id: int) -> dict[str, str]:
    data.remove_task_item_link(task_id, item_id)
    return {"status": "ok"}


# --------------------------------------------------------------------------
# project / parent wiring
# --------------------------------------------------------------------------
class ProjectAssignment(BaseModel):
    # A nullable *required* field, not Body(..., embed=True) - that combination
    # mishandles an explicit JSON `null` (FastAPI/pydantic report the field as
    # "missing" instead of accepting None). A model field doesn't have that bug.
    project_id: int | None


@router.put("/{task_id}/project")
def set_task_project(task_id: int, body: ProjectAssignment) -> dict[str, str]:
    """Assign (or clear, with ``project_id: null``) the task's project -
    the 'defer to the next haul-out' mechanism."""
    data.set_task_project(task_id, body.project_id)
    return {"status": "ok"}


class PhaseAssignment(BaseModel):
    phase_id: int | None  # nullable-required, same reason as ProjectAssignment


@router.put("/{task_id}/phase")
def set_task_phase(task_id: int, body: PhaseAssignment) -> dict[str, str]:
    """Put the task in one of ITS project's phases, or clear it (``null``)."""
    data.set_task_phase(task_id, body.phase_id)
    return {"status": "ok"}


class ParentAssignment(BaseModel):
    parent_task_id: int | None


@router.put("/{task_id}/parent")
def set_task_parent(task_id: int, body: ParentAssignment) -> dict[str, str]:
    data.set_task_parent(task_id, body.parent_task_id)
    return {"status": "ok"}


@router.get("/{task_id}/subtasks")
def get_subtasks(task_id: int) -> list[dict[str, Any]]:
    return data.get_subtasks(task_id)


# --------------------------------------------------------------------------
# task references (manuals, part numbers, urls, notes)
# --------------------------------------------------------------------------
@router.get("/{task_id}/references")
def get_task_references(task_id: int) -> list[dict[str, Any]]:
    return data.get_task_references(task_id)


class ReferenceCreate(BaseModel):
    kind: str
    label: str
    file_path: str | None = None
    page: int | None = None
    url: str | None = None
    note: str | None = None
    ref_task_id: int | None = None


@router.get("/{task_id}/linked-from")
def get_task_linked_from(task_id: int) -> list[dict[str, Any]]:
    """The checklists that link this task (the reverse of /references) - shown on the
    task's own screen so it can be added to / removed from checklists from there."""
    return data.get_task_linked_from(task_id)


@router.post("/{task_id}/references")
def add_task_reference(task_id: int, body: ReferenceCreate) -> dict[str, int]:
    try:
        ref_id = data.add_task_reference(
            task_id, body.kind, body.label,
            file_path=body.file_path, page=body.page, url=body.url, note=body.note,
            ref_task_id=body.ref_task_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"message": str(e)}) from e
    return {"ref_id": ref_id}


@router.get("/references/{ref_id}")
def get_task_reference(ref_id: int) -> dict[str, Any]:
    ref = data.get_task_reference(ref_id)
    if ref is None:
        raise HTTPException(status_code=404, detail={"message": "no such reference"})
    return ref


@router.patch("/references/{ref_id}")
def update_task_reference(ref_id: int, fields: dict[str, Any] = Body(...)) -> dict[str, str]:
    data.update_task_reference(ref_id, **fields)
    return {"status": "ok"}


@router.delete("/references/{ref_id}")
def delete_task_reference(ref_id: int) -> dict[str, str]:
    data.delete_task_reference(ref_id)
    return {"status": "ok"}


# --------------------------------------------------------------------------
# checklists (task_kind='checklist' + ordered one_off child steps)
# --------------------------------------------------------------------------
@router.get("/checklists")
def list_checklists() -> list[dict[str, Any]]:
    return data.list_checklists()


class ChecklistCreate(BaseModel):
    name: str
    system: str = "Checklists"
    interval_type: str = "use"
    period: str = "1"
    caution_notes: str | None = None


@router.post("/checklists")
def create_checklist(body: ChecklistCreate) -> dict[str, int]:
    checklist_id = data.create_checklist(
        body.name, system=body.system, interval_type=body.interval_type,
        period=body.period, caution_notes=body.caution_notes,
    )
    return {"task_id": checklist_id}


class ChecklistStepCreate(BaseModel):
    step_name: str
    description: str | None = None
    caution_notes: str | None = None
    group: str | None = None


@router.post("/{checklist_id}/checklist/steps")
def add_checklist_step(checklist_id: int, body: ChecklistStepCreate) -> dict[str, int]:
    step_id = data.add_checklist_step(
        checklist_id, body.step_name, description=body.description,
        caution_notes=body.caution_notes, group=body.group,
    )
    return {"task_id": step_id}


@router.get("/{checklist_id}/checklist/importable")
def list_importable_tasks(checklist_id: int) -> list[dict[str, Any]]:
    return data.list_importable_tasks(exclude_checklist_id=checklist_id)


@router.get("/{checklist_id}/checklist/print", response_class=HTMLResponse)
def print_checklist(checklist_id: int) -> HTMLResponse:
    """The print-on-demand sheet: one standalone page, fitted to one letter page in the browser
    (open it in a new tab, then Print / Save as PDF). Built fresh on every request."""
    page = print_sheet.render_checklist_sheet(checklist_id)
    if page is None:
        raise HTTPException(status_code=404, detail={"message": "no such checklist"})
    return HTMLResponse(page, headers={"Cache-Control": "no-store"})


@router.get("/{checklist_id}/checklist/items")
def get_checklist_items(checklist_id: int) -> list[dict[str, Any]]:
    """The checklist's own steps AND the tasks linked into it, in one ordered list
    (item_kind 'step' | 'link'); a link's `done` is per run."""
    return data.get_checklist_items(checklist_id)


@router.get("/{checklist_id}/checklist/linkable")
def list_linkable_tasks(checklist_id: int) -> list[dict[str, Any]]:
    """Every task that can be linked into this checklist, including ones already a step of
    another checklist (the one-box search on the checklist screen)."""
    return data.list_linkable_tasks(checklist_id)


@router.post("/{checklist_id}/checklist/import")
def import_task_as_step(
    checklist_id: int,
    task_id: int = Body(...),
    group: str | None = Body(None),
) -> dict[str, str]:
    data.import_task_as_step(task_id, checklist_id, group=group)
    return {"status": "ok"}


@router.post("/{checklist_id}/checklist/duplicate")
def duplicate_task_as_step(
    checklist_id: int,
    task_id: int = Body(...),
    group: str | None = Body(None),
) -> dict[str, int]:
    new_task_id = data.duplicate_task_as_step(task_id, checklist_id, group=group)
    return {"task_id": new_task_id}


@router.get("/{checklist_id}/checklist/groups")
def checklist_step_groups(checklist_id: int) -> list[str]:
    return data.checklist_step_groups(checklist_id)


@router.post("/{checklist_id}/checklist/reset")
def reset_checklist(checklist_id: int) -> dict[str, str]:
    data.reset_checklist(checklist_id)
    return {"status": "ok"}
