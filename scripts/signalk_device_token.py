"""
Purpose: Gets mx-inv its own SignalK device token (read/write) from OUR SignalK - files the access request, waits
    while the owner approves it in SignalK admin (Security > Access Requests), then saves the token to an env-format
    file as SIGNALK_TOKEN=... without ever printing it.
Version: v1 (2026-10-05)
Scope: STANDALONE UTILITY - one-time setup per live host (Ship's PC now, the Pi after cut-over).
Architecture: Same procedure as the rules engine's token (Ship's Automation stacks/signalk/README.md: clientId
    swallow-rules-engine). backend/boat_link.py reads the saved file via MXINV_SIGNALK_TOKEN_FILE (set by
    run-live.bat) - used only by the cockpit Sail Plan tile to write sails.activeSet.
Invocation: .venv\\Scripts\\python scripts\\signalk_device_token.py [--signalk http://127.0.0.1:3000]
        [--out %USERPROFILE%\\.boat-secrets\\mxinv-signalk.env]
    Run on the live host while SignalK is up; approve the 'mx-inv-cockpit' request as READ/WRITE when asked.
    Re-running files a fresh request (a new clientId suffix) and replaces the file.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import uuid
from pathlib import Path

import httpx


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--signalk", default="http://127.0.0.1:3000")
    ap.add_argument("--out", default=os.path.expandvars(r"%USERPROFILE%\.boat-secrets\mxinv-signalk.env"))
    ap.add_argument("--wait", type=int, default=600, help="seconds to wait for approval")
    a = ap.parse_args()
    base = a.signalk.rstrip("/")
    client_id = f"mx-inv-cockpit-{uuid.uuid4().hex[:8]}"
    r = httpx.post(f"{base}/signalk/v1/access/requests", timeout=10,
                   json={"clientId": client_id, "description": "mx-inv cockpit (Sail Plan -> sails.activeSet)",
                         "permissions": "readwrite"})
    if r.status_code not in (200, 202):
        print(f"SignalK refused the request: {r.status_code} {r.text[:200]}")
        return 1
    href = r.json().get("href")
    if not href:
        print(f"No request href in the answer: {r.text[:200]}")
        return 1
    print(f"Filed access request '{client_id}'. In SignalK admin -> Security -> Access Requests, approve it as "
          f"READ/WRITE (waiting up to {a.wait} s)...")
    deadline = time.time() + a.wait
    while time.time() < deadline:
        time.sleep(3)
        body = httpx.get(f"{base}{href}", timeout=10).json()
        if body.get("state") != "COMPLETED":
            continue
        req = body.get("accessRequest") or {}
        if req.get("permission") != "APPROVED" or not req.get("token"):
            print(f"Request finished but not approved: {req.get('permission')}")
            return 1
        out = Path(a.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(f"SIGNALK_TOKEN={req['token'].strip()}\n", encoding="utf-8")
        print(f"Approved. Token saved to {out} (not shown). Restart mx-inv (run-live.bat) to use it.")
        return 0
    print("Timed out waiting for approval - run it again when ready.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
