<!--
Purpose: Every edge where data crosses a boundary in or out of mx-inv (InfluxDB, routing
  briefings, the previous developer's webhooks, the headless-Claude research child, the frontend<->backend API)
  and the contract at each.
Version: v12 (2026-10-30) - v12: WF-803 post-passage tasks note in section 8. v11 (2026-10-18) - v11: the restock calls are LIVE 2026-10-18 (`f6b7734`). v10 (2026-10-18) - v10: section 7 - GET / POST {engine}/restock (cockpit EXPECTED? card + the receive / stow restock mark, WF-502; built on branch wf502-restock). v9 (2026-10-09) - v9: section 7 - GET / POST {engine}/fill (the cockpit's Tanks screen, D-129). v8 (2026-10-07) - v8: rebuild-from-spec pass - status note rewritten for the 10-06 cut-over (boat stack on our Pi, mx-inv on the laptop); diagram redrawn; new sections 7 (the boat stack: rules engine / SignalK / history API - every call, variable, path and failure mode) and 8 (the engine's event push into the logbook); section 2 = the real weather read; section 3 notes POST /api/cockpit/incident is gone; section 5 points at the new API-Reference page. v7 (2026-10-05) - v7: cockpit Sail Plan -> our SignalK `sails.activeSet` (HB-09); the previous developer's sail-config webhook retired. v6 (2026-10-03) - v6: status note - every your-pi-hostname edge is DOWN (key issues, accepted by the owner). v5 (2026-09-24) - v5: deploy 22 - "a 200 is not proof" note current (/api misses now 404; dropped write fields still the open gap). v4: deploy 20 - every outside edge is opt-in by environment (new 'Switches' paragraph; ① Influx URL/org/bucket/genset match from MXINV_INFLUX_*; ② weather line hidden without a briefings folder; ⑥ manuals folder from Settings / MXINV_MANUALS_ROOT, MXINV_CLAUDE_EXE); API table gains GET/PUT /api/settings and GET /api/cockpit/capabilities; PATCH /api/tasks hours_meter 400. v3: historical-record row carries event_kind / evidence_path (deploy 15). v2 (2026-09-22) - v2: API table gains POST /api/tasks/{id}/complete (outcome +
  follow_ons) and the new POST /api/tasks/completions/{completion_id}/follow-ons; the historical
  route's body gains outcome + follow_ons (schema v34, live as deploy 10).
  v1: header added; API contract lists the maintenance-history, report,
  invoices (v33) and device-research endpoints; new section 6 (device research);
  webhook section corrected (performed_by/cost now captured but still not sent; sent_at ready).
Scope: PRODUCTION - engineering documentation for the mx-inv app.
Architecture: mx-inv wiki page. Architecture.md covers process layout; Logic-Flows.md what
  happens inside; this page is the map of edges.
Invocation: n/a (reference doc).
-->

> **Status 2026-10-07.** Since 2026-10-06 the boat stack is **our own Ship's Automation on boat-automation (the
> rebuilt Pi, 192.168.1.10)** and mx-inv reads it through edge ⑦ (rules engine, SignalK, history API) and receives
> its events through edge ⑧. mx-inv itself runs on the LAPTOP (interim live host, 192.168.1.144) while the Ship's PC
> is away for repair; `BOAT-STACK-ON-PI.txt` beside `run-live.bat` points ⑦ at the Pi (see
> [Operations](Operations.md#per-host-guard-files)). Edge ① (the previous developer's InfluxDB) is switched OFF in that mode; ③ is
> still a no-op (no endpoint ever built). The 2026-10-03 note that the your-pi-hostname edges were down for key issues is
> superseded by the cut-over.


# Data Flows & Interfaces

Every place data crosses a boundary — into the app, out of the app, or
between its own frontend/backend — with the actual contract at each
boundary. [Architecture](Architecture.md) covers process layout;
[Logic Flows](Logic-Flows.md) covers what happens to data once it's inside.
This page is the map of *edges*, not nodes.

**Switches (deploy 20; extended 2026-10-05).** Every edge below that leaves this app is **off unless configured**
by environment variable, so a release install talks to nothing: `MXINV_INFLUX_URL` +
`MXINV_INFLUX_ORG` (①), `VESSEL_LOG_ENABLED` + `VESSEL_LOG_ENDPOINT` (③),
`MXINV_ENGINE_URL` / `MXINV_SIGNALK_URL` / `MXINV_HISTORY_URL` + their token files (④ ⑦; ⑧ needs
`MXINV_EVENTS_TOKEN`), `MXINV_ROUTING_URL` (the `/routing` proxy). ② is gated by the briefings folder
existing; ⑥ by a manuals folder and a Claude CLI. `run-live.bat` (v11) sets the live values - table in
[Architecture](Architecture.md#integrations-boundary).

```
 +-------------------------------------------+     +------------------------------+
 | Ship's Automation on boat-automation      |     | the previous developer's original system      |
 | (our Pi, 192.168.1.10)                   |     |  InfluxDB "boat" bucket  (1) |
 |   rules engine API :8200   <-(7) r/w      |     |  logbook webhook (3) - never |
 |   SignalK :3000            <-(7) read,    |     |  built, a no-op              |
 |                              (4) write    |     +--------------+---------------+
 |   history read API :8090   <-(7) read     |                    | (1) read - OFF while
 |   engine outbox  --(8) push events-->     |                    |  BOAT-STACK-ON-PI.txt
 +---------------------+---------------------+                    |  is present
                       |                                          |
                       v                                          v
 +--------------+  files on disk (2)  +------------------------------------------+
 | routing repo | ------------------> |  mx-inv (FastAPI + React, SQLite)         |
 | (sibling dir)|  /routing proxy     |  laptop 192.168.1.144:8000 (interim)     |
 |  :8100       | <------------------ |                                           |
 +--------------+                     +---------------------+---------------------+
                                                            | HTTP JSON (5)
                                                            v
                                      +------------------------------------------+
                                      | browsers: desktop app, cockpit tablet /  |
                                      | phone (any LAN / Tailscale device)       |
                                      +------------------------------------------+

   (6) mx-inv --spawns--> headless `claude -p` child (Read-only on the Manuals folder)
                          --> JSON draft back (#50)
```

## ① Inbound: telemetry from InfluxDB (`telemetry_sync.py`)

**Direction**: read-only pull, this app → `your-pi-hostname`'s InfluxDB.
**Transport**: raw HTTP POST to the InfluxDB v2 Flux query API
(`urllib.request`, no client library dependency) — server `MXINV_INFLUX_URL`, org
`MXINV_INFLUX_ORG`, bucket `MXINV_INFLUX_BUCKET` (default `boat`); live (set by
`run-live.bat` v5): `http://192.168.1.10:8086`, org `boat-auto`, bucket `boat`.
URL or org unset = the sync is skipped (hand-entered hours).
**Auth**: bearer token, `BOAT_INFLUX_TOKEN` env var, falling back to a
`token = ...` line in `~/.vessel_ops/boat.env` (gitignored, never committed).
**Query** (fixed Flux, `telemetry_sync.py`'s `_FLUX` constant): last 3 hours
of any `tanks.(fuel|freshWater).*` measurement or anything ending `runTime`,
last value only.
**Cadence**: not a background job — `scheduling.schedule_snapshot()` calls
`sync()` inline, gated by `data.telemetry_should_sync()` (a rate limit, not
every request). Also runnable standalone: `python telemetry_sync.py`.
**Failure mode**: fully soft. No token → skip. Boat LAN unreachable (a raw
TCP probe to the host:port, 1s timeout, before even trying the query) →
skip. Query error → skip. Every skip path returns 0 and logs nothing beyond
a one-line message; the schedule endpoint's own try/except around the sync
call means even an unexpected exception here can never break
`GET /api/schedule`. The UI falls back to hand-entered hours whenever this
path is dark.
**What lands where**: `data.write_telemetry()` writes into the
`telemetry_cache` table (see [Schema](Schema.md#9-lookup--config)) —
`engine_hours`/`genset_hours` (seconds→hours, from `runTime` measurements,
generator disambiguated by a substring check against `MXINV_INFLUX_GENSET_MATCH`,
default `generator,genset`, live `generator,genset,westerbeke`),
`fuel_gal`/`water_gal` (m³→gal via a fixed conversion constant, summed
across all matching tank `remaining` series) and `fuel_frac`/`water_frac`
(averaged `currentLevel` series). This is the **only** place this app reads
from InfluxDB — everything else about `your-pi-hostname` is outbound (below).

## ② Inbound: routing briefings (`backend/routers/cockpit.py`)

**Direction**: read-only file read, this app → the sibling `routing` repo's
output directory.
**Transport**: plain filesystem glob, no network, no API —
` newest by mtime. The path is hardcoded
relative to this repo's own location (`../routing/var/briefings`) because
both projects are assumed to live as sibling checkouts on the same machine;
this breaks if `routing` ever moves to a different host (e.g. onto
`your-pi-hostname` itself).
**Status** (since 2026-10-04): real. `GET /api/cockpit/watch-handover/wx` reads the newest
briefing (by mtime, at most 512 KB) and pulls out, line by line, the `*Generated ...*` line, the
first quoted line of §3a (the tropical verdict) and the §3b bullets Wind / Seas / Pressure /
Source, plus the file's age (`old` past 24 h); `status` is `ok` when any weather field was
found, else `PENDING` with a plain `reason`. Every part is optional - a missing, empty,
unreadable or half-written file answers 200 (`tests/test_cockpit.py`). If routing changes its
headings ("## 3. Weather Picture", "### 3a.", "### 3b.") the fields come back empty - check
`parse_briefing` in `backend/routers/cockpit.py` first. `MXINV_ROUTING_BRIEFINGS_DIR` overrides
the folder. Deliberately does **not** trigger a live
`passage-planner brief` run itself, to avoid this app taking on routing's own
compute/API surface — it only ever reads what routing already produced.
**Gate**: `GET /api/cockpit/capabilities` reports `weather: false` when the briefings
folder does not exist, and the cockpit hides the weather line.

## ③ Outbound: maintenance/incident log → the previous developer's `logbook` (`backend/vessel_log.py`)

**Direction**: write, brokered — this app never touches InfluxDB directly
for this.
**Transport**: `requests.post()` to a webhook URL the previous developer owns
(`VESSEL_LOG_ENDPOINT`), optional bearer token (`VESSEL_LOG_TOKEN`), 3s
timeout.
**Enable gate**: `VESSEL_LOG_ENABLED=1` **and** `VESSEL_LOG_ENDPOINT` set —
either missing means every call is a documented no-op, and (deploy 20)
`vessel_log.is_enabled()` is false so the cockpit hides its Break / Incident tile. As of
2026-09-24, still **disabled** (spec `design/VESSEL_LOG_WRITEBACK.md` sent to the automation developer, no
endpoint and no reply yet).
**Replay is ready on this side**: `task_completions.sent_at` (schema v32)
is NULL on every row and has its own NULL→once transition in the
append-only trigger, so when the endpoint exists the whole history can be
replayed and each row stamped as sent exactly once. The replay itself is
not written yet.
**Two call sites, one payload shape**:
- `log_completion()` — fired from `data.complete_task()`'s caller whenever
  a task/checklist/break-fix item is completed through the app.
  `entry_type` is always `"maintenance"` for now (a known simplification —
  see the docstring's NOTE: a break-fix completion is arguably a "failure"
  that should have logged when first noticed, not just at fix time; this
  app has no "currently broken" state to log that from). Computes
  `next_due_hours`/`next_due_date` as a simple undeferred one-cycle-forward
  projection (**not** a call into `backend/scheduling.py`'s real engine —
  deliberately simpler, matching what a hand-typed CLI entry on the automation developer's
  side would produce).
- `log_incident()` — was fired from the cockpit's Incident Log form
  (`POST /api/cockpit/incident`). **That route was removed 2026-10-05** (cockpit router v7):
  Break / Incident now writes mx-inv's own logbook (`POST /api/logbook`, option C), so
  `log_incident()` has no caller; `log_completion()` is still called and still a no-op.

**System-name mapping**: this app's `tasks.system` is an open, ~130-entry
picklist (see [Schema](Schema.md#3-systems-the-equipment-picklist)); the automation developer's
`logbook` schema expects one of a small fixed set (`engine`, `generator`,
`watermaker`, `refrigeration`, `electrical`, `electronics`, `rigging`,
`hull`, `nav`, `comms`, `safety`, `tankage`, `plumbing`, `other`).
`_map_system()` does a best-effort substring match against a hardcoded
keyword table (`vessel_log.py`'s `_SYSTEM_KEYWORDS`); anything unmatched
becomes `"other"`. **This mapping table needs manual upkeep** if either
side's vocabulary grows — it's not derived from either schema
automatically.

**Deliberately null fields**: `cost_usd`, `parts`, `performed_by` are always
sent as `null` in the payload. That was originally because the app had no
data for them; it now does - `performed_by` is captured on every completion
(pick list from the `crew_members` roster, schema v32, plus names already in
the history) and `cost`/`vendor` on backfilled records (v31) - but the
webhook has not been re-wired to send them. Cost stays out until the owner's
privacy question (the same one that keeps cost off the printable report by
default) is settled; `performed_by` can be wired when the endpoint exists.

## ④ Outbound: sail plan → our SignalK `sails.activeSet` (`backend/sail_plan.py`, since 2026-10-05)

**Direction**: write to OUR boat stack (your-pi-hostname), not the previous developer's - his sail-config endpoint was never built and
the webhook (`sail_config.py`) is gone. **Transport**: one SignalK delta over the stream
(`ws://…/signalk/v1/stream?subscribe=none`), bearer = mx-inv's own SignalK device token (clientId
`mx-inv-cockpit…`, read/write, `scripts/signalk_device_token.py`), **timestamped when the change really happened**
("changed N min ago" - Owner: log it once the boat is settled), then read back - with security on, SignalK drops a
delta from a client without a valid token silently (Ship's Automation F-072), so no read-back = "not saved".
**Value** (HB-09, the owner 09-29): `{main: down|full|reef1-3, headsail: none|genoa|staysail, headsailState:
full|reef1-3|null, wingOnWing, label}` - one headsail only; wing-on-wing = main + genoa. **Record**: the your-pi-hostname
history writer keeps `sails.**` as STATE forever - that is the sail log (polar by sail set, TD-09); mx-inv stores no
copy. After a SignalK restart `GET /api/cockpit/sail-plan` reads the newest set from the history API and writes it
back with its original time. **Trigger**: the cockpit Sail Plan tile (`GET / POST /api/cockpit/sail-plan`).

## ⑤ Frontend ↔ backend (the app's own internal API)

**Transport**: plain JSON over HTTP, same-origin in production (FastAPI
serves both the API and the built React app from one port — see
[Architecture](Architecture.md)), proxied cross-origin in dev (Vite → 8000).
**No API versioning, no GraphQL, no websockets** — every interaction is a
REST-ish request/response; live updates happen by re-fetching, not pushing
(see the polling/invalidation note below).

**Client contract** (`frontend/src/api/client.ts`):
- `apiGet<T>(path)` — `GET /api${path}`, throws a plain `Error` on
  non-2xx.
- `apiSend<T>(method, path, body?)` — `POST`/`PUT`/`PATCH`/`DELETE`, JSON
  body when present, throws `ApiError` (carries `.status` and a parsed
  `.detail`) on non-2xx. `.detail` is what lets a specific call site branch
  on a structured error — e.g. the 409 from `POST /api/items` carries
  `{item_id, item_name, message}` for the pre-existing catalog row (see
  [Schema](Schema.md#duplicate-item-prevention)), and
  `RecipeIngredients.tsx`/`AddItemTab.tsx`/`AuditTab.tsx` each read that
  payload to decide auto-link vs. warn.
- No retry/backoff logic anywhere in this layer — a failed request just
  throws and the calling React Query hook surfaces it as an error state.

**Type contract**: `frontend/src/api/types.ts` mirrors the backend's JSON
shape **field-for-field, snake_case, no transform layer** — a deliberate
choice to avoid a camelCase↔snake_case mapping layer that would drift from
the actual wire format. If `backend/scheduling.py` or a router's response
shape changes, `types.ts` has to be updated by hand; there's no shared
schema (no OpenAPI-generated client) enforcing the two stay in sync. The
loose `dict[str, Any]` request bodies on most write endpoints (see
[Architecture](Architecture.md#backend-structure)) mean the *request* side
is even less strictly typed than the response side.

**No push/streaming updates.** Every screen re-fetches via React Query;
mutations invalidate the relevant query key on success and the next render
re-fetches fresh. This means one browser tab does not see another tab's
write until it re-fetches on its own (a click, a refocus, a query's own
staleness timer) — there is no live multi-user sync. Acceptable for the
current 2-3-concurrent-user scale (the owner, crew member, occasionally the automation developer); would
need a real push mechanism (SSE/websocket) if concurrent live collaboration
ever becomes a requirement.

**Not everything is JSON.** Three kinds of response are pages or downloads,
opened by a plain link (`<a href target="_blank">`), not through
`apiGet`:
- **Printable pages (HTML)**: `GET /api/tasks/{id}/checklist/print` (the
  checklist sheet) and `GET /api/report/history[?system=…|?device=…][&cost=1]`
  (the maintenance-history "CARFAX" report - whole boat, one top-level
  system with its devices, or one exact device; cost and vendor only with
  `cost=1`). The user prints / saves as PDF from the browser.
- **CSV download** (v33): `GET /api/documents/year/{year}/csv`
  - one row per invoice on file, UTF-8 with a BOM for Excel, no grand-total row.
- **Form post**: `POST /api/device-research` takes form fields
  (`device_name`, `manual_paths` newline-separated, optional
  `parent_system` / `existing_make_model` / `existing_notes`), not a JSON
  body; `DeviceResearchPanel.tsx` calls it with raw `fetch` + `FormData`.

**Recent endpoints worth knowing** (2026-09-21/22; the rest is in
`/docs`):

| Endpoint | What it does |
|---|---|
| `GET /api/tasks/completions?days=&limit=&year=&system=&device=` | The maintenance history, newest first. `year` replaces `days`; `days<=0` = all time; `system` includes its devices, `device` is exact. |
| `GET /api/tasks/completions/facets` | The Log tab's filter choices: years with entries, systems with their devices. |
| `GET /api/tasks/completions/performed-by` | "Who did the work" choices: `crew_members` UNION every `performed_by` already in the history, deduped case-insensitively. Free text is still accepted on write. |
| `POST /api/tasks/{id}/complete` | Complete a task: body `completed_on`, `consumption`, `close_subtasks`, `notes`, `performed_by`, and (v34) `outcome` (`done_ok` / `problem_found` / `partial`, omit = not stated) + `follow_ons` (`[{task_name, system?, description?, is_critical?}]`, system defaults to the job's own). Follow-ons are created in the same transaction; the response adds `follow_on_task_ids`. A bad outcome or a follow-on on a non-existent system is a 400 and writes nothing. |
| `POST /api/tasks/completions/historical` | A past service record with no task behind it (`source='historical'`); reschedules nothing. Body: system, what_was_done, completed_on, performed_by, vendor, cost, notes, parts (v33 adds `document_id`; v34 adds `outcome` + `follow_ons`, same shape and all-or-nothing rule as `/complete`; deploy 15 adds `event_kind` - one of `data.COMPLETION_EVENT_KINDS`, else 400 - and `evidence_path`, a file path). Returns `{completion_id}`. |
| `POST /api/tasks/completions/{completion_id}/follow-ons` | (v34) Raise follow-on task(s) from an existing history entry: body `{follow_ons: [...]}` -> `{task_ids}`. The history row is not touched - each task carries `origin_completion_id`. 404 unknown entry; 400 voided entry, no named row, or unknown system. |
| `POST /api/tasks/completions/{id}/void` | Void a history entry with a reason (append-only correction); restores the task's last-done date if it was the latest. |
| `PUT /api/tasks/completions/{id}/document` | (v33) File a history entry under an invoice, move it, or detach it (`document_id: null`) - the one change besides voiding the append-only history allows. |
| `PATCH / POST …/rename, …/clone, …/delete`, `GET …/items` on `/api/tasks/systems/{name:path}` | Systems & devices. `{name:path}` because 22 device names contain a slash. |
| `POST /api/tasks/{id}/retire`, `/unretire`, `GET /api/tasks/{id}/referenced-by` | Retire instead of delete once a task has history (#66); the consolidated inbound-links panel. |
| `GET /api/documents[?year]`, `/years`, `/expense-classes`, `/year/{year}`, `/year/{year}/csv`; `GET/PUT/DELETE /api/documents/{id}`; `POST /api/documents` | (v33) Invoices / receipts on file. Figures are always "invoices on file", never a year total; delete of a document with entries filed under it is refused (409). Design: `design/INVOICE_DOCUMENTS_DESIGN.md`. |
| `GET /api/settings`, `PUT /api/settings` | (deploy 20) Owner Settings: `{vessel_name, engine_label, genset_label, manuals_root}` - GET fills defaults for unset keys; PUT upserts only the fields sent (trimmed) and returns all four; an unknown key is a 400. |
| `GET /api/cockpit/capabilities` | (deploy 20) `{sail_plan, incident, weather}` booleans - which cockpit tiles have somewhere to go; the cockpit hides the false ones. |
| `POST /api/tasks`, `PATCH /api/tasks/{id}` with `hours_meter` | (deploy 20) `'engine'` / `'genset'`; an `hrs` task without one gets `'engine'`; any other value is a 400 (PATCH used to pass `data.update_task` errors through as a 500). |
| `GET /api/device-research/status`, `POST /api/device-research`, `GET /api/device-research/{job_id}`, `DELETE /api/device-research/{job_id}` | The #50 manual-research job: is it available here, start, poll, cancel (see ⑥). |

**A 200 is not proof.** Since deploy 22 a wrong `/api/...` GET is a 404 JSON (it used to get
`index.html` with a 200), but a JSON field the pydantic model does not declare - or that
`data.py`'s whitelist for that update does not list - is still silently dropped from a write that
returns 200 (hardening plan phase 4 closes this). Read the value back from the DB after a write
test; `tests/test_api_roundtrip.py` does exactly that for the main write routes.

**Full endpoint inventory**: [API Reference](API-Reference.md) - every route with method,
path, query, body and notes, generated from the app's own OpenAPI schema (2026-10-07; it used
to be left to `/docs` alone, but a rebuild-from-spec needs it written down - regenerate it
after a route change, the recipe is on that page). `http://localhost:8000/docs` (Swagger UI,
no auth) stays the live, authoritative copy.

## ⑥ Outbound: headless Claude device-manual research (#50, `backend/device_research.py`)

**Direction**: this app spawns a local child process and reads its reply;
nothing is pushed anywhere by mx-inv itself.
**Trigger**: the "Research with Claude" button on a device's SystemScreen
(`DeviceResearchPanel.tsx`) → `POST /api/device-research` → one job in
`device_research_jobs.DeviceResearchJobs` (in-memory, **one active job at a
time**, a second start is a 409) → `research_device()` on a background
thread. The panel polls `GET /api/device-research/{job_id}`; `DELETE`
cancels (kills the child's process tree).
**Transport**: `subprocess` running the Claude Code CLI headless
(`claude -p … --output-format json --no-session-persistence`), located via the
`MXINV_CLAUDE_EXE` override (the older `HYLAS_CLAUDE_EXE` still honoured), else `claude` on PATH, else the newest copy
bundled with the desktop app; the prompt goes on stdin. Tools restricted to `Read`
only, `--permission-mode dontAsk`, `--strict-mcp-config`, no slash
commands, no Chrome, cwd fixed to the manuals folder (Settings `manuals_root`, else env
`MXINV_MANUALS_ROOT`; live: `D:\Documents\sailboat\Manuals`) - no web,
no MCP, no writes possible. The system prompt is loaded at run time from
`references/DEVICE_MANUAL_RESEARCH_INSTRUCTIONS.md`, so the recipe is tuned
by editing that document. Wall-clock timeout 10 min; `--max-budget-usd`
backstop `DEFAULT_MAX_BUDGET_USD = 2.0` (an unverified guess - revisit after
the first real run).
**Auth**: `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`, a user env
var) - the owner's subscription, not metered API billing. The child's environment
is sanitised: `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` /
`ANTHROPIC_BASE_URL` and the parent session's plumbing are stripped, and
`--bare` is never passed (it would ignore OAuth). No token or no CLI →
`GET /status` reports unavailable with the reason, `POST` answers 503; so do a missing /
unset manuals folder and a missing instructions doc (deploy 20).
**Stale-env gotcha**: a server launched from inside a Claude Code session
(even via a detached `start` window) inherits that session's STALE
environment and shows the button as unavailable although the token is set.
Only a server started outside any Claude session (the owner's own double-click of
`run-live.bat`, or after a reboot) sees the current token. A `setx` never
reaches an already-running process.
**Output**: the reply is untrusted text - validated as a JSON draft
(make/model, tasks, spares) or turned into an explicit INCOMPLETE placeholder
on any failure; never executed. An `ok` draft is written to
`var/device_research/research_<id>_<slug>.json` the moment it lands, so a
restart or closed tab does not lose paid-for research. **Nothing is written
to the database by this path**: the owner reviews the draft in the panel and
applies fields individually through the ordinary systems/tasks/items
endpoints.
**Status**: plumbed and deployed, but never yet run end-to-end through the
GUI (only chat-driven research has been exercised for real).

## ⑦ Outbound: the boat stack - rules engine, SignalK, history API (`backend/boat_link.py`, since 2026-10-05)

**Counterparty**: our Ship's Automation stack (not the automation developer's). Since 2026-10-06 it runs on
boat-automation, the rebuilt Pi at 192.168.1.10 (Ship's Automation F-014 for the address,
D-116 / D-117 for the cut-over); before that, briefly, on the Ship's PC. **One module holds every
call** (`backend/boat_link.py`); nothing else in mx-inv knows where the stack is, so moving it is a
change of environment variables only (D-077). Every helper turns a failure into a plain-words
`BoatLinkError` (502, or 503 when not configured) - never an exception into a request handler.
Timeouts: 4 s, connect 2 s.

| Variable | Meaning | Laptop + stack on the Pi (today, `BOAT-STACK-ON-PI.txt`) | mx-inv beside the stack (Ship's PC / Pi) |
|---|---|---|---|
| `MXINV_ENGINE_URL` | rules engine HTTP API | `http://192.168.1.10:8200` | `http://127.0.0.1:8200` (Pi); the Ship's PC published it on `127.0.0.1:8210` (Windows :8200 was the manuals service) |
| `MXINV_ENGINE_TOKEN_FILE` / `MXINV_ENGINE_TOKEN` | the engine's write token: file in env format, key `ENGINE_API_TOKEN` (value stripped of spaces / quotes - a stray space once broke the engine's own sends, D-113) | `%USERPROFILE%\.boat-secrets\engine.env` | the stack's own `engine.env` |
| `MXINV_EVENTS_TOKEN` | the token the ENGINE sends to mx-inv (⑧); else key `MXINV_EVENTS_TOKEN` in the same `engine.env` | from `engine.env` | same |
| `MXINV_SIGNALK_URL` | SignalK server | `http://192.168.1.10:3000` | `http://127.0.0.1:3000` |
| `MXINV_SIGNALK_TOKEN_FILE` / `MXINV_SIGNALK_TOKEN` | mx-inv's OWN SignalK device token (key `SIGNALK_TOKEN`, clientId `mx-inv-cockpit`, read/write), got once with `scripts/signalk_device_token.py` and approved by the owner in SignalK admin (Security > Access Requests) | `%USERPROFILE%\.boat-secrets\mxinv-signalk.env` | same |
| `MXINV_HISTORY_URL` | the history read API | `http://192.168.1.10:8090` | `http://127.0.0.1:8090` |
| `MXINV_DECK_LOG` | `off` stops the automatic deck log thread | unset (ON) | unset; `off` on a host with no stack (`LIVE-HOST-INTERIM.txt`) |

Unset URL = that half is off and the cockpit hides what depends on it (`GET /api/cockpit/capabilities`:
`boat`, `boat_write`, `sail_plan`, `handover_live`, `fill`). URL but no token = read-only.

**Calls mx-inv makes** (the contract the stack must keep):

| Call | Used by | Request | Reply mx-inv reads |
|---|---|---|---|
| `GET {engine}/status` | `GET /api/cockpit/boat` (tablet polls every 5 s), every stamp's `mode` | none, no auth | `mode`, `mode_manual`, `alarms[]` (`rule`, `severity`, `message`, `acked`, `simulated`), `healthy`, `health_reasons[]`, `role`, `test.active` - trimmed before it reaches the tablet |
| `POST {engine}/mode` | `POST /api/cockpit/mode` | `{"mode": DOCK/ANCHOR/AWAY/MOTOR/SAIL, "by": "cockpit"}`, `Authorization: Bearer <engine token>` | 200 JSON; 401 -> "token needs updating"; 400 passed through |
| `POST {engine}/ack` | `POST /api/cockpit/ack` | `{"by": "cockpit"}`, bearer | 200 (acks every alarm; also ends a running test, D-111) |
| `GET {engine}/fill` | `GET /api/cockpit/fill` (Tanks screen every 10 s, home tile every 30 s) | none, no auth | `tanks.{water_port,water_stbd,fuel_port,fuel_stbd}.{label, level, session: null / {source, since, by, active}}`, `watermaker.{running, watts}` (engine api.py v9, D-129); 404 = older engine -> 501 to the tablet |
| `POST {engine}/fill` | `POST /api/cockpit/fill` | `{"tank": <key>, "on": true/false, "by": "cockpit"}`, bearer | the GET /fill view; 400 unknown tank (mx-inv checks first), 401 -> "token needs updating" |
| `GET {engine}/restock` | `GET /api/cockpit/restock` (cockpit, every 10 s) (LIVE 2026-10-18, `f6b7734`) | none, no auth | `boxes.{fridge,engel,fz_aft,fz_fwd}.{label, ask_rule, asking, alarm, mark}`, `hold_h` |
| `POST {engine}/restock` | `POST /api/cockpit/restock` (crew YES / NO) and backend/restock_link.py (after a receive / stow / add / move of food into a cold-box place, as a background task) | `{"box", "answer": "yes"/"no"/"restock", "by": "cockpit"/"mx-inv", "source"?}`, bearer | the GET view; 409 = that box's alarm is already up (restock_link logs and drops it; the cockpit shows the engine's words) |
| `GET {signalk}/signalk/v1/api/vessels/self` | handover card, stamps, deck log | none (anonymous read) | the whole self tree; each leaf `{value, timestamp}`; values older than the card's limits are dropped |
| `GET {signalk}/signalk/v1/api/vessels/self/<path with />` | sail plan read-back, stamps | none | one leaf, 404 = none |
| websocket `{signalk}/signalk/v1/stream?subscribe=none` | `POST /api/cockpit/sail-plan` (④) | one delta `{"context":"vessels.self","updates":[{"source":{"label":"mx-inv-cockpit"},"timestamp":<when it happened>,"values":[{"path":"sails.activeSet","value":{...}}]}]}`, bearer = mx-inv's SignalK token | then READ BACK up to 10 x 0.2 s: not there = "not saved" (with security on SignalK drops an unauthorised delta silently, F-072) |
| `GET {history}/api/at?path=&t=<epoch s>` | "this watch" deltas, back-dated stamps | none | `{"value": number}`; anything else = left out |
| `GET {history}/api/latest?path=` | sail plan after a SignalK restart | none | `{"t": epoch, "value": ...}` |

**SignalK paths read** (SI units in, converted for display; tank instances 20/21 = fuel, 22/23 = fresh
water, the Cerbo tank senders - a fact of this boat's configuration, set in `handover_card.py`):
`navigation.position`, `.speedOverGround`, `.courseOverGroundTrue`, `.speedThroughWater`, `.log`;
`environment.depth.belowKeel`, `.wind.speedApparent`, `.wind.angleApparent`, `.outside.pressure`,
`.outside.temperature`, `.water.temperature`; `electrical.batteries.houseSmartShunt.voltage` / `.current`;
`tanks.fuel.{20,21}.remaining` / `.capacity`, `tanks.freshWater.{22,23}.*`; the weather service's
`environment.observations.*` (wind, gust, pressure, station, distance, age, waves.*) and
`environment.forecast.wind.speed`, `.forecast.next12h.{windMax,gustMax,waveMax}` (dropped past 1 h / 2 h);
`sails.activeSet`. Deliberately NOT shown: heading and true wind (read ~180° off, F-099 / F-100) and battery
SoC (the shunt's SoC is invalid, F-186). Fresh-ness limits: 120 s for motion values, 900 s for barometer /
log / temperatures / tank levels.

**Failure behaviour**: engine down = `GET /api/cockpit/boat` 502 naming the URL, the tablet hides the mode
card and alarms rather than show a stale mode; SignalK down = the card endpoint 502 and stamps empty; history
down = the "this watch" lines are left out. None of it blocks a crew entry.

## ⑧ Inbound: rules engine events -> the logbook (`POST /api/logbook/events`, since 2026-10-05)

The one place another system writes into mx-inv. The engine's outbox pushes one event per POST (alarms and
clears, PROTECT relay actions, acks, resets, mode changes, health changes, reloads, simulations - as each
rule's `record:` level allows, Ship's Automation D-114) to its configured mx-inv URL (today
`http://192.168.1.144:8000`). Bearer token = `MXINV_EVENTS_TOKEN`; 200 / 409 = delivered (idempotent by
`event_id`), 401 / 422 = refused. Full contract: [API Reference](API-Reference.md#the-inbound-engine-push-post-apilogbookevents);
what happens to the event: [Logic Flows section 21](Logic-Flows.md#21-the-logbook--ships-log-schema-v37-v39).
First real one: LOG-00002, a refrigerator P2, 2026-10-06. If mx-inv is down the engine keeps the event in its
outbox and retries; mx-inv stamps a late delivery from history at the fire time.

**WF-803 Post-passage tasks (2026-10-30).** When an arrival is logged (`POST /api/logbook/arrival`), the hook in
`backend/post_passage.py` scans the passage window (departed_at..arrived_at) for P1/P2 engine events and creates
one `one_off` / `break_fix` task per unique alarm origin. The arrival response includes `wf803_tasks` when tasks
were drafted. The hook is non-blocking: a failure never prevents the arrival from being recorded. Implements N-53
(Automation Opportunities) / SOP phase 7.

## Interfaces this app deliberately does NOT have

Worth stating explicitly, since each was a real decision (see
[Design Decisions](Design-Decisions.md)):

- **No direct InfluxDB write path, and no database login on the boat stack** — mx-inv never
  writes InfluxDB (① is read-only, ③ was to be a broker the previous developer owned) and never logs in to the
  history database (it asks the history read API for "value at T", Ship's Automation D-052).
  Its only writes to the boat stack are the three in ⑦ / ④: mode tap, alarm ack (engine token)
  and `sails.activeSet` (its own SignalK device token).
- **No email/SMS/push notification integration** — the schedule board is
  pull-only; nothing proactively alerts anyone that a task is now overdue.
- **No file-upload/attachment storage** — `task_references` can point at a
  `file_path`, but there's no upload endpoint; reference files are managed
  outside the app (the filesystem/manuals tree) and merely linked. The same
  holds for `task_completions.evidence_path` (v32) and `documents.file_path`
  (v33, an invoice PDF): paths, not uploads.
- **No public/internet-facing interface** — see
  [Design Decisions](Design-Decisions.md#no-auth); every interface on this
  page assumes an LAN/Tailscale-only reachability boundary.
