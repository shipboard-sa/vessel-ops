"""
Purpose: Tests for the pre-filled watch-handover card - unit conversions, stale values dropped, "this watch" deltas
    from history (and left out when history is missing), course hidden when stopped, the endpoint's 503 / 502.
Version: v1 (2026-10-05)
Scope: PRODUCTION - mx-inv test suite.
Architecture: backend/handover_card.build_card fed a synthetic SignalK tree + a fake history_at; the endpoint via
    conftest's `client` with boat_link.httpx stubbed.
Invocation: .venv/Scripts/python -m pytest tests/test_handover_card.py
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from backend import boat_link, handover_card

NOW = datetime(2026, 10, 5, 12, 0, tzinfo=timezone.utc).timestamp()
FRESH = "2026-10-05T11:59:50Z"
OLD = "2026-10-05T09:00:00Z"


def leaf(v, ts=FRESH):
    return {"value": v, "timestamp": ts, "$source": "test"}


def tree(**over):
    t = {
        "navigation": {"position": leaf({"latitude": 30.02266, "longitude": -90.03225}),
                       "speedOverGround": leaf(3.0), "courseOverGroundTrue": leaf(3.14159),
                       "speedThroughWater": leaf(2.9), "log": leaf(100_000.0)},
        "environment": {"depth": {"belowKeel": leaf(10.0)},
                        "wind": {"speedApparent": leaf(5.0), "angleApparent": leaf(-0.5)},
                        "outside": {"pressure": leaf(101300.0), "temperature": leaf(298.15)},
                        "water": {"temperature": leaf(300.0)}},
        "tanks": {"fuel": {"20": {"remaining": leaf(0.1), "capacity": leaf(0.379)},
                           "21": {"remaining": leaf(0.12), "capacity": leaf(0.379)}},
                  "freshWater": {"22": {"remaining": leaf(0.05), "capacity": leaf(0.265)},
                                 "23": {"remaining": leaf(0.04), "capacity": leaf(0.227)}}},
        "electrical": {"batteries": {"houseSmartShunt": {"voltage": leaf(25.03), "current": leaf(-15.9)}}},
    }
    t.update(over)
    return t


PAST = {"navigation.log": 100_000.0 - 1852 * 30, "environment.outside.pressure": 101600.0,
        "tanks.fuel.20.remaining": 0.11, "tanks.fuel.21.remaining": 0.13,
        "tanks.freshWater.22.remaining": 0.06, "tanks.freshWater.23.remaining": 0.04}


def hist(path, t):
    return PAST.get(path)


def test_units_and_deltas():
    c = handover_card.build_card(tree(), hist, now=NOW)
    assert c["position"] == {"lat": 30.02266, "lon": -90.03225}
    assert c["sog_kn"] == 5.8 and c["cog_deg"] == 180 and c["stw_kn"] == 5.6
    assert c["depth_ft"] == 32.8 and c["wind_apparent_kn"] == 10 and c["wind_apparent_deg"] == -29
    assert c["air_f"] == 77 and c["sea_f"] == 80
    assert c["baro_hpa"] == 1013.0 and c["baro_3h_change_hpa"] == -3.0
    assert c["distance_this_watch_nm"] == 30.0
    assert c["fuel"]["gal"] == 58 and c["fuel"]["capacity_gal"] == 200 and c["fuel"]["used_gal"] == 5.3
    assert c["water"]["used_gal"] == 2.6
    assert c["house_v"] == 25.03 and c["house_a"] == -15.9
    assert "heading" not in str(c.keys()) and "soc" not in str(c.keys()).lower()


def test_no_history_leaves_deltas_out():
    c = handover_card.build_card(tree(), lambda p, t: None, now=NOW)
    assert c["baro_hpa"] == 1013.0 and c["baro_3h_change_hpa"] is None
    assert c["distance_this_watch_nm"] is None and c["fuel"]["used_gal"] is None and c["fuel"]["gal"] == 58


def test_one_tank_without_history_means_no_used():
    past = dict(PAST)
    del past["tanks.fuel.21.remaining"]
    c = handover_card.build_card(tree(), lambda p, t: past.get(p), now=NOW)
    assert c["fuel"]["used_gal"] is None and c["water"]["used_gal"] == 2.6


def test_stale_values_dropped_and_cog_hidden_when_stopped():
    t = tree()
    t["navigation"]["speedOverGround"] = leaf(0.1)
    t["environment"]["depth"]["belowKeel"] = leaf(10.0, OLD)
    c = handover_card.build_card(t, hist, now=NOW)
    assert c["depth_ft"] is None and c["cog_deg"] is None and c["sog_kn"] == 0.2


def test_empty_tree():
    c = handover_card.build_card({}, hist, now=NOW)
    assert c["position"] is None and c["fuel"] is None and c["baro_hpa"] is None


def test_endpoint_off_and_down(client, monkeypatch):
    monkeypatch.delenv("MXINV_SIGNALK_URL", raising=False)
    assert client.get("/api/cockpit/capabilities").json()["handover_live"] is False
    assert client.get("/api/cockpit/watch-handover/boat").status_code == 503

    import httpx
    monkeypatch.setenv("MXINV_SIGNALK_URL", "http://sk.test:3000")

    def down(*a, **k):
        raise httpx.ConnectError("refused")
    monkeypatch.setattr(boat_link.httpx, "get", down)
    r = client.get("/api/cockpit/watch-handover/boat")
    assert r.status_code == 502 and "SignalK is not answering" in r.json()["detail"]


def test_outside_weather_with_source_and_age():
    t = tree()
    t["environment"]["observations"] = {
        "station": leaf("NWCL1 New Canal"), "distance": leaf(7778.0), "age": leaf(2194),
        "wind": {"speed": leaf(6.7), "gust": leaf(7.7), "directionTrue": leaf(1.0472)}, "pressure": leaf(101530.0),
        "waves": {"station": leaf("42084 SW Pass"), "distance": leaf(120936.0), "age": leaf(3274),
                  "significantHeight": leaf(0.6), "period": leaf(6.0), "directionTrue": leaf(2.6354)}}
    t["environment"]["forecast"] = {"wind": {"speed": leaf(4.53)},
                                    "next12h": {"windMax": leaf(4.88), "gustMax": leaf(9.7), "waveMax": leaf(0.26)}}
    o = handover_card.build_card(t, hist, now=NOW)["outside"]
    assert o["obs"] == {"station": "NWCL1 New Canal", "nm": 4, "age_min": 37, "wind_kn": 13, "gust_kn": 15,
                        "wind_from_deg": 60, "pressure_hpa": 1015.3}
    assert o["waves"]["height_ft"] == 2.0 and o["waves"]["period_s"] == 6 and o["waves"]["nm"] == 65
    assert o["forecast"] == {"wind_kn": 9, "wind_max_kn": 9, "gust_max_kn": 19, "wave_max_ft": 0.9}
    t["environment"]["observations"]["wind"]["speed"] = leaf(6.7, OLD)            # service down: obs left out
    assert "obs" not in handover_card.build_card(t, hist, now=NOW)["outside"]
