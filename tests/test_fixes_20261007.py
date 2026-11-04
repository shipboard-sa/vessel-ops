"""
Purpose: Regression tests for the two defects found by the 2026-10-07 documentation pass: GET /api/recipes list
    filters must be real query parameters, and deleting a system named by a ship's log entry must be refused with
    a clear 409 (the log is append-only) instead of a raw foreign-key error.
Version: v1 (2026-10-07)
Scope: PRODUCTION - mx-inv test suite.
Architecture: conftest's example_client (fictional SV Example data - has systems and recipes).
Invocation: .venv/Scripts/python -m pytest tests/test_fixes_20261007.py
"""
from __future__ import annotations

import data


def test_recipe_filters_are_query_params(example_client):
    everything = example_client.get("/api/recipes")
    assert everything.status_code == 200, everything.text
    assert everything.json(), "example data has no recipes - this test would prove nothing"
    none = example_client.get("/api/recipes", params={"tags": "no-such-tag-zz9"})
    assert none.status_code == 200, none.text
    assert none.json() == [] or len(none.json()) < len(everything.json()), \
        "the tags filter was ignored - it is not being read from the query string"


def test_delete_system_named_by_log_entry_is_refused(example_client):
    with data.connect() as c:
        name = c.execute("SELECT name FROM systems WHERE parent_name IS NOT NULL LIMIT 1").fetchone()[0]
    r = example_client.post("/api/logbook", json={
        "kind": "observation", "title": "Noted a drip", "system": name, "source": "desktop"})
    assert r.status_code == 200, r.text
    d = example_client.post(f"/api/tasks/systems/{name}/delete", json={})
    assert d.status_code == 409, d.text
    assert "append-only" in d.json()["detail"]
    with data.connect() as c:
        assert c.execute("SELECT 1 FROM systems WHERE name = ?", (name,)).fetchone() is not None
