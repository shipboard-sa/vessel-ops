"""
Purpose: The automatic DECK LOG - the ship's log writes its own status entries like a traditional deck log (the owner
    2026-10-05: "this is the ship's log - no more paper"): every hour on the hour underway (MOTOR / SAIL), at 08:00
    and 20:00 otherwise (ANCHOR / DOCK / AWAY), each a full status line (position, mode, COG / SOG, wind, barometer,
    depth, fuel / water) with the handover card saved as its stamp.
Version: v1 (2026-10-05)
Scope: PRODUCTION - mx-inv backend.
Architecture: A daemon thread started by backend/main.py (only when MXINV_SIGNALK_URL is set and MXINV_DECK_LOG is
    not 'off'); once a minute it asks due_slot() whether a report is due and writes it through data.create_log_entry
    (kind 'status', source 'auto', record 'log' - in the ship's log, not in the watch handover). Idempotent: the
    slot time is the entry's source_event_id, so a restart never writes a slot twice. A slot missed while mx-inv
    was down is SKIPPED, never back-filled with invented data. status_line() is also used for engine events'
    stamps (backend/routers/logbook.py).
Invocation: start_thread() from backend/main.py; tests call write_due(now) directly.
"""
from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime
from typing import Any

import data
from backend import boat_link, log_stamp

UNDERWAY = ("MOTOR", "SAIL")
FIXED_HOURS = (8, 20)          # at anchor / docked / away
GRACE_MIN = 10                 # a slot is still written up to 10 min late (e.g. right after a restart), never later


def due_slot(now: datetime, mode: str | None) -> datetime | None:
    """The report slot `now` falls in (top of the hour), if one is due for this mode and we are within the grace."""
    if now.minute >= GRACE_MIN:
        return None
    slot = now.replace(minute=0, second=0, microsecond=0)
    if (mode or "").upper() in UNDERWAY or slot.hour in FIXED_HOURS:
        return slot
    return None


def _dm(v: float, pos: str, neg: str, width: int) -> str:
    a = abs(v)
    d = int(a)
    return f"{d:0{width}d}°{(a - d) * 60:05.2f}'{pos if v >= 0 else neg}"


def status_line(st: dict[str, Any] | None) -> str:
    """One deck-log line from a stamp (log_stamp.stamp) - missing values are simply left out."""
    if not st:
        return "No boat data (the boat stack is not answering)."
    card = st.get("card") or {}
    parts = []
    if st.get("lat") is not None and st.get("lon") is not None:
        parts.append(f"{_dm(st['lat'], 'N', 'S', 2)} {_dm(st['lon'], 'E', 'W', 3)}")
    if st.get("mode"):
        parts.append(st["mode"])
    if st.get("sog_kn") is not None:
        parts.append(f"SOG {st['sog_kn']} kn" + (f" COG {st['cog_deg']}°T" if st.get("cog_deg") is not None else ""))
    if st.get("sail_set"):
        parts.append(st["sail_set"])
    if st.get("engine_hours") is not None:
        parts.append(f"engine {st['engine_hours']:g} h")
    if st.get("wind_apparent_kn") is not None:
        w = f"wind {st['wind_apparent_kn']} kn app"
        a = st["wind_apparent_deg"] if st.get("wind_apparent_deg") is not None else card.get("wind_apparent_deg")
        if a is not None:
            w += f" {abs(a):.0f}° {'port' if a < 0 else 'stbd'}"
        parts.append(w)
    if st.get("baro_hpa") is not None:
        b = f"baro {st['baro_hpa']} hPa"
        if card.get("baro_3h_change_hpa") is not None:
            b += f" ({card['baro_3h_change_hpa']:+} / 3 h)"
        parts.append(b)
    out = card.get("outside") or {}
    if out.get("waves"):
        w = out["waves"]
        parts.append(f"seas {w['height_ft']} ft" + (f" @ {w['period_s']:g} s" if w.get("period_s") is not None else "")
                     + f" ({(w.get('station') or '').split(' ')[0]}, {w.get('nm')} nm)")
    if out.get("obs"):
        o = out["obs"]
        parts.append(f"{(o.get('station') or '').split(' ')[0]} wind {o['wind_kn']} kn"
                     + (f" from {o['wind_from_deg']:g}°" if o.get("wind_from_deg") is not None else ""))
    if card.get("depth_ft") is not None:
        parts.append(f"depth {card['depth_ft']} ft")
    for k, label in (("fuel", "fuel"), ("water", "water")):
        t = card.get(k)
        if t and t.get("gal") is not None:
            parts.append(f"{label} {t['gal']} gal")
    if card.get("distance_this_watch_nm") is not None and (st.get("mode") or "") in UNDERWAY:
        parts.append(f"{card['distance_this_watch_nm']} nm in {card.get('watch_hours', 6):g} h")
    return " · ".join(parts) or "No boat data."


def write_due(now: datetime | None = None) -> dict[str, Any] | None:
    """Write the status entry for the current slot if one is due and not yet written. Returns it, else None."""
    now = now or datetime.now()
    st = log_stamp.stamp(0, with_card=True)
    mode = (st or {}).get("mode")
    slot = due_slot(now, mode)
    if slot is None:
        return None
    key = f"status-{slot.isoformat(timespec='minutes')}"
    stamp = dict(st or {})
    line = status_line(stamp)
    if "card" in stamp:
        stamp["card_json"] = json.dumps(stamp.pop("card"))
    try:
        return data.create_log_entry(
            "status", f"Status {slot:%H%M}", source="auto", body=line, author="ship's log",
            occurred_at=slot.isoformat(timespec="minutes"), stamp=stamp, source_event_id=key, record="log")
    except data.DuplicateEvent:
        return None                                    # already written for this slot (restart / second process)


def _loop(stop: threading.Event) -> None:
    while not stop.wait(60 - time.time() % 60 + 1):    # just after each minute boundary
        try:
            write_due()
        except Exception as e:                         # noqa: BLE001 - the deck log must never take the server down
            print(f"deck log: {type(e).__name__}: {e}")


def start_thread() -> threading.Event | None:
    if boat_link.signalk_url() is None or os.environ.get("MXINV_DECK_LOG", "").strip().lower() == "off":
        return None
    stop = threading.Event()
    threading.Thread(target=_loop, args=(stop,), name="deck-log", daemon=True).start()
    return stop
