"""
Purpose: mx-inv's one connection to the boat automation stack (our rules engine + SignalK) - where
    they are, the engine's bearer token, and small read / write helpers that never raise into a
    request handler.
Version: v6 (2026-10-18) - v6: engine_post keeps a 409 as 409 (the engine refused on purpose and says why - e.g. a
    restock hold while that cold box's alarm is already up, WF-502); POST /restock is also called by
    backend/restock_link.py. v5 (2026-10-09) - v5: engine_get keeps a 404 as status 404 (a route the engine does not have
    yet - the cockpit's GET /fill on an engine older than api.py v9). v4 (2026-10-05) - v4: events_token() (the engine's logbook push, read from the same engine.env).
    v3 (2026-10-05) - v3: signalk_publish() - writes one value into SignalK as a delta over the stream, with
    mx-inv's own SignalK device token, and reads it back (with security on SignalK silently drops a delta from a
    client without a write token - Ship's Automation F-072); history_latest(). v2 (2026-10-05) - v2: SignalK (self snapshot) + the history read API (Ship's Automation history-api, D-052
    door #1: value of a SignalK path at time T) for the watch-handover card. v1 (2026-10-05): engine.
Scope: PRODUCTION - mx-inv backend.
Architecture: Imported by backend/routers/cockpit.py (boat status, mode tap, alarm ack). Talks to
    the rules engine's HTTP API (Ship's Automation stacks/rules-engine/engine/api.py: GET /status,
    POST /mode, POST /ack, GET / POST /fill - writes need the bearer token) and SignalK's REST API. Nothing here
    knows which host the stack runs on: the Ship's PC today, the rebuilt Pi later - moving it is
    a change of these environment variables only (D-077):
      MXINV_ENGINE_URL         e.g. http://127.0.0.1:8210 (Ship's PC) / http://127.0.0.1:8200 (Pi)
      MXINV_ENGINE_TOKEN_FILE  env-format file holding ENGINE_API_TOKEN=... (the stack's own
                               .boat-secrets\\engine.env - one token, not a copy)
      MXINV_ENGINE_TOKEN       the token itself (instead of the file)
      MXINV_SIGNALK_URL        e.g. http://127.0.0.1:3000
      MXINV_HISTORY_URL        e.g. http://127.0.0.1:8090 (history-api; Ship's PC and Pi alike)
      MXINV_SIGNALK_TOKEN_FILE env-format file holding SIGNALK_TOKEN=... (mx-inv's own SignalK device token,
                               clientId mx-inv-cockpit, read/write - scripts/signalk_device_token.py gets it)
      MXINV_SIGNALK_TOKEN      the token itself (instead of the file)
    Unset URL = that half is off and the cockpit hides what depends on it.
Invocation: imported by backend/routers/cockpit.py; values set by run-live.bat.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

_TIMEOUT = httpx.Timeout(4.0, connect=2.0)


class BoatLinkError(Exception):
    """The stack did not answer, or refused - message is plain words for the tablet."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


def engine_url() -> str | None:
    return _env("MXINV_ENGINE_URL").rstrip("/") or None


def signalk_url() -> str | None:
    return _env("MXINV_SIGNALK_URL").rstrip("/") or None


def history_url() -> str | None:
    return _env("MXINV_HISTORY_URL").rstrip("/") or None


def _token_from(env_value: str, env_file: str, key: str) -> str | None:
    tok = _env(env_value)
    if tok:
        return tok
    path = _env(env_file)
    if not path:
        return None
    try:
        for line in Path(os.path.expandvars(path)).read_text(encoding="utf-8").splitlines():
            k, sep, value = line.partition("=")
            if sep and k.strip() == key:
                return value.strip().strip('"').strip("'") or None
    except OSError:
        return None
    return None


def signalk_token() -> str | None:
    return _token_from("MXINV_SIGNALK_TOKEN", "MXINV_SIGNALK_TOKEN_FILE", "SIGNALK_TOKEN")


def signalk_can_write() -> bool:
    return signalk_url() is not None and signalk_token() is not None


def engine_token() -> str | None:
    """MXINV_ENGINE_TOKEN, else ENGINE_API_TOKEN read from MXINV_ENGINE_TOKEN_FILE. Values are stripped - a stray
    space after '=' once broke every Pushover send for days (your-pi-hostname D-113)."""
    return _token_from("MXINV_ENGINE_TOKEN", "MXINV_ENGINE_TOKEN_FILE", "ENGINE_API_TOKEN")


def events_token() -> str | None:
    """The bearer token the rules engine sends with its logbook pushes: MXINV_EVENTS_TOKEN, else the same key in the
    stack's engine.env (MXINV_ENGINE_TOKEN_FILE) - one file holds both sides' tokens."""
    return _token_from("MXINV_EVENTS_TOKEN", "MXINV_ENGINE_TOKEN_FILE", "MXINV_EVENTS_TOKEN")


def engine_enabled() -> bool:
    return engine_url() is not None


def engine_can_write() -> bool:
    return engine_enabled() and engine_token() is not None


def engine_get(path: str) -> Any:
    base = engine_url()
    if not base:
        raise BoatLinkError("The boat automation link is not configured on this server.", 503)
    try:
        r = httpx.get(f"{base}{path}", timeout=_TIMEOUT)
    except httpx.HTTPError as e:
        raise BoatLinkError(f"the rules engine is not answering at {base} - check the boat stack (landing page, System).") from e
    if r.status_code != 200:
        # 404 kept as-is: a route this engine does not have yet (GET /fill before engine api.py v9)
        raise BoatLinkError(f"The boat automation answered {r.status_code}.", 404 if r.status_code == 404 else 502)
    return r.json()


def engine_post(path: str, body: dict[str, Any]) -> Any:
    base, token = engine_url(), engine_token()
    if not base or not token:
        raise BoatLinkError("This server is not allowed to change the boat automation (no engine token).", 503)
    try:
        r = httpx.post(f"{base}{path}", json=body, timeout=_TIMEOUT,
                       headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError as e:
        raise BoatLinkError(f"the rules engine is not answering at {base} - check the boat stack (landing page, System).") from e
    if r.status_code == 401:
        raise BoatLinkError("The boat automation refused this server's token - the token needs updating.", 502)
    if r.status_code != 200:
        detail = ""
        try:
            detail = str(r.json().get("detail", ""))
        except ValueError:
            pass
        raise BoatLinkError(f"The boat automation refused that ({r.status_code}{': ' + detail if detail else ''}).",
                            r.status_code if r.status_code in (400, 409) else 502)
    return r.json()


def signalk_self() -> dict[str, Any]:
    """The whole `vessels/self` tree from SignalK's REST API (one call; the card picks paths out of it)."""
    base = signalk_url()
    if not base:
        raise BoatLinkError("SignalK is not configured on this server.", 503)
    try:
        r = httpx.get(f"{base}/signalk/v1/api/vessels/self", timeout=_TIMEOUT)
    except httpx.HTTPError as e:
        raise BoatLinkError(f"SignalK is not answering at {base} - check the boat stack (landing page).") from e
    if r.status_code != 200:
        raise BoatLinkError(f"SignalK answered {r.status_code}.")
    return r.json()


def history_at(path: str, t: float) -> float | None:
    """A SignalK path's value at (or just before) epoch time t, from the history read API. None when there is no
    history for it, the API is not configured or not answering - the card then just leaves that line out."""
    base = history_url()
    if not base:
        return None
    try:
        r = httpx.get(f"{base}/api/at", params={"path": path, "t": f"{t:.0f}"}, timeout=_TIMEOUT)
        if r.status_code != 200:
            return None
        v = r.json().get("value")
        return float(v) if isinstance(v, (int, float)) else None
    except (httpx.HTTPError, ValueError, TypeError):
        return None


def history_latest(path: str) -> tuple[float, Any] | None:
    """(epoch, value) of a path's newest history row, or None."""
    base = history_url()
    if not base:
        return None
    try:
        r = httpx.get(f"{base}/api/latest", params={"path": path}, timeout=_TIMEOUT)
        if r.status_code != 200:
            return None
        body = r.json()
        return float(body["t"]), body.get("value")
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return None


def signalk_get(path: str) -> dict[str, Any] | None:
    """One SignalK leaf ({value, timestamp, $source}) under vessels/self, or None if SignalK has none."""
    base = signalk_url()
    if not base:
        raise BoatLinkError("SignalK is not configured on this server.", 503)
    try:
        r = httpx.get(f"{base}/signalk/v1/api/vessels/self/{path.replace('.', '/')}", timeout=_TIMEOUT)
    except httpx.HTTPError as e:
        raise BoatLinkError(f"SignalK is not answering at {base} - check the boat stack (landing page).") from e
    if r.status_code == 404:
        return None
    if r.status_code != 200:
        raise BoatLinkError(f"SignalK answered {r.status_code}.")
    body = r.json()
    return body if isinstance(body, dict) and "value" in body else None


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def signalk_publish(path: str, value: Any, at: float, label: str = "mx-inv-cockpit") -> None:
    """Write one value into SignalK (a delta on the stream, timestamped `at` - the moment it really happened), then
    read it back. Raises BoatLinkError in plain words if it is not there afterwards."""
    from websockets.sync.client import connect        # websockets ships with uvicorn[standard]
    base, token = signalk_url(), signalk_token()
    if not base or not token:
        raise BoatLinkError("This server cannot write to SignalK (no SignalK token).", 503)
    ws_url = base.replace("http://", "ws://", 1).replace("https://", "wss://", 1) + "/signalk/v1/stream?subscribe=none"
    delta = {"context": "vessels.self",
             "updates": [{"source": {"label": label}, "timestamp": _iso(at), "values": [{"path": path, "value": value}]}]}
    try:
        with connect(ws_url, additional_headers={"Authorization": f"Bearer {token}"}, open_timeout=4,
                     close_timeout=2) as ws:
            ws.send(json.dumps(delta))
    except Exception as e:                            # noqa: BLE001 - any socket / handshake failure = not written
        raise BoatLinkError(f"Could not write to SignalK at {base} ({type(e).__name__}).") from e
    import time as _time
    for _ in range(10):                               # read-back: proves the token was accepted (F-072)
        leaf = signalk_get(path)
        if leaf is not None and leaf.get("value") == value:
            return
        _time.sleep(0.2)
    raise BoatLinkError("SignalK did not take the change - mx-inv's SignalK token is missing or not approved "
                        "(SignalK admin: Security > Access Requests).")
