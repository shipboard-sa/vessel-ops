"""
Purpose: The logbook's auto-stamp - what the boat said when an entry happened (position, speed, course, apparent
    wind, barometer, boat mode, sail set), taken from the boat stack, never typed by the crew.
Version: v2 (2026-10-05) - v2: the apparent wind ANGLE too (signed, + starboard / - port; the owner's review).
    v1 (2026-10-05)
Scope: PRODUCTION - mx-inv backend.
Architecture: Used by backend/routers/logbook.py. "Now" = one SignalK snapshot through handover_card.build_card (the
    same units / staleness rules as the handover card) + the engine's mode + SignalK sails.activeSet. A back-dated
    entry ("10 min ago") reads position / speed / barometer at that time from the history read API instead. Every
    part is best-effort: the boat stack down = an entry with no stamp, never a failed entry.
Invocation: imported by backend/routers/logbook.py.
"""
from __future__ import annotations

import math
import time
from typing import Any

from backend import boat_link, handover_card


def _sail_label() -> str | None:
    try:
        leaf = boat_link.signalk_get("sails.activeSet")
    except boat_link.BoatLinkError:
        return None
    v = leaf.get("value") if leaf else None
    return v.get("label") if isinstance(v, dict) else None


def _mode() -> str | None:
    if not boat_link.engine_enabled():
        return None
    try:
        return boat_link.engine_get("/status").get("mode")
    except boat_link.BoatLinkError:
        return None


def _hist(path: str, t: float, scale: float = 1.0, nd: int = 1) -> float | None:
    v = boat_link.history_at(path, t)
    return None if v is None else round(v * scale, nd)


def _awa(rad: float | None) -> float | None:
    """SignalK angleApparent (radians) -> signed degrees, + starboard / - port."""
    return None if rad is None else round(math.remainder(rad * 180 / math.pi, 360))


def stamp(minutes_ago: int = 0, with_card: bool = False) -> dict[str, Any] | None:
    """The stamp for an entry that happened `minutes_ago` minutes ago. None when no boat data is configured."""
    if boat_link.signalk_url() is None:
        return None
    out: dict[str, Any] = {"mode": _mode(), "sail_set": _sail_label()}
    if minutes_ago <= 0:
        try:
            card = handover_card.build_card(boat_link.signalk_self(), boat_link.history_at)
        except boat_link.BoatLinkError:
            return out if any(out.values()) else None
        pos = card.get("position") or {}
        out.update(lat=pos.get("lat"), lon=pos.get("lon"), sog_kn=card.get("sog_kn"), cog_deg=card.get("cog_deg"),
                   wind_apparent_kn=card.get("wind_apparent_kn"), wind_apparent_deg=card.get("wind_apparent_deg"),
                   baro_hpa=card.get("baro_hpa"))
        if with_card:
            out["card"] = card
        return out
    t = time.time() - minutes_ago * 60
    sog = _hist("navigation.speedOverGround", t, handover_card.M_S_TO_KN)
    cog = boat_link.history_at("navigation.courseOverGroundTrue", t)
    out.update(lat=_hist("navigation.position.latitude", t, nd=5), lon=_hist("navigation.position.longitude", t, nd=5),
               sog_kn=sog,
               cog_deg=(round(cog * 180 / math.pi % 360) if cog is not None and sog is not None and sog >= 0.5
                        else None),
               wind_apparent_kn=_hist("environment.wind.speedApparent", t, handover_card.M_S_TO_KN, 0),
               wind_apparent_deg=_awa(boat_link.history_at("environment.wind.angleApparent", t)),
               baro_hpa=_hist("environment.outside.pressure", t, 0.01))
    return out
