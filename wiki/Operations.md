<!--
Purpose: How to run, reach, back up and deploy the mx-inv app - the operational runbook.
Version: v10 (2026-10-18) - v10: current state -> schema v39 + the 10-09 / 10-18 deploys; nightly backup (live 10-07) in 'What backups exist' (the off-machine question answered); the Docker-on-the automation developer's-Pi plan marked moot (D-105); the Docker / release migrations gap marked fixed 10-07. v9 (2026-10-07) - v9: rebuild-from-spec pass - current state (laptop interim host, schema v38, boat stack on the Pi) + host history replace the 10-03 notes; launcher switches v11 and the start-time migration; Access table current; new 'Windows firewall and the network-profile gotcha', 'Where things live' table (incl. secret NAMES), 'Per-host guard files', 'Build from a blank Windows machine', 'What backups exist', 'Restore'; migration-runner text replaces 'no migration framework' (day-to-day + deploy step 4); Tests: counts, per-file table, CI jobs, what is not covered; Streamlit retirement = hardening phase 3. v8 (2026-10-03) - v8: system of record + Ship's Automation links down (key issues, accepted). v7 (2026-10-03) - v7: live host moved to the Ship's PC (note at the top; run-live.bat v6 guard). v6 (2026-09-24) - v6: new 'Tests' section (pytest suite, golden check; hardening plan phase 1); current-state line -> deploy 22; the "200 is not proof" gotcha updated. v5: new 'Docker image (built by CI, not deployed)' section - Dockerfile, backup job, compose reference, CI v2; deploy 21 (synchronous = FULL). v4: deploy 20 / schema v36 - run-live.bat v5 environment switches; Settings values are part of a deploy (step 6a); first-run init turns a wrong VESSEL_DB_PATH into a full empty DB (gotcha); new 'Building a release package' section (build command, output dir, privacy gate, cold test on the mx-inv-release-test launch entry, port 8017). v3: current-state line -> deploy 19; step 5 = the USER relaunches (a server started from a Claude session cannot run the manual-research feature); procedure count brought current. v2 (2026-09-22) - v2: current-state line -> schema v34 / d54252c (deploy 10); deploy
  count ten. v1: header added; deploy procedure brought in line with CHECKPOINT.md
  (verified backup-API backup before stopping, WAL checkpoint, scratch-copy testing, served-
  bundle check, Start-Process launch form, rollback) and the operational gotchas folded in.
Scope: PRODUCTION - engineering documentation for the mx-inv app.
Architecture: mx-inv wiki page. CHECKPOINT.md's "Run it" / "Deploy procedure" / "Gotchas" are
  the short authoritative form; this page is the fuller explanation of the same steps.
Invocation: n/a (reference doc).
-->

# Operations

**Current as of 2026-10-18:** live code = branch **`logbook-page`**, schema **v39** (logbook v37 +
passages v38 + the Ship's Log review v39, live 2026-10-08); later no-schema deploys: cockpit Tanks / 'Filling'
tap + watermaker guard (10-09), WF-502 cold-box restock (10-18, `f6b7734`). Served from the **laptop** (`lee-lenova`, `http://192.168.1.144:8000`, + /cockpit,
/routing) as the **interim live host** while the Ship's PC is away for an MSI warranty repair (since
2026-10-05). The cockpit reads **our boat stack on boat-automation (the Pi, 192.168.1.10)** because
`BOAT-STACK-ON-PI.txt` sits beside `run-live.bat` (see [Per-host guard files](#per-host-guard-files)).
Run the test suite before any deploy -
see [Tests](#tests). Commit and backup filenames are in `CHECKPOINT.md` State; the per-deploy list is in
[Roadmap](Roadmap.md); the rollback points in `CHECKPOINT.md`.

**Host history (why the guard files exist):** laptop (2026-09-16 - 10-03) -> Ship's PC
(`E:\boat\vessel-ops`, `http://192.168.1.100:8000`, 10-03 - 10-05; the laptop refused to start while
`LIVE-HOST-MOVED.txt` sat beside its launcher) -> laptop again (10-05, interim; the live DB copied off the
boat drive, which now carries a frozen `LIVE-HOST-MOVED.txt`). **There is only ever one live
`vessel_local.db`.** A host move is a planned hand-over of that file (stop, verified backup, copy, verify,
flip the guard files) - never a merge, never two servers on two copies. The old long-term plan (the Pi
in Docker through the previous developer's Ansible, Ship's Automation D-077, [below](#docker-image)) is **moot since the 10-06
cut-over (D-105)**; whether mx-inv later moves into a container on our Pi is (ASSUMED - ask the owner). **Copy-back to the Ship's PC** when it returns:
the Ship's PC must first run the SAME code (schema) as the laptop - older code refuses a newer database by
design (the migration runner's `SchemaTooNew`); the steps are in the laptop's `LIVE-HOST-INTERIM.txt`.

## Running the app

**Normal daily use**: double-click `

- Runs `npm run build` (writes `frontend/dist`) every launch, starts the
  routing GUI backend on `127.0.0.1:8100` in its own minimised window (unless
  one is already listening), then starts `uvicorn backend.main:app` bound to
  `0.0.0.0:8000`. About 35 s end to end.
- **Its only build guard is `if not exist "frontend\dist\index.html"`** - if
  the build fails but a PREVIOUS `dist` is still there, it starts anyway and
  serves the old bundle with the new backend. Watch the npm output, and after
  any deploy confirm the served bundle (see the deploy section).
- Wait for `Uvicorn running on http://0.0.0.0:8000` in the console window.
- Stop with **Ctrl+C** in that window, or just close it.
- Talks to `vessel_local.db` directly — real production data, same as the
  old Streamlit app always did.
- **It sets the integration switches** before starting uvicorn (v5 onward; v11 today) - the app
  itself assumes no network: `MXINV_ROUTING_URL=http://127.0.0.1:8100` (without it there is no
  `/routing`); the boat stack `MXINV_ENGINE_URL` / `MXINV_SIGNALK_URL` / `MXINV_HISTORY_URL` (defaults
  `127.0.0.1:8210` / `:3000` / `:8090`, the Pi's addresses when `BOAT-STACK-ON-PI.txt` is present) and the
  token files `MXINV_ENGINE_TOKEN_FILE` / `MXINV_SIGNALK_TOKEN_FILE` under `%USERPROFILE%\.boat-secrets\`;
  `MXINV_INFLUX_URL=http://192.168.1.10:8086` + org `boat-auto` + genset match
  `generator,genset,westerbeke` (the previous developer's Influx; cleared by `BOAT-STACK-ON-PI.txt`); `MXINV_DECK_LOG=off`
  under `LIVE-HOST-INTERIM.txt`; `PYTHONUTF8=1`. `VESSEL_LOG_*` stays unset (no endpoint exists).
  Starting uvicorn by hand without these = no routing proxy, no boat stack, no Influx sync (the app
  otherwise works). Full table: [Architecture](Architecture.md#integrations-boundary).
- **At start the server migrates the database** if it is behind the code (verified backup first,
  `vessel_local.db.bak-premigrate-v<N>-<stamp>`), and **refuses to start** if the database is NEWER than
  the code - see [Schema](Schema.md) "How a database gets to the current version". Watch the console for
  `Database migrated to schema vNN`.
- It also refuses to start when `LIVE-HOST-MOVED.txt` sits beside it, and says so if port 8000 is already
  listening (an earlier server still running).

Two thin root-level wrappers exist purely for framing (auto-opening a
browser, printing the tablet hotspot IP) but both just `call` this same
script under the hood: `run-local.bat` and `run-tablet.bat` at
`D:\Documents\sailboat\` (repo root, one level up from `<your-project-dir>`).

**Development** (hot-reload both sides):
```bash
# terminal 1
uvicorn backend.main:app --reload --port 8000
# terminal 2
cd frontend && npm run dev
```
Open `http://localhost:5173` — Vite's dev server proxies `/api/*` to 8000.

**Scratch-DB discipline** (the way to test a change against realistic data
before it reaches production; it replaced the old `run-trial.bat` /
`vessel_local.trial.db` pair, both removed 2026-09-20): make a
backup-API copy of live to `vessel_local.scratch.db`, migrate the copy if the
change needs it, then start the scratch pair defined in
`
`mx-inv-scratch-backend` (uvicorn on `127.0.0.1:8016`, `VESSEL_DB_PATH` set to
the scratch file by ABSOLUTE path) and `mx-inv-scratch-frontend` (Vite on
`5175`, proxying to 8016). Test in the browser, then **stop both servers and
delete `vessel_local.scratch.db` and any `.bak-*` a migration left beside
it** - scratch data never carries over. The scratch backend has no
`--reload`: restart it after a backend change. `.gitignore` already excludes
`vessel_local.scratch*.db*` and `vessel_local.trial.db*` (including SQLite's
WAL/SHM sidecar files).

## Access / network

There is **no authentication** — the trust boundary is the network, not the
app (see [Design Decisions](Design-Decisions.md#no-auth)). Anyone who can
reach port 8000 has full read/write access.

| Path | URL (interim host = the laptop, 2026-10-07) |
|---|---|
| The host itself | `http://localhost:8000` |
| Boat Wi-Fi / LAN (tablet, the crew's phone, the Pi) | `http://192.168.1.144:8000` (the laptop's address on the boat LAN, 192.168.1.x/24, GL-X3000 router since 10-07); the Pi's landing page `http://192.168.1.10:8080/` links to it |
| the owner's tailnet | `http://lee-lenova:8000` (100.112.87.74) - or the LAN address through the Pi's subnet route; see `CHECKPOINT.md` Open for the state of off-boat access |
| When the Ship's PC is the host again | `http://192.168.1.100:8000` (Ship's Automation F-153) |

`run-live.bat` prints every IPv4 of the host on start. The ports: **8000** = mx-inv (the only one
opened to the network), **8100** = the routing app, `127.0.0.1` only, reached through mx-inv's
`/routing` proxy.

### Windows firewall and the network-profile gotcha

The rule that opens 8000 (run once as Administrator; it exists on the laptop as "Vessel Ops Panel 8000",
any remote address, all profiles - a second rule "mx-inv 8000 (boat LAN, temporary)" was added for the
interim hosting):
```powershell
New-NetFirewallRule -DisplayName "Vessel Ops Panel 8000" -Direction Inbound `
  -Action Allow -Protocol TCP -LocalPort 8000 -Profile Private,Public,Domain
```

**Symptom: LAN clients time out while the server is up and `localhost` works = the Wi-Fi network profile
went Public** (2026-10-07, after the router swap Windows saw a "new" network and classed it Public). Two
Public-profile BLOCK rules on the global Python (`python.exe` 3.14, which the venv's launcher runs) override
the 8000 allow rule - in Windows Firewall a matching block beats an allow. **Fix (the owner, Settings):** Wi-Fi ->
the network -> Network profile type -> **Private**. Test from another machine (e.g. the Pi):
`curl http://192.168.1.144:8000/`. **Keep the block rules** - they protect the laptop on public Wi-Fi; the
fix is the profile, not deleting rules. Any new host (or a router change) needs the same check.

## Where things live

| What | Where |
|---|---|
| Code | `shipboard-sa/vessel-ops` on GitHub (private), live branch `logbook-page` (also pushed as `mx-inv-webapp`); checkout on the laptop ` on the Ship's PC `E:\boat\vessel-ops` |
| The routing app | sibling checkout `..\routing` (`shipboard-sa/passage-planner`), its own `.venv`; started by `run-live.bat` |
| Live database | `vessel_local.db` beside `run-live.bat` on the live host (+ `-wal` / `-shm` while running); gitignored |
| Backups | `vessel_local.db.bak-*` beside it (see [Backup](#backup)); `_sync_safe\vessel_local.db` (snapshot for Syncthing) |
| Per-host switches | `LIVE-HOST-*.txt`, `BOAT-STACK-ON-PI.txt` beside `run-live.bat`, gitignored ([below](#per-host-guard-files)) |
| Secrets (names only) | `%USERPROFILE%\.boat-secrets\engine.env` (`ENGINE_API_TOKEN`, `MXINV_EVENTS_TOKEN`), `%USERPROFILE%\.boat-secrets\mxinv-signalk.env` (`SIGNALK_TOKEN`), `~\.vessel_ops\boat.env` (`token =` for the previous developer's InfluxDB, read-only), user env var `CLAUDE_CODE_OAUTH_TOKEN` (device research). None is in git (`.gitignore`: `*.env`, `.vessel_ops/`). |
| Research drafts, golden files | `var/` (gitignored) |
| Manuals (device research) | Settings `manuals_root`, live `D:\Documents\sailboat\Manuals` |

The laptop was chosen over the always-on shore NAS as the first host (the app's design centre is running
disconnected on the boat LAN; the NAS is ashore) - see
[Design Decisions](Design-Decisions.md#laptop-not-nas-hosting).

## Per-host guard files {#per-host-guard-files}

Small gitignored text files beside `run-live.bat` say what THIS machine is. They are per-host switches,
not code, so a `git pull` never changes them. `run-live.bat` (v11) reads them at start:

| File | Effect in `run-live.bat` | Where it is now |
|---|---|---|
| `LIVE-HOST-MOVED.txt` | **Refuses to start** and prints the file (it says where the live server is). Stops a stale `vessel_local.db` from ever being served beside the real one. | On the Ship's PC's boat drive (frozen while the laptop is interim). On the laptop it is parked as `LIVE-HOST-MOVED.txt.parked-20261005` (no effect) - renamed back at the copy-back. |
| `LIVE-HOST-INTERIM.txt` | Sets `MXINV_DECK_LOG=off` (an interim host with no boat stack must not write "No boat data" deck-log lines into the append-only log). Its text is the copy-back procedure. | On the laptop. Overridden by `BOAT-STACK-ON-PI.txt` (the deck log comes back on). |
| `BOAT-STACK-ON-PI.txt` | Points the cockpit at the Pi: `MXINV_ENGINE_URL=http://192.168.1.10:8200`, `MXINV_SIGNALK_URL=http://192.168.1.10:3000`, `MXINV_HISTORY_URL=http://192.168.1.10:8090`; clears `MXINV_DECK_LOG` (ON) and `MXINV_INFLUX_URL` (the previous developer's Influx feed off). Create it only once the Pi serves data. Delete it when mx-inv runs beside the stack (then the `127.0.0.1` defaults apply). | On the laptop since 2026-10-06 (Ship's Automation D-116 / D-117). |

A new host: none of these files -> `run-live.bat`'s defaults (stack on `127.0.0.1`, deck log on if SignalK
answers). Moving the live host = create `LIVE-HOST-MOVED.txt` on the old one in the same session as the copy.

## Build from a blank Windows machine {#build-from-blank}

What a fresh host (or a rebuild after a disk loss) needs. Versions are the ones the live laptop runs;
CI uses Python 3.13 / Node 24 and passes, so 3.13+ is fine.

1. **Install**: Git; Python 3.13+ (live: 3.14.7; the release `setup.bat` accepts 3.11+); Node.js LTS with
   npm (live: v24, at `C:\Program Files\nodejs` - `run-live.bat` puts that on `PATH`). Optional: Tailscale
   (the owner's tailnet), the Claude Code CLI (device research only).
2. **Clone** next to each other, e.g. `D:\Documents\sailboat\code\`:
   `git clone https://github.com/shipboard-sa/vessel-ops.git mx-inv` (check out `logbook-page`) and
   `git clone https://github.com/shipboard-sa/passage-planner.git routing` (optional - without it `/routing` shows an
   error page and the cockpit has no weather line). `.gitattributes` keeps `.bat` files CRLF (cmd misreads LF
   batch files) - do not "fix" their line endings.
3. **Python env** in `mx-inv`: `py -3 -m venv .venv`, then
   `.venv\Scripts\python.exe -m pip install -r requirements-dev.txt` (= `requirements-server.txt`, pinned:
   FastAPI, Starlette, pydantic, uvicorn[standard] (brings `websockets`, used for the SignalK write), httpx,
   requests, python-multipart, pandas, numpy - plus pytest). `requirements.txt` is the older unpinned list
   that still carries Streamlit for the retired `app.py`; not needed.
4. **Frontend**: `cd frontend && npm ci` (lockfile `package-lock.json`; React 19, React Query 5, Vite 8,
   TypeScript 6). `run-live.bat` runs `npm install` itself if `node_modules` is missing and `npm run build`
   (= `tsc -b && vite build`) on every start.
5. **Routing app** (optional): its own `.venv` per `
6. **Database** - one of:
   - **Restore** the live file from the newest verified backup (see [Restore](#restore)) to
     `mx-inv\vessel_local.db`; or
   - **Start empty**: just start the server - `db_schema.ensure_initialised()` builds a full empty schema
     (generic compartments, no crew) when the file is missing; or load the fictional example boat with
     `.venv\Scripts\python.exe example_data.py --db vessel_local.db` (refuses a non-empty DB).
   Either way the migration runner brings an older file up to the code's version at start (verified backup
   first) and refuses a newer one.
7. **Secrets** (names, never values in git or the wiki): copy `%USERPROFILE%\.boat-secrets\engine.env` and
   `mxinv-signalk.env` from the old host / the secrets backup, or re-issue them: the engine token from the
   Ship's Automation stack, mx-inv's SignalK device token with `scripts\signalk_device_token.py` + the owner's approval
   in SignalK admin. Without them the cockpit is read-only (status, alarms, card) and the Sail Plan write is
   off. Engine events need `MXINV_EVENTS_TOKEN` in `engine.env` matching the engine's side.
8. **Per-host files**: create `BOAT-STACK-ON-PI.txt` if the boat stack is on another machine (the Pi);
   `LIVE-HOST-INTERIM.txt` if there is no boat stack at all. Never copy a `LIVE-HOST-MOVED.txt` onto the
   live host.
9. **Network**: the firewall rule above; set the boat Wi-Fi profile to **Private**; reserve a fixed address
   for the host on the router and tell the engine side its mx-inv URL (`boat_mxinv_url`, today
   `http://192.168.1.144:8000`) and the Pi landing page's `MX` link.
10. **Owner Settings**: on an empty DB open ⚙ Settings (or `PUT /api/settings`) - vessel name
    "SV Your Boat Name", engine label "Yanmar", genset label "Westerbeke genset", manuals folder. A
    restored DB already has them.
11. **Check**: `.venv\Scripts\python.exe -m pytest tests -q` (all pass, two strict xfails), double-click
    `run-live.bat`, then the read-only checks in step 6 of the deploy procedure below.

Optional desktop shortcut: `D:\Documents\sailboat\create-desktop-shortcut.bat`; the root-level
`run-local.bat` / `run-tablet.bat` only wrap `run-live.bat`.

## Backup

`vessel_local.db` is a WAL-mode SQLite file, **no longer git-tracked**
(changed 2026-09-17 - it used to be, but committing the live file directly
was both noisy, since WAL-mode checkpointing rewrites page layout with
zero logical change on every server restart, and theoretically unsafe, the
same class of hazard a raw file copy has). git now tracks code only.

The real backup path is `db_snapshot.py` — SQLite's online `.backup` API,
safe against the live database with no downtime — feeding the Syncthing
pipeline (`_sync_safe/vessel_local.db`, gitignored; see the
`backup-infrastructure` project memory for the full laptop→Ship's
PC→NAS relay design, gated by a daily task). `.stignore` excludes the live
DB file itself from that sync (to avoid syncing mid-write) — only the safe
snapshot ever leaves this machine. `backup-snapshot.bat` is a one-click
manual trigger for that snapshot, usable today even though the Syncthing
pairing to the Ship's PC/NAS isn't wired up yet.

Separately, every migration script and every risky one-off data change
still takes its own local `vessel_local.db.bak-<YYYYMMDD-HHMMSS>` snapshot
immediately before writing (these accumulate in the repo directory,
currently a dozen-plus, gitignored) — a pre-write safety net, not part of
the off-machine backup story above. Each deploy also takes its own
`vessel_local.db.bak-predeploy-<YYYYMMDD-HHMMSS>` first (below); the current
list of rollback points lives in `CHECKPOINT.md`.

### Verified backup (the pattern every deploy uses)

Never a file copy (it misses the WAL), and never trust a backup you did not
verify. Write it as a script file (not a heredoc / `python -c`):

```python
import sqlite3, time
SRC = r"
DST = SRC + ".bak-predeploy-" + time.strftime("%Y%m%d-%H%M%S")
src = sqlite3.connect(f"file:{SRC}?mode=ro", uri=True)   # read-only source
dst = sqlite3.connect(DST)
src.backup(dst)                                           # SQLite online backup API
def counts(c):
    tabs = [r[0] for r in c.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    return {t: c.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tabs}
assert dst.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
assert counts(src) == counts(dst)                         # every table, row for row
print(DST, sum(counts(dst).values()), "rows")
```

Then check the file really exists (path, size) before going on.

### What backups exist

| Kind | Made by | Name / place | Kept |
|---|---|---|---|
| Pre-deploy | the deploy procedure (step 2, by hand, script above) | `vessel_local.db.bak-predeploy-<stamp>` beside the DB | until pruned by hand; the current rollback points are listed in `CHECKPOINT.md` |
| Pre-migration | the migration runner, automatically | `vessel_local.db.bak-premigrate-v<N>-<stamp>` | same |
| Pre-data-change | every one-off data script / API data pass | `vessel_local.db.bak-pre-<what>-<stamp>`, `...bak-<stamp>` | same |
| Sync snapshot | `db_snapshot.py` / `backup-snapshot.bat` (backup API, safe while serving) | `_sync_safe\vessel_local.db` (one file, overwritten) | for the Syncthing relay; the relay is parked (see `backup-infrastructure` notes) |
| Nightly (LIVE since 2026-10-07; v2 10-08) | `scripts/nightly_backup.py` via Task Scheduler "mx-inv nightly backup", 19:00 | verified copy in `var/backups/nightly/` + the Pi `~/backups/mx-inv/` + the crew's laptop ` (192.168.1.145, over SSH), sha256 checked at each end | retention not decided |
| ~~Nightly (Pi plan)~~ | `docker/backup.py` under a systemd timer - moot with the Docker-on-the automation developer's-Pi plan (D-105) | - | - |

The first four are on the host's own disk. **Off-machine:** the nightly job copies a verified backup to the
Pi and to the crew's laptop every evening (it needs the laptop on at 19:00 - a Pi nudge for that is open; no
backup runs while the crew's laptop is the host). the owner also copies a verified backup to another drive at host
moves; the Syncthing hop to the Ship's PC and NAS is parked.

### Restore {#restore}

A restore loses every entry made since the backup - do it only when data is actually damaged or a
rollback crosses a schema boundary.

1. Pick the backup: same schema version as the code you will run (`SELECT value FROM system_config WHERE
   key='schema_version'` on the backup; or run newer code and let the runner migrate it up). Older code
   refuses a newer file.
2. Verify it: open it read-only, `PRAGMA integrity_check` = ok, `PRAGMA foreign_key_check` empty, row counts
   plausible.
3. Stop the server (and anything else holding the DB). Move the damaged `vessel_local.db`, `-wal` and `-shm`
   aside (keep them).
4. Copy the backup to `vessel_local.db` with the backup API (or a plain file copy - a `.bak-*` made by the
   backup API is a self-contained file with no WAL).
5. Start `run-live.bat`; check `/api/health`, the schema version, a few screens; tell the users what was
   lost (everything after the backup's time).

Moving the live host is the same as a restore onto another machine, plus the guard files
([Per-host guard files](#per-host-guard-files)).

## Retired but not deleted: the Streamlit app

`app.py` (port 8601) is the pre-rewrite UI. It still runs
(manually only - its launcher `run-multiuser.bat` was removed 2026-10-07 - via
`.venv\Scripts\python.exe -m streamlit run app.py`) but nothing launches it
by default anymore, and it was not running at the time of cutover. the owner approved
retiring it on 2026-09-24 (with the hardening plan); deleting `app.py` and its
`*_tab.py` / `gui_components.py` companions is **hardening phase 3** (together with
dropping pandas from the server) and has not been done - see [Roadmap](Roadmap.md).
Do not build on it.

## Day-to-day maintenance notes

- **A "crashed" report is usually an orphaned process, not a real crash** —
  check `netstat -ano | findstr :8000` (or PowerShell
  `Get-NetTCPConnection -LocalPort 8000 -State Listen`) before assuming the
  server is down; closing the console window instead of Ctrl+C leaves the
  `python.exe` child bound to the port with no window to show for it. The
  listener's PARENT is the venv launcher: `taskkill /PID <parent> /T /F`
  stops both. (If Claude's harness blocks the `taskkill`, ask the owner to stop it
  himself rather than working around the block.)
- **Schema changes go through the migration runner** (since v37): a new
  `migrations/vNNN_<name>.py` step, applied automatically at the next server start after a verified
  backup, rehearsed first on a scratch copy. The recipe for adding a version and the rules are in
  [Schema](Schema.md) ("How a database gets to the current version"). v7-v36 were one-off scripts
  (`scripts/oneoff/migrate_schema_vNN.py`, dry run on an in-memory copy by default, `--apply`, row counts
  + `integrity_check` / `foreign_key_check` before commit) - kept as history. **A rollback across a schema
  boundary** needs the code AND the database backup of the same version: the runner refuses to let older
  code open a newer file.
- **Write-path changes get verified against a scratch DB copy or a
  read-only pass against whatever live session is running**, never against
  production directly, before being declared done — see the
  `history/` archive for the standard "verify, then land" discipline used throughout
  development.

## Tests {#tests}

- **Regression suite:** `.venv\Scripts\python.exe -m pytest tests -q` - on `logbook-page` (2026-10-07):
  **143 passed, 2 xfailed** in about 2 minutes on the laptop (`review-batch`: 149). Every test gets its own
  throwaway database: `tests/conftest.py` points `VESSEL_DB_PATH` at a temp file before anything imports
  `data.py`, refuses to run if that could be the live file, and hands each test a fresh schema (`db`), the
  fictional SV Example boat (`example_db`), or a FastAPI `TestClient` over either (`client`,
  `example_client`). The boat stack is never contacted: tests patch `backend.log_stamp.stamp` /
  `boat_link`'s httpx calls. Rules are checked by reading the database back directly (`tests/helpers.py`
  `sql()` / `one()`), never by trusting a status code. CI runs the same suite (`requirements-dev.txt`). Two
  strict `xfail`s in `test_api_roundtrip.py` record that unknown PATCH fields are still accepted; phase 4 of
  `design/ARCH_HARDENING_PLAN.md` makes them pass - remove the markers then.

| File | What it pins |
|---|---|
| `test_api_edges.py` | health; an unmatched `/api/...` is 404 JSON, not the SPA page; files are never served from outside `frontend/dist` (the deploy-22 path traversal); SQLite pragmas (WAL, `synchronous = FULL`, foreign keys) |
| `test_api_roundtrip.py` | every field sent to the main write routes is read back from the DB; the two xfails = unknown fields silently dropped |
| `test_schedule.py` | the 8-bucket projection: bucket boundaries, never-done baselines (`schedule_from`), deferral, critical, what drops off the board |
| `test_checklists.py` | one shared step / link order; a linked-task tick is a real completion; an un-tick voids it |
| `test_stock.py` | plain-row merge into a zero "home" row; Unassigned resolution; receive (split, all-or-nothing, older expiry); storage deletes never orphan stock; container moves; stow draws Unassigned first |
| `test_history.py` | `complete_task`, void, the append-only triggers (raw-SQL attacks refused), past service records, cost OR document, follow-ons, delete vs retire |
| `test_cockpit.py` | capabilities, heartbeat, the weather read (missing / empty / unreadable / partial briefings never 500), boat status / mode tap / ack, engine down = 502, no token = 503 |
| `test_handover_card.py` | unit conversions, stale values dropped, "this watch" deltas from history, course hidden when stopped, the endpoint's 503 / 502 |
| `test_logbook.py` | crew entries with stamp + fix task, the status chain, append-only triggers, the engine push (token, 409 on a repeat, simulated kept), this-watch, the watch entry |
| `test_logbook_page.py` | the printable day / passage (`GET /api/report/logbook`): order, stamps, status chains, TEST events hidden by default, open-failure register, bad dates refused; list filters |
| `test_migrations.py` | the runner: no-op at target, step applied with a verified backup + version bump, dry run leaves the file untouched, a failing step rolls back, a newer database refused, `SCHEMA_VERSION` == runner target |
| `test_passages.py` | the v37 -> v38 rebuild keeps every row / id / sequence / child link / trigger; departure / arrival order (409); derived passages with duration, distance, counts; port pick list; printable passage |
| `test_ship_log_review.py` (review-batch) | signed entries (server-enforced), the watchkeeper, status changes by day, fix task -> open failures, engine on / off (repeat refused), wind angle on the stamp, printout status-change lines |

- **CI** (`.github/workflows/ci.yml`, on push): `api` job (Python 3.13: `scripts/ci/smoke_api.py` on a fresh
  temp DB + the example boat, then pytest), `frontend` job (Node 24: `npm ci`, `npm run build`), `image` job
  (Docker build, start as UID 2300, probe `/api/health`, run `docker/backup.py`).
- **Golden check (local only, real data):** `scripts/golden_check.py save <label>` copies
  live with the backup API (read-only) and saves what 28 read endpoints return to
  `var/golden/<label>.json` (ignored by git - private data); `diff <a> <b>` compares two. Use
  it around a refactor that must not change behaviour: save before, save after (the SAME day -
  dates are relative), diff.
- **Not covered by automated tests:** the React screens (checked by hand in the browser on a scratch copy
  - see the deploy procedure), the real boat stack (only fakes), the device-research CLI run, the Mac
  launchers.
- Add a test with every behaviour change; a bug fix gets the test that would have caught it.

## Deploying a change to the live server

The procedure every deploy since 2026-09-22 has followed (schema v29 → v38, deploys 1-24 and the 10-05 laptop deploys);
follow it for any change that touches the schema, `data.py`/routers, or the
frontend bundle. Frontend-only deploys use the same steps minus the
migration. `CHECKPOINT.md` "Deploy procedure" is the short form.

0. **Build and test on a scratch copy first** (see "Scratch-DB discipline"
   above: backup-API copy → `vessel_local.scratch.db`, migrate it, run the
   `mx-inv-scratch-backend` / `mx-inv-scratch-frontend` pair on 8016 / 5175,
   click through, then stop them and DELETE the scratch DB and any `.bak-*`
   beside it). **Use absolute paths** in any launch entry: a relative
   `VESSEL_DB_PATH` once made the backend create an empty stray DB.
   Typecheck the frontend with **`npx tsc -b`** (see gotchas below), and
   read every written value back from the DB - never trust the status code.
1. **Confirm the DB is idle** (`vessel_local.db-wal` last-write time is old;
   tell the people using it) and that the owner said go.
2. **Verified backup first**, while the server is still up: the backup-API
   pattern in [Backup](#verified-backup-the-pattern-every-deploy-uses) to
   `vessel_local.db.bak-predeploy-<stamp>`, integrity + per-table row counts
   equal to the source.
3. **Stop the server**, then `PRAGMA wal_checkpoint(TRUNCATE)` (a
   force-killed server leaves a WAL), then `python db_snapshot.py` (sync
   snapshot to `_sync_safe/`). Find it with
   `Get-NetTCPConnection -LocalPort 8000 -State Listen` and stop the
   listener's parent (see day-to-day notes above).
4. **Migrate** (schema change only). **v37 on (the `migrations/` runner):** nothing to run by hand -
   the relaunch in step 5 migrates at start, after its own verified backup
   (`vessel_local.db.bak-premigrate-v<old>-<stamp>`). To see what it will do first:
   `.venv\Scripts\python.exe -m migrations --db <absolute path to live>` (dry run on an in-memory copy;
   `--apply` would migrate the file). A newer-than-code database stops the server - that is a rollback
   mistake, restore the matching backup. **Up to v36** (history): `scripts\oneoff\migrate_schema_vNN.py`,
   dry run then `--apply`, its own `.bak-<stamp>`. A data-only, no-DDL one-off script keeps the
   dry-run-then-`--apply` shape, with no `SCHEMA_VERSION` bump.
5. **Relaunch** with `run-live.bat`, which rebuilds `frontend/dist` itself -
   AFTER the backend is stopped; never rebuild `dist` under an older running
   backend (use `npx vite build --outDir <temp>` to test a build without
   touching it). **The user relaunches it** (double-click), not a Claude session: a
   process started from inside an open Claude Code session inherits a stale environment,
   so the "Research with Claude" manual-reading feature (#50, needs the current
   `CLAUDE_CODE_OAUTH_TOKEN`) shows as unavailable until the server is restarted from
   outside. Check `GET /api/device-research/status` -> `{"available":true}` after the
   relaunch. Only if the user is away and the feature can wait, Claude's PowerShell
   tool can launch it with exactly:
   `Start-Process cmd.exe -ArgumentList '/c','start "mx-inv-live" /D  run-live.bat'`.
   A plain `cmd.exe /c 'start …'` from the Bash tool does NOT reliably spawn
   a real detached window.
6. **Verify (read-only)**: `/`, `/api/health`, `/api/schedule`, `/api/items`,
   `/api/projects`, `/api/recipes`, `/cockpit/`, `/routing/` all 200 **and
   the body is what that route should return** (not `index.html`);
   schema_version, `integrity_check`, `foreign_key_check`, row counts; **the
   served bundle is the new one**:
   `curl -s localhost:8000/ | grep -o 'index-[A-Za-z0-9_-]*\.js'`, then grep
   that file under `frontend/dist/assets/` for a string you just added (a
   `dist/assets` mtime older than the deploy means the build did not run);
   open the changed screen in the browser and cancel without writing; no
   console errors. Tell users to **hard-refresh** (the tablet keeps the old
   bundle). The routing backend (8100) is a separate process and is not
   restarted by this. `/routing/` only answers if `run-live.bat` set
   `MXINV_ROUTING_URL` (v5 does).
6a. **Owner Settings exist** (since deploy 20): `GET /api/settings` must show
   `vessel_name` "SV Your Boat Name", `engine_label` "Yanmar", `genset_label`
   "Westerbeke genset", `manuals_root` `D:\Documents\sailboat\Manuals`. Deploy 20 set them
   once (deploy 20 did it with `data.update_settings()` from a script with `VESSEL_DB_PATH` set; the ⚙ Settings dialog or `PUT /api/settings` work too); they are data, so a restore from a pre-deploy-20 backup
   loses them. Blank vessel_name = printouts carry no boat name and the header shows
   "⚙ Set up your boat"; blank manuals_root = "Research with Claude" unavailable.
7. **Record it** in `CHECKPOINT.md` State: code commit, backup filenames,
   what was verified, the served bundle name.

**Rollback** needs two things of the SAME schema version: the code commit
(`git checkout <commit>`) and, if the rollback crosses a schema boundary, a
DB backup taken at that version - vNN code cannot run against a vNN+1 DB or
vice versa. Restore a DB only if data was actually damaged: every entry made
since the backup is lost by a restore. `CHECKPOINT.md` lists the current
rollback points (commits and `.bak-*` files) newest first.

**Data changes on live** (moves, renames, seed data) go through the app's
own API so its rules apply, after a fresh verified backup - not raw SQL.

### Deploy gotchas (each one has bitten a real deploy)

- **Typecheck with `npx tsc -b`, NEVER `npx tsc --noEmit -p tsconfig.json`.**
  `frontend/tsconfig.json` is a solution file (`"files": []` plus
  references), so `-p tsconfig.json` checks nothing and exits 0 on broken
  code. That let a real type error through on 2026-09-22; `npm run build`
  then failed inside `run-live.bat`, which started anyway on the previous
  `dist` - new backend, silently stale frontend. Hence the served-bundle
  check in step 6.
- **A 200 from this app is not proof.** Until deploy 22 the SPA catch-all answered 200 with
  `index.html` for any unmatched GET, `/api/...` included (this hid the slash-named-device bug
  until v32); now an `/api` miss is a 404 JSON, but a dropped write field still answers 200.
  Check the body.
- **A field must be declared in BOTH the backend pydantic model and the
  frontend TS type**, or it is silently dropped and the write still answers
  200. `tsc -b` catches the frontend half; only a round-trip test (write,
  then read the value back from the DB) catches the backend half.
- **`VESSEL_DB_PATH` must be set (absolute) BEFORE importing `data.py`** in
  any script - see below.
- **A wrong `VESSEL_DB_PATH` now gets a whole new database** (deploy 20): `backend/main.py`
  runs `db_schema.ensure_initialised()` at import, so a missing/empty file is built out to a
  full empty schema with generic compartments - an app that starts fine and shows nothing.
  If a server comes up empty, check the path before anything else. (It never touches a file
  that already has tables, and never migrates.)

Lessons from 2026-09-19 (keep doing these):

- **Verify the backup exists** (path, size, `integrity_check`, table counts equal to the
  source) before migrating - do not assume the command worked. A quoting error once left
  the "predeploy" copy uncreated; only the migration script's own backup existed.
- **A one-off script's dry run must never touch the live file.** `data.py` and
  `db_schema.py` bind `DB_PATH` at import time, so set `VESSEL_DB_PATH` (or open your own
  sqlite connection to a temp copy) BEFORE importing them - `fix_recipe_links_20260919.py`
  once "dry-ran" against live for exactly this reason. Add a guard that refuses unless
  `data.DB_PATH` equals the file you meant to use.
- Also run `python db_snapshot.py` (or `backup-snapshot.bat`) to push a snapshot into the
  Syncthing backup pipeline (`_sync_safe/`) at each deploy.
- Multi-line Python containing apostrophes: write a script file instead of a shell heredoc.
- The relaunch may need an explicit go-ahead from the user in the session (the harness can
  block it as a production deploy); if it does, stop and ask - do not work around it.

## Docker image (built by CI, not deployed) {#docker-image}

**Moot since the 2026-10-06 cut-over (D-105 - nothing of the previous developer's runs in our stack):** the plan to move the
app onto the previous developer's Pi was `design/DOCKER_DEPLOYMENT_SPEC.md` (v5); kept as a record. What exists
in this repo today, all exercised by CI on every push to `mx-inv-webapp`:

- `Dockerfile` - Node builds `frontend/dist`, runtime is `python:3.13-slim-bookworm` with
  `requirements-server.txt`; `VESSEL_DB_PATH=/srv/data/vessel_local.db` (the stack mounts the DB
  **directory** there); healthcheck on `/api/health`. The `.dockerignore` is an **allowlist** - the
  working tree holds an SSH key, the live DB and ~140 backups; never turn it into a denylist.
- `docker/backup.py` - the nightly job the Pi's systemd timer will run with `docker exec`:
  backup-API copy, integrity + FK + per-table row-count check against the source, rename into
  place, 14-day prune, non-zero exit on failure. Runs fine on the laptop too
  (`python docker/backup.py --db <copy> --out <dir>`).
- `docker/docker-compose.reference.yml` + `docker/.env.example` - the shape the PR to the previous developer's repo
  will copy (openhab-net, UID 2300, bind mounts under `data/`, no `ports:`). Container IPs are
  placeholders.
- `.github/workflows/ci.yml` v2 - `api` (fresh temp DB + the example boat + JSON-body checks,
  `scripts/ci/smoke_api.py`), `frontend` (`npm run build`), `image` (build, start as UID 2300,
  probe, run the backup). Nothing is pushed to a registry until that is decided with the automation developer.

The laptop does not have Docker; CI is the build environment.

**Fixed 2026-10-07 (was broken since v37):** the `Dockerfile` copies `data.py db_schema.py telemetry_sync.py`
and `backend/` but not the `migrations/` package (and `.dockerignore`'s allowlist does not admit it), so the
image's server dies at start with `ModuleNotFoundError: No module named 'migrations'` - the CI `image` job
has failed on every push since 2026-10-05 (deploy 24). Fix: `COPY migrations/ migrations/` + `!migrations/`
in `.dockerignore` - both done 10-07 (Dockerfile v2, `.dockerignore` v2, `build_release.py` v3); CI green
again on the 10-09 pushes.

## Building a release package {#building-a-release-package}

The generic, privacy-scrubbed package for other boats (v0.1.0 built and cold-tested on
Windows 2026-09-24; **v0.1.1** rebuilt the same evening with the deploy-22 SPA-fallback fix -
v0.1.0 serves any file via an encoded `..%2F`, never ship it). `tests/` is not in the allowlist
(its fixtures use crew names). Nothing here touches the live app or DB. Tooling is described in
[Architecture](Architecture.md#release-package-tooling).

1. **(Only if the starter packs should change)** re-export from live, read-only:
   `.venv\Scripts\python.exe scripts\release\export_starter_packs.py` -> rewrites
   `release_files/starter_packs/{recipes,maintenance_library}.json` + `REVIEW.md`. Edit the
   script's override/drop maps, not the JSON; the owner reviews `REVIEW.md` (accepted for v0.1.0).
2. **Build**: `.venv\Scripts\python.exe scripts\release\build_release.py --version X.Y.Z`
   (`--out DIR` to change the output, default `code\mx-inv-release-out\`; `--no-build` skips
   the in-package `npm` build, which also weakens the privacy scan). Output:
   `vessel-ops-panel-X.Y.Z\` + `vessel-ops-panel-X.Y.Z.zip` (no node_modules / dist).
3. **Privacy gate**: `privacy_scan.py` runs inside the build over the built bundle, Python
   string values and every other shipped text file; any hit prints `file:line` and **no zip
   is written**. Fix the source (a generic string, or move the text into a comment if it is
   developer-only), never loosen the word list to get a build out. The scanner itself must
   never be added to the allowlist - its word list is the private names.
4. **Cold test** before calling a version done: unzip into the scratchpad (not the repo),
   run `setup.bat` (fresh venv, pip, `npm ci`, build, example boat + optional starter packs),
   then start the `mx-inv-release-test` entry in `
   (uvicorn from the unzipped package's `.venv` on **127.0.0.1:8017**; its path points at the
   v0.1.0 unzip, edit it for a new version). Check every tab, no console errors, Settings
   round-trip, cockpit shows only its two unconfigured-safe tiles, a printout carries the
   Settings boat name. The cold test so far is Windows only (the Mac `.command` launchers are built, not run).
