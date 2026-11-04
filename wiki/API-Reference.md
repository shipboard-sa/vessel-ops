<!--
Purpose: The complete HTTP API of the mx-inv backend - every route with method, path, query, body
  and notes, the error conventions, who calls what, and the one authenticated inbound route.
Version: v8 (2026-10-18) - v8: the WF-502 restock endpoints are LIVE 2026-10-18 (`f6b7734`, merged into logbook-page). v7 (2026-10-18) - v7: GET / POST /api/cockpit/restock + the cold-box restock side effect of receive / stow / add stock / stock move (Ship's Automation WF-502 / D-128; built on branch wf502-restock). v6 (2026-10-09) - v6: GET / POST /api/cockpit/fill (tank-fill sessions, Ship's Automation D-129). v5 (2026-10-08) - v5: review-batch (schema v39) merged + LIVE 2026-10-08. v4 (2026-10-08) - v4: /api/items/stow lines take mode + from_container_id. v3 (2026-10-08) - v3: POST /api/items/move-to-unassigned. v2 (2026-10-08) - v2: POST /api/audits/{audit_id}/verify (Work a Container's tick); GET /api/items
  with container_id also returns last_verified_on. v1 (2026-10-07) - v1: new page (rebuild-from-spec pass). Route table generated from the
  app's own OpenAPI schema on branch logbook-page (live, schema v38), with review-batch (v39)
  differences marked.
Scope: PRODUCTION - engineering documentation for the mx-inv app.
Architecture: mx-inv wiki page. Data-Flows-and-Interfaces.md is the map of edges (what crosses a
  boundary and why); this page is the per-route contract of edge 5 (frontend <-> backend) plus
  the inbound engine push. Architecture.md lists which router file holds which routes.
Invocation: n/a (reference doc). Regenerate the tables after a route change (recipe at the end).
-->

# API Reference

Every route the backend (`backend/main.py` + `backend/routers/*.py`) serves, as of branch
`logbook-page` (live code, schema v39 since 2026-10-08). The routes in the section below came from branch
`review-batch` (schema v39), merged and live since 2026-10-08. The live, authoritative copy is always the running
server's own OpenAPI schema: `http://<host>:8000/docs` (Swagger UI) and `/openapi.json` - this page
exists so the contract can be read without a running server and so a rebuild has a spec.

## Conventions

- **Transport**: JSON over HTTP on port 8000, same origin as the React app. No versioning, no
  websockets, no push - the frontend re-fetches (React Query) after every write.
- **Auth**: none on any route except `POST /api/logbook/events` (bearer token, below). The trust
  boundary is the network (LAN / Tailscale) - see [Design Decisions](Design-Decisions.md#no-auth).
  CORS is `*`. The tokens for the boat stack (engine, SignalK) live on the server; a browser never
  holds them.
- **Bodies**: typed pydantic models unless the table says "JSON object, any of: ...". Those
  `PATCH` routes take a loose object; only the listed keys are applied (the `_*_MUTABLE`
  whitelists in `data.py`); **any other key is silently dropped and the call still answers 200**
  (`tests/test_api_roundtrip.py` pins this with two strict xfails; hardening phase 4 will refuse
  unknown keys). A field must be declared in the pydantic model AND the frontend type
  (`frontend/src/api/types.ts`) or it is dropped the same way.
- **`?` = optional.** Dates are ISO `YYYY-MM-DD`; logbook times are local ISO without a zone
  (crew entries to the minute, engine events to the second). Quantities are in the item's own
  `unit` (a `units.unit_key`).
- **Responses**: the shapes are mirrored field for field (snake_case) in
  `frontend/src/api/types.ts`, which is the readable reference for response bodies. Most write
  routes answer `{"status": "ok"}` or the created id(s).
- **Errors** (`{"detail": "<plain words>"}` unless noted):

| Code | Meaning in this app |
|---|---|
| 400 | A rule refused the write (bad value, unknown kind / status / mode, a phase from another project, a food-details conflict - `data.PhaseError` / `FoodDetailsError` map here globally). |
| 404 | Unknown id; **any unmatched `/api/...` path** (404 JSON since deploy 22 - before that it got `index.html` with a 200). |
| 409 | Conflict: duplicate catalog item (`detail` = `{item_id, item_name, message}`), a delete refused because something still uses it (storage with stock, a task with history, a document with entries filed under it, a unit in use), a device-research job already running, a passage end out of order, an engine event already stored. |
| 422 | Body failed validation (FastAPI's own shape), an unknown unit (`data.UnknownUnitError`, mapped globally), or an engine event the logbook will never accept. |
| 502 | The boat stack (rules engine / SignalK) did not answer or refused; `detail` names the URL to check. Also the `/routing` proxy when the routing backend is down (plain text). |
| 503 | That feature is not configured on this server (no engine URL / token, no SignalK token, device research unavailable). |

- **Not JSON**: `GET /api/tasks/{id}/checklist/print`, `GET /api/report/history` and
  `GET /api/report/logbook` return printable HTML pages (opened in a new tab);
  `GET /api/documents/year/{year}/csv` returns CSV (UTF-8 with BOM); `POST /api/device-research`
  takes form fields, not JSON.
- **Known quirk**: `GET /api/recipes` declares `ingredients` / `methods` / `tags` as list
  parameters without `Query()`, so FastAPI treats them as a request BODY on a GET - a browser
  cannot send them and only `search` works over HTTP (the frontend sends only `search`). The fix
  is `Query()` on those three parameters.

## Who calls the API

| Caller | Routes |
|---|---|
| Desktop React app (`frontend/src/features/*`) | everything except `/api/logbook/events` |
| Cockpit tablet / phone (`/cockpit`, `features/cockpit/`) | `/api/cockpit/*`, `/api/tasks/checklists`, the checklist step / tick routes, `/api/tasks/systems`, `/api/logbook` (entries, watch, this-watch, departure / arrival, passages, ports) |
| Ship's Automation rules engine (on boat-automation, the Pi) | `POST /api/logbook/events` only (below) |
| `scripts/golden_check.py`, `scripts/ci/smoke_api.py`, `tests/` | read routes, or anything on a temp database |
| Claude (data entry through the app's rules, after a verified backup) | the ordinary write routes |

## The inbound engine push: `POST /api/logbook/events`

The one route another system calls. Counterparty: the Ship's Automation rules engine, whose outbox
sends one event per POST to its configured mx-inv URL (today `http://192.168.1.144:8000`, the
laptop). Contract (authoritative copy: `design/LOGBOOK_DESIGN.md` section 6):

- **Auth**: `Authorization: Bearer <token>`; compared (constant-time) against
  `MXINV_EVENTS_TOKEN`, else the `MXINV_EVENTS_TOKEN=` line in the file named by
  `MXINV_ENGINE_TOKEN_FILE` (the stack's `engine.env` - one file holds both directions' tokens).
  No token configured on the server = every push is 401.
- **Body**: `event_id` (unique, the idempotency key), `source` (default `your-pi-hostname-rules` - a
  fixed identifier, not renamed), `wf_id?`, `origin?`, `kind`, `severity?` (`P1` / `P2` / `NUDGE` /
  `info`), `time` (ISO-8601 UTC, `Z` allowed), `message`, `simulated` (a test event), `data?`
  (free object), `record` (`handover` default / `log` - the rule's record level, Ship's Automation
  D-114: a `log` entry is in the ship's log but not in the watch handover's change report).
- **Answers**: 200 `{entry_id, entry_ref}` = stored; **409 = already stored** (same `event_id`) -
  the engine treats 200 and 409 both as delivered; 401 = bad or missing token; 422 = a body it will
  never accept (bad time, bad value) - not worth retrying.
- **Effect**: one `logbook_entries` row, `kind='event'`, `source='engine'`, `author='engine'`,
  title = message, `occurred_at` = `time` converted to local and kept to the second. The server
  stamps it with the boat's state when it fired: live SignalK if the event is under 2 minutes old,
  else the history read API at that time; the body starts with the deck-log status line, then
  the JSON detail (`kind`, `origin`, `wf_id`, `data`). See
  [Logic Flows section 21](Logic-Flows.md#21-the-logbook--ships-log-schema-v37-v39).

## Route table

Generated from `app.openapi()`; "Notes" is the route's own docstring, trimmed. Path parameters
are in the path; `{name}` on the systems routes is declared `{name:path}` because device names
can contain `/`. Grouped by router tag (`app` = routes in `backend/main.py`).

### `app`

| Method | Path | Query | Body | Notes |
|---|---|---|---|---|
| GET | `/api/health` |  |  |  |
| GET | `/routing` |  |  |  |
| DELETE | `/routing/{path}` |  |  |  |
| GET | `/routing/{path}` |  |  |  |
| POST | `/routing/{path}` |  |  |  |
| PUT | `/routing/{path}` |  |  |  |
| GET | `/{full_path}` |  |  |  |

### `schedule`

| Method | Path | Query | Body | Notes |
|---|---|---|---|---|
| GET | `/api/schedule` |  |  |  |

### `tasks`

| Method | Path | Query | Body | Notes |
|---|---|---|---|---|
| GET | `/api/tasks` |  |  | Full raw task table (project/subtask fields included, unfiltered) - the source for the Management view and the schedule board's own fetch of `/api/schedule` builds on the same query. |
| POST | `/api/tasks` |  | `system: str, task_name: str, description?: str/null, period?: str, interval_type?: str, task_kind?: str, project_id?: int/null, parent_task_id?: int/null, caution_notes?: str/null, checklist_group?: str/null, phase_id?: int/null, hours_meter?: str/null` |  |
| GET | `/api/tasks/checklists` |  |  |  |
| POST | `/api/tasks/checklists` |  | `name: str, system?: str, interval_type?: str, period?: str, caution_notes?: str/null` |  |
| GET | `/api/tasks/completions` | days?, limit?, year?, system?, device? |  | The completion audit trail (schema v26), newest first. Filters (Log tab): `year` (by the date logged; replaces `days`), `days` <= 0 for all time, `system` (top-level, includes its devices), `device` ... |
| GET | `/api/tasks/completions/facets` |  |  | The Log tab's filter choices: years with entries, and systems with their devices. |
| POST | `/api/tasks/completions/historical` |  | `system: str, what_was_done: str, completed_on: str, performed_by?: str/null, vendor?: str/null, cost?: num/null, notes?: str/null, parts?: dict[]/null, document_id?: int/null, outcome?: str/null, follow_ons?: dict[]/null, event_kind?: str/null, evidence_path?: str/null` | Record work the app never saw. It lands in the same append-only history as a ticked completion, marked source='historical', and does NOT reschedule anything. |
| GET | `/api/tasks/completions/performed-by` |  |  | What to offer in a "who did the work" box: the crew roster PLUS every name already used in the history, deduplicated case-insensitively (tracker #44). Free text is still accepted on the way in - this ... |
| PUT | `/api/tasks/completions/{completion_id}/document` |  | `document_id?: int/null` | File a history entry under an invoice, move it, or detach it (document_id null). The one change the append-only history allows besides voiding - it is a cross-reference, not an edit of what happened ... |
| POST | `/api/tasks/completions/{completion_id}/follow-ons` |  | `follow_ons: dict[]` | Raise follow-on task(s) from an existing history entry (schema v34) - the history row itself is not touched; each new task points back at it. |
| POST | `/api/tasks/completions/{completion_id}/void` |  | `reason: str` | Void a history entry (append-only correction). If it was the task's latest completion, the task's last-done date is restored. |
| DELETE | `/api/tasks/references/{ref_id}` |  |  |  |
| GET | `/api/tasks/references/{ref_id}` |  |  |  |
| PATCH | `/api/tasks/references/{ref_id}` |  | `JSON object, any of: kind, label, file_path, page, url, note, ref_task_id, sort_order, checklist_group` |  |
| POST | `/api/tasks/references/{ref_id}/tick` |  | `completed_on: str, consumption?: dict[]/null, performed_by?: str/null` | Tick a linked task in a checklist run: a real completion of the linked task (noted with the checklist), remembered on the link so this run shows it done. |
| POST | `/api/tasks/references/{ref_id}/untick` |  |  | Un-tick a linked task: voids the completion the tick recorded (the linked task's last-done date goes back) and reopens the link for this run. |
| GET | `/api/tasks/systems` |  |  |  |
| POST | `/api/tasks/systems` |  | `name: str, parent_name?: str/null, sort_order?: int/null, notes?: str/null` |  |
| PATCH | `/api/tasks/systems/{name}` |  | `parent_name?: str/null, sort_order?: int/null, notes?: str/null, make_model?: str/null, manual_ref?: str/null, installed_qty?: int/null, no_spares_needed?: bool/null, installed_on?: str/null, serial?: str/null, warranty_until?: str/null` |  |
| POST | `/api/tasks/systems/{name}/clone` |  | `new_name: str, copy_tasks?: bool, copy_parts?: bool` | Duplicate a fully set-up device under a new name, with its part links and its own independent copies of its tasks (tracker #67). Returns a summary of what was copied - and what was skipped - so the ... |
| POST | `/api/tasks/systems/{name}/delete` |  | `reassign_to?: str/null` |  |
| GET | `/api/tasks/systems/{name}/items` |  |  | A device's parts and spare units (items linked to it) with on-hand. |
| POST | `/api/tasks/systems/{name}/rename` |  | `new_name: str` |  |
| POST | `/api/tasks/{checklist_id}/checklist/duplicate` |  | `task_id: int, group?: str/null` |  |
| GET | `/api/tasks/{checklist_id}/checklist/groups` |  |  |  |
| POST | `/api/tasks/{checklist_id}/checklist/import` |  | `task_id: int, group?: str/null` |  |
| GET | `/api/tasks/{checklist_id}/checklist/importable` |  |  |  |
| GET | `/api/tasks/{checklist_id}/checklist/items` |  |  | The checklist's own steps AND the tasks linked into it, in one ordered list (item_kind 'step' / 'link'); a link's `done` is per run. |
| GET | `/api/tasks/{checklist_id}/checklist/linkable` |  |  | Every task that can be linked into this checklist, including ones already a step of another checklist (the one-box search on the checklist screen). |
| GET | `/api/tasks/{checklist_id}/checklist/print` |  |  | The print-on-demand sheet: one standalone page, fitted to one letter page in the browser (open it in a new tab, then Print / Save as PDF). Built fresh on every request. |
| POST | `/api/tasks/{checklist_id}/checklist/reset` |  |  |  |
| POST | `/api/tasks/{checklist_id}/checklist/steps` |  | `step_name: str, description?: str/null, caution_notes?: str/null, group?: str/null` |  |
| DELETE | `/api/tasks/{task_id}` |  |  | Hard delete - refused (409) once the task has logged history. The UI offers Retire instead in that case; see data.task_delete_blockers (tracker #66). |
| PATCH | `/api/tasks/{task_id}` |  | `JSON object, any of: system, task_name, task_description, caution_notes, period, interval_type, task_kind, sort_order, is_critical, checklist_group, hours_meter, schedule_from` |  |
| POST | `/api/tasks/{task_id}/clear-completion` |  |  | Un-check a single task (e.g. a checklist step ticked by mistake). |
| POST | `/api/tasks/{task_id}/complete` |  | `completed_on: str, consumption?: dict[]/null, close_subtasks?: bool, notes?: str/null, performed_by?: str/null, outcome?: str/null, follow_ons?: FollowOn[]/null` |  |
| POST | `/api/tasks/{task_id}/defer` |  | `extra_units: int` |  |
| DELETE | `/api/tasks/{task_id}/deferral` |  |  |  |
| PUT | `/api/tasks/{task_id}/deferral` |  | `units: int` |  |
| GET | `/api/tasks/{task_id}/items` |  |  |  |
| GET | `/api/tasks/{task_id}/items-demand` |  |  | Every catalog item a task needs, with on-hand totals/shortfall/stow location - what the schedule card's "tick what you used up" consumption checklist needs. Distinct from GET /items above ... |
| DELETE | `/api/tasks/{task_id}/items/{item_id}` |  |  |  |
| PUT | `/api/tasks/{task_id}/items/{item_id}` |  | `quantity_required?: num, amount_note?: str/null` |  |
| GET | `/api/tasks/{task_id}/linked-from` |  |  | The checklists that link this task (the reverse of /references) - shown on the task's own screen so it can be added to / removed from checklists from there. |
| PUT | `/api/tasks/{task_id}/parent` |  | `parent_task_id: int/null` |  |
| PUT | `/api/tasks/{task_id}/phase` |  | `phase_id: int/null` | Put the task in one of ITS project's phases, or clear it (`null`). |
| PUT | `/api/tasks/{task_id}/project` |  | `project_id: int/null` | Assign (or clear, with `project_id: null`) the task's project - the 'defer to the next haul-out' mechanism. |
| GET | `/api/tasks/{task_id}/referenced-by` |  |  | Everywhere this task is spoken for - project, parent checklist, every inbound kind='task' link, its own native steps, and what its history would cost a delete. Feeds the consolidated "Referenced by" ... |
| GET | `/api/tasks/{task_id}/references` |  |  |  |
| POST | `/api/tasks/{task_id}/references` |  | `kind: str, label: str, file_path?: str/null, page?: int/null, url?: str/null, note?: str/null, ref_task_id?: int/null` |  |
| POST | `/api/tasks/{task_id}/retire` |  | `reason?: str/null` | Take a task off the schedule and out of the pick lists, keeping its master row so task_completions stays threaded to it. Reversible. |
| GET | `/api/tasks/{task_id}/subtasks` |  |  |  |
| POST | `/api/tasks/{task_id}/unretire` |  |  |  |

### `items`

| Method | Path | Query | Body | Notes |
|---|---|---|---|---|
| GET | `/api/items` | item_type?, search?, container_id? |  |  |
| POST | `/api/items` |  | `item_name: str, item_type: str, unit?: str, min_quantity?: num, target_quantity?: num/null, notes?: str/null, details?: dict/null` |  |
| GET | `/api/items/below-minimum` |  |  | The Restock List. Each row also carries `serves`: the systems/devices the item is linked to (v22 item_systems), [] when it is linked to none. |
| GET | `/api/items/fit-review` |  |  | Parts / spare units with the device they serve and any computed fit flags - the Audit tab's "Spares fit check" list (schema v28). |
| GET | `/api/items/food-expiring` | days? |  |  |
| GET | `/api/items/on-list` |  |  | Items somebody asked for ("we need more of this"), oldest request first. |
| GET | `/api/items/options` | item_type? |  |  |
| GET | `/api/items/policies` |  |  | The stocking_policies lookup table - same idea as /types. |
| GET | `/api/items/proteins` |  |  | Food items in the meat category - the "protein" pick list when planning a recipe. |
| GET | `/api/items/stock-expiring` | days?, item_type?, exclude_item_type? |  | Generalized form of /food-expiring - any item type with an expiry date, e.g. spares/parts with a shelf life or inspection-due date (safety gear, medical kit contents). |
| GET | `/api/items/stock/movements` | item_id?, limit? |  |  |
| DELETE | `/api/items/stock/{stock_id}` | reason?, note? |  |  |
| PATCH | `/api/items/stock/{stock_id}` |  | `reason?: str, fields?: dict` |  |
| POST | `/api/items/stow` |  | `container_id: int, lines: StowLine[]` | Put many items into one container at once (all-or-nothing). (LIVE 2026-10-18, `f6b7734`) A line with quantity > 0 into a cold-box place also marks that box RESTOCKED in the rules engine (backend/restock_link.py, background - never fails the stow); same for receive, add stock and a PATCH stock move. |
| GET | `/api/items/types` |  |  | The item_types lookup table - what item_type values exist and what they mean. Adding a type is a data change (INSERT into the lookup table), not a schema migration. |
| GET | `/api/items/unlinked-parts` |  |  | Parts / spare units linked to no system or device - the Audit tab's review list. |
| GET | `/api/items/unlinked-tool-accessories` |  |  | Tool accessories with no parent tool recorded - the Audit tab's review list. |
| DELETE | `/api/items/{item_id}` |  |  |  |
| GET | `/api/items/{item_id}` |  |  |  |
| PATCH | `/api/items/{item_id}` |  | `JSON object, any of: item_name, unit, min_quantity, target_quantity, notes, stocking_policy, annual_usage, reorder_buffer, min_hold, item_type (retype), details (the type's detail row)` |  |
| GET | `/api/items/{item_id}/accessories` |  |  | The accessories linked to this tool - [{item_id, item_name}] (reverse of /tool-links). |
| GET | `/api/items/{item_id}/consumption-rate` | days? |  |  |
| PUT | `/api/items/{item_id}/fit` |  | `fit_status?: str/null, note?: str/null` |  |
| PUT | `/api/items/{item_id}/on-list` |  | `on_list: bool` | Put the item on the shopping list or take it off; receiving stock clears it. |
| POST | `/api/items/{item_id}/receive` |  | `lines: ReceiveLine[], acquired_on?: str/null, older_expiry?: str/null` | Receive a purchase into one or several containers in one all-or-nothing call (a plain line merges into the container's existing / zero-quantity row). |
| GET | `/api/items/{item_id}/receive-info` |  |  | Receive form data in one call: places (targets), suggested expiry (today + shelf life, if the item has one) and the undated stock aboard (offered a date when a dated batch is added beside it). |
| GET | `/api/items/{item_id}/receive-targets` |  |  | Containers a received purchase of this item can go to (its existing rows), zero-quantity 'home' rows first. Empty = no recorded place yet. |
| POST | `/api/items/{item_id}/stage-for-removal` |  |  | Move all of a (wrong-model) item's stock into 'To remove from boat > Trade or scrap'. |
| GET | `/api/items/{item_id}/stock` |  |  |  |
| POST | `/api/items/{item_id}/stock` |  | `container_id: int/null, quantity: num, expiry_date?: str/null, opened_on?: str/null, lot_note?: str/null, acquired_on?: str/null, vendor?: str/null, unit_cost?: num/null, reason?: str` |  |
| GET | `/api/items/{item_id}/systems` |  |  | The systems/devices this item serves (a part OF them, or a spare unit that can replace them - the item's type says which). |
| PUT | `/api/items/{item_id}/systems` |  | `systems: str[]` |  |
| GET | `/api/items/{item_id}/tool-links` |  |  | The tool item_ids this accessory belongs to (v29, many-to-many). |
| PUT | `/api/items/{item_id}/tool-links` |  | `tool_item_ids: int[]` |  |

### `storage`

| Method | Path | Query | Body | Notes |
|---|---|---|---|---|
| GET | `/api/storage/compartments` |  |  |  |
| POST | `/api/storage/compartments` |  | `name: str` |  |
| DELETE | `/api/storage/compartments/{compartment_id}` | reassign_to? |  |  |
| PATCH | `/api/storage/compartments/{compartment_id}` |  | `name: str` |  |
| GET | `/api/storage/containers` |  |  |  |
| POST | `/api/storage/containers` |  | `location_id: int, name: str, container_type?: str, notes?: str/null` |  |
| GET | `/api/storage/containers/options` | favorites_only? |  |  |
| DELETE | `/api/storage/containers/{container_id}` |  |  |  |
| PATCH | `/api/storage/containers/{container_id}` |  | `JSON object, any of: container_name, container_type, notes, location_id (moves it, stock travels), favorite` | Rename / retype / favorite a container, or MOVE it (`location_id`) - its stock rows travel with it (stock references the container, not the location). |
| GET | `/api/storage/locations` |  |  |  |
| POST | `/api/storage/locations` |  | `name: str, compartment_id: int` |  |
| DELETE | `/api/storage/locations/{location_id}` |  |  | Deletes the location and its empty containers; 409 if any container still holds stock (never orphans stock). |
| PATCH | `/api/storage/locations/{location_id}` |  | `JSON object, any of: location_name, compartment_id (moves the location)` |  |

### `projects`

| Method | Path | Query | Body | Notes |
|---|---|---|---|---|
| DELETE | `/api/phases/{phase_id}` |  |  | Its tasks stay on the project with no phase. |
| PATCH | `/api/phases/{phase_id}` |  | `JSON object, any of: name, notes, target_start, target_end` |  |
| GET | `/api/projects` | include_done? |  |  |
| POST | `/api/projects` |  | `name: str, kind?: str, description?: str/null, target_start?: str/null, target_end?: str/null, notes?: str/null` |  |
| DELETE | `/api/projects/{project_id}` |  |  | Tasks on the project keep existing; their project_id is set NULL. |
| GET | `/api/projects/{project_id}` |  |  |  |
| PATCH | `/api/projects/{project_id}` |  | `JSON object, any of: name, kind, status, description, target_start, target_end, notes` |  |
| GET | `/api/projects/{project_id}/phases` |  |  |  |
| POST | `/api/projects/{project_id}/phases` |  | `name: str, notes?: str/null, target_start?: str/null, target_end?: str/null` |  |
| PUT | `/api/projects/{project_id}/phases/order` |  | `phase_ids: int[]` |  |
| GET | `/api/projects/{project_id}/tasks` |  |  |  |

### `recipes`

| Method | Path | Query | Body | Notes |
|---|---|---|---|---|
| GET | `/api/recipes` | search? | `ingredients?: str[]/null, methods?: str[]/null, tags?: str[]/null` |  |
| POST | `/api/recipes` |  | `title: str, body: str, source?: str/null, servings?: str/null, notes?: str/null, ingredients?: str[]/null, methods?: str[]/null, tags?: str[]/null` |  |
| PUT | `/api/recipes/ingredients/{recipe_ingredient_id}/item` |  | `item_id: int/null` | (Re)link one saved ingredient line to a catalog item, e.g. right after the ingredient was added to the catalog at cook time. |
| GET | `/api/recipes/tags/{kind}` |  |  |  |
| DELETE | `/api/recipes/{recipe_id}` |  |  |  |
| GET | `/api/recipes/{recipe_id}` |  |  |  |
| PATCH | `/api/recipes/{recipe_id}` |  | `JSON object, any of: title, source, servings, body, notes; ingredients / methods / tags (lists, each replaces that tag kind wholesale)` |  |
| GET | `/api/recipes/{recipe_id}/convert-text` |  |  | Ephemeral proposal - reads the body fresh and returns `{converted_body, changes: [{original, converted}]}`; saves nothing. Applying it is a normal PATCH of the recipe body (the metric original is ... |
| GET | `/api/recipes/{recipe_id}/ingredients` |  |  |  |
| PUT | `/api/recipes/{recipe_id}/ingredients` |  | `IngredientSave[]` |  |
| POST | `/api/recipes/{recipe_id}/ingredients/changes` |  | `updates?: IngredientUpdate[], additions?: IngredientAddition[]` | "Keep in recipe" from the plan/cook screen (tracker #71): re-link or re-quantify saved lines and append new ones, in one transaction. Only the fields actually sent are changed. |
| POST | `/api/recipes/{recipe_id}/make` |  | `occurred_on: str, consumption?: dict[]/null` |  |
| GET | `/api/recipes/{recipe_id}/parse-ingredients` |  |  | Ephemeral - reads the recipe body fresh each call, saves nothing. |

### `meal-plan`

| Method | Path | Query | Body | Notes |
|---|---|---|---|---|
| GET | `/api/meal-plan` |  |  |  |
| POST | `/api/meal-plan` |  | `recipe_id: int, planned_for?: str/null, notes?: str/null, protein_item_id?: int/null` |  |
| POST | `/api/meal-plan/pantry-check` |  |  | Put the standing pantry-check recipe (every bulk item) on the plan, creating it the first time. Returns {meal_plan_id, recipe_id}. |
| GET | `/api/meal-plan/shopping-list` |  |  |  |
| DELETE | `/api/meal-plan/{meal_plan_id}` |  |  |  |
| POST | `/api/meal-plan/{meal_plan_id}/complete` |  | `occurred_on: str, consumption?: dict[]/null` |  |
| PUT | `/api/meal-plan/{meal_plan_id}/overrides` |  | `overrides?: dict[]/null` |  |
| PUT | `/api/meal-plan/{meal_plan_id}/protein` |  | `protein_item_id?: int/null` | Change the protein of a plan entry, keeping its other saved picks (the dedicated protein control). |

### `provisioning`

| Method | Path | Query | Body | Notes |
|---|---|---|---|---|
| GET | `/api/provisioning/aisle-order` |  |  |  |
| PUT | `/api/provisioning/aisle-order` |  | `categories: str[]` |  |
| GET | `/api/provisioning/food-cart` | crew?, weeks?, order?, expiring_days? |  | The merged food shopping cart - baseline provisioning heuristic + meal-plan refinement, one list (the owner, 2026-09-17). |
| GET | `/api/provisioning/plan` | crew?, weeks?, order? |  |  |
| GET | `/api/provisioning/prefs` |  |  | Last-used crew/weeks, so the plan reopens where it was left - mirrors the Streamlit tab's `provision_crew`/`provision_weeks` system_config keys. |
| PUT | `/api/provisioning/prefs` |  | `crew: int, weeks: num` |  |
| GET | `/api/provisioning/shopping-list` |  |  | Linked task items whose required quantity exceeds current on-hand. The Streamlit UI cross-references this against the active schedule (`/api/schedule`) to show each shortfall's due date. |

### `audits`

| Method | Path | Query | Body | Notes |
|---|---|---|---|---|
| GET | `/api/audits` |  |  |  |
| POST | `/api/audits` |  | `name: str, scope?: str, notes?: str/null` |  |
| GET | `/api/audits/open` |  |  |  |
| POST | `/api/audits/{audit_id}/abandon` |  |  |  |
| POST | `/api/audits/{audit_id}/close` |  | `absent_item_ids?: int[], notes?: str/null` |  |
| GET | `/api/audits/{audit_id}/containers/{container_id}` |  |  |  |
| POST | `/api/audits/{audit_id}/count` |  | `item_id: int, container_id: int, counted_qty: num, note?: str/null, occurred_on?: str/null` |  |
| GET | `/api/audits/{audit_id}/progress` |  |  |  |
| GET | `/api/audits/{audit_id}/unverified` | item_type? |  |  |
| POST | `/api/items/stow` (line fields, 2026-10-08) |  | each line: `item_id, quantity, mode?: "move"\|"extra", from_container_id?: int` | `move` = take the quantity out of `from_container_id` (plain then lots oldest-first, 'transfer' pairs; 400 if more than is there); `extra` = new stock logged as found aboard; no mode = previous behaviour. Result adds `moved_between`. |
| POST | `/api/items/move-to-unassigned` |  | `container_id: int, item_ids: int[]` | Work a Container's finish step (2026-10-08): each item's stock in that container moves to Unassigned ('transfer' pairs; empty home rows removed; no audit line). All-or-nothing; 400 if an item has no stock there or the container is Unassigned. Listed here beside the audit verify route it pairs with. |
| POST | `/api/audits/{audit_id}/verify` |  | `item_id: int, container_id: int, verified?: bool` | Work a Container's tick (2026-10-08): an `audit_lines` row "verified here today" at the quantity held there (all lots), no stock change; `verified: false` removes it only while it is a pure verification. 409 if the audit is not in progress or the item has no stock row in that container. |

### `telemetry`

| Method | Path | Query | Body | Notes |
|---|---|---|---|---|
| GET | `/api/telemetry/snapshot` |  |  |  |
| PUT | `/api/telemetry/tasks/{task_id}/hours-baseline` |  | `hours: num` |  |
| GET | `/api/telemetry/{meter}/hours-per-year` |  |  |  |
| PUT | `/api/telemetry/{meter}/reading` |  | `hours: num, on_date?: str/null` |  |
| GET | `/api/telemetry/{meter}/status` |  |  |  |

### `units`

| Method | Path | Query | Body | Notes |
|---|---|---|---|---|
| GET | `/api/units` |  |  |  |
| POST | `/api/units` |  | `unit_key: str, label?: str/null, dimension?: str, description?: str/null, offered?: bool` |  |
| DELETE | `/api/units/{unit_key}` |  |  |  |
| PATCH | `/api/units/{unit_key}` |  | `new_key?: str/null, label?: str/null, dimension?: str/null, description?: str/null, offered?: bool/null` |  |

### `documents`

| Method | Path | Query | Body | Notes |
|---|---|---|---|---|
| GET | `/api/documents` | year? |  |  |
| POST | `/api/documents` |  | `vendor: str, doc_number?: str/null, doc_date?: str/null, period_start?: str/null, period_end?: str/null, total?: num/null, file_path?: str/null, project_id?: int/null, expense_class?: str/null, notes?: str/null` |  |
| GET | `/api/documents/expense-classes` |  |  | Every expense class already used, most-used first - offered back so the spelling stays stable. Free text is still accepted on the way in. |
| GET | `/api/documents/year/{year}` |  |  |  |
| GET | `/api/documents/year/{year}/csv` |  |  | One row per invoice on file for the year, for reconciling beside the card summary in a spreadsheet. Flat on purpose (pivot it there); no grand-total row, for the same reason the screen has none that ... |
| GET | `/api/documents/years` |  |  |  |
| DELETE | `/api/documents/{document_id}` |  |  |  |
| GET | `/api/documents/{document_id}` |  |  |  |
| PUT | `/api/documents/{document_id}` |  | `vendor: str, doc_number?: str/null, doc_date?: str/null, period_start?: str/null, period_end?: str/null, total?: num/null, file_path?: str/null, project_id?: int/null, expense_class?: str/null, notes?: str/null` |  |

### `reports`

| Method | Path | Query | Body | Notes |
|---|---|---|---|---|
| GET | `/api/report/history` | system?, device?, cost? |  | The vessel's service history, printable. `system` limits to one top-level system and its devices, `device` to one exact device, neither = the whole boat. |
| GET | `/api/report/logbook` | day?, to?, passage?, tests? |  | The ship's log, printable: `passage` = one passage (its departure entry id); else `day` (YYYY-MM-DD) alone = that day, with `to` = the whole run of days. Engine TEST events are left out unless ... |

### `logbook`

| Method | Path | Query | Body | Notes |
|---|---|---|---|---|
| GET | `/api/logbook` | kind?, system?, open?, since?, until?, simulated?, limit? |  |  |
| POST | `/api/logbook` |  | `kind: str, title: str, body?: str/null, system?: str/null, severity?: str/null, author?: str/null, source?: str, minutes_ago?: int, follow_on?: FollowOn/null` |  |
| POST | `/api/logbook/arrival` |  | `port: str, bound_for?: str/null, body?: str/null, author?: str/null, source?: str, minutes_ago?: int` | **review-batch body:** `port: str, bound_for?: str/null, first_watch?: str/null, body?: str/null, author?: str/null, source?: str, minutes_ago?: int` |
| POST | `/api/logbook/departure` |  | `port: str, bound_for?: str/null, body?: str/null, author?: str/null, source?: str, minutes_ago?: int` | **review-batch body:** `port: str, bound_for?: str/null, first_watch?: str/null, body?: str/null, author?: str/null, source?: str, minutes_ago?: int` |
| POST | `/api/logbook/events` | header authorization | `event_id: str, source?: str, wf_id?: str/null, origin?: str/null, kind: str, severity?: str/null, time: str, message: str, simulated?: bool, data?: dict/null, record?: str` | The rules engine's push (one event per POST). Stored as kind 'event'. |
| GET | `/api/logbook/passages` | limit? |  | Every passage (one leg: a departure to the next arrival), newest first, with its facts. |
| GET | `/api/logbook/passages/current` |  |  | {'passage': the leg under way, or None} - the cockpit's Depart / Arrive tile. |
| GET | `/api/logbook/ports` |  |  | Ports named so far, most recent first - the pick list for a departure / arrival. |
| GET | `/api/logbook/this-watch` |  |  | A CHANGE report since the last watch entry (the owner 10-05: "what's changed since last time" - the standing Deferred / Accepted register is NOT repeated here): new entries (crew + engine events) and ... |
| POST | `/api/logbook/watch` |  | `notables?: str/null, author?: str/null` | The watch entry at handover (the owner's Watch Log, 2026-09-11): the handover card as it stood + the crew's notables; the events / entries since the last watch entry are listed in the body so the entry ... **review-batch body:** `notables?: str/null, author?: str/null, on_watch?: str/null` |
| GET | `/api/logbook/{entry_id}` |  |  |  |
| POST | `/api/logbook/{entry_id}/status` |  | `status: str, note?: str/null, author?: str/null` |  |

### `cockpit`

| Method | Path | Query | Body | Notes |
|---|---|---|---|---|
| POST | `/api/cockpit/ack` |  |  | Ack every alarm - the same as the panel's ack button (the engine has one ack for all). |
| GET | `/api/cockpit/boat` |  |  | What the cockpit shows from the rules engine: the boat mode (and whether someone tapped it), the alarms, and whether the automation is healthy. Trimmed from the engine's /status - the rules / relays ... |
| GET | `/api/cockpit/capabilities` |  |  | Which cockpit features have somewhere to go (release package 2026-09-24). Sail Plan and Break / Incident only SEND to an outside logbook - with none configured they used to say "Logged" and store ... |
| GET | `/api/cockpit/fill` |  |  | (2026-10-09) The four tanks fuel first - `tanks[]: {tank, label, level, session: null / {source: tap / watermaker, since, by, active}}`, `watermaker: {running, watts}`, `can_write` - from the engine's GET /fill. 501 = the engine has no /fill yet (older than api.py v9); 502 = engine not answering. |
| POST | `/api/cockpit/fill` |  | `tank: str, on?: bool` | (2026-10-09) The crew 'Filling' (on, default) / 'Stop' (off) tap -> engine POST /fill with `by: "cockpit"` and the engine token; answers the GET view. `tank` = fuel_port / fuel_stbd / water_port / water_stbd (else 400, never sent); no token = 503; **409** when the watermaker is filling that tank (its session carries the 95 % HP-pump cut - never stopped or replaced from here). |
| GET | `/api/cockpit/restock` |  |  | (LIVE 2026-10-18, `f6b7734`) The cold boxes from the engine's GET /restock - `boxes[]: {box, label, asking, alarm, mark: null / {kind: hold / denied, since, until, by, source}}}`, `hold_h`, `can_write`. 501 = engine older than api.py v14. |
| POST | `/api/cockpit/restock` |  | `box: str, answer: "yes" \| "no"` | (LIVE 2026-10-18, `f6b7734`) The crew's answer to WF-502 'expected?' -> engine POST /restock `{box, answer, by: "cockpit"}`; 400 bad box / answer (checked here first); **409 from the engine** = that box's alarm is already up (a YES cannot silence it). |
| POST | `/api/cockpit/mode` |  | `mode: str` | The boat-mode tap (D-092 / SO-9). The tablet's own lock PIN is the guard (the owner 10-04); this server adds the engine token, so the tablet never holds it. |
| GET | `/api/cockpit/ping` |  |  | Heartbeat for the tablet's connection banner - touches no database, so it answers even when something else is slow. |
| GET | `/api/cockpit/sail-plan` |  |  | The sail set now: SignalK's sails.activeSet, else the newest one in history (SignalK forgets values when it restarts - then it is written back with its ORIGINAL time, so the polar keeps the right ... |
| POST | `/api/cockpit/sail-plan` |  | `main: str, headsail?: str, headsail_state?: str/null, wing_on_wing?: bool, minutes_ago?: int` | **review-batch body:** `main: str, headsail?: str, headsail_state?: str/null, wing_on_wing?: bool, minutes_ago?: int, author?: str/null` |
| GET | `/api/cockpit/watch-handover/boat` |  |  | The pre-filled handover card (WF-602 / N-39): SignalK now, plus fuel / water used, distance run and the barometer trend over the watch from the history read API. A missing value is left out, never ... |
| GET | `/api/cockpit/watch-handover/wx` |  |  | Weather summary for the shift-change screen, from routing's newest briefing. |

### `settings`

| Method | Path | Query | Body | Notes |
|---|---|---|---|---|
| GET | `/api/settings` |  |  |  |
| PUT | `/api/settings` |  | `vessel_name?: str/null, engine_label?: str/null, genset_label?: str/null, manuals_root?: str/null` |  |

### `device-research`

| Method | Path | Query | Body | Notes |
|---|---|---|---|---|
| POST | `/api/device-research` |  | `form: device_name: str, manual_paths?: str, parent_system?: str/null, existing_make_model?: str/null, existing_notes?: str/null` | Start a research job. `manual_paths` is newline-separated, each relative to D:\Documents\sailboat\Manuals\ (blank is fine - the model searches for one itself). |
| GET | `/api/device-research/status` |  |  |  |
| DELETE | `/api/device-research/{job_id}` |  |  |  |
| GET | `/api/device-research/{job_id}` |  |  |  |

### Added by the Ship's Log review (schema v39, live since 2026-10-08)

| Method | Path | Query | Body | Notes |
|---|---|---|---|---|
| POST | `/api/logbook/engine` |  | `on: bool, hours?: num/null, author?: str/null, source?: str, minutes_ago?: int` |  |
| GET | `/api/logbook/propulsion` |  |  | The sail set and engine state as logged by hand. |
| GET | `/api/logbook/raised-by/{task_id}` |  |  | Open failures whose fix task is task_id - the desktop offers to mark them Fixed when the task completes. |
| GET | `/api/logbook/status-changes` | since, until |  | Failure status changes that happened in [since, until), newest first - shown on their own day (the owner 10-05). |
| GET | `/api/logbook/watchkeeper` |  |  | Who has the watch (None alongside / at anchor) and the names an entry can be signed with. |

## The `/routing` proxy and the SPA fallback

- `GET /routing` redirects to `/routing/`; `GET|POST|PUT|DELETE /routing/{path}` are forwarded
  unchanged (query, body, headers minus `Host`) to `MXINV_ROUTING_URL` (live
  `http://127.0.0.1:8100`, the separate passage-planner app) with a 120 s timeout. Mounted only
  when `MXINV_ROUTING_URL` is set. Upstream down = 502 plain text. The routing app's own API is
  documented in the routing repo, not here.
- `GET /{full_path}` (the last route, only when `frontend/dist` exists): `/api/...` -> 404 JSON;
  a real file inside `frontend/dist` -> that file; anything else -> `index.html` (so `/cockpit`
  and deep links survive a reload). `/assets/*` is a static mount of `frontend/dist/assets`.

## Regenerating this table

With the venv, against a throwaway COPY of a database - importing `backend.main` runs the
first-run init and the migration runner on `VESSEL_DB_PATH`, so never point it at live. Write it
as a script file in a scratch folder and run it from `<your-project-dir>`:

```python
import os, json, sys
os.environ["VESSEL_DB_PATH"] = r"C:\path\to\scratch\copy.db"   # absolute path to a COPY
os.environ["MXINV_ROUTING_URL"] = "http://127.0.0.1:9"        # so the proxy routes are listed
sys.path.insert(0, ".")
from backend.main import app
json.dump(app.openapi(), open("openapi.json", "w"), indent=1)
```

Then render `paths` (method, path, query parameters, the request-body schema's properties, the
docstring's first paragraph) into the tables above. For another branch,
`git archive <branch> | tar -x -C <dir>` and run the same from that directory.
