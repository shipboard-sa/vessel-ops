<!--
Purpose: Front page of the mx-inv engineering wiki - what the app is, who it is for, its requirements and
  non-goals, the page index, and the at-a-glance facts (stack, repo, where it runs, schema version).
Version: v12 (2026-10-08) - v12: review-batch (schema v39) merged + LIVE 2026-10-08. v11 (2026-10-07) - v11: rebuild-from-spec pass - new "Purpose, users and requirements" and "Reading
  order for a rebuild" sections; API-Reference page added to the index; at-a-glance current (laptop interim
  host, schema v38 live / v39 on review-batch, boat stack on our Pi, migration runner, ship's log). v10 (2026-10-03) - v10: Ship's PC = system of record, Ship's Automation links down (key issues, accepted). v9 (2026-10-03) - v9: live host = the Ship's PC. v8 (2026-09-24) - v8: deploy 22 (hardening phase 0); Tests + Direction rows. v7: deploy 20 / schema v36 (owner Settings, first-run init, opt-in integrations, tasks.schedule_from); release package added to the page map and history. v6: current-deploy row (deploy 19, tap-column pickers). v5 (2026-09-23) - v5: Workflows page added to the index (#74/#76). v4: schema line -> v35 live (deploy 13). v3: schema line -> v34 live (task outcome + follow-on tasks,
  deploy 10); history paragraph mentions them. v2: header added; schema line brought current
  (v33 live); history paragraph extended past the rewrite to the maintenance-history / invoices work.
Scope: PRODUCTION - engineering documentation for the mx-inv app.
Architecture: mx-inv wiki entry point. Read after <your-project-dir>/CHECKPOINT.md, then open the one
  page for the area being touched.
Invocation: n/a (reference doc).
-->

# Vessel Operations Panel — Wiki

Engineering documentation for the maintenance / inventory / galley / ship's-log app that runs
SV Your Boat Name's (your vessel) maintenance schedule and history, spares / food / gear inventory,
recipes and provisioning, refit projects, the ship's log, and a cockpit / deck companion view for the
helm phone and companionway tablet. This wiki documents **how the system is built and why** - enough,
with the code, to rebuild it to the same behaviour. How to use it as crew is the app itself (plus
`docs/USER_GUIDE.md`, written for the release package).

**Audience**: whoever maintains this codebase next — the owner, Claude in a future
session, or anyone else who needs to understand the design without re-reading
every commit.

## Purpose, users and requirements

**What it is for.** One system of record for the boat's upkeep and stores, used aboard, offline from the
internet, by the people who live on her: what is due and what was done (with a history that reads like a
vehicle history report), what is aboard and where it is stowed, what to buy, what to cook, and - since
2026-10-05 - the ship's log ("no more paper", the owner). It is the heavy-input half of the boat's systems: the
Ship's Automation stack on the Pi does sensing, rules and alarms; mx-inv is where people type, tick and
decide, and it reads the automation stack rather than duplicating it ([Cockpit GUI](Cockpit-GUI.md)).

**Users.**

| Who | Uses |
|---|---|
| the owner (owner, engineer of the vision) | everything; maintenance, refit projects, the log, data entry by voice through Claude |
| crew member (the owner's wife; galley and provisioning authority) | Galley: recipes, meal plan, pantry check, shopping cart, receiving food; her own phone |
| Watchkeepers / crew | the cockpit view (`/cockpit`): watch handover, checklists, Break / Incident, sail plan, depart / arrive, alarms |
| the previous developer (former automation collaborator) | could reach it over Tailscale; no longer a working user |
| Other boats | a generic, privacy-scrubbed release package ([Operations](Operations.md#building-a-release-package)) |

**Requirements and constraints** (each settled by the owner; the reasoning is in [Design Decisions](Design-Decisions.md)):

- **Runs aboard, on the boat LAN, with no internet** - a single host on the LAN (laptop / Ship's PC now, the Pi
  later), reached from Android phones and tablets in a browser. No cloud dependency.
- **No login; the network is the boundary** (LAN / Tailscale only). ([#no-auth](Design-Decisions.md#no-auth))
- **One record per fact, history append-only.** Maintenance completions and log entries are never edited or
  deleted - corrections are voids or appended status rows; tasks with history are retired, not deleted.
- **The boat works WITH the crew, never for them**: the app informs and asks (an acknowledgement, a pick),
  it never silently decides; manual entry always works when the automation is down.
- **GUI rules**: anything with a detail page opens when tapped; a workflow runs in one pass (create the missing
  thing inline - no detours); known lists are pick lists, never typed (server-enforced); a sub-element opens
  full-screen with a Back, not squeezed inline; hierarchical picks are tap columns. ([Workflows](Workflows.md))
- **Data model held to Third Normal Form** by default; units are a governed imperial picklist.
- **Durability on a boat that can lose power**: SQLite WAL with `synchronous = FULL`; verified backups before
  every risky change; one live database file, moved only by a verified hand-over.
- **Boat-specific values are owner Settings, outside integrations opt-in**, so the same code ships to
  other boats.

**Non-goals** (do not re-propose without new information - the full list is in
[Roadmap](Roadmap.md#explicitly-decided-not-to-build-dont-re-propose-without-new-information)): no formal
project management (Gantt, dependencies, critical path); no file uploads (paths only); no push
notifications; no internet-facing deployment; no re-rendering of what the chart plotters, engine display,
Windy or the automation stack already show; no tax advice from the invoice records.

## Reading order for a rebuild

1. This page, then [Architecture](Architecture.md) (processes, code layout).
2. [Schema](Schema.md) (every table, the migration runner) and [Logic Flows](Logic-Flows.md) (the rules).
3. [API Reference](API-Reference.md) (every route) and [Data Flows & Interfaces](Data-Flows-and-Interfaces.md)
   (every boundary, incl. the boat-stack contract).
4. [Workflows](Workflows.md) and [Cockpit / Deck GUI](Cockpit-GUI.md) (the screens).
5. [Operations](Operations.md) (build from a blank machine, run, back up, restore, deploy, test).
6. [Design Decisions](Design-Decisions.md) (why, and what was rejected) and [Roadmap](Roadmap.md) (what is done
   and open).
Design documents that hold more detail than the wiki live in the repo's `design/` folder (e.g.
`design/LOGBOOK_DESIGN.md`, `design/INVOICE_DOCUMENTS_DESIGN.md`, `design/ARCH_HARDENING_PLAN.md`).

## Pages

- **[Architecture](Architecture.md)** — process layout, backend/frontend
  structure, request flow, deployment topology.
- **[Schema](Schema.md)** — the SQLite schema: entities, relationships, the
  lookup-table pattern, the logbook, the migration runner, and why it's shaped the way it is.
- **[Logic Flows](Logic-Flows.md)** — the non-obvious business logic: the
  8-bucket schedule projection, checklist/task unification, recipe→stock
  consumption, telemetry sync, the maintenance history, the logbook / deck log / passages.
- **[API Reference](API-Reference.md)** — every HTTP route (method, path, query, body), error conventions,
  the engine's authenticated event push.
- **[Data Flows & Interfaces](Data-Flows-and-Interfaces.md)** — every
  boundary the app crosses: the boat stack (rules engine, SignalK, history API) and its event push,
  InfluxDB read, routing-briefing file read, the headless-Claude research child, and the frontend↔backend
  API contract itself.
- **[Workflows](Workflows.md)** — every crew workflow screen by screen, the two GUI
  rules (clickable to detail, no detours) and the shared pieces that enforce them.
- **[Cockpit / Deck GUI](Cockpit-GUI.md)** — the `/cockpit` route: scope,
  non-goals, device architecture, and implementation detail for the
  helm/companionway crew-workflow surface.
- **[Operations](Operations.md)** — build from a blank machine, run it, where it lives, access URLs and the
  firewall gotcha, per-host guard files, backup/restore, deploy, tests.
- **[Design Decisions](Design-Decisions.md)** — the why behind major choices,
  written so a future change doesn't accidentally re-litigate a settled
  question without knowing it was already settled.
- **[Roadmap](Roadmap.md)** — what's built, what's explicitly deferred, what's
  next.

The **release package** (a generic, privacy-scrubbed copy of the app for other boats,
v0.1.0 built 2026-09-24, superseded the same day by v0.1.1 with the deploy-22 security fix) is covered where it touches each area: tooling and the
integrations boundary in [Architecture](Architecture.md#release-package-tooling), how to
build and test one in [Operations](Operations.md#building-a-release-package), the reasoning
in [Design Decisions](Design-Decisions.md#release-package). Its shipped docs live in the
repo at `docs/USER_GUIDE.md`, `docs/dev/*` and `release_files/`. Note: the package was built at schema
v36 and ships no migration scripts yet - see [Roadmap](Roadmap.md) open items before the next release.

## At a glance

| | |
|---|---|
| **Stack** | FastAPI (Python 3.13+) backend + React 19 / TypeScript (Vite) frontend, SQLite (WAL, `synchronous = FULL`) |
| **Repo** | `shipboard-sa/vessel-ops` (private), live branch `logbook-page` (also pushed as `mx-inv-webapp`); `review-batch` merged into it 2026-10-08 |
| **Live location** | **the laptop, interim since 2026-10-05** (`http://192.168.1.144:8000`, + /cockpit, /routing) while the Ship's PC (`192.168.1.100`, the normal host) is at MSI for repair. One live `vessel_local.db`; per-host guard files keep a second copy from being served - see [Operations](Operations.md#per-host-guard-files). Long-term host: the Pi, in Docker. |
| **Boat stack** | our Ship's Automation on boat-automation (the Pi, 192.168.1.10) since 2026-10-06: rules engine :8200, SignalK :3000, history API :8090 - the cockpit reads it, the engine pushes events into the logbook ([Data Flows ⑦ ⑧](Data-Flows-and-Interfaces.md)) |
| **Run it** | double-click `run-live.bat` -> `http://<host>:8000` (+ /cockpit, /routing) |
| **Database** | `vessel_local.db` — **schema v39, live** (logbook v37 + passages v38, 2026-10-05; Ship's Log review v39, 2026-10-08). Migrated at server start by the `migrations/` runner (verified backup first; a newer DB is refused) |
| **Current deploy** | 2026-10-08: the Work a Container redesign + the owner's Ship's Log review (v39: signed entries, Boat Instruments, Mark it Fixed, Sail Plan always on, Engine on / off + hour meter), on top of 2026-10-05's deploy 24 + Ship's Log tab + passages. Per-deploy detail: [Roadmap](Roadmap.md) |
| **Tests** | `pytest tests` (143 + 2 xfail on `logbook-page`, per-test temp DBs, run by CI) - see [Operations](Operations.md#tests) |
| **Direction** | stack kept after the 2026-09-24 review; phased hardening in `design/ARCH_HARDENING_PLAN.md` (phases 0-2 done) - see [Design Decisions](Design-Decisions.md#keep-the-stack) |
| **Predecessor** | a Streamlit app (`app.py`, port 8601) — retired from daily use 2026-09-16, launcher removed 2026-10-07, code deletion = hardening phase 3 |
| **Auth** | none — trust boundary is the LAN/Tailscale network, not the app (the one exception: the engine's event push carries a bearer token) |

## History in one paragraph

The app started as a Streamlit GUI over `data.py`/`db_schema.py` (a solid,
well-tested data layer with zero UI framework coupling). A 2026-09-15
performance complaint turned out to be a fixable N+1-query bug, not a
Streamlit problem — but the deeper complaint ("I don't like the UI/UX") was
real, so the team decided on a full rewrite: keep `data.py`/`db_schema.py`
completely unchanged, replace only the ~2,700 lines of Streamlit UI with a
FastAPI backend + React frontend. Built in 8 phases over two days, trialed
against a scratch DB copy, then cut over to production on 2026-09-16. Schema
evolved from v11 (pre-rewrite) to v15 (recipe ingredient parsing) in the same
window. See [Design Decisions](Design-Decisions.md) for the reasoning behind
each major call, and [Roadmap](Roadmap.md) for what's still open.

Since then (v16–v34, 2026-09-17 → 09-22) the app grew a meal plan and provisioning
model, a system → device → parts tree, spares fit checks, project phases, and — the
largest thread — a **maintenance history** meant to read like a vehicle history report:
an append-only completion trail (v26), past service records typed in from paper (v31),
device identity and "who did the work" (v32), vendor **invoices on file** (v33),
each job filed under the invoice that paid for it, the invoice total stored once and
never apportioned, and each job's **outcome** with the follow-on tasks it raised (v34). The card and bank statements stay the financial authority; the app
is the substantiation between a statement line and the work it paid for.

On 2026-09-24 (deploy 20, v36) the app was made shippable to other boats: everything
boat-specific that was hard-coded moved to owner Settings or opt-in environment variables,
and a separate release build (allowlist copy + privacy gate, fictional example boat,
optional starter packs generalised from this boat's library) produced v0.1.0.

In October 2026 the app became the boat's **ship's log** (option C: mx-inv owns the logbook; v37-v38,
2026-10-05): crew entries, failure status chains, the watch handover as a change report, an automatic
deck log, the rules engine's alarms pushed in, and passages - and its cockpit view was wired to the
boat's own automation stack, which moved onto the rebuilt Pi on 2026-10-06. Schema changes from v37 on run
through a small in-house migration runner at server start.
