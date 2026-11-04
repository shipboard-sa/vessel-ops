"""FastAPI entry point.

Purpose: FastAPI entry point for the Vessel Ops Panel backend - mounts all
    API routers, reverse-proxies the routing app under /routing, and serves
    the built frontend.
Version: v8 (2026-10-05) - v8 (hardening phase 2 + logbook): mounts logbook.router (schema v37); runs the migration runner at start (db_schema.ensure_current) - a newer-than-code database stops the server. v7 (2026-09-24) - v7 (hardening phase 0): the SPA fallback answers 404 JSON for an unmatched /api/... path instead of index.html, and only serves files that resolve inside frontend/dist (an encoded ../ could reach the DB). v6 (release package): creates the database on first run (db_schema.ensure_initialised), mounts settings.router, and the /routing reverse proxy is only mounted when MXINV_ROUTING_URL is set (run-live.bat sets it; a stranger's install has no routing app). v5 mounts documents.router (invoices / receipts, schema v33). v4 mounts device_research.router (tracker #50 GUI build: headless-Claude
    device-manual research, mirrors  "Research with Claude" pattern) - v3 was 2026-09-18
Scope: PRODUCTION - core of the mx-inv FastAPI+React app.
Architecture: mx-inv backend. Mounts backend/routers/*.py, serves
    frontend/dist as static files, reads/writes vessel_local.db directly
    (SQLite, no separate DB server). Entry point for run-live.bat,
    run-multiuser.bat, and `uvicorn backend.main:app`.
    Also reverse-proxies /routing/** to the separate passage-planner web app
    (its own repo/venv/process, internal-only on 127.0.0.1:8100 - see
    run-live.bat, which starts both) so both apps are reachable from one
    external port/URL without merging their codebases or dependencies.

Run (dev):    uvicorn backend.main:app --reload --port 8000
              (paired with `npm run dev` in frontend/ - vite.config.ts
              proxies /api here; the static mount below is skipped since
              frontend/dist doesn't exist in a dev checkout)
Run (live):   run-live.bat - builds the frontend once and serves it from
              this same process/port, no separate dev server needed.
Run (prod):   inside the `data`/API Docker container, same command without
              --reload, behind the reverse proxy.

CORS is wide open on localhost/Tailscale dev ports for now - this carries
forward the existing LAN/Tailscale-only, no-auth trust boundary (see the
`vessel-ops-multiuser-hosting` project memory); tighten before any public
exposure.

Unit validation: data.create_item / update_item / save_recipe_ingredients
raise data.UnknownUnitError for a unit that is not in the `units` picklist
(schema v21); the handler below turns that into HTTP 422 with a readable
message for every endpoint at once, instead of each router catching it.
"""
from __future__ import annotations

from pathlib import Path

import os

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

import data
import db_schema
from backend.routers import (
    audits,
    cockpit,
    device_research,
    documents,
    items,
    meal_plan,
    projects,
    provisioning,
    recipes,
    reports,
    schedule,
    settings,
    storage,
    tasks,
    telemetry,
    logbook,
    units,
)

# First run on a new machine: no database file (or an empty one) -> build the schema so
# every screen works at once. An existing database is never touched here.
if db_schema.ensure_initialised():
    print(f"Created a new, empty database at {db_schema.DB_PATH}")
# An existing database is brought up to this code's schema (verified backup first); one NEWER than the code
# stops the server rather than risk it (a rollback must restore the matching backup).
_migrated = db_schema.ensure_current()
if _migrated:
    print(f"Database migrated to schema v{_migrated[-1]} ({', '.join(f'v{v}' for v in _migrated)})")

app = FastAPI(title="Vessel Operations Panel API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(schedule.router)
app.include_router(tasks.router)
app.include_router(items.router)
app.include_router(storage.router)
app.include_router(projects.router)
app.include_router(projects.phases_router)
app.include_router(recipes.router)
app.include_router(meal_plan.router)
app.include_router(audits.router)
app.include_router(telemetry.router)
app.include_router(provisioning.router)
app.include_router(cockpit.router)
app.include_router(units.router)
app.include_router(logbook.router)   # v8: the logbook (schema v37)

# The automatic deck log (status entries hourly underway, 08:00 / 20:00 otherwise) - only with a boat stack.
from backend import deck_log  # noqa: E402
deck_log.start_thread()
app.include_router(device_research.router)
app.include_router(reports.router)
app.include_router(documents.router)
app.include_router(settings.router)


@app.exception_handler(data.UnknownUnitError)
async def unknown_unit_handler(request: Request, exc: data.UnknownUnitError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.exception_handler(data.PhaseError)
async def phase_error_handler(request: Request, exc: data.PhaseError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(data.FoodDetailsError)
async def food_details_error_handler(request: Request, exc: data.FoodDetailsError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# Reverse proxy for the routing app (see module docstring). Registered before
# the SPA catch-all below so it wins the route match for anything under
# /routing/. httpx client is created per-request rather than at module scope
# since the routing backend may not be up yet when this process starts (it's
# launched separately by run-live.bat) - a per-request client just fails that
# one request with a 502 rather than the whole app.
_ROUTING_BACKEND = os.environ.get("MXINV_ROUTING_URL", "").strip().rstrip("/")
_HOP_BY_HOP_HEADERS = {"content-length", "content-encoding", "transfer-encoding", "connection"}


if _ROUTING_BACKEND:

    @app.get("/routing")
    def routing_root_redirect() -> RedirectResponse:
        return RedirectResponse(url="/routing/")


    # PUT and DELETE are forwarded too: the routing app's saved-depths library uses them
    # (2026-09-21: they were 405 through this proxy until added here).
    @app.api_route("/routing/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
    async def routing_proxy(path: str, request: Request) -> Response:
        forward_headers = {k: v for k, v in request.headers.items() if k.lower() != "host"}
        body = await request.body()
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                upstream = await client.request(
                    request.method,
                    f"{_ROUTING_BACKEND}/{path}",
                    params=request.query_params,
                    content=body,
                    headers=forward_headers,
                )
        except httpx.ConnectError:
            return Response(
                content=f"Routing GUI backend isn't running at {_ROUTING_BACKEND} - "
                "see run-live.bat's output for whether it started.",
                status_code=502,
            )
        response_headers = {
            k: v for k, v in upstream.headers.items() if k.lower() not in _HOP_BY_HOP_HEADERS
        }
        return Response(
            content=upstream.content,
            status_code=upstream.status_code,
            headers=response_headers,
            media_type=upstream.headers.get("content-type"),
        )


# Serve the built React app from the same process/port when it's been built
# (run-live.bat does this) - a no-op in the ordinary dev workflow, where
# frontend/dist doesn't exist and Vite's own dev server + proxy is used
# instead. SPA fallback: any path that isn't /api/... or a real static file
# gets index.html, so client-side routing survives a page reload/deep link.
_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    from fastapi.responses import FileResponse

    _DIST_ROOT = _DIST.resolve()

    @app.get("/{full_path:path}")
    def spa(full_path: str) -> Response:
        # An unmatched /api/... path is a real miss, not a page: answer 404 JSON so a
        # mistyped or mis-encoded API call can never look like success (it used to get
        # index.html with a 200).
        if full_path == "api" or full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        # Only files INSIDE dist are served: an encoded ../ must not reach the database.
        candidate = (_DIST / full_path).resolve()
        if full_path and candidate.is_relative_to(_DIST_ROOT) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_DIST / "index.html")
