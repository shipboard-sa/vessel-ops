<!--
Purpose: What has shipped (dated blocks, newest first), what is open, and what was decided not to build, for the mx-inv app.
Version: v17 (2026-10-18) - v17: status line through 10-18 (WF-502 restock LIVE); the 10-07 wiki-pass code fixes and the migrations/ gap marked DONE 10-07 (the v0.1.2 zip rebuild stays open); Docker on (the automation developer's) Pi marked moot (D-105). v16 (2026-10-08) - v16: review-batch (schema v39) merged + LIVE 2026-10-08. v15 (2026-10-08) - v15: Work a Container redesign LIVE -> Done. v14 (2026-10-08) - v14: Work a Container v5 built (contents first). v13 (2026-10-07) - v13: Open gains the Work a Container redesign (the owner's feedback). v12: status line gains 10-06 / 10-07; Open: hardening phase 2 marked done, deploying review-batch now needs a merge (not a fast-forward), the 10-07 wiki-pass findings (recipes GET body params, delete_system vs logbook FK, stamp column order), and the release builder + Dockerfile missing migrations/ (CI failing since 10-05). v11 (2026-10-05) - v11: 10-05 - deploy 24 (logbook v37), the Ship's Log tab, passages (v38), the Ship's PC RMA / laptop interim host, review-batch (v39) built. v10 (2026-09-27) - v10: deploy 23 (stow moves out of Unassigned) + the 846-item Amazon/dive purchase load. v9 (2026-09-24) - v9: deploy 22 + hardening phases 0-1 written up; phases 2-5 (+ three proposed debt items) under Open; Streamlit retirement approved; the "no migration framework" call superseded; Docker entry brought to spec v5. v8: deploy 21 (synchronous = FULL, code ee82ca2) + the Docker-readiness pass (image, backup job, CI v2) written up; logbook = option C noted under Open. v7: deploy 20 (schema v36, release-package branch) + release v0.1.0 written up; status line current; #44 open item no longer lists event_kind / evidence_path (shipped deploy 15); release follow-ups under Open. v6: deploys 16-19 (tap-column pickers) written up. v5 (2026-09-23) - v5: deploy 13 (v35) written up, deploy 14 (#74/#76 get-well pass) added. v4 (2026-09-22): deploy 12 (#70 follow-on urgency) + the Electrical + Solar build-log backfill applied; "Enter the real history" open item brought current. v3: deploy 11 (#68 defer-from-today, #69 "add as a step" wording). v2: deploy 10 (schema v34, code d54252c, task outcome + follow-on tasks) - status line, a Done block, #44's open list trimmed, the electrical/solar history backfill draft added under Open. v1: header added; brought current through the 2026-09-22 deploys 5-8 (schema v30-v32, code ca5d053) and the invoices build (schema v33, 863570e, deployed ~16:23 as deploy 9).
Scope: PRODUCTION - engineering wiki page, pushed with the code.
Architecture: mx-inv wiki (wiki/Home.md is the index). Current-state summary; CHECKPOINT.md holds the short open-items list and history/ the play-by-play. Update at every archive point.
Invocation: n/a (reference doc).
-->
# Roadmap

Status as of **2026-10-18**: live = schema **v39**, branch `logbook-page`; 10-09 cockpit Tanks / 'Filling' tap +
watermaker guard; 10-18 WF-502 cold-box restock (`f6b7734`). Earlier, 2026-10-05 night: live = schema **v38** on the LAPTOP (interim host - the Ship's PC is away for an
MSI RMA): deploy 24 + the desktop Ship's Log tab + passages. 2026-10-08: `review-batch` (v39) merged + LIVE.
2026-10-06: the cockpit reads our rebuilt Pi (`BOAT-STACK-ON-PI.txt`, run-live.bat v11), engine alarm events land in
the ship's log; 10-07: tablet LAN access restored after the router swap (Wi-Fi profile -> Private), the Streamlit
launcher removed, and the wiki rebuilt as a full spec (API Reference page, Schema section 11, Operations build /
restore / guard files).
Before that, 2026-09-27: schema v36, deploy 23 (stow moves out of Unassigned; the
846-item purchase load waits in Unassigned for the inventory walk). Before that, deploy 22 (hardening phase 0, ~16:00) on top of deploy 21
(SQLite `synchronous = FULL`, ~15:30) and deploy 20 (branch `release-package`) - owner Settings, first-run init, opt-in integrations, settable hour meter and `tasks.schedule_from`, on
top of the tap-column pickers (deploys 16-19). Release package v0.1.0 built the same day, replaced by
v0.1.1 (the deploy-22 fix) before it was sent to anyone.
Kept current at the end of each working session — see the note at the bottom of this page about how.

## Done

**2026-10-08 (three restarts on the laptop, no schema change, code `ec3540f`) - Work a Container redesign (the owner's
walk, 10-07/08).** The container's contents come first (**In here now**, capped + foldable), each row tickable - a
tick is a lasting "verified here on <date>" record in the open audit (`POST /api/audits/{id}/verify`, stock
untouched); the add list defaults to Unassigned (no cap); **Done with this container** offers the un-ticked a move
to Unassigned (`POST /api/items/move-to-unassigned`); an item already in another container needs a *Move* or *Add as
extra* pick (stow line `mode`); ticks survive a change of target. 158 tests. Detail: [Workflows](Workflows.md) 10.
Same night (~23:02, **schema v38 -> v39**): branch `review-batch` - the owner's Ship's Log review items 1-8 + engine hours -
**merged** into `logbook-page` (`552a1f6`; conflicts were header notes only) and **live**: signed entries (watchkeeper
default), Boat Instruments, sources in words, status changes on their own day, Mark it Fixed, Sail Plan always on,
Engine on / off with the hour meter. 164 tests. Migration backup `vessel_local.db.bak-premigrate-v38-20261008-230123`.

**2026-10-05 - the SHIP'S LOG (Owner: "no more paper").** Deploy 24 on the Ship's PC (schema v37, the first migration
through the `migrations/` runner): the cockpit wired to our boat stack and the logbook - failure / observation / incident
/ watch / engine-event / deck-log entries, append-only, the owner's five statuses, the handover as a change report, the
automatic deck log. Same day: the desktop **📖 Ship's Log** tab (day by day, failure register, entry detail, new entry,
printable day / range) and **passages** (v38 - a departure to the next arrival, derived; cockpit Depart / Arrive,
desktop Passages + Print this passage), deployed on the **laptop**, which became the interim live host when the Ship's
PC died (~13:00; MSI RMA; its SSD backed up and wiped; the DB copied off the boat drive, which is frozen until the
copy-back). the owner's review of the tab -> branch `review-batch` (v39; merged + LIVE 2026-10-08): signed entries and the
watchkeeper, status changes on their own day, fix task -> Mark it Fixed, Sail Plan always on + Engine on / off with the
hour meter, wind angle, "Automation" label. Design: `design/LOGBOOK_DESIGN.md` 5b / 5c; [Cockpit GUI](Cockpit-GUI.md).

**2026-09-27 (deploy 23, no schema change, code `a5bb115`) - stow moves out of Unassigned; the
Amazon + dive-gear purchase load.** `stow_items` now draws an item's Unassigned stock first
([Design Decisions](Design-Decisions.md), "Assign many items to a container at once"), and the
Locker filtered to a container pre-fills each tick with that container's quantity; 7 new tests
(87 pass). Then `scripts/oneoff/amazon_dive_load_20260927.py` (commit `89f6048`, draft ->
dry-run -> apply through the API) loaded **846 items** the owner marked aboard that the catalog lacked
- 784 from the Amazon 2024-26 export (his Keep? cull of `references/AMAZON_SWEEP_20260924.xlsx`)
and 62 from Virginia Scuba's purchase history (68 lines, 2018-25, all type gear) - each with its
bought quantity in Unassigned (847 rows, 1,224 units); 9 skipped as already catalogued; 31 carry a
"CHECK AT THE WALK" note (possibly the installed unit of a device). Every loaded item's notes end
"(purchase load 2026-09-27)". the owner's rules: everything is presumed aboard (the Beneteau's gear
came back), exceptions are culled at the inventory walk, installed-vs-spare is settled there.
Backup before the apply: `vessel_local.db.bak-predeploy-20260927-190822`.

**2026-09-27 (data only) - history backfill batches 3 + 4: Plumbing (49 milestone records, follow-ons #891-#893) and
Hull, Deck & Bottom (37 records - the first with event kinds: the 2 Jul 2026 relaunch is a haul_out event, the propane-locker
and lazarette-bulkhead removals are modifications, the Nov 2025 moisture assessment a survey; follow-ons #895/#896; Dinghy
corrected to Achilles).** Scripts `scripts/oneoff/history_backfill_{plumbing,hull}_20260927.py`. A duplicate record made by
batch 2 (#112 = Electrical #73) was voided; the scripts now refuse a second run and flag device + date clashes.

**2026-09-27 (data only) - history backfill batch 2: Repower, Generator & Running Gear.**
`scripts/oneoff/history_backfill_repower_20260927.py` (Q&A'd draft `design/HISTORY_BACKFILL_DRAFT_REPOWER_20260927.md`,
review page alongside): 28 past-service records from the owner's build log (Sep 2025 - Aug 2026, incl. the July 2026
hydrolock: missing anti-siphon loop), task #672 "Initial sea trial" completed as of 2026-07-30, follow-ons
#889/#890, Transmission corrected to ZF30M (Gulf Solutions invoice #19). Install work = Seabrook with the owner. The
batch-1 records of 8/10 Jul were NOT annotated - the completion history is append-only (DB trigger); the new
11 Jul record points back to them.

**2026-09-24 (deploy 22, no schema change, code `5840756`) - architecture review; hardening
phases 0-1.** the owner asked whether the now-stable app should move to a better technology for the
boat/Pi environment; the answer was keep the stack and close six practice gaps in phases
(`design/ARCH_HARDENING_PLAN.md`, [Design Decisions](Design-Decisions.md#keep-the-stack)).
Phase 0 (live): an unmatched `/api/...` GET is a 404 JSON instead of `index.html`, and the SPA
fallback serves only files inside `frontend/dist` - an encoded `..%2F` path had been serving any
file, the live database included, to anyone on the LAN/Tailscale (confirmed with a harmless file,
closed and re-verified on live). Phase 1: `tests/` - 80 pytest tests on per-test temp databases
(schedule buckets, deferral, completions + consumption, the append-only triggers attacked with raw
SQL, cost-or-invoice, stock merges, checklists, API write round-trips read back from the DB) plus
2 strict xfails that phase 4 flips; `requirements-dev.txt`; CI v3 runs them; `scripts/golden_check.py`
for local before/after diffs on a copy of live. Writing the tests found no bugs besides the leak.
The release zip had the same leak, so it was rebuilt as **v0.1.1** before anyone received v0.1.0.

**2026-09-24 (deploy 21, no schema change, code `ee82ca2`) - Docker readiness from spec v5.**
the previous developer's reply to the Docker spec (and his two new your-pi-hostname wiki pages) turned into spec v5
(`design/DOCKER_DEPLOYMENT_SPEC.md`). What landed in this repo: `data.connect()` now runs
`PRAGMA synchronous = FULL` (the only live change - WAL + NORMAL can drop the last commits on a
sudden power cut, and the Pi can lose power without warning); `requirements-server.txt`, a
two-stage `Dockerfile` (Node build -> `python:3.13-slim-bookworm`) with an allowlist
`.dockerignore`; `docker/backup.py` (verified backup-API snapshot, 14-day prune);
`docker/docker-compose.reference.yml` + `.env.example` laid out per his runbook; CI v2 (Python 3.13
API smoke on a temp DB, frontend build, image build + start as UID 2300 + backup run - all green
first time). Routing got `/api/health`, a `HYLAS_INFLUX_URL` override and its own Dockerfile
(commit `fb4c1ce` in that repo). Nothing is deployed to the Pi; the logbook is decided (option C,
Design-Decisions {#logbook-in-mx-inv}) but not built.

**2026-09-24 (deploy 20, schema v36, branch `release-package` 2d094e8..14a533b) - the app made
shippable, and release v0.1.0.** Everything boat-specific that was hard-coded became an owner
Setting or an opt-in switch, so the same code runs live and in a package for other boats.
- **Owner Settings** (header ⚙; `GET/PUT /api/settings`, `system_config`): boat name (header
  "⚓ <name>", page title, both printouts; blank = omitted), engine / genset meter labels
  (telemetry widget, hour-meter pick), manuals folder (device research). Live: "SV Your Boat Name
  2", "Yanmar", "Westerbeke genset", `D:\Documents\sailboat\Manuals`.
- **First run creates the DB** (`db_schema.ensure_initialised()`, never migrates); generic
  compartments seeded only on a fresh DB, no crew seed.
- **Opt-in integrations**: `/routing` proxy (`MXINV_ROUTING_URL`) and Influx telemetry
  (`MXINV_INFLUX_*`); `run-live.bat` v5 sets live's values, so nothing changed on live.
- **Cockpit** hides Sail Plan and Break / Incident while their broker is off, and the WX line
  without a briefings folder (`/api/cockpit/capabilities`). Both brokers are off on live, so those
  two tiles are gone from live's cockpit - they had been saying "Logged" and sending nothing.
- **Hour meter settable**: TaskDetail v4 "Hour meter" select on `hrs` tasks; default engine; bad
  value = 400. Nothing in the app could set it before. First checklist on a fresh DB creates its
  'Checklists' system.
- **Schema v36 `tasks.schedule_from`** + `data.task_baseline_date` (one never-done rule for
  schedule and defer); never-done cards say "not done yet" instead of an assumed date (also true
  on live). Migration additive, 861 live tasks identical in the dry run.
- Placeholder/hint text made generic across nine screens; recipe book subtitle no longer says
  "not linked to inventory".
- **Release v0.1.0**: `scripts/release/build_release.py` (allowlist + privacy gate) ->
  `code/mx-inv-release-out/vessel-ops-panel-0.1.0.zip`; Windows + Mac launchers, README /
  INTEGRATIONS / CLAUDE.md, `docs/USER_GUIDE.md`, `docs/dev/*`; fictional example boat; optional
  starter packs (1,168 recipes; maintenance library + checklists + haul-out template) exported
  from live and generalised, REVIEW.md accepted by the owner. Cold-tested from the zip on Windows.
Decisions: [release package](Design-Decisions.md#release-package),
[settings](Design-Decisions.md#settings-not-hardcoded),
[opt-in integrations](Design-Decisions.md#opt-in-integrations),
[never-done baseline](Design-Decisions.md#never-done-baseline).

**2026-09-24 (deploys 16-19, schema v35 unchanged, all frontend-only; 19 live ~09:25, `8811c6c`) -
one tap-column view for every tree.** Owner: the type-to-search container list was too long, too
narrow and clunky to type into. 16: the container picker became a full-screen Compartment ›
Location › Container cascade, "＋ New …" first in every column. 17 (Owner: keep the interface
consistent): Edit Storage Structure rebuilt on the same columns plus an edit panel (rename / kind /
notes / ⭐ / move / delete); "Move to…" picks the destination in the same columns (current place
"here now", create-on-the-fly works); the old nested-list CSS removed. 18: the view became a shared
kit (`components/TapColumns.tsx`) and the systems tree got it too - `management/SystemCascade.tsx`
(System › Device, search box on top, "✓ Use <system> itself") behind SystemPicker (7 forms),
ServesEditor and SystemScreen's Move… / delete-reassign. 19: compartments A-Z like every other
level. Tools / accessories / recipes / food stay on SearchPick (flat lists). Backups
`vessel_local.db.bak-predeploy-20260924-075328` (16-18) and `...-091732` (19). Same day, data
research only: Amazon sweep step 1 (`scripts/oneoff/amazon_sweep_20260924.py` -> a spreadsheet of
every 2024-26 order line for the owner to cull; step 2 after the usage reset). Decision:
[container cascade](Design-Decisions.md#container-cascade).

**2026-09-23 (deploy 15, schema v35 unchanged, live ~10:45, `5a04548`) - past-service records
take a kind of event + an evidence path.** The v32 `event_kind` / `evidence_path` columns get their
first writer (the form on the Log tab); the Log and the printed report show both. Same day, deploy
14b (`8c7e4e0`, frontend-only): cockpit checklist tick-only, Locker breadcrumb, wider phase pick.
The planned cockpit trail + item card was dropped - the step detail already shows on-hand and
stowage, and has no onward task link to walk.

**2026-09-23 (deploy 14, schema v35 unchanged, live ~09:58, backup
`vessel_local.db.bak-predeploy-20260923-095800`) - #74 clickable to detail + #76 no-detour
workflows, the get-well pass.** Two fresh sweeps of the whole GUI (~60 #74 sites, ~25 #76 pick
lists) turned into `design/CLICKABLE_SWEEP_PLAN_20260923.md` v2, then built: AppNav v3 (one opener
for every record kind, every tab an origin, Back returns to the exact screen), keep-alive tabs,
RecordLink / CheckRow / SystemTaskLabel, SearchPick + FoodPick / StuffPick, ContainerPicker v3,
SystemPicker v2. Backend: `origin_task_id` on tasks; `GET /items/{id}/accessories`. New wiki page
[Workflows](Workflows.md). Decisions: [clickable to detail](Design-Decisions.md#clickable-to-detail),
[no detours](Design-Decisions.md#no-detour-workflows).

**2026-09-23 (deploy 13, schema v35, live ~09:12) - #71/#72/#73/#75.** `recipe_ingredients.link_confirmed`;
cook / meal-plan lines "📌 Save to recipe" + "💾 Save all N changes" (#71); device screen "Find an
existing task to file here" (#72); checklist line NAME opens the step, only the box ticks (#73);
"＋ New item…" first in every parse-review / cook list and for parts / tools / accessories via the
shared NewStuffItemForm (#75). Backup `vessel_local.db.bak-predeploy-20260923-091130`.

**2026-09-22 (night, deploy 12, schema v34 unchanged, live ~21:27) - follow-on urgency + the
first build-log history backfill** (tracker #70, #44). Backup
`vessel_local.db.bak-predeploy-20260922-212308`; the backfill was applied with the server stopped,
then the owner relaunched `run-live.bat`. Verified: bundle `index-DBOhCxKk.js` carries the picker, rows
+83 = exactly what the apply wrote, integrity + FK clean, follow-ons show as Routine Repair.
- **#70** - each follow-on row picks Routine (default) / Urgent / Drop everything, stored as the
  break/fix `period`; they used to be forced to "drop everything"
  ([Design-Decisions](Design-Decisions.md#follow-on-urgency)).
- **Electrical + Solar backfill** (`scripts/oneoff/history_backfill_electrical_20260922.py`) -
  72 past service records from the owner's build-log posts, 6 new devices (DC Breaker Panel, AC Breaker
  Panel, BatteryProtect - Victron, 24/12 Converter - Autopilot, High Output Alternator - Balmar,
  Starlink), 4 Routine follow-ons (verify Balmar charging, finish the scuba compressor's 50 Hz
  conversion, diagnose Starlink drop-outs, fit the hinged-panel extension cables), `installed_on`
  filled on 17 devices, and the crew roster switched to legal names for the history record
  ([Design-Decisions](Design-Decisions.md#build-log-backfill)).

**2026-09-22 (evening, deploy 11, schema v34 unchanged, live ~20:25) - defer from today +
clearer "add as a step" wording** (tracker #68, #69; the owner's feedback). Tested first on a scratch
copy (days + simulated-meter hrs math read back from the DB, both picker paths clicked through),
then deployed by the full procedure minus a migration (backup
`vessel_local.db.bak-predeploy-20260922-202328`; the owner relaunched `run-live.bat` himself, which
also revived the #50 research button). Verified: endpoints return real bodies, bundle
`index-B8f7Gl0T.js` carries both changes, schema 34, integrity + FK clean, rows unchanged.
- **#68** - the Schedule card's "+N" defer now counts from NOW: new due =
  max(current due, today) + N days, so an overdue task lands N days out instead of staying
  overdue, and a task not yet due is never pulled earlier. `hrs` tasks: current meter reading +
  N hours. Math in `data.defer_task` (v37); `deferred_units` keeps its meaning (offset from the
  undeferred due point), so `backend/scheduling.py` is unchanged. "Until <date>" and the Layup
  Return bulk-defer were already absolute and are untouched. Button: "+7d from now" / "from due".
- **#69** - a task's record: "＋ Add as a step to a project…" and ONE "＋ Add as a step to a
  checklist…" picker, then "Keep it on its own schedule too?" - Yes = LINK (it keeps its own
  schedule; the checklist points at it), No = MOVE (it becomes that checklist's step and leaves
  the rolling schedule). A task already a step elsewhere can only be linked, so no question.
  The checklist side's add-existing-task buttons match: "Add - keep its own schedule" /
  "Add - only with this checklist".

**2026-09-22 (late, deploy 10, schema v33 -> v34, live ~17:40) - task outcome + follow-on
tasks** (tracker #44; reasoning in
[Design-Decisions](Design-Decisions.md#follow-on-tasks), mechanics in
[Logic Flows](Logic-Flows.md#18-task-outcome-and-follow-on-tasks-schema-v34)). Commit
`d54252c`; tested first on a scratch copy of live (migration self-test, API round trips read
back from the DB - bad input writes nothing, one entry -> many follow-ons, void keeps them,
outcome immutable - and a GUI complete-with-follow-on), then deployed by the full procedure
(`scripts/oneoff/migrate_schema_v34.py`, additive; pre-deploy backup
`vessel_local.db.bak-predeploy-20260922-173938`, the migration's own `...-173955`). Verified
after: schema 34, integrity + FK clean, 15086 rows unchanged, all 857 tasks untouched, served
bundle `index-BAc54Zjy.js` carries the change, the Log and a schedule card opened read-only, no
console errors.
- "How did it go?" (Done - all good / Problem found / Partly done) on the Complete panel and the
  past-service-record form, stored in `task_completions.outcome` (the v32 column, first written
  now; immutable like every history fact).
- Problem found / Partly done opens a follow-on editor: each row becomes its own one-off
  break/fix task on the job's system/device (or another picked), optionally critical, created in
  the same transaction. One history entry -> MANY follow-ons; the new column
  `tasks.origin_completion_id` points each task back at the entry, so the append-only history
  is never edited. More can be raised later from the Log ("＋ Follow-on task…"), not from a
  voided entry; voiding keeps the tasks already raised.
- The Log badges the outcome and lists "↪ Follow-ons:" (open / ✅ / retired, each opens its
  task); a follow-on task shows "↩ Follow-on from <job> (<date>, problem found)" on its card and
  full record; the printable report badges the outcome and "N follow-on task(s), M open".
- A partial job still resets the task's schedule - the unfinished part is the follow-on.
- The v32 promise that the rest of #44 would be code-only was slightly optimistic: this needed
  one additive column (3NF, rather than task numbers stuffed into description text).

**2026-09-22 (late, deploy 9, schema v32 -> v33, live ~16:23) - invoices on file** (tracker
#44; design and reasoning in `design/INVOICE_DOCUMENTS_DESIGN.md` and
[Design-Decisions](Design-Decisions.md#invoices-are-documents), mechanics in
[Logic Flows](Logic-Flows.md#17-invoices-on-file-schema-v33)). Commit
`863570e`; tested first on a scratch copy of live (the migration's self-test, 26 API round-trip
checks each read back from the DB, GUI add / file / picker, no console errors), then deployed by
the full procedure (`scripts/oneoff/migrate_schema_v33.py`, additive, no rebuild; pre-deploy
backup `vessel_local.db.bak-predeploy-20260922-162201`, the migration's own `...-162251`).
Verified after: schema 33, 15068 rows unchanged, 17 history rows untouched, integrity + FK clean,
all endpoints 200 with real bodies, served bundle `index-BpW8qSam.js` carries the change.
- A `documents` row is the spine of one piece of paper: vendor, invoice number, date or the
  period it covers, the total ONCE, the file path on disk, project, a free-text expense class
  offered back from prior use, notes. Line items are not transcribed (the PDF is searchable).
- One invoice covers many jobs through `task_completions.document_id`. Filing is the one change
  the append-only history allows besides voiding (and the one-time `sent_at` stamp). A history
  entry carries its own `cost` OR an invoice, never both (triggers plus `data.py`).
- The Log tab gets a second view, "📄 Invoices on file": per-year, grouped by expense class with
  a subtotal each, add / edit / remove, a CSV per year, and "📄 File under invoice…" on each
  history entry. The past-service-record form can file under an invoice. The printable report
  lists invoices only behind the existing `?cost=1` opt-in.
- Wording is part of the feature: every figure is "invoices on file", never a year total or
  total spend - the card and bank statements are the authority, and the app gives no tax advice.

**2026-09-22 (afternoon, deploys 5-8, schema v29 -> v32, all live; code `ca5d053`)** -
tracker #66, #67 and the bulk of #44. Reasoning in Design Decisions (anchors below); mechanics
in [Logic Flows](Logic-Flows.md#13-the-maintenance-history-as-a-record-tracker-44) sections 13-16.
- **Deploy 5 (schema v30, `89f2703`) - #66 retire, don't delete, and #67 clone with rename.**
  `tasks.retired_at` takes a task off the schedule and out of pick lists while keeping its
  history thread; a hard delete is refused (409) once the task or any of its steps has history.
  The task screen's unlabelled Delete became a consolidated "Referenced by" panel (project,
  parent checklist, ALL inbound task links, each removable). "📋 Clone with rename" on the device
  screen copies a set-up device with independent task copies. See
  [Design-Decisions](Design-Decisions.md#retire-not-delete),
  [#referenced-by-panel](Design-Decisions.md#referenced-by-panel),
  [#clone-with-rename](Design-Decisions.md#clone-with-rename).
- **Deploy 6 (schema v31, `a4ee914`) - the #44 CARFAX slice.** `task_completions` rebuilt so
  `source` allows `'historical'`, plus `performed_by` / `vendor` / `cost`. The Log tab's
  "＋ Past service record" form backfills work the app never saw (reschedules nothing); the
  "🖨️ Printable report" (`GET /api/report/history[?system=|?device=][&cost=1]`) prints the
  history oldest-first with the letterhead, voided entries struck through, historical entries
  badged and a military DTG beside each date; cost and vendor only with `cost=1`. See
  [#historical-service-records](Design-Decisions.md#historical-service-records) and
  [#history-report](Design-Decisions.md#history-report).
- **Deploy 7 (schema v32, `97a176c`) - the rest of #44's schema in one additive migration**, so
  what remains ships code-only: device identity (`systems.installed_on` / `serial` /
  `warranty_until`, now on the device screen and the report header with an in/out-of-warranty
  phrase), `task_completions.outcome` / `evidence_path` / `event_kind` / `sent_at` (columns only,
  no feature yet), and the `crew_members` roster (seeded the owner + crew member). Same deploy fixed a
  production bug: the 22 devices with a slash in the name could not load parts, save, rename,
  move, delete or clone, because `{name}` routes fell through to the SPA catch-all (a 200 with
  index.html); every `/systems/{name}` route is now `{name:path}`. See
  [#remaining-44-schema-in-one-go](Design-Decisions.md#remaining-44-schema-in-one-go) and
  [#system-name-slash-routes](Design-Decisions.md#system-name-slash-routes).
- **Deploy 8 (code-only, `ca5d053`) - "who did the work" on every completion.** A shared
  `PerformedByField` on the Complete panel and the past-record form offers the crew roster UNION
  every name already in the history (free text still accepted); a checklist-link tick and a
  subtask closed alongside carry it too. A historical Log row now reads "(recorded from records)"
  instead of "(task since removed)". See
  [#performed-by-pick-list](Design-Decisions.md#performed-by-pick-list).

**2026-09-22 (evening, schema v28 -> v29, live)** - tracker #53/#54/#60/#61/#62/#63/#64, full
detail in `history/CHECKPOINT_ARCHIVE_2026-09-22_evening.md`:
- Recipe ingredient linking (#53/#54): `CookFlow`'s swap select and "+ Add another ingredient"
  extras can now create a new catalog item on the spot, matching the parse-review and
  link-or-add screens - no more "pick an existing item or give up."
- List alphabetization (#60): `data.list_items()` sorts `COLLATE NOCASE` - a lowercase-first name
  ("bacon", "half & half") no longer sorts after every uppercase-first name within a type; new
  items get their first letter capitalized on creation.
- Spares Fit Check gains a "Where" column and a by-container sort (#61) - walkable locker-by-locker,
  not only device-by-device.
- **"Work a Container"** - a new Warehouse tab: pick a container, tick items from the whole catalog,
  one commit stows them - no formal audit session needed, sped up the manual food/tool linking pass.
- **Tool accessory linking**, redesigned mid-build as many-to-many (schema v29,
  `tool_accessory_tools`) once a real shared-accessory case came up (same-size sanding discs across
  two tools) - see [Design-Decisions](Design-Decisions.md#accessory-tool-many-to-many). New
  "Accessories with no tool" Inventory Audit review, same pattern as "Parts with no device."
- **#62** - "unassigned" stock (nobody's picked a container yet) is now a real container, not a NULL
  `container_id` - the Count Stock walk needed zero code changes once that was true. See
  [Design-Decisions](Design-Decisions.md#unassigned-is-a-real-container).
- **#63** - the Locker table gets a container filter; "not in a container" is just picking the real
  Unassigned container, no special case.
- **#64** - ticking a task linked into a checklist now asks explicitly what spare was used, instead
  of always silently drawing nothing. See
  [Design-Decisions](Design-Decisions.md#checklist-link-consumption).

**2026-09-22 (midday, no schema change, live)** - three pieces, tracker #50-#65 (full detail in
`history/CHECKPOINT_ARCHIVE_2026-09-22.md`):
- Two device-screen bugs the owner reported as "indeterminate" errors turned out to be real, findable
  causes rather than flakiness: a rename to an already-used name raised an uncaught 500 instead of
  a clean message (#57), and the rename/move/delete error banner never cleared, so a stale error
  from one action bled into later unrelated saves on the same screen (#51).
- A combined navigation fix: `AppNav` gained a return trip so opening an item from a device's Parts
  list or the Restock List and pressing Back lands you back where you started, not always the
  Warehouse Locker list (#58/#59); the device screen gained an "Add Part" search-and-link picker and
  a system-scoped "+ New task" form (#52) - together these came out of the owner's #65 discussion question
  ("should anything with a Details screen be clickable?").
- **Device manual research** (#50) - point Claude at a device and its manual (by chat, or now via a
  `🔍 Research with Claude` button on every device screen) and get back a reviewable draft:
  make/model, maintenance tasks, spare parts, each cited to the manual page. Calibrated first on two
  real devices by chat (the Orion DC-DC converters, the Washing Machine), then built as a proper
  feature: a living instructions doc (`references/DEVICE_MANUAL_RESEARCH_INSTRUCTIONS.md`, tunable
  without a redeploy) driving a headless `claude -p` subprocess (mirrors ` "Research
  with Claude"), reviewed before anything is written - nothing auto-applies. See
  [Design-Decisions](Design-Decisions.md#device-manual-research-review-then-apply-never-auto-write).
  Two design questions raised here - a consolidated "referenced by" panel replacing the
  task screen's unlabeled Delete button (#66), and bulk-linking one spare across several
  near-identical devices via a "clone device with rename" (#67) - both shipped the same
  afternoon in deploy 5 (see above). #50 itself has still never been run end-to-end through the
  GUI, only by chat.

**2026-09-21 (small follow-ups, no schema change; live 17:16)** - system-screen part rows open the item in the Warehouse,
a shopping-list toggle on the item screen, a Protein control on meal-plan entries, and step parts/tools on the print card.

**2026-09-21 (Log tab filters, no schema change; live 17:16)** - the maintenance history can be filtered by period (recent window, one
year, all time), system and device (tracker #44's first roadmap item). The history roadmap listed then was performed-by crew,
outcome / follow-up task, evidence attachments, cost + vendor, "add a past service record" backfill, printable CARFAX-style
report, replay to the previous developer - as of 2026-09-22 the backfill, report, cost + vendor, performed-by and outcome / follow-up
task (v34) are live, and what is left is under "Open" below.

**2026-09-21 (evening, data only, live)** - the catalog pass from the Amazon / Gmail research (28 items, 9 devices incl. the two starter batteries, 11 device make/models, 4 wrong-model items staged for removal), the Captain's Locker follow-through (Papers & Registrations renewal reminders, Lifelines, First Aid & AED, Pre-Passage additions), and manufacturer-backed hydrolock cautions. Device make/models are what makes the Spares fit check useful; more are filled at the Inventory Audit walk.

**2026-09-21 (later; schema v27 -> v28, all live 14:27)** - the Audit
tab's "Spares fit check" (`item_fit_checks`): sweeps parts against the devices they serve, flags likely wrong-model buys,
records the nameplate check, keeps wrong-model stock out of spares and Restock and stages it for removal. Also live earlier
that day: the Captain's Locker material (hydrolock caution, Abandon Ship Procedure checklist, four briefing steps) and the
colour print letterhead. Next in this area: enter device make/model nameplates so the sweep has something to compare.

**2026-09-21 (schema unchanged at v27, all live)** - the `Checklists` housekeeping system is hidden from the Systems tree
and device pick lists (#31); the Restock List shows what each item serves and filters by system/device; the Inventory
Audit has a "Parts with no device" review (18 to link on first look). Alongside: a full Amazon 2023-2026 re-sweep, a first
Gmail sweep of non-Amazon boat purchases, and an evaluation of the Captain's Locker material - findings are in
`references/` and `design/`, and no catalog data was changed by them.

**2026-09-20 (schema v26 -> v27, all live)** - from the owner's tire-kicking on a tablet, each verified on a scratch
copy first: tap-safe in-app confirm on every delete and moving a container between locations (#45/#46);
zero-quantity stock rows as "where it lives" with Receive placing stock by the item's own containers, and mixed
expiry dates (#47); linking a task into checklists from the task itself, and linked tasks as inline lines with
per-run ticks (#48, v27); print-on-demand checklist sheets with the bow-art letterhead (#49); a "Details"
screen on every checklist line with editable parts/tools, cockpit read-only (#28). Decisions and mechanics:
Design Decisions (`#tap-safe-confirm`, `#task-in-checklists`, `#print-on-demand`, `#step-details`) and Logic
Flows sections 11-12; the log is `history/CHECKPOINT_ARCHIVE_2026-09-20.md`. Open items live in `CHECKPOINT.md`.

**2026-09-19 (schema v22 -> v26, all live):** system > device > parts and the Spare unit
type; project phases; food provisioning modes and bulk-on-the-item; a recipe ingredient
parse that asks about uncertain matches; the pantry check ("we need more" requests),
the standing pantry-check recipe, cart add box and receive-time new items; old bad
recipe links corrected; the bug pass (#29, #34/#35, #38); and the **completion audit trail /
maintenance history (v26)** - append-only, void-with-reason, lateness, notes and spares used, Log tab.
See the tracker (#1-#44) in `history/CHECKPOINT_ARCHIVE_2026-09-19.md` and Design Decisions.
Open items now live only in `CHECKPOINT.md` (navigation #32/#36/#37, #23, #25/#26, #39, the
Critical-horizon question, the maintenance-history roadmap #44).

**All 8 phases of the original rewrite plan**, plus 11 rounds of the owner's live
trial feedback, plus a first live-usage round from crew member:

- FastAPI backend (57+ endpoints across 10 routers), React frontend (Vite +
  TypeScript + React Query).
- Schedule board (8-bucket, timeframe tabs, expand-to-detail, inline
  record editing, item-consumption picker on Complete).
- Unified Task + Checklist Management (search/filter, inline edit, step
  reorder, run-checklist screen, checklist-includes-checklist, task
  cross-references).
- Projects (send-out queue, task placement across standalone/project/
  checklist, per-task phase tagging).
- Warehouse (Locker with real columns, Add New Stuff, Restock List, Storage
  structure with nested containers, full Inventory Audit walk) — maintenance
  supply only as of 2026-09-17, see below.
- Recipes + Provisioning (recipe book, structured ingredient parsing +
  stock consumption, shopping list, aisle order, crew/weeks prefs) — moved
  under the separate Galley tab as of 2026-09-17, see below.
- Telemetry header widget (fuel/water %, engine/genset hours — first time
  shown in either UI version).
- Layup Return bulk-defer tool, plus the **Layup Prep + Return-to-
  Service/Wake-Up checklists** (2026-09-17) that walk the physical
  shutdown/reactivation sequence it doesn't cover, hard-vs-water aware
  via `checklist_group`. See
  [Logic Flows](Logic-Flows.md#8-layup-return-bulk-defer--the-layupwake-up-checklists)
  and [Design-Decisions](Design-Decisions.md#hard-vs-water-layup-checklistgroup-not-two-parallel-checklists).
- Cockpit/deck route (`/cockpit`) — Watch Handover, Sail Plan, Incident Log,
  Checklists, scaffolded and verified live.
- Schema evolved v11 → v21: item_type/stocking_policy as data, task
  cross-references, governed systems picklist, structured recipe
  ingredients, meal plan, compartments, per-compartment location names, the governed `units` picklist (v21).
- **Go-live**: the FastAPI+React app is the daily-use production app
  (`run-live.bat`, port 8000); Streamlit (port 8601) is no longer launched
  by default but still runs if needed.
- Recipe/food data-quality pass: 19 merged "collection" recipes split into
  207 individual recipes, duplicate-catalog-item creation bug fixed at the
  root, weight/count unit mismatches fixed for the items that hit it.
- **Meal plan** (schema v16, 2026-09-17) — the long-deferred "recipe →
  meal-plan → shopping-list" feature: pick recipes onto a working list (a
  "+ Add to meal plan" button on each Recipe Book card), a new "📅 Meal
  Plan" tab aggregates the picked recipes' direct-consumption ingredients
  into one shortfall shopping list across the whole plan, and each entry
  marks "✅ Made it" (draws stock via the existing `make_recipe()`) or
  "✕ Remove from plan" (cancelled, no stock effect) — either way the entry
  then drops off the list, since the plan itself is a working list, not a
  log (see [Schema](Schema.md#8-recipes--galley)).
- **Swappable-protein base recipes + saved plan overrides** (schema v17,
  2026-09-17) — Chef's Salad/Mac & Cheese-style recipes stay one recipe
  regardless of which protein got used: a per-cook item swap on any
  ingredient line, plus a "+ Add another ingredient" ad-hoc extra, both in
  the Recipe Book's cook checklist and the Meal Plan entry card. A "💾 Save
  picks" action on a plan entry persists the current swap/extras (no stock
  drawn) so the aggregated shopping list reflects what's actually planned,
  not just the recipe's bare defaults — "Made it" pre-fills from the same
  saved picks. See [Schema](Schema.md#8-recipes--galley) and
  [Design-Decisions](Design-Decisions.md#swappable-protein-base-recipes-plan-time-vs-cook-time).
- **Receive + expired clean-out + favorite containers** (schema v18,
  2026-09-17) — closed the shopping-list-to-inventory gap the owner flagged:
  a "🧺 Receive" action on every shopping-list row (Restock List, Galley
  Provisioning) adds real stock in place, no more hunting each item down
  in the Locker one at a time. Expired-stock removal got the same
  treatment as two separate screens (food in Galley Provisioning,
  spares/safety-gear in a new Warehouse "⏳ Expiry / Inspection Due" tab)
  sharing one `ExpiringStockTable.tsx` component and a real
  `reason='expire'` audit-trail fix (was mislabeled `manual_adjust`). A
  new per-container ⭐ favorite flag surfaces a short pick list first in
  every container picker instead of the full ~100-location list. Full
  reasoning in
  [Design-Decisions](Design-Decisions.md#closing-the-shopping-list-to-inventory-loop-receive--two-separate-clean-out-workflows)
  and
  [Design-Decisions](Design-Decisions.md#favorite-containers-not-a-hardcoded-food-storage-category).
- **Merged food cart** (2026-09-17, later same day) — `data.food_cart()`
  combines the baseline provisioning heuristic and the meal-plan's
  recipe-driven need into one shopping list per food item (`MAX`, not
  additive), replacing two previously-separate, unreconciled lists.
  Galley Provisioning's shopping table gained a "From plan" column and an
  expiring-soon flag; the Meal Plan tab's own shopping-list section was
  removed (redundant with the merge) in favor of a one-line pointer to
  the Provisioning tab. The Restock List ("stuff cart") gained the same
  kind of expiring-flag column, cross-referenced client-side rather than
  merged (no second heuristic to reconcile there). See
  [Logic Flows](Logic-Flows.md#9-the-merged-food-cart-datafood_cart) and
  [Design-Decisions](Design-Decisions.md#two-shopping-carts-merged-food-need-not-four-fragmented-lists).
- **Galley split into its own top-level nav tab** (2026-09-17, GUI-only) —
  Galley Provisioning/Recipe Book/Meal Plan moved from Warehouse sub-tabs
  into a new top-level "🍽️ Galley" tab; Warehouse is now exclusively
  maintenance supply. No schema/backend change — storage locations/
  containers stay shared. See
  [Design-Decisions](Design-Decisions.md#galley-split-into-its-own-top-level-nav-tab-not-a-warehouse-sub-tab).
- **Owner-Wise family recipe import bug fixed** (2026-09-17) — the
  original docx import silently dropped every Word table, losing
  ingredients on 29 of 35 recipes in that source file (26 fixed in place,
  3 recreated from scratch). See
  [Logic Flows](Logic-Flows.md#4-recipe-ingredient-parsing-and-consumption-schema-v15).
- **Meal Plan now shows the full recipe text**, not just the ingredient
  checklist (2026-09-17). See
  [Design-Decisions](Design-Decisions.md#the-meal-plan-is-a-working-list-not-a-log).

- **Storage tree cleanup + vocabulary** (2026-09-18, schema v20): location
  delete (guarded, never orphans stock), new locations auto-get a `loose`
  container, compartment prefix stripped from location names, Galley's
  containers promoted to locations, every "where is it" label is now
  `Compartment › Location › Container`. See
  [Design-Decisions](Design-Decisions.md#compartment-location-container).
- **Projects tab fixes** (2026-09-18): a task opens full-screen for editing
  (it had no editor), the new-task form validates and saves details with the
  governed system picker, and "add existing tasks" is a search-first task
  list (it used to open on a system dropdown).
- **Systems cleanup** (2026-09-18): punch-list and checklist names are no
  longer systems. See
  [Design-Decisions](Design-Decisions.md#punch-list-is-a-project-and-a-checklist-is-not-a-system).

- **Plumbing pass** (2026-09-18): the layup "close the thru-hulls" step is now
  9 checkable seacock steps (4 inlets + 5 outlets, with the A/C exceptions)
  plus a verify step, the Wake-Up checklist has the mirror reopen steps,
  Thru Hulls carries the full penetration inventory (scuppers stay open, DST
  is pull-and-plug, keel coolers permanent), plumbing systems are organised by
  fluid (Raw Water, Bilge & Drains), and the legacy-scupper replacement is a
  Next Haulout task. See [Design-Decisions](Design-Decisions.md#punch-list-is-a-project-and-a-checklist-is-not-a-system).

- **Pump attribution + naming** (2026-09-18): the Gulper models were corrected
  (BP1554 = the bow and E/R bilge pair, BP2054 = the shower sump pump,
  BP2554B x2 = black water), the bilge-worded float-switch and strainer tasks
  moved to the bilge pair, and the pump devices are named by function
  (Bow & E/R Bilge Pumps, Shower Sump Pump, Salon/Crash Bilge Pump, Black Water
  Pumps) with model numbers kept in catalog items and device notes. Toolkits
  decided: the kit is one item.

- **Universal function naming** (2026-09-18): all devices are named by function
  (30 renamed; "Make / model" kept in notes), pump models added as `owned`
  catalog items, System/Device vocabulary adopted, shower sump pump given its
  strainer and manual-switch tasks. See
  [Design-Decisions](Design-Decisions.md#devices-named-by-function).

Full narrative history (what was built in what order, and why) lives in
`history/CHECKPOINT_ARCHIVE_2026-09-19.md` (grep it, do not read it whole); this page tracks *current* status, not the play-by-play.

- **2026-09-19 deploys** (live at schema v22): the owner's container-assignment feedback. Locker: rename an item, change its type (with a warning before per-type details are dropped), Save returns to the list, select-many + "No stock recorded yet" filter + assign to a container (`POST /api/items/stow`), several stock rows when adding an item; the Inventory Audit's one-at-a-time dropdown became a tick-list; the threshold fields are labelled in workflow terms (`ThresholdFields.tsx`) and the Restock List marks never-stocked items "not yet located"; systems are only ever picked, never typed (nesting/moving by pick list, one-level tree enforced server-side); the Schedule's `checklists` bucket is labelled "As-used"; compartments sort A-Z. **Schema v22** = system > device > parts: devices are buckets in the systems tree, parts/spare units link to them (`item_systems`), see [Design Decisions](Design-Decisions.md#devices-parts-spare-units).
- **Open after 2026-09-19:** (1) the rest of the device screens (device details are now editable on the SystemScreen, see [one navigation model](Design-Decisions.md#one-navigation-model)) - (the Restock List "Serves" column and device filter, and the Audit "Parts with no device" review, shipped 2026-09-21; a review of *devices* with no part is still open); move `part_details.fits_system` text into notes and drop the column. (2) Merge the installed-model items (#450-455) into device make/model. (3) The automated new-device research pipeline (draft -> review -> apply, shared runner with routing's Research-with-Claude) - deferred by the owner to 2026-09-21. (4) `installed_qty` duplicates the "(N)" in some names.
- **2026-09-18 deploy** (live at schema v21): the **focus-screen retrofit**
  (project, recipe, meal-plan, locker and schedule screens on the shared
  `components/FocusScreen.tsx`; the Recipe/Meal Plan cook flows merged into one
  `CookFlow`; the Schedule card's duplicate editor replaced by "Open full
  record"), the **units picklist** (imperial, legacy `kg`/`L`, `UnitPicker`,
  cook-screen mismatch warnings, bulk-line flags, cook results in the item's
  unit), and **metric input** (ingredient-parse conversion + recipe body
  "Convert to imperial"). See
  [Logic Flows](Logic-Flows.md#10-units-the-cook-screen-and-metric-conversion-schema-v21)
  and [Design-Decisions](Design-Decisions.md#units-are-a-governed-picklist).

## Open / not yet done

Roughly in priority order as of this writing — not a commitment, just where
things stand (the authoritative short list is `CHECKPOINT.md`'s Open items):

- **Hardening phases 3-5** (`design/ARCH_HARDENING_PLAN.md`, approved 2026-09-24; **phase 2, the startup
  migration runner, is DONE** - live since v37, 2026-10-05): 3 drop pandas/numpy from the
  server + delete the Streamlit app, 4 typed request bodies + generated TS types, 5 split `data.py`
  into a package. Proposed to fold in (same class of debt): `run-live.bat` must stop when the
  frontend build fails (today it starts on a stale `dist`); `data.py` update functions reject
  unknown fields instead of ignoring them (with phase 4); validate `tasks.interval_type`.
- **DONE 2026-10-07 (live since the 21:28 restart; tests `tests/test_fixes_20261007.py`) - found in the 2026-10-07
  wiki pass (small, code):** `GET /api/recipes` declares its `ingredients` /
  `methods` / `tags` filters as BODY parameters (FastAPI's default for a bare list), so they cannot be used
  from a browser - add `Query()` (only `search` is used today); `data.delete_system` reassigns tasks but not
  logbook entries, so deleting a system / device named by a log entry fails with a raw foreign-key error -
  refuse it in plain words (or reassign) like the other delete blockers [both fixed: `Query()` declared; `delete_system` answers 409]; `logbook_stamps` column order differs
  between a fresh v39 install and a migrated one (harmless, named columns - left as is).
- **Maintenance history (tracker #44), what is left** — replay to the previous developer (`sent_at`, code-only,
  blocked on his endpoint - see `VESSEL_LOG_WRITEBACK.md` below). Outcome / follow-ons (v34) and
  `event_kind` / `evidence_path` (deploy 15) have shipped.
- **Release package follow-ups** — the Mac `.command` launchers have not been run on a Mac;
  `schedule_from` is set only by the starter-pack loader (no GUI). **Upgrade path:** the migration
  runner (v37+) now runs at server start, so an install upgrades itself - BUT (found 2026-10-07)
  **[FIXED 2026-10-07: `migrations/` added to `build_release.py` v3, `Dockerfile` v2 and `.dockerignore` v2; CI green
  again by the 10-09 pushes. STILL OPEN: rebuild the release zip as v0.1.2 before anyone sends one - v0.1.1 predates
  the fix.]** Original finding: neither `scripts/release/build_release.py` (its `ALLOW_DIRS`) nor the `Dockerfile` copies the
  `migrations/` package**, while `db_schema.ensure_current()` imports it at start: a release zip or a
  Docker image built from the current code would fail to start (ImportError). Add `migrations` to both
  (and to `.dockerignore`'s allowlist) before the next release or image build; the CI image job on a
  v37+ branch shows it: **CI has failed on every push since 2026-10-05 ~15:28 (deploy 24)** - the image job's container exits with `ModuleNotFoundError: No module named 'migrations'` (run 37409678692). Also: a friend still on v0.1.x (schema v36) upgrades through the runner
  from its v36 baseline - test that path on a v0.1.1 database.
- **Enter the real history** — well under way (see `CHECKPOINT.md` for current counts): the
  Gulf Solutions invoices, and the Electrical + Solar pages of the owner's build log (72 entries,
  applied 2026-09-22). Next: the remaining build-log pages, Repower/Generator/Running Gear first
  (it holds the hydrolock diagnosis the July starter entries point at), then Plumbing, Hull,
  Rigging, Automation, Interior and the rest - same Q&A -> script shape
  ([Design-Decisions](Design-Decisions.md#build-log-backfill)). The Seabrook refit and Sailing
  Services rig work are still only on paper.
- **Index the refit paper as invoices** (v33 is live; the Gulf Solutions set and the Solid State
  Marine estimate are on file so far) — the ~40 PDFs under
  `Refit/your vessel/` plus `Papers of Record/`, drafted by Claude from the PDFs for the owner to check,
  not keyed by the owner. Not the Amazon orders (already in `references/AMAZON_PARTS.md`). The Gulf
  Solutions verdicts (which invoices are real vs sunk, and which get NO device link) are already
  worked out in `design/INVOICE_DOCUMENTS_DESIGN.md`.
- **#50 device manual research, first real GUI run** — the "🔍 Research with Claude" button has
  never been run end-to-end (manual read -> JSON draft -> apply); only chat-driven research has.
  The server must be started outside a Claude session to see the OAuth token. The budget cap
  (`DEFAULT_MAX_BUDGET_USD = 2.0`) is a guess until a real run gives cost data.
- **First real retire / clone on live** — nothing is retired yet and no device has been cloned
  on live (both were exercised on a scratch copy); the first use is the owner's.
- **Cockpit open items** — device-to-position assignment, PWA install
  polish (the WX line is real since 2026-10-04), the re-homed but
  unbuilt Watch Log feature, and more — see
  [Cockpit / Deck GUI](Cockpit-GUI.md#explicitly-open) for the full list.
- **Top-level module launcher** (flagged by the owner 2026-09-17, not started) —
  now that `/`, `/cockpit`, and `/routing` all share one origin (see
  [Architecture](Architecture.md#process-layout) and
  [Design-Decisions](Design-Decisions.md#routing-reverse-proxied-not-merged)),
  a small landing page linking to each module would save typing/remembering
  the three paths. No design work done yet - likely just a static page,
  doesn't need its own backend route.
- **Plumbing follow-ups** — the owner will update the DST-plug and spare-pump
  storage locations himself. The shower sump pump's two new tasks (inlet
  strainer 90 days, manual-switch check 180 days) are my wording and my
  intervals - review them.
- **Inline-expand screens vs. the focus-screen convention** — DONE and
  deployed 2026-09-18. Left inline on purpose: the Storage Structure tree,
  Receive, telemetry. See
  [Design-Decisions](Design-Decisions.md#focus-screens-not-inline).
- **Fluids pass** — DONE 2026-09-18 (live): fluid items in `gal`, real
  per-service fills from the manuals (`references/FLUID_CAPACITIES.md`), the
  gear-oil item merged into engine oil (both motors and the gearbox take the
  same oil), a separate generator coolant item, coolant at one full refill per
  motor, oil and filters for three changes. **Still open**: fluids with no
  manual on disk (backstay/vang hydraulic, watermaker glycol and pump oil,
  solvents) keep placeholder draws; solvents are still in `qt`; fluid stock
  counts wait for the Inventory Audit walk. See
  [Design-Decisions](Design-Decisions.md#fluids-stocking-and-capacities).
- **Legacy metric units** — eight items still carry `kg`/`L` (Flour, Ground
  beef, Oatmeal, Rice, Salt, Sugar; Olive oil, UHT milk; the ninth, KM4A2
  gear oil, was merged into engine oil) until converted; the crew's call for
  the galley ones. Then delete the two legacy
  unit rows.
- **Retired Streamlit UI** still has free-text unit inputs
  (`inventory_view_add.py`, `schedule_modules.py`); typing a unit not in
  `units` there now raises. Left alone (the app is retired, not deleted).
- **Unit conversion (cup <-> weight)** — explicitly deferred; would build on
  `units.dimension` plus a per-item density. Draws are not converted today.
- **Fuzzy-match quality for recipe ingredients** — the top-3→top-5 +
  full-catalog-fallback change is a workaround, not a fix to the underlying
  ranking (e.g. "peanut butter" can still rank below plain "Butter"). Not
  scheduled unless it comes up as a live complaint again.
- **`VESSEL_LOG_WRITEBACK.md`** — spec sent to the previous developer 2026-09-16, still no
  response as of 2026-09-22. Six open questions at the bottom of that doc (endpoint shape,
  auth, whether next-due is computed his side, system-tag mapping,
  expected volume, the break-fix/failure-entry gap). The webhook code
  itself (`vessel_log.py`) ships disabled until this resolves. The replay
  column `task_completions.sent_at` already exists (schema v32, with its own
  NULL -> once transition in the append-only trigger), so the replay is code-only
  once he has an endpoint.
- **`sail_config.py` payload shape** — explicitly provisional pending
  the previous developer confirming sails+reef-points is sufficient input for his side.
- **Streamlit formal retirement** — **approved by the owner 2026-09-24**; done as part of phase 3
  of `design/ARCH_HARDENING_PLAN.md` (it consumes the pandas DataFrames that phase removes).
  Until then `app.py` stays in place, unlaunched (its launcher `run-multiuser.bat` was removed 2026-10-07).
- **Docker on the Pi — MOOT since the 2026-10-06 cut-over (D-105: nothing of the previous developer's runs in our stack; kept as a
  record).** Whether mx-inv later moves into a container on our Pi is (ASSUMED - ask the owner). It superseded the old provisional Docker / TLS-cert
  idea (see
  [Design Decisions](Design-Decisions.md#docker--tls-provisional-never-finished)).
  `design/DOCKER_DEPLOYMENT_SPEC.md` is at **v5** (2026-09-24, answering the previous developer's reply to v4);
  the image, backup job and CI are built and green, nothing is deployed. Still open with him:
  spec v5 section 1 (CAMS BOM + router, Grafana logbook tiles, sail plan source, registry,
  manuals-RAG votes, Ansible PR review, Tailscale, spare admin credential). Target = `your-pi-hostname`
  (his Pi), the NAS is ruled out, the laptop keeps hosting until the owner is aboard.
- **Auth** — genuinely undecided (not deferred-and-forgotten, actually
  open) now that this is a real HTTP API with wide-open CORS rather than a
  Streamlit page. See
  [Design Decisions](Design-Decisions.md#no-auth).
- **Ship's PC migration** — planned, straightforward (copy the DB + tree),
  blocked purely on physical presence aboard to Tailscale-join the Ship's
  PC.
- **`storage_containers.container_type` / `tasks.checklist_group` as
  lookup tables** — currently raw `CHECK`-enum/free-text, unlike
  `item_types`/`stocking_policies`/`compartments` which were promoted to
  real lookup tables specifically to avoid this inconsistency (see
  [Design-Decisions](Design-Decisions.md#3nf-as-a-standing-constraint-not-a-one-off-cleanup)).
  Not a normalization violation, just a pattern inconsistency — the owner's
  call whether either vocabulary changes often enough to be worth it.
- **~40 loose top-level reference `.pptx`/`.docx`/`.pdf` files** in
  `D:\Documents\sailboat\` — lower-priority housekeeping, not this app's
  code, flagged in the `sailboat-directory-reorg` project memory.

## Explicitly decided NOT to build (don't re-propose without new information)

- A general weight↔count unit-conversion layer for recipe consumption —
  fixed per-item instead (see
  [Logic Flows](Logic-Flows.md#4-recipe-ingredient-parsing-and-consumption-schema-v15)).
  Revisit only if a third mismatched item surfaces.
- A `tasks` row per recipe cook — deliberately bypassed in favor of a
  direct `stock_movements` write (see
  [Design Decisions](Design-Decisions.md#recipe-consumption-bypasses-the-tasks-table-entirely)).
- A dedicated "finish project" workflow/event — projects are just a
  grouping bucket by design; individual task completions carry the project
  tag instead.
- The send-out queue as a standalone always-visible card on the Projects
  view — removed 2026-09-16 at the owner's request once it duplicated what the
  one real `service_period` project's own row already showed. The
  underlying `all_projected` data field was deliberately left in place
  (cheap to keep, could matter again if a second `service_period` project
  appears).
- Task dependencies, durations, critical path or Gantt charts for projects (the owner, 2026-09-19: a formal project-management tool would do that job). Projects get per-project ordered phases only - see [Design Decisions](Design-Decisions.md#project-phases).
- A stored sentinel for "no standing stock" (a zero provision quantity): zero already means none on hand, so the decision is an explicit `provision_mode` - see [Design Decisions](Design-Decisions.md#bulk-and-provisioning-modes).
- A third-party migration framework (Alembic or similar). **Superseded 2026-09-24:** the
  Pi/Docker image and the release package's friend upgrades both need migrations to run
  without Claude at the keyboard, so phase 2 of `design/ARCH_HARDENING_PLAN.md` adds a small
  in-house runner (startup, verified backup first, baseline v36). Still no Alembic.

## Maintaining this wiki

Per the owner's direction (2026-09-17): this wiki's upkeep becomes part of the
standard end-of-chat checkpoint/memory routine going forward, same as
`CHECKPOINT.md` and the Claude memory files. Concretely, at the end of a
session that changed the app in a way covered by one of these pages:

1. Update the relevant page(s) directly — don't just append a dated note;
   fold the change into the existing narrative, and keep these pages
   **current-state-first** (this wiki is the "what is true right now"
   reference; `CHECKPOINT.md` is the short start-here file and is *replaced*,
   not appended to, at each archive point; the old play-by-play is in
   `history/`).
2. Move anything that just became done from "Open" to "Done" above, and add
   anything newly decided to [Design Decisions](Design-Decisions.md) if
   it's the kind of choice a future session might otherwise re-litigate.
3. Once pushed to GitHub (this wiki lives in `wiki/` inside the
   `mx-inv-webapp` branch, alongside the code, not as a separate GitHub
   Wiki repo), a stale page is a bug the same way stale code is — treat
   drift here as seriously as drift in `CHECKPOINT.md`.
