<!--
Purpose: How to wire the Vessel Ops Panel's optional outside links (live engine hours, AI manual
  research, external logbook, sail-plan broker, a passage-planning app) - and what happens without them.
Version: v1 (2026-09-24)
Scope: PRODUCTION - ships at the release root.
Architecture: Each integration is a small module that is OFF unless its settings/environment
  variables are present, and fails safe (a timeout or error never blocks the app). Environment
  variables go in local-settings.bat (loaded by run.bat), one `set "NAME=value"` per line.
-->

# Optional integrations

The app is complete without any of these. Each is **off until you configure it**, and each fails
safe: if the other end is down, the app carries on and nothing is lost locally.

Put environment variables in a file named **`local-settings.bat`** next to `run.bat` (it is loaded
at start-up and ignored by git), e.g.:

```bat
set "MXINV_INFLUX_URL=http://192.0.2.10:8086"
set "MXINV_INFLUX_ORG=myboat"
set "BOAT_INFLUX_TOKEN=paste-a-read-only-token-here"
```

Restart `run.bat` after changing it.

| Integration | Default | Switched on by | Code |
|---|---|---|---|
| Engine/generator hours + tank levels from InfluxDB | off - hours typed in | `MXINV_INFLUX_URL`, `MXINV_INFLUX_ORG`, `BOAT_INFLUX_TOKEN` | `telemetry_sync.py` |
| Research with Claude (read a device manual, draft tasks/spares) | off - button says why | Claude Code installed + `CLAUDE_CODE_OAUTH_TOKEN` + ⚙ Settings → Manuals folder | `backend/device_research.py` |
| Send completions / incidents to an external logbook | off | `VESSEL_LOG_ENABLED=1`, `VESSEL_LOG_ENDPOINT`, `VESSEL_LOG_TOKEN` | `backend/vessel_log.py` |
| Cockpit sail-plan changes to a broker | off (tile hidden) | `SAIL_CONFIG_ENABLED=1`, `SAIL_CONFIG_ENDPOINT`, `SAIL_CONFIG_TOKEN` | `backend/sail_config.py` |
| Reverse-proxy a passage-planning web app at `/routing` | off | `MXINV_ROUTING_URL` | `backend/main.py` |

## Engine hours (the one most boats will want)

Run-hours maintenance ("change the impeller every 500 h") needs the current meter reading. Without
any integration you **type the reading** into the ⛽/⚙️ panel at the top right now and then; between
readings the app projects forward from your usual hours per year. That is enough for most boats.

**If you already log engine data** (Signal K → InfluxDB, a Victron/Cerbo feed into InfluxDB, etc.),
`telemetry_sync.py` can read it. It expects **InfluxDB v2** with a bucket (default `boat`,
override `MXINV_INFLUX_BUCKET`) holding:

- run time in **seconds** in measurements whose names end in `runTime` (Signal K style,
  e.g. `propulsion.main.runTime`). A name containing `generator` or `genset` counts as the
  generator (override the words with `MXINV_INFLUX_GENSET_MATCH=generator,genset,myword`);
  anything else is the main engine;
- optionally tank levels in `tanks.fuel.*` / `tanks.freshWater.*` (`currentLevel` as a fraction,
  `remaining` in m³).

The app calls it itself when its data is stale (at most every few minutes); it checks the server
is reachable within one second first, so an absent feed costs nothing. To test by hand:
`.venv\Scripts\python.exe telemetry_sync.py`.

**A different source** (NMEA 2000 gateway, a CSV, another database): the contract is simple -
write readings with `data.write_telemetry("engine_hours", <hours>, unit="h", source="...",
observed_at=<ISO time>)` (and `genset_hours`; tanks as `fuel_frac` / `water_frac` 0-1 and
`fuel_gal` / `water_gal`). Copy `telemetry_sync.py`
as the template. This is a good job to hand to Claude Code (see `CLAUDE.md`).

## Research with Claude

On a device's screen, **🔍 Research with Claude** reads that device's manual from your manuals folder
and drafts its make/model, maintenance tasks and spare parts **for you to review** - nothing is
written until you apply it piece by piece. It runs **Claude Code** in the background on your own
Claude subscription:

1. Install Claude Code and sign in; run `claude setup-token` and set the token it prints as a Windows
   user environment variable named `CLAUDE_CODE_OAUTH_TOKEN` (then sign out/in or reboot so the app
   sees it). If `claude` isn't on PATH, set `MXINV_CLAUDE_EXE` to the full path of `claude.exe`.
2. Keep your PDFs in one folder (sub-folders per system or brand work well) and enter it in
   **⚙ Settings → Manuals folder**.
3. The instructions it follows are in `references/DEVICE_MANUAL_RESEARCH_INSTRUCTIONS.md` - edit
   them to taste; changes apply on the next run.

It runs with read-only file access, no web access, and a per-run spending cap.

## External logbook / sail-plan broker

For boats that keep a separate electronic logbook: when enabled, each completed maintenance job
(and each cockpit **Break / Incident** report) is POSTed as JSON to `VESSEL_LOG_ENDPOINT` with a
bearer token; cockpit **Sail Plan** changes go to `SAIL_CONFIG_ENDPOINT`. Read the two modules for
the exact payloads - they are short. Until enabled, those two cockpit tiles are hidden. The
maintenance history itself always lives in the app regardless.
