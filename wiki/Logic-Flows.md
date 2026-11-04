<!--
Purpose: The non-obvious business logic of the mx-inv app - the rules a reader cannot get from table names alone.
Version: v7 (2026-10-08) - v7: review-batch (schema v39) merged + LIVE 2026-10-08. v6 (2026-10-07) - v6: section 21 added (the logbook / ship's log v37-v39: one-transaction writes, best-effort stamps, the handover change report by write order, the automatic deck log, engine events, passages, printouts, v39 signed entries / watchkeeper / engine hours); section 6 retitled (sail_config.py is gone; Break / Incident writes the logbook). v5 (2026-10-05) - v5: cockpit Sail Plan -> our SignalK `sails.activeSet` (HB-09); the previous developer's sail-config webhook retired. v4 (2026-09-24) - v4: deploy 20 / schema v36 - section 1's never-done rule now points at data.task_baseline_date and the never_done flag; hrs tasks default to the engine meter; section 5 telemetry is opt-in by env (telemetry_sync v2, no longer 'unmodified'); section 6 notes is_enabled() and the hidden cockpit tiles; section 20 added (never-done baseline, schedule_from, 'not done yet'). v3: section 13's "nothing writes event_kind / evidence_path" corrected (deploy 15); section 19 added - defer from today, add as a step, follow-on urgency, save back to a recipe (#68-#71). v2 (2026-09-22) - v2: section 18 added - task outcome + follow-on tasks (schema v34, live as deploy 10); section 13's "nothing writes outcome yet" and its report bullet brought current. v1: header added; sections 13-17 added: the maintenance history as a record, retire vs delete, clone a device, the performed-by pick list, invoices on file (schema v33, live 2026-09-22).
Scope: PRODUCTION - engineering wiki page, pushed with the code.
Architecture: mx-inv wiki (wiki/Home.md is the index). Mechanics here; the WHY lives in Design-Decisions.md, the tables in Schema.md.
Invocation: n/a (reference doc).
-->
# Logic Flows

The non-obvious business logic — the parts a new reader can't get just from
reading table names.

## 1. The schedule projection (`backend/scheduling.py`)

This is the single most important piece of logic in the app: it turns every
task's raw schedule fields into "what bucket does this belong in, right
now." It is **server-side only, by design** — the React frontend never
reimplements due-date math in JS; it just renders whatever
`GET /api/schedule` returns. It's a direct, verbatim port of the old
Streamlit `app.py`'s projection loop (kept deliberately in sync with that
module until Streamlit is fully retired).

### Per-task projection (`_project_row`)

Every active task's `interval_type` decides which of four branches computes
its due date:

- **`break_fix`** — not calendar-driven at all. `period` text is pattern
  matched (`"immediate"` → `days_remaining=-5`, "DROP EVERYTHING";
  `"urgent"` → `1`, "Action Urgent"; anything else → `14`, "Routine
  Repair"). Deferral doesn't apply (`deferred=0` unconditionally).
- **`days`** — the common case. `next_due = baseline + period
  days + deferred_units days`. `days_remaining = next_due - today`. The
  baseline is `data.task_baseline_date(...)`: `last_completed_date`, else
  `schedule_from` (v36), else today - 90 days (the original "assume it's a bit
  overdue, not brand new" default). A task on either fallback is `never_done` -
  see [section 20](#20-never-done-baseline-schema-v36).
- **`hrs`** — engine/genset-hours-driven (`_project_hours`). Needs a
  `hours_meter` (`engine`/`genset`; since deploy 20 an `hrs` task created or
  edited without one gets 'engine', `data._resolve_hours_meter`, and TaskDetail
  shows an "Hour meter" select labelled from Settings) and a `hours_at_completion` baseline; a
  task with no baseline yet returns a special sentinel
  (`days_remaining=7777`, "⚙️ set a service baseline…") that keeps it out
  of Overdue while still flagging it. Otherwise:
  `hours_left = period − (hours_now − hours_at_completion) + deferred_hours`,
  converted to an estimated day count via the configured hours-per-year
  rate. **`deferred_units` on an `hrs` task holds hours, not days** — this
  was a real bug (fixed in commit `d6045b8`, folded into this port from day
  one): the old code discarded the deferred amount entirely for hours-type
  tasks instead of adding it to the budget.
- **anything else** (`use`) — `days_remaining=9999`, "Event Driven". These
  are consumption-triggered, not date-triggered (see the Checklists bucket
  below).

### Bucketing (`schedule_snapshot`)

1. **Telemetry refresh** — best-effort: if `data.telemetry_should_sync()`
   says it's due, run `telemetry_sync.sync()` inline before projecting.
   Wrapped in a bare `except: pass` — telemetry is never allowed to block
   the schedule from loading.
2. **Parked tasks drop out** — any task whose `project_id` points at a
   `planned` or `cancelled` project is excluded from every bucket (but kept
   in `all_projected`, unfiltered, for views like the Projects send-out
   queue that need a due date for parked work too).
3. **Subtasks drop out** — any task with a non-null `parent_task_id`
   (checklist steps, project sub-tasks) never appears on the top-level
   board; they're reached through their parent instead.
4. **Completed break/fix tasks move to `history`**, not `active` — a
   break/fix task with a `last_completed_date` set is done, not part of the
   rolling schedule.
5. **Eight buckets**, computed from `active`:
   - `critical` — the `is_critical=1` tasks (the flag means safety /
     float-the-boat / finish-the-passage) that are **overdue right now**: the
     flagged subset of `overdue`, most overdue first. the owner, 2026-09-19: "a
     critical overdue task is one that really needs to get done now, not a
     routine task that is just languishing." **Changed from** "every flagged
     task overdue or due within 92 days" (107 rows, 10 of them overdue), which
     buried the urgent ones and made a just-completed flagged task reappear
     with its next due date. A flagged `use` (as-used) task has no due date to
     be overdue against, so it is not in Critical any more (it stays on the
     As-used tab). Flagged tasks that are not yet due are on their normal
     calendar tabs. (Earlier history: 2026-09-16 the naive port's "critical
     `use` task stays here forever" was fixed to clear on completion; that
     clause is now moot.)
   - `overdue` — `days`/`break_fix`/`hrs` tasks with `days_remaining < 0`.
   - `today` / `week` (1–7d) / `month` (8–31d) / `quarter` (32–92d) — the
     calendar-driven buckets, from `days`/`break_fix` tasks only.
   - `hours` — every active `hrs`-type task (own bucket, not folded into
     the day-count buckets, since "days remaining" there is an estimate,
     not a hard date).
   - `checklists` — every active `use`-type task. Despite the bucket's UI
     name, this is really "consumption-triggered work," and checklists
     happen to be the main example.
   - `history` — completed break/fix tasks (separate from the eight named
     buckets above).
6. **Sort order**: within every bucket, critical tasks sort first, then by
   soonest/most-overdue `days_remaining` — replacing what used to be
   arbitrary DB insertion order, per the owner's 2026-09-16 ask ("some
   combination of critical and due age").

A task past the 92-day quarter horizon simply has nothing to show on any
bucket until it enters one — confirmed with the owner as expected behavior, not a
gap to fix.

## 2. Tasks + Checklists, unified

There is no separate "checklist" entity — see
[Schema](Schema.md#4-tasks-defined-in-db_schemapys-_init_fresh-not-the-ddl-tuples).
The consequence for logic: every operation that mutates a task (complete,
defer, edit) works identically whether the row is a top-level task, a
checklist "container" row, or a checklist step. What differs is purely UI
composition — `ChecklistSteps.tsx` is the one component that renders an
ordered, tickable step list, and it's reused unmodified across the schedule
board's expanded task cards, Management, Projects' task list, and the
dedicated **Run a Checklist** screen. The "parent shows its children on
expand" pattern (schedule tasks → their item checklist, checklists → their
steps, projects → their tasks, storage locations → their containers) is a
UI convention applied consistently across the app, not a schema mechanism —
worth checking for the same shape if a new area of the app ever has a
flat-list-with-no-detail feel.

**Move vs. link** when pulling an existing task into a checklist: "move"
reparents the existing row (`parent_task_id` updated in place, the task's
own periodic schedule stops running independently); "link as step" adds a
`task_references(kind='task')` row instead — the one master task, never a
copy. **There is no "duplicate" option in this picker as of 2026-09-17**
(see [Design-Decisions](Design-Decisions.md#link-dont-duplicate-one-master-record-per-task-always) —
`data.duplicate_task_as_step` still exists as a backend primitive, unused,
not wired to any UI button; checked against the live DB before removing
it from the UI and confirmed it had never actually been used, zero
duplicate `task_name`s anywhere).

**"Finish run"** (the Run a Checklist screen) is one action that used to be
two manual clicks (Complete, then Reset) — completes the checklist,
force-closes every step, and resets it for the next run, all server-side in
one call. **`reset_checklist()` recurses into anything the checklist
includes** (below), not just its own direct steps, with a visited-set
guard against a reference cycle — fixed 2026-09-17 after a real bug
surfaced: finishing an outer checklist left an *included* one marked done
and un-reset, since the reset previously only walked `parent_task_id`
children.

**Checklists including other checklists**, and **recurring tasks that
trigger a checklist run**, both reuse the `task_references` `kind='task'`
mechanism (see [Schema](Schema.md#4-tasks)) — an included checklist renders
inline (its real, live steps, not a copy) rather than being duplicated into
the parent. This only fires for a reference attached to the including
checklist's own **root** task, pointing at another `task_kind='checklist'`
row — a reference on an individual *step* (or pointing at a plain
one-off/recurring task) doesn't get this inline-expand treatment. Plain
task references instead render via a separate `LinkedTasks` list (checkbox
reflects and writes the linked master task's own real completion state) —
added 2026-09-17 once the two rendering paths existed to fully close the
"a reference exists but nothing on screen shows it" gap.

## 3. Item consumption on task completion

Completing a task can optionally draw down real stock: the expanded task
card's item-checklist shows each `task_items` row's on-hand quantity vs.
required quantity (via the `v_task_item_demand` view), and completing with
items checked writes `stock_movements` rows (`reason='task_consume'`) that
decrement `stock.quantity`. This closed what was, for a long stretch of the
rewrite, the single most-flagged functional gap — Complete used to always
complete "as of today with nothing consumed."

## 4. Recipe ingredient parsing and consumption (schema v15)

**Parse once, reuse forever.** The first time a recipe is opened for
cooking, `data.parse_recipe_ingredients` runs a regex-based line/quantity/
unit extractor over the recipe's free-text body, then fuzzy-matches
(`difflib`, cutoff 0.4, top-5 candidates) each parsed line against the food
catalog. A human reviews the matches once (`RecipeIngredients.tsx`) — the
dropdown offers the fuzzy top-5 as "Suggested" plus the *entire* food
catalog as a fallback group, because the fuzzy matcher's raw quality is
mediocre (e.g. "peanut butter" can rank plain "Butter" above "Peanut
butter") and a human always needs an escape hatch, not just a better
ranking. The reviewed result is saved to `recipe_ingredients`; every
subsequent "cook this" skips straight to an on-hand/shortfall view — no
re-parsing.

**Re-parsing must not discard a human correction.** This took two fixes to
get right:
1. First pass: `parse_recipe_ingredients` looks up the already-saved
   `recipe_ingredients` row by exact `raw_text` match and surfaces that
   instead of re-guessing.
2. That wasn't sufficient — a deliberate "no catalog link" choice (clearing
   a match on purpose) looked identical to "never reviewed" to the
   frontend, since both defaulted `item_id` from `matches[0]`. Fixed by
   adding explicit `reviewed`/`linked_item_id`/`is_bulk` fields to the API
   response, decoupled entirely from the `matches` suggestion list, so an
   explicit "nothing matches" sticks.

**Unit mismatch is a real, unhandled gap, worked around by data
correction, not code**: `_consume_item` has no weight↔count conversion. "1
onion" (count) against a kg-denominated catalog item silently drew 1 kg.
Fixed for the specific items that hit this (Potatoes/Chicken breast/Block
cheese converted from kg to count-based units `ea`/`ea`/`block`) rather
than adding a general unit-conversion layer — worth remembering if another
weight-vs-count mismatch surfaces for a different item.

**Direct-consumption vs. bulk** ingredients: `recipe_ingredients.is_bulk`
splits behavior at cook time — direct-consumption ingredients draw real
stock (a `recipe_consume` `stock_movements` row); bulk/pantry-staple
ingredients (spices, flour by the jar) are reference-only, never drawn
down. **Deliberately not modeled as a `tasks` row** despite the existing
task/item-consumption machinery covering exactly this shape — a `use`-
interval task never leaves the schedule board's Checklists bucket even once
completed, so every meal cooked would have permanently cluttered that
bucket. The recipe-consumption path bypasses `tasks` entirely and writes
straight to `stock_movements`.

**Duplicate catalog items**: `data.create_item()` blocks a same-name/
same-type duplicate (see [Schema](Schema.md#duplicate-item-prevention)) —
added specifically because the recipe-review "+ new catalog item" flow had
created a duplicate "onions" row after a failed fuzzy match, silently
splitting on-hand quantity across two rows.

**docx table import is a separate, upstream gap from parsing** (found
2026-09-17, Owner: "Aunt Sandy's Spaghetti Sauce is missing its ingredients
list"): `scripts/oneoff/import_recipes.py`'s `import_family()` originally
read only `doc.paragraphs`, silently skipping every Word table. The
Owner-Wise Family Recipes source doc lays ingredients out as a
2-column table (one ingredient per cell), so **29 of 35 recipes in that
file** never had ingredient text to parse in the first place — 26 were
imported with instructions only, 3 fell below the import's 40-char
minimum-body cutoff and got no row at all. `python-docx`'s `.paragraphs`
and `.tables` are separate flat collections with no positional
relationship to each other — the fix walks `doc.element.body`'s XML
children in original document order instead, interleaving table cells
into the body text as they're encountered. `scripts/oneoff/
fix_family_recipe_tables.py` re-parsed and repaired the 26 existing rows
(body + re-guessed `ingredient` tags) and created the 3 missing recipes,
verified against a scratch DB copy before applying to production (book
count 1,161 → 1,164). Worth checking for the same table-skipping gap in
any future docx-based import.

## 5. Telemetry sync

See [Data Flows & Interfaces](Data-Flows-and-Interfaces.md#-inbound-telemetry-from-influxdb-telemetry_syncpy)
for the wire-level contract (endpoint, auth, query, failure modes). Logic
summary: `telemetry_sync.py` (v2, 2026-09-24) pulls engine/genset
runtime hours and fuel/water tank fractions from InfluxDB (owned/managed by
the previous developer on `your-pi-hostname`) into the local `telemetry_cache` table. **Opt-in**: it
only runs when `MXINV_INFLUX_URL` and `MXINV_INFLUX_ORG` are set (bucket
`MXINV_INFLUX_BUCKET`, default `boat`; which device names count as the genset,
`MXINV_INFLUX_GENSET_MATCH`); otherwise it logs a skip and hours are hand-entered.
`run-live.bat` v5 sets the live values ([Architecture](Architecture.md#integrations-boundary)).
`data.telemetry_should_sync()` gates how often this actually runs (not on
every single schedule load); `scheduling.schedule_snapshot()` calls it
best-effort, swallowing any exception, since a telemetry outage must never
prevent the schedule from rendering. The widget in the app header
(`TelemetryWidget.tsx`) is the first UI in either app version to surface
fuel/water tank levels at all — `telemetry_sync.py` always wrote them, but
nothing displayed them before this rewrite's phase 7.

A manual-override path exists for when live telemetry is stale/unavailable:
`PUT /api/telemetry/{meter}/reading` lets a crew member enter an hours
reading by hand, matching the existing live/estimated/no-reading state
machine the old app already had.

## 6. Outbound webhook broker (vessel_log.py)

See [Data Flows & Interfaces](Data-Flows-and-Interfaces.md#-outbound-maintenanceincident-log--colins-logbook-backendvessel_logpy)
for the full payload shapes and system-name mapping table. Logic summary:
both follow one pattern: **disabled by default, fire-and-forget, never an
InfluxDB writer directly** — per the owner's explicit direction to the automation developer, "let
him broker the writes." Each checks its own `*_ENABLED`/`*_ENDPOINT`
(optionally `*_TOKEN`) environment variables; unset means every call is a
verified no-op. Each also exposes `is_enabled()`, which the cockpit's
`GET /api/cockpit/capabilities` reports so the Sail Plan and Break / Incident tiles are
**hidden** rather than showing "Logged" for a send that goes nowhere (deploy 20; both
are off on live pending the previous developer's endpoint). `vessel_log.log_completion()` posts a maintenance
completion (entry_type/system/description/hours + computed next-due/
project) to feed the previous developer's existing `logbook` InfluxDB measurement;
`log_incident()` (added for the cockpit app) posts a failure/observation
entry with no source task and no next-due computation.
The cockpit's sail plan no longer uses a webhook (2026-10-05): it writes SignalK `sails.activeSet`
directly through `boat_link.signalk_publish` - see Data Flows ④.

## 7. Local-date handling

A real, once-shipped bug: completion timestamps used `toISOString()`
(UTC), which silently recorded *tomorrow's* date for any US-timezone
evening completion. Fixed via `frontend/src/api/date.ts`'s `todayLocal()` —
any new date-stamping code in the frontend should use that helper, not a
raw `toISOString()` call.

## 8. Layup Return (bulk defer) + the Layup/Wake-Up checklists

`features/layup-return/LayupReturnTool.tsx` + its backend support: pick a
layup-start and back-in-service date; every non-checklist calendar task
that came due during that window is pre-selected for a bulk defer-to-date
(individual tasks can be deselected — e.g. a safety recertification that
genuinely needs doing regardless). Applies the existing per-task deferral
endpoint to each survivor in a loop; deliberately never touches
`last_completed_date` — the due dates were wrong for the boat being laid
up, not the service history itself. This tool is pure schedule
bookkeeping — it carries no physical-task content, which is why the two
checklists below exist alongside it rather than instead of it.

**"Extended Absence / Boat Lay-Up Prep"** (task #759) and its counterpart
**"Return to Service / Wake-Up Checklist"** (#782, new 2026-09-17) close
the gap: they walk the physical shutdown/reactivation sequence, the
Layup Return Tool just fixes the due-date math afterward. Both use
`checklist_group` (the same sub-list-group field from schema v13) to
separate steps by whether the boat is in the water or hauled out — the
distinction matters because raw-water-cooled systems (keel-cooled
refrigeration, both AC units, engine/genset, watermaker production) are
unavailable on the hard but fine in the water, and vice versa for
thru-hull closure (an in-water-only concern). Groups in use: `On-The-Hard
- Mandatory` (must shut down and stay down while hauled), `In-Water
Only`, `On-The-Hard - Optional Resource` (the portable floor A/C — a
resource note, not a required step), `On-The-Hard - Maintenance
Opportunity` (a reference-only roll-up of existing haul-out-cadence tasks
— anodes, hull inspections, Max Prop/Spurs service, rode reversal, AC/
Frigoboat descaling — that keep their own independent schedules; the
checklist just surfaces them via `task_references(kind='task')`, the
same mechanism schema v13 built for checklists including other
checklists inline), and `Post-Splash Only` on the Wake-Up side.

Full step-by-step content and the two research findings (AC winterizing
manual excerpt, watermaker un-pickle procedure) are in `history/CHECKPOINT_ARCHIVE_2026-09-19.md`'s
"Layup Prep + Return-to-Service" session entry, not duplicated here.

**Seacock steps (2026-09-18).** The layup checklist's single "close the
thru-hulls" step is now nine steps, one per closable seacock (the 4 raw-water
inlets and the 5 outlets), in group `In-Water Only`, each carrying its own
exception in `caution_notes` (a running A/C keeps its inlet open; the engine
inlet closes only after the last engine run; the master head sink drain also
carries the shower sump and the washer). The original step (#769) stays as
the last step of that group and is now the *verify* step. The two cockpit
scuppers are deliberately not in the list - they stay open, their valves are
emergency-only. The Wake-Up checklist mirrors it with nine "Reopen ..." steps
(group `Reopen Seacocks`) before the Post-Splash steps. Which seacock feeds
what lives in the `notes` of the Raw Water inlet systems and Thru Hulls.

## 9. The merged food cart (`data.food_cart()`)

Two shopping carts, not four (the owner, 2026-09-17): a **"stuff cart"**
(`items_below_minimum()`, the Restock List — parts/supplies/tools under
their reorder point or critical-spare hold) and a **"food cart"**
(`food_cart()`, the Galley Provisioning tab). Before this, food had two
separate, unreconciled lists — `provisioning_plan()`'s baseline heuristic
(scaled from crew size/cycle length) and `meal_plan_shopping_list()`'s
recipe-driven shortfall — that both nominally said "buy food" without
ever being combined.

`food_cart()` merges them, one row per food item:

1. Start from `provisioning_plan()` (the baseline `target_qty` per item).
2. Aggregate every active `meal_plan` entry's direct-consumption need via
   the shared `_meal_plan_needs()` helper (also used by
   `meal_plan_shopping_list()`, which stays as a narrower, meal-plan-only
   view — still useful in isolation, just no longer the primary shopping
   surface).
3. **`target_qty = MAX(baseline, meal_plan_qty)`, not additive.** the owner's
   own framing settled this: "the baseline food qty is a heuristic anyway
   to have food on board to cover normal meal prep, the recipe picker is
   a refinement on that heuristic." A planned recipe's ingredient need is
   already the kind of normal use the baseline already budgets for —
   summing them would double-count in the common case where the baseline
   already covers it.
4. `buy_qty = max(0, target_qty - quantity_onhand)`, same as before.
5. `expiring_soon`: the item's earliest stock lot expiry, if within
   `expiring_days` (default 14) — a **purchase-decision flag**, not a
   removal action. Deliberately distinct from the clean-out screens
   (`ExpiringStockTable.tsx`) which exist to remove already-expired stock
   from containers; this just tells you "you have some of this aging out,
   maybe don't buy more yet."

The stuff cart got the equivalent treatment more simply — `RestockTab.tsx`
cross-references `stock_expiring_within()` client-side and flags any row
with a lot expiring within 90 days (wider than the food cart's 14, since
spares/parts get shopped for less often). No merge needed there, since
there's only ever been the one restock heuristic for non-food items.

**Asking for something (tracker #23, 2026-09-19).** The same `items.on_list_since`
request that feeds the food cart also works on the stuff cart: the Restock tab has a
"Need something?" box (`AddToRestockPanel.tsx`) to put any non-food item on the list, or
to create a new item (name, type, unit - details are finished later from the Locker) and
list it in one step. `items_below_minimum()` then also returns a requested non-food item
(`reason = 'requested'`, `on_list = 1`, at least 1 to buy even if no thresholds are set),
sorted first; receiving stock clears it (same `add_stock` rule), and a row's "take off"
clears it by hand. A FOOD request is deliberately not listed here - it belongs to the
Galley cart - so a food item appears on the Restock List only for its thresholds.

**Wrong-model parts never reorder (v28, 2026-09-21).** `items_below_minimum()` skips any item whose
`item_fit_checks` row says `wrong_model` - it stays in stock (physically aboard) but is neither a
spare nor a purchase; see the Design-Decisions "Spares fit check" section.

**Serves column + device filter (tracker #17 remainder, 2026-09-21).** Each Restock row
shows the systems/devices the item is linked to (`item_systems`, schema v22), so you can
see what a shortfall would leave unserved and shop by device. `GET /api/items/below-minimum`
attaches a `serves` list per row from one query (`data.systems_served_by_items`, no N+1);
`items_below_minimum()` itself is unchanged, so the Streamlit tab and the offline snapshot
are unaffected. The filter offers only systems that actually have a listed item (a top-level
system also matches its devices, "<system> - everything"), each with a row count, plus
"Parts not linked to any device" - part / spare-unit rows with no link, the same rule as the
item screen's "not linked to any device yet" nudge (tools, supplies and food are not linked
by design). A picked filter whose last item gets restocked falls back to "all".

A real bug caught while building this: the expiry-flag comparison used
`pd.Timestamp.utcnow()` (tz-aware) against `pd.Timestamp(expiry_string)`
(tz-naive) — raises `TypeError`, silently swallowed by a broad `except`,
so every row came back unflagged with no visible error. Fixed with
`pd.Timestamp.now()` (tz-naive, matches the plain `YYYY-MM-DD` strings
stored in `stock.expiry_date`). Worth remembering: a silently-caught
exception in a per-row `.apply()` is easy to miss in testing if you don't
specifically check that the *positive* case flags correctly, not just
that the function doesn't crash.

## 10. Units, the cook screen, and metric conversion (schema v21)

**Units are a governed picklist** (`units` table; `items.unit` and
`recipe_ingredients.unit` reference it). Imperial by decision; `kg`/`L` exist
only as hidden legacy rows for nine items until they are converted (see
[Design-Decisions](Design-Decisions.md#units-are-a-governed-picklist)).
Every write path validates: an unknown unit is HTTP 422 with a "did you mean"
hint (`each` -> `ea`), but an item that already carries a legacy unit can still be
edited without touching it. A recipe ingredient's unit may be NULL = "none
stated"; there is **no unit conversion anywhere in the draw path** - a cook
draws the recipe's number straight from stock in the item's own unit.

**The shared cook flow.** The Recipe screen and the Meal Plan entry screen both
render `recipes/CookFlow.tsx` (they used to be near-copies). What differs is
passed in: which endpoint completes it (`recipes/{id}/make` vs
`meal-plan/{id}/complete`), whether picks are saved on a plan entry, and the
result wording. On screen:
- **Direct lines** show the item's stock unit and on-hand, with a swap picker
  (for this cook only, never saved back to the recipe) and ad-hoc extras.
- **Unit-mismatch warning**: when the recipe line has a unit that differs from
  the linked (or swapped) item's stock unit, a non-blocking
  "recipe says 3 cup / stock counts ea (volume vs count, not converted)" appears.
  It is a warning only - the draw is unchanged. NULL recipe units get none.
- **Bulk lines** (`is_bulk`) are reference-only: never drawn, never marked
  short, no mismatch warning, no shopping-cart effect. The note flags exactly
  two cases: no catalog item matches ("⚠ salt - no catalog match") or the item
  has nothing on hand ("⚠ Flour - none on hand").
- **Result text** reports the ITEM's unit (`consumed[]`/`shortfalls[]` carry
  `unit` = item unit and `recipe_unit`). It used to print the recipe line's
  unit, hence "short 6 null" on lines with no unit.

**Metric input.**
- *Ingredient parse* (`parse_recipe_ingredients`): metric lines (g, kg, ml, cl,
  dl, L) are converted to the imperial picklist unit with kitchen rounding and
  returned as the suggestion, with `converted_from` ("500 g") so the review row
  can show "≈ converted from". A bare count ("6 apples") suggests `ea`; a line with
  no number or an unrecognised unit word stays NULL. The reviewer confirms or
  edits every row before anything is saved.
- *Body text* (`convert_recipe_text_to_imperial`, `GET /recipes/{id}/convert-text`):
  a proposal, never a write - temperatures (C to F; nearest 25 F in oven range so
  180 C -> 350 F), lengths, volumes and masses anywhere in the body, with a
  before -> after list. Apply saves the edited text as the body and **the
  original metric text is discarded** (the owner's decision). Text that already has its
  imperial twin, unit-less numbers, times and look-alike words are left alone.

## 11. Where stock lives: zero-quantity "homes" and Receive (tracker #47)

**A stock row at quantity 0 is meaningful: it marks a container as where the item
lives** (the owner, 2026-09-20). Two ways a zero row comes to exist: (1) a NEW item -
"Add New Stuff" (or the Locker multi-select) with quantity 0 and a container
picks where it will go once received (previously the Add Item tab silently dropped
a 0 row and the stow panel refused 0); (2) an EXISTING item whose last one was used
- a plain row simply stays at 0 (`_consume_item`), and since 2026-09-20 an
expiry/lot row that hits 0 (used up by `_consume_item`, or thrown out through
`delete_stock(reason='expire')`) leaves a zero plain row behind (`_leave_home`), so
the replacement goes back to the same container. A manual per-row delete on the item
screen deliberately does NOT (the confirm dialog says to set it to 0 instead).

**Receive (`warehouse/ReceiveAction.tsx`)** asks the server where a purchase can go:
`GET /api/items/{id}/receive-targets` = every container the item already has a row in,
zero-row "homes" first (`data.receive_targets`). One known place: pre-filled with the
suggested quantity, one tap to add. Several (e.g. American Cheese: fridge + two
freezers): each is listed with its own quantity - the first gets the whole purchase,
The owner splits the rest - so "where, and how many" is always asked when there is a real
choice. None recorded yet: the old container pick. A "+ somewhere else" row is always
present. It posts `POST /api/items/{id}/receive` (`data.receive_stock`): one
all-or-nothing transaction, quantity > 0 per line, a plain line MERGES into the
container's existing row (including a zero home) instead of hitting the
one-plain-row-per-(item, container) unique index, logs a `restock` movement per line
and clears the item's "we need more" request. `data.add_stock` (the item screen's
"+ Add lot") uses the same merge (`_put_stock`); a zero-quantity add creates the
home row and logs no movement. `stow_items` accepts 0 the same way (returns a `homes`
count).

**Mixed expiry dates (the owner, 2026-09-20: a new purchase while older, undated stock is
still in the pantry).** Four rules, all server-side:
1. **Use-first order** (`_consume_item`, used by task completion, recipes and the cook
   screen): UNDATED stock is drawn first (it was already aboard when the dated batch
   arrived), then dated lots earliest-expiry first. It used to put undated LAST, which
   drew the new batch before the older stock.
2. **Estimated expiry on Receive:** `GET /api/items/{id}/receive-info` (the form's one
   call: targets + `suggested_expiry` + the undated stock aboard; `receive-targets` is
   kept for a tablet still on the previous bundle) returns today + the item's
   `food_details.shelf_life_days` when it has one (49 of 76 food items today). The date
   is an editable default, labelled as an estimate; clearing it receives undated.
3. **Date the older stock:** when the received line is dated and `undated_quantity > 0`,
   the form asks once for the older stock's date (`older_expiry` on `POST .../receive`).
   Filled: every undated row with quantity > 0 gets it (zero home rows never do), applied
   before the new lines go in so an identical date merges into one lot. Blank: it stays
   undated and is used first. Existing undated rows are NOT back-filled - the owner will date
   them at the inventory audit.
4. **`acquired_on` keeps the earliest date** when a purchase merges into a row that
   already holds stock (an empty row takes the new date); vendor / unit cost stay the
   latest-purchase snapshot. A dated line into a container that already has a lot with
   the same expiry merges into it instead of adding an identical row.

**One expiry date per receive, by decision (the owner, 2026-09-20).** A purchase split between
the fridge and a freezer shares one date: the derived (shelf-life) date, i.e. the freezer
one, because items in the freezer move to the fridge for consumption anyway. So no
per-line expiry. A "default location" as a real field rather than a zero row was also
considered and left out - the zero row is the owner's chosen mechanism.

## 12. Linked tasks inline in a checklist (tracker #48, schema v27)

A checklist's runnable body is `data.get_checklist_items(id)` (`GET /api/tasks/{id}/checklist/items`):
its own steps AND the tasks linked into it, one list ordered by `sort_order` (steps and links share
one numbering). `item_kind` is `step` or `link`; a link row shows the MASTER task's name / system /
how-to, with the link's own `sort_order` and `checklist_group`.

**Per-run tick.** Ticking a link (`POST /api/tasks/references/{ref_id}/tick`) is a REAL completion of the
master task - `complete_task`, so history, schedule, project detach and the outbound log all behave as
if it were done from its own screen - with the note "Ticked in checklist: <name>", and the resulting
`completion_id` is stored on the link (`done_completion_id`). The link reads as done only while that
completion exists and is not voided. **Un-tick** (`.../untick`) VOIDS that completion (`void_completion`),
so the master's last-done date goes back to its previous live completion - it used to blank the date
(`clear_completion`), which erased a dated recurring task's schedule basis. Voiding the completion from
the History log reopens the link too (done is derived). **Reset** sets every link's tick to NULL for the
checklist and any checklist it includes; the completions stay in history. **Finish run**
(`complete` with `close_subtasks`) still force-closes only the checklist's own steps: a linked master task
is never marked done just because the run was finished - only ticked links were really done.

**Order.** The up/down arrows renumber steps and links together 1..N. Adding a step, moving one in or
linking a task goes to the end via `_next_checklist_position`, which first gives older un-numbered steps
(they sort last, by name) explicit numbers in that same order, so "the end" is really the end. Groups: a
link's group is on the link; `checklist_step_groups` offers both. Linked tasks no longer have a separate
"Linked tasks" box. Printing: see [Design-Decisions](Design-Decisions.md#print-on-demand) - the print sheet reads the same item list, so linked tasks and included checklists print.

## 13. The maintenance history as a record (tracker #44)

`task_completions` is the boat's legal-style service record: every ticked completion and every
typed-in past service record, in one table, under one append-only ruleset, printed by one report.
Why it is shaped this way: [Design-Decisions](Design-Decisions.md#historical-service-records) and
[#history-report](Design-Decisions.md#history-report).

**Append-only, enforced by triggers, not by convention.** `trg_completions_append_only` refuses
any UPDATE that changes a fact column (name, system, dates, meters, notes, `performed_by`,
`vendor`, `cost`, `outcome`, `evidence_path`, `event_kind`, ...). Only four transitions pass, each
on its own with nothing else changing: `task_id` -> NULL (the FK's SET NULL when a task is
hard-deleted); voiding (`voided_at` set once, with a reason); stamping `sent_at` once (for the
future replay to the automation developer, v32); and, from v33, changing `document_id` (filing under an invoice,
section 17). `trg_completions_no_delete` refuses every DELETE. The parts lines
(`task_completion_parts`) are append-only the same way.

**Correcting a mistake = void and re-record.** `data.void_completion(id, reason)` needs a
reason. If the voided entry was the task's latest live completion, the task's
`last_completed_date` / `hours_at_completion` go back to the previous live completion (or, if
none is left, to the `previous_*` values the first entry captured), so the schedule is right
again; an older entry is only marked. The correct entry is then just a new completion. There is
no edit path.

**A past service record reschedules nothing.** `data.add_historical_record()` (Log tab,
"＋ Past service record", `POST /api/tasks/completions/historical`) writes a row with
`source='historical'`, `task_id` NULL, and every scheduling column NULL (`due_on`,
`days_past_due`, `interval_type`, `period`, meters, `previous_*`) - there was no schedule to be
late against and no meter read, and inventing one would put fiction in the record. It never
touches `tasks.last_completed_date`. Rules: `system` must be a real system or device (so the
report can file it); the date must be ISO and not in the future; cost, if given, is a
non-negative number; optional parts are snapshot lines. If the work really was one of the boat's
tracked tasks, the right move is to complete THAT task back-dated instead, which does reschedule
it. In the Log, a `task_id IS NULL` row reads "(recorded from records)" when `source` is
`historical` and "(task since removed)" otherwise.

**The printable report** (`backend/history_report.py`, `GET /api/report/history`, the Log tab's
"🖨️ Printable report" link, which passes the Log's current system/device filter):
- Scope: whole vessel, `?system=` (a top-level system and its devices) or `?device=`. Grouped
  system -> device, **oldest first** inside each (the in-app Log stays newest-first).
- Each device heading carries its identity line when anything is recorded - make/model,
  installed qty, installed on, serial, and "warranty to <date>" / "warranty expired <date>"
  stated against the print date (schema v32 columns, entered on the device screen).
- Each entry: the date logged plus a military DTG (e.g. `192215ZSEP26`) built from the UTC
  `recorded_at` - so for a historical backfill the DTG is when it was typed in, not when the work
  was done. Badges for "recorded from records", critical, and lateness (absent for historical
  and break/fix, which have no schedule); from v4 (schema v34) also "problem found" / "partly
  done" and "N follow-on task(s), M open" / "..., all closed" (section 18). Meter readings only on hours-scheduled work. Voided
  entries stay in, struck through, with their reason - the report is the trail, not a summary.
- **Privacy default:** `performed_by` always shows (it is the maintenance fact). **Cost, vendor
  and invoices only with `&cost=1`** (the owner's open 2026-09-16 question: what the boat had done and
  what it cost are different disclosures). The footer tells the reader how to opt in.

The v32 columns `outcome`, `evidence_path` and `event_kind` exist (validated in `data.py`, not by
a DDL CHECK, so a new value never forces a rebuild of the append-only table). `outcome` is
captured since schema v34 (section 18). Since deploy 15 (2026-09-23) the past-service form writes
`event_kind` (service / grounding / survey / haul-out / modification / incident -
`data.COMPLETION_EVENT_KINDS`, validated in `add_historical_record`; a bad kind is a 400) and
`evidence_path` (a PATH to a photo or PDF on disk - the app has no upload machinery); the Log
and the printed report show both. `sent_at` still has no writer (the previous developer's endpoint).

## 14. Retire vs delete a task (tracker #66, schema v30)

A hard delete does not erase history rows (they denormalise name/system/project), but it severs
`task_completions.task_id` and `stock_movements.task_id` (FK SET NULL) and CASCADE-deletes the
task's own steps - the MX log loses its thread. So:

- `data.task_delete_blockers(task_id)` walks the task's whole subtree (the task plus every
  descendant via `parent_task_id` - exactly what the CASCADE would take) and counts completions
  and stock movements across it. `can_delete` = both are zero.
- `data.delete_task()` refuses when `can_delete` is false; the API answers **409** with the
  counts and "retire it instead". `force=True` skips the check - **scripts and one-off repairs
  only; the API never sets it.**
- `data.retire_task(id, reason)` stamps `retired_at` (UTC, SQLite's clock) and an optional
  reason. A retired task drops out of the schedule projection (`scheduling.py` filters it and
  reports `retired_count`) and out of the pick lists (`list_importable_tasks`,
  `list_linkable_tasks`), but `load_tasks_dataframe` still returns it so Management can show it
  behind "Show retired (N)" and un-retire it (`unretire_task` clears both columns). Nothing on
  live is retired yet.

The task screen's former unlabelled Delete is the **"Referenced by" panel**
(`data.get_task_referenced_by`): project, parent checklist, ALL inbound `kind='task'` links (the
old view showed only links whose source is a checklist - 11 of 75), its own steps and the history
cost of a delete, each placement removable on its own. See
[Design-Decisions](Design-Decisions.md#retire-not-delete) and
[#referenced-by-panel](Design-Decisions.md#referenced-by-panel).

## 15. Clone a device with rename (tracker #67)

`data.clone_system(source, new_name)` (device screen "📋 Clone with rename",
`POST /api/tasks/systems/{name:path}/clone`) copies, in one write transaction: the `systems` row
(same parent, make/model, manual ref, installed qty, no-spares flag, notes), its `item_systems`
part links, and its **top-level, non-retired** tasks, each with its `task_items` list and its
non-task references (manual / standard / url / note).

- **Each copy is an independent task** - its own schedule and its own history from then on. Not a
  shared multi-device task: the owner's three Seaflo pumps live at opposite ends of the boat and will
  not be serviced on the same day, so one due date would be wrong.
- **Reset, not copied:** `last_completed_date`, `hours_at_completion`, `deferred_units` (the new
  unit has never been serviced); no history of any kind.
- **Skipped:** tasks that are a STEP of a checklist (copying one would silently grow that
  checklist) - counted and returned as `steps_skipped`; `kind='task'` references (they point at
  one specific other task).
- The source name is replaced by the new one wherever it appears in a copied task's title
  (`renamed_in_titles`). The device identity fields (serial, installed on, warranty) are not
  copied - they belong to the physical unit.
- A blank or unchanged name, or a name already in use, is refused.

See [Design-Decisions](Design-Decisions.md#clone-with-rename). The route is `{name:path}` because
system names can contain a slash
([#system-name-slash-routes](Design-Decisions.md#system-name-slash-routes)).

## 16. Who did the work: the performed-by pick list (tracker #44)

`task_completions.performed_by` is a **TEXT snapshot, not an FK** - a history row states a name
as a fact, so crew can come and go from the roster (`crew_members`, schema v32, seeded the owner +
crew member) without rewriting the past. The cost of free text is inconsistent spelling, and the
pick list is the fix:

- `data.list_performed_by_choices()` (`GET /api/tasks/completions/performed-by`) = the offered
  roster (by kind, sort order, name) **UNION** every `performed_by` already used in non-voided
  history (most-used first). Deduped **case-insensitively** - a roster name is not repeated
  because the history capitalised it differently. Each choice says its `source` (roster /
  history) and `uses`.
- The shared `PerformedByField` renders it as a `<datalist>`: anything can still be typed (a
  one-off yard), but the easy path is to pick what is already there.
- Captured on ordinary completions (`complete_task`), on checklist-link ticks
  (`tick_checklist_link`) and on past service records; a subtask closed alongside its parent
  inherits the parent's `performed_by`.
- Known limit: this stops future spelling variants; it cannot fix past ones (append-only).

See [Design-Decisions](Design-Decisions.md#performed-by-pick-list).

## 17. Invoices on file (schema v33)

Live since 2026-09-22 ~16:23 (code `863570e`). The design and the
reasoning behind every rule - including why the app must never show a "year total" - are in
`design/INVOICE_DOCUMENTS_DESIGN.md` (summary:
[Design-Decisions](Design-Decisions.md#invoices-are-documents)); read that before changing
anything here. The app indexes
paper; it does no accounting and gives no tax advice.

**A document is the spine of one piece of paper** (`documents`: vendor, doc number, `doc_date`
and/or `period_start`/`period_end`, `total` stored once, `file_path` on disk, `project_id`,
`expense_class`, notes). `data._clean_document` requires a vendor and at least one date, ISO
dates, a period that does not end before it starts, and rounds the total to cents. Unlike the
history, a document is **editable** (`update_document`) - fixing a mistyped invoice number
corrects the index, not the past. The date a document "counts toward" is
`COALESCE(doc_date, period_end, period_start)` everywhere (year filter, sorting).

**Filing a completion under a document** (`data.set_completion_document`,
`PUT /api/tasks/completions/{id}/document`; the Log's "📄 File under invoice…" / "Refile…"
control; the past-service-record form's "Paid under invoice" select):
- Allowed transitions: attach (NULL -> doc), move (doc -> other doc), detach (doc -> NULL). The
  trigger allows a `document_id` change only when nothing else on the row changes.
- **Cost XOR document.** An entry with its own `cost` cannot be filed, and
  `add_historical_record` refuses both at once; triggers
  (`trg_completions_cost_or_document_ins` / `_upd`) enforce the same at the DB level. This is
  the double-count guard (the same money on the job and on the invoice). The GUI mirrors it: the
  file control is hidden on an entry with a cost, and picking an invoice on the past-record form
  clears and disables its cost box. The invoice pick stays set between saves, so a multi-page
  yard invoice's jobs go in one after another.
- **Voided entries are not filed** (a mistake kept visible is not work paid for) - refused in
  `data.py`; the control is not offered on a voided row.
- **A no-op filing short-circuits.** If the entry is already filed under that document (or
  already detached), the function returns before any UPDATE - because the append-only trigger's
  filing clause requires `document_id` to actually change, a same-value UPDATE would be refused
  as an edit.
- `delete_document` is refused (409) while any history entry, voided or not, is filed under it -
  the FK's SET NULL would otherwise break the substantiation chain silently. Detach first. The
  PDF on disk is never touched.

**A document with no work filed is legitimate** - money out, nothing received (the Gulf
Solutions 1162 / 1179 case). Money is **never apportioned** across the jobs a document covers.

**The year view** (`data.documents_year_view(year)`, `GET /api/documents/year/{year}`; the Log
tab's "📄 Invoices on file" view, which defaults to the newest year that has documents):
- Groups that year's documents by `expense_class`, case-insensitively, each group labelled with
  its most-used spelling across ALL documents; no class = "(unclassified)", sorted last.
- Per group: count, subtotal of the totals entered, and `untotalled` (documents with no total),
  so a subtotal never looks more complete than it is. Overall: `count`, `untotalled`, `on_file`.
- **Wording is part of the logic:** the screen says "Invoices on file for <year>: N indexed,
  totalling $X ... Not a year total - only what has been indexed so far." Never "total spend".
  The card and bank statements are the authority.
- Expense classes are free text, offered back from prior use by `data.list_expense_classes()`
  (most-used first, case-insensitive dedupe) in a `<datalist>` - the same idea as section 16.
  They are the owner's own words so they can match his return; the app supplies no categories.

**CSV** (`GET /api/documents/year/{year}/csv`, "⬇️ CSV for <year>"): one flat row per document
(class, date, period, vendor, invoice no, total, project, history entries filed, file path,
notes), UTF-8 with a BOM so Excel opens it cleanly, and **no grand-total row** - it is for
reconciling beside the card summary in a spreadsheet.

**Invoices in the printable report** - only with `?cost=1` (section 13):
- Each entry filed under a document says "paid under <vendor> #<number>".
- An "Invoices on file" section after the history: for the **whole vessel**, every document on
  file, including ones with no work filed; for a **system or device** scope, only the documents
  its (non-voided) entries are filed under. Each shows its own total once, with its class,
  project and "N job(s) filed" / "no work filed under it". **Never apportioned** - there is
  deliberately no per-device cost figure.

## 18. Task outcome and follow-on tasks (schema v34)

Live since 2026-09-22 ~17:40 (deploy 10, code `d54252c`, tracker #44). A logged job can say how
it went, and a job that found a problem or was only partly done can raise the work it leaves
behind. Why the link is shaped this way:
[Design-Decisions](Design-Decisions.md#follow-on-tasks).

**Outcome** (`task_completions.outcome`, a v32 column, now captured): `done_ok` /
`problem_found` / `partial`; NULL = not stated, which reads as done. `data._clean_outcome`
validates it (against `db_schema.COMPLETION_OUTCOMES`); an unknown value is a `ValueError` -> 400.
The shared `OutcomePicker` ("How did it go?": Done - all good / Problem found / Partly done) is on
the Complete panel (`TaskCardDetail`) and the past-service-record form (`HistoricalRecordForm`);
"Done - all good" is the default and posts as NULL, so in practice the GUI writes only
`problem_found` / `partial` or nothing. Like every fact column it is immutable once written
(section 13).

**A 'partial' job still resets the schedule.** Outcome never changes the scheduling:
`complete_task` rolls `last_completed_date` / `hours_at_completion` forward exactly as for a
clean job. The unfinished part is what the follow-on task is for. Leaving the clock unset would
make a half-done job look never-started and would fight the void / undo logic (section 13).

**Follow-on tasks** - one history entry -> MANY tasks (Owner: "it's a boat, there is never a
simple answer to something that is broke"):
- Each is an ordinary `tasks` row: `task_kind='one_off'`, `interval_type='break_fix'`,
  `period='immediate'`, `deferred_units=0`, optional `is_critical`, an optional description, and
  `origin_completion_id` = the entry that raised it. `system` defaults to the job's own
  system/device; the `FollowOnEditor` offers the systems tree ("Same: <job's system>" first).
  Being a normal task it is scheduled, completed, retired and linked like any other.
- **Raised with the completion:** `complete_task(..., outcome, follow_ons)` and
  `add_historical_record(..., outcome, follow_ons)` create them **in the same transaction** as
  the history row via `data._insert_follow_ons(conn, ...)`, on the caller's open write
  connection - never a second write connection, which self-deadlocks. The editor appears only
  for Problem found / Partly done; rows without a name are dropped before sending (and skipped
  server-side). `POST /api/tasks/{id}/complete` returns `follow_on_task_ids`.
- **All or nothing:** a bad outcome, or a follow-on whose system (given or defaulted) does not
  exist, rejects the WHOLE call with 400 and writes nothing - no history row, no stock draw, no
  task.
- **Raised later:** `data.create_follow_on_tasks(completion_id, follow_ons)`
  (`POST /api/tasks/completions/{completion_id}/follow-ons` -> `{task_ids}`; the Log row's
  "＋ Follow-on task…") - for a problem spotted afterwards, or one found in a past service record.
  The history row is not touched. Refused for a **voided** entry (a mistake is not a source of
  work - raise it from the corrected entry), for an unknown entry (404), and when no row has a
  name.
- **Voiding keeps them.** Voiding an entry does not retire or delete the follow-on tasks it
  raised; they are real work. The Log still lists them under the voided row.

**Where it shows:**
- **Log** (`CompletionLog`): an outcome badge on a non-voided entry that was not a clean job;
  "↪ Follow-ons:" listing each task (click opens it) with ✅ done / (retired) / (open) -
  `list_completions()` returns `follow_ons [{task_id, task_name, system, done, retired}]`, done
  meaning the task has a `last_completed_date`.
- **The follow-on task itself**: "↩ Follow-on from <job> (<date>, problem found)" on its
  schedule card and on the full record (`TaskDetail`) - from `load_tasks_dataframe()`'s
  `origin_completion_id` + `origin_task_name` / `origin_system` / `origin_completed_on` /
  `origin_outcome` (a LEFT JOIN to `task_completions`).
- **Printable report** (`history_report.py` v4): "problem found" / "partly done" badges and
  "N follow-on task(s), M open" or "..., all closed" (section 13).

## 19. Defer, add-as-a-step, follow-on urgency, save back to a recipe (tracker #68-#71)

**Defer counts from today (#68, `data.defer_task`).** The Schedule card's "+N" sets the new due
point to `max(current due, now) + N`: an overdue task lands N days from TODAY, not N days after a
date already past. On an `hrs` task N is engine/genset hours from the CURRENT meter reading. When
the due point cannot be worked out (no meter reading, no history) it falls back to the plain
additive bump. Why: [Design Decisions](Design-Decisions.md#defer-from-today).

**Add as a step (#69).** A task's record offers "＋ Add as a step to a project…" / "…to a
checklist…", then asks one question: "Keep it on its own schedule too?" Yes = LINK (the task keeps
its schedule and also appears as the step); No = MOVE (it becomes the step). Checklist positions go
through `data._next_checklist_position` so "the end" is really the end.
[Design Decisions](Design-Decisions.md#add-as-a-step).

**Follow-on urgency (#70).** Each follow-on row (section 18) picks Routine (default) / Urgent /
Drop everything; the choice is stored as the break/fix task's `period`, so a routine follow-on
does not land in Overdue. [Design Decisions](Design-Decisions.md#follow-on-urgency).

**Save plan/cook changes back to the recipe (#71, schema v35).** On the Meal Plan and in Cook, a
line can be fixed (wrong match, quantity) or added, then kept: "📌 Save to recipe" per line or
"💾 Save all N changes to the recipe". `POST /api/recipes/{id}/ingredients/changes` ->
`data.apply_recipe_ingredient_changes`, ONE transaction, all-or-nothing. `updates` change only the
keys present; a new `item_id` is a person's deliberate choice, so it sets
`recipe_ingredients.link_confirmed` (v35) and a later re-parse leaves the line alone. The line's
`raw_text` (the recipe's own wording) is kept. `additions` are appended, worded from the item in
the item's own unit, and confirmed. The meal's protein pick is left out of Save all (it is a per-
plan choice). Re-parse asks first, because it resets the lines to their original parsed state.

## 20. Never-done baseline (schema v36)

**One rule, one function.** `data.task_baseline_date(last_completed_date, schedule_from, today)`
returns `(date the interval counts from, never_done)`, and both the schedule projection
(`scheduling._project_row`) and `data.defer_task` call it - they used to carry their own
copies of the 90-day fallback. Order:

1. `last_completed_date` -> that date, `never_done = False`;
2. else `tasks.schedule_from` (v36) -> that date, `never_done = True`;
3. else `today - NEVER_DONE_ASSUMED_DAYS` (90) -> `never_done = True`.

Unparseable text falls through to the next step. Live tasks all have NULL `schedule_from`,
so live due dates did not move with v36.

**Who sets `schedule_from`.** `load_starter_pack.py` v3 stamps every library task it loads
with the load day, so a new boat's library first comes due one interval after loading
instead of dumping everything short-cycle into Overdue (cold test, example boat + both
packs: Overdue 81 -> 7, Critical 28 -> 2, none of them library tasks). `data.create_task` accepts it; nothing in the GUI sets it yet.

**Honest display.** Each schedule row carries `never_done` (always false for break/fix).
For a never-done task `formatted_last_done` is `''` and TaskCard v3 says **"not done yet"**
- before v36 it printed the assumed 90-days-ago date as if the job had been done then
(true on live too). Why: [Design Decisions](Design-Decisions.md#never-done-baseline).

## 21. The logbook / ship's log (schema v37-v39)

Tables in [Schema section 11](Schema.md#11-the-logbook--ships-log-v37--v39); design and the owner's answers in
`design/LOGBOOK_DESIGN.md`; routes in [API Reference](API-Reference.md). Code: `data.py` (`create_log_entry`,
`add_log_status`, `list_log_entries`, `log_passage_end`, the passage functions), `backend/routers/logbook.py`,
`backend/log_stamp.py`, `backend/deck_log.py`, `backend/logbook_report.py`.

**One write, one transaction.** `create_log_entry` validates kind / source / severity / system (must exist in
`systems`), refuses a repeated `source_event_id` (`DuplicateEvent`), creates the optional fix task (the
follow-on mechanism of section 18, urgency routine / urgent / immediate), inserts the entry, its stamp (only if
the stamp has at least one value) and, for a failure, its first status `broke` - all or nothing.

**Stamps are best-effort and never typed** (`log_stamp.stamp(minutes_ago)`). Now = one SignalK snapshot through
the handover card's own rules (same units, same staleness limits, so a stale value is dropped, never shown as
live) + the engine's mode (`GET /status`) + the `sails.activeSet` label. Back-dated ("N min ago") = the history
read API's value at that time for position, SOG, COG (only if SOG >= 0.5 kn), apparent wind and barometer. No
boat stack configured (`MXINV_SIGNALK_URL` unset) = no stamp; stack down = whatever answered. A crew entry never
waits on, or fails because of, the boat stack.

**Statuses are a chain; the current one is the newest row.** Open = newest not Fixed / Accepted. A correction is
another row with a note. Any status may follow any (the owner 10-05).

**"This watch" is a change report, by write order** (`GET /api/logbook/this-watch`; the owner 10-05: "what's changed
since last time"). With a previous watch entry W: every entry whose `entry_id` is greater than W's (so a
back-dated entry logged after the handover still counts; the read window starts 24 h before W's time), minus
engine entries whose `record` is `log` (D-114), plus status changes on OLDER failures whose `after_entry_id` is
at least W's id (an entry already listed as new is not repeated as a change). With no watch entry yet: the last
6 h by clock. The standing Deferred / Accepted register is deliberately NOT repeated at every handover - it lives
in the desktop Ship's Log failure register. **The watch entry** (`POST /api/logbook/watch`, "Log this watch")
writes the crew's Observations plus that change list as its body, so it reads on its own, and the full handover
card as its stamp (`card_json`).

**The automatic deck log** (`backend/deck_log.py`; the owner 10-05: "this is the ship's log - no more paper"). A daemon
thread, started by `backend/main.py` only when `MXINV_SIGNALK_URL` is set and `MXINV_DECK_LOG` is not `off`,
wakes once a minute. A slot is due at the top of every hour when the engine's mode is MOTOR or SAIL, and at 08:00
and 20:00 otherwise; a slot is written up to 10 minutes late (e.g. right after a restart) and never later - **a
slot missed while mx-inv was down is skipped, never back-filled with invented data**. Each report is a `status`
entry, `source='auto'`, `record='log'` (in the ship's log, not the handover), one status line (position in
degrees and decimal minutes, mode, SOG / COG, sail set, apparent wind with its side, barometer + 3 h change, seas
and the nearest observation when the weather service has them, depth, fuel / water) and the handover card as its
stamp. Idempotent: `source_event_id` = the slot time. An interim host with no boat stack sets
`MXINV_DECK_LOG=off` (run-live.bat, when `LIVE-HOST-INTERIM.txt` is present) so the append-only log never fills
with "No boat data" lines.

**Engine events** (`POST /api/logbook/events`, contract in
[API Reference](API-Reference.md#the-inbound-engine-push-post-apilogbookevents)): stored as `kind='event'` with
the engine's fire time to the second; if the push arrives less than 2 minutes after it fired the stamp is live
(with the card), otherwise it is read from history at the fire time (the engine's outbox may deliver late after an
outage). Title = the engine's message; body = the deck-log status line + the JSON detail. A 200 or a 409 both mean
"delivered" to the engine.

**Passages = one leg, derived** (v38, the owner 10-05, option B). `_pair_passages` walks the departure / arrival
entries in time order: a departure opens a passage, the next arrival closes it. Write order is enforced
(`PassageOrderError` -> 409): no departure while under way, no arrival without a departure, no end back-dated
before the previous end. Membership (`in_passage`): an entry belongs if its minute is inside
[departure, arrival]; inside the departure's or the arrival's own minute, write order decides (an entry written
after the arrival in that minute belongs to the time alongside). Facts are computed on read: hours; logged
distance = the sum of great-circle legs between consecutive stamped positions (needs 2+ fixes; a FLOOR - the deck
log gives about one fix an hour under way); counts of failures / incidents / observations / P1-P2 alarms /
watches, engine TEST events left out. The passage id is the departure's `entry_id` (`passage_ref` LOG-NNNNN);
`GET /api/report/logbook?passage=<id>` prints one.

**Printouts** (`backend/logbook_report.py`, `GET /api/report/logbook?day=&to=&passage=&tests=`): oldest first,
instrument lines, each failure's status chain, and the open-failure register at the end; engine TEST events only
with `tests=1`; a bad date is a 400.

**v39 (live since 2026-10-08) adds:** every cockpit / desktop entry is SIGNED - `author` must be a
person on the `crew_members` list (offered), stored in the roster's spelling, else 400; engine / auto / import
entries pass through. The watchkeeper = the newest `logbook_watch_turns` row since the current leg's departure
(set by the handover's "Taking the watch" and the departure's "First watch"); none alongside or at anchor; forms
default to the watchkeeper, else to the last name used on that device. Status changes are listed on the day they
HAPPENED (`GET /api/logbook/status-changes?since&until`; a failure's own first Broke is not a change). Completing
a task that is a failure's fix task offers "Mark it Fixed" (`GET /api/logbook/raised-by/{task_id}`; an offer -
"Not yet" is the default). The Sail Plan tile always logs a `sail` line "Sail plan: before -> after" (its stamp's
`sail_set` = the NEW set) and writes SignalK only when it can. `POST /api/logbook/engine` logs Engine on / off
(motoring / motor-sailing / sailing - the polar must leave motor-sailing out); a repeat of the same state is
refused (409); the hour-meter reading is stamped AND set as the maintenance meter reading, and a reading below the
last one is refused (meters do not run backwards); each passage reports engine hours run (last minus first
reading).
