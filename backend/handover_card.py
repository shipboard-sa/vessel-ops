"""
Purpose: Builds the cockpit's pre-filled watch-handover card (Ship's Automation WF-602 / CAMS N-39): where the boat is and
    how she is going now, plus what changed over the last watch - fuel and water used, distance run, barometer
    trend - in the units the crew uses (kn, nm, ft, gal, deg F, hPa).
Version: v2 (2026-10-05) - v2: outside weather from the Ship's Automation weather service (nearest fresh NDBC station,
    nearest wave report, Open-Meteo forecast) - each with its source, distance and age. v1 (2026-10-05)
Scope: PRODUCTION - mx-inv backend.
Architecture: Pure functions over a SignalK `vessels/self` snapshot and a `history_at(path, t)` callable (backend/
    boat_link.py -> Ship's Automation history-api), so tests feed both. Called by GET /api/cockpit/watch-handover/boat
    (backend/routers/cockpit.py). Every line is optional: a value SignalK does not have, or older than its stale
    limit, is left out (never a 500, never a stale number shown as live). Deliberately NOT shown: heading and true
    wind (the boat's heading sources read ~180 deg off - Ship's Automation F-100 / F-099) and battery SoC (the shunt's SoC
    is invalid until a genuine full + sync - F-186); course + speed over ground come from GPS instead.
Invocation: imported by backend/routers/cockpit.py.
"""
from __future__ import annotations

import math
import time
from datetime import datetime
from typing import Any, Callable

WATCH_HOURS = 6.0      # the boat's watch length (mx-inv task #544 / the departure SOP: 6-hour shifts)
BARO_HOURS = 3.0       # barometric tendency is quoted over 3 h

M_S_TO_KN = 1.943844
M_TO_NM = 1 / 1852.0
M_TO_FT = 3.28084
M3_TO_GAL = 264.172
RAD_TO_DEG = 180.0 / math.pi

FUEL_TANKS = ("20", "21")      # SignalK tank instances on this boat (Cerbo tank senders)
WATER_TANKS = ("22", "23")


def _node(tree: dict, path: str) -> dict | None:
    cur: Any = tree
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur if isinstance(cur, dict) else None


def _value(tree: dict, path: str, now: float, max_age: float = 120.0) -> Any:
    """The value at a SignalK path if it is fresh enough, else None."""
    n = _node(tree, path)
    if not n or "value" not in n:
        return None
    ts = n.get("timestamp")
    if ts:
        try:
            age = now - datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
        except ValueError:
            age = None
        if age is not None and age > max_age:
            return None
    return n["value"]


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _r(v: float | None, nd: int = 1) -> float | None:
    return None if v is None else round(v, nd)


def _k_to_f(k: float | None) -> float | None:
    return None if k is None else (k - 273.15) * 9 / 5 + 32


def _tanks(tree: dict, kind: str, ids: tuple[str, ...], now: float,
           history_at: Callable[[str, float], float | None], since: float) -> dict[str, Any] | None:
    remaining = cap = then = 0.0
    seen, then_ok = False, True       # "used" only when EVERY tank shown has a value from the watch start
    for i in ids:
        rem = _num(_value(tree, f"tanks.{kind}.{i}.remaining", now, 900))
        c = _num(_value(tree, f"tanks.{kind}.{i}.capacity", now, 86400 * 365))
        if rem is None or c is None:
            continue
        seen = True
        remaining += rem
        cap += c
        past = history_at(f"tanks.{kind}.{i}.remaining", since)
        if past is None:
            then_ok = False
        else:
            then += past
    if not seen:
        return None
    out: dict[str, Any] = {"gal": _r(remaining * M3_TO_GAL, 0), "capacity_gal": _r(cap * M3_TO_GAL, 0),
                           "pct": _r(100 * remaining / cap, 0) if cap else None, "used_gal": None}
    if then_ok:
        out["used_gal"] = _r((then - remaining) * M3_TO_GAL, 1)    # negative = filled during the watch
    return out


M_TO_FT_WAVES = 3.28084


def _outside(tree: dict, now: float) -> dict[str, Any]:
    """The weather service's values (environment.observations / forecast) - published every 10 / 60 min, so a value
    older than 1 h / 2 h means the service or the internet is down: left out."""
    o = lambda p, age=3600: _value(tree, p, now, age)                              # noqa: E731
    n = lambda p, age=3600: _num(o(p, age))                                       # noqa: E731
    out: dict[str, Any] = {}
    ws = n("environment.observations.wind.speed")
    if ws is not None:
        wd, g, d, a = (n("environment.observations.wind.directionTrue"), n("environment.observations.wind.gust"),
                       n("environment.observations.distance"), n("environment.observations.age"))
        p = n("environment.observations.pressure")
        out["obs"] = {"station": o("environment.observations.station"),
                      "nm": _r(d * M_TO_NM if d is not None else None, 0),
                      "age_min": _r(a / 60 if a is not None else None, 0),
                      "wind_kn": _r(ws * M_S_TO_KN, 0), "gust_kn": _r(g * M_S_TO_KN if g is not None else None, 0),
                      "wind_from_deg": _r(wd * RAD_TO_DEG % 360 if wd is not None else None, 0),
                      "pressure_hpa": _r(p / 100 if p is not None else None)}
    wh = n("environment.observations.waves.significantHeight")
    if wh is not None:
        d, a = n("environment.observations.waves.distance"), n("environment.observations.waves.age")
        wd, per = n("environment.observations.waves.directionTrue"), n("environment.observations.waves.period")
        out["waves"] = {"station": o("environment.observations.waves.station"),
                        "nm": _r(d * M_TO_NM if d is not None else None, 0),
                        "age_min": _r(a / 60 if a is not None else None, 0), "height_ft": _r(wh * M_TO_FT_WAVES),
                        "period_s": _r(per, 0), "from_deg": _r(wd * RAD_TO_DEG % 360 if wd is not None else None, 0)}
    fw = n("environment.forecast.wind.speed", 7200)
    if fw is not None:
        f = lambda p: n(p, 7200)                                                     # noqa: E731
        wmax, gmax, wv = f("environment.forecast.next12h.windMax"), f("environment.forecast.next12h.gustMax"),             f("environment.forecast.next12h.waveMax")
        out["forecast"] = {"wind_kn": _r(fw * M_S_TO_KN, 0),
                           "wind_max_kn": _r(wmax * M_S_TO_KN if wmax is not None else None, 0),
                           "gust_max_kn": _r(gmax * M_S_TO_KN if gmax is not None else None, 0),
                           "wave_max_ft": _r(wv * M_TO_FT_WAVES if wv is not None else None)}
    return out


def build_card(tree: dict, history_at: Callable[[str, float], float | None], now: float | None = None,
               watch_hours: float = WATCH_HOURS) -> dict[str, Any]:
    now = time.time() if now is None else now
    since = now - watch_hours * 3600

    pos = _value(tree, "navigation.position", now)
    lat = _num(pos.get("latitude")) if isinstance(pos, dict) else None
    lon = _num(pos.get("longitude")) if isinstance(pos, dict) else None

    sog = _num(_value(tree, "navigation.speedOverGround", now))
    cog = _num(_value(tree, "navigation.courseOverGroundTrue", now))
    stw = _num(_value(tree, "navigation.speedThroughWater", now))
    depth = _num(_value(tree, "environment.depth.belowKeel", now))
    aws = _num(_value(tree, "environment.wind.speedApparent", now))
    awa = _num(_value(tree, "environment.wind.angleApparent", now))

    baro = _num(_value(tree, "environment.outside.pressure", now, 900))
    baro_then = history_at("environment.outside.pressure", now - BARO_HOURS * 3600) if baro is not None else None

    log_now = _num(_value(tree, "navigation.log", now, 900))
    log_then = history_at("navigation.log", since) if log_now is not None else None

    house_v = _num(_value(tree, "electrical.batteries.houseSmartShunt.voltage", now))
    house_a = _num(_value(tree, "electrical.batteries.houseSmartShunt.current", now))

    return {
        "generated_at": datetime.fromtimestamp(now).astimezone().isoformat(timespec="seconds"),
        "watch_hours": watch_hours,
        "position": {"lat": _r(lat, 5), "lon": _r(lon, 5)} if lat is not None and lon is not None else None,
        "sog_kn": _r(sog * M_S_TO_KN if sog is not None else None),
        # course is noise when stopped (GPS jitter) - shown from 0.5 kn
        "cog_deg": _r(cog * RAD_TO_DEG % 360 if cog is not None and sog is not None and sog * M_S_TO_KN >= 0.5
                      else None, 0),
        "stw_kn": _r(stw * M_S_TO_KN if stw is not None else None),
        "depth_ft": _r(depth * M_TO_FT if depth is not None else None),
        "wind_apparent_kn": _r(aws * M_S_TO_KN if aws is not None else None, 0),
        # -180..180: negative = port, positive = starboard
        "wind_apparent_deg": _r(math.remainder(awa * RAD_TO_DEG, 360) if awa is not None else None, 0),
        "air_f": _r(_k_to_f(_num(_value(tree, "environment.outside.temperature", now, 900))), 0),
        "sea_f": _r(_k_to_f(_num(_value(tree, "environment.water.temperature", now, 900))), 0),
        "baro_hpa": _r(baro / 100 if baro is not None else None),
        "baro_3h_change_hpa": _r((baro - baro_then) / 100 if baro is not None and baro_then is not None else None),
        "distance_this_watch_nm": _r((log_now - log_then) * M_TO_NM
                                     if log_now is not None and log_then is not None else None),
        "fuel": _tanks(tree, "fuel", FUEL_TANKS, now, history_at, since),
        "water": _tanks(tree, "freshWater", WATER_TANKS, now, history_at, since),
        "house_v": _r(house_v, 2),
        "house_a": _r(house_a),
        "outside": _outside(tree, now),
    }
