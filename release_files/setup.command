#!/bin/bash
# Purpose: One-time (and after-update) setup for the Vessel Ops Panel on macOS (or Linux).
# Version: v2 (2026-09-24) - v2: offers the recipe / maintenance starter packs on first install.
# Scope: PRODUCTION - release package installer, macOS twin of setup.bat.
# Architecture: Creates .venv and installs requirements.txt, installs the frontend's npm
#   packages and builds frontend/dist, then (first time only) offers to load the example
#   boat via example_data.py. Never touches an existing vessel_local.db. Double-click in
#   Finder (opens Terminal); start the app afterwards with run.command.
cd "$(dirname "$0")" || exit 1

fail() { echo; echo "  ERROR: $1"; echo; read -r -p "  Press Return to close." _; exit 1; }

echo
echo "  Vessel Ops Panel - setup"
echo "  ========================"
echo

# ---- Python ----------------------------------------------------------------
PY=""
for cand in python3.14 python3.13 python3.12 python3.11 python3; do
  if command -v "$cand" >/dev/null 2>&1 && \
     "$cand" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
    PY="$cand"; break
  fi
done
[ -n "$PY" ] || fail "Python 3.11 or newer was not found. Install it from python.org (the macOS installer), then run setup.command again."

if [ ! -x ".venv/bin/python" ]; then
  echo "  Creating the Python environment in .venv ..."
  "$PY" -m venv .venv || fail "could not create the .venv folder."
fi
echo "  Installing Python packages ..."
.venv/bin/python -m pip install --quiet --upgrade pip
.venv/bin/python -m pip install --quiet -r requirements.txt || fail "installing the Python packages failed - see the messages above."

# ---- Node / frontend -------------------------------------------------------
command -v npm >/dev/null 2>&1 || fail "Node.js was not found. Install the LTS version from nodejs.org, then run setup.command again."
echo "  Installing and building the web interface (a minute or two) ..."
( cd frontend && npm ci --no-fund --no-audit --loglevel=error && npm run build ) \
  || fail "building the web interface failed - see the messages above."
[ -f frontend/dist/index.html ] || fail "building the web interface failed - see the messages above."

# ---- Database --------------------------------------------------------------
if [ -f vessel_local.db ]; then
  echo
  echo "  Existing database vessel_local.db kept as is."
else
  echo
  echo "  No database yet. You can start with an EXAMPLE BOAT (\"SV Example\") to see"
  echo "  what every screen does, or start EMPTY and enter your own boat."
  echo "  (To switch later: stop the app, delete or rename vessel_local.db, run setup again.)"
  echo
  read -r -p "  Load the example boat? [y/N] " ans
  case "$ans" in
    [Yy]*) .venv/bin/python example_data.py --db vessel_local.db || fail "loading the example boat failed - see the messages above." ;;
    *) echo "  Starting empty." ;;
  esac
  echo
  echo "  Optional starter packs (can also be loaded later - see README):"
  echo "    - a recipe book of about 1,100 recipes"
  echo "    - a maintenance library: about 400 common recurring jobs and 20 checklists"
  echo "      for a cruising sailboat, to prune to your own boat"
  read -r -p "  Load the recipe book? [y/N] " ans
  case "$ans" in [Yy]*) .venv/bin/python load_starter_pack.py --db vessel_local.db recipes ;; esac
  read -r -p "  Load the maintenance library? [y/N] " ans
  case "$ans" in [Yy]*) .venv/bin/python load_starter_pack.py --db vessel_local.db maintenance ;; esac
fi

echo
echo "  Setup finished. Double-click run.command to start the app."
echo
read -r -p "  Press Return to close." _
