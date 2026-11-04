<!--
Purpose: Deep dive on the /cockpit route - scope and non-goals, device architecture,
  component tree, and what is still open for the helm/companionway UI.
Version: v15 (2026-10-18) - v15: the cold boxes' EXPECTED? card (RestockQuestion.tsx, WF-502 / D-128; branch wf502-restock, not deployed). v14 (2026-10-09) - v14: a watermaker fill session cannot be stopped or replaced from the cockpit (409; button reads 'watermaker', disabled). v13 (2026-10-09) - v13: Tanks tile + TanksScreen - the crew 'Filling' / 'Stop' tap into the rules engine's tank-fill sessions (Ship's Automation D-129), GET / POST /api/cockpit/fill, capabilities.fill. v12 (2026-10-07) - v12: rebuild-from-spec pass - component tree current (BoatStrip, CockpitBits, HandoverCard, ThisWatch, PassageForm, logbook-backed IncidentForm); the 'hidden while the broker is off' paragraph replaced by the current capability flags; boat-stack table shows the Pi (BOAT-STACK-ON-PI.txt, 10-06) and points at Data Flows 7; a corrupted Windows path (control characters) fixed. v11 (2026-10-05) - v11: the owner's Ship's Log review (signed entries + watchkeeper, Sail Plan always on + Engine on/off, status changes by day, fix task -> Mark it Fixed; schema v39). v10 (2026-10-05) - v10: passages (Depart / Arrive tile, desktop Passages view, schema v38). v9 (2026-10-05) - v9: the desktop Ship's Log tab (read / filter / register / print). v8 (2026-10-05) - v8: Break / Incident -> the logbook, This watch + Log this watch. v7 (2026-10-05) - v7: Sail Plan wired to our SignalK (HB-09 options, back-dated changes). v6 (2026-10-05) - v6: pre-filled watch-handover card (SignalK + history read API). v5 (2026-10-05) - v5: wired to the live boat stack (rules engine) - alarm banner + Ack on every screen, boat-mode tap on home; see "Boat stack link" below. v4 (2026-10-04) - v4: production pass (branch cockpit-production) - see "Production pass 2026-10-04" below: full-screen layout, Day / Sun / Night modes, cockpit-sized checklist rows, connection banner + retries, confirm on Finish / Reset, light checklist list, real WX summary. v3 (2026-09-24) - v3: deploy 20 - Sail Plan and Break / Incident tiles are HIDDEN unless their broker is enabled, and the WX line unless the routing briefings folder exists (GET /api/cockpit/capabilities, useCockpitCapabilities); the old 'always says Logged' note replaced. v2: checklists are tick-only on the cockpit (deploy 14b); the incident form's system pick is the System › Device tap cascade (deploy 18). v1 (2026-09-22) - header added; staleness check only (the routing polar switch-over
  is done, so that open item is struck).
Scope: PRODUCTION - engineering documentation for the mx-inv app.
Architecture: mx-inv wiki page. Architecture.md places /cockpit in the process/frontend layout;
  Data-Flows-and-Interfaces.md has the wire detail of its two brokered writes.
Invocation: n/a (reference doc).
-->

# Cockpit / Deck GUI

The `/cockpit` route — a second, purpose-built UI surface inside the same
mx-inv app, for underway crew workflows that have never had a digital
surface at all. This page is the deep dive; see
[Architecture](Architecture.md#the-cockpit-route) for where it sits in the
process/frontend layout and
[Data Flows & Interfaces](Data-Flows-and-Interfaces.md) for the wire-level
detail on its two brokered writes.

## Why this exists (scope, not duplication)

Built from a full scope/architecture pass with the owner 2026-09-16, elicited
conversationally fact-by-fact rather than front-loaded (worth the same
patient approach if this design continues — a single fact like "autopilot
is on ~99% of a passage" materially recast the helm phone from primary
watch surface to convenience device). The organizing principle: **the automation developer
owns automation/real-time/embedded + read-only reporting** (Grafana,
OpenHAB, CLI-only InfluxDB/logbook writes); **the owner owns heavy-GUI/user-input**
(already the shape of the rest of mx-inv). This app is the cockpit/deck
extension of the owner's half — not a new policy, naming a boundary the two
stacks already respected.

**The non-goals list is the real design discipline here** — every candidate
feature was checked against something that already owns the job, and ruled
out if it would re-render or re-decide the same thing:

| Already owned by | Covers |
|---|---|
| Garmin GPSMAP 10x2/12x2 cockpit MFDs (keyed, N2K + GarminNet — **not** touchscreen, the previous developer's deliberate call for in-motion usability) | Position/chart, RADAR overlay, live sensor readings |
| MFD's own AIS/CPA alarms | Collision/close-target alerting — confirmed real and functional; the RPi only filters noise in *logged* AIS data, adds no new alert channel |
| MarineTraffic (paid) | Broader-than-~35nm-AIS vessel traffic |
| Windy (paid, supersedes PredictWind) | Live underway weather situational awareness |
| Yanmar 4JH80 instrument display | Engine telemetry — already well-instrumented |
| The `routing/` stack | Independent pre-passage planning/weather cross-check — stays separate; whether it's re-run underway is still TBD and this app assumes neither answer |

Two Garmin-native hosting options were researched and both ruled out before
settling on "new route in the existing app": **OneHelm** (HTML5 apps
running on the MFD glass) is a vetted-partner-gated platform, not an open
DIY path; **ActiveCaptain screen-mirroring** (already used successfully for
chart-reading in the routing project) is read-only and can't accept new
input. Neither fits a custom single-boat build of new input surfaces.

## Feature scope v1

Four features survived the non-goals filter:

| Feature | What it does | Why it's a real gap | Backend touchpoint |
|---|---|---|---|
| **Watch handover** | Checklist walk-through + a WX-update prompt at shift change | No digital surface exists today for the 6-hr watch rotation handoff | Reads mx-inv's existing checklist engine; WX from routing's last-computed briefing, not a live re-run |
| **Checklist running** | Any underway checklist (reefing, MOB, etc.), cockpit-sized | mx-inv's checklist screen already exists server-side but is sized for a desktop trial session | Reuses `ChecklistSteps`, already shared across Schedule and Management |
| **Sail plan change logging** | Captures rig/sail/reef changes as they happen, with accurate timing | The actual input feed for the previous developer's polar-refinement logic (not just anti-staleness housekeeping) — his refinement code needs the sail configuration and its timing to correctly bucket accumulated sailing data. Today the only path is a manually-updated web form at `slartibartfast.your-pi-hostname...` with no automatic trigger, silently stale after any change | New — needs a broker endpoint from the previous developer |
| **Break/incident logging** | Quick failure/observation capture from the cockpit | Today the *only* write path to the `logbook` InfluxDB measurement is CLI on `dolphin@your-pi-hostname` — unusable mid-watch | Brokered through `backend/vessel_log.py` (drafted, disabled, spec sent to the automation developer) |

None of the write paths touches InfluxDB directly: the two that reach the previous developer's side (sail
plan, incident) go through a broker, and the rest write only to mx-inv's own database —
consistent with the previous developer's "let him broker the writes" / least-privilege
posture (see [Design Decisions](Design-Decisions.md#let-automation-broker-influxdb-writes)).

A fifth item, **Watch Log** (live shift-change entry: position/weather/
distance/notables/AIS — originally designed as part of the `routing`
project 2026-09-11), was re-homed into this project 2026-09-17 given the
device/workflow overlap with Watch Handover. **Not yet re-scoped against
the four features above or built** — treat the original design as still
valid content, just relocated; it needs its own pass to fit into this
app's model before implementation.

## Device architecture

Three physical positions in the owner's actual cockpit, not three identical
nodes:

| Position | Hardware | Role |
|---|---|---|
| Helm | Recycled Android phone, existing custom slot + fixed power | Lean, single-tap glance UI — a convenience device, not the primary watch surface, since autopilot is on ~99% of a passage |
| Companionway, port | Recycled Android tablet, USB power, not battery-slaved | Richer text-entry surface — the de facto watch-standing location, next to the autopilot head and Yanmar display |
| Companionway, starboard | Recycled Android tablet, USB power, not battery-slaved | Same role as port; **exact device-to-position assignment still open** |

Only one companionway tablet is expected out at a time (moved to whichever
side is in use), not both simultaneously — a deliberate loss/damage-
exposure reduction; the second stays a spare, not a second active
position.

**One responsive PWA, two layouts** — a lean "glance" mode for the helm
phone, a fuller "work" mode for the companionway tablets — rather than two
separate apps: same backend, same data, just a different rendering for the
position. **Why a PWA over native**: the device fleet is recycled Android
at mixed/dated OS versions plus one still-updating unit; an installable web
app served straight off the boat LAN sidesteps a per-device native build
and app-store version matrix entirely. **Android-first is a real
simplification, not just a preference** — the owner's whole crew fleet (the owner and
crew member both) is Android; any iOS guest crew use the boat's own provided
devices rather than their own phone, so there's no need to design around
iOS Safari's PWA quirks (different install flow, different service-worker/
offline behavior) at all, not just deferred. the automation developer, by contrast, is iOS —
noted during scoping as "you can see the real difference in how we think
about technology there."

**Legibility**: the cockpit hardtop gives partial, angle-dependent shade
(not deep shade) — high-contrast, large-text styling was built in from the
start rather than treated as a later pass. Not yet tested against actual
recycled-device screen brightness in direct sun (open question).

## Implementation

### No router library, one shared backend

`/cockpit` is a real, deep-linkable URL resolved by a single
`window.location.pathname.startsWith('/cockpit')` check in `main.tsx`,
picking `<CockpitApp/>` instead of the desktop `<App/>` at mount time — see
[Design Decisions](Design-Decisions.md#no-router-library-for-cockpit) for
why a full router wasn't added for this. This is explicitly **a new view/
route inside the existing mx-inv app** (`run-live.bat`, port 8000), not a
separate service — it reuses the app's API, its database, and its LAN-only,
no-auth trust boundary rather than standing up parallel infrastructure.

### Component tree (`frontend/src/features/cockpit/`, as of 2026-10-07 on `logbook-page`)

```
CockpitApp.tsx        home screen: tap tiles (local useState screen switch, no router) ->
                       Watch Handover / Run a Checklist / Sail Plan (only when
                       capabilities.sail_plan) / Break-Incident / Depart-Arrive; screen
                       modes Day / Sun / Night; the connection banner (GET /ping every 15 s)
CockpitApp.css         all responsive behaviour - one component tree; a media query at
                       min-width 700px switches "glance" (phone) to "work" (tablet)
BoatStrip.tsx          AlarmBanner (every screen, Ack) + ModeCard (home) from GET /boat,
                       polled every 5 s; hidden when the engine is not configured / down
CockpitBits.tsx        shared pieces: friendlyError / LoadError (plain words + Retry),
                       ConnectionBanner, the Day / Sun / Night theme switch
useCockpit.ts          React Query hooks for /api/cockpit/* and the cockpit's logbook calls
                       (capabilities staleTime Infinity; reads retry 4x with backoff; writes
                       never retried, networkMode 'always')
WatchHandover.tsx      HandoverCard (GET /watch-handover/boat, every 30 s) + WX summary
                       (capabilities.weather) + ThisWatch + the "Watch Handover" checklist
                       run (found by NAME, see below)
HandoverCard.tsx       the pre-filled boat card
ThisWatch.tsx          "This watch" (GET /api/logbook/this-watch) + "Log this watch"
                       (POST /api/logbook/watch with the Observations text)
CockpitChecklists.tsx  checklist picker (GET /api/tasks/checklists) + ChecklistRunPanel
                       (tick-only ChecklistSteps; exported for WatchHandover)
SailPlanForm.tsx       HB-09 sail set (main down / full / reef 1-3; one headsail genoa or
                       staysail, full / reef 1-3, or none; wing-on-wing) + "when" ->
                       POST /sail-plan (v39: + Engine on / off and a ship's-log line)
IncidentForm.tsx       failure / observation / incident + System > Device cascade + text +
                       "when" + optional fix task -> POST /api/logbook
PassageForm.tsx        Depart / Arrive: port (recent ports as buttons), bound for ->
                       POST /api/logbook/departure | /arrival; "Under way -> X" from
                       GET /api/logbook/passages/current
TanksScreen.tsx        (2026-10-09) Tanks: fuel port / stbd, water port / stbd - level bar,
                       fill session line, a 'Filling' / 'Stop' button per row; tapping a
                       row opens that tank's focus screen (big level + big button);
                       GET /fill every 10 s, POST /fill. Home tile reads 'Filling: <tank>'
                       while a session is open (capabilities.fill)
```

**Checklist running needed zero new backend or new frontend logic** — it
reuses
`useFinishChecklistRun` (`features/management/mutations.ts`), and
`ChecklistSteps` (`features/management/ChecklistSteps.tsx`) wholesale (the checklist list itself comes from `GET /api/tasks/checklists` since 2026-10-04), the
same components the desktop Management/Schedule/Projects views already
share. The only cockpit-specific code is `ChecklistRunPanel`'s composition
and `CockpitApp.css`'s bigger touch targets/contrast — this is the
component-reuse pattern the scope doc called for explicitly ("no new
backend endpoint, just a cockpit-sized rendering of it").

**Tick-only checklists (2026-09-23, deploy 14b)**: `CockpitChecklists` renders `ChecklistSteps` with
`readOnly` - no reorder, edit, delete or add-step controls on the helm tablet, only the tick and the
"ℹ️ Details" view below. Restructuring a checklist is a desktop job. The Break/Incident form's
system field is the shared `SystemPicker`, which since 2026-09-24 opens the full-screen
System › Device tap cascade (search box on top) - same as on the desktop.

**Step "Details" on the cockpit (2026-09-20, tracker #28)**: `ChecklistSteps` is given `onOpenStep`, so every
line has an "ℹ️ Details" button (Watch Handover uses the same `ChecklistRunPanel`, so it has it too). It swaps
the run screen for `management/StepDetail` with the cockpit's own ← Back: the full how-to and caution note,
"What you need" (parts / tools, have, where stowed, SHORT) and references. **Read-only here** - no "Edit list",
no "open full record" - the helm tablet is for looking, not restructuring data (the same screen is editable on
the desktop). Larger text comes from a `.cockpit-checklist-run .step-detail-screen` rule in `StepDetail.css`.
Ticks are unaffected: nothing on that screen completes the step or draws stock. The cockpit's checklists also
show a step's linked tasks inline (per-run ticks, [Logic Flows](Logic-Flows.md#12-linked-tasks-inline-in-a-checklist-tracker-48-schema-v27)),
and a "🖨️ Print" link on the top-level checklist (opens the print sheet in a new tab).

**Watch Handover finds its checklist by name, not by id**:
`WatchHandover.tsx` searches the `GET /api/tasks/checklists` list (top-level checklists) for a
checklist whose `task_name` contains "watch handover" (case-insensitive). If it is ever renamed on
the desktop app, this screen stops finding it and says "No checklist with 'Watch Handover' in its name" -
worth knowing before renaming it there.

**What the cockpit hides, and why** (`GET /api/cockpit/capabilities`). Deploy 20 (2026-09-24) hid the
Sail Plan and Break / Incident tiles while they had nowhere real to send (both then only posted to
the previous developer's never-built services and answered "✅ Logged" for a write that went nowhere). Today
(cockpit router v7, 2026-10-05) the flags are: `sail_plan` = this server has a SignalK URL AND mx-inv's
SignalK write token (v39 shows the tile always and logs the change in the ship's log even without
SignalK); `incident` = always true (it writes the mx-inv logbook); `weather` = the routing briefings
folder exists; `boat` / `boat_write` = an engine URL / plus its token; `handover_live` = a SignalK URL;
`fill` (2026-10-09) = an engine URL (the Tanks tile; its taps also need `boat_write`).
The home screen drops the false tiles, Watch Handover drops the WX line and the card, and the alarm /
mode strip hides without `boat`. The sail-config webhook and `POST /api/cockpit/incident` no longer exist.

### System field uses the governed picklist, not free text

`IncidentForm.tsx` originally took "System" as a bare free-text `<input>` —
a drift from schema v14's `systems` lookup table / `SystemPicker` category-
device cascade that every other system-name field in the app uses (task
records via Management's `TaskDetail.tsx`). Caught during a 2026-09-17
review and fixed by reusing `SystemPicker` + `useSystems()` directly, no
backend change — incident reports now record a governed system name
(optionally down to a specific device, e.g. Propulsion → Yanmar 4JH80)
instead of arbitrary typed text. Worth checking any future cockpit form
that takes a system name for the same gap before assuming it's wired
correctly, since this feature slice was built before that convention was
locked in.

**All four v1 tiles confirmed working end-to-end by the owner, 2026-09-17** (Sail Plan and
Break / Incident are hidden on live since deploy 20 - see above).

### WX summary (real since 2026-10-04)

`GET /api/cockpit/watch-handover/wx` reads the newest `routing/var/briefings/*.md` (by mtime)
and pulls out, line by line, the `*Generated ...*` line, the first quoted line of §3a (routing's
tropical verdict) and the §3b bullets **Wind / Seas / Pressure / Source**, plus the file's age
(`old` past 24 h). `status: "ok"` when any weather field was found, else `"PENDING"` with a plain
`reason`. Every field is optional: a missing folder, empty folder, unreadable or half-written
file answers 200 (tests/test_cockpit.py). If routing changes its headings the fields simply come
back empty - check this parser (`parse_briefing` in backend/routers/cockpit.py) first. The folder
defaults to the sibling `..\routing\var\briefings`; `MXINV_ROUTING_BRIEFINGS_DIR` overrides it.

## Production pass 2026-10-04 (branch `cockpit-production`)

- **Layout**: the app fills the screen (it shrank to its content inside `#root`'s flex column);
  content max 1100 px; no horizontal scroll at 360, 600, 800 and 1280 px wide.
- **Screen modes** (top bar, remembered per tablet in localStorage): Day (white on black), Sun
  (black on white - a whole-page `invert + hue-rotate` filter on `<html>`), Night (dim red - an
  SVG colour-matrix filter `#cockpit-night` kept in CockpitApp.tsx). Whole-page filters so the
  shared ChecklistSteps / StepDetail / ConfirmDialog follow without per-component colours.
- **Touch targets**: shared checklist rows at cockpit size under `.cockpit-app` (checkbox
  2.75 rem, text 1.1-1.2 rem, buttons >= 48 px); Print hidden on the cockpit.
- **Flaky Wi-Fi**: `GET /api/cockpit/ping` every 15 s drives an orange "No contact since HH:MM"
  banner; cockpit queries retry 4x with backoff and refresh on wake / reconnect; an open
  checklist re-reads its ticks every 20 s (phone and tablet agree); writes are never retried and
  fail visibly offline (`networkMode: 'always'`); load failures show plain words + Retry.
- **Safety**: Finish run and (cockpit-only) Reset ask first; step boxes are disabled while a
  tick is in flight; a failed step tick shows its error (it used to vanish).
- **Payload**: the picker and Watch Handover use `GET /api/tasks/checklists` (~20 KB, retired
  checklists dropped) instead of `GET /api/tasks` (~870 KB). StepDetail still loads `/api/tasks`
  when a step's Details is opened.

## Boat stack link (2026-10-05, branch `cockpit-stack-wiring`)

The cockpit talks to our own boat automation stack (Ship's Automation: rules engine + SignalK + history
read API). It was built against the stack on the Ship's PC (10-05) and since **2026-10-06 reads the
rebuilt Pi** (boat-automation, 192.168.1.10) from the laptop. One module, `backend/boat_link.py`, holds
the connection; **moving hosts = changing its environment variables, nothing else**. The full variable
table, every call and the SignalK paths are in [Data Flows ⑦](Data-Flows-and-Interfaces.md); in short:

| Variable | mx-inv on the laptop, stack on the Pi (today, `BOAT-STACK-ON-PI.txt`) | mx-inv beside the stack (Ship's PC 10-05 / the Pi later) |
|---|---|---|
| `MXINV_ENGINE_URL` | `http://192.168.1.10:8200` | `http://127.0.0.1:8210` on the Ship's PC (Windows :8200 was the manuals service) / `http://127.0.0.1:8200` on the Pi |
| `MXINV_ENGINE_TOKEN_FILE` | `%USERPROFILE%\.boat-secrets\engine.env` (`ENGINE_API_TOKEN=` read, value stripped) | the stack's own engine env file |
| `MXINV_SIGNALK_URL` | `http://192.168.1.10:3000` | `http://127.0.0.1:3000` |
| `MXINV_HISTORY_URL` | `http://192.168.1.10:8090` | `http://127.0.0.1:8090` |

Set by `run-live.bat` (v7-v11). No URL = the boat parts are hidden; URL but no token = read-only
(status + alarms, no taps).

- **`GET /api/cockpit/boat`** - mode, tapped mode, alarms, health, test flag (trimmed engine `/status`).
  The tablet polls it every 5 s; no per-request retry (the poll is the retry). The engine down = 502 with
  a plain line naming the engine URL; the tablet then hides the mode card and alarms rather than show a
  remembered (stale) mode.
- **`POST /api/cockpit/mode`** - the DOCK / ANCHOR / AWAY / MOTOR / SAIL tap (Ship's Automation D-092 / SO-9).
  The guard is the tablet's own lock PIN (the owner 10-04); the engine token stays on the mx-inv server. The
  confirm dialog says what the tap arms (same words as the landing page System page) and, for
  DOCK / ANCHOR / AWAY, that only another tap disarms it.
- **`POST /api/cockpit/ack`** - acks every alarm (the engine has one ack, like the panel button). An ack
  also ends a running test (D-111).
- **Cold boxes - EXPECTED? (2026-10-18, branch `wf502-restock`, NOT deployed), Ship's Automation WF-502 / D-128** - when a fridge / freezer has been over its WF-501 limit for 10 min and mx-inv never saw food go in (leftover pizza, 10-08), the engine asks 'expected?' - a NUDGE on the phones (words only) and a blue card under the alarm banner on EVERY cockpit screen (`RestockQuestion.tsx`, `GET /api/cockpit/restock` every 10 s): **YES, expected** (2 h for the box to cool down - its alarm waits) / **NO, not expected** (the alarm now). No answer changes nothing - the alarm comes at 30 min as before. No confirm (the owner 10-08: 'y/n'). The card hides while the engine is unreachable and when no box is asking. Food received / stowed into a cold box in mx-inv marks it without a question (backend/restock_link.py). The anchor-box screen gets the same question later (
- **Tanks / 'Filling' tap (2026-10-09, Ship's Automation D-129)** - `GET /api/cockpit/fill` (the engine's `GET /fill`,
  as a list fuel first, level rounded, + the watermaker + `can_write`) and `POST /api/cockpit/fill` `{tank, on}` ->
  engine `POST /fill` `{tank, on, by: "cockpit"}` with the engine token. Why a tap: the level senders slosh 5-6 points
  while the boat rocks, so the engine no longer guesses a fill from them - the crew STARTS one (the anchor box most of
  the time; the cockpit for a fuel fill at the start or end of a passage) and the engine then calls the ETA and chirps
  at 90 % and 95 % (= full). The watermaker opens its own fresh-water session (shown as 'waiting to see this tank rise'
  until its string's level climbs - the hand valve is not sensed). Sessions end by themselves (20 min with no rise,
  4 h, watermaker stopped) - the 10 s poll shows it. **A watermaker session cannot be stopped or replaced from the
  cockpit** (button reads 'watermaker', disabled; the server refuses with 409 after reading GET /fill): it carries the
  95 % HP-pump cut (D-130), and a Stop - or a tap session replacing it that then times out after 20 min - would drop
  it. the owner 10-09: the watermaker must never overflow a tank while the crew is busy with something else. Same rule as
  the anchor box (v0.9.0). It ends when the watermaker stops. No confirm dialog: a start or stop is harmless and undoable with
  the next tap (a stray start ends itself after 20 min). An engine older than api.py v9 answers 404 -> **501** "no
  tank fills yet"; engine down = 502 in plain words, and the screen shows no remembered levels.
- Every write is tagged `api:cockpit` in the engine audit log.
- **`GET /api/cockpit/watch-handover/boat`** (v5) - the pre-filled handover card (Ship's Automation WF-602 / CAMS N-39),
  `backend/handover_card.py`: position, SOG / COG (COG hidden under 0.5 kn), STW, apparent wind, barometer with its
  3-h change, depth under the keel, fuel + water (gal, %, used this watch), distance run this watch, house bank V / A,
  air / sea temperature. "This watch" = the last 6 h (the boat's 6-h watches, mx-inv #544) via the history read API
  (D-052 door #1 - mx-inv never logs in to the database). Left out on purpose: heading + true wind (headings read
  ~180 deg off, F-100 / F-099) and SoC (shunt SoC invalid, F-186). Missing / stale values are dropped, not shown old.
  UI: `HandoverCard.tsx` at the top of Watch Handover, refreshed every 30 s.
- **Sail Plan (v7)** — `GET / POST /api/cockpit/sail-plan` -> `backend/sail_plan.py` (HB-09 rules: main down /
  full / reef 1-3; ONE headsail, genoa or staysail, full / reef 1-3, or none; wing-on-wing = main + genoa) ->
  SignalK `sails.activeSet`, back-dated to "when" (just now / 5 / 10 / 15 / 30 min ago). The history DB keeps it
  as state = the sail log; see [Data Flows ④](Data-Flows-and-Interfaces.md). Tile shown when this server has a
  SignalK write token. Replaces the 2026-09-17 free checklist + the previous developer webhook.
- **Break / Incident + This watch (branch `logbook-v37`, schema v37)** — the tile writes the mx-inv logbook
  (`POST /api/logbook`, failure / observation / incident, System > Device pick, "when", optional fix task), stamped
  by `backend/log_stamp.py`. Watch Handover shows **This watch** (engine events + entries logged since the last watch
  entry) and **Log this watch** (the watch entry = card snapshot + that list + notables). See
  `design/LOGBOOK_DESIGN.md`.
- **Desktop 📖 Ship's Log tab (branch `logbook-page`, no schema change)** — `frontend/src/features/logbook/`: day
  by day (newest first; period or from / to, kind, System > Device, deck-log lines on/off, engine TEST events
  off by default), the **failure register** (every failure grouped by its status now - Broke / Parts Ordered /
  Deferred open, Accepted / Fixed collapsed; the register the handover deliberately does not repeat), an entry
  full-screen (stamp, status chain, **add a status update**, system / fix-task links), a desktop new-entry form, and
  **printable day / passage** = `GET /api/report/logbook?day=&to=&tests=` (`backend/logbook_report.py`: oldest
  first, ⚓ instrument lines, status chains, the open-failure register at the end).
- **Passages (branch `passages`, schema v38, the owner 10-05: each leg is a passage)** — a `departure` entry to the next
  `arrival`, derived, never stored (`logbook_passage_ends` holds the ports). Cockpit **Depart / Arrive** tile
  ("Under way → Pensacola", recent ports as buttons); desktop Ship's Log **⛵ Passages** view (leg under way, log
  departure / arrival, every passage with duration, logged distance, counts, **Print this passage** =
  `/api/report/logbook?passage=<id>`). Order enforced (409). `design/LOGBOOK_DESIGN.md` section 5b.
- **Ship's Log review (branch `review-batch`, schema v39)** — every cockpit / desktop entry is **signed** from the crew
  list (`AuthorPick`, default = the watchkeeper set at the handover / departure); Watch Handover has **Handed over by /
  Taking the watch**; the **Sail Plan** tile is always shown, logs every change to the ship's log (SignalK only when it
  can) and has **Engine on / off**; the desktop day view shows **status changes on their own day**; completing a fix
  task **offers Mark it Fixed**; **Engine on / off** take the **hour meter** (prefilled with mx-inv's estimate; stamped on
  the entry AND set as the maintenance reading, never backwards; passages report engine hours run).
  `design/LOGBOOK_DESIGN.md` section 5c.
- UI: `BoatStrip.tsx` - `AlarmBanner` (every screen, red for an unacked P1, amber otherwise, acked rows
  dimmed, TEST tag on simulated alarms) and `ModeCard` (home).

## Explicitly open

- **Device-to-position assignment** — which physical phone/tablet goes to
  which of the three positions. Scope doc's own final "next step," not
  blocking the software.
- **PWA install polish** — manifest/icons/"add to home screen" — the route
  itself renders and works, this is purely the install experience.
- **Watch Log** — re-homed here but not re-scoped or built (see above).
- **Kiosk vs. pick-up-and-use** — the companionway tablets aren't
  battery-slaved yet, which keeps them flexible (grab, use, put back)
  rather than permanently wired. Worth a deliberate decision as the devices
  age rather than defaulting into kiosk mode.
- **Routing-stack refresh cadence underway** — still TBD whether the
  onboard computed route gets re-run at sea. This app deliberately shows
  "here's what the last computed plan says" without assuming either a
  live-refresh or fixed-once model, so it doesn't need to pick a side of
  this open question to work correctly either way.
- **Sunlight legibility** — high-contrast styling was built in from the
  start, but not yet tested against actual recycled-device screen
  brightness in direct sun.
- **Sail Plan on live** — needs mx-inv's SignalK token on the live host (`scripts/signalk_device_token.py`,
  the owner approves it read/write in SignalK admin); the tile appears on its own. Break / Incident = item 4 (logbook).
- **Multi-crew use beyond the owner/crew member** — resolved as Android-only for now
  (see above); revisit only if this needs to serve non-Android guest crew
  on their own devices, which hasn't come up.
- ~~A related wiring task: switch `routing/` from its hand-estimated
  PROVISIONAL polar to the previous developer's live `polar_baseline`~~ — **done** (routing
  side): routing now reads `polar_baseline` from InfluxDB for every
  briefing, with `config/baseline.pol` only as the fallback (see
  `
- **Bandwidth accounting** (surfaced by scoping, not part of this app):
  MarineTraffic + Windy "leaned on heavily" underway is real, untracked
  Starlink Ocean Mode ($6/GB) spend — worth folding into the existing
  bandwidth-consumer audit (see the `comms-infrastructure` project memory).

## Source of record

This page is derived from the full "Cockpit App — Scope & Architecture"
design doc (built conversationally 2026-09-16, 19 revisions) plus the
implemented code as of 2026-09-16/17. If the two ever disagree, trust the
code for *what's built* and the doc (or this page) for *why* — and update
whichever is stale.
