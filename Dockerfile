# Purpose: Container image for the mx-inv Vessel Ops Panel (FastAPI backend + built React UI).
# Version: v2 (2026-10-07) - v2: copies migrations/ (the schema runner db_schema imports at start since v37; its
#   absence broke every CI image run from 2026-10-05). v1 (2026-09-24)
# Scope: PRODUCTION - built by CI for the vessel-ops stack on boat-automation (not yet deployed).
# Architecture: mx-inv. Stage 1 builds frontend/dist with Node; stage 2 is
#   python:3.13-slim-bookworm running backend.main:app on :8000. The DB is NOT in the
#   image: the stack bind-mounts its directory at /srv/data (VESSEL_DB_PATH). Also
#   carries docker/backup.py for the host's backup timer (docker exec).
#   See design/DOCKER_DEPLOYMENT_SPEC.md (v5).

# ---- Frontend build ----
FROM node:24-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY frontend/ ./
RUN npm run build

# ---- Runtime ----
FROM python:3.13-slim-bookworm
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/tmp \
    VESSEL_DB_PATH=/srv/data/vessel_local.db
# /srv/code/mx-inv mirrors the laptop layout, so cockpit.py finds routing's
# briefings at /srv/code/routing/var/briefings (mounted read-only by the stack).
WORKDIR /srv/code/mx-inv
COPY requirements-server.txt ./
RUN pip install -r requirements-server.txt
COPY data.py db_schema.py telemetry_sync.py ./
COPY backend/ backend/
COPY migrations/ migrations/
COPY docker/backup.py docker/backup.py
COPY --from=web /web/dist frontend/dist
RUN mkdir -p /srv/data /srv/backups /srv/code/routing/var
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
