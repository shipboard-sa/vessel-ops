@echo off
REM Purpose: Starts the Vessel Ops Panel server.
REM Version: v1 (2026-09-24)
REM Scope: PRODUCTION - release package launcher.
REM Architecture: Runs backend/main.py (FastAPI) with uvicorn on 0.0.0.0:8000 against
REM   vessel_local.db in this folder; the same process serves the built web interface
REM   (frontend\dist) and the tablet view at /cockpit. Run setup.bat first. Optional
REM   integrations are switched on by environment variables - see INTEGRATIONS.md; put
REM   them in a file named local-settings.bat next to this one and they are loaded here.
setlocal
cd /d "%~dp0"
set PYTHONUTF8=1
if exist "local-settings.bat" call "local-settings.bat"

if not exist ".venv\Scripts\python.exe" goto not_setup
if not exist "frontend\dist\index.html" goto not_setup

netstat -ano | findstr /C:":8000" | findstr /C:"LISTENING" >nul
if not errorlevel 1 goto already_running

echo.
echo   Vessel Ops Panel is starting...
echo.
echo   On this computer:   http://localhost:8000
echo   Tablet view:        http://localhost:8000/cockpit
echo   From a tablet or phone on the same wifi, use one of these addresses
echo   with :8000 on the end (see INSTALL notes in README.md about the firewall):
ipconfig | findstr /C:"IPv4"
echo.
echo   Leave this window open while you use the app. Ctrl+C or close it to stop.
echo.
".venv\Scripts\python.exe" -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
echo.
echo   Server stopped.
pause
exit /b 0

:not_setup
echo.
echo   The app is not set up yet (or setup did not finish). Run setup.bat first.
echo.
pause
exit /b 1

:already_running
echo.
echo   Something is already running on port 8000 - probably the app from an earlier
echo   start. Open http://localhost:8000 in a browser. To restart it, close the old
echo   window (or end its python.exe in Task Manager) and run this again.
echo.
pause
exit /b 0
