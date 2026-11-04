"""Invoices and receipts on file - the `documents` table (schema v33, tracker #44).

Purpose: HTTP surface for recording vendor invoices / receipts, the year view ("invoices on
    file" per expense class) and its CSV export.
Version: v1 (2026-09-22)
Scope: PRODUCTION - mx-inv backend.
Architecture: Mounted by backend/main.py. Every call goes through data.py
    (list/get/create/update/delete_document, list_expense_classes, documents_year_view). Filing
    a history entry under an invoice lives with the rest of the history routes, at
    PUT /api/tasks/completions/{id}/document. Read the design first:
    design/INVOICE_DOCUMENTS_DESIGN.md.

Nothing here produces a "total spend". The card / bank statement is the authority; every figure
this router returns is a sum of the paper that has been indexed, and the UI heads it that way.
"""
from __future__ import annotations

import csv
import io
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

import data

router = APIRouter(prefix="/api/documents", tags=["documents"])


class DocumentBody(BaseModel):
    vendor: str
    doc_number: str | None = None
    doc_date: str | None = None
    period_start: str | None = None
    period_end: str | None = None
    total: float | None = None
    file_path: str | None = None
    project_id: int | None = None
    expense_class: str | None = None
    notes: str | None = None


def _bad(exc: Exception, status: int = 400) -> HTTPException:
    return HTTPException(status_code=status, detail={"message": str(exc)})


@router.get("")
def list_documents(year: int | None = None) -> list[dict[str, Any]]:
    return data.list_documents(year=year)


@router.get("/years")
def document_years() -> list[int]:
    return data.document_years()


@router.get("/expense-classes")
def expense_classes() -> list[dict[str, Any]]:
    """Every expense class already used, most-used first - offered back so the spelling stays
    stable. Free text is still accepted on the way in."""
    return data.list_expense_classes()


@router.get("/year/{year:int}")
def year_view(year: int) -> dict[str, Any]:
    return data.documents_year_view(year)


@router.get("/year/{year:int}/csv")
def year_csv(year: int) -> Response:
    """One row per invoice on file for the year, for reconciling beside the card summary in a
    spreadsheet. Flat on purpose (pivot it there); no grand-total row, for the same reason the
    screen has none that claims to be the year's spend."""
    view = data.documents_year_view(year)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["expense_class", "date", "period_start", "period_end", "vendor", "invoice_no",
                "total", "project", "history_entries_filed", "file_path", "notes"])
    for g in view["classes"]:
        for d in sorted(g["documents"], key=lambda d: (d.get("doc_day") or "", d["document_id"])):
            w.writerow([g["expense_class"], d.get("doc_date") or "", d.get("period_start") or "",
                        d.get("period_end") or "", d["vendor"], d.get("doc_number") or "",
                        "" if d.get("total") is None else f"{float(d['total']):.2f}",
                        d.get("project_name") or "", d.get("completion_count") or 0,
                        d.get("file_path") or "", d.get("notes") or ""])
    return Response(
        content="﻿" + buf.getvalue(),  # BOM so Excel opens it as UTF-8
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="invoices-on-file-{year}.csv"'},
    )


@router.get("/{document_id:int}")
def get_document(document_id: int) -> dict[str, Any]:
    try:
        return data.get_document(document_id)
    except LookupError as exc:
        raise _bad(exc, 404) from exc


@router.post("")
def create_document(body: DocumentBody) -> dict[str, int]:
    try:
        return {"document_id": data.create_document(**body.model_dump())}
    except ValueError as exc:
        raise _bad(exc) from exc


@router.put("/{document_id:int}")
def update_document(document_id: int, body: DocumentBody) -> dict[str, bool]:
    try:
        data.update_document(document_id, **body.model_dump())
    except LookupError as exc:
        raise _bad(exc, 404) from exc
    except ValueError as exc:
        raise _bad(exc) from exc
    return {"ok": True}


@router.delete("/{document_id:int}")
def delete_document(document_id: int) -> dict[str, bool]:
    try:
        data.delete_document(document_id)
    except LookupError as exc:
        raise _bad(exc, 404) from exc
    except ValueError as exc:
        raise _bad(exc, 409) from exc
    return {"ok": True}
