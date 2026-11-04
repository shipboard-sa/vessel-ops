<!--
Purpose: Front page of the Vessel Ops Panel release package - what it is, install, first run.
Version: v2 (2026-09-24) - v2: Mac install. v1 (2026-09-24)
Scope: PRODUCTION - ships at the release root.
Architecture: Points to docs/USER_GUIDE.md (using it), INTEGRATIONS.md (optional outside
  links), CLAUDE.md + docs/dev/ (changing it).
-->

# Vessel Ops Panel

A maintenance, inventory and galley app for a cruising boat, run from a laptop aboard and used
from any browser on the boat's wifi - laptop, tablet or phone.

- **Maintenance schedule** - recurring jobs by calendar or engine hours, what's overdue, what's
  critical, defer, log a job with the parts it used.
- **Checklists** - departure, arrival, watch handover, lay-up... run them on the tablet, print
  them for a laminated card.
- **Projects** - a haul-out or a refit as phases of tasks.
- **Systems and devices** - every piece of gear with make/model, serial, manual, its spares and
  its service history; a printable service-history report.
- **Spares and tools** - where everything lives (compartment > location > container), what's low,
  a shopping list, an inventory audit walk.
- **Galley** - food stock with expiry dates, a recipe book, meal plans, a provisioning cart.
- **Cockpit view** - a big-button tablet screen at `/cockpit` for checklists and watch handover.

Everything is stored in one file, `vessel_local.db`, in this folder. No cloud account, no
internet needed once installed.

> Built with [Claude Code](https://claude.com/claude-code). If you want to change or extend it,
> open this folder with Claude Code: `CLAUDE.md` and `docs/dev/` give it (or you) the full
> background - architecture, schema, the design rules and the mistakes already made.

## Install (Windows)

You need, once:

1. **Python 3.11 or newer** - [python.org](https://www.python.org/downloads/). In the installer,
   tick **Add python.exe to PATH**.
2. **Node.js LTS** - [nodejs.org](https://nodejs.org/). Only used to build the web interface.

Then:

3. Unzip this folder somewhere permanent (e.g. `C:\VesselOps`).
4. Double-click **`setup.bat`**. It installs everything into this folder and asks whether to load
   the **example boat** ("SV Example" - a fictional 40-footer with jobs, spares, recipes and
   history already in it). Say **Y** to look around first; say **N** to start empty with your
   own boat.
5. Double-click **`run.bat`** and open **http://localhost:8000**. Leave that window open while you
   use the app.

## Install (Mac)

Same two prerequisites: **Python 3.11+** (the macOS installer from
[python.org](https://www.python.org/downloads/)) and **Node.js LTS** ([nodejs.org](https://nodejs.org/)).

1. Unzip this folder somewhere permanent (e.g. your home folder, not Downloads).
2. Double-click **`setup.command`**. The first time, macOS says it "cannot be opened because it
   is from an unidentified developer": **right-click → Open → Open** instead (once per script).
   If it still refuses, open Terminal and run
   `xattr -dr com.apple.quarantine ~/path/to/this/folder`, then double-click again.
3. Double-click **`run.command`** and open **http://localhost:8000**. Leave the Terminal window open.

Optional integrations on a Mac go in `local-settings.sh` (lines like `export NAME=value`) instead of
`local-settings.bat`. The first time a tablet connects, macOS may ask whether Python may accept
incoming connections - allow it.

### Using it from a tablet or phone

`run.bat` / `run.command` prints this computer's addresses. On a device on the same wifi open
`http://<one of those addresses>:8000` (and `/cockpit` for the tablet view). If it doesn't load,
On Windows the firewall is blocking it - run this once in PowerShell **as Administrator** (on a Mac, allow Python when asked):

```
New-NetFirewallRule -DisplayName "Vessel Ops Panel 8000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8000 -Profile Private
```

There is **no login**: anyone who can reach the laptop on the network can use the app. Keep it on
the boat's own network; do not expose port 8000 to the internet.

## First steps with your own boat

1. **⚙ Set up your boat** (top of the screen): boat name, what your engine and generator hour
   meters are called.
2. **Warehouse → storage**: rename/add compartments (a starter list is there), then locations and
   containers.
3. **Management**: build your systems and devices, then their maintenance tasks and checklists.
4. Add spares and supplies, and put them away.

The full walk-through is in **[docs/USER_GUIDE.md](docs/USER_GUIDE.md)**.

## Starter packs (optional)

Setup offers two packs on first install; either can also be added later, even after you have
entered your own boat (anything already there with the same name is skipped):

- **Recipe book** - about 1,100 recipes, tagged by main ingredient, method and category.
- **Maintenance library** - about 400 recurring jobs and 20 checklists (departure, arrival,
  watch handover, lay-up, ...) for a typical cruising sailboat, plus a haul-out project
  template. Delete or retire what doesn't apply to your boat.

Stop the app, then in this folder run (Mac: `.venv/bin/python` instead):

```
.venv\Scripts\python.exe load_starter_pack.py --db vessel_local.db recipes
.venv\Scripts\python.exe load_starter_pack.py --db vessel_local.db maintenance
```

Add `--dry-run` to see what would be added without changing anything.

## Switching from the example boat to your own

Stop the app, rename `vessel_local.db` (e.g. to `example.db`), then run `run.bat` / `run.command` - it creates a new
empty database. (Or run setup again, which offers the example only when no database exists.)

## Backups

Stop the app and copy `vessel_local.db` somewhere safe (a USB stick, a cloud folder). If files named
`vessel_local.db-wal` / `-shm` are next to it, copy them too. Restore = put the copy back.

## Updating

Replace the program files with the new version's, keep your `vessel_local.db`, run setup
again, then run. Refresh each browser/tablet hard (Ctrl+F5, or clear the tab) so it picks up
the new screens. **Back up the database before any update.**

## Optional outside links

Engine hours from a live data feed, AI-assisted reading of device manuals, sending log entries to
another logbook system: all off by default and none needed. See **[INTEGRATIONS.md](INTEGRATIONS.md)**.

## What's in this folder

| | |
|---|---|
| `setup.bat`, `run.bat` | install/update, start (Windows) |
| `setup.command`, `run.command` | install/update, start (Mac) |
| `backend/`, `data.py`, `db_schema.py` | the server and its database layer (Python) |
| `frontend/` | the web interface (React), built into `frontend/dist` by setup |
| `example_data.py` | loads the example boat into an empty database |
| `docs/USER_GUIDE.md` | how to use it |
| `INTEGRATIONS.md` | optional outside links |
| `CLAUDE.md`, `docs/dev/` | for changing the app (with or without Claude Code) |
