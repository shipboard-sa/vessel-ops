@echo off
REM Purpose: One-time (and after-update) setup for the Vessel Ops Panel on Windows.
REM Version: v2 (2026-09-24) - v2: offers the recipe / maintenance starter packs on first install.
REM Scope: PRODUCTION - release package installer.
REM Architecture: Creates .venv and installs requirements.txt, installs the frontend's
REM   npm packages and builds frontend\dist, then (first time only) offers to load the
REM   example boat via example_data.py. Safe to re-run after an update: it never touches an
REM   existing vessel_local.db. Start the app afterwards with run.bat.
setlocal
cd /d "%~dp0"

echo.
echo   Vessel Ops Panel - setup
echo   ========================
echo.

REM ---- Python --------------------------------------------------------------
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (where python >nul 2>nul && set "PY=python")
if not defined PY goto no_python
%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul
if errorlevel 1 goto old_python

if not exist ".venv\Scripts\python.exe" (
  echo   Creating the Python environment in .venv ...
  %PY% -m venv .venv
  if errorlevel 1 goto venv_failed
)
echo   Installing Python packages ...
".venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
".venv\Scripts\python.exe" -m pip install --quiet -r requirements.txt
if errorlevel 1 goto pip_failed

REM ---- Node / frontend -----------------------------------------------------
where npm >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\npm.cmd" (set "PATH=C:\Program Files\nodejs;%PATH%") else goto no_node
)
echo   Installing and building the web interface (a minute or two) ...
pushd frontend
call npm ci --no-fund --no-audit --loglevel=error
if errorlevel 1 (popd & goto npm_failed)
call npm run build
if errorlevel 1 (popd & goto npm_failed)
popd
if not exist "frontend\dist\index.html" goto npm_failed

REM ---- Database ------------------------------------------------------------
if exist "vessel_local.db" (
  echo.
  echo   Existing database vessel_local.db kept as is.
  goto done
)
echo.
echo   No database yet. You can start with an EXAMPLE BOAT ("SV Example") to see
echo   what every screen does, or start EMPTY and enter your own boat.
echo   (To switch later: stop the app, delete or rename vessel_local.db, run setup again.)
echo.
choice /C YN /M "  Load the example boat"
if errorlevel 2 (
  echo   Starting empty.
  goto packs
)
".venv\Scripts\python.exe" example_data.py --db vessel_local.db
if errorlevel 1 goto example_failed

:packs
echo.
echo   Optional starter packs (can also be loaded later - see README):
echo     - a recipe book of about 1,100 recipes
echo     - a maintenance library: about 400 common recurring jobs and 20 checklists
echo       for a cruising sailboat, to prune to your own boat
choice /C YN /M "  Load the recipe book"
if not errorlevel 2 ".venv\Scripts\python.exe" load_starter_pack.py --db vessel_local.db recipes
choice /C YN /M "  Load the maintenance library"
if not errorlevel 2 ".venv\Scripts\python.exe" load_starter_pack.py --db vessel_local.db maintenance

:done
echo.
echo   Setup finished. Double-click run.bat to start the app.
echo.
pause
exit /b 0

:no_python
echo   ERROR: Python was not found. Install Python 3.11 or newer from python.org
echo   (tick "Add python.exe to PATH"), then run setup.bat again.
goto fail
:old_python
echo   ERROR: Python 3.11 or newer is needed. Install a newer one from python.org.
goto fail
:venv_failed
echo   ERROR: could not create the .venv folder.
goto fail
:pip_failed
echo   ERROR: installing the Python packages failed - see the messages above.
goto fail
:no_node
echo   ERROR: Node.js was not found. Install the LTS version from nodejs.org, then
echo   run setup.bat again.
goto fail
:npm_failed
echo   ERROR: building the web interface failed - see the messages above.
goto fail
:example_failed
echo   ERROR: loading the example boat failed - see the messages above.
goto fail
:fail
echo.
pause
exit /b 1
