<!--
Purpose: Engineering wiki page - why mx-inv is shaped the way it is: each settled decision, its reasoning, and what would reopen it.
Version: v15 (2026-10-09) - v15: the cockpit 'Filling' tap - the crew starts a tank fill, the engine holds it. v14 (2026-10-08) - v14: review-batch (schema v39) merged + LIVE 2026-10-08. v13 (2026-10-08) - v13: Work a Container tick = lasting audit record; Move / Add-extra has no default. v12 (2026-10-07) - v12: rebuild-from-spec pass - logbook-in-mx-inv status = built (v37/v38, import dropped); Ship's-PC-system-of-record status note (laptop interim, links superseded by the 10-06 cut-over); new decisions: logbook append-only + status chain + write order, time precision, the deck log never back-fills, the engine pushes events, a passage is one leg (option B), signed entries (v39), the migration runner refuses a newer DB, per-host guard files. v11 (2026-10-03) - v11: the Ship's PC is the system of record with the Ship's Automation links down {#ships-pc-system-of-record}. v10 (2026-09-28) - v10: logbook automatic entries are pushed by the rules engine {#logbook-in-mx-inv}. v9 (2026-09-27) - v9: stow draws from the Unassigned container first (deploy 23). v8 (2026-09-24) - v8: adds "Keep the stack; harden it in place" {#keep-the-stack} (architecture review + ARCH_HARDENING_PLAN). v7: adds "SQLite commits are durable across a power cut" {#synchronous-full} and "The logbook moves into mx-inv (option C)" {#logbook-in-mx-inv}, both from the previous developer's reply to Docker spec v4. v6: deploy 20 / schema v36 - adds "A release package is an allowlist export, gated by a privacy scan" {#release-package}, "Boat-specific values are Settings, not code" {#settings-not-hardcoded}, "Outside integrations are opt-in" {#opt-in-integrations} and "Never-done tasks: one baseline rule, and say so" {#never-done-baseline}; the routing-proxy entry notes the proxy is now opt-in. v5: adds "Container picker is a tap cascade" {#container-cascade} (one shared StorageColumns for the picker, Edit Storage Structure and every storage move; the same kit carried to System › Device). v4 (2026-09-23): adds "Clickable to detail: one opener, every tab an origin" {#clickable-to-detail} and "No detours: create it where you pick it" {#no-detour-workflows} (#74/#76). v3 (2026-09-22): adds "Defer counts from today" {#defer-from-today} (#68), "Add as a step: one picker, one question" {#add-as-a-step} (#69), "Follow-on urgency is the user's choice" {#follow-on-urgency} (#70), "Backfilling history from the build log" {#build-log-backfill}. v2: adds "Follow-on tasks point back at the history entry (schema v34)" {#follow-on-tasks}; the completion-audit-trail status note and the v32 "code-only from here" claim brought current (v33 and v34 live). v1: first page header. Adds "Invoices are documents, not costs on completions (schema v33)" {#invoices-are-documents}, the general "a 200 is not proof" lesson under the slash-route entry, and a 2026-09-22 status note on the completion-audit-trail roadmap.
Scope: PRODUCTION - documentation for the live mx-inv app (code/mx-inv).
Architecture: mx-inv engineering wiki (wiki/Home.md is the index). Read before re-opening any listed question; the day-by-day narrative behind entries is in history/ (grep, never read whole).
Invocation: n/a (reference doc).
-->

# Design Decisions

Why the system is shaped the way it is — written so a future change doesn't
accidentally re-litigate a question that was already deliberately settled.
Each entry names the decision, the reasoning, and (where relevant) what
would have to change for the decision to be revisited.

## Routing reverse-proxied, not merged {#routing-reverse-proxied-not-merged}

**Decision**: `/routing/**` is served by reverse-proxying to a separate
`passage-planner` FastAPI process on `127.0.0.1:8100` (`backend/main.py`,
`httpx`), not by importing routing's Python package into this process the
way `/cockpit` is just another route in this same repo.

**Why**: routing is a genuinely separate codebase - its own git repo
(`passage-planner`), its own CI/test gate (237 tests, `ruff`/`mypy --strict`),
and a heavier, more specialized dependency set (weather fetchers, GPX
parsing, `python-docx`/`pypdf` for float-plan generation) that has nothing
to do with mx-inv's inventory/checklist domain. Importing it directly would
mean installing all of that into this app's `.venv` and coupling the two
repos' dependency-upgrade cycles together for no real benefit - the two
apps don't share any Python objects, only HTTP. A reverse proxy gets the
single-URL/single-firewall-rule outcome the owner wanted without that coupling.

Since deploy 20 the proxy is only mounted when `MXINV_ROUTING_URL` is set
(`run-live.bat` sets it) - see [#opt-in-integrations](#opt-in-integrations).

**What would change this**: if routing's own dependency footprint shrank
to something trivial, or if the two apps started needing to share
in-process state (not just occasional HTTP calls), an import-level merge
would become more attractive. Also worth revisiting if/when this moves to
`your-pi-hostname` (the previous developer's RPi) - the same reverse-proxy shape maps directly
onto "two Docker containers, one exposed gateway," so this decision
doesn't have to be re-made for that migration, just re-sized against
actual available headroom there.

## Two shopping carts, merged food need (not four fragmented lists)

**Decision**: the app has exactly two "what do I need to buy" carts - a
stuff cart (Restock List, parts/supplies/tools) and a food cart
(`data.food_cart()`, Galley Provisioning). The food cart merges the
baseline provisioning heuristic and the meal-plan's recipe-driven need
into one number per item (`MAX`, not additive - see
[Logic Flows](Logic-Flows.md#9-the-merged-food-cart-datafood_cart) for
the full mechanics), rather than showing them as two separate lists.
`meal_plan_shopping_list()` still exists (useful as a narrower, plan-only
view) but is no longer surfaced as *the* food shopping list in the UI.

**Why**: the owner, 2026-09-17, naming the shape directly: "I think we are
building 2 shopping carts (a stuff cart with expiring items flagged) and
a food cart (based on the menu plan - expiring items". Confirmed the
merge direction (not additive) with his own framing: "ultimately that's
how the shopping is done - merged. The baseline food qty is a heuristic
anyway to have food on board to cover normal meal prep, the recipe picker
is a refinement on that heuristic." Both carts also gained an
expiring-stock flag (distinct from the separate clean-out screens - this
one informs a *buying* decision, not a removal one).

## Full rewrite, not an incremental Streamlit fix

**Decision**: replace the Streamlit UI entirely with FastAPI + React, rather
than continuing to patch Streamlit. `data.py`/`db_schema.py` carried over
completely unchanged.

**Why**: a 2026-09-15 complaint ("Streamlit seems like a big kludge for
this") was investigated before being agreed with — root cause turned out to
be a real, fixable N+1-query bug plus zero `st.fragment`/caching usage, not
an inherent Streamlit limitation, and that was fixed in place the same day.
But a *second*, independent complaint was real and not fixable in place:
the owner's actual issue was UI/UX itself (styling, interactivity, mobile), which
Streamlit's component model can't address without leaving Streamlit. His own
framing: "the database part is solid... this is primarily a GUI exercise."

**What this means going forward**: any future "the app feels wrong"
complaint should get the same diagnose-before-rewrite treatment — read the
actual code, quantify the problem, before proposing to swap tools again.
Don't assume the React/FastAPI stack is itself beyond question just because
it replaced something once.

## `data.py` reused verbatim, not refactored

**Decision**: the rewrite touched zero lines of `data.py`/`db_schema.py`.
Every backend router is a thin pass-through.

**Why**: `data.py` was already framework-agnostic (zero Streamlit imports,
~130 functions across 8 domains) and had its own smoke tests. The entire
scope of the rewrite was UI, so touching the data layer would have expanded
scope and risk for no UI benefit. This is why the backend's request bodies
are mostly loose `dict[str, Any]` rather than typed Pydantic models — they
mirror `data.py`'s own `**fields` kwargs pattern rather than imposing a new
shape on it.

**Revisit if**: OpenAPI-driven frontend codegen becomes a goal (would need
per-field typed request models), or a genuine data-layer bug is found that
`data.py` itself needs fixing for (which has happened — see e.g. the
duplicate-item-creation fix — but as a targeted fix, not a refactor).

## Unified Task + Checklist management

**Decision**: checklists are not a separate entity — a checklist is a
`tasks` row with `task_kind='checklist'`; its steps are ordinary task rows
with `parent_task_id` set. One editing surface (`Management`), one API
family (`/api/tasks/{id}/checklist/...`).

**Why**: the old Streamlit app had two disjoint editing paths for what was
already the same underlying `tasks` table
(`schedule_modules.render_task_cleaner_editor_tab` vs. `checklists_tab.py`)
— a maintenance burden with no real payoff. This was pulled forward into
build-phase 3 (before Projects/Warehouse) specifically so the two-UI split
wasn't built twice in the new stack either.

## `item_type`/`stocking_policy` as data, not schema (v12)

**Decision**: moved from hardcoded `CHECK` enums to `item_types`/
`stocking_policies` lookup tables with `label`/`description`/`sort_order`.

**Why**: two new categories (`gear` item type, `owned` policy) were needed
within one working session; under the old design each would have required
a schema migration. Making these lookup tables turns "add a category" into
an `INSERT`. As a side benefit, the `label`/`description` columns became
the single source of truth for picker-explanation text that used to be
duplicated in a frontend TypeScript dict (`policyHelp.ts`, since removed).

**Deliberately not extended to `systems`** the same way — `systems` (v14)
uses its *name* as the natural key rather than a `type_key`-style code,
because it's a large, open, user-curated catalog (100+ entries), not a
small handful of fixed categories. Renaming a system means updating the
table and cascading the name into every referencing task row — different
shape of problem from "add one more policy."

## No auth {#no-auth}

**Decision**: zero authentication anywhere — CORS wide open
(`allow_origins=["*"]`), no login, no per-user permissions.

**Why**: the trust boundary is deliberately the network, not the
application — LAN and Tailscale access only, same posture the Streamlit app
always had. Revisiting this was explicitly flagged as "not yet decided
either way" once the app became a real HTTP API rather than a Streamlit
page (a Streamlit page has a smaller attack surface than an open CORS API
by nature) — **this is the one security-relevant decision in this document
that is genuinely still open, not settled**, and should be reconsidered
before any exposure beyond LAN/Tailscale (e.g. if the app is ever reachable
over the open internet).

## Laptop, not NAS, for interim hosting {#laptop-not-nas-hosting}

**Decision**: host on `lee-lenova` (the owner's laptop) during the pre-departure
phase, not the always-on NAS, despite the NAS being available and already
Tailscale-joined.

**Why**: the app's whole design center is running disconnected on the
boat's own LAN with zero internet dependency once aboard. The NAS lives at
a stationary shoreside location (crew's house) — hosting there would mean
every access, including from the boat itself, routing over Tailscale
through Starlink Ocean Mode (a metered, non-prioritized bandwidth path) the
moment the boat leaves the dock, trading a zero-dependency tool for one
with four new failure points (Starlink/cellular/Tailscale/house-power all
up simultaneously). The NAS's real strengths (Docker, existing Tailscale
join, the Syncthing pipeline) fit a future *shoreside read-only mirror*
better than write-authority hosting.

**Planned migration**: a straight copy of `vessel_local.db` + this whole
directory to the Ship's PC once back aboard — no code changes anticipated,
blocked only on physically Tailscale-joining the Ship's PC.

## Docker / TLS-cert — provisional, never finished

**Decision (early planning, 2026-09-15)**: two Docker containers (data/API
+ GUI), a Tailscale-issued TLS cert, motivated partly by a possible future
move onto `your-pi-hostname` (the previous developer's RPi).

**Current status**: never implemented. The app shipped and went live
without Docker (`run-live.bat` is a plain Python/Node process pair). the automation developer
was granted read-only repo access to firm up the concrete compose/
networking/cert shape, but that never fed back into a concrete
implementation before other work took priority. **Worth revisiting whether
this is still wanted at all** — it may have been relevant only to a
`your-pi-hostname` RPi move that itself isn't scheduled, versus the current plan
of a Ship's-PC migration which needs no containerization.

## Server-side-only schedule math

**Decision**: the entire 8-bucket due-date projection lives in
`backend/scheduling.py`; the React frontend renders whatever
`GET /api/schedule` returns and reimplements none of the date math in JS.

**Why**: baked into the original build-order plan explicitly to prevent
schedule-bucket logic from drifting between a Python implementation and a
JS one — a single source of truth for what "critical" or "overdue" means.
This is also why the projection is recomputed fresh on every request rather
than cached: matching the philosophy the old Streamlit app used
(`st.rerun(scope="app")` after any write), simplicity over the marginal
perceived-latency gain of incremental client-side patching.

## Recipe consumption bypasses the `tasks` table entirely

**Decision**: cooking a recipe writes directly to `stock_movements`
(`reason='recipe_consume'`), never creates a `tasks` row, despite the
existing task/item-consumption machinery already covering "consume
inventory when work happens."

**Why**: a `use`-interval task never leaves the schedule board's
Checklists bucket even once completed (see
[Logic Flows](Logic-Flows.md#1-the-schedule-projection-backendschedulingpy))
— reusing that mechanism would mean every meal ever cooked permanently
cluttered the schedule board. Better to have a second, narrower consumption
path than force-fit an existing one that has a wrong-shaped side effect for
this use case.

## The meal plan is a working list, not a log

**Decision** (the owner/crew member, 2026-09-17): a `meal_plan` row carries no status
field and no "made"/"cancelled" history — both terminal actions just
`DELETE` the row. Completing an entry calls `make_recipe()` first (so the
stock draw and its `recipe_consume` audit trail still happen), then deletes
it; cancelling just deletes it.

**Why**: initially designed with a status column so a "made" entry would
stay around as a record. the owner's correction: "I am not sure there is any need
to log a completed entry - this is more of a convenient means for B to
track her plan to completion... just go to the planned list and mark
complete / recipe falls out of the list." The real audit trail already
exists (`stock_movements`, `reason='recipe_consume'`, tied to `recipe_id`)
— duplicating it inside `meal_plan` would just be a second, redundant
record of the same fact. This is a deliberate exception to the app's
general no-hard-delete posture (tasks complete rather than delete,
recipes get retitled rather than deleted, checklist steps complete rather
than delete): those all preserve state that has no other record anywhere
else; a `meal_plan` row doesn't, once `make_recipe()` has run.

**Addendum (2026-09-17)**: `MealPlanEntryCard.tsx` originally rendered only
the structured ingredient checklist (for the stock draw), never the
recipe's own text — Owner: "I need the actual recipe so I can make it
without having to go find it again." Fixed by fetching the same
`useRecipe()` data `RecipeCard.tsx` (Recipe Book) already uses and
rendering the body text inline above the ingredient checklist, so a
working-list entry is fully self-contained at cook time.

## Swappable-protein base recipes: plan-time vs. cook-time

**Decision**: a recipe with a variable component (Chef's Salad, Mac &
Cheese — the base stays the same, the protein varies by whim) never gets
duplicated per variant. Instead, `make_recipe()`'s per-pick `item_id`
lets any consumption pick override which catalog item a line draws from,
or add an ad-hoc extra with no saved ingredient line at all - never saved
back to `recipe_ingredients`, so the recipe itself stays generic. The same
pick set can additionally be *saved* onto a `meal_plan` entry's
`overrides` column ("💾 Save picks") without drawing any stock.

**Why**: the owner/crew member, 2026-09-17 - "we make several dishes... that have
the base recipe and we mix up the protein as we feel like it. We really
don't need 2 or 3 or 4 instances of the same recipe each with a different
protein." Asked whether the swap picker should be scoped (e.g. tagged
"protein" items only) or the full catalog - Owner: "use the full food
catalog picker, that way we're not limiting ourselves," so no new
tag/category concept was added, just reuse of the existing full-catalog
dropdown already used elsewhere (recipe ingredient review, "+ new catalog
item").

**Why both plan-time and cook-time need it**: the owner's follow-up - "this
function is needed at both plan the menu stage (creates a shopping cart
entry if necessary) and at make the recipe time (just draw down stock)."
An override picked only at cook time never reaches
`meal_plan_shopping_list()` (it only sees what's saved on the entry), so
a swap made while planning ahead wouldn't show up as something to buy.
Saving picks separately from completing solves this without drawing stock
prematurely - "Made it" still runs the real draw and still lets you adjust
in the moment if plans changed again between planning and cooking.

## Closing the shopping-list-to-inventory loop: Receive + two separate clean-out workflows

**Decision**: the shopping list (Restock List, Galley Provisioning,
Meal Plan) was one-directional - it told you what to buy, but nothing fed
a purchase back into recorded stock short of finding the item in the
Locker one at a time. Added a `ReceiveAction.tsx` "🧺 Receive" inline
action on every shopping-list row, thin UI over the existing `add_stock()`
primitive (no new backend endpoint needed).

Separately, but built the same session: expired-stock removal had the
same one-at-a-time friction, plus a real audit-trail bug (see "Removing
stock: `expire` vs. `manual_adjust`" above). Fixed both together as
`ExpiringStockTable.tsx`, a shared component mounted as **two distinct
screens, not one merged list** - the owner, 2026-09-17, on realizing food expiry
and spares/safety-gear expiry are different lists: "that's 2 different
types of lists - likely 2 very different workflows on our part." Galley
Provisioning keeps the food-scoped one (routine tidy-up, casual); a new
Warehouse "⏳ Expiry / Inspection Due" tab covers everything else
(safety-critical - flares, EPIRB batteries, fire extinguisher checks,
medical kit contents). Same underlying generalized
`data.stock_expiring_within()` (food_expiring_within() is now a thin
wrapper over it) and the same `reason='expire'` clean-out action, just
scoped differently and framed differently for the two audiences.

**Why the audit trail doesn't need to differ between food and spares**:
The owner asked directly whether logging rigor should differ ("for food not
necessary - for spares/parts????"). Answer: no - `stock_movements` already
records every removal identically (reason, note, occurred_on) regardless
of item type, so the *mechanism* is already equally rigorous; what
differs is only the UI framing/workflow around when and why you'd use it.

## Favorite containers, not a hardcoded "food storage" category

**Decision**: `storage_containers.favorite` (schema v18) is a generic
per-container ⭐ flag, set from Storage Structure, surfaced first in every
container picker (`ContainerPicker.tsx` - a "⭐ Favorites" `<optgroup>`
above "All locations", not a separate toggle/click to reveal).

**Why**: the owner, 2026-09-17, anticipating friction once the two large
provisioning freezers and "a large number of containers still to be
built" are in place - wading through ~100 locations every time for a
receive/put-away pick. A hardcoded "food storage" category was considered
and rejected: at the time this was built only 5 containers held any food
at all (the freezers didn't exist as containers yet), so the category
would need constant manual upkeep as containers get built, and it
wouldn't help non-food receiving at all. The generic flag also directly
covers the owner's own stated outlier case ("deep storage or bulk refill items")
- those just stay unfavorited and are one scroll away in the same
dropdown, not a separate mode.

## Galley split into its own top-level nav tab, not a Warehouse sub-tab

**Decision** (2026-09-17): Galley Provisioning, Recipe Book, and Meal Plan
moved out of `WarehouseView.tsx`'s sub-tabs into a new top-level **🍽️
Galley** tab (`features/galley/GalleyView.tsx`). Warehouse is now
exclusively maintenance supply (Locker, Add New Stuff, Restock List,
Inventory Audit, Edit Storage Structure, the safety-only Expiry tab).
Storage locations/containers were deliberately **not** split — they stay
one shared list (a locker is a locker regardless of what's stored in it);
only the food-domain screens moved.

**Why**: Owner: "Break all the food related stuff out from the warehousing
into a new galley management database. Don't mix the maintenance supply
with the food." The literal phrasing read as a data/schema request (a
genuinely separate database file), and that's the interpretation
initially investigated (checked for containers mixing food + non-food
items - none existed - and flagged that `stock_movements`, the shared
audit ledger, would need splitting too). the owner corrected this directly:
"This is a gui change not a schema logic change" - and afterward noted
the original ask itself had likely been relayed in a confusing way before
it ever reached this chat (probably via crew member, who runs the galley
side - see `feedback-relayed-request-phrasing.md` in Claude's memory).
The underlying goal - don't let food and maintenance-supply inventory get
visually/mentally mixed together - is fully satisfied by the nav split
alone; no backend, schema, or data change was needed or made.

## Let the previous developer broker InfluxDB writes

**Decision**: `vessel_log.py`/`sail_config.py` POST to a webhook the automation developer
provides; this app never writes InfluxDB directly, despite being read-
adjacent to the same telemetry data the previous developer's stack owns.

**Why**: the owner's explicit instruction — "let him broker the writes." Keeps a
single owner for the InfluxDB schema/write path (the previous developer's `your-pi-hostname`
stack) rather than two systems writing the same measurement independently.
Both brokers ship disabled by default (env vars unset = no-op) until the automation developer
confirms the endpoint/schema.

## No router library for `/cockpit`

**Decision**: a hand-rolled `window.location.pathname` check picks between
`<App/>` and `<CockpitApp/>` at mount time, instead of adding
react-router (or similar) for a second real route.

**Why**: it works because both dev (Vite) and prod (FastAPI's SPA fallback)
already serve `index.html` for any non-API path — no routing config needed
anywhere else. Two static top-level routes didn't justify the dependency.

**Revisit if**: a third top-level route is ever needed, or either surface
needs nested/dynamic routes of its own — at that point a real router
becomes worth the dependency.

## A compartments table, not a naming convention

**Decision**: schema v19 adds `compartments` (17 seeded rows: Sail Locker,
Anchor Locker, Chain Locker, Deck, Cockpit, Lazarette, Port Berth,
SB Berth, Salon, Galley, Master Berth, Nav Station, Tool Room, Day Head,
Master Head, Engine Room, Dinghy) as a real lookup table with a required
FK from `storage_locations`, not a documented prefix convention for
`location_name`.

**Why**: the ~66 existing location names had already collapsed this
concept into free text, inconsistently — "Master Berth - Port Cabinet -
AFT", "Salon Couch - AFT Upper", "Salon Cabinet - Middle", "Main Saloon"
all meant the same compartment but didn't sort, group, or validate
together. Owner: "I think we want a compartment level layer... I think it
will clean up the naming convention significantly." A real table (same
lookup-table pattern as `item_types`/`stocking_policies`/`systems`) makes
adding a compartment later an INSERT, and lets `StorageStructureTab.tsx`
group/validate against it instead of trusting free text.

**Not nullable**: unlike `systems.parent_name` (optional, one level,
self-referencing), `storage_locations.compartment_id` is `NOT NULL` — the owner
confirmed every location must belong to a compartment, "yes for now
everything should exist in a compartment."

**Two locations dropped, not mapped**: "V-Berth" and "V-Berth Locker
Compartment" were leftover naming from the previous boat (a Beneteau) with
no your vessel equivalent, and both were confirmed empty (no stock) before
`migrate_schema_v19.py` dropped them, rather than force-mapping them to a
guessed compartment.

**Ambiguous mappings resolved by asking, not guessing**: "Chainlocker" →
new **Chain Locker** compartment (Owner: the anchor locker and the chain
locker - which holds the actual rode, deck level / backup rode / primary
rode layers - are separate spaces, so both got their own compartment,
even though only Chain Locker has existing locations yet). "FWD Head" →
**Day Head** (the owner confirmed they're the same head). "Shower - E/R
storage" / "Shower - Hull Storage" → **Master Head** (the owner confirmed) -
there is only one shower inside the boat; both locations are stowage
near it, not two separate showers. The stern shower is deck-side and was
never a location/container in the data, so it needed no mapping.

## Layup checklists: reference existing tasks, don't move or duplicate them

**Decision**: the "On-The-Hard - Maintenance Opportunity" group on the
Layup Prep checklist (anodes, hull inspections, Max Prop/Spurs service,
rode reversal, AC/Frigoboat descaling, the dive-service send-out project)
is built entirely from `task_references(kind='task')` pointing at
existing standalone tasks - none of them were moved into the checklist
with `import_task_as_step` or copied with `duplicate_task_as_step`.

**Why**: these are all haul-out-*cadence* tasks that already had their
own independent recurring schedule before this checklist existed. Moving
them in would pull them off the rolling schedule entirely (the same
effect `import_task_as_step` has for a genuine checklist step); copying
them would create a second, disconnected completion history. Neither is
right here - the checklist isn't claiming ownership of when these tasks
are "due," it's surfacing them at the one moment (a haul-out) when doing
them is unusually easy, regardless of whether their own due date happens
to land in that window. A plain task-reference (the same mechanism
already built for one checklist including another inline) does exactly
that without disturbing the underlying schedule.

**Contrast with the checklist's own steps**: the mandatory hard-shutdown
steps (keel-cooled fridge, both AC units, toilets, watermaker) and the
in-water thru-hull-closure step are real new one-off child tasks, because
they're genuinely new content with no prior existence anywhere in the
schema - there was nothing to reference.

## Hard-vs-water layup: `checklist_group`, not two parallel checklists

**Decision**: "Extended Absence / Boat Lay-Up Prep" (#759) and "Return to
Service / Wake-Up Checklist" (#782) are each a single checklist, with
`checklist_group` tags (`On-The-Hard - Mandatory`, `In-Water Only`,
`On-The-Hard - Optional Resource`, `On-The-Hard - Maintenance
Opportunity`, `Post-Splash Only`) separating steps that only apply in one
scenario - not two separate checklists (one for "hauled" layup, one for
"in the water").

**Why**: most of the content (thru-hull exercise, sail-removal decision,
data backup, notifications) applies either way, and the two scenarios
share the same overall shape (secure the boat, come back, reactivate) -
forking into parallel checklists would duplicate all of that shared
content and require keeping two copies in sync on every future edit. The
`checklist_group` field already existed (schema v13, built for sub-list
groups within one checklist) and does exactly this job: a group that
doesn't apply to the current scenario just reads as "nothing to do here"
rather than needing its own checklist entirely.

**Real bug caught applying this pattern**: engine start and watermaker
production were initially drafted into the Wake-Up checklist's ungrouped
("always") section - wrong, since neither runs without raw water cooling
any more than the AC or the keel-cooled fridge does. the owner caught it
directly ("obviously neither motor runs on the hard") before it was
built; both moved into the `Post-Splash Only` group alongside the other
raw-water-dependent restart steps.

## Link, don't duplicate: one master record per task, always

**Decision**: `ImportExistingTask`'s "add an existing task to this
checklist" picker offers **Move as step** (reparent) and **Link as
step** (`task_references(kind='task')`) - no third "duplicate" option.
`data.duplicate_task_as_step` still exists as a backend function but is
unused and not wired to any UI button as of 2026-09-17.

**Why**: the owner, digging into a rendering bug (see below), asked directly
whether the model is "a task exists in the DB as only one record, using
it anywhere ripples to every use" - confirmed true for the default
placement (move) and for references (the one legitimate way a single row
is live in more than one place at once). The one real exception,
`duplicate_task_as_step`, was built earlier for "tasks that legitimately
need independent tracking in more than one place" - but checked against
the live DB before this decision, it had **never actually been used**
(zero duplicate `task_name`s exist anywhere). the owner's own reframing set the
policy: "duplicate *using* that task, not the task itself... link to the
master in multiple places, as opposed to having multiple copies floating
around leading to the appearance of data inconsistency." A duplicate
button sitting right next to "move," both looking like harmless ways to
"add this task here," was an active invitation toward exactly that
appearance-of-inconsistency failure mode the first time someone reached
for it without thinking hard about which one they wanted - worse for
being unused so far only because nobody had reached for it yet, not
because the risk wasn't real.

**Not removed, just unwired**: the backend primitive stays available
(harmless, already-written code) rather than deleted outright, in case a
genuinely independent-history case comes up later that needs it deliberately -
but the UI no longer offers it as a casual choice alongside "move."

**The rare legitimate case this leaves uncovered** (two real-world
activities that happen to share a name but are actually separate
obligations with separate histories - the owner's own "check the fire
extinguisher" example) is better solved by giving them distinct
names/descriptions as two real separate tasks from the start, not a
"duplicate" button that clones one into a look-alike.

## Checklist inclusion had two rendering gaps and a reset-cascade bug

**Context**: the owner, running the new Wake-Up checklist: "there are several
lines that kind of hint at running a separate checklist (Yanmar startup)
but the actual link/logic is missing." Traced through the actual
component code (`ChecklistSteps.tsx`, `data.py`) rather than guessing.

**Bug 1 - per-step references don't render anywhere.** The only
"included checklist" rendering (`IncludedChecklists`) looks at references
on a checklist's own **root** task and only surfaces checklist-kind
targets, shown once above the step list - not tied to any specific step.
References attached to an individual step (what the Wake-Up build
actually did) render nowhere in either Management or "Run a Checklist."
Not fixed by moving references to the root in this pass - see "Link,
don't duplicate" above and the new `LinkedTasks` component instead, which
covers the equivalent case for plain (non-checklist) task references.

**Bug 2 - "Finish run" doesn't reset an included checklist.** Both
`complete_task(..., close_subtasks=True)` and `reset_checklist()` only
ever touched `WHERE parent_task_id = <this checklist>` - direct children,
never a checklist reached only via reference. Ticking an included
checklist's steps while running the outer one correctly writes to the one
shared master row (by design - not a copy); the outer checklist's
"Finish run" simply never learned to walk into what it includes, so the
included checklist was left marked done and un-reset, invisible until
someone opened it later on its own schedule. **Decision**: `reset_checklist()`
recurses into every included checklist transitively, with a `_visited`
set to stop at a reference cycle - the recursion needed a cycle guard
regardless (schema places no constraint against A including B including
A), and the owner flagged that exact risk unprompted before it was raised as a
concern. The same visited-set pattern was added to the frontend's
recursive `IncludedChecklists` rendering, which had zero cycle protection
either. Deliberately scoped to reset only, not to completion — walking
`close_subtasks` into an included checklist's un-ticked steps would mean
auto-completing a physical action (start the engine, run the watermaker)
nobody actually confirmed doing, which is a different and much more
debatable default than "clear it so next time is fresh."

Verified: reset-cascade + cycle guard tested against a scratch DB with a
real forced cycle (A includes B includes A) - confirmed termination and
that both checklists cleared correctly, not just one.

## 3NF as a standing constraint, not a one-off cleanup

**Decision**: hold this schema to explicit 3NF discipline by default
going forward (every non-key column depends on the key, the whole key,
and nothing but the key - no transitive dependencies), not just when a
bug surfaces one. Prompted by the owner naming the principle directly after
the checklist-mechanics session above: "I should have specified 3NF
upfront - I was tracking it, but I should have made sure you were - it
would have saved a bunch of the rework we've been struggling with."

**A systematic table-by-table review** (`db_schema.py`, kept live-current
through v19) found two real drift risks of the same shape as
`duplicate_task_as_step`, both fixed same session (`a2e78e4`):

- `task_references.label` for `kind='task'` rows was a copy of the
  target task's name, frozen at write time - never read by the current
  UI (which already joins live), so no live impact yet, but a silent
  time bomb structurally identical to the duplicate-task bug. Fixed:
  `get_task_references()` always resolves `label` live for this kind;
  `add_task_reference()` stops trusting a caller-supplied value for it.
- `update_stock()` applied `vendor`/`unit_cost` to the `stock` row but
  never carried them into the `stock_movements` row it wrote for the
  same event - real data loss (only a "simple" item's *first* restock,
  via `add_stock`, was ever visible in the audit history), not just a
  display inconsistency. Fixed: `update_stock` now threads those two
  fields into its movement insert, matching `add_stock`.

**Deliberately left alone, flagged instead of "fixed":**

- `meal_plan.overrides` - a JSON blob, technically a 1NF repeating-group
  exception - is a conscious, bounded choice (always written/read as one
  atomic unit, never queried by SQL directly, no risk of two rows
  disagreeing about it), not an oversight. Not worth a child table.
- `storage_containers.container_type` and `tasks.checklist_group` are
  raw `CHECK`-enum/free-text rather than lookup tables, unlike
  `item_types`/`stocking_policies`/`compartments` (which were promoted
  to real lookup tables specifically to avoid this). This is a
  referential-integrity/consistency question, not a normalization
  violation - left open for the owner to decide whether either vocabulary
  changes often enough to be worth the same treatment (see
  [Roadmap](Roadmap.md#open--not-yet-done)).

**Going forward**: when adding a column or table, the question "does
this describe something other than the row it's on" (transitive
dependency) or "is this fact about to be duplicated instead of
referenced" should be asked at design time, the same way file headers
and scratch-DB verification already are - not deferred until a symptom
shows up.

## Compartment › Location › Container: one vocabulary, names unique per compartment {#compartment-location-container}

Three asks from the owner on 2026-09-18 turned out to be one decision: "remove the
1st level name from the 2nd level name", "galley is fine for top level. Get
rid of second level, move 3rd level up to 2nd level", and "normalize our
vocabulary for the locations/containers stack - Compartment / location /
container".

- **Strip the compartment prefix from location names.** Redundant since v19
  added the compartment layer. Stripping made two names collide across
  compartments ("Salon - AFT Cabinet" vs Port Berth's "AFT Cabinet"), so
  uniqueness became `(compartment_id, location_name)` (schema v20) — the
  right key anyway, since "Port" or "Bilge" is a normal name in several
  compartments. The rename rule ignores spaces ("Chainlocker" matches "Chain
  Locker") and knows "Starboard Berth" = the SB Berth compartment.
- **Galley's middle level was pure redundancy.** The Galley compartment held
  one location, also called "Galley", holding 13 containers. Each container
  became a location of its own. The container *row* was moved (renamed
  `loose`, re-pointed at the new location), not recreated, so its stock,
  `container_type` (the freezers stay `frozen`, the fridges `refrigerated`),
  favorite flag and audit history came along untouched — recreating would
  have meant re-pointing every `stock` and `audit_lines` row and guessing
  the type. The empty "Galley Lockers" location was dropped with it.
- **`loose` is the default container.** A location with no bin still needs
  somewhere to put stock, so `add_location` creates a `loose` container in
  the same transaction (Owner: "adding a location - auto create the loose
  entry"). Existing empty locations were **not** backfilled (the owner declined) —
  they get a container when one is first needed.
- **Deleting a location must never orphan a container or its stock** — see
  [Schema](Schema.md#1-physical-spaces).
- **Toolkits (a 200-piece ratchet set): the kit is ONE catalog item** (the owner,
  2026-09-18): "I don't want to track 1000's of pieces." Specific pieces are
  called out in task *text* when that level of detail is wanted, never as
  catalog rows; broken pieces are reordered by exception. So a kit is an item
  in a container, not a container of items - tasks link to items, and the
  kit is the thing they need.

## Punch list is a project, and a checklist is not a system {#punch-list-is-a-project-and-a-checklist-is-not-a-system}

`systems` had 14 entries named "Punch List — <discipline>" and 16 named
after a checklist. Both were artifacts of how the data landed: the punch
list is the still-to-do commissioning work captured per system, and
"punch list" is already modelled as a **project** (the tasks were in #3/#4
all along); a checklist is a *task* with steps, not a piece of equipment.
Each punch task moved to the real system it concerns (with per-task
overrides where a task clearly belonged elsewhere, e.g. "Verify anchor
alarm" → Alarm System), its name swapped the "Punch List — X" prefix for
"<system> - " to keep the `{system} - {action}` convention, and the old
discipline was kept as its phase tag so nothing in the old name was lost.
Checklist steps moved to the shared `Checklists` system. Candidate new
systems (Canvas, Admin, 3-D Printed Parts) were each *rejected* on
inspection: Admin held one task (DAN membership -> Scuba), Canvas held two
that already had homes (isinglass -> Arch/Hardtop, table mattress ->
Interior), and the 3-D printed parts were parcelled out to the system each
part is *for* (the "3-D Prints" phase tag keeps them visible as one group
inside the project). Only genuinely new equipment got a system: **Helm
Pedestal** (being re-architected to hold switches, gauges and the Yanmar
panel - Steering System is the wrong home) and **Washing Machine** (under
Interior). The same session reorganised plumbing by *fluid*: "Bilge Pumps"
renamed **Bilge & Drains** (gray water has no tank or system of its own -
drains go overboard), and a new **Raw Water** category (the shared seawater
supply feeding toilets, washdown pumps, the watermaker and the A/Cs) with
the forward, aft #1 and aft #2 inlets and the anchor/stern wash as devices;
consumers keep their own systems. Thru Hulls stay their own device (they
carry inlets *and* outlets).

**`Checklists` is a hidden housekeeping system (2026-09-20, tracker #31).**
It stays a real row in `systems` because `tasks.system` is a required FK and
checklist steps have no equipment to belong to (`data.create_checklist`
defaults to it), but it is not offered anywhere as a place something lives:
the frontend skips it in the Systems tree, the system/device pick lists
(`SystemPicker`, `ServesEditor`), the Tasks-tab system filter and
TaskDetail's "Open <system>" link (`features/management/housekeeping.ts`).
A checklist or step already on it still shows "Checklists" in its own picker
(`offerableSystems(systems, keep)`), so editing one never flashes "— pick —".
Nothing server-side changed; checklists are reached via Management > Tasks &
checklists, Run a Checklist, the schedule and the cockpit, none of which read
the systems tree. Not a schema flag on purpose - one known name, and a column
would be a migration for a single row.

## Open a sub-element as its own screen, don't squeeze it in {#focus-screens-not-inline}

Owner, 2026-09-18: "if we need to expand a sub element, instead of trying to
figure out how to fit it into the remaining screen footprint, … just
repaint the screen with it as the focus with a 'back' to go back to the list
view we started at." Management already worked this way (2026-09-17); the
Projects tab now does too — clicking a task opens Management's `TaskDetail`
full-screen with "← Back to projects" (and "← Back" when a cross-reference
jumped to another task; since 2026-09-19 Back is always one level and there is
a breadcrumb - see [one navigation model](#one-navigation-model)). The project list stays mounted, just hidden, so
expanded projects are still open on return. Two earlier bugs were the same
mistake in disguise (a `max-height` sized against the viewport squeezing
checklist steps; the same cap on the project task list, removed).

**Retrofit, same day (2026-09-18), after the owner approved the rule and the order.**
The rule: a record's full detail, a child list, or an editing form gets its own
screen; one-line edits, quick actions and small forms stay inline. It is now
applied to project cards (a project screen, task screen nested from it), Recipe
cards, Meal Plan entries, the Locker item panel and the Schedule cards. Left
inline on purpose: the Storage Structure tree (a browsing hierarchy),
the Receive action, telemetry. All of it goes through ONE shared primitive,
`frontend/src/components/FocusScreen.tsx` (`useFocusTrail<T>()` + `<FocusScreen>`:
the back buttons and the trail, so a cross-reference jump gets its own "← Back");
Management and Projects were moved onto it too. Each feature keeps its list
mounted but `hidden` while a record is focused, so search, filters, tab,
scroll and expanded cards survive Back. Two consolidations rode along, because
the owner's stated preference is that reuse simplifies the GUI: (1) the Recipe and
Meal Plan cook flows were near-copies (the meal-plan card's own comment said it
mirrored the recipe one) and are now one `recipes/CookFlow.tsx`, parameterised by
what really differs (which endpoint completes it, whether picks are saved on a
plan entry); (2) the Schedule card's embedded task editor duplicated Management's
`TaskDetail`, so it was deleted and replaced by an "Open full record →" link into
the same screen - Done and Defer stay inline on the card (quick actions).
Behavior notes: unsaved edits on a project screen are discarded when you leave it;
a made meal-plan entry leaves the plan but its result stays on screen until Back;
several projects can no longer be expanded at once (that was the point).

## Devices are named by function; model numbers live at the item level {#devices-named-by-function}

Owner, 2026-09-18: "retain the model numbers at the item level (spare parts
ordering), no need for the task name level (function name is more descriptive
anyway)", then "naming rule - yes universal", and the vocabulary "DEVICE for the
actual item, system is the collection of devices that performs the function".
So a device is named for its job - Main Engine, Generator, Propeller, Windlass,
Shower Sump Pump, Portable Fridge/Freezer - and task names follow
(`{device} - {action}`). 30 devices were renamed in one pass
(`scripts/oneoff/loose_ends_20260918.py`); each keeps "Make / model: <old name>"
in its notes so nothing is lost, and a wrongly-guessed function name is a
one-click rename in Systems admin. Model numbers belong on catalog items: the
spare BP1554, the AK1550/AK1557 service kits, and a new `owned` item per
installed pump model (no stock - installed units are not stock lots; the pumps
had not been catalog items at all, only their kits). Cost of the rule: code that
matched system names by make/model (the `vessel_log` keyword map) needed the
function names added.

## Units are a governed picklist {#units-are-a-governed-picklist}

**Decision** (the owner, 2026-09-18, "3NF OCD"): `items.unit` and
`recipe_ingredients.unit` are foreign keys to a `units` lookup table
(schema v21), not free text — same pattern as `item_types`,
`stocking_policies` and `systems`. The live data had 24 distinct
`items.unit` values and `each`/`ea`, `cup`/`cups`, `Pinch`/`pinch` were
duplicates of each other; a free-text column cannot stop that, a lookup
table can. `unit_key` (`ea`, `tbsp`, `fl oz`) is the natural key the two
columns store, so nothing about how a unit prints changed. The migration
(`migrate_schema_v21.py`) normalised existing values through
`data.normalize_unit`, aborts on anything it cannot map instead of
guessing, and adds nothing to a row it cannot justify.

**NULL semantics**: `items.unit` is `NOT NULL DEFAULT 'ea'`.
`recipe_ingredients.unit` may be NULL, and NULL means "no unit stated / the
item's own count" ("salt to taste", "flour") — **not** "unknown". the owner's
rule for the parser: a line starting with a plain number and no unit
("6 apples", "1 large onion") suggests `ea`; a line with no number stays
NULL; a recognised unit word gets its canonical key; an unrecognised unit
word ("2 stalks celery") gets NULL with `raw_text` keeping the wording.
"ea plus none works for crew member." The migration did **not** touch the 36
existing NULL ingredient rows — the owner fixes individual ones with the picker.

**Imperial, by decision**: "we are a US boat." The seed has no metric
units. Nine live items still used metric (`kg`: Flour, Ground beef,
Oatmeal, Rice, Salt, Sugar; `L`: Olive oil, UHT milk, KM4A2 gear oil), so
the migration keeps `kg` and `L` as **legacy** rows with `offered = 0`
("Legacy metric - convert items to imperial, then delete"): still valid
(saving an unrelated edit to Flour works), hidden from pickers, and
quantities were **not** converted — stock, thresholds, task links and
movements are all still in kg/L until the owner/crew member convert those items by
hand, after which the legacy rows can be deleted (`delete_unit` refuses
while any item or ingredient still uses one). `normalize_unit` deliberately
does not recognise metric words, so a new free-text `grams` is unrecognised
rather than quietly filed under a unit the boat does not use.

**Metric recipes are converted at parse time, not stored metric**: when a
recipe is pasted in metric, `parse_recipe_ingredients` offers the imperial
equivalent as the suggestion (`data.metric_to_imperial`), keeps `raw_text`
verbatim, and reports `converted_from` (`"500 g"`) so the reviewer sees
what happened. Rounding rules — **volume** (from ml): under 15 ml → tsp; 15
to under 60 → tbsp; 60 to under 950 → cup; 950 and up → qt; 3800 ml (3.8 L)
and up → gal; tsp/tbsp/cup/qt round to the nearest 1/4 (never below 1/4),
gal to the nearest 1/4. **Mass** (from grams): under 454 g → oz to the
nearest 1/4 oz (never below 1/4); 454 g and up → lb to the nearest 0.1 lb.
Factors are US customary (1 tsp = 4.929 ml, 1 tbsp = 14.787, 1 cup = 236.588,
1 qt = 946.353, 1 gal = 3785.41; 1 oz = 28.3495 g, 1 lb = 453.592).
Examples: 500 g → 1.1 lb, 250 ml → 1 cup, 5 ml → 1 tsp, 1 L → 1 qt, 30 ml →
2 tbsp, 2 kg → 4.4 lb, 100 g → 3.5 oz. Ranges take the low end, as the
parser always did; a quantity that cannot be read as a number is not
converted. It is a suggestion only — nothing is stored converted unless the
reviewer confirms it, and that write is validated against `units` like any
other.

**Converting the recipe *text* too** (the owner, 2026-09-18: "the text parse and
convert would be handy" / "throw the original metric text away"): the recipe
focus screen has a "🔄 Convert to imperial" button. It is proposal-then-apply:
`GET /api/recipes/{id}/convert-text` runs the pure
`data.convert_recipe_text_to_imperial(body)` on the stored body and returns
`converted_body` plus a `changes` list (`{original, converted}`, one per
occurrence, reading order); nothing is saved. The screen shows the changes as
"before → after" and the converted text in an editable box; **Apply** saves it
through the ordinary update-recipe call (body only), **Cancel** drops it.
**The metric original is discarded on Apply by the owner's decision — there is no
backup field and no undo**; if nothing metric is found the screen says so and
offers nothing to apply. It converts anywhere in the body (instructions and
ingredient lines): Celsius temperatures (`180°C`, `180 °C`, `180 degrees C /
Celsius`, ranges, and a bare `180C` only with a cooking word on the same line
and a value of 30–300), lengths (mm/cm/m, words, `2-cm`, `20 x 30 cm`) and
volumes/masses through `metric_to_imperial` (both ends of `2-3 kg`). Rounding:
**temperature** F = C × 9/5 + 32, then to the nearest **25 °F from 250 °F up**
(oven dial: 180 → 350, 190 → 375, 160 → 325, 200 → 400, 220 → 425) and the
nearest 5 °F below that (63 → 145, 74 → 165), with 0 °C/100 °C exact; written
`350°F` (`350 degrees F` when the recipe spelled the words out). **Length**:
nearest 1/8 in under 1/2 in, nearest 1/4 in up to 4 in, nearest 1/2 in from
4 in (20 cm → 8 in), and from 24 in feet + whole inches (1 m → 3 ft 3 in).
Left alone: unit-less numbers, times, text that is already imperial, a metric
amount sitting next to its own imperial twin (`180°C (350°F)`), unit letters
inside longer words (`program`, `large`, `min`), and European decimal commas
(`1,5 l`) — a wrong guess in a proposal is worse than a miss the user can see.
The conversion factors live beside the volume/mass ones in `data.py`;
`_smoke_textconvert.py` covers the cases and the false positives.

**What `dimension` is for, and what is deferred**: each unit carries a
`dimension` (count/volume/mass/length/other) because it is a fact about the
unit, not about any item that uses it (3NF), and it is what makes two
follow-ups possible: a warning when a recipe line and its catalog item
disagree ("2 cups" of something counted in `lb`), and eventually real
conversion. **Unit conversion (cup → lb) is explicitly deferred** — it needs
per-ingredient density, which is a different feature, and no one has asked
for it. The metric-to-imperial helper above is a fixed-factor paste
convenience, not that feature.

**Cook results report the item's unit**: `make_recipe` (and so the
meal-plan "made it") used to print the recipe *line's* unit, which is NULL
for most rows, so the UI said "short 6 null". It now reports the catalog
item's unit (what stock is counted in) as `unit` and adds `recipe_unit` (the
line's own, or null). `complete_task` already reported the item's unit.

**Revisit if**: a second measurement system is ever wanted (add rows with
`offered = 1` — no schema change), or per-ingredient conversion is
approved (build it on `dimension`; do not store converted quantities in
place).

## Identical devices are tracked as separate devices {#identical-devices-separate}

Owner, 2026-09-18, on the three Seaflo Series 51 pumps: "track 3 separate devices
with the same model number - location/function noted." One device with "(3)" in
its name and one shared task set hides which unit is which and gives them one
service history. So the three pumps are three devices (Fresh Water Pressure
Pump, Anchor Wash, Stern Wash), each with its own tasks and last-completed
dates, sharing one catalog item for the model and its spares. Each device's
notes carry model, location and function (and, for the wash pumps, the
dedicated panel switch and the push-and-twist deck fitting). The same
thinking produced three catalog-tracked Aquor deck fittings and moved the
deck-fitting function check into the Wake-Up checklist rather than the pump
tasks. Other "(2)" devices (bilge pair, black-water pair, toilets) are still
single devices - split only when asked
(`scripts/oneoff/seaflo_split_20260918.py`, `deck_fittings_20260918.py`).

## Fluids: stocking and capacities {#fluids-stocking-and-capacities}

Owner, 2026-09-18. The rules (applied to live the same day by
`scripts/oneoff/fluids_pass_20260918.py`):
- **Fluids are US-gallon jugs**, so fluid items use `gal`; a task's draw is the
  real per-service fill in gallons, from the manufacturer manuals.
- **One oil**: both motors and the KM4A2 gearbox take the same oil, so the
  separate gear-oil item is merged into the engine-oil item.
- **Two coolants**: the motors take different coolants, so each has its own
  item.
- **Coolant is stocked for the failure, not the flush**: an overheat that
  dumps the whole charge into the bilge is the case that strands you (the
  Beneteau did it once with no coolant aboard), not the 1000 h flush. So
  coolant is a critical spare of one FULL system refill per motor, and the
  flush draws from that reserve rather than setting it. Oil and filters are
  stocked for three changes per motor (planned, not verified aboard).
- **No stock is invented**: none of the fluid items has any stock row; counts
  wait for an Inventory Audit walk of the engine room.
- **Why the pass exists**: every fluid task drew 1.0 in the item's unit
  (engine oil "1 qt") while the real fills are gallons, so usage and reorder
  math undercounted by roughly 5x.

Capacities found in the manuals (`references/FLUID_CAPACITIES.md`, primary
sources only): Yanmar 4JH80 oil 1.77 gal with filter (the ~5.8 qt in the task
text is the ZF30M gearbox column and is wrong for this engine), coolant
2.11 gal full system; Westerbeke 8.0 oil ~1.0 gal, coolant 1.25 gal; KM4A2
gearbox 0.79 gal (Operation Manual) vs 0.53 gal (datasheet) - the safe 0.79 is
used for stocking (the datasheet figure is nearer the real top-up). The gearbox
is already filled with the shared 15W-40 (the owner), so the manual's SAE #20/#30
wording is moot. Applied levels: oil reorder-at 3.56 gal (one change of main +
generator + gearbox), target 10.68 gal (three changes); Yanmar coolant floor =
target 2.0 gal (system 2.11, two 1-gal jugs); generator coolant 1.25 gal; the
main-engine flush draws LLC and distilled water 1.06 gal each (an assumed
50/50 mix - the manual gives a 30-60 % band). the owner's rough on-hand estimate
(~5 gal oil, ~2 gal coolant per motor) is recorded in the item notes as
unverified, not as stock.
Several fluids have no manual on disk (hydraulic backstay/vang, watermaker
pump oil and pickling glycol, solvents).

## Catalog edits from the item screen: rename, retype, multi-lot add {#item-screen-edits}

Added 2026-09-19 from the owner's container-assignment feedback (tracker #1-#17 in
`history/CHECKPOINT_ARCHIVE_2026-09-19.md`).

- **Rename** is `update_item(item_name=...)`. It follows `create_item`'s rule:
  blank names are refused and a name may not repeat within an `item_type`
  (case/whitespace-insensitive, HTTP 409 with the existing item's id).
- **Retype** is `update_item(item_type=...)` via `_change_item_type`. Only
  part / food / tool_accessory have a per-type detail (satellite) row; that row
  belongs to the OLD type, so a retype deletes it. The UI (`ItemDetailPanel`)
  confirms first and lists the values that would be lost. The name must be
  unique in the NEW type, and a `tool` that is the `parent_tool_item_id` of any
  accessory can't be retyped until those are re-pointed (HTTP 400). Stock,
  `task_items` and recipe links follow the item_id and are untouched; retyping a
  Food item out of Food just drops it from the Food-only pickers.
- **Save closes**: Save on the item screen returns to the Locker list.
- **Add New Stuff takes several stock rows** (quantity + container, "+ Add
  another location"; a row with no container is stored unassigned). One
  `add_stock` call per row after the item is created; if a stow fails the item
  already exists and the message says so.
- **Compartments sort alphabetically** everywhere the server orders them
  (`list_compartments`, `list_locations`), replacing the seeded forward-to-aft
  `sort_order`. The column is kept but unused; a new compartment used to sort
  after all 17 seeded ones.
- **Schedule labelling**: the `checklists` bucket holds every `interval_type =
  'use'` task, real checklists and plain as-used maintenance tasks alike. The
  tab is labelled "As-used"; real checklists (`task_kind = 'checklist'`) get a
  ✅ and open to their steps, the rest read "as used, last done ..." and have
  no sub-tasks.

- **Thresholds are labelled in workflow terms, once** (`ThresholdFields.tsx`,
  shared by Add New Stuff and the item screen): *Reorder when below* (`min_quantity`;
  the trigger is strict `on hand < value`, so 1 on hand with reorder-when-below 1
  does NOT list), *Buy up to* (`target_quantity`), *Always keep at least*
  (`min_hold`, a critical-spare floor that also labels the row "reorder +
  critical"). For an `owned` one-of tool only *Reorder when below = 1* is needed.
- **"Not yet located" vs "used up"**: an item with on-hand 0 and no
  `stock_movements` row has never been counted, so the Restock List marks it
  *not yet located* (`items_below_minimum().ever_stocked = 0`) and offers a hide
  toggle, rather than presenting a catalog item nobody has inventoried as a
  purchase. Clears itself once any stock is recorded.

- **Assign many items to a container at once** (`data.stow_items`,
  `POST /api/items/stow`, `ItemStowPanel.tsx`): the first-load job is "a batch of
  tools that live together", so the Locker has a checkbox column (+ select-all-
  shown, + a *No stock recorded yet* filter) feeding a review panel with an
  editable quantity per item (default 1), and the Inventory Audit's
  one-at-a-time dropdown became a searchable tick-list feeding the same panel.
  Rules: the call is all-or-nothing; it ADDS a lot in the chosen container (an
  item with a plain lot there has the quantity added to it, because the partial
  unique index allows one plain row per item+container) and never moves stock
  from any REAL container - one item is routinely spread across several
  containers (primary / backup / deep storage), so a batch is simply repeated
  per container. Audit counts stay per-item upserts (`record_count`), so a retry is
  safe and a partial failure leaves the failed items selected.
  **Exception, 2026-09-27 (data.py v43, deploy 23): the Unassigned container is
  drawn from first.** Bulk purchase loads land in Unassigned and the inventory
  walk stows them from there, so a stow that only added would have counted every
  stowed item twice. Up to the stowed quantity comes out of the item's plain
  Unassigned row (a `transfer` -/+ pair in `stock_movements` - a move is not
  usage), an emptied Unassigned row is deleted (what is left in Unassigned at the
  end of the walk IS the exceptions list), a fully moved row is re-homed so its
  acquired_on / vendor / unit_cost survive, and only a quantity beyond what
  Unassigned held counts as new stock. With the Locker filtered to one container
  a tick defaults to what that container holds instead of 1
  (`list_items(container_id)` returns `qty_in_container`). Reopen only if a
  second "holding" container is ever wanted.

## Systems are chosen from the list, never typed {#systems-are-picked-not-typed}

Owner, 2026-09-19 (tracker #1/#16): the systems are a known list, so any place a
system is selected must be a pick list, and any prompt that says "type the name
exactly" should become one. `tasks.system` is a foreign key to `systems(name)`
and every task/project/checklist form already uses `SystemPicker`; the one typed
entry point left was Manage systems' "nest an existing system here"
(`prompt()`), now a pick list plus a per-device "Move to..." list.

The systems tree is **one level deep** (top-level system > device).
`data._check_system_parent` enforces it on create and update: a system can't be
nested under itself or under a device, the parent must exist, and a system that
has devices of its own can't itself be nested. Unknown system names on update
raise instead of silently updating nothing; a duplicate name is HTTP 409.
`part_details.fits_system` is free text but holds descriptions, not system
names, and is not editable in the React UI - deliberately not converted.
`SystemPicker` shows "loading systems..." until the list arrives rather than a
misleading "- pick -".

## System > device > parts, and the Spare unit type (schema v22) {#devices-parts-spare-units}

Owner, 2026-09-19. A **device is a bucket**: a systems row with a parent
(system > device). Tasks and parts attach to it; it is *not* a stocked item and
never appears in the Locker. A **part** is an ordinary item linked to the
device(s) it serves; a **spare unit** (new item type, e.g. a spare pump) is a
complete replacement carried for only *some* devices, linked to the device(s) it
can replace. The item's type says how it relates to the device, so the link
table `item_systems(item_id, system_name)` has no role column. Both sides are
foreign keys: renaming a system updates its links, deleting one with a
`reassign_to` moves them, deleting without removes the links and leaves the items
(they then show up as "linked to no device" in the audit review).

Device details live on the bucket (`systems.make_model`, `manual_ref`,
`installed_qty`, `no_spares_needed`) to support reordering and coverage checks.
Installed devices are **not** stock (they would double-count spares and wreck the
reorder logic); the installed list is the systems tree. `spare_unit` shares the
`part_details` table with `part`, so a retype between them keeps the
manufacturer / part number. Attaching a part, spare unit or supply to a task
auto-links it to that task's system (one fact, not typed twice); tools and gear
are used *on* a device rather than being part of it, so they are not auto-linked.
The single "(N)" in names such as `Toilets (2)` duplicates `installed_qty`; the
names are left alone for now.

**Reviewing parts linked to no device (2026-09-21).** The Inventory Audit tab has a second
mode, "Parts with no device (N)", listing every part and spare unit with no `item_systems`
row (`data.list_unlinked_parts`, `GET /api/items/unlinked-parts`; tools, supplies and food are
excluded because they are not linked by design). A row opens its own screen (a focus screen,
per the house style) showing the free-text hints (`fits_system`, notes, manufacturer, part
number) above the same `ServesEditor` pick list used on the item screen; the row drops off the
list once linked, and the Restock Serves column follows. There is **no "needs no device"
flag**: every part can link to the nearest top-level system ("(whole system)"), so the review
ends at zero by linking, not by exempting, and no column was added. Seeded on first look with
18 of 156 parts/spare units - 6 are the installed-model phantoms (#450-455) awaiting the
device make/model fold, most of the rest are safety gear (PFDs, jackline, tether, bosun's
chair, diesel jugs) that belong to Safety Equipment rather than to one device.

**Spares fit check: catching parts bought for the wrong model (2026-09-21, schema v28).** Several
purchases turned out to be the wrong model for the device aboard (a pre-common-rail Yanmar fuel
filter, a 30-micron Racor pack, a battery for a radio that is not fitted). The Inventory Audit
tab's third mode, "Spares fit check", sweeps every part / spare unit that serves a device
(`data.list_fit_review`, `GET /api/items/fit-review`) and shows the device's make/model beside the
part's own numbers with computed **flags**: `part_number_to_confirm` (literally CONFIRM),
`model_not_on_device` (the part names a model-like token - letters AND digits, e.g. IC-M37,
4JH80 - that appears nowhere, spacing ignored, in the linked device's name / make-model / notes /
sub-devices) and `device_model_unknown` (the device records no model, so nothing can be compared;
informational). Flags are hints, never verdicts: the owner checks the nameplate and records
**Fits / Wrong model / Doesn't apply** in `item_fit_checks` (no row = unchecked; date + note kept).
Decisions (the owner): **a wrong-model part stays in stock but does not count as a spare and never
reorders** (`items_below_minimum` skips it) - the shelf count is still the physical truth, so the
audit walk is unaffected - **and it must physically leave the boat**, so the screen lists where it
is and a "Stage for removal" button moves its lots to `To remove from boat > Trade or scrap`
(created on first use). Known limit: the sweep is only as sharp as the devices' recorded
make/model - at build time 109 of 138 linked parts sat on a device with no model recorded, so
entering nameplates on devices (Systems) is what makes the automatic flags useful. So the screen has
a **no-model gate** (the owner, 2026-09-21): recording Fits or Wrong model against a device with no make/model
asks "are you sure you want to save without the model number?" (safe button "Go back"), and each such
device gets an inline make/model box on the same screen (the same PATCH as the Systems screen), which
re-sweeps the list on save.


## Small follow-ups (2026-09-21, no schema change) {#small-followups}

- **Part rows open the item (AppNav).** The system screen's parts list is tappable: `components/AppNav.tsx` is a small context App.tsx
  provides (`openItem(id)`: switch to the Warehouse tab and leave the id pending; `LockerTab` opens that item's focus screen and clears
  it). No router; the /cockpit UI has no provider, so there the rows stay plain.
- **Shopping-list toggle on the item screen** (`ItemDetailPanel`): the same `items.on_list_since` request the Restock "Need something?"
  box and the Galley cart use (`PUT /api/items/{id}/on-list`).
- **Meal-plan Protein control.** A plan entry now has a dedicated Protein select: `PUT /api/meal-plan/{id}/protein` ->
  `data.set_meal_plan_protein`, which changes only the protein and keeps the other saved picks (a recipe with its own protein line has that line
  swapped or restored; otherwise the protein is an added extra). `list_meal_plan` returns `protein_item_id` (chosen) and
  `recipe_protein_item_id` / `recipe_protein_name` (as written). The cook flow re-seeds from the saved picks when it changes.
- **A step's parts/tools on the print card** (`print_sheet._step_items`): "Needs: ..." under the step, hidden with the how-to notes.
- **`part_details.fits_system` stays** (not moved into notes): the Spares fit check shows it as "Fits (as bought)" and uses its model-like
  tokens for the model-not-on-device flag.

## Project phases: a per-project ordered list, not a scheduler (schema v23) {#project-phases}

A **phase** is a stage of one project (haul-out, yard work, pre-splash, splash, sea
trial - as fine or coarse as the owner wants). Each project has its own list:
`project_phases(project_id, name, sort_order, notes, target_start, target_end)`,
name unique within a project, no done state. A task optionally points at one phase
(`tasks.phase_id`), and that phase must belong to the task's own project - enforced
by triggers, with `data.set_task_phase` giving the friendly error first. Moving a
task to another project, or releasing it, clears its phase; deleting a phase
releases its tasks; deleting a project cascades its phases.

The same system can appear in several phases, so the task's system stays an
independent attribute - a phase is a time stage, not a work area. The old
`tasks.checklist_group` tags on project tasks (Rigging, Electrical ...) were really
work areas; they are kept in the database, untouched, but no longer shown on the
project screen. **Deliberately not a scheduler**: no dependencies, durations,
critical path or Gantt - a formal project-management tool would do that job.
(`tasks.is_critical` means safety/priority, not critical path.)

## Bulk is a property of the item; provisioning is an explicit decision (schema v24) {#bulk-and-provisioning-modes}

**Bulk lives only on the item** (`items.stocking_policy = 'bulk'`). Before v24 the
recipe line carried its own `is_bulk` flag as well and the two disagreed for 20
item/unit groups (flour marked consumable with bulk lines; butter marked bulk with
non-bulk lines, so "1 cup butter" became "1 block" on the cart). The column is
dropped; `get_recipe_ingredients` derives `is_bulk` from the item. A cup of flour is
drawn from the bulk flour bin, so the recipe keeps its cup and teaspoon text while
the shopping cart never depends on it. 34 food items were reclassified
consumable -> bulk (staples, spices, condiments, cheeses, deli meats, frozen
vegetables, ...); 18 counted items stay consumable.

**The food cart's rule** (`data._meal_plan_needs` / `food_cart`): a planned recipe
line contributes a *quantity* only when it is comparable with the item - the item is
not bulk, and the recipe unit equals the item unit (a bare count is 'ea') or the pick
carries its own quantity. Otherwise the item is only flagged `needs_some`: if none is
on hand the cart asks for **one** unit ("do we have it or not"), shown as "need some".

**Provisioning is an explicit mode, never a sentinel quantity** (Owner: zero already
means "none on hand"). `food_details.provision_mode` is `undecided` (default; the
only mode the Galley plan warns about), `baseline` (keep a standing stock of
`provision_qty`, which must be > 0) or `recipe_only` (no standing stock; bought only
when a plan needs it, quantity NULL). Triggers enforce the pairing;
`data._checked_food_details` gives the friendly error. Items with no `food_details`
row read as `undecided` through `v_food_catalog`. The Galley view has a triage table
for the undecided items, and the item screen and Add New Stuff carry the food fields
(category, stowage, shelf life, mode, quantity, scales with crew). Beverages are food
items in category `beverage` - there is no separate beverage type.


## Ingredient matching asks instead of guessing {#ingredient-matching-asks}

The recipe-ingredient parse used to pre-select its top fuzzy guess for every line, so
weak matches (nutmeg -> Butter, quick oats -> Chicken breast) were saved unnoticed - and
those links feed the shopping cart. `data._ing_match_score` now compares the
*meaningful words* of the line and the catalog item (descriptors and units dropped,
crudely singularised, text before a comma only) and returns 0..1: 1.0 only for the same
word set; a partial overlap ("brown sugar" vs "Sugar") or a spelling-only resemblance
stays below the strong line. `parse_recipe_ingredients` reports `match_class`
(`strong` / `weak` / `none`); **only `strong` is preselected**, everything else is put to
the reviewer (IngredientReview.tsx): pick a suggestion, pick any food item, add the item
on the spot (Food, counted in what you buy it in - never the recipe's spoon or cup - with
kind and aisle category, `provision_mode` undecided), or keep the line reference-only.
Save waits until every ticked line is decided. Lines with no amount and no clear match
are treated as headings/notes and left unticked (visible). Saved lines carry an advisory
`link_check`; a saved link that does not look like its line shows a warning and the same
fix chips. Pasted unicode fractions (1½, ¼) and the units "tbs" and "c" now parse.


## Bulk items are assumed available; a pantry check puts them on the list (schema v25) {#pantry-check-and-requests}

A bulk staple (flour, spices, condiments) is **assumed to be aboard**. It never reaches
the shopping cart because a recipe mentions it - not from the plan, and not because its
on-hand number reads zero (most were never counted). It reaches the cart only when
someone answers "do we need more?": `items.on_list_since` (a date; NULL = not requested)
is set from the **pantry check**, and cleared when stock is received (`add_stock` /
`stow_items` with reason `restock`; an audit count does not clear it). The cart adds an
`on_list` flag and buys at least one unit of a requested item. This replaces the v24 rule
"planned recipe + none on hand = buy one" for bulk items; counted items whose recipe unit
cannot be compared with the item's unit (3 cups of chicken vs an "each" item) still use it.

The same request also serves the **stuff cart** (2026-09-19, tracker #23): "where do I enter
something I just want to buy" for spares, supplies and tools is the Restock tab's "Need
something?" box, reusing `on_list_since` rather than a second mechanism (see Logic-Flows
section 9). One request flag, two carts: food requests show on the food cart only, everything
else on the Restock List only.

Where the check happens: at **meal-plan time** (the crew's preferred moment) on the plan
entry, and at cook time as an option - both are the shared `CookFlow`, whose bulk section
is the pantry check. Because planning a menu should also review the whole pantry, there is
a **standing recipe** ("Pantry check - bulk staples"): a real recipe whose lines are every
bulk food item, kept in sync with the catalog each time its ingredients are read, added to
the plan with one button, showing only the ticks and no cook controls. The Galley cart also
has a "Need something?" box (put any item, or a brand-new one, on the list) and a "Received
something?" box (receive any item, including one not in the catalog yet - a foreign market
always has surprises). All new-item paths share one form, `NewFoodItemForm`: name, counted-in
unit (never the recipe's spoon or cup), counted vs bulk, aisle category; the item starts
`undecided` in the Galley triage.


## GUI conventions learned from bugs (2026-09-19) {#gui-conventions}

- **No nested `<form>`s.** A reusable picker (SystemPicker, GroupPicker) is dropped into other
  forms (the project New-task form, Add New Stuff), so its inline "+ new ..." editor must not be a
  `<form>`: a nested form's submit navigated the whole page before anything was saved (tracker
  #34/#35). Use a `div`, `type="button"` ticks and Enter/Escape on the input. React logs
  "<form> cannot be a descendant of <form>" when this is wrong - treat that console error as a bug.
- **Completing a task removes it from the lists you act on.** The projection is unchanged (a
  completed task still reappears in its calendar bucket with its new due date, and in the action
  lists when due again), but a task done TODAY folds into a "Done today" list under Critical /
  Overdue / Due Today / This Week / As-used, so completing visibly shortens the list (#29).
- **A list cell that can hold several things shows each on its own line.** The Locker's Stowed
  column returns one entry per container joined with " | " and renders one per line (#38); do not
  join with a bare comma in a nowrap cell.


## Completion audit trail (schema v26) {#completion-audit-trail}

Before v26 the app kept only the latest `tasks.last_completed_date` (overwritten on each
completion) and, separately, sent each completion to the previous developer's log webhook (`backend/vessel_log.py`)
- which is a documented no-op until he stands up the endpoint, and keeps nothing locally. So
nothing could show *which* tasks had been completed. `task_completions` is now the app's own
durable record: one row per completion, written in the same transaction, with SNAPSHOT name /
system / project (an audit row is a historical fact and must survive the task being renamed,
moved or deleted; `task_id` is `SET NULL`). `completed_on` is what the user logged (it can be
back-dated); `recorded_at` is when it was recorded, and the Log tab flags the difference - a
completion logged for an old date leaves an overdue task overdue, which is otherwise
indistinguishable from "it did not work". The Schedule screen also confirms every completion with
a toast that outlives the task card, and shows a failed request instead of failing silently.
The trail starts at deploy (earlier completions were never kept). the previous developer's feed can later replay
from this table. Not to be confused with `stock_movements`, the audit trail for stock changes.

**Extended the same night (still schema v26): the trail is a maintenance history.** Each entry also
records the schedule rule in force, how late it was (`days_past_due`, positive = late, negative = early;
`hours_past_due` for run-hour tasks; NULL when there is no schedule to be late against - first recorded
completion, break/fix, as-used), free-text notes for that completion, the spares used (`task_completion_parts`,
name / part number / quantity snapshots) and fields captured automatically (source, criticality, both meters'
hours, the previous last-done state). It is **append-only, enforced by triggers**: nothing is edited or
deleted; a mistake is corrected by **voiding** the entry (a reason is required) - voiding a task's latest live
entry restores its schedule - and then recording the right one. Deleting a task leaves its history
(`task_id` becomes NULL). Roadmap (not built): crew "performed by", outcome / follow-up task, evidence
attachments, cost and vendor (privacy question open), warranty, device-level install fields, a backfill form
for past service (refit, rigging, engine invoices), non-task events, a printable CARFAX-style report, a military
DTG display, and replay to the previous developer's log feed.
*(Status 2026-09-22: the backfill form, printable report, DTG display, cost/vendor (v31), device identity and
the performed-by pick list (v32) are built and live; invoices became their own table (v33, live - see
[#invoices-are-documents](#invoices-are-documents)); outcome + follow-on tasks are live (v34 - one additive
column, see [#follow-on-tasks](#follow-on-tasks)). The columns for evidence path, event kinds and `sent_at`
exist (v32), so those features are code-only when built. Replay still waits on the previous developer's endpoint.)*

**The UI for it (2026-09-19).** The Complete panel has a "Notes for this completion" box (sent as `notes`;
distinct from the task's own caution notes, which the card's "Save notes" edits). Lateness is formatted in
one place, `features/schedule/lateness.ts` (`15 d late` / `on time` / `2 d early` / `30 h past due`), from
the numbers the backend stores - the UI never recomputes due-date math - and appears in the completion
toast, the card's inline result and the Log tab. The Log tab lists each entry with its lateness badge,
notes, spares used (a `CONFIRM` part number shows as "P/N unconfirmed") and a "Void..." control with a
required reason; voided entries stay visible, struck through and tagged VOIDED, and drop out of the on-time
summary line (live entries with a schedule to be measured against only). No edit or delete control exists,
matching the triggers.

**Log tab filters (2026-09-21, no schema change).** The tab has a Period picker (Last day / 7 / 30 / 90 /
365 days - by when the entry was RECORDED, grouped by that day, as before - or any single YEAR, or All time -
by the DATE LOGGED, grouped by that date, because "what did we do in 2026?" means the work date, not when it
was typed in), a System picker (top-level systems with entry counts) and, once a system with devices is
chosen, a Device picker. `GET /api/tasks/completions?year=&system=&device=&days=` (`days<=0` = all time) and
`GET /api/tasks/completions/facets` (`data.list_completions`, `data.completion_facets`). Matching uses the
SNAPSHOT `system` name stored on each entry (the trail is append-only), joined to `systems` only to find the
top-level parent, so a later rename leaves old entries under their old name rather than losing them.


## One navigation model: a trail with breadcrumbs, Systems as a light list {#one-navigation-model}

Owner, 2026-09-19 (tracker #32/#36/#37): "Back" went to the top level rather than one level, the
Manage systems panel showed every system and device expanded at once, and the app now nests up to
four layers deep (SYSTEM > DEVICE > PARTS > TASKS, and PROJECT > TASK > system > device). Decision:
ONE navigation model for all of it - the focus trail of `components/FocusScreen.tsx`, extended.
(1) **"← Back" is exactly one level** ("← Back to Propulsion"); the old "← Back to <list>" button
cleared the whole trail, which is why Back seemed to skip levels. (2) **A breadcrumb** ("Systems ›
Propulsion › Main Engine › a task") shows where you are and jumps to any earlier level in one click
(`goTo`). (3) **The trail can start with its ancestors** (`openPath`), so opening a device from the
list already has its system behind it. (4) **Following a link to something already on the trail walks
back to it** rather than stacking a duplicate (task -> its system -> the same task). (5) **Systems
are a light list**: Management has two views, Tasks & checklists and Systems & devices; the Systems
list shows only top-level systems, collapsed, with counts and a "no parts linked" / "no spares needed"
badge on devices, searchable, expandable in place. Nothing is edited in the list. (6) **Going below the
list opens a `SystemScreen`** (one system or device): its details (make/model, manual, installed qty,
"no spares needed", notes - the device record from schema v22), its devices, its tasks (a task row opens
the task on the same trail) and its parts and spare units with on-hand; rename, move under another
system and delete live there, off the list. A task's screen has an "Open <system> →" link. Management and
Projects share the trail vocabulary (`management/focusKeys.ts`, `NavKey = task | system`), so the same
screens work from either. Two implementation notes: a system's screen must survive a rename, so the
trail entry is swapped (`replaceCurrent`) and the screen copes with the cache lagging a tick behind
(no effect that reacts to "system missing" - it fired mid-rename and dropped a level); and steps of a
checklist are filed under a system but open through their parent, so the screen counts them ("plus 12
steps") instead of listing them. Not done: parts rows are not clickable (the item screen lives in the
Warehouse tab; cross-tab navigation is a separate decision).


## Container pick lists: Galley first for food, `loose` first everywhere {#container-picklists}

Owner, 2026-09-19 (tracker #25/#26): the container list had ~140 entries to wade through, and food is
only ever stored in the Galley compartment - which deliberately also holds a few locations that are not
literally in the galley (filed there to make exactly this easier), so "Galley" is really "the food
stores". `components`-level rule, one place (`warehouse/ContainerPicker.tsx`): for a FOOD item the picker
shows a "Galley" group first (22 containers today) and "Everywhere else" below - a default, not a lock,
so an odd lot (one food lot sits in the Salon) is still possible. For every item type, containers sort by
compartment, then location, then `loose` first and the rest A-Z. The favourites group (per-container flag)
stays on top when any exist (none set today). Callers pass the item's type where they know it (Add New
Stuff, the item's stock editor, Receive on the Galley cart / Receive panel / Restock rows); the
multi-item assign bar mixes types, so it only gets the ordering. Deliberately not built: a two-step
location-then-container picker, or preselecting a container (blank unless the lot already has one).


## Tap-safe confirmation on every delete, and moving things in the storage tree {#tap-safe-confirm}

Owner, 2026-09-20 (tracker #45/#46), kicking the tires on a tablet while someone else was driving the
boat: a stray tap on a delete button, with no check, deleted a storage location. Two decisions.

- **One in-app confirm, not the browser's.** `components/ConfirmDialog.tsx`: `useConfirm()` returns a
  promise (`if (await confirm({ title, message, confirmLabel, cancelLabel })) ...`). The dialog is big,
  the SAFE button ("Keep it", or a specific label such as "Don't move") is first and has focus, the
  destructive button is a separate large target two rem away, and a backdrop tap or Escape cancels - so a
  wandering thumb lands on the safe choice. It replaced all 11 native `confirm()` calls (the native dialog
  is small and is auto-dismissed in the browser test pane) and was ADDED to the deletes that had none:
  compartment / container delete, the item screen's stock-row delete, task references and linked-task
  unlink, remove-task-from-project, abandon audit. Deliberately not confirmed: pure UI removals (a
  selection row, a form row, a toast), "reset to original date", Void (it already asks for a reason), and
  the Restock "take off the list" tick - each is either not data or trivially redone. Storage-tree deletes
  need no undo: the server already refuses to delete a location/container that still has any stock row
  (a zero-quantity row counts), so a confirmed delete can only ever remove empty structure.
- **A container can be moved to another location** (`PATCH /api/storage/containers/{id}` with
  `location_id`; the backend already allowed it, the UI did not). A "Move to..." pick on each container row
  in Edit Storage Structure lists every other location grouped by compartment. A container with stock rows
  asks first (the rows travel with it - stock references the container, not the location); an empty one just
  moves. A name clash at the destination (`UNIQUE (location_id, container_name)`, e.g. two `loose`) is
  refused with a message rather than merged. Locations already had a "move to compartment" pick, and a stock
  row already moves via its container pick on the item screen.

## Choosing a protein when a recipe goes on the plan {#protein-pick}

Owner, 2026-09-19 (tracker #24). The 2026-09-17 swap picker (any catalog item per recipe line, saved
with the plan entry) stays, but it was reachable only AFTER adding the recipe, was the whole food
catalog, and had no idea which line was "the protein". Now the recipe's add-to-plan row has a
**Protein** pick: the short list, "as written", or "+ new protein...". A **protein is a food item whose
aisle category is `meat`** (chicken, ground beef, bacon, eggs, deli ham/turkey and now beef, pork,
shrimp, fish, sausage) - no separate table, so a protein added on the fly (name + unit, category set to
meat automatically) joins the list at once. **Behaviour (the owner's choice): the pick REPLACES the recipe's own
protein line if it has one (a direct line linked to a meat item - the first if several), otherwise it is
ADDED as an extra of 1**, and choosing the protein the recipe already has changes nothing. The server does
it in one call (`data.add_to_meal_plan(protein_item_id=)`, `_protein_picks`): the entry is created with
the full saved-picks list (`meal_plan.overrides`, same shape the cook screen builds - one pick per drawn
line plus the protein), so the shopping cart, the plan entry and "Made it" all reflect it immediately, and
the usual swap controls still change it later. "Manage proteins" (Meal Plan tab, `ProteinsManager.tsx`)
adds a new protein, makes an existing food item a protein, or takes one off (sets/clears the category);
renaming and units stay in the Locker. The five new items came from the one-off
`scripts/oneoff/add_proteins_20260919.py` (lb, meat, stowed frozen, provisioning `undecided`, no stock).
Not done: the plan entry screen has no dedicated protein control of its own (its per-line swap is the
way to change it after the fact).

## One task, several homes: link from the task itself (tracker #48) {#task-in-checklists}

Owner, 2026-09-20: he was on a standalone task (an as-used one - Generator pre-start checks, Windlass
clutch check...) and realised it should also sit in a checklist, but linking only worked from the
CHECKLIST side: change focus, find the checklist, then find the task again. "Duplicate" was the wrong
word - the standing rule stays **link, don't copy** ([above](#link-dont-duplicate-one-master-record-per-task-always)):
one master task row, any number of `task_references(kind='task')` links to it.
- **From the task** (`management/TaskInChecklists.tsx`, on the full record that opens from Schedule's
  "Open full record", Management and Projects - deliberately the one place, not buttons scattered over
  the cards): "In checklists" lists every checklist that links the task (each clickable, each removable
  through the big confirm - only the link goes) and an "Add to a checklist..." pick that links it in one
  tap without leaving the task. `GET /api/tasks/{id}/linked-from` is the reverse of `/references`. A task
  that is already a step shows "A step of <checklist>" (it was moved there, so it is off its own schedule).
- **From the checklist** the link picker is now ONE search box over every task (`GET
  /api/tasks/{checklist}/checklist/linkable`) instead of pick-a-system-then-a-task, and it now offers the
  ~290 tasks that already live as a step of another checklist (the old list hid them: only standalone
  tasks). A step can be LINKED but not MOVED (moving would pull it out of its first checklist).
- `add_task_reference` refuses linking a task to itself or linking the same task twice into one checklist.
- **Piece 2 (schema v27, same day): a linked task is an inline line of the checklist, ticked per run.**
  Problem found while scoping: a linked task showed in a separate "Linked tasks" box, its tick meant
  "ever completed" (so it looked done forever after the first time), Reset did not clear it, and
  un-ticking it blanked the MASTER's last-done date (`clear_completion`) - harmless for an as-used task,
  destructive for a dated recurring one. Now (`ChecklistSteps.tsx` v3, `data.get_checklist_items`): links sit
  in the step order and group (`task_references.sort_order` / `checklist_group`, one numbering with the
  steps), a tick = a REAL completion of the master noted "Ticked in checklist: X" whose id is kept on the
  link (`done_completion_id`), un-tick = VOID that completion (the master's date goes back to its previous
  live completion), Reset forgets the run's ticks (completions stay in history). Decisions: **Finish run does
  not force-complete linked tasks** (only the checklist's own steps are force-closed - a linked master that
  wasn't actually done must not be stamped done); a link's title/how-to are edited on the master task, the
  checklist only edits its group and place. Older steps with no sort number are numbered when something is
  first added (they sorted last, so "add at the end" used to land mid-list). Wiki: Logic-Flows section 12,
  Schema v27.

## Print on demand: one checklist, one page, from the checklist screen (tracker #49) {#print-on-demand}

Owner, 2026-09-20: the old print export (a Streamlit "Print view" download plus a batch script writing one
HTML file per checklist, all at the repo root and reading only a checklist's own steps) had to be
re-architected into the current app. His direction: **print on demand**, for the regular operational
checklists (not the long commissioning / lay-up books), **fit to a single page**, no binder or batch, and
no versioning ("I'll reprint if it changes and the change warrants the effort").
- `GET /api/tasks/{id}/checklist/print` (`backend/print_sheet.py`) returns one standalone HTML page, built
  fresh each time from `get_checklist_items` - so linked tasks print in their place - with any checklist it
  INCLUDES expanded inline (loop- and depth-guarded). A "🖨️ Print" link in the checklist header (top-level
  only, so every place ChecklistSteps appears has it, cockpit included) opens it in a new tab; the user uses
  the browser's Print / Save as PDF. Tick boxes are always blank (a laminated card is a reusable template),
  with a Date / Completed-by line and a footer "SV Your Boat Name - As of dd mmm yy".
- **Readable first, one page where that is possible** (the owner, same day, after seeing Engine Start at 70%:
  "Engine Start needs to be readable - looks like 2 pages unfortunately"). The fit is done in the page, not
  the server: a few lines of inline JS scale the sheet's font (em-based sizes) against the 9.8in printable
  height, but only down to 85%. A card that fits at >= 85% prints on one page; one that does not stays at
  full size and runs to a second page (print front and back - steps never split across the break). A
  screen-only toolbar has Print, "Show how-to notes", Letterhead and **"Force one page (smaller text)"**, which
  restores the small-print behaviour (shrink to 60%, then two columns, then hide notes), and says what it
  chose. Measured on live-shaped data: Engine Start 22 lines = 2 pages at 100% (1.5 pages of content),
  Pre-Passage = 2 pages, Watch Handover = 1 page at 100%; the Lay-Up book (43 lines) = 3 pages at 85% - out of
  scope by the owner's choice ("that is an occasional").
- **Letterhead** (Owner: "might be nice to explore"): the bow artwork (`Artwork/Name Decal 2.jpg`, copied to
  `backend/assets/name_decal.jpg`, embedded as a data: URI so the printout is one file) sits at the top left with
  the checklist name to its right, with a toolbar toggle; it costs about 2 points of scale. Prototype - the owner has
  the higher-resolution `Name Decal.psb` if a larger or single-colour export is wanted for laser printing.
- The root `export_checklists_print.py` batch exporter was removed; `checklist_print.py` is now a thin shim
  over the new renderer so the retired Streamlit tab still imports (delete it with Streamlit).

## A step's "Details": how to, what you need, where it is - and editable parts/tools (tracker #28) {#step-details}

The 2026-09-13 question was "under a checklist task, should there be a 'full task' view (parts / tools /
instructions)?" the owner, 2026-09-20: yes, all three parts, **no stock draw**, and on the cockpit too. Facts that
shaped it: instructions were already shown in full under every step (264 of 305 steps have text), but only
2 of 305 steps had parts/tools linked (167 of 479 standalone tasks do), the parts/tools list existed only on
the Schedule card ("Items - tick what you used up"), and NO screen anywhere could add or remove a task's
parts and tools (they had been loaded by scripts).
- **"Details" on every checklist line** (`ChecklistSteps` `onOpenStep`; a linked task opens its master task).
  Where it goes depends on the host, consistent with the focus-screen rule: **Run a Checklist** opens
  `StepDetail` as a focus screen (Back returns to the run, ticks are on the server); **Management / Projects /
  Schedule card** open the step's full record (`TaskDetail`) on the existing trail; the **cockpit** tablet swaps
  the run screen for `StepDetail` with a Back, larger text and READ-ONLY (no edit list, no "open full record"):
  the helm tablet is for looking, not restructuring data.
- **`StepDetail`** (read-first): the full how-to (description + the amber caution note), **What you need**, and
  the task's references (manuals / links / notes). **`TaskNeeds`** is the shared "What you need" block, also
  embedded in `TaskDetail` for every non-checklist task: each item with need / have / unit, a SHORT flag,
  and "📍 where stowed" (`data.get_task_items` already returned `stowed_at`); "Edit list" (desktop only) adds items
  from a catalog SEARCH (never typed text), edits quantity and a short note, and removes a requirement through the
  confirm dialog - only the link goes, never the item or its stock (`PUT/DELETE /api/tasks/{id}/items/{item_id}`,
  which already existed).
- **Information only**: ticking a step still draws nothing; stock use stays with the Schedule card's Complete
  flow. Not built (open): parts/tools on the printed sheet; most steps still have an empty list until it is filled.

## Electrical device tree grows from real sources, not the plan (2026-09-21 night) {#electrical-devices-from-real-sources}

The `Electrical` system had two catch-all devices (`Power Electronics`, `Power Monitoring & Control`) holding
generic recurring tasks, with no device-level record of the actual Victron gear. Working from the owner's VRM
screenshots, the previous developer's Grafana `ssm_battery` dashboard, and the owner's own corrections, individual devices were added:
`House Battery Bank` (6x Solid State Marine 31-24V150, 900 Ah), `Inverter-Charger - MultiPlus-II 24/5000`, two
`Battery Monitor -` Smart Shunts, three `Solar Controller - MPPT` devices (150/85, 150/60, 150/45 - names and
models corrected twice as better sources arrived), two `Starter Battery Charger - Orion DC-DC 24/12-30` devices
(one per starter, not one shared unit), and a `DC-DC Converter - Berth A/C Fan Controller 24/24`. The generic
catch-all devices keep their existing recurring tasks; nothing was moved.

**Lesson - don't infer a document is stale from a text-only scan.** A first pass claimed the electrical deck
(`Refit/your vessel/Electrical/Electrical Layout - projected.pptx`, the owner's kept-current source of truth) was "wrong"
about the Orion count and missing the 24/24 converter, based only on a flat python-pptx text-node extraction
against a short fixed term list. the owner pushed back - he updates the deck from paper "book of knowledge" slides and
would check himself. A flat text scan proves nothing by its silence: it can miss overlapping shapes on a slide,
and text baked into an embedded image is invisible to it entirely. The claims were withdrawn (see
`history/CHECKPOINT_ARCHIVE_2026-09-21_night.md`). Applies to any future pass reconciling this app against that
deck, or any other image-heavy source document - read it visually, don't infer from text extraction alone.

**Update 2026-09-22:** `DC-DC Converter - Berth A/C Fan Controller 24/24`'s make/model (left "to be confirmed"
above) is now confirmed - Victron Orion-Tr 24/24-12 (isolated, 280W), manual linked. This also produced the
session's own cautionary tale for the [device-manual-research feature](#device-manual-research-review-then-apply-never-auto-write):
a new device was briefly created for this same converter under different wording ("24/24 Converter - Berth A/C")
before the duplicate was noticed and merged away - see `history/CHECKPOINT_ARCHIVE_2026-09-22.md` and
`references/DEVICE_MANUAL_RESEARCH_INSTRUCTIONS.md` §0/§6 for the rule this added (search the tree by function,
not just by name, before creating a device).

## Device manual research: review-then-apply, never auto-write (tracker #50) {#device-manual-research-review-then-apply-never-auto-write}

Point Claude at a device and (optionally) its manual, get back a structured draft - make/model, maintenance
tasks, spare parts, each cited to a manual page - for the owner to review and apply piece by piece. Built 2026-09-22
after a deliberate calibration round done by chat first (two real devices - the Orion DC-DC converters, the
Washing Machine - see `history/CHECKPOINT_ARCHIVE_2026-09-22.md`), per the already-scoped
[[new-device-jit-update-workflow]] memory's own instruction: "do 2-3 real devices by chat first to learn the
draft format" before building anything.

**Shape**: mirrors `code/routing`'s already-working "Research with Claude" feature almost exactly - a headless
`claude -p` subprocess (own OAuth token via `claude setup-token`, never `--bare`, environment stripped of
API keys and inherited Claude-session plumbing), an in-memory job registry (one job at a time, poll/cancel),
a frontend panel with an explicit consent step before every run. Differs where the problem differs: the tool
granted is `Read` (a local manual PDF), not `WebSearch`/`WebFetch`; the output is a structured JSON draft, not
a Markdown section, because it needs to populate real form fields (device, tasks, spares), not free text.

**The one rule that matters most**: nothing here has its own write path. Every "apply" button in the review
panel calls the SAME ordinary endpoint/mutation a human editing by hand would call
(`useUpdateSystem`/`useCreateTask`/`useCreateItem`+`useSetItemSystems`) - the draft is never trusted enough to
get a bulk-apply shortcut of its own. This was already policy in the chat-driven calibration round (every
change went through a dry-run-then-`--apply` one-off script with a verified backup, same as any other data
pass) and the GUI keeps the same shape rather than inventing a faster, less-reviewable path just because a
button makes it easy to.

**The recipe is data, not code**: `references/DEVICE_MANUAL_RESEARCH_INSTRUCTIONS.md` is read from disk at
run time and IS the system prompt - the owner can tune what the research looks for, and add a lesson to its own
changelog section, without a redeploy. It reuses `references/PROVENANCE.md`'s citation-tag scheme rather than
inventing a second one.

**Known limitation, not yet solved**: any server process descended from a currently-open Claude Code session
inherits a stale environment and cannot see a freshly-set `CLAUDE_CODE_OAUTH_TOKEN`, so the feature will show
as unavailable on a server Claude itself launches this way, no matter how the process is detached - see
[[claude-desktop-app-msix-env]]. Only a server the owner starts himself, outside a Claude session (or after a
reboot), sees the current token.

**Explicitly deferred, not built**: the file-picker version of this (a GUI control to browse to a manual
rather than typing/pasting a path) - the current panel takes a manual path as typed text. Also deferred: a
"clone device with rename" (tracker #67) that would reuse this same draft-review machinery for duplicating an
already-set-up device rather than researching a new one from scratch.

## "Unassigned" is a real container, never a NULL container_id (tracker #62) {#unassigned-is-a-real-container}

**Decision**: stock that nobody has put in a physical container yet lives in a real
`storage_containers` row ("Unassigned › Unassigned › loose", created on first use by
`data._unassigned_container_id()`), not `stock.container_id = NULL`. `add_stock()` and
`receive_stock()` resolve a `None` container to this real container BEFORE opening their own
write transaction - never from inside one, since a second connection trying to write while the
first is still open self-deadlocks (SQLite's own single-writer lock, not a hypothetical).

**Why**: "— unassigned —" (picked from Add New Stuff or Receive when nobody has chosen a place
yet) is a deliberate, still-used feature, not a one-off data artifact - but NULL was invisible to
the Inventory Audit's Count Stock walk, which is structurally per-container (it can only ever
show a real `storage_containers` row as a tab to work through) - #62 asked for exactly this: "the
default view should include items not in any container." Making the walk understand NULL
directly (teaching `record_count`/`audit_lines` to accept it) was rejected: SQLite's UNIQUE
constraint treats every NULL as distinct, so `audit_lines`'s
`ON CONFLICT(audit_id, item_id, container_id)` would silently start duplicating rows for an
"unassigned" item on every re-count instead of updating one. A real container sidesteps that
entirely - normal per-container uniqueness just applies. Bonus, not the original goal: this also
closes a latent bug in `ux_stock_simple_lot` (`stock(item_id, container_id)` partial unique
index), which shared the exact same NULL-are-distinct quirk - more than one "plain" NULL-container
row for the same item could in principle have piled up unmerged, never picked up by the "add into
the existing home row" logic that works correctly for every real container.

**Same idiom as `REMOVAL_COMPARTMENT`**: mirrors the existing "To remove from boat › Trade or
scrap" staging place (`_removal_container_id()`, tracker #58/#61) exactly - a lazily-created real
compartment/location/container is already this app's established pattern for "a place stock goes
that isn't a literal boat locker," not a novel idea introduced for #62.

**What would change this**: if `stock.container_id` needed to become genuinely `NOT NULL` at the
schema level (it is still nullable - nothing currently enforces it, the guarantee is "every write
path resolves None before it reaches SQL," not a `CHECK` constraint) - revisit if a future direct
`INSERT INTO stock` (a new one-off script, say) is ever found writing NULL again.

## Tool accessories: many-to-many, not a single parent tool (schema v29, tracker #64-adjacent) {#accessory-tool-many-to-many}

**Decision**: which tool(s) a `tool_accessory` belongs to is `tool_accessory_tools`
(`accessory_item_id`, `tool_item_id`), a plain many-to-many join table - the same shape as
`item_systems` (part↔device) - not the single `tool_accessory_details.parent_tool_item_id` FK it
replaced. That column is left in the table, unused, rather than dropped.

**Why**: the GUI for this started as a single "belongs to tool" picker (matching the schema as it
existed), but the owner immediately flagged the real case: "I have at least 2 tools that take sanding
disks - same size." A single FK can't represent a shared accessory, and worse, retyping or
removing the OTHER tool would leave a still-valid accessory looking orphaned in any "is this
linked to something" audit. Redesigning as many-to-many on the spot (rather than shipping the
single-FK version and fixing it later) avoided ever having live data or a shipped UI built on the
wrong shape.

**What would change this**: nothing currently reads the old `parent_tool_item_id` column; a
future cleanup pass could drop it once enough time has passed to be confident nothing external
(a report, a one-off script) still reads it.

## Checklist-linked task completion asks about consumption too (tracker #64) {#checklist-link-consumption}

**Decision**: ticking a task that's linked INTO a checklist (`ChecklistSteps.tsx`) now asks
explicitly what was consumed, the same "tick what you used up" prompt the Schedule card's own
Complete panel already showed - not an implied "nothing was used," decided silently in code.

**Why**: `data.complete_task()` was already correctly explicit (stock is drawn ONLY for what's
passed in `consumption` - `None`/`[]` consumes nothing, by design, not a bug). The gap was one
level up: `tick_checklist_link()` called `complete_task()` with no consumption argument at all,
so a task with a listed spare, ticked from within a checklist run, silently drew nothing every
time - no prompt, no way to say otherwise. The fix threads an optional `consumption` param
through `tick_checklist_link()` / `POST /tasks/references/{id}/tick`, matching the existing
`/complete` endpoint's shape, and the frontend only prompts when the linked task actually has
something listed (nothing to ask about otherwise, ticks straight through).

## Retire a task, don't delete it, once it has history (tracker #66) {#retire-not-delete}

**Decision**: `tasks` gains `retired_at` / `retired_reason` (schema v30). A task with any
logged history in its subtree can only be RETIRED - it drops off the schedule projection and
out of every task pick list, keeps its master row, and can be un-retired. `data.delete_task`
refuses it (409 from the API) unless `force=True`, which only scripts use. Hard delete
survives for tasks with no completions and no stock movements - a typo you just made.

**Why**: the owner asked the right question when this was scoped as a UI change - "for the mx log to
work, we need to leave the task in the master table?" Checking what a delete actually costs:
`task_completions` denormalises `task_name` / `system` / `project_name` / `period` /
`interval_type` and its FK is ON DELETE SET NULL, so the log ROWS survive a delete - but
`task_completions.task_id` and `stock_movements.task_id` are severed, so the task's own history
view and any per-task CARFAX-style report (roadmap #44) lose their grouping key, and matching on
name text breaks the first time something is renamed. Worse, a task's native checklist steps are
CASCADE-deleted with it, taking their own completions' links too. Live had 17 completions and 0
orphans when this was decided - the cheapest possible moment to close the hole.

**Why not "delete only by removing the last reference"**, which is how #66 was originally
sketched: 377 of the 856 live tasks are recurring tasks with no project, no parent and no
inbound link, and that is their normal healthy state on the rolling schedule. "Zero references
means delete it" would be wrong for the largest group on the boat.

**What would change this**: nothing pending. If retired tasks ever accumulate enough to be
noise, the Management list already hides them behind "Show retired (N)" - that filter is the
pressure valve, not a purge.

## "Referenced by" is one panel, and it shows ALL inbound links {#referenced-by-panel}

**Decision**: `TaskReferencedBy.tsx` replaces `TaskInChecklists.tsx` and absorbs the Project and
Parent-checklist pickers that used to sit in `TaskDetail`'s own `PlacementControls`. One panel
lists the project, the parent checklist, and every inbound `task_references(kind='task')` row,
each independently removable, followed by what the task's history would cost a delete.

**Why**: the pieces all existed but were scattered across three places, and the reverse view was
narrower than anyone realised - `get_task_linked_from` filtered to links whose SOURCE is a
checklist, which on live was 11 of 75 `kind='task'` links. The other 64 (a one-off or recurring
task that triggers a checklist, a step pointing at a related task, a plain task→task "see also")
pointed AT a task without ever appearing on that task's screen, so "what would I break by
deleting this?" had no answer anywhere in the UI and Delete was an unlabelled scary button.
`get_task_referenced_by` is the superset; `get_task_linked_from` stays for nothing in the
frontend now, documented as the narrow variant.

**Not covered**: a native checklist step (`tasks.parent_task_id`) is shown and can be released to
standalone, but it is a different animal from a link - the step has no separate master record,
so it is labelled "Step of" rather than listed with the links.

## Clone a device with rename, don't share one task across devices (tracker #67) {#clone-with-rename}

**Decision**: `POST /api/tasks/systems/{name}/clone` (`data.clone_system`) duplicates a
fully set-up device - its `systems` row, its `item_systems` part links, and its top-level tasks
with their `task_items` and non-task references - under a new name. Each copied task is a
genuinely independent task: its own schedule, due date and history, starting as never-done.
Wherever the source device's name appears in a copied task's title it is substituted.

**Why**: the owner's case is three near-identical Seaflo pumps and a couple of bilge-pump pairs, all
needing the same setup. The first proposal was an item-side multi-select in `ServesEditor`
(link one part to many devices at once); the owner's counter - "I would be ok with a clone with
rename" - is better because it carries the tasks too, which the item-side version never could.
A shared multi-device task was explicitly ruled out once he pointed out the three pumps "live at
opposite ends of the boat buried under their respective berths - taking on all 3 in the same day
is very unlikely", so one shared due date would be wrong on its face.

**Deliberately not copied**: completion state (`last_completed_date`, `hours_at_completion`,
`deferred_units` all reset - the new unit has never been serviced); tasks that are a STEP of a
checklist, since copying one would silently grow that checklist by a step nobody asked for (they
are counted and reported as `steps_skipped`); `kind='task'` references, which point at one
specific other task and have no clear meaning once duplicated; and history of any kind.

## A past service record lives in the same table as a ticked one (tracker #44) {#historical-service-records}

**Decision**: "Add a past service record" writes a `task_completions` row with
`source='historical'` and `task_id` NULL - not a separate events table. Every scheduling column
(`due_on`, `original_due_on`, `days_past_due`, `hours_past_due`, `interval_type`, `period`, the
two hour meters, `previous_*`) stays NULL, and the write touches no task, so nothing is
rescheduled. `performed_by` / `vendor` / `cost` were added at the same time (schema v31).

**Why one table**: one history, one append-only ruleset, one report. A separate table would have
meant duplicating the triggers, the void mechanism and the read path, then union-ing the two
back together in every view that asks "what has been done to this device". The `source` column
was already the discriminator the original #44 design named ("schedule / checklist / project /
historical entry"); this just made it true. Widening the CHECK meant a full SQLite table rebuild
of the legal record - done with row-for-row verification before commit rather than avoided by
bending the data to fit the old constraint.

**Why NOT "just complete the task back-dated"**: that is the right move when the work really was
one of the boat's tracked tasks - it records the completion AND moves the next due date, which
is what you want. A historical record is the other case: a fact about the boat's past that no
task on the schedule represents (the Seabrook refit, the Sailing Services rig, a survey
finding). Making it reschedule something would be wrong, so it deliberately cannot. The form
says so in as many words, because the two are easy to confuse.

## The history report shows the trail, not a tidied summary {#history-report}

**Decision**: `GET /api/report/history` (backend/history_report.py) renders a standalone,
printable page - whole vessel, one system, or one device - in date order OLDEST FIRST, with
voided entries shown struck through and their reasons, and with `source='historical'` entries
badged "recorded from records".

**Why**: a service history is evidence, and evidence that has been quietly tidied is worth less
than evidence that shows its own corrections. The append-only rule exists so that a mistake is
a visible void plus a replacement; a report that hid the voids would throw away exactly the
property that makes the record credible to a surveyor or a buyer. Oldest-first because a
history reads as a story - the in-app Log tab stays newest-first, which answers the different
question "what happened lately".

**Cost and vendor are off by default**, behind `?cost=1` - the privacy question the owner raised
2026-09-16 and never closed. What the boat had done and what the owner paid are different
disclosures, and a report is a thing that gets emailed. `performed_by` (WHO did the work) always
shows: that is the maintenance fact. The vendor line carries the invoice reference, so it rides
with cost.

**Meter readings appear only on hours-scheduled work.** Both meters are captured on every
completion, so on a calendar task they are just "what the meters read that afternoon" -
identical across every entry ticked the same day, and plainly silly on a passport renewal. They
stay in the trail; they are not part of the story.

## All of #44's remaining schema in one migration (schema v32) {#remaining-44-schema-in-one-go}

**Decision**: v32 adds every column and table the rest of the maintenance-history roadmap needs
at once - `systems.installed_on` / `serial` / `warranty_until`, `task_completions.outcome` /
`evidence_path` / `event_kind` / `sent_at`, and the `crew_members` pick list - even though only
the device identity fields have a feature built on them today.

**Why**: v31 had to REBUILD `task_completions`, the boat's legal maintenance record, because
widening a CHECK is the one thing SQLite's ALTER cannot do. Doing that repeatedly, once per
feature, would mean repeatedly taking the history apart and putting it back. Everything in v32
is a plain ADD COLUMN, so the remaining #44 features (outcome + follow-up, evidence, the crew
pick list, event kinds) now ship as code-only deploys with no migration at all.
*(Postscript 2026-09-22: slightly optimistic. Outcome needed nothing new, but the follow-up
TASK needed one more additive column, `tasks.origin_completion_id` (v34) - see
[#follow-on-tasks](#follow-on-tasks). Still no rebuild of the history.)*

**`outcome` and `event_kind` are validated in `data.py`, not by a DDL CHECK** - deliberately, and
for the same reason: `tasks.interval_type` already works that way, and keeping the enum out of
the schema means adding a value later is a one-line code change instead of another rebuild of
the append-only table.

**The append-only trigger was dropped and recreated**, not left alone: `CREATE TRIGGER IF NOT
EXISTS` would have kept the old column list, silently leaving the four new columns editable.
`sent_at` gets its own permitted transition (NULL -> a timestamp, once) because stamping that a
row was forwarded to the previous developer's log is the app recording what IT did, not a change to a historical
fact.

**`crew_members` is not read from routing's `config/crew.toml`.** That file is float-plan data -
phone numbers, dates of birth, PLB UINs - in a different repo. A maintenance log has no business
holding crew PII, and the owner's standing rule is that crew never edit TOML. `performed_by` stays a
TEXT snapshot rather than a foreign key, for the same reason `task_name` and `system` are
snapshots: a history row must survive the roster changing.

## A system name can contain a slash, so its routes need `{name:path}` {#system-name-slash-routes}

**Decision**: every `/api/tasks/systems/{name}...` route uses the `{name:path}` converter.

**Why**: 22 of the boat's 147 systems and devices have a slash in the name - "Berth A/C",
"Fuel/ Oil", "Solar Controller - MPPT 150/45", the five "24/12 Converter" devices. A plain
`{name}` compiles to `[^/]+`, and the server decodes `%2F` BEFORE routing, so those requests
became one path segment too long, matched no API route, and fell through to the SPA catch-all -
which answers **200 with index.html**. Every one of those devices silently could not have its
details saved, renamed, moved, deleted, cloned, or its parts loaded, and nothing looked like an
error: the PATCH returned `{"status":"ok"}`-shaped success from a page of HTML.

**This corrects a wrong entry in the old gotcha list**, which blamed the Vite dev server and
said "the real backend answers 200". The real backend did answer 200 - with the wrong body. It
was never a Vite problem; it was the route pattern, and it was live in production.

**What would change this**: nothing. Renaming the devices to avoid slashes was the alternative
and it is worse - "Berth A/C" is what the thing is called.

**The general lesson: a 200 from this app is not proof an API call worked.** The SPA catch-all
answers 200 with `index.html` for ANY unmatched GET, and a field missing from the backend
pydantic model (or the frontend TS type) is silently dropped while the write still answers 200 -
that bit twice in the same session (`SystemUpdate` / `SystemUpdateFields` both missed the v32
identity columns). So a test checks the BODY, and a write test reads the value back from the
database; the status code alone proves nothing. Any new route whose path parameter can hold a
slash uses `{param:path}`.

## "Who did the work" is a snapshot, and the pick list is a union {#performed-by-pick-list}

**Decision**: `task_completions.performed_by` is free TEXT, never a foreign key to
`crew_members`. The box that fills it offers the crew roster PLUS every name already used in the
history, deduplicated case-insensitively, and still accepts anything typed.

**Why not an FK** (the owner asked this directly, 2026-09-22 - "is the crew table permanent like
tasks?"): because a history row is a FACT, so it stores the name, not a pointer. That is the same
rule that makes `task_name`, `system` and `project_name` snapshots. The consequence is the useful
part: **crew members are transient and can be deleted freely** - nothing references
`crew_members`, nothing cascades, and "Gulf Solutions Marine did the 1000-hour service on 14 Nov
2025" stays true after that yard is removed from the roster, renamed, or goes out of business.
Contrast `tasks`, which genuinely IS permanent once it has history: `task_completions.task_id` is
a real FK, so deleting a task severs the thread and CASCADE-deletes its steps - which is exactly
why v30 added retire-instead-of-delete there. Two different lifecycles, for a concrete reason.

**Why the pick list unions the history in**: the cost of free text is not lost data, it is
inconsistent spelling - "Sailing Services" and "Sailing Services, Miami" reading as two outfits
in any later "work by whom" summary. Offering back what has already been typed is what actually
keeps spelling stable, and it means nobody has to maintain a roster to get the benefit. The
roster only decides what is pinned to the top before any history exists. `crew_members.offered`
gives transience without deletion: set it to 0 and someone drops out of the list but stays on
record.

**Known limit**: this prevents FUTURE variants, it cannot fix past ones - the history is
append-only, so a name already spelled two ways stays spelled two ways. That is an argument for
having the pick list in early, which is why it was built before much history accumulated.

**Also fixed here**: the Log tab labelled every `task_id IS NULL` row "(task since removed)".
A `source='historical'` row never had a task, so it now reads "(recorded from records)".

## Invoices are documents, not costs on completions (schema v33) {#invoices-are-documents}

**Status**: live since 2026-09-22 ~16:23 (schema v33, code `863570e`). Full reasoning, and the Gulf Solutions analysis
that shaped it: `design/INVOICE_DOCUMENTS_DESIGN.md`. Schema: [Schema](Schema.md), section 10.

**Decision**: a vendor invoice or receipt is its own `documents` row - vendor, number, date or
period, the total ONCE, where the PDF is, an optional project, a free-text `expense_class`. A
history entry is FILED under a document via `task_completions.document_id`; money is never put
on, or apportioned across, the completions. The Log tab's year view lists "invoices on file"
with a subtotal per class and a CSV export.

**Why** - the owner's context reframed it: the boat is a business asset (SSI dive boat), the refit is
a deduction, and he self-files with . He is not a professional and the app gives **no
tax advice** and must not imply a tax position. The constraints that followed:

- **Don't compete with the bank statement.** Card and bank records are third-party evidence; a
  hand-keyed total in a local SQLite file is evidence of nothing, and one that disagreed with
  the statement would be a liability in an audit. So the app never holds a number claiming to be
  the year total - every figure is headed **"invoices on file"**, the sum is `on_file`, and
  documents with no total are counted beside it so a subtotal never looks more complete than
  it is.
- **The contribution is substantiation, not accounting.** A card line says who and how much,
  not what it was *for*. The chain is bank line -> invoice -> the work it paid for; the owner owns the
  left end, the app knows the right end, the invoice record is the missing middle.
- **One invoice, many jobs** - which kills cost-on-the-completion. the owner's own case: the Seabrook
  yard invoice "is going to be 5 or 6 pages long". With money on the completion you either
  invent an apportionment (fiction, in an append-only record) or dump the whole total on one
  arbitrary job. Device-level cost is curiosity (the owner's word); the year question is the real one.
- **Don't transcribe line items.** The PDF is already searchable; ~150 keyed lines buy nothing.
  The row is the spine: who, when, how much in total, what it covers, where the paper is.
- ** wants category subtotals**, typed into boxes - nothing imports - hence per-class
  subtotals plus a CSV to sit beside the card summary in a spreadsheet.
- **Provenance tolerates "unknown".** A device with no document link reads as "we don't know",
  which is correct. Never infer a link. A document with no completions is also legitimate -
  money out, nothing received.

**`expense_class` is free text offered back from prior use**, grouped case-insensitively and
named by its most-used spelling - the same union idea as `performed_by`
([#performed-by-pick-list](#performed-by-pick-list)). Never an enum: the classes must match
whatever the owner types into his return, and a new one must never need a migration.

**A history entry carries its own `cost` OR points at a document, never both** - enforced by
two triggers and checked first in `data.py`. That is what stops the same money being counted
twice. The design applies the same rule by convention to `stock_movements.unit_cost`.

**Filing is the one change besides voiding that the append-only history allows.** Which piece
of paper paid for the work is a cross-reference, not a fact about what was done, so
`document_id` may be attached, moved or detached on its own - with nothing else on the row
changing. The document itself is an editable index (fix a mistyped invoice number freely), but
it cannot be deleted while any entry is filed under it: the FK would quietly detach them and
break the substantiation chain without anyone deciding to.

**Two reasoning mistakes from the Gulf Solutions analysis (2026-09-22) - don't repeat them.**
(1) *"The item is on the boat, therefore the invoice listing it was delivered."* Claude matched
invoice 1162's Dometic, GRF-10 and VHF to devices aboard and concluded 1162 was delivered; all
were duplicate buys supplied elsewhere. **Existence aboard proves the thing is there; it proves
nothing about who supplied it.** (2) Claude then flagged that the owner's "~$10K" sunk figure did not
add up. It did - the gap was entirely mistake 1. Consequence for the data: the 1162/1179
equipment is recorded with NO document link, and an invoice is at most a hint in a device's
notes, never the source of its model number.

**What would change this**: nothing pending. If the owner's year-end routine ever needs something
other than category subtotals, the CSV is the place to change, not the schema.

## Follow-on tasks point back at the history entry (schema v34) {#follow-on-tasks}

**Status**: live since 2026-09-22 ~17:40 (deploy 10, schema v34, code `d54252c`, tracker #44).
Mechanics: [Logic-Flows](Logic-Flows.md#18-task-outcome-and-follow-on-tasks-schema-v34);
schema: [Schema](Schema.md), sections 4 and 10.

**Decision**: a logged job records its outcome (`done_ok` / `problem_found` / `partial`, the v32
`task_completions.outcome` column), and the work it leaves behind becomes one or more ordinary
one-off break/fix TASKS, each carrying `tasks.origin_completion_id` - a pointer from the new task
back to the history entry that raised it. One entry -> MANY follow-ons.

**Why the link is on the task, not on the completion**:
- **The history is append-only.** A column on `task_completions` pointing at "the follow-on
  task" would have to be written after the row exists - an edit of the legal record, and one
  more transition the append-only trigger would have to allow.
- **A follow-on is often raised later** - a problem spotted days afterwards, or read out of a past
  service record typed in from paper. Pointing from the new task back at the entry records that
  link without touching the entry at all.
- **It is one-to-many, naturally.** Owner: "it is likely a 1 to many"; "it's a boat, there is never
  a simple answer to something that is broke." A child-side FK is the 3NF shape of 1 -> many; a
  single column on the completion is not, and a list of task numbers stuffed into description
  text is not data.

**Why a follow-on is an ordinary task**, not a new kind of thing: it has to be scheduled,
completed, retired, linked into a checklist and printed like any other work. `one_off`,
`break_fix`, `period='immediate'`, on the job's own system/device unless another is picked.

**A 'partial' job still resets the schedule.** The unfinished part is what the follow-on is for.
Leaving the recurring clock unset instead would make a half-done job look never-started, and
would fight the void / undo logic that restores the previous last-done state.

**Voiding an entry keeps the follow-on tasks it raised** - they are real work regardless of the
paperwork error. New follow-ons cannot be raised FROM a voided entry (a mistake is not a source
of work; raise it from the corrected entry).

**All or nothing.** Follow-ons raised with a completion are created in the same transaction as
the history row (on the same write connection - a second one self-deadlocks); a bad outcome or a
follow-on on a system that does not exist rejects the whole call and writes nothing.

**What would change this**: nothing pending. If a follow-on ever needs to point at more than one
entry (one repair resolving problems found on two jobs), that is a link table, and this column
would migrate into it.

## Defer counts from today, never earlier than the current due date (tracker #68) {#defer-from-today}

The Schedule card's "+N" bump used to add N on top of the current due date, so +30 on a task 78
days overdue still left it 48 days overdue - not what anyone means by "defer 30 days". Now the new
due point is **max(current due, today) + N** (the owner, 2026-09-22). The `max` is deliberate: counting
from today on a task that is not yet due would pull its due date EARLIER, and a defer must never
do that. `hrs` tasks work the same way on the meter: current reading + N hours.

`deferred_units` keeps its meaning (an offset from the undeferred due point); `data.defer_task`
solves for the offset that lands the due point where it should be, so the schedule math in
`backend/scheduling.py` did not change. When the due point cannot be worked out (no meter reading,
no hours baseline, an event-driven task) it falls back to the old additive bump. "Until <date>" and
the Layup Return bulk-defer were already absolute and are untouched.

**What would change this**: nothing pending.

## Add as a step: one picker, one question (tracker #69) {#add-as-a-step}

A task's record used to offer "Make it a step of…" (MOVE: `parent_task_id`, the task leaves the
rolling schedule) and "Link into a checklist…" (LINK: a `task_references` row, the task keeps its
own schedule) side by side, and they were indistinguishable to the person using them. To a user
the only real difference is whether the task keeps its own schedule, so there is now ONE
"＋ Add as a step to a checklist…" picker followed by one plain question, **"Keep it on its own
schedule too?"** - Yes = link, No = move. A task that is already a step of another checklist can
only be linked, so it skips the question. The project picker reads "＋ Add as a step to a
project…" (the owner's own words). The checklist side's add-existing-task buttons say the same thing
from the other direction: "Add - keep its own schedule" / "Add - only with this checklist".

**What would change this**: nothing pending. Both mechanisms stay (see
[Link, don't duplicate](#link-dont-duplicate-one-master-record-per-task-always)); only the wording
and the entry point changed.

## Follow-on urgency is the user's choice (tracker #70) {#follow-on-urgency}

Follow-on tasks (schema v34) were all created `period='immediate'`, so every one landed in Overdue
as "DROP EVERYTHING" - over-conservative for work that is worth doing but not now (the owner,
2026-09-22). Each follow-on row now picks **Routine** (default) / **Urgent** / **Drop everything**,
stored as the break/fix `period` the schedule already reads ('routine' -> Routine Repair, ~14
days; 'urgent' -> Action Urgent; 'immediate' -> DROP EVERYTHING). No schema change - live data
already used all three values. Validated in `data._insert_follow_ons` (`FOLLOW_ON_URGENCIES`); a bad
value rejects the whole call and writes nothing.

**What would change this**: nothing pending.

## Backfilling history from the build log (2026-09-22) {#build-log-backfill}

the owner's dated build-log posts (his Facebook posts, mirrored on tools.example.com) are the
closest thing to an authoritative record of the refit, so they are mined into past service
records - page by page, as a Q&A with the owner, then a dry-run-then-apply one-off script whose ENTRIES
list is the single source of truth (the review page is generated from it). Conventions settled on
the first batch (Electrical + Solar, 72 entries, applied 2026-09-22):

- **Legal names on the history record** ("First Last", "Second Last"); "Owner" and
  "crew member" everywhere else. The report is read by outsiders (buyer, surveyor, insurer, whoever
  reconciles invoices against statements), and vendors are already stored under their legal
  names. `performed_by` is a text snapshot, so this is a roster rename plus void-and-re-enter of
  any earlier record - never an edit.
- **"we" in the owner's posts means the owner.**
- **A missing install date = purchase date + 7 days**, marked APPROXIMATE in the notes. Dates are
  post dates otherwise (the wiki itself warns they are not always the work date).
- **A thing earns a device record only if** work is logged against it on its own, a spare is
  stocked for it, or it has its own schedule. So a breaker panel is a device (directly under
  Electrical - the tree stays one level deep); its breakers, LEDs, fuse and meters are described
  in its notes and become parts only when a spare is actually stocked.
- **Open problems are recorded too**, as "Problem found" / "Partly done" with a follow-on task, so
  unfinished work sits on the schedule instead of in a note.
- **Facts go to the owner one question at a time; filing choices take Claude's default** and are shown
  on the review page so he can overrule them.

**What would change this**: nothing pending. Remaining pages (Repower first - it holds the hydrolock
diagnosis) follow the same shape.

## Clickable to detail: one opener, every tab an origin {#clickable-to-detail}

**Rule (the owner, 2026-09-23, tracker #73/#74):** anything on screen that has its own detail page opens
it when tapped. A checkbox ticks, a name opens; one button never holds two records.

**How it is built (deploy 14):**
- **AppNav v3** (`components/AppNav.tsx`) - one `openRecord({kind, id|name}, returnTo)` for item,
  task, system/device, project, recipe and container (a container has no page; it opens the Locker
  filtered to it). v2 could only open an item. Each kind has one home tab (`ROUTE`).
- **NavScope** - every tab (and the Warehouse Locker, Recipe Book, Meal Plan entry, Run a Checklist
  run) says how to describe "here" as a ReturnTarget and which refs it opens in place. So a link
  deep inside a shared component (TaskNeeds inside TaskDetail, rendered by three tabs) needs no
  props: `<RecordLink to={…}>` asks the scope. A task link inside Management stays on Management's
  trail; the same link on the Schedule stays on the Schedule's; a device link on the Schedule goes
  to Management and Back comes back to the same bucket and card.
- **useAnchoredFocus** - the destination remembers where the user came from against the record it
  was sent to; Back from THAT record returns to the origin (and says so: "← Back to Meal Plan"), Back
  from anything browsed to afterwards behaves normally. It generalises LockerTab's v2 anchor.
- **Keep-alive tabs.** A tab or Warehouse/Galley sub-tab stays mounted (hidden) once visited. Found
  in the build: every cross-tab trip used to unmount the origin, so an audit walk's unsaved ticks, a
  half-filled receive form or Lay-up's dates were silently lost. Trail restore alone could not fix
  that; keeping the view mounted does, and makes Back instant.

**Rejected:** a router library (the app is tab state + focus trails, and a URL-per-screen buys
nothing on a LAN tablet); per-screen `onOpenX` props everywhere (already six conventions -
`onOpenTask`, `onNavigateToTask`, `onOpenSystem`, `onOpenStep`, `onOpenRecord`, `onOpen` - and
every new screen forgot one).

**Not linked on purpose:** search-picker rows (tapping picks), printed sheets, sails, and things
with no page yet (invoices, log entries, crew). The cockpit has no AppNav, so names are plain text.

**What would change this**: a page for invoices or log entries (add a `kind` and a ROUTE entry);
a cockpit trail of its own.

## No detours: create it where you pick it {#no-detour-workflows}

**Rule (the owner, 2026-09-23, tracker #75/#76):** a workflow runs in one pass. When a pick list lacks the
entry, it is created right there with minimal fields and comes back selected. "＋ New …" is always
the FIRST row; pick lists stay type-to-search; the same few patterns everywhere.

**How it is built (deploy 14):** `components/SearchPick.tsx` is the one pick-from-a-list control
(inline create as the first row, `noneLabel` for "none"). On top of it: `FoodPick` / `StuffPick`
(`warehouse/ItemPick.tsx`, with NewFoodItemForm / NewStuffItemForm), ContainerPicker v3 (new
container and new location inline; a new COMPARTMENT stays in Edit Storage Structure - a whole new
area of the boat is rare), SystemPicker v2 (one search over systems and devices). About 25 pick
lists moved onto these; plain enumerations (interval type, outcome, urgency, filters) stay selects.
Every screen is listed with its old detour in [Workflows](Workflows.md).

**Choices made along the way:**
- Picking an item in the Restock box or the Galley "Need something?" box puts it on the list at
  once (no second "Add" button); a mis-tap is undone on the list itself.
- A new food item can say where it lives (a stock-0 "home" row) and go on the shopping list in the
  same step; both optional.
- "＋ Used something else" on a completion records any catalog item; "remember it for next time"
  (off by default) adds it to the task's list.
- A tool's record now lists its accessories (`GET /items/{id}/accessories`, the reverse of the v29
  many-to-many) - the link existed only one way.

**What would change this**: a managed crew roster (performed-by is a free datalist today, which
already avoids a detour).

## Container picker is a tap cascade {#container-cascade}

**Decision (the owner, 2026-09-24):** picking a container is Compartment › Location › Container, three
tap columns (`warehouse/StorageColumns.tsx`) in a full-screen overlay (`warehouse/ContainerCascade.tsx`), opened from a button that
shows the full current path. "＋ New …" is the first row of every column, so a new compartment,
location or container is made where you stand and the new container is picked at once. Favorites
sit above as chips. Every level is A-Z (compartments too - they briefly used the stored boat
order, which the owner caught the same day); "loose" is first among containers; for a food item the
Galley compartment is listed first.

**Why:** the v3 type-to-search list (SearchPick over all ~173 containers) was too long, too narrow
for the full paths, and typing on the tablet was clunky. The storage tree is only three levels,
with at most ~21 locations per compartment, so tapping through it beats searching.

**How it is built:** a fixed overlay, not a FocusScreen, because it opens inside forms whose
half-filled state must survive. It is portalled to `<body>`: rendered inside a form, the host's
descendant rules (`.add-item-form button`) restyled its rows. Under 760px it shows one column at a
time with ← Back. Same props as v3, so no caller changed. `NewContainerForm` (the Audit tab's
inline form) is unchanged.

**One view of the storage tree (the owner, same day: "keep the interface consistent"):** the columns
are ONE shared component. Edit Storage Structure is the same columns plus an edit panel for the
deepest thing tapped (rename / kind / notes / ⭐ / move / delete). Its "Move to…" opens the same
columns cut to one level (a location moves to a compartment) or two (a container moves to a
location), with the current place shown as "here now" and not pickable. "＋ New …" works there too,
so you can move something into a place made on the spot. Container rows carry a ☆/★ toggle in
both the picker and the editor. Rename / move / delete stay OUT of the picker: it opens in the
middle of a job, and a delete one tap from "pick this" is a mistake waiting to happen.

**Every TREE gets this view; flat lists keep search (the owner, same day, deploy 18):** the overlay,
trigger, row and "＋ New" row are a shared kit (`components/TapColumns.tsx`). Systems are a real
two-level tree (28 systems, up to 24 devices under one), so SystemPicker, the item's "serves these
devices" and the device screen's Move… / delete-reassign all open the System › Device cascade
(`management/SystemCascade.tsx`), with "✓ Use <system> itself" for no device. The systems cascade
keeps a search box on top, because crew often know the device ("water pump") and not its system;
the storage one has none. Tools (101), tool accessories (55), recipes (1,164, tagged
many-to-many) and food items are FLAT - no hierarchy to tap through - so they stay on SearchPick.

**What would change this:** a storage tree much deeper or wider than today, or crew asking for
search back. It would come back as a filter box in the overlay, not a replacement for it.

## A release package is an allowlist export, gated by a privacy scan {#release-package}

**Decision (2026-09-24):** other boats get a *built package*, not a copy or fork of this repo.
`scripts/release/build_release.py` copies an explicit allowlist (runtime app, frontend source,
example data, starter-pack loader, user + developer docs, `release_files/`) into a clean folder,
builds the frontend there, runs `privacy_scan.py` over the result, and only then zips it. The
live app runs from the same code (one branch, no "release fork").

**Why an allowlist, not "the repo minus secrets":** the repo is full of this boat - wiki,
history/, design/ docs, one-off scripts naming yards and people, DB backups. A denylist fails
open (a new file is shipped until someone remembers to exclude it); an allowlist fails closed.

**Why the gate scans the built bundle and Python *strings*, not comments:** the question is
"what can a user of the package see?". Vite strips comments, so the bundle is exactly the
screen text; in `.py` files the scan tokenises and checks string values only, because comments
and docstrings are developer notes (they still name the history, and scrubbing them would lose
the reasoning). Every other shipped text file (docs, launchers, JSON) is scanned whole. A hit =
no zip. `privacy_scan.py` itself is never shipped - its word list IS the private names.

**Example data is fictional; starter packs are this boat's, generalised with the owner's
review.** `example_data.py` invents "SV Example" outright - no real data to leak. The recipe
book and maintenance library are genuinely useful, so `export_starter_packs.py` exports them
read-only from live through a deterministic override/drop map (re-runnable, diffable) and writes
`REVIEW.md` listing every rename and drop for the owner to veto; he accepted it for v0.1.0. Packs are
opt-in at setup and idempotent by name.

**What would change this:** shipping to someone who needs this boat's real data (then it is a
copy of the DB, not a release), or a second maintainer adding files often enough that the
allowlist becomes the bottleneck.

## Boat-specific values are Settings, not code {#settings-not-hardcoded}

**Decision (2026-09-24, deploy 20):** the boat name on printouts, the two hour-meter labels and the
device-manuals folder are owner **Settings** (`system_config` rows via `data.SETTINGS_DEFAULTS`,
`/api/settings`, the header's ⚙ dialog), not constants. A blank boat name is simply omitted
(printouts, header shows "⚙ Set up your boat") rather than defaulting to a made-up name.

**Why:** these were the hard-coded values that made the app this boat's app (`BOAT_NAME` in two
printers, "Yanmar" / "Westerbeke" in the telemetry widget, `D:\Documents\sailboat\Manuals` in
device research). They are data about the boat, so they belong in the boat's database, editable
in the app - crew work in forms and pick lists, never config files. Keys are
a fixed list (unknown keys refused), so Settings cannot grow into a free-form config store.

**Not Settings:** hosts, ports and tokens for outside systems - those are deployment facts, set by
the launcher ([#opt-in-integrations](#opt-in-integrations)).

## Outside integrations are opt-in {#opt-in-integrations}

**Decision (2026-09-24, deploy 20):** every edge to another system is off unless its environment
variables are set: the `/routing` proxy (`MXINV_ROUTING_URL`), InfluxDB telemetry
(`MXINV_INFLUX_URL` + `_ORG`, optional `_BUCKET` / `_GENSET_MATCH`), and - already that way - the
two the previous developer brokers (`VESSEL_LOG_*`, `SAIL_CONFIG_*`). `run-live.bat` v5 sets this boat's values, so
live behaviour did not change.

**Why:** the defaults used to be this boat's LAN (`192.168.1.10`, org `boat-auto`,
`127.0.0.1:8100`). On any other machine that meant probing someone else's network and a
`/routing` that could only 502. Opt-in means a fresh install talks to nothing and every feature
that needs an outside system says so or hides.

**Hide, don't pretend:** the cockpit's Sail Plan and Break / Incident tiles are hidden when
their broker is off (`GET /api/cockpit/capabilities`). They only ever SEND, so with no endpoint
they used to answer "✅ Logged" for a write that went nowhere - true on live too, which is why
they disappear from live's cockpit until the previous developer's endpoints exist.

## Never-done tasks: one baseline rule, and say so {#never-done-baseline}

**Decision (2026-09-24, schema v36):** a task with no completion counts its interval from
`tasks.schedule_from` when set, else from "done 90 days ago" - one function,
`data.task_baseline_date`, used by both the schedule and defer. Starter-pack tasks get
`schedule_from` = the load day. And a never-done card says **"not done yet"** instead of a date.

**Why keep 90 days for live:** it is the original, deliberate rule ("assume it's a bit overdue,
not brand new") and live's schedule is built around it; changing it would move every
never-done live task's due date at once. v36 is additive - every live task has NULL `schedule_from` - so live dates did
not move.

**Why `schedule_from` for loaded libraries (Owner: "2 makes more sense"):** a new owner loading the
maintenance library would otherwise see everything short-cycle land in Overdue on day one (cold
test, example boat + both packs: Overdue 81 / Critical 28). Starting the clock at load gives
Overdue 7 / Critical 2 - all of them the example boat's deliberately overdue tasks, zero from the
library - and each library job first comes due one interval after loading.

**Why "not done yet":** the card used to print the assumed 90-days-ago date as "last done",
presenting an assumption as a fact in an app whose history is meant to be a record. Rows now
carry `never_done` and an empty `formatted_last_done`.

**One rule, not two:** `scheduling._project_row` and `data.defer_task` each had their own copy of
the 90-day fallback; a starter-pack task would have been scheduled from one date and deferred
from another. Mechanics: [Logic-Flows](Logic-Flows.md#20-never-done-baseline-schema-v36).

## SQLite commits are durable across a power cut {#synchronous-full}

**Decision (2026-09-24, deploy 21):** `data.connect()` sets `PRAGMA synchronous = FULL` (was
`NORMAL`). In WAL mode `NORMAL` never corrupts the file but can lose the last few commits if power
drops without warning. The app is headed for a Raspberry Pi on a boat that can lose power without
warning, and it is about to hold the logbook. The cost (an fsync per commit) is irrelevant at a
few writes a minute. Source: the previous developer's "Setting Up a Repository for a Automation Container" SQLite
section, which also matches what we already did (WAL, `busy_timeout`, backup-API snapshots, DB
directory on a bind mount). **Reopen if** write volume ever becomes high enough to feel the fsync.

## The logbook moves into mx-inv (option C) {#logbook-in-mx-inv}

**Decision (the owner, 2026-09-24):** mx-inv becomes the boat's logbook; the previous developer retires his `logbook.py`
CLI (it writes InfluxDB line protocol directly - there never was a Logbook API for mx-inv to call),
his hourly `maintenance_due` timer and his 62-item `schedule.yml` after a coverage check.
**Rejected:** A (the previous developer builds a write endpoint in boat-api - nothing built, a charter change for a
read-only service, and he is over-committed) and B (mx-inv holds a bucket-scoped Influx write
token). **Why C:** mx-inv already is the maintenance record, the owner's side does the work, and mx-inv
still needs only a **read-only** Influx token (to stamp entries with position, wind, depth, hours).
the previous developer's "safety-adjacent" concern becomes concrete requirements: runs on the Pi, append-only with
voids, a hand entry never waits on Influx, `synchronous = FULL`. **Status (2026-10-07): BUILT and
live** - schema v37 (deploy 24, 2026-10-05) + passages v38; design `design/LOGBOOK_DESIGN.md`; the
one-time import of the previous developer's `logbook` measurement was DROPPED (the owner 10-05: nothing in it). The stamps
read our own boat stack (SignalK + the history read API), not the previous developer's Influx. See
[Schema section 11](Schema.md#11-the-logbook--ships-log-v37--v39) and the decisions below.
`backend/vessel_log.py` (the option-A webhook client) is still a no-op.

**Automatic entries (2026-09-28):** alarms, mode changes, passage start/end and engine / genset
start-stop are **pushed** to an mx-inv logbook API by the boat's rules engine (idempotent by event id,
queued and retried by the sender); mx-inv does not infer events from InfluxDB, which it reads only for the
save-time stamp. The API contract goes in the logbook design doc.

## Keep the stack; harden it in place {#keep-the-stack}

**Decision (the owner, 2026-09-24):** with the app pre-release stable and usable as a working spec, the
question "should this move to a better technology for the environment?" was reviewed and
answered **no**. FastAPI + SQLite + React/Vite fits a single boat, a few users on a LAN/Tailscale,
and a Raspberry Pi in Docker next to the previous developer's Python/Docker/Ansible stack: SQLite needs no server
and backs up as a file; Python matches his side; the React build is static files the tablets
render. Alternatives considered and rejected: Postgres (a server to run for 2-3 users), a Go/Rust
rewrite (6k lines of settled rules, no problem it would solve), server-rendered HTMX (a worse fit
for the focus-screen UX). the owner also set aside as not worth the cycles the only three things that
would change the answer: offline-first (working while the Pi is down), a measured Pi resource
problem, and a hosted multi-boat service.

What the review found instead were **practice gaps**, fixed in phases by
`design/ARCH_HARDENING_PLAN.md`: 0 `/api` misses 404 (done, deploy 22 - it also closed a path
traversal), 1 a pytest regression suite (done), 2 a startup migration runner, 3 drop pandas from
the server and delete the retired Streamlit app (Owner: yes), 4 typed request bodies + generated
frontend types, 5 split `data.py` into a package. This reverses the earlier "no migration
framework" call on the [Roadmap](Roadmap.md) for a stated reason - the Pi image and the friends'
release upgrades must migrate without Claude at the keyboard - but still no Alembic.
**Reopen if** one of the three set-aside requirements becomes real.

## The Ship's PC is the system of record, your-pi-hostname links or not {#ships-pc-system-of-record}

Since 2026-10-03 the one live `vessel_local.db` is on the Ship's PC (`E:\boat\vessel-ops`); the laptop is
development only. The same evening the owner confirmed it as the **system of record** and accepted that the your-pi-hostname
links are not working because of key issues. So mx-inv runs standalone: every your-pi-hostname edge in
[Data Flows](Data-Flows-and-Interfaces.md) is opt-in already ([Outside integrations are opt-in](#opt-in-integrations)),
and with them down the hour meters and readings are entered by hand. Real data work goes on here, not on hold;
the first example is the crew's provisioning-sheet import, the same night. There is only ever one record: never merge
or copy a database between this PC, the laptop and your-pi-hostname to work around the outage.
**Reopen when** the keys are fixed and the Pi-host move (your-pi-hostname D-077) is scheduled - that move is a planned
hand-over of this file, with a verified snapshot, like the laptop-to-Ship's-PC move.
**Status 2026-10-07:** the principle stands (one record, moved only by a verified hand-over), the host changed:
the Ship's PC went for repair on 10-05 and the laptop holds the one live file as the interim host
([Operations](Operations.md#per-host-guard-files)); the "links down" part is superseded - since 10-06 the cockpit
reads our own stack on the rebuilt Pi.

## Cockpit wired to OUR boat stack (2026-10-05)

**Decision**: the cockpit talks to your-pi-hostname's own stack (rules engine API, SignalK, history read API) through ONE
module, `backend/boat_link.py`, configured only by `MXINV_*` environment variables - moving the stack from the
Ship's PC to the Pi is an env change. Writes: mode tap + ack (engine token, held on the server - the tablet's lock
PIN is the guard, D-092) and Sail Plan (`sails.activeSet`, mx-inv's own SignalK device token). Reads: engine status,
SignalK, history "value at T" (D-052 door #1 - mx-inv never logs in to the history database).
**Sail plan record = the history DB** (`sails.**` kept as state, HB-09) - mx-inv stores no copy and needs no schema
change, so v37 stays free for the logbook (behind the migration runner, hardening phase 2).
**Why**: D-105 (we own every line - the previous developer's never-built webhooks retired); one record per fact.
**Reopen when** the logbook (option C) lands - sail changes may also appear there as entries.

**Status 2026-10-07:** the logbook landed (v37); v39 (live since 2026-10-08) adds a `sail` ship's-log line
for every sail-plan change beside the SignalK state, so the "reopen" case above is answered: both, the history DB
stays the polar's record.

## The logbook is append-only; a failure's progress is a chain of statuses {#logbook-append-only}

**Decision (the owner, 2026-10-05):** logbook entries, status updates, stamps and passage ends are never edited or
deleted (schema triggers, like the maintenance history). A failure moves through the owner's five statuses - Broke /
Parts Ordered / Deferred / Accepted / Fixed, any order - as appended rows; a mistake is corrected with another
row. **Why:** a log that can be rewritten is not a log; the maintenance history already proved the pattern
(voids, not deletes). **Rejected:** the previous developer's status set (open / investigating / parts-ordered / fixed / wontfix);
an editable status column. The handover shows only what CHANGED since the last watch entry (Owner: "what's
changed since last time"); the standing Deferred / Accepted register lives on the desktop page, not in every
handover. **"Since" is write order, not clock time** (`after_entry_id`) - Owner: there is no clock precision on a
boat, so a back-dated entry logged after the handover still shows as new.

## Time precision: crew to the minute, engine to the second {#logbook-time-precision}

**Decision (the owner, 2026-10-05):** two date-time groups per entry (`occurred_at` = when it happened, `recorded_at` =
when it was written); crew entries to the minute (with "N min ago" back-dating), engine events to the second the
rule fired - the firing order of a critical sequence matters for troubleshooting. No other precision is needed
aboard.

## The deck log writes itself and never invents a missed slot {#deck-log-no-backfill}

**Decision (the owner, 2026-10-05: "this is the ship's log - no more paper"):** mx-inv writes a status entry every
hour under way and at 08:00 / 20:00 otherwise, with the boat's own readings. A slot missed while mx-inv was
down is **skipped**, not back-filled - a log line must be what the boat said at the time. A host without a
boat stack turns the deck log off (`MXINV_DECK_LOG=off`) rather than write "No boat data" lines into an
append-only log. Engine events and deck-log lines carry `record = 'log'` where they belong in the ship's log
but not in the watch handover (Ship's Automation D-114).

## The rules engine pushes events; mx-inv does not infer them {#engine-pushes-events}

**Decision (2026-09-28, built 2026-10-05):** alarms, clears, relay actions, mode changes and the like are
PUSHED by the rules engine to `POST /api/logbook/events` (bearer token, idempotent by `event_id`, the engine
keeps an outbox and retries; 200 or 409 = delivered). **Rejected:** mx-inv polling or inferring events from
time-series data (duplicates the engine's logic, races, and a second source of truth for "what fired").
mx-inv reads the boat stack only to stamp an entry with where she was.

## A passage is one leg, derived from its two entries (option B) {#passage-is-a-leg}

**Decision (the owner, 2026-10-05):** a passage = one departure entry to the next arrival entry; nothing is stored
for the passage itself (only the port of each end), so it can never disagree with the log. Order is
enforced at write time (409). **Rejected:** A, a plain date range (nothing ties a printout to a leg); C, a
passages table (overlaps routing's pre-departure planning; can grow from B later if needed).

## Every crew entry is signed; the watchkeeper is the default (v39, live 2026-10-08) {#signed-entries}

**Decision (the owner, 2026-10-05 review):** a cockpit / desktop log entry must carry a name from the crew list
(server-enforced), defaulting to whoever took the watch at the last handover or departure. **Why:** a ship's
log entry is someone's statement; free-text or anonymous entries cannot be trusted later. The sources are
shown in words (Auto Report / Cockpit / Desktop / Automation); "Engine" now means only the Yanmar.

## A small in-house migration runner at server start, and a newer database is refused {#migration-runner}

**Decision (2026-09-24 plan, built 2026-10-05 as hardening phase 2):** from v37 every schema change is a
`migrations/vNNN_*.py` step that the server applies at start, after a verified backup, one transaction per
step. **Why:** the Pi image and the release package's friends must upgrade without Claude at the keyboard.
**A database newer than the code stops the server** (`SchemaTooNew`): older code writing into a newer schema is
the one way a rollback can corrupt data, so a rollback must restore the matching backup instead. **Rejected:**
Alembic (a framework for a dozen small steps); keeping hand-run one-off scripts (they need a person and a
dry-run discipline every time).

## Per-host guard files, not configuration in git {#per-host-guard-files}

**Decision (2026-10-03 / 10-05 / 10-06):** what a machine IS (not the live host any more; an interim host
without a boat stack; a host whose boat stack runs on the Pi) is said by small gitignored files beside
`run-live.bat`, which the launcher reads (`LIVE-HOST-MOVED.txt`, `LIVE-HOST-INTERIM.txt`,
`BOAT-STACK-ON-PI.txt`). **Why:** the same checkout runs on several machines; a `git pull` must never turn a
stale copy into a live server, and the one-live-database rule needs a guard that survives a code update.
Details: [Operations](Operations.md#per-host-guard-files).

## A Work a Container tick is a lasting audit record, not a pass-only checklist {#container-tick-is-audit}

**Decision (the owner 2026-10-08):** ticking an item under *In here now* records "verified here on <date>" and counts as an
audit - an `audit_lines` row in the OPEN inventory audit (system = counted = what is held there), with stock untouched
(`data.verify_in_container`, not `record_count`, which rewrites the plain row and would duplicate an item held only in
dated lots). **Why:** walking a container IS auditing it; a pass-only tick would throw the work away. Un-ticked items
are offered a move to Unassigned with no audit line, so they stay on the audit's still-to-find list. **Related (the owner,
same day):** an item already in another real container needs an explicit *Move* or *Add as extra* pick - no default,
because both happen aboard (one item lives in several places). The add-list ticks survive a change of target container.
Details: [Workflows](Workflows.md) 10. **Reopen if:** container walks happen with no audit open as the normal case.

## The crew starts a tank fill; the rules engine holds the session, mx-inv only taps {#fill-tap}

**Decision (the owner 2026-10-09, Ship's Automation D-129):** a tank fill is STARTED by the crew - the anchor box most of the
time, the cockpit's Tanks screen for a fuel fill at the start or end of a passage - never inferred from the level
senders, which swing 5-6 points while the boat rocks (the old 'tank filling' rule flooded the phones). The session,
its ETA and the 90 % / 95 % chirps live in the rules engine (`GET / POST /fill`); mx-inv keeps no fill state and adds
only the tap, forwarding with the engine token held on the server (`backend/boat_link.py`, like the mode tap - the
tablet never holds it). No confirm on the tap (harmless, undone by the next tap, and a stray start ends itself after 20
min with no rise). **A watermaker session is never stopped or replaced by a tap** (cockpit and anchor box alike, the owner 10-09):
it carries the 95 % HP-pump cut, and the point is that the watermaker can never overflow a tank while the crew is
busy elsewhere. Details: [Cockpit GUI](Cockpit-GUI.md#boat-stack-link-2026-10-05-branch-cockpit-stack-wiring).
**Reopen if:** fills need to be in the ship's log as crew entries (today the engine records them as its own `builtin:fill` events), or a tank sender
that does not slosh makes automatic detection reliable.

## Food into a cold box tells the boat; a surprise warm-up asks 'expected?' {#restock-watch}

**Decision (the owner 2026-10-08 / 10-18, Ship's Automation D-128 / OQ-125, WF-502):** a fridge / freezer that just took warm
food needs 2 h to recover before its food-safety alarm (WF-501) may fire. mx-inv already knows when food goes in, so a
receive / stow / add / move of food (quantity > 0) into one of the five cold-box places (Galley: Refrigerator, Engel
Refrigerator + Engel Freezer = the one Engel, Freezer AFT, Freezer FWD - the owner 10-18) marks that box RESTOCKED in the rules
engine (`POST /restock`, backend/restock_link.py). For what mx-inv never sees, the engine asks after 10 min over the
limit; the crew answers YES / NO on the cockpit. The hold lives in the ENGINE (it owns the alarm; a restart keeps it);
mx-inv keeps no restock state. The engine REFUSES a hold while that box's alarm is already up - a late receive never
silences a real alarm. The place -> box map is a constant keyed on storage_locations ids (five rows, one boat), not a
schema column. The post runs as a background task after the write: the boat being down never fails a receive.
**Reopen if:** places are renamed / re-created (new ids), a box is added, or the map should be editable from the GUI
(then: a `cold_box` column on storage_locations + a pick list).
