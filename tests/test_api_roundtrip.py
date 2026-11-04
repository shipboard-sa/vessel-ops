"""
Purpose: Write round-trip tests - every field sent to a write route is READ BACK from the
    database, never trusted from the status code (a field missing from a pydantic model or a
    data.py whitelist is silently dropped while the write still answers 200 - bit twice).
Version: v1 (2026-09-24)
Scope: PRODUCTION - mx-inv test suite (hardening plan phase 1; phase 4 flips the xfails).
Architecture: TestClient over backend.main:app on a per-test database, read-back via raw SQL
    (helpers.sql). The strict xfails document today's gap - unknown fields are accepted and
    ignored - and turn into failures (remove the marker) once phase 4's typed bodies reject them.
"""
from __future__ import annotations

import pytest

from helpers import container, d, days_task, one, part, sql, system

pytestmark = pytest.mark.usefixtures("db")


def _ok(r):
    assert r.status_code == 200, (r.status_code, r.text)
    assert r.headers["content-type"].startswith("application/json"), r.headers["content-type"]
    return r.json()


def test_item_create_and_patch_every_mutable_field(client):
    item_id = _ok(client.post("/api/items", json={
        "item_name": "Impeller", "item_type": "part", "unit": "ea",
        "min_quantity": 1, "target_quantity": 3, "notes": "Jabsco"}))["item_id"]
    row = sql("SELECT * FROM items WHERE item_id = ?", (item_id,))[0]
    assert (row["item_name"], row["unit"], row["min_quantity"], row["target_quantity"], row["notes"]) == \
        ("Impeller", "ea", 1, 3, "Jabsco")
    patch = {"item_name": "Impeller kit", "min_quantity": 2, "target_quantity": 4, "notes": "Jabsco 1210",
             "stocking_policy": "critical_spare", "annual_usage": 1.5, "reorder_buffer": 1, "min_hold": 2}
    _ok(client.patch(f"/api/items/{item_id}", json=patch))
    row = dict(sql("SELECT * FROM items WHERE item_id = ?", (item_id,))[0])
    for k, v in patch.items():
        assert row[k] == v, k


def test_task_create_every_field(client):
    system("Engine")
    body = {"system": "Engine", "task_name": "Impeller", "description": "swap it",
            "period": "250", "interval_type": "hrs", "task_kind": "recurring",
            "caution_notes": "close seacock", "hours_meter": "genset"}
    tid = _ok(client.post("/api/tasks", json=body))["task_id"]
    row = dict(sql("SELECT * FROM tasks WHERE task_id = ?", (tid,))[0])
    assert row["task_description"] == "swap it"
    for k in ("system", "task_name", "period", "interval_type", "task_kind", "caution_notes", "hours_meter"):
        assert row[k] == body[k], k


def test_task_patch_fields(client):
    tid = days_task()
    _ok(client.patch(f"/api/tasks/{tid}", json={"task_name": "Oil + filter", "period": "60",
                                                 "is_critical": True, "caution_notes": "hot"}))
    row = sql("SELECT task_name, period, is_critical, caution_notes FROM tasks WHERE task_id = ?", (tid,))[0]
    assert tuple(row) == ("Oil + filter", "60", 1, "hot")


def test_system_patch_device_identity(client):
    system("Electrical")
    system("Charger - 24/12", parent="Electrical")     # a slash in the name (the v32 bug)
    body = {"make_model": "Victron Orion", "manual_ref": "orion.pdf", "installed_qty": 2,
            "no_spares_needed": True, "installed_on": "2025-03-01", "serial": "HQ123",
            "warranty_until": "2030-03-01", "notes": "port side"}
    _ok(client.patch("/api/tasks/systems/Charger - 24%2F12", json=body))
    row = dict(sql("SELECT * FROM systems WHERE name = ?", ("Charger - 24/12",))[0])
    for k, v in body.items():
        assert row[k] == (1 if v is True else v), k


def test_complete_via_api_every_field(client):
    tid = days_task(last_done=d(-40))
    item = part()
    data_bin = container()
    client.post(f"/api/items/{item}/stock", json={"container_id": data_bin, "quantity": 2})
    res = _ok(client.post(f"/api/tasks/{tid}/complete", json={
        "completed_on": d(0), "consumption": [{"item_id": item, "quantity": 1}],
        "notes": "done", "performed_by": "Owner", "outcome": "partial",
        "follow_ons": [{"task_name": "Finish it"}]}))
    c = sql("SELECT * FROM task_completions WHERE completion_id = ?", (res["completion_id"],))[0]
    assert (c["completed_on"], c["notes"], c["performed_by"], c["outcome"]) == (d(0), "done", "Owner", "partial")
    assert one("SELECT COUNT(*) FROM tasks WHERE origin_completion_id = ?", (res["completion_id"],)) == 1
    assert one("SELECT quantity FROM stock WHERE item_id = ?", (item,)) == 1


def test_historical_record_every_field(client):
    system("Hull")
    body = {"system": "Hull", "what_was_done": "Bottom paint", "completed_on": "2025-05-01",
            "performed_by": "Yard crew", "vendor": "Seabrook", "cost": 2500.0, "notes": "2 coats",
            "parts": [{"item_name": "Paint", "part_number": "P1", "quantity": 3, "unit": "gal"}],
            "outcome": "done_ok", "event_kind": "haul_out", "evidence_path": "photos/bottom.jpg"}
    cid = _ok(client.post("/api/tasks/completions/historical", json=body))["completion_id"]
    c = dict(sql("SELECT * FROM task_completions WHERE completion_id = ?", (cid,))[0])
    assert c["system"] == "Hull" and c["task_name"] == "Bottom paint"
    for k in ("completed_on", "performed_by", "vendor", "cost", "notes", "outcome", "event_kind", "evidence_path"):
        assert c[k] == body[k], k
    p = sql("SELECT item_name, part_number, quantity, unit FROM task_completion_parts WHERE completion_id = ?", (cid,))
    assert [tuple(r) for r in p] == [("Paint", "P1", 3, "gal")]


def test_document_every_field(client):
    body = {"vendor": "Gulf Solutions", "doc_number": "1167", "doc_date": "2025-06-01",
            "period_start": None, "period_end": None, "total": 812.5, "file_path": "inv/1167.pdf",
            "project_id": None, "expense_class": "Class A", "notes": "alternator"}
    doc = _ok(client.post("/api/documents", json=body))["document_id"]
    row = dict(sql("SELECT * FROM documents WHERE document_id = ?", (doc,))[0])
    for k, v in body.items():
        assert row[k] == v, k
    body2 = {**body, "doc_number": "1168", "total": 900.0}
    _ok(client.put(f"/api/documents/{doc}", json=body2))
    row = sql("SELECT doc_number, total FROM documents WHERE document_id = ?", (doc,))[0]
    assert tuple(row) == ("1168", 900.0)


def test_settings_round_trip(client):
    body = {"vessel_name": "SV Test", "engine_label": "Yanmar", "genset_label": "Westerbeke",
            "manuals_root": "C:/manuals"}
    _ok(client.put("/api/settings", json=body))
    got = _ok(client.get("/api/settings"))
    for k, v in body.items():
        assert got[k] == v, k


def test_receive_via_api(client):
    item, bin_ = part(), container()
    _ok(client.post(f"/api/items/{item}/receive", json={
        "lines": [{"container_id": bin_, "quantity": 2, "expiry_date": d(100)}],
        "acquired_on": d(-1)}))
    row = sql("SELECT quantity, expiry_date, acquired_on FROM stock WHERE item_id = ?", (item,))[0]
    assert tuple(row) == (2, d(100), d(-1))


def test_container_patch_favorite_and_move(client):
    bin_ = container("Bin A")
    loc = one("SELECT location_id FROM storage_locations WHERE location_name = 'Loc for Bin A'")
    other = container("Bin B")
    other_loc = one("SELECT location_id FROM storage_containers WHERE container_id = ?", (other,))
    _ok(client.patch(f"/api/storage/containers/{bin_}", json={"favorite": 1, "location_id": other_loc}))
    row = sql("SELECT favorite, location_id FROM storage_containers WHERE container_id = ?", (bin_,))[0]
    assert tuple(row) == (1, other_loc) and other_loc != loc


def test_bad_input_is_a_4xx_not_a_silent_200(client):
    system("Engine")
    r = client.post("/api/tasks/completions/historical",
                    json={"system": "Nope", "what_was_done": "x", "completed_on": d(0)})
    assert r.status_code == 400
    r = client.post("/api/items", json={"item_name": "X", "item_type": "part", "unit": "furlongs"})
    assert r.status_code == 422


# --- today's gap, fixed by phase 4 (typed request bodies) - remove the marker then ---------
@pytest.mark.xfail(strict=True, reason="phase 4: untyped PATCH bodies ignore unknown fields")
def test_unknown_item_field_is_rejected(client):
    item = part()
    r = client.patch(f"/api/items/{item}", json={"no_such_field": 1})
    assert r.status_code in (400, 422)


@pytest.mark.xfail(strict=True, reason="phase 4: pydantic models ignore extra fields by default")
def test_unknown_system_field_is_rejected(client):
    system("Engine")
    r = client.patch("/api/tasks/systems/Engine", json={"serial_number": "typo'd column"})
    assert r.status_code in (400, 422)
