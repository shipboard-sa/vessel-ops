#!/bin/bash
# Purpose: Starts the Vessel Ops Panel server on macOS (or Linux).
# Version: v1 (2026-09-24)
# Scope: PRODUCTION - release package launcher, macOS twin of run.bat.
# Architecture: Runs backend/main.py (FastAPI) with uvicorn on 0.0.0.0:8000 against
#   vessel_local.db in this folder; the same process serves the built web interface and the
#   tablet view at /cockpit. Run setup.command first. Optional integrations are switched on
#   by environment variables (see INTEGRATIONS.md): put `export NAME=value` lines in a file
#   named local-settings.sh next to this one and they are loaded here.
cd "$(dirname "$0")" || exit 1
export PYTHONUTF8=1
[ -f local-settings.sh ] && . ./local-settings.sh

if [ ! -x .venv/bin/python ] || [ ! -f frontend/dist/index.html ]; then
  echo
  echo "  The app is not set up yet (or setup did not finish). Run setup.command first."
  echo
  read -r -p "  Press Return to close." _
  exit 1
fi

if lsof -nP -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo
  echo "  Something is already running on port 8000 - probably the app from an earlier"
  echo "  start. Open http://localhost:8000 in a browser."
  echo
  read -r -p "  Press Return to close." _
  exit 0
fi

echo
echo "  Vessel Ops Panel is starting..."
echo
echo "  On this computer:   http://localhost:8000"
echo "  Tablet view:        http://localhost:8000/cockpit"
echo "  From a tablet or phone on the same wifi, use this Mac's address with :8000 on the end:"
ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null
echo
echo "  Leave this window open while you use the app. Ctrl+C or close it to stop."
echo
exec .venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
