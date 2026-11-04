"""
Purpose: Tests for the cold-box restock link (Ship's Automation WF-502 / D-128): food received / stowed / added /
    moved into a cold-box place tells the rules engine (POST /restock), nothing else does, the write never fails
    because of the boat; and the cockpit's EXPECTED? question (GET / POST /api/cockpit/restock).
Version: v1 (2026-10-18)
Scope: PRODUCTION - mx-inv test suite.
Architecture: FastAPI TestClient (conftest `client`) over backend/routers/items.py + cockpit.py; the engine is a
    stub on boat_link.httpx (as tests/test_cockpit.py); COLD_BOXES is pointed at this test's own places.
Invocation: .venv\\Scripts\\python -m pytest tests/test_restock_link.py
"""
from __future__ import annotations

import httpx
import pytest

import data
from backend import boat_link, restock_link
from helpers import container, one

VIEW = {"hold_h": 2.0, "boxes": {
    "fridge": {"label": "REFRIGERATOR", "ask_rule": "WF-502-FRIDGE", "asking": True, "alarm": False, "mark": None},
    "fz_aft": {"label": "AFT FREEZER", "ask_rule": "WF-502-FZ-AFT", "asking": False, "alarm": False,
               "mark": {"kind": "hold", "since": "2026-10-18T15:00:00Z", "until": "2026-10-18T17:00:00Z",
                        "by": "api:mx-inv", "source": "mx-inv receive: Ice cream -> Freezer AFT"}}}}


class _Resp:
    def __init__(self, status: int, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


class _Calls(list):
    state: dict


@pytest.fixture
def engine(monkeypatch, tmp_path):
    calls = _Calls()
    state = {"post_status": 200}
    tok = tmp_path / "engine.env"
    tok.write_text("ENGINE_API_TOKEN=s3cret\n", encoding="utf-8")
    monkeypatch.setenv("MXINV_ENGINE_URL", "http://engine.test:8200")
    monkeypatch.setenv("MXINV_ENGINE_TOKEN_FILE", str(tok))
    monkeypatch.delenv("MXINV_ENGINE_TOKEN", raising=False)

    def get(url, **kw):
        calls.append(("GET", url, None))
        return _Resp(200, VIEW)

    def post(url, json=None, headers=None, **kw):
        calls.append(("POST", url, json))
        if state["post_status"] == 409:
            return _Resp(409, {"detail": "the REFRIGERATOR alarm is already up - no restock hold"})
        return _Resp(200, VIEW)

    monkeypatch.setattr(boat_link.httpx, "get", get)
    monkeypatch.setattr(boat_link.httpx, "post", post)
    calls.state = state
    return calls


@pytest.fixture
def places(db, monkeypatch):
    """A fridge, an aft freezer and a dry locker; the first two mapped as cold boxes."""
    fridge, freezer, locker = container("Fridge loose", "refrigerated"), container("Freezer loose", "frozen"), container("Locker")
    loc = {c: one("SELECT location_id FROM storage_containers WHERE container_id = ?", (c,)) for c in (fridge, freezer)}
    monkeypatch.setattr(restock_link, "COLD_BOXES", {loc[fridge]: "fridge", loc[freezer]: "fz_aft"})
    pizza = data.create_item("Pizza", "food")
    return {"fridge": fridge, "freezer": freezer, "locker": locker, "pizza": pizza}


def posts(calls):
    return [c[2] for c in calls if c[0] == "POST" and c[1].endswith("/restock")]


def test_receive_into_the_fridge_marks_it_restocked(client, engine, places):
    r = client.post(f"/api/items/{places['pizza']}/receive",
                    json={"lines": [{"container_id": places["fridge"], "quantity": 2}]})
    assert r.status_code == 200
    assert posts(engine) == [{"box": "fridge", "answer": "restock", "by": "mx-inv",
                              "source": "mx-inv receive: Pizza -> Loc for Fridge loose"}]


def test_one_receive_split_across_fridge_and_freezer_marks_both(client, engine, places):
    client.post(f"/api/items/{places['pizza']}/receive",
                json={"lines": [{"container_id": places["fridge"], "quantity": 1},
                                {"container_id": places["freezer"], "quantity": 3}]})
    assert sorted(p["box"] for p in posts(engine)) == ["fridge", "fz_aft"]


def test_a_dry_locker_or_a_zero_home_row_is_not_a_restock(client, engine, places):
    client.post(f"/api/items/{places['pizza']}/receive", json={"lines": [{"container_id": places["locker"], "quantity": 2}]})
    client.post("/api/items/stow", json={"container_id": places["freezer"],
                                         "lines": [{"item_id": places["pizza"], "quantity": 0}]})
    assert posts(engine) == []


def test_stow_add_and_move_into_a_cold_box_mark_it(client, engine, places):
    client.post("/api/items/stow", json={"container_id": places["freezer"],
                                         "lines": [{"item_id": places["pizza"], "quantity": 1}]})
    r = client.post(f"/api/items/{places['pizza']}/stock", json={"container_id": places["locker"], "quantity": 4})
    assert posts(engine)[-1]["box"] == "fz_aft" and len(posts(engine)) == 1       # the locker add is not one
    sid = r.json()["stock_id"]
    r = client.patch(f"/api/items/stock/{sid}", json={"reason": "transfer", "fields": {"container_id": places["fridge"]}})
    assert r.status_code == 200
    assert posts(engine)[-1]["box"] == "fridge" and posts(engine)[-1]["source"].startswith("mx-inv move: Pizza")


def test_the_receive_never_fails_because_of_the_boat(client, engine, places, monkeypatch):
    engine.state["post_status"] = 409                                             # alarm already up
    r = client.post(f"/api/items/{places['pizza']}/receive",
                    json={"lines": [{"container_id": places["fridge"], "quantity": 1}]})
    assert r.status_code == 200 and len(posts(engine)) == 1

    def down(*a, **k):
        raise httpx.ConnectError("refused")
    monkeypatch.setattr(boat_link.httpx, "post", down)
    r = client.post(f"/api/items/{places['pizza']}/receive",
                    json={"lines": [{"container_id": places["fridge"], "quantity": 1}]})
    assert r.status_code == 200
    assert one("SELECT SUM(quantity) FROM stock WHERE item_id = ?", (places["pizza"],)) == 2


def test_no_engine_configured_no_post(client, places, monkeypatch):
    for v in ("MXINV_ENGINE_URL", "MXINV_ENGINE_TOKEN", "MXINV_ENGINE_TOKEN_FILE"):
        monkeypatch.delenv(v, raising=False)
    sent = []
    monkeypatch.setattr(boat_link.httpx, "post", lambda *a, **k: sent.append(a))
    r = client.post(f"/api/items/{places['pizza']}/receive",
                    json={"lines": [{"container_id": places["fridge"], "quantity": 1}]})
    assert r.status_code == 200 and sent == []


def test_the_live_mapping_is_lees_five_places():
    assert restock_link.COLD_BOXES == {115: "fridge", 90: "engel", 89: "engel", 97: "fz_aft", 99: "fz_fwd"}


# --- the cockpit's EXPECTED? question ------------------------------------------------------------

def test_cockpit_restock_view_and_answers(client, engine):
    assert client.get("/api/cockpit/capabilities").json()["restock"] is True
    v = client.get("/api/cockpit/restock").json()
    assert [b["box"] for b in v["boxes"]] == ["fridge", "fz_aft"]
    assert v["boxes"][0]["asking"] is True and v["boxes"][1]["mark"]["kind"] == "hold" and v["can_write"] is True
    for ans in ("yes", "no"):
        assert client.post("/api/cockpit/restock", json={"box": "fridge", "answer": ans}).status_code == 200
        assert posts(engine)[-1] == {"box": "fridge", "answer": ans, "by": "cockpit"}


def test_cockpit_restock_bad_input_never_reaches_engine(client, engine):
    assert client.post("/api/cockpit/restock", json={"box": "bilge", "answer": "yes"}).status_code == 400
    assert client.post("/api/cockpit/restock", json={"box": "fridge", "answer": "restock"}).status_code == 400
    assert posts(engine) == []


def test_cockpit_restock_409_when_the_alarm_is_already_up(client, engine):
    engine.state["post_status"] = 409
    r = client.post("/api/cockpit/restock", json={"box": "fridge", "answer": "yes"})
    assert r.status_code == 409 and "already up" in r.json()["detail"]


def test_cockpit_restock_old_engine_501(client, engine, monkeypatch):
    monkeypatch.setattr(boat_link.httpx, "get", lambda url, **kw: _Resp(404, {"detail": "Not Found"}))
    r = client.get("/api/cockpit/restock")
    assert r.status_code == 501 and "no restock watch yet" in r.json()["detail"]
