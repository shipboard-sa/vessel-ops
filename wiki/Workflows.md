<!--
Purpose: One entry per crew workflow in the mx-inv GUI - the screens it passes through, and where
  a "go find it / go create it elsewhere" detour used to be and how it is handled in place now.
Version: v11 (2026-10-08) - v11: workflow 10 - Work a Container v9 (ticks survive a change of target, contents list capped + foldable); all of v5-v9 LIVE 10-08. v10 (2026-10-08) - v10: workflow 10 - Move vs Add-extra pick for an item stowed elsewhere. v9 (2026-10-08) - v9: workflow 10 - Done with this container (un-ticked -> Unassigned). v8 (2026-10-08) - v8: workflow 10 - ticks on "In here now" = verified-here audit records (v6). v7 (2026-10-08) - v7: workflow 10 - Work a Container v5 (contents first, Unassigned add list). v6 (2026-10-07) - v6: workflow 10 - tick-list height, and the owner's Work a Container gap recorded. v5: workflow 19 (cockpit) current - Break / Incident writes the logbook, Depart / Arrive, alarms + mode, v39 additions; new workflow 21 (the desktop Ship's Log tab). v4 (2026-09-24) - v4: deploy 20 - workflow 4 gains the hour-meter pick on an hrs task; workflow 19 lists only the tiles the cockpit shows when configured (stale 'still shows edit controls' open item removed - tick-only since deploy 14b); workflow 20 (owner Settings) added. v3: SystemPicker v3 + ServesEditor v4 on the System › Device cascade. v2: ContainerPicker v4 (tap cascade). v1 (2026-09-23) written with the #74 (clickable to detail) + #76 (no-detour workflows)
  get-well pass (deploy 14).
Scope: PRODUCTION - engineering documentation for the mx-inv app; also the checklist to re-run
  whenever a screen is added or reworked.
Architecture: mx-inv wiki. The two rules and the shared pieces that enforce them are described
  first; each workflow then lists its screens (component names under frontend/src/features/).
  Design reasoning: Design-Decisions.md ("clickable to detail", "no-detour workflows").
Invocation: n/a (reference doc).
-->

# Crew workflows

## The two rules

1. **Clickable to detail (#74).** Anything on screen that has its own detail page opens it when
   tapped. A checkbox ticks, a name opens; one button never holds two records ("System — Task").
2. **No detours (#76).** A workflow runs in one pass. When a pick list lacks the entry you need, you
   create it right there, with minimal fields, and carry on with it selected. "＋ New …" is always
   the FIRST row, and pick lists stay type-to-search.

## Shared pieces that enforce them

| Piece | File | What it does |
|---|---|---|
| AppNav v3 | `components/AppNav.tsx` | `openRecord({kind,…})` opens an item / task / system / project / recipe / container on the tab that owns it; Back returns to the exact screen you came from (tab, sub-tab, trail, bucket, picked checklist). Each tab provides a **NavScope** saying how to describe "here" and what it can open in place. |
| Keep-alive tabs | `App.tsx`, `WarehouseView`, `GalleyView` | A tab or sub-tab stays mounted (hidden) once visited, so a trip elsewhere never loses unsaved ticks, counts or half-filled forms. |
| RecordLink / CheckRow / SystemTaskLabel | `components/RecordLink.tsx` | A tappable record name (plain text on the cockpit); a tick box and name as two targets; a system chip and task name as two targets. |
| SearchPick | `components/SearchPick.tsx` | Type-to-search pick list with the inline create form as the first row. |
| FoodPick / StuffPick | `features/warehouse/ItemPick.tsx` | Catalog item pickers over SearchPick + NewFoodItemForm / NewStuffItemForm. |
| ContainerPicker v4 | `features/warehouse/ContainerPicker.tsx` + `ContainerCascade.tsx` + `StorageColumns.tsx` | Button showing the full path; opens a full-screen Compartment › Location › Container tap cascade, "＋ New …" first in each column, ⭐ Favorites as chips on top, ☆ toggle per container. Edit Storage Structure (v5) is the same columns plus an edit panel; its moves pick the destination in the same columns. |
| SystemPicker v3 | `features/management/SystemPicker.tsx` + `SystemCascade.tsx` | Button showing "System › Device"; opens the System › Device tap columns (same kit as the container picker) with a search box on top; "＋ New system / device" first in each column; "✓ Use <system> itself" for no device. The item's "serves these devices" (ServesEditor v4) and the device screen's Move… / delete-reassign use the same cascade. |
| New-item forms | `NewFoodItemForm.tsx`, `NewStuffItemForm.tsx` | Minimal create (name, unit, kind); a name that already exists uses that item. Food also offers "Lives in" and "Put it on the shopping list". |

## Workflows

Each entry: screens in order, then what used to detour and what happens now.

### 1. Log a completed task (with parts used)
Schedule `TaskCard` → `TaskCardDetail` Complete panel (items to tick, performed by, outcome,
follow-ons). A task linked into a checklist: `ChecklistSteps` → `LinkConsumptionPrompt`.
- Item names sat inside the tick label (tapping the name ticked it) → CheckRow: box ticks, name opens.
- Only parts already on the task's list could be recorded → "＋ Used something else" (StuffPick).
- The follow-on's system was a plain list → SystemPicker. "Follow-on from X" opens X (`origin_task_id`).
- After logging, "Consumed", "Stock ran short" and "Raised N follow-ons" name records → each opens.

### 2. Add a past service record
Log tab → `HistoricalRecordForm` (system, performed by, invoice, outcome, follow-ons).
- System was a plain select → SystemPicker (new system/device inline).
- Invoice list had no "new" → "＋ New invoice…" opens `InvoiceForm` inline.

### 3. File an invoice / file an entry under one
`InvoicesPanel` → `InvoiceForm`; Log entry → `FileUnderInvoice`.
- "No invoices on file yet - add one under 'Invoices on file' first" → the invoice is made inline.
- Project list had no "new" → "＋ New project…" inline. The invoice's project name opens the project.

### 4. Create or edit a task
Management "+ New task" → `SystemPicker`; `TaskDetail` → `TaskNeeds`, `TaskReferencedBy`,
`TaskReferences`.
- "＋ new system" was the last option → first, and the list is searchable.
- Linking a related task meant a system select then a task select → one task search with "＋ New task".
- "Add as a step to a project / checklist" lists had no "new" → new project / checklist inline.
- The system half of a task-list row opened the task → it opens the device.
- An `hrs` task could not say which meter it counts against (nothing set `hours_meter`) →
  TaskDetail v4 shows an "Hour meter" select (engine / genset, labelled from Settings), default
  engine.

### 5. Build or run a checklist
`ChecklistSteps` (add step, import existing task, group) → `RunChecklistView` / cockpit.
- Linked-task rows were one "system — task" button → two targets.
- An included checklist's name only expanded it → the caret expands, the name opens it.
- From a step's details there was no way to the full task record or its system → both open, and Back
  returns to the same checklist and step.

### 6. Add a device and its parts
`SystemScreen` → Add device → part search (+ `NewStuffItemForm`) → Add task → device research.
- Already inline since #75. "device of X" now opens X; research "✓ Added" opens what was added;
  a research spare whose name already exists uses the existing item instead of failing.

### 7. Create a project and add tasks
`ProjectsView` → `ProjectScreen` → phases, add existing tasks, `NewProjectTaskForm`.
- Phase list was hidden when a project had no phases, and had no "new" → always shown, new phase inline.
- Task rows were one "system — task" button → two targets. "✓ Created X" opens X.

### 8. Add a catalog item
Warehouse Add New Stuff (`AddItemTab`: unit, food details / category, container).
- Container was one long select → ContainerPicker (tap cascade, new compartment / location / container inline). "Added X" opens X.

### 9. Edit an item (serves, tool links, accessories, stock)
Locker → `ItemDetailPanel` → `ServesEditor`, `ToolLinksEditor`, stock editor.
- Serves list had no "new device" → new device inline. Serves / tool chips open their records.
- A tool's record did not list its accessories → it does (`GET /items/{id}/accessories`), with
  "＋ Add accessory".
- A stock lot's place opens the Locker filtered to that container.

### 10. Stow items / work a container
Locker multi-select → `ItemStowPanel`; Work a Container (`StowByContainerTab`).
- No way to add an item that is not in the catalog → "＋ Add '<typed>'" first row, added ticked.
- Container pick → ContainerPicker.
- The tick list (shared with workflow 11) is `max(300px, 60vh)` tall - a fixed 300 px showed only 5-6 rows on the tablet (2026-10-07).
- Work a Container v5 (2026-10-08, Owner: "see what's assigned to this container first"): after the pick, **In here
  now (N)** lists the container's stock (quantity here, total aboard if more; names open the item), then **Add to
  this container** with a source pick - *From Unassigned (N)* (default; whole list, no cap; quantity defaults to all
  of it, and the stow moves it) or *From everything* (first 80 + Show all). "Select all shown" appears only while a
  search or type filter is on; rows already in this container are marked.
- v6 (the owner 2026-10-08): each "In here now" row has a tick box. **A tick is a lasting "verified here on <date>" record
  that counts as an audit** - an `audit_lines` row in the OPEN audit (system = counted = what is held there, all lots;
  stock untouched; `data.verify_in_container`). Un-tick removes it while it is still a pure verification. Each row
  shows "✓ verified here <date>" from any non-abandoned audit (`last_verified_on`). With no audit open, the screen
  offers "Start audit" inline. Closing the audit stamps the container's `last_audited_on`, as for any count.
- v7 (the owner 2026-10-08): **✔ Done with this container** - the items NOT ticked are listed in a confirm ("Not seen
  here: ...") with *Move N to Unassigned* / *Leave them here*. A move (`POST /api/items/move-to-unassigned`,
  `data.move_to_unassigned`) takes every row the item has here (plain merges into Unassigned's plain row, a lot into a
  matching lot, else re-homed) as 'transfer' pairs; an empty "lives here" row is just removed. **No audit line is
  written**, so the moved items stay on the open audit's still-to-find (unverified) list.
- **Move vs Add extra (the owner 2026-10-08, "no default"):** in the review panel (`ItemStowPanel` v2, Locker
  multi-select + Work a Container), a line whose item already has stock in another real container (not Unassigned,
  not the target) is outlined and must be decided before the button enables: *Move from <container> (has N)* - a
  true move, quantity defaults to all of it, refused if more than is there - or *Add as extra stock here (keep both)*
  - logged as 'manual_adjust' "found aboard", not a restock, shopping-list flag untouched. Items held only in
  Unassigned (or nowhere) need no pick: the stow still draws from Unassigned first. The Inventory Audit's tick list
  records counts, so it has no pick.
- v9 (the owner 2026-10-08): **changing the target container keeps the items ticked in the add list** (and the search /
  filters) - working down Unassigned he ticks an item he recognises, THEN picks the container it belongs in; the
  review panel re-checks each line's Move / Add-extra pick against the new target. **In here now** is capped at about a
  third of the screen (`.stow-here-list`, `max(160px, 32vh)`, its own scroll) and folds away from its heading, so a
  full container (48 items in Galley › Dry Pantry › loose) no longer pushes the add list off the screen; *Done with
  this container* stays visible when folded.
- All of v5-v9 + Move vs Add extra are LIVE since 2026-10-08 (laptop host, `logbook-page`, no schema change).

### 11. Count audit
`AuditTab` → active audit → tick list + count grid → finish.
- "Found something not in the catalog" was a separate form under the list → first row of the list.
- A container found on the walk could not be added → "＋ New container" inline.
- Names open the item; unsaved ticks survive the trip (keep-alive sub-tabs).

### 12. Parts review / spares fit check
Audit → unlinked parts, unlinked tool accessories, fit review.
- Headings and device names open their records; the Serves editor creates devices inline.

### 13. Restock (non-food)
Restock List → `AddToRestockPanel` → receive.
- "New item" was a button after the list with its own private form → the shared NewStuffItemForm as
  the first row; the new item goes straight on the list. Serves names open their devices.

### 14. Galley shopping and receiving
Galley Provisioning → add to list, receive, "needs a decision" table.
- Food picks were plain selects with a separate "new" button → FoodPick. List names open the item.

### 15. Add a recipe and link ingredients
Recipe Book → add → recipe → ingredients → review → cook.
- Already had "＋ New item…" first (#75); the long selects become FoodPick where they map cleanly.
- A new food item can now say where it lives and go on the shopping list in the same step.

### 16. Plan meals, pantry check, cook
Recipe "Add to meal plan" → Meal Plan entry → cook / pantry check; proteins.
- Protein pick had "new" last, or no "new" and hidden when there were no proteins → FoodPick protein.
- "Open it in the Recipe Book to parse ingredients first" → parse right in the entry.
- Recipes could only be added from the Recipe Book → "＋ Add a recipe to the plan" (new recipe inline).
- Pantry-check names sat in the tick label (a tick changes the shopping list) → CheckRow.
- The entry title and protein open the recipe / item; Back returns to the entry.

### 17. Lay-up / return
`LayupReturnTool` - no pick lists. Task rows were "system — task" inside the tick label → CheckRow
with two targets.

### 18. Research a device manual
Device screen → `DeviceResearchPanel` → review → apply. See workflow 6.

### 19. Cockpit (tablet / phone)
Home tiles: **Watch Handover** (pre-filled boat card, This watch, Log this watch with Observations, then the
"Watch Handover" checklist), **Run a Checklist** (tick-only), **Break / Incident** (kind, System > Device
cascade, one line + text, "when", optional fix task -> the logbook), **Depart / Arrive** (port, bound for),
and **Sail Plan** (only when this server can write SignalK; v39 always). Alarm banner + Ack on every screen,
boat-mode card on home, when the rules engine is configured. No cross-tab navigation by design: names render
as plain text there. v39 (`review-batch`) adds a "Signed by" pick on every form (default = the watchkeeper),
"Handed over by / Taking the watch", "First watch" at departure, and Engine on / off with the hour meter.
See [Cockpit-GUI](Cockpit-GUI.md).

### 20. Set up the boat (owner Settings)
Header "⚙ Settings" (or "⚙ Set up your boat" while the boat name is blank) → `SettingsDialog`:
boat name, engine and generator meter labels, manuals folder → Save. One dialog, no config file;
the header, printouts, telemetry widget, hour-meter pick and device research read it.

### 21. Read and keep the ship's log (desktop 📖 Ship's Log tab)
Day by day, newest first (period or from / to; kind; System > Device; deck-log lines on / off; engine TEST
events off by default) → tap an entry → full screen: Boat Instruments stamp, status chain, **add a status
update**, links to its system and fix task. **Failure register**: every failure grouped by its current status
(Broke / Parts Ordered / Deferred open; Accepted / Fixed collapsed). **＋ New entry** (the same crew kinds as
the cockpit). **⛵ Passages**: the leg under way, log a departure / arrival, every passage with duration,
logged distance and counts, **Print this passage**. **Print** a day or a range (`/api/report/logbook`, new
tab). Nothing in the log can be edited or deleted - a correction is a status update or a new entry.
Code: `frontend/src/features/logbook/` (LogbookView, PassagesView, useLogbook). v39 adds status changes on
the day they happened and, after completing a failure's fix task, the "Mark it Fixed" offer.

## Not linked on purpose
Search-picker rows (tapping picks), printed sheets and the history report (paper), sails and form
enumerations (not records), invoices / log entries / crew names (no detail page yet).
