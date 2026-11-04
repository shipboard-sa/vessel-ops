<!--
Purpose: Engineering wiki page - the mx-inv SQLite schema: every entity group, why it is shaped that way, triggers, FK behaviour, and the schema-version history.
Version: v9 (2026-10-18) - v9: version-history row v39 corrected to LIVE 2026-10-08. v8 (2026-10-08) - v8: review-batch (schema v39) merged + LIVE 2026-10-08. v7 (2026-10-07) - v7: rebuild-from-spec pass - schema v38 live / v39 on review-batch; new section 11 (the logbook: logbook_entries / _status_updates / _stamps / _passage_ends, v39 logbook_watch_turns + stamp columns); the migration runner (migrations/, v37 on) replaces the 'no framework' text; critical_spare_review documented (dormant); every trigger named; logbook FKs; v37-v39 migration rows. v6 (2026-09-24) - v6: schema v36 live (deploy 20) - tasks.schedule_from; seeds now only in _init_fresh (generic compartments, no crew names); owner Settings keys in system_config; first-run ensure_initialised(); v36 migration-table row. v5: the `favorite` paragraph describes the tap-column picker (favorites as chips). v4 (2026-09-23) - v4: event_kind / evidence_path now written (deploy 15). v3 (2026-09-23) - v3: schema v35 live (deploy 13) - recipe_ingredients.link_confirmed; migration-table row. v2: schema v34 live (deploy 10) - tasks.origin_completion_id (follow-on tasks, one history entry -> many) in the tasks outline, section 10, the FK list and a v34 migration-table row; outcome now captured. v1: first page header. Brought current to schema v33 in code / v32 live: new section 10 (maintenance history - task_completions full shape through v33, the append-only and cost-or-document triggers, crew_members, documents); systems and tasks blocks now list their v22/v23/v30/v32 columns; Triggers and FK sections completed; v33 row added to the migration table (and a stray blank line that split that table removed).
Scope: PRODUCTION - documentation for the live mx-inv app (<your-project-dir>).
Architecture: mx-inv engineering wiki (wiki/Home.md is the index). Describes db_schema.py, the canonical DDL; the WHY behind decisions lives in Design-Decisions.md. Update in the same session as any schema change.
Invocation: n/a (reference doc).
-->

# Schema

Single source of truth: `db_schema.py` (all DDL, idempotent `CREATE TABLE IF
NOT EXISTS`). Current version: **v39, live** (branch `logbook-page`; the logbook v37 + passages v38, 2026-10-05,
section 11; **v39 = the Ship's Log review, merged + live 2026-10-08** -
`logbook_watch_turns`, two stamp columns, kinds `sail` / `engine` - marked "v39" below).
Tracked in `system_config` (key `schema_version`). 38 tables, 4 views, 22 triggers at v38 (39 / 4 / 24 at v39).

**How a database gets to the current version** (three paths, never mixed up):

- **Fresh install**: `_init_fresh()` creates every table at the code's `SCHEMA_VERSION` (plus the generic
  compartment seed). Called at app start by `db_schema.ensure_initialised()` only when the file is missing,
  zero bytes or has no tables; a file with ANY tables is left alone.
- **v37 and later - the migration runner** (`migrations/`, hardening phase 2, 2026-10-05). Baseline = v36. Each
  version is a module `migrations/vNNN_<name>.py` exposing `migrate(conn)`, registered in `migrations.STEPS`.
  `db_schema.ensure_current()` runs it **at every server start** (`backend/main.py`, after
  `ensure_initialised()`): when the file is behind, it first takes ONE **verified backup**
  (`<db>.bak-premigrate-v<current>-<stamp>`, e.g. `vessel_local.db.bak-premigrate-v37-20261005-192607`: backup API,
  `integrity_check` ok, every table's row count equal), then applies each missing version in its own transaction,
  bumps `schema_version`, and commits only after `foreign_key_check` is clean. A database below v36 is refused
  (run the old scripts first). A step
  may declare `fk_off` (a table rebuild: foreign keys off for that step, proven by `foreign_key_check` before
  COMMIT - v38 uses it). A failing step rolls back and stops the server. **A database NEWER than the code is
  refused** (`migrations.SchemaTooNew`, the server will not start) - this protects a rollback: older code must
  never run on a newer file; restore the matching backup instead. Manual use:
  `.venv\Scripts\python.exe -m migrations [--apply] [--db PATH]` (dry run on an in-memory copy by default).
  `tests/test_migrations.py` pins all of this, including `SCHEMA_VERSION == migrations.target_version()`.
- **v7-v36 (history)**: one-off scripts `scripts/oneoff/migrate_schema_vNN.py`, each run once against
  production (dry run on an in-memory copy, then `--apply`, own `.bak-*`). They are kept as history and are not
  re-runnable; a database older than v36 must be brought to v36 with them in order before the runner takes over.
  No Alembic.

**Adding a version**: write `migrations/vNNN_<name>.py` (`migrate(conn)`, additive where possible; a CHECK
change needs SQLite's 12-step table rebuild with `fk_off`), register it in `STEPS`, bump
`db_schema.SCHEMA_VERSION` and the DDL in `db_schema.py` so a fresh install equals a migrated one, add a test
that migrates a copy of the previous version and checks every row and trigger survives, add a row to the table
at the end of this page.

**Seeds live in `_init_fresh()` only** (since the release package, 2026-09-24):
`create_schema()` is re-run by every migration against an existing boat, so it must not
insert boat data. The compartment list is seeded by `_init_fresh()` alone, and there is no
crew seed any more. `db_schema.py`'s own
docstring names the core model:

> - `items` — the catalog: what a thing **is** (identity + type + unit).
> - `stock` — physical instances: where an item **is** and how much, with
>   per-lot expiry/opened tracking for perishables.
> - `*_details` — class-table inheritance; one optional 1:1 satellite per
>   item type that carries extra attributes.
> - `task_items` — maintenance tasks → required catalog items.
> - All physical spaces live in `compartments` → `storage_locations` →
>   `storage_containers`.

## Entity groups

### 1. Physical spaces

```
compartments (compartment_id PK, compartment_name UNIQUE, sort_order)
      │
      └─< storage_locations (location_id PK, location_name,
                              compartment_id FK NOT NULL)
                              UNIQUE(compartment_id, location_name)
                │
                └─< storage_containers (container_id PK, location_id FK,
                                         container_name, container_type,
                                         last_audited_on, favorite)
                                         UNIQUE(location_id, container_name)
```

`container_type` is a CHECK enum (`dry`/`refrigerated`/`frozen`/
`tool_storage`/`tankage`) — small, stable set, unlike `item_type` below.

**Vocabulary — Compartment › Location › Container** (normalized 2026-09-18;
use exactly these three words in the UI, the API and the docs). A
**compartment** is a space on the boat (Salon, Galley, Master Berth). A
**location** is a place inside one (Port Cabinet - AFT, Freezer AFT). A
**container** is the actual thing stock sits in (a bin, drawer, freezer) —
or `loose`, the default container every location gets when it is created
(`data.add_location`), meaning "stowed straight in the location, no bin".
Every "where is it" label shows the full path, `Galley › Freezer AFT ›
loose` (`data.py`'s `stowed_at`/`locations` strings, `container_options`,
`ContainerPicker.tsx`, the expiry tables).

**Location names are unique per compartment, not globally** (v20). With the
compartment prefix stripped from names ("Master Berth - Port Cabinet - AFT"
→ "Port Cabinet - AFT"), a bare name like "AFT Cabinet" or "Port" is
legitimately reused across compartments; only the (compartment, name) pair
identifies a location. That is also why every location label carries its
compartment.

**Deleting is guarded so nothing is orphaned.** `data.delete_location`
removes a location and its *empty* containers (`ON DELETE CASCADE`) but
raises `StorageInUseError` (HTTP 409 with the blocking containers) if any of
them still holds stock; `delete_container` has the same guard. Without it a
delete would silently null out `stock.container_id` (`ON DELETE SET NULL`)
and lose where the stuff physically is. `data.find_orphaned_storage()` is
the spot-check (containers without a location, locations without a
compartment, stock without a container); the v20 migration ran it and
requires all three to be empty.

**`compartments`** (schema v19, 2026-09-17): the top-level physical
grouping above a location — on this boat Sail Locker, Anchor Locker, Chain Locker,
Deck, Cockpit, Lazarette, Port Berth, SB Berth, Salon, Galley, Master
Berth, Nav Station, Tool Room, Day Head, Master Head, Engine Room, Dinghy
(a flat lookup table — one level, no self-referencing parent unlike `systems`).
`db_schema.COMPARTMENTS` is now a **generic** 11-entry starter list (Cockpit, Deck,
Engine Room, Galley, Salon, Nav Station, Forward Cabin, Aft Cabin, Head, Lazarette,
Anchor Locker) inserted only by `_init_fresh()` on a new database; this boat's rows
are data, untouched by migrations. Added because the ~66 existing
location names had already collapsed this concept into inconsistent
free-text prefixes ("Master Berth - Port Cabinet - AFT", "Salon Couch -
AFT Upper", "Salon Cabinet - Middle" all meaning the same compartment) —
Owner: "I think we want a compartment level layer... I think it will clean
up the naming convention significantly." Every location must belong to
exactly one compartment (`compartment_id NOT NULL`, unlike
`systems.parent_name` which is optional) — the owner confirmed no orphan
locations, "for now everything should exist in a compartment."
`StorageStructureTab.tsx` nests three levels deep (Compartment → Location
→ Container, the same "parent shows its children on expand" pattern used
elsewhere), and each location has a "move to compartment" picker inline.
`migrate_schema_v19.py` dropped two empty leftover-Beneteau (the previous
boat) locations with no your vessel equivalent ("V-Berth",
"V-Berth Locker Compartment") rather than mapping them.

**`favorite`** (schema v18, 2026-09-17): a generic "quick pick" flag, not
food-specific, set per-container from the Storage Structure editor (a ⭐
checkbox on each container row). Every container picker in the app
(`ContainerPicker.tsx`, v4 2026-09-24: the `ContainerCascade` overlay) shows
the favorites as "⭐" chips above the Compartment › Location › Container columns, instead of one flat ~100-location list every
time. Deliberately generic rather than a hardcoded "food storage"
category: at the time this was built only 5 containers held any food at
all (the two planned large provisioning freezers didn't exist as
containers yet), so a food-specific category would need constant upkeep
as containers get built - an unfavorited container (deep storage, a
bulk-refill item like a spare can of cooking oil) is just one scroll away
in the same dropdown, not hidden behind a mode switch.

### 2. Catalog / inventory (the core model)

```
item_types (type_key PK, label, description, sort_order)      — lookup
stocking_policies (policy_key PK, label, description, sort_order) — lookup
units (unit_key PK, label, dimension CHECK IN (count, volume, mass,
       length, other), description, sort_order,
       offered CHECK IN (0,1) DEFAULT 1)                       — lookup (v21)

items (item_id PK, item_name, item_type FK→item_types,
       unit FK→units NOT NULL DEFAULT 'ea',
       min_quantity, target_quantity,
       stocking_policy FK→stocking_policies,
       annual_usage, reorder_buffer, min_hold, notes)
       UNIQUE(item_name, item_type)
   │
   ├─< stock (stock_id PK, item_id FK, container_id FK→storage_containers,
   │          quantity, expiry_date, opened_on, lot_note,
   │          acquired_on, vendor, unit_cost)
   │      unique index: one row per (item_id, container_id) UNLESS the row
   │      carries an expiry_date or lot_note — perishables/lots opt out of
   │      the "one row per bin" constraint on purpose.
   │
   ├── part_details (item_id PK/FK, manufacturer, part_number, oem_ref,
   │                 fits_system)              — 1:1, only for item_type='part'
   ├── food_details (item_id PK/FK, category, stowage_state, shelf_life_days,
   │                 calories_per_unit, provision_qty,
   │                 provision_basis_people/days, scales_with_crew)
   │                                            — 1:1, only for item_type='food'
   └── tool_accessory_details (item_id PK/FK, parent_tool_item_id — UNUSED since v29, see below,
                                spec)           — 1:1, only for item_type='tool_accessory'

tool_accessory_tools (accessory_item_id, tool_item_id, both FK→items, PK on the pair) — v29,
   many-to-many: which tool(s) an accessory belongs to. Same shape as item_systems below;
   replaces tool_accessory_details.parent_tool_item_id (an accessory can fit more than one tool -
   same-size sanding discs across two sanders - see wiki Design-Decisions.md
   #accessory-tool-many-to-many). The old column is left in place, unused, not dropped.
```

**`critical_spare_review`** (v5: `item_id` PK/FK→items `ON DELETE CASCADE`, `criticality` IN
(propulsion, safety, habitability, cosmetic), `has_redundancy` 0/1, `field_repairable` IN (full,
partial, none), `lead_time_note`, `reviewed_on`) is in the DDL but **dormant**: nothing in `data.py`,
`backend/` or the frontend reads or writes it (only the v5 / v10 migration scripts touch it). It was the
Streamlit-era detail for the `critical_spare` stocking policy. Keep it (dropping a table is a
migration); do not build on it without a fresh decision.

**`food_details` provisioning columns**: `provision_qty` is the desired quantity for
`provision_basis_people` (default 2) over `provision_basis_days` (default 14); the provisioning plan scales it
by the cycle length entered at run time (`data.provisioning_plan()`, the baseline half of the food cart:
`cycle_factor = days / provision_basis_days`) and, only when `scales_with_crew` = 1, by the crew count
(`crew / provision_basis_people`).

**An item can live in any number of containers at once** — this was true
from the original design, not something added later. `items` is catalog
identity (what a thing *is*); `stock` rows are physical instances (where
some of it *is*, and how much). Chicken breast split across two freezers,
or a set of engine spares kept both in an E/R locker and a deep-storage
backup, are each just two ordinary `stock` rows with different
`container_id`s — no special-casing anywhere. `v_item_onhand` (`SUM(s.
quantity) ... GROUP BY item_id`) rolls the total up across every
container automatically, so every consumer of `quantity_onhand`
(Locker, Item Detail, Restock List, both shopping carts, recipe
consumption, the expiring tables) already sees the true cross-container
total; the Locker list's `locations` column (`group_concat(DISTINCT
location/container)`) shows every container an item currently sits in on
one row rather than splitting it into several confusing rows. Confirmed
(2026-09-17) by reading the actual view/query definitions, not recalled.

**Why lookup tables, not CHECK-constrained enums, for `item_type` and
`stocking_policy`** (schema v12): originally both were hardcoded SQL CHECK
enums. Twice in one working session the owner needed a category that didn't exist
yet (`gear` item type, `owned` stocking policy) — each would have required a
schema migration under the old design. `item_types`/`stocking_policies` are
now data: adding a category is an `INSERT`, and `label`/`description` are
the single source of truth for the explanatory text every picker UI shows
(previously duplicated in a frontend TypeScript dict, `policyHelp.ts`,
removed once the frontend switched to fetching these live). `item_id`
itself still isn't a hardcoded enum-per-type; the type check lives at the
FK level, not a `CHECK (item_type IN (...))`.

**`units` — a governed picklist, not free text** (schema v21, 2026-09-18).
`items.unit` and `recipe_ingredients.unit` were free text, so `each`/`ea`,
`cup`/`cups` and `Pinch`/`pinch` had drifted into duplicates; both columns
are now foreign keys to `units(unit_key)`. `unit_key` is a natural key —
it is the short text the two columns store and the UI shows (`ea`, `tbsp`,
`fl oz`), the same idea as `systems.name` — so nothing about how a unit
prints changed. Columns: `label` (readable form, "teaspoon"), `dimension`
(`count`/`volume`/`mass`/`length`/`other`), `description`, `sort_order`, and
`offered` ("shown in pickers"; `0` = a legacy unit that stays valid so
existing rows keep saving, but is not offered for new picks). `dimension` is
a fact about the *unit* (a `cup` is volume whichever item uses it), which is
why it lives here rather than on `items` (3NF: no fact about a unit is
stored on the rows that merely use it). It is stored today for two
reasons: it lets the UI warn when a recipe line and its catalog item
disagree in dimension (cups vs. lb), and it is what a future conversion
feature will hang off — conversion itself is deliberately **not built**
(see [Design Decisions](Design-Decisions.md#units-are-a-governed-picklist)).
**`items.unit` is `NOT NULL DEFAULT 'ea'`; `recipe_ingredients.unit` is
nullable and NULL means "no unit stated / the item's own count", not
"unknown".** The seed is 36 **imperial** units by decision (the owner,
2026-09-18, "we are a US boat"): count (`ea pair set kit pack pkg box case
bag bottle can jar tube roll spool loaf block stick slice clove bunch
head`), volume (`tsp tbsp fl oz cup pt qt gal`), mass (`oz lb`), length
(`in ft yd`), other (`pinch dash`). The two metric keys still used by live
items — `kg` (Flour, Ground beef, Oatmeal, Rice, Salt, Sugar) and `L` (Olive
oil, UHT milk, KM4A2 marine gear oil) — exist as **legacy rows**
(`offered = 0`, description "Legacy metric - convert items to imperial,
then delete") only in the migrated production database; a fresh install
never has them. Their quantities were **not** converted; once those nine
items are converted by hand, `data.delete_unit` removes the legacy rows
(it refuses while anything still uses a unit). Validation lives in
`data.py`: `create_item`/`update_item`/`save_recipe_ingredients` reject a
unit that is not a `units` row with a readable error (HTTP 422, with a
"did you mean" when the text is just a variant, e.g. `each` → `ea`) —
existing non-offered units are still accepted, so an unrelated edit to
Flour still saves. Renaming a `unit_key` cascades to both tables in one
transaction (`data.update_unit`, same `defer_foreign_keys` technique as
`rename_system`).

**Why `stock` allows multiple rows per item**: an item's *identity* (catalog
row) is separate from its *physical instances* (stock lots). One item can
have stock in several containers, and perishables can have several
expiring lots in the *same* container — the partial unique index
(`WHERE expiry_date IS NULL AND lot_note IS NULL`) is what prevents
accidental duplicate "plain" stock rows while still allowing that.

**Why `*_details` and not one wide `items` table**: class-table inheritance
— most items need none of the type-specific columns (a `supply` or `tool`
item has no `food_details` row at all), so a 1:1 satellite table keeps
`items` itself narrow and keeps type-specific validation obvious (a
`fits_system` column only ever means something for `part`).

### 3. Systems (the equipment picklist)

**Vocabulary - System > Device** (the owner, 2026-09-18: "I like the term DEVICE for
the actual item, system is the collection of devices / parts etc that
'performs' the function"). A **system** is the top-level entry that performs a
function (Propulsion, Fresh Water System, Bilge & Drains, Raw Water). A
**device** is one actual piece of equipment nested under it (Main Engine,
Shower Sump Pump, Salon Bilge Pump). The table is still `systems` with a
`parent_name`, and the task editor already labels the two pickers "System" and
"Device". **Devices are named by what they DO, not by make or model** (the owner,
2026-09-18, applied to every device): "Main Engine", not "Yanmar 4JH80". Model
numbers live at the *item* level (the catalog, for spare-parts ordering: the
spare pump, the service kits, an `owned` item per installed pump model) and, as
reference, in each device's `notes` ("Make / model: ..."). The keyword map in
`backend/vessel_log.py` keys on these names, so a rename must keep resolving
(`_FUNCTION_KEYWORDS`).

```
systems (name PK, parent_name FK→systems(name) ON DELETE SET NULL,
         sort_order, notes,
         make_model, manual_ref, installed_qty (>=1),
         no_spares_needed (0/1),                       — v22 device details
         installed_on, serial, warranty_until)         — v32 device identity
```

**Device identity (v32, tracker #44)**: `installed_on`, `serial` and
`warranty_until` (all optional TEXT) are facts about the physical unit, as
opposed to its service history - a per-device history report is about a
specific unit, so it has to be able to say which one. They show on the device
screen and in the printable report's header, with an in/out-of-warranty hint.
Most devices have none recorded yet; the numbers come off nameplates at the
audit walk.

One-level-deep, self-referencing hierarchy (schema v14) — e.g. "Seaflo
Series 51 Water Pump (3)" and "Rheem Hot Water Heater 6G" both nest under
"Fresh Water System". `name` is the natural key (not a surrogate integer
id), so renaming a system means updating this table **and** cascading the
new name into every `tasks.system` row that references it
(`data.rename_system` does this atomically). `parent_name` is nullable and
defaults to ungrouped — grouping was a deliberate, later, opt-in content
pass (see [Design Decisions](Design-Decisions.md)), not something any
migration guessed at.

**Two things that are deliberately *not* systems** (cleanup 2026-09-18,
`scripts/oneoff/cleanup_systems_20260918.py`): a *punch list* and a *checklist*.
14 systems had been named "Punch List — Rigging/Electrical/Genset…" and 16
had been named after a checklist ("Pre-Passage Checklist"…), so they showed
up in Systems like equipment. Punch-list-ness is a **project** (#3
"Pre-Departure Punch List", #4 "Refit Wrap-Up" already held these tasks);
each task now sits under the real system it concerns, with the old
discipline kept as its phase tag (`checklist_group`). A checklist's steps
live under the shared `Checklists` system and belong to their checklist via
`parent_task_id`. See [Design Decisions](Design-Decisions.md#punch-list-is-a-project-and-a-checklist-is-not-a-system).

This table replaced 116 distinct free-text values previously typed directly
into `tasks.system`. A follow-up content audit (naming-convention scan +
normalized-name duplicate scan) found the pre-migration data was already
clean — nothing needed correcting once the picklist existed.

### 4. Tasks (defined in `db_schema.py`'s `_init_fresh`, not the DDL tuples)

```
tasks (task_id PK, system FK→systems(name), task_name, task_description,
       period, interval_type, last_completed_date, caution_notes,
       deferred_units, is_critical, hours_at_completion, hours_meter,
       task_kind CHECK IN (recurring, one_off, checklist),
       project_id FK→projects, parent_task_id FK→tasks (self, cascade),
       sort_order, checklist_group,
       phase_id FK→project_phases (SET NULL),          — v23
       retired_at, retired_reason,                     — v30, NULL = active
       origin_completion_id FK→task_completions,       — v34, NULL = not a follow-on
       schedule_from TEXT date)                        — v36, NULL = old 90-day rule
   │
   ├─< task_items (task_id, item_id FK→items, quantity_required,
   │               amount_note)         PK(task_id, item_id)
   ├─< task_references (ref_id PK, task_id FK, kind CHECK IN
   │                     (manual,standard,url,video,form,note,task),
   │                     label, file_path, page, url, note,
   │                     ref_task_id FK→tasks,     — see task-to-task refs below
   │                     sort_order, checklist_group,  (v27: a link's place/group)
   │                     done_completion_id FK→task_completions) (v27: per-run tick)
   └── (self) parent_task_id — a checklist's steps are tasks with
        parent_task_id = the checklist's own task_id
```

**`hours_meter`** ('engine' | 'genset', `data.HOURS_METERS`) says which meter an `hrs`
task counts against. Settable from the app since deploy 20 (create/update task, TaskDetail's
"Hour meter" select); an `hrs` task with none defaults to 'engine'
(`data._resolve_hours_meter`); a bad value is a 400. Validated in `data.py`, no DDL CHECK.

**`schedule_from`** (schema v36, 2026-09-24): for a task that has **never been done**, the
day its schedule clock started - it first comes due one interval after that day. Ignored
once `last_completed_date` is set; NULL keeps the original "never done = done 90 days
ago" rule, which is what every live task has (nothing backfilled). The starter-pack loader
stamps it with the load day. The rule itself is `data.task_baseline_date` - see
[Logic-Flows](Logic-Flows.md#20-never-done-baseline-schema-v36).

**`retired_at` / `retired_reason`** (schema v30, 2026-09-22, tracker #66): a retired
task keeps its master row but drops out of the schedule projection
(`backend/scheduling.py`, filtered exactly like `parked`) and out of every task pick
list (`list_importable_tasks`, `list_linkable_tasks`). `NULL` = active. It exists
because a hard delete severs `task_completions.task_id` and `stock_movements.task_id`
and CASCADE-deletes the task's steps, which costs the maintenance log its thread back
to the job - see [Design-Decisions](Design-Decisions.md#retire-not-delete).
`data.delete_task` now refuses a task with any logged history in its subtree unless
`force=True` (scripts only).

**`origin_completion_id`** (schema v34, 2026-09-22, tracker #44) marks a **follow-on
task**: the history entry (`task_completions` row) whose job found a problem or was
only partly done, and raised this task. One completion → MANY follow-on tasks (Owner:
"it is likely a 1 to many"). A follow-on is otherwise an ordinary row - `one_off`,
`interval_type='break_fix'`, `period='immediate'`, the job's own system/device unless
another was picked. Indexed (`idx_tasks_origin_completion`); no `ON DELETE` clause,
because history rows are never deleted. The link lives on the task, not on the
completion, so the append-only history is never edited - see section 10 and
[Design-Decisions](Design-Decisions.md#follow-on-tasks). `NULL` = an ordinary task.

`interval_type` is one of `days` / `hrs` / `use` / `break_fix` (not a
CHECK-enforced enum in the DDL — validated in `data.py`/frontend instead).
This field, combined with `period`, drives the entire scheduling projection
— see [Logic Flows](Logic-Flows.md).

**Checklists are not a separate table.** A checklist is a `tasks` row with
`task_kind='checklist'`; its steps are ordinary `tasks` rows with
`parent_task_id` pointing at it. This is the schema-level expression of the
"unify Task Management and Checklists" decision made at the start of the
rewrite — one editing model, one API surface
(`/api/tasks/{id}/checklist/...`), not two parallel table families.

**`task_references.kind='task'`** (schema v13) is a task-to-task
cross-reference — `ref_task_id` points at another task. Three UI features
reuse this single mechanism: a checklist "including" another checklist
inline (rendered, not copied), a recurring task that "triggers" a checklist
run, and Management's clickable reference list with a navigation-history
stack. A content sweep converted ~29 old prose mentions ("see #432") into
real rows of this kind.

**A task LINKED into a checklist (v27, tracker #48)** is a `kind='task'` reference whose
owner is a checklist and whose target is a non-checklist task: one master task row that also
lives in that checklist. `sort_order` shares the checklist's step numbering (steps use
`tasks.sort_order`; `data._next_checklist_position` numbers both, and first gives any
un-numbered older step an explicit number in its display order), `checklist_group` is its
sub-list group, and `done_completion_id` is the per-RUN tick: the `task_completions` row the
tick recorded on the master. The link counts as done only while that completion is not voided;
Reset checklist sets it NULL (the completion stays in history). A link to a *checklist*
(inclusion / "runs a checklist") has no order and stays a separate block.

### 5. Projects

```
projects (project_id PK, name, description,
          kind CHECK IN (haul_out, refit, campaign, service_period, other),
          status CHECK IN (planned, active, done, cancelled),
          target_start, target_end, notes)
   │
   └─< tasks.project_id  (a task "parked" on a project)

project_phases (phase_id PK, project_id FK→projects ON DELETE CASCADE, name NOT NULL,
                sort_order, notes, target_start, target_end, UNIQUE (project_id, name))   — v23
   └─< tasks.phase_id  (nullable FK, ON DELETE SET NULL)
```

**Phases (v23)** are a per-project, ordered list of stages (haul-out, yard work,
pre-splash ...) with notes and optional target dates - a bucket with notes, no done
state, no dependencies (deliberately not a scheduler). A task's `phase_id` must belong
to the task's own project: triggers `trg_tasks_phase_ins` / `trg_tasks_phase_upd` refuse
a phase of another project, and `trg_tasks_phase_clear` clears the phase when the task
moves to another project or leaves its project. The old `tasks.checklist_group` tags on
project tasks (Rigging, Electrical ...) are kept untouched but no longer shown on the
project screen. See [Design Decisions](Design-Decisions.md#project-phases).

A task on a `planned`/`cancelled`-status project is **parked** — excluded
from the rolling schedule buckets entirely (see
[Logic Flows](Logic-Flows.md)) but still gets a projected due date via
`all_projected` for views like the send-out queue. There is no "finish
project" event in the data model — a project is just a grouping bucket;
individual task completions carry which project they belonged to (for
audit/log purposes), not the other way around.

### 6. Stock movements (audit trail)

```
stock_movements (movement_id PK, item_id FK, stock_id FK (nullable),
                  delta, reason CHECK IN
                    (task_consume, restock, manual_adjust, audit_fix,
                     expire, transfer, recipe_consume),
                  task_id FK (nullable), audit_id FK (nullable),
                  recipe_id FK (nullable), occurred_on, vendor,
                  unit_cost, note)
```

Every quantity change to `stock` that matters for provenance goes through
this table — a ledger, not just a mutation. `recipe_consume` (v15) is the
newest reason, added when the recipe book gained real ingredient-to-stock
draws.

### 7. Inventory audits

```
inventory_audits (audit_id PK, name, scope, status CHECK IN
                    (in_progress, complete, abandoned), started_on,
                    completed_on, notes)
   │
   └─< audit_lines (audit_id, item_id, container_id, system_qty,
                     counted_qty, verified_on, note)
                     PK(audit_id, item_id, container_id)
```

`scope` is a free-text convention (`full` / `location:<id>` /
`system:<name>` / `critical_spares`), not a CHECK enum — documented in
`db_schema.py`'s `AUDIT_SCOPES_NOTE` constant rather than enforced in SQL.

### 8. Recipes / galley

```
recipes (recipe_id PK, title, source, servings, body, notes)
   │
   ├─< recipe_tags (recipe_id, kind CHECK IN (ingredient, method, tag), tag)
   │                PK(recipe_id, kind, tag)
   └─< recipe_ingredients (recipe_ingredient_id PK, recipe_id FK,
                            item_id FK→items (nullable), raw_text,
                            quantity, unit FK→units (nullable), is_bulk,
                            sort_order)
```

`recipe_ingredients` (schema v15) is the "parse once, reuse forever" layer:
a heuristic parser (regex line/qty/unit extraction + `difflib` fuzzy match
against the food catalog) runs once per recipe on first review; a human
confirms/corrects the match; every future "cook this" reuses the saved
row instead of re-parsing. `item_id` is nullable on purpose — an ingredient
can be deliberately unlinked (spice-jar bulk items, or a genuinely
unmatched raw line) and still display correctly. `is_bulk` splits
ingredients into two consumption behaviors: direct-consumption ingredients
draw real stock via a `recipe_consume` stock_movement; bulk/pantry-staple
ingredients are reference-only, never drawn down.

**Ingredient units** (v21): `recipe_ingredients.unit` is a `units.unit_key`
or NULL (= none stated). `data.parse_recipe_ingredients` suggests it as
follows — a recognised unit word maps to its canonical key (`Cups` →
`cup`, `tablespoons` → `tbsp`); a bare number with no unit ("6 apples",
"1 large onion") suggests `ea`; a line with no number ("salt to taste") or an
unrecognised unit word leaves NULL, and `raw_text` always keeps the original
wording. A line pasted in **metric** ("500 g flour", "250 ml milk") comes back
already converted to imperial, with the new parse-row field
`converted_from` holding the amount as written (`"500 g"`; NULL when nothing
was converted) so the review screen can show what happened. This conversion
exists only in the parse suggestion — `data.metric_to_imperial`, a pure
helper — and what is saved is whatever the reviewer confirms, validated
against `units` like any other write. Rules and factors are in
[Design Decisions](Design-Decisions.md#units-are-a-governed-picklist).
The cook result (`make_recipe`, and so the meal-plan "made it" response)
reports the **catalog item's** unit as `unit` — the unit stock is counted in
— and the recipe line's own unit as `recipe_unit` (NULL for extras or
lines with no unit).

**Food details, provisioning and bulk (v24-v25).** `food_details.provision_mode`
(`undecided` default / `baseline` / `recipe_only`, NOT NULL, CHECK) is the explicit
provisioning decision; `provision_qty` is set (> 0) only for `baseline` and NULL otherwise
(triggers `trg_food_mode_ins` / `trg_food_mode_upd`). An item with no `food_details` row
reads as `undecided` through `v_food_catalog`. `recipe_ingredients.is_bulk` was **dropped**
(v24): bulk is `items.stocking_policy = 'bulk'` only, derived on read. `items.on_list_since`
(v25, TEXT, NULL = not requested) is the "we need more of this" request - set from the
pantry check / the cart's add box, cleared when stock is received. A **standing recipe**
("Pantry check - bulk staples", id in `system_config.pantry_recipe_id`) has one
`recipe_ingredients` line per bulk food item, re-synced whenever its ingredients are read.
See [Design Decisions](Design-Decisions.md#bulk-and-provisioning-modes) and
[#pantry-check-and-requests](Design-Decisions.md#pantry-check-and-requests).

**Recipes are never deleted without asking first** — a standing rule (see
the `recipe-book` project memory), which held even through the
merged-recipe split described below.

**The 19→207 merged-recipe split (2026-09-16)**: 19 original `recipes` rows
each secretly contained multiple recipes concatenated together (an import
artifact from the source cookbook — Chili alone had 47 sub-recipes). Split
into 207 new individual rows via a one-off script; the 19 originals were
retitled (`[collection - see N individual recipes]`) rather than deleted,
per the standing rule.

**`meal_plan`** (schema v16, + `overrides` in v17, 2026-09-17):

```
meal_plan (meal_plan_id PK, recipe_id FK→recipes, planned_for (nullable date),
           notes, overrides (nullable JSON), created_at)
```

A pure working list crew member picks recipes onto, deliberately carrying no
history of its own — unlike `recipes`/`recipe_ingredients`, a `meal_plan`
row is never soft-retired, it's just deleted, in both terminal states:
"made" (calls `make_recipe()` — the real record lives in `stock_movements`
via the existing `recipe_consume` reason, same as cooking a recipe
directly — then the row is removed) and "cancelled" (deleted outright, no
stock effect, nothing preserved — plans change and there's nothing to
audit since nothing was drawn).

**`overrides`** (v17) is a JSON list of the same `{recipe_ingredient_id?,
item_id, quantity?}` picks `make_recipe()` itself accepts — either a
swap of which catalog item a saved ingredient line draws from
(`recipe_ingredient_id` + a different `item_id`), or an ad-hoc extra with
no `recipe_ingredient_id` at all (a second protein, or an item not
normally in the recipe). This is the swappable-protein/base-recipe case
(Chef's Salad, Mac & Cheese — one recipe, the protein varies per cook) —
without it, each protein variant would otherwise need its own duplicate
recipe. `data.save_meal_plan_overrides()` persists a pick set while
*planning* the menu, drawing no stock; a saved override changes what the
plan needs, which in turn feeds `data.food_cart()`'s merged shopping list
(see [Logic Flows](Logic-Flows.md#9-the-merged-food-cart-datafood_cart)
— superseded `meal_plan_shopping_list()` as the actual day-to-day
shopping surface, 2026-09-17) — the "feeds the provisioning shopping-cart
workflow" half. `make_recipe()` (called by "Made it", pre-filled from the
same saved overrides but still editable at cook time) covers the "feeds the
inventory draw-down workflow" half. Both halves needed this — the owner,
2026-09-17: "this function is needed at both plan the menu stage... and
at make the recipe time."

### 9. Lookup / config

```
telemetry_cache (metric PK, value, unit, source, observed_at, synced_at)
system_config (key PK, value)   — schema_version, provisioning basis,
                                   resupply_lead_days, engine/genset
                                   hours-per-year defaults; owner Settings
                                   (vessel_name, engine_label, genset_label,
                                   manuals_root - deploy 20)
crew_members (crew_key PK, display_name, kind CHECK IN (person, vendor),
              sort_order, offered CHECK IN (0,1))  — v32, see section 10
```

**Owner Settings** are plain `system_config` rows, no schema change: `data.SETTINGS_DEFAULTS`
lists the allowed keys and the default used while a key is unset or blank
(vessel_name '' / engine_label 'Main engine' / genset_label 'Generator' / manuals_root '');
`update_settings` refuses unknown keys. Live values: "SV Your Boat Name", "Yanmar",
"Westerbeke genset", `D:\Documents\sailboat\Manuals`.

### 10. Maintenance history and invoices (v26 → v34)

```
task_completions (completion_id PK,
   task_id FK→tasks ON DELETE SET NULL,
   task_name, system, project_name,               — SNAPSHOTS (text, not FKs)
   source CHECK IN (schedule, checklist, project, historical),   — 'historical' v31
   was_critical, interval_type, period,           — the rule in force
   completed_on (date logged), recorded_at,
   due_on, original_due_on, days_past_due, hours_past_due, deferred_units,
   hours_at_completion, engine_hours, genset_hours,
   previous_completed_on, previous_hours,         — so a completion can be undone
   notes,
   performed_by, vendor, cost,                    — v31
   outcome, evidence_path, event_kind, sent_at,   — v32
   voided_at, void_reason,
   document_id FK→documents ON DELETE SET NULL)   — v33
   │
   └─< task_completion_parts (part_line_id PK, completion_id FK,
                              item_id FK→items ON DELETE SET NULL,
                              item_name, part_number, quantity, unit)  — snapshots

documents (document_id PK, vendor NOT NULL, doc_number,
           doc_date, period_start, period_end,   — ISO dates
           total, file_path,
           project_id FK→projects ON DELETE SET NULL,
           expense_class, notes, created_at)      — v33
```

Indexes: `task_completions(recorded_at)`, `(task_id)`, `(document_id)` (v33);
`task_completion_parts(completion_id)`; `documents(doc_date)`;
`tasks(origin_completion_id)` (v34 - an entry's follow-on tasks).

Pointing the other way: `tasks.origin_completion_id` (v34) → `task_completions`
- the follow-on tasks an entry raised (one entry → many; section 4).

**`task_completions` is the boat's maintenance history and it is append-only.**
One row per completion (ticked on the Schedule, in a checklist or project, or -
`source='historical'`, v31 - a past service record typed in from paper, with
`task_id` NULL and every scheduling column NULL, which reschedules nothing).
Name / system / project are snapshots so the row survives the task being
renamed, moved or deleted. v31 had to REBUILD the table to widen the `source`
CHECK; v32 and v33 were plain `ADD COLUMN`s, which is why all of #44's remaining
schema went into v32 at once. See
[Design-Decisions](Design-Decisions.md#completion-audit-trail),
[#historical-service-records](Design-Decisions.md#historical-service-records),
[#remaining-44-schema-in-one-go](Design-Decisions.md#remaining-44-schema-in-one-go).

**v32 columns, validated in `data.py`, not by a DDL CHECK** (so a new value is a
code change, never another rebuild of the legal record - same house pattern as
`tasks.interval_type`): `outcome` is `done_ok` / `problem_found` / `partial`
(`db_schema.COMPLETION_OUTCOMES`); `event_kind` is `service` (what a NULL reads
as - every row before v32) / `grounding` / `survey` / `haul_out` /
`modification` / `incident` (`COMPLETION_EVENT_KINDS`); `evidence_path` is a
PATH under the sailboat folder, same idiom as a manual reference (there is no
upload machinery and none is planned); `sent_at` is when the row was forwarded
to the previous developer's log webhook, NULL = never (every row, until he provides an
endpoint). First written by the Log tab's past-service form in deploy 15 (2026-09-23); ticked completions still leave both NULL.

**`outcome` is captured from v34 (deploy 10)**: the Complete panel and the
past-service-record form ask "How did it go?"; `data._clean_outcome` validates it and
NULL (not stated) reads as done. Like every fact column it is immutable once written.
A `problem_found` / `partial` entry can raise follow-on tasks, which point back at it
through `tasks.origin_completion_id` - the history row itself is never touched. See
[Logic-Flows](Logic-Flows.md#18-task-outcome-and-follow-on-tasks-schema-v34).

**`trg_completions_append_only`** refuses any UPDATE that changes a fact column
(everything except `task_id`, `voided_at`, `void_reason`, `sent_at`,
`document_id`) and allows exactly four transitions, each with everything else
unchanged:

1. `task_id` → NULL, by the FK's `ON DELETE SET NULL` when a task is deleted;
2. **voiding**, once: `voided_at` NULL → a value (with `void_reason`);
3. `sent_at` NULL → a value, once (the app recording that it forwarded the row
   - it changes no historical fact);
4. (v33) `document_id` changing **on its own** - attach, move to another
   invoice, detach, or the FK's own SET NULL. Which piece of paper paid for the
   work is a filing cross-reference, not an edit of what happened.

`trg_completions_no_delete` refuses every DELETE; a mistake is corrected by
voiding it and recording the right one. `task_completion_parts` has the same
pair (its only allowed change is `item_id` → NULL via its FK). The v32
migration had to DROP and recreate the append-only trigger rather than rely on
`CREATE TRIGGER IF NOT EXISTS`, which would have kept the old column list and
left the new columns editable; v33 did the same.

**Cost OR document, never both (v33).** `trg_completions_cost_or_document_ins`
(BEFORE INSERT) and `trg_completions_cost_or_document_upd` (BEFORE UPDATE OF
`document_id`) refuse a row that has both its own `cost` and a `document_id`.
It is the double-counting guard: money for filed work lives once, on the
invoice. `data.add_historical_record(document_id=...)` and
`data.set_completion_document()` check the same rule first to give a readable
error, and `set_completion_document` also refuses to file a voided entry and
returns without writing when nothing would change (the trigger rightly refuses
a no-op filing). The design names `stock_movements.unit_cost` under the same
rule; that is a convention for whoever enters the data, not something the
schema enforces (stock movements have no `document_id`).

**`crew_members` (v32)** is the governed "who did the work" list - people and
vendors (`kind`); live has the owner + crew member (seeded at v32 - a fresh install now starts
with an empty roster); `offered = 0` drops someone from the
list without deleting them. **`performed_by` is a TEXT snapshot, NOT an FK to
it**: a history row stores the name as a fact, so the roster is transient and
freely deletable (nothing references it, nothing cascades), unlike `tasks`,
whose real FK from `task_completions` is why v30 added retire-instead-of-delete.
The box that fills it offers `data.list_performed_by_choices()` - the roster
UNION every non-voided `performed_by` already in the history, deduplicated
case-insensitively, still accepting anything typed. Deliberately not read from
routing's `config/crew.toml` (float-plan PII, different repo). See
[Design-Decisions](Design-Decisions.md#performed-by-pick-list).

**`documents` (v33) is the SPINE of a vendor invoice or receipt** - who
(`vendor`, required), which (`doc_number`), when (`doc_date`, or a
`period_start`/`period_end` for work spanning weeks - at least one of the three
is required, ISO dates, the period cannot end before it starts), the `total`
ONCE (rounded to cents; may be NULL if not known), where the paper is
(`file_path`, a path on disk, same idiom as a manual reference - not an
upload), an optional `project_id` (some invoices belong to a campaign, not a
single job - the Seabrook yard invoice and project #4 Refit Wrap-Up), a
free-text `expense_class`, and `notes`. Validation is `data._clean_document`.
Line items are deliberately not transcribed. One document covers MANY history
entries through `task_completions.document_id`; a document with none is
legitimate (money out, nothing received).

- **The date a document counts toward** is `COALESCE(doc_date, period_end,
  period_start)` - `data._DOC_DAY_SQL`, exposed as `doc_day`; the year view,
  the year list and sorting all use it.
- **It is an editable INDEX of paper, not the legal record.** `update_document`
  replaces its fields freely (fixing a mistyped invoice number corrects the
  index, not the past). `delete_document` is **refused while any history entry
  is filed under it** (voided ones included) - the FK would otherwise quietly
  detach them and break the substantiation chain without anyone deciding to.
- **`expense_class` is free text, never an enum.** `data.list_expense_classes()`
  offers back every class already used, grouped case-insensitively and named
  by its most-used spelling, most-used first - the same union idea as
  `performed_by`. The classes have to match whatever the owner types into his
  return, and a new one must never need a migration.
- **No number derived from this table is a year total.** `documents_year_view`
  (`GET /api/documents/year/{year}`, CSV at `.../csv`) groups a year's documents
  by expense class with a subtotal each, counts the documents with no total
  (`untotalled`) so a subtotal never looks more complete than it is, and labels
  the sum `on_file`; the UI heads everything "invoices on file". The card / bank
  statement is the financial authority. See
  [Design-Decisions](Design-Decisions.md#invoices-are-documents).

### 11. The logbook / ship's log (v37 → v39)

The boat's logbook (option C - mx-inv owns it; design `design/LOGBOOK_DESIGN.md`, rules in
[Logic Flows section 21](Logic-Flows.md#21-the-logbook--ships-log-schema-v37-v39)). Everything that is not a
planned job: crew failures / observations / incidents, the watch entry at handover, the rules engine's events,
the automatic deck log, departures and arrivals. **Append-only like `task_completions`**: no row in any of
these tables is ever updated or deleted (triggers below); a failure's progress is a chain of status rows.

```
logbook_entries (entry_id PK AUTOINCREMENT,         -- shown as LOG-00042 (computed: 'LOG-' || printf('%05d', id))
                 kind CHECK IN (failure, observation, incident, watch, event, status, departure, arrival
                                [v39: + sail, engine]),
                 occurred_at NOT NULL, recorded_at NOT NULL,
                 system_name FK→systems(name) ON UPDATE CASCADE (nullable),
                 severity CHECK IN (P1, P2, NUDGE, info) (nullable),
                 title NOT NULL, body, author,
                 source CHECK IN (cockpit, desktop, engine, import, auto) NOT NULL,
                 source_event_id UNIQUE (nullable), simulated 0/1 NOT NULL DEFAULT 0,
                 record CHECK IN (handover, log) (nullable),
                 follow_on_task_id FK→tasks (nullable))
   index ix_logbook_occurred(occurred_at), ix_logbook_kind(kind, occurred_at)
   │
   ├─< logbook_status_updates (update_id PK AUTOINCREMENT, entry_id FK NOT NULL, at NOT NULL,
   │                           status CHECK IN (broke, parts-ordered, deferred, accepted, fixed) NOT NULL,
   │                           note, author, after_entry_id NOT NULL DEFAULT 0)
   │      index ix_logbook_status_entry(entry_id, update_id)
   ├── logbook_stamps (entry_id PK/FK, lat, lon, sog_kn, cog_deg, mode, wind_apparent_kn, baro_hpa,
   │                   sail_set, card_json [v39: + wind_apparent_deg, engine_hours])       -- 1:1, optional
   ├── logbook_passage_ends (entry_id PK/FK, port NOT NULL, bound_for)                     -- v38, 1:1
   └── logbook_watch_turns (entry_id PK/FK, on_watch NOT NULL)                             -- v39, 1:1
```

| Column | Meaning |
|---|---|
| `kind` | `failure` / `observation` / `incident` = crew entries (`data.LOG_CREW_KINDS`, the only kinds `POST /api/logbook` accepts); `watch` = the watch entry written at handover; `event` = pushed by the rules engine; `status` = the automatic deck log; `departure` / `arrival` = passage ends (v38); v39 `sail` = a sail-plan change line, `engine` = Engine on / off by hand. |
| `occurred_at` / `recorded_at` | When it happened vs when it was written, local ISO without a zone. Crew entries to the MINUTE (may be back-dated "N min ago", up to 24 h); engine events to the SECOND the rule fired (the owner 10-05: the firing order of a critical sequence matters for troubleshooting). |
| `system_name` | The governed System > Device name (pick list, never typed). `ON UPDATE CASCADE` so a renamed device follows - the ONLY change the append-only trigger lets through. |
| `severity` | Engine events carry P1 / P2 / NUDGE / info; optional on crew entries (not asked on the cockpit form). |
| `author` | Who wrote it. Crew entries: a name (v39: required and stored as the `crew_members` roster spelling, server-enforced); engine events: `engine`. A snapshot, not an FK. |
| `source` | `cockpit` / `desktop` (crew), `engine` (the push), `auto` (the deck log), `import` (reserved for the dropped import of the previous developer's Influx log). v39 shows them in words: Cockpit / Desktop / Automation / Auto Report. |
| `source_event_id` | Engine: the event's `event_id` (UNIQUE = the idempotency key; a repeat is `data.DuplicateEvent` -> 409). Deck log: the slot time, so a restart never writes a slot twice. |
| `simulated` | 1 = an engine TEST event (shown as TEST, left out of printouts unless `tests=1`, left out of passage counts). |
| `record` | Engine events only: the rule's record level (Ship's Automation D-114). `log` = in the ship's log but NOT in the watch handover change report; `handover` = both. NULL for crew entries (always in the handover). |
| `follow_on_task_id` | The fix task raised with a failure in the same transaction (the follow-on mechanism of section 4). |
| status `after_entry_id` | The newest `entry_id` when this status row was written. "Changed since the last watch entry" = `after_entry_id >= that watch entry's id` - write order, never clock comparison (Owner: no clock precision on a boat). |
| status `status` | the owner's list (10-05): Broke / Parts Ordered / Deferred / Accepted / Fixed; any may follow any. Current status = the newest row; **open** = newest not in (`fixed`, `accepted`) (`data.LOG_CLOSED`). A failure gets its first row (`broke`) automatically in the same transaction. A typo is fixed by a correction update, never an edit. |
| stamp columns | What the boat said at `occurred_at`, from the boat stack, never typed: position (decimal degrees), SOG kn, COG °T (left out under 0.5 kn), boat `mode` (DOCK / ANCHOR / AWAY / MOTOR / SAIL from the engine), apparent wind kn, barometer hPa, `sail_set` (the `sails.activeSet` label). `card_json` = the full handover card (watch entries, deck-log entries, fresh engine events). v39: `wind_apparent_deg` signed (+ starboard / - port, SignalK `angleApparent`) and `engine_hours` (the Yanmar hour meter read at Engine on / off - also written as the maintenance meter reading). No stamp row when the stack gave nothing - a hand entry never waits on, or fails because of, the boat stack. On a database migrated to v39 the two new columns sit after `card_json` (ALTER TABLE ADD); on a fresh install before it - column order is not relied on. |
| `port` / `bound_for` | v38 passage ends: the port of a departure or arrival; `bound_for` only on a departure. A **passage** = one departure to the next arrival; it is DERIVED from these rows, never stored. |
| `on_watch` | v39: who TOOK the watch at a handover, or the first watch at a departure (a `crew_members.display_name` snapshot). The current watchkeeper = the newest turn since the leg's departure; none alongside / at anchor. It is the default signature on every crew entry. |

**Triggers** (all `RAISE(ABORT, ...)` with a plain sentence): `trg_logbook_entries_no_update` (allows only a
`system_name` change with every other column equal - the FK cascade), `trg_logbook_entries_no_delete`,
`trg_logbook_status_no_change` / `_no_delete`, `trg_logbook_stamps_no_change` / `_no_delete`,
`trg_logbook_passage_ends_no_change` / `_no_delete` (v38), `trg_logbook_watch_turns_no_change` / `_no_delete`
(v39). The rules are in the schema, so a raw-SQL attack is refused too (`tests/test_logbook.py`).

**Not stored on purpose**: the passage itself (derived); a sail-plan record before v39 (the Ship's Automation
history database keeps `sails.activeSet` as state - that is the sail log; v39 adds a `sail` ship's-log line
beside it); anything typed for the stamp.

## Reporting views

Four `CREATE VIEW`s pre-join the common read patterns so callers (both
`data.py` and any ad-hoc query) don't repeat the join logic:

- `v_item_onhand` — item + summed on-hand quantity across all stock lots +
  lot count + earliest expiry.
- `v_stock_located` — every stock row joined out to its container and
  location names.
- `v_task_item_demand` — for each task/item pairing, on-hand quantity and
  computed shortfall (`quantity_required - quantity_onhand`, floored at 0).
- `v_food_catalog` — food items joined to `food_details` + on-hand summary,
  the base of the provisioning/shopping-list features.

## Triggers

Three `updated_at`-touch triggers (`trg_items_touch`, `trg_stock_touch`, `trg_recipes_touch`) — fire only
when the incoming `UPDATE` didn't already change `updated_at` itself, so an
explicit timestamp write isn't silently overwritten.

Integrity triggers (each described with its table above):

- `trg_tasks_phase_ins` / `_upd` / `_clear` (v23) — a task's phase belongs to
  its own project.
- `trg_food_mode_ins` / `_upd` (v24) — `provision_qty` only with
  `provision_mode='baseline'`.
- `trg_completions_append_only` / `trg_completions_no_delete` and
  `trg_completion_parts_append_only` / `_no_delete` (v26; the two on
  `task_completions` recreated by v31's rebuild, and the append-only one again
  in v32 and v33 to cover new columns) — the maintenance history is
  append-only (section 10).
- `trg_completions_cost_or_document_ins` / `_upd` (v33) — a history row has
  its own cost OR an invoice, never both (section 10).
- The logbook's ten no-change / no-delete triggers (v37-v39) — section 11. At v38 that makes 22 triggers
  in all (`trg_completion_parts_no_delete` is the `_no_delete` partner above); v39 adds two (24).

## Foreign keys and deletion behavior

`PRAGMA foreign_keys = ON` is set per-connection (`db_schema.py`'s
`_init_fresh`, and `data.py`'s `connect()`). Deletion behavior is chosen
per-relationship, not uniform:

- `CASCADE`: `storage_containers` when a location is deleted, `stock` when
  an item is deleted, `task_items`/`task_references` when a task is
  deleted, checklist steps (`tasks.parent_task_id`) when their parent
  checklist is deleted, `recipe_tags`/`recipe_ingredients` when a recipe is
  deleted, `audit_lines` when an audit is deleted.
- Plain reference (no cascade — the delete is refused): `items.unit` and
  `recipe_ingredients.unit` → `units(unit_key)`; `data.delete_unit` checks
  first and explains what still uses the unit. `tasks.origin_completion_id`
  → `task_completions` (v34) has no `ON DELETE` either - moot in practice,
  since `trg_completions_no_delete` refuses every history DELETE.
- `SET NULL`: `stock.container_id` (a lot survives its container being
  deleted, just becomes unlocated), `tasks.project_id` (a task un-parks
  rather than vanishing if its project is deleted), `systems.parent_name`
  (children ungroup rather than cascade-delete if a parent category is
  removed), `tool_accessory_details.parent_tool_item_id`,
  `stock_movements.task_id/audit_id/recipe_id` (the ledger row survives
  even if its originating task/audit/recipe is later deleted),
  `task_completions.task_id` and `task_completion_parts.item_id` (the history
  row survives), `task_completions.document_id` (v33 - but
  `data.delete_document` refuses while anything is filed under the document,
  so in practice the app never lets this fire), `documents.project_id` (v33).
- No FK at all, on purpose: `task_completions.performed_by` is a TEXT snapshot
  and nothing references `crew_members`, so a roster entry can be deleted
  freely. The same holds for `logbook_entries.author` and (v39)
  `logbook_watch_turns.on_watch`.
- Logbook (v37+): `logbook_entries.system_name` → `systems(name)` is `ON UPDATE CASCADE` (a rename follows)
  with no `ON DELETE`: `data.delete_system` does not look at the logbook, so deleting a system or device
  that a log entry names fails inside SQLite with a foreign-key error (it reassigns tasks, not log
  entries) - untested through the GUI, see Roadmap open items;
  `follow_on_task_id` → `tasks` and every child table → `logbook_entries` are plain references - moot,
  because every logbook DELETE is refused by trigger.

`SET NULL` keeps the history ROW but not its link: `task_completions`
denormalises `task_name` / `system` / `project_name` / `period` /
`interval_type`, so a deleted task's completions are still readable, but nothing
joins them back to a task any more. That is the whole reason `retired_at` (v30)
exists and why `delete_task` refuses a task that has history.

## Duplicate-item prevention

`data.create_item()` rejects a same-name (case/whitespace-insensitive)
duplicate within the same `item_type`, raising `data.DuplicateItemError`
(surfaced as HTTP 409) rather than silently inserting a second catalog row.
Added 2026-09-16 after a real duplicate ("onions" vs. "Onions") was created
by the recipe-review "+ new catalog item" flow after a failed fuzzy match.
Each of the three UI call sites for that flow handles the conflict per its
own intent (auto-link vs. warn-and-block) — see
`<your-project-dir>/history/CHECKPOINT_ARCHIVE_2026-09-19.md`'s "wrap up the recipe/food section" entry for
the full reasoning.

## Removing stock: `expire` vs. `manual_adjust`

`data.delete_stock()` has logged every lot removal as a real
`stock_movements` row (a negative `delta`) since it was written, but
always under `reason='manual_adjust'` with a hardcoded note - even though
`'expire'` has been a valid reason in the CHECK constraint since schema
v15 (the recipe-consumption work). Nothing ever actually used it until
2026-09-17: `delete_stock()` now takes an optional `reason`/`note`, and
the expired-stock clean-out flow (`ExpiringStockTable.tsx`) passes
`reason='expire'` so a container sweep shows up honestly in the audit
trail instead of looking like an unexplained manual tweak. The generic
per-item delete (Item Detail's stock editor) still defaults to
`manual_adjust`.

## Migration history (schema versions)

| Version | What changed |
|---|---|
| v4 | Projects, task references, stock movement audit trail |
| v5 | Stocking-policy detail (`critical_spare_review`), inventory audits |
| v8 | Recipe book (unstructured, tag-based) |
| v9 | Telemetry cache |
| v11 | (pre-rewrite baseline — last Streamlit-era schema) |
| v12 | `item_type`/`stocking_policy` moved from CHECK enums to lookup tables; added `gear` item type and `owned` policy; reassigned 73 mis-tagged tools from `bulk` to `owned` |
| v13 | `task_references` gained `kind='task'` (task-to-task cross-references) |
| v14 | `tasks.system` moved from 116 free-text values to the governed `systems` lookup table (one-level hierarchy) |
| v15 | `recipe_ingredients` (structured, parse-once ingredient matching + stock consumption) |
| v16 | `meal_plan` (working list of picked recipes; feeds both the provisioning shopping list and, on completion, the same `make_recipe()` stock draw) |
| v17 | `meal_plan.overrides` (saved protein swap / ad-hoc extra ingredient picks, used at both plan time and cook time) |
| v18 | `storage_containers.favorite` (generic "quick pick" flag surfaced first in every container picker) |
| v19 | `compartments` lookup table above `storage_locations` (required FK); 17 seeded compartments; 2 empty leftover-Beneteau locations dropped |
| v20 | `storage_locations` uniqueness moved from global `location_name` to `(compartment_id, location_name)`; `v_stock_located` gained `compartment_name`; compartment prefix stripped from 52 location names; Galley's 13 containers promoted to locations (each container row moved, renamed `loose`, so stock/type/favorite/audit history carried over) and the empty "Galley" and "Galley Lockers" locations dropped |
| v21 | `units` lookup table (36 imperial units + `dimension`, `offered`); `items.unit` (NOT NULL DEFAULT 'ea') and `recipe_ingredients.unit` (nullable) became FKs to it; existing values normalised (`each`→`ea` x2 items and x1 ingredient, `cups`→`cup`, `Pinch`→`pinch`), the 36 NULL ingredient units left NULL; `kg` (6 items) and `L` (3 items) kept as non-offered legacy rows pending hand conversion; both tables rebuilt (rename → create → copy → drop), all row counts identical, AUTOINCREMENT high-water marks kept |
| v22 | `item_types` gained `spare_unit` ("Spare unit", shares `part_details` with `part`); new `item_systems(item_id, system_name)` many-to-many link, FK to `items` and `systems`, both `ON DELETE CASCADE`; `systems` gained device details `make_model`, `manual_ref`, `installed_qty` (>=1), `no_spares_needed` (0/1). Additive migration; seeded from existing data (32 make/model notes, 6 installed quantities, 190 links from `task_items`, 4 items retyped to spare_unit) |
| v23 | Project phases: `project_phases` table, nullable `tasks.phase_id` FK (`ON DELETE SET NULL`), `idx_tasks_phase`, three triggers keeping a task's phase inside its own project. Additive; no phases seeded; trigger self-test in the migration (rolled back) |
| v24 | `food_details.provision_mode` (+ two consistency triggers; the 35 rows with a quantity became `baseline`); `recipe_ingredients.is_bulk` dropped; 34 food items reclassified consumable -> bulk (43 bulk / 18 consumable); Beer given a food_details row (beverage); `stocking_policies.bulk` description reworded; `v_food_catalog` recreated with `provision_mode` + `stocking_policy` |
| v25 | `items.on_list_since` (the "we need more" request); `v_food_catalog` recreated to expose it. Additive, no data changed |
| v26 | `task_completions` - the completion audit trail / maintenance history: one row per completion with SNAPSHOT `task_name` / `system` / `project_name`, `source`, `was_critical`, the rule in force (`interval_type`, `period`), `completed_on` (date logged) and `recorded_at`, timeliness (`due_on`, `original_due_on`, `days_past_due`, `hours_past_due`, `deferred_units`), `hours_at_completion` plus BOTH meters' `engine_hours` / `genset_hours`, `previous_completed_on` / `previous_hours` (to undo), `notes`, `voided_at` / `void_reason`; `task_completion_parts` (spares used: item / name / part number / quantity / unit snapshots). **Append-only by trigger** (no edits or deletes; only voiding and the FK `task_id` -> NULL). Additive; starts empty (no history invented) |
| v27 | `task_references` gained `sort_order`, `checklist_group` and `done_completion_id` (FK `task_completions`): a task LINKED into a checklist sits in its step order and group and is ticked per run (tracker #48). Additive; existing task links inside a checklist were numbered after that checklist's steps in ref_id order (0 on live at migration). See [Logic-Flows](Logic-Flows.md#12-linked-tasks-inline-in-a-checklist-tracker-48-schema-v27) |
| v28 | `item_fit_checks(item_id PK -> items ON DELETE CASCADE, fit_status in ('fits','wrong_model','not_applicable'), checked_on, note)` - the spares fit check (the owner, 2026-09-21). One optional row per part / spare unit; **no row = unchecked**, so nothing was backfilled. Additive; no view or existing row changed |
| v29 | `tool_accessory_tools(accessory_item_id, tool_item_id, both FK->items ON DELETE CASCADE, PK on the pair)` - many-to-many accessory<->tool (tracker #64-adjacent, 2026-09-22), replacing the single-FK `tool_accessory_details.parent_tool_item_id` (an accessory can fit more than one tool). Additive; 17 existing `parent_tool_item_id` values backfilled into the new table, the old column left in place unused. See [Design-Decisions](Design-Decisions.md#accessory-tool-many-to-many) |
| v30 | `tasks.retired_at` / `tasks.retired_reason` (both TEXT, NULL = active) - retire replaces hard delete once a task has logged history, so `task_completions.task_id` keeps pointing at a real row (tracker #66, the owner 2026-09-22: "for the mx log to work we need to leave the task in the master table"). Additive, no backfill - all 856 existing tasks stay active. See [Design-Decisions](Design-Decisions.md#retire-not-delete) |
| v31 | `task_completions.source` CHECK widened to allow `'historical'`, and the table gains `performed_by` / `vendor` / `cost`. SQLite cannot widen a CHECK with ALTER TABLE, so this was a full table REBUILD (`scripts/oneoff/migrate_schema_v31.py`, SQLite's 12-step procedure; every pre-existing row verified identical on every old column before commit, completion_id values preserved, both append-only triggers recreated and self-tested). A `'historical'` row is a past service record with no task behind it - `task_id` NULL, every scheduling column NULL. Tracker #44, the CARFAX backfill. See [Design-Decisions](Design-Decisions.md#historical-service-records) |
| v32 | Settles ALL the remaining tracker #44 schema in one additive migration, so the features that use it ship as code-only deploys. `systems` gains `installed_on` / `serial` / `warranty_until` (a device's own identity, so a per-device report can say WHICH unit the story is about). `task_completions` gains `outcome` / `evidence_path` / `event_kind` / `sent_at`. New `crew_members` lookup (the governed "who did the work" pick list, seeded the owner + crew member; performed_by stays a TEXT snapshot, NOT an FK). `outcome` and `event_kind` are validated in `data.py`, not by a DDL CHECK - the same call as `tasks.interval_type`, so a new value later never means another rebuild. The append-only trigger was dropped and recreated to cover the new fact columns; `sent_at` has its own allowed NULL->once transition. See [Design-Decisions](Design-Decisions.md#remaining-44-schema-in-one-go) |
| v33 | Live 2026-09-22 ~16:23 (deploy 9, code `863570e`; pre-deploy backup `vessel_local.db.bak-predeploy-20260922-162201`). New `documents` table (the spine of a vendor invoice / receipt: vendor, number, date or period, total once, file path, project, free-text `expense_class`, notes) + `idx_documents_date`; `task_completions.document_id` (FK, `ON DELETE SET NULL`) + `idx_task_completions_document`. The append-only trigger dropped and recreated with a fourth allowed transition (`document_id` changing on its own - filing is a cross-reference); two new cost-or-document triggers. Additive, no rebuild (`scripts/oneoff/migrate_schema_v33.py`, trigger self-test rolled back). See section 10 and [Design-Decisions](Design-Decisions.md#invoices-are-documents) |
| v34 | **Live 2026-09-22 ~17:40** (deploy 10, code `d54252c`; pre-deploy backup `vessel_local.db.bak-predeploy-20260922-173938`, the migration's own `...bak-20260922-173955`). `tasks.origin_completion_id INTEGER REFERENCES task_completions(completion_id)` (no `ON DELETE` - history rows are never deleted) + `idx_tasks_origin_completion`: a FOLLOW-ON task points back at the history entry that raised it, one entry -> many. Additive, nothing backfilled (`scripts/oneoff/migrate_schema_v34.py`, self-test in a rolled-back savepoint); verified after: integrity + FK clean, 15086 rows and all 857 tasks unchanged. The v32 note that the rest of #44 would be code-only was slightly optimistic - this needed one additive column rather than stuffing the link into description text. See section 4 and [Design-Decisions](Design-Decisions.md#follow-on-tasks) |
| v35 | **Live 2026-09-23 ~09:12** (deploy 13; pre-deploy backup `vessel_local.db.bak-predeploy-20260923-091130`, the migration's own `...bak-20260923-091157`). `recipe_ingredients.link_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (IN (0,1))`: 1 = a person deliberately chose this line's catalog link ("📌 Save to recipe" on the plan/cook screen via `POST /recipes/{id}/ingredients/changes` / `data.apply_recipe_ingredient_changes`, or link-or-add via `set_recipe_ingredient_item`), and the advisory link check then reads 'ok' instead of re-flagging a fixed link (tracker #71). A re-parse re-saves every line at 0 (and is now gated by a confirm). Additive, nothing backfilled (`scripts/oneoff/migrate_schema_v35.py`); verified after: integrity + FK clean, 15179 rows unchanged. |
| v36 | **Live 2026-09-24** (deploy 20). `tasks.schedule_from TEXT` (NULL): a never-done task's schedule counts from that day instead of "done 90 days ago"; set by `load_starter_pack.py` on the load day. Additive, nothing backfilled (`scripts/oneoff/migrate_schema_v36.py`; dry run on live data: 861 tasks identical, compartments untouched). Same release also moved seeds out of `create_schema()` (generic compartments only via `_init_fresh()`, no crew seed) without a version bump (db_schema v35.1). See section 4 and [Design-Decisions](Design-Decisions.md#never-done-baseline) |

| v37 | **Live 2026-10-05** (deploy 24 on the Ship's PC; carried to the laptop interim host the same day). The LOGBOOK: `logbook_entries`, `logbook_status_updates`, `logbook_stamps` + their indexes and append-only triggers (section 11). The first version applied by the `migrations/` runner (`migrations/v037_logbook.py`), not a one-off script. Additive. See [Design-Decisions](Design-Decisions.md#logbook-in-mx-inv) |
| v38 | **Live 2026-10-05 ~19:26** (laptop; runner backup `vessel_local.db.bak-premigrate-v37-20261005-192607`). PASSAGES: kinds `departure` / `arrival` added to the `logbook_entries.kind` CHECK (a REBUILD - SQLite cannot alter a CHECK: triggers + indexes dropped, new table from the fresh-install DDL, every row copied with its id, AUTOINCREMENT sequence carried over, `fk_off` step proven by `foreign_key_check`) + new `logbook_passage_ends` with its two triggers (`migrations/v038_passages.py`). `tests/test_passages.py` pins that the rebuild keeps every row, id, sequence, child link and trigger. |
| v39 | **Live 2026-10-08 ~23:02** (`review-batch` merged into `logbook-page`, `552a1f6`; runner backup `vessel_local.db.bak-premigrate-v38-20261008-230123`) (the owner's Ship's Log review, `design/LOGBOOK_DESIGN.md` 5c). Kinds `sail` / `engine` (the same rebuild as v38); `logbook_stamps.wind_apparent_deg` + `engine_hours` (ALTER TABLE ADD COLUMN); `logbook_watch_turns` + two triggers (`migrations/v039_review.py`). The server's runner migrated v38 -> v39 at start after its verified backup. |

v7-v36: each `scripts/oneoff/migrate_schema_vNN.py` was run dry-run first, then for real against a
scratch copy, then against production with a fresh `.bak-<timestamp>` backup taken immediately before.
v37 on: the runner does the backup and the transaction itself; the scratch-copy rehearsal still comes first
(see [Operations](Operations.md#deploying-a-change-to-the-live-server)).
