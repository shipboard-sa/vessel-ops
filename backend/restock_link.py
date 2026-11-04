"""
Purpose: Tell the boat's rules engine a cold box was RESTOCKED when food goes into it in mx-inv (Ship's Automation
    WF-502 / D-128): that box's WF-501 food-safety alarm then waits 2 h while it cools back down.
Version: v1 (2026-10-18)
Scope: PRODUCTION - mx-inv backend (staged 2026-10-18 on branch wf502-restock, not deployed).
Architecture: Called by backend/routers/items.py after a receive, a stow, an add-stock or a stock move succeeds - as a
    FastAPI background task, so the write never waits on the boat and never fails because of it. Maps the target
    container's storage PLACE to the engine's box key (COLD_BOXES - the owner 10-18: the five Galley places below; both
    Engel places = the one Engel), then POST /restock {box, answer: restock, by: mx-inv, source} through
    backend/boat_link.py with the engine token. Engine down / no token / 409 (that box's alarm is already up - a
    receive never silences a real alarm) = logged and dropped. Quantity 0 lines (a 'home' row) are not a restock.
Invocation: imported by backend/routers/items.py; needs MXINV_ENGINE_URL + the engine token (run-live.bat), else off.
"""
from __future__ import annotations

import logging
from typing import Iterable

import data
from backend import boat_link

log = logging.getLogger("mxinv.restock")

# storage_locations.location_id -> engine box key (rules engine builtins/restock.py BOXES). the owner 10-18 (OQ-125 Q3).
COLD_BOXES: dict[int, str] = {
    115: "fridge",     # Galley / Refrigerator  -> WF-501-FRIDGE
    90: "engel",       # Galley / Engel Refrigerator  -> WF-501-ENGEL (one box, one Ruuvi)
    89: "engel",       # Galley / Engel Freezer        -> the same Engel
    97: "fz_aft",      # Galley / Freezer AFT   -> WF-501-FZ-AFT
    99: "fz_fwd",      # Galley / Freezer FWD   -> WF-501-FZ-FWD
}


def cold_targets(lines: Iterable[tuple[int | None, int, float]]) -> dict[str, list[str]]:
    """lines = (container_id, item_id, quantity). Returns box -> ['<item> -> <place>', ...] for every line with
    quantity > 0 going into a cold-box place. Read-only."""
    wanted = [(c, i) for c, i, q in lines if c is not None and q and q > 0]
    if not wanted:
        return {}
    out: dict[str, list[str]] = {}
    with data.connect() as conn:
        for cid, iid in wanted:
            row = conn.execute(
                "SELECT sc.location_id, sl.location_name, i.item_name FROM storage_containers sc "
                "JOIN storage_locations sl USING (location_id) JOIN items i ON i.item_id = ? "
                "WHERE sc.container_id = ?", (iid, cid)).fetchone()
            if row is None or row["location_id"] not in COLD_BOXES:
                continue
            out.setdefault(COLD_BOXES[row["location_id"]], []).append(f"{row['item_name']} -> {row['location_name']}")
    return out


def notify(lines: list[tuple[int | None, int, float]], what: str) -> list[str]:
    """Background task: mark each cold box that got food. Never raises. Returns the boxes the engine accepted."""
    if not boat_link.engine_can_write():
        return []
    try:
        targets = cold_targets(lines)
    except Exception:                                   # noqa: BLE001 - a lookup bug must not surface after a receive
        log.exception("restock: could not map containers to cold boxes")
        return []
    done = []
    for box, names in targets.items():
        source = f"mx-inv {what}: {', '.join(names)}"[:80]
        try:
            boat_link.engine_post("/restock", {"box": box, "answer": "restock", "by": "mx-inv", "source": source})
            done.append(box)
        except boat_link.BoatLinkError as e:
            log.warning("restock %s not marked (%s): %s", box, source, e)
    return done
