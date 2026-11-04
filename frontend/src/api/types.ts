// Mirrors backend/scheduling.py's schedule_snapshot() output field-for-field
// (snake_case, no transform layer) - see backend/scheduling.py for the
// authoritative shape.

export interface TaskRow {
  task_id: number
  system: string
  task_name: string
  task_description: string | null
  period: string | null
  interval_type: string
  interval_type_clean: string
  last_completed_date: string | null
  caution_notes: string | null
  deferred_units: number
  is_critical: number
  hours_at_completion: number | null
  hours_meter: string | null
  task_kind: string
  project_id: number | null
  parent_task_id: number | null
  sort_order: number | null
  project_name: string | null
  project_status: string | null
  parked: number
  retired: number
  retired_at: string | null
  days_remaining: number
  calculated_due_date: string
  original_due_date: string
  deferred_days: number
  formatted_last_done: string
  /** v36: never done - there is no real last date (formatted_last_done is ''). */
  never_done?: boolean
  // v34 follow-on origin (see RawTask)
  origin_completion_id?: number | null
  origin_task_name?: string | null
  origin_task_id?: number | null
  origin_completed_on?: string | null
  origin_outcome?: string | null
}

export type BucketName =
  | 'critical'
  | 'overdue'
  | 'today'
  | 'week'
  | 'month'
  | 'quarter'
  | 'hours'
  | 'checklists'

export interface ScheduleSnapshot {
  generated_at: string
  meta: {
    parked_count: number
    retired_count: number
    subtask_count: number
    active_count: number
  }
  buckets: Record<BucketName, TaskRow[]>
  history: TaskRow[]
  // Every task's projected due-date fields, unfiltered (includes the parked
  // and retired tasks the buckets above exclude) - scheduling.py's all_projected.
  all_projected: TaskRow[]
}

// GET /api/tasks - data.load_tasks_dataframe()'s raw columns, unprojected
// (no days_remaining/calculated_due_date/etc - that's schedule-only math).
export interface RawTask {
  task_id: number
  system: string
  task_name: string
  task_description: string | null
  period: string | null
  interval_type: string
  last_completed_date: string | null
  caution_notes: string | null
  deferred_units: number
  is_critical: number
  hours_at_completion: number | null
  hours_meter: string | null
  task_kind: string
  project_id: number | null
  parent_task_id: number | null
  sort_order: number | null
  project_name: string | null
  project_status: string | null
  parked: number
  // v30 / tracker #66: retired = off the schedule and out of the pick lists, master
  // row (and its task_completions thread) kept. NULL retired_at = active.
  retired_at: string | null
  retired_reason: string | null
  retired: number
  // v34: set when this task is a FOLLOW-ON raised from a history entry (one entry -> many)
  origin_completion_id?: number | null
  origin_task_name?: string | null
  origin_task_id?: number | null
  origin_system?: string | null
  origin_completed_on?: string | null
  origin_outcome?: string | null
}

/** How a job went (schema v32 column, captured from v34). null = not stated (reads as done). */
export type CompletionOutcome = 'done_ok' | 'problem_found' | 'partial'

/** A follow-on task to create alongside a completion (v34). system null = the job's own. */
export interface FollowOnDraft {
  task_name: string
  system: string | null
  is_critical: boolean
  /** Break/fix urgency (tracker #70) - stored as the task's period; defaults to routine. */
  urgency: FollowOnUrgency
}

export type FollowOnUrgency = 'routine' | 'urgent' | 'immediate'

// GET /tasks/{id}/referenced-by - every place a task is spoken for, in one read.
// The consolidated "Referenced by" panel on TaskDetail (tracker #66).
export interface TaskReferencedByLink {
  ref_id: number
  label: string
  checklist_group: string | null
  sort_order: number | null
  from_task_id: number
  from_task_name: string
  from_task_kind: string
  from_system: string
  from_parent_task_id: number | null
  from_parent_name: string | null
}

export interface TaskDeleteBlockers {
  task_id: number
  descendants: number
  completions: number
  stock_movements: number
  can_delete: boolean
}

export interface TaskReferencedBy {
  task_id: number
  task_name: string
  task_kind: string
  retired_at: string | null
  retired_reason: string | null
  project: { project_id: number; name: string; status: string } | null
  parent: { task_id: number; task_name: string; task_kind: string; system: string } | null
  links: TaskReferencedByLink[]
  steps: { task_id: number; task_name: string; task_kind: string }[]
  history: TaskDeleteBlockers
}

// GET /api/tasks/systems - tasks.system's governed picklist (schema v14).
// parent_name is optional, one level deep - lets specific equipment nest
// under a broader category (e.g. a water pump under "Fresh Water
// System"). NULL = a top-level/ungrouped system.
export interface SystemInfo {
  name: string
  parent_name: string | null
  sort_order: number | null
  notes: string | null
  task_count: number
  // v22 device details (a system row with a parent is a device = a bucket)
  make_model: string | null
  manual_ref: string | null
  installed_qty: number
  no_spares_needed: number
  item_count: number
  // v32 device identity (tracker #44): which physical unit this bucket is, so a per-device
  // history report can name it. All optional - gathered off nameplates at the audit walk.
  installed_on: string | null
  serial: string | null
  warranty_until: string | null
}

// GET /api/items/proteins - food items in the meat category: the "protein" pick list (tracker #24).
export interface Protein {
  item_id: number
  item_name: string
  unit: string
  quantity_onhand: number
}

// GET /api/tasks/systems/{name}/items - a device's parts and spare units (item_systems links).
export interface SystemItem {
  item_id: number
  item_name: string
  item_type: string
  unit: string
  stocking_policy: string
  min_quantity: number | null
  quantity_onhand: number
}

export const PROJECT_KINDS = ['haul_out', 'refit', 'campaign', 'service_period', 'other'] as const
export const PROJECT_STATUSES = ['planned', 'active', 'done', 'cancelled'] as const
export type ProjectKind = (typeof PROJECT_KINDS)[number]
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

// GET /api/projects - data.list_projects()'s shape (projects.* plus the two
// COUNT(*) subquery columns).
export interface Project {
  project_id: number
  name: string
  description: string | null
  kind: ProjectKind
  status: ProjectStatus
  target_start: string | null
  target_end: string | null
  notes: string | null
  created_at: string
  task_count: number
  open_count: number
}

// GET /api/projects/{id}/tasks
export interface ProjectTaskRow {
  task_id: number
  system: string
  task_name: string
  task_kind: string
  parent_task_id: number | null
  last_completed_date: string | null
  period: string | null
  interval_type: string
  sort_order: number | null
  checklist_group: string | null
  phase_id: number | null
  done: number
}

// GET /api/projects/{id}/phases - a per-project, ordered stage list (schema v23).
export interface ProjectPhase {
  phase_id: number
  project_id: number
  name: string
  sort_order: number
  notes: string | null
  target_start: string | null
  target_end: string | null
  task_count: number
  open_count: number
}

// GET /api/tasks/{id}/subtasks - a checklist's steps, or any task's children.
export interface SubtaskRow {
  task_id: number
  task_name: string
  task_description: string | null
  caution_notes: string | null
  checklist_group: string | null
  last_completed_date: string | null
  sort_order: number | null
  done: number
}

// GET /api/tasks/{id}/references - data.get_task_references(). kind='task'
// rows are an in-app cross-reference (ref_task_id); everything else is an
// external citation (manual/standard/url/video/form/note).
/** One runnable line of a checklist: its own step OR a task linked into it (schema v27, tracker #48). */
export interface ChecklistItem {
  item_kind: 'step' | 'link'
  /** The step's own id, or - for a link - the linked (master) task's id. */
  task_id: number
  /** The link's id (null for a step); a link's place, group and per-run tick live on it. */
  ref_id: number | null
  task_name: string
  task_description: string | null
  caution_notes: string | null
  checklist_group: string | null
  sort_order: number | null
  system: string
  interval_type: string
  last_completed_date: string | null
  /** Step: last_completed_date is set. Link: ticked in THIS run and that completion is not voided. */
  done: number
}

/** A checklist that links a task (reverse of TaskReference) - tracker #48. */
export interface TaskLinkedFrom {
  ref_id: number
  checklist_id: number
  checklist_name: string
  system: string
}

/** A task that can be linked into a given checklist (tracker #48). */
export interface LinkableTask {
  task_id: number
  system: string
  task_name: string
  task_kind: string
  interval_type: string
  parent_task_id: number | null
  /** The checklist it is already a step of; null = standalone (only standalone tasks can be Moved). */
  parent_name: string | null
}

export interface TaskReference {
  ref_id: number
  task_id: number
  kind: string
  label: string
  file_path: string | null
  page: number | null
  url: string | null
  note: string | null
  ref_task_id: number | null
  ref_task_name: string | null
  ref_task_system: string | null
  ref_task_kind: string | null
  ref_task_last_completed: string | null
}

// GET /api/tasks/{id}/items-demand - data.get_task_items(): what Complete's
// "tick what you used up" consumption checklist needs (onhand/shortfall),
// distinct from the plain link-editing shape at GET /api/tasks/{id}/items.
export interface TaskItemDemand {
  item_id: number
  item_name: string
  item_type: string
  unit: string
  quantity_required: number
  amount_note: string | null
  quantity_onhand: number
  shortfall: number
  stowed_at: string | null
}

// -- warehouse / inventory -------------------------------------------------

// item_type and stocking_policy are data-driven (schema v12: item_types /
// stocking_policies lookup tables, not CHECK-constrained enums) - see
// GET /api/items/types and /api/items/policies. Any string the catalog
// currently has a row for is valid; don't hardcode the value set here.
export type ItemType = string
export type StockingPolicy = string
export const CONTAINER_TYPES = ['dry', 'refrigerated', 'frozen', 'tool_storage', 'tankage'] as const
export type ContainerType = (typeof CONTAINER_TYPES)[number]

// GET /api/items/types - data.list_item_types()'s lookup rows.
export interface ItemTypeInfo {
  type_key: string
  label: string
  description: string
  sort_order: number
}

// GET /api/items/policies - data.list_stocking_policies()'s lookup rows.
export interface StockingPolicyInfo {
  policy_key: string
  label: string
  description: string
  sort_order: number
}

// GET /api/units - the governed unit lookup (items.unit / recipe_ingredients.unit
// are unit_keys into it). Returned in display order.
export type UnitDimension = 'count' | 'volume' | 'mass' | 'length' | 'other'
export interface UnitRow {
  unit_key: string
  label: string
  dimension: UnitDimension
  description: string | null
  sort_order: number
  // false = legacy unit (e.g. metric kg / L) kept only because existing rows use it.
  offered: boolean
}

// GET /api/items - data.list_items()'s DataFrame (v_item_onhand joined view).
export interface ItemListRow {
  item_id: number
  item_name: string
  item_type: ItemType
  unit: string
  min_quantity: number
  notes: string | null
  target_quantity: number | null
  stocking_policy: StockingPolicy | null
  min_hold: number | null
  quantity_onhand: number
  lot_count: number
  earliest_expiry: string | null
  locations: string | null
  below_minimum: number
  // only when the list is filtered to one container: what that container holds (v43 stow default)
  qty_in_container?: number | null
  // ...and when an audit (not abandoned) last verified it there (data.py v47, Work a Container's tick)
  last_verified_on?: string | null
}

// GET /api/items/{id} - items.* plus onhand summary and type-specific details.
export interface ItemDetail {
  item_id: number
  item_name: string
  item_type: ItemType
  unit: string
  min_quantity: number
  target_quantity: number | null
  stocking_policy: StockingPolicy
  annual_usage: number | null
  reorder_buffer: number
  min_hold: number | null
  notes: string | null
  created_at: string
  updated_at: string
  quantity_onhand: number
  lot_count: number
  earliest_expiry: string | null
  /** "We need more of this" was asked for (items.on_list_since); null = not on the shopping list. */
  on_list_since: string | null
  details: Record<string, unknown>
}

// GET /api/items/{id}/stock - v_stock_located rows for one item.
export interface StockLot {
  stock_id: number
  item_id: number
  quantity: number
  container_id: number | null
  container_name: string | null
  container_type: ContainerType | null
  location_name: string | null
  compartment_name: string | null
  expiry_date: string | null
  opened_on: string | null
  lot_note: string | null
}

export interface RestockRow {
  item_id: number
  item_name: string
  item_type: ItemType
  unit: string
  min_quantity: number
  target_quantity: number | null
  min_hold: number | null
  stocking_policy: StockingPolicy | null
  quantity_onhand: number
  reorder_qty: number
  reason: string
  /** 0 = no stock movement ever recorded (in the catalog, not yet located). */
  ever_stocked: number
  /** 1 = somebody asked for it (items.on_list_since, tracker #23). */
  on_list: number
  on_list_since: string | null
  /** Systems/devices this item is linked to (item_systems), alphabetical; [] = linked to none. */
  serves: string[]
}

/** GET /api/items/unlinked-parts - a part / spare unit linked to no system or device. */
export interface UnlinkedPart {
  item_id: number
  item_name: string
  item_type: ItemType
  unit: string
  quantity_onhand: number
  manufacturer: string | null
  part_number: string | null
  /** Free text (not a system name) saying what it fits - a hint, not a link. */
  fits_system: string | null
  notes: string | null
}

/** GET /api/items/unlinked-tool-accessories - a tool_accessory with no parent tool recorded. */
/** GET /api/items/{tool_id}/accessories - the accessories linked to a tool (tracker #76). */
export interface ToolAccessoryRow {
  item_id: number
  item_name: string
}

export interface UnlinkedToolAccessory {
  item_id: number
  item_name: string
  item_type: ItemType
  unit: string
  quantity_onhand: number
  spec: string | null
  notes: string | null
}

export type FitStatus = 'fits' | 'wrong_model' | 'not_applicable'
export type FitFlag = 'part_number_to_confirm' | 'model_not_on_device' | 'device_model_unknown'

/** One row of the Audit "Spares fit check" (GET /api/items/fit-review; schema v28). */
export interface FitReviewRow {
  item_id: number
  item_name: string
  item_type: ItemType
  unit: string
  /** Physical count - a wrong-model part still shows here, but never counts as a spare. */
  quantity_onhand: number
  manufacturer: string | null
  part_number: string | null
  fits_system: string | null
  notes: string | null
  /** null = unchecked (no row in item_fit_checks). */
  fit_status: FitStatus | null
  checked_on: string | null
  fit_note: string | null
  devices: { name: string; make_model: string }[]
  flags: FitFlag[]
  stock: { quantity: number; place: string }[]
}

export interface Compartment {
  compartment_id: number
  compartment_name: string
  sort_order: number | null
  location_count: number
}

export interface Location {
  location_id: number
  location_name: string
  compartment_id: number
  compartment_name: string
}

/** A container an item already has a row in - where a received purchase can go (tracker #47). */
export interface ReceiveTarget {
  container_id: number
  container_name: string
  location_name: string
  compartment_name: string
  /** On hand there now (0 for a "home" row). */
  quantity: number
  /** 1 = a zero-quantity row marks this container as where the item lives. */
  is_home: number
}

/** Everything the Receive form needs for one item (tracker #47). */
export interface ReceiveInfo {
  targets: ReceiveTarget[]
  shelf_life_days: number | null
  /** Today + the item's shelf life, when it has one: an editable default. */
  suggested_expiry: string | null
  /** Stock aboard with no expiry date, and where - offered a date when a dated batch arrives. */
  undated_quantity: number
  undated_places: string[]
}

export interface Container {
  container_id: number
  location_id: number
  location_name: string
  compartment_id: number
  compartment_name: string
  container_name: string
  container_type: ContainerType
  notes: string | null
  favorite: number
  stock_rows: number
}

export const AUDIT_STATUSES = ['in_progress', 'complete', 'abandoned'] as const
export type AuditStatus = (typeof AUDIT_STATUSES)[number]

export interface Audit {
  audit_id: number
  name: string
  scope: string
  status: AuditStatus
  started_on: string
  completed_on: string | null
  notes: string | null
  lines: number
  containers: number
}

export interface AuditProgress {
  lines: number
  containers: number
  items: number
  discrepancies: number
  total_containers: number
}

export interface AuditContainerRow {
  item_id: number
  item_name: string
  item_type: ItemType
  unit: string
  system_qty: number
  counted_qty: number | null
  verified_on: string | null
  note: string | null
}

export interface AuditUnverifiedRow {
  item_id: number
  item_name: string
  item_type: ItemType
  unit: string
  quantity_onhand: number
  stocking_policy: StockingPolicy | null
  min_hold: number | null
  target: number | null
}

// -- galley recipe book / provisioning --------------------------------------

export const RECIPE_METHODS = [
  'no-cook', 'induction hob', 'convection oven', 'air fryer', 'microwave',
  'pressure cooker', 'slow cooker', 'broiler', 'one-pot',
] as const

// GET /api/recipes - data.list_recipes()'s DataFrame (comma-joined tag strings).
export interface RecipeListRow {
  recipe_id: number
  title: string
  source: string | null
  servings: string | null
  main_ingredients: string | null
  methods: string | null
  tags: string | null
}

export interface RecipeTags {
  ingredient: string[]
  method: string[]
  tag: string[]
}

// GET /api/recipes/{id} - recipes.* plus the grouped tag lists.
export interface RecipeDetail {
  recipe_id: number
  title: string
  source: string | null
  servings: string | null
  body: string
  notes: string | null
  created_at: string
  updated_at: string
  tags: RecipeTags
}

// GET /api/recipes/{id}/parse-ingredients - ephemeral, nothing saved.
// Each candidate line gets up to 3 fuzzy-matched catalog suggestions.
export interface RecipeIngredientMatch {
  item_id: number
  item_name: string
  score?: number
  unit: string
  is_bulk: boolean
}
// GET /api/recipes/{id}/convert-text - a metric -> imperial PROPOSAL for the
// recipe body (nothing is saved; applying it is an ordinary body update).
export interface RecipeTextConversion {
  converted_body: string
  changes: { original: string; converted: string }[]
}

export interface RecipeIngredientCandidate {
  raw_text: string
  quantity: number | null
  unit: string | null
  // Set when the recipe was in metric and quantity/unit were converted to
  // imperial by the parser, e.g. "500 g" (the original amount). Display-only.
  converted_from?: string | null
  name_guess: string
  // How sure the parser is: only 'strong' is ever preselected; 'weak'/'none' are asked.
  match_class: 'strong' | 'weak' | 'none'
  // No amount and no clear catalog match: probably a heading or note (leave unticked).
  likely_junk: boolean
  // For an already-saved line: does its linked item look like what the line names?
  link_check: 'ok' | 'check' | null
  matches: RecipeIngredientMatch[]
  // Set when this raw_text was already reviewed & saved before - the
  // caller should default to linked_item_id/is_bulk (even when
  // linked_item_id is null, meaning "no catalog link" was a deliberate
  // choice), not matches[0], which is only ever a suggestion.
  reviewed: boolean
  linked_item_id: number | null
  is_bulk: boolean | null
}

// GET /api/recipes/{id}/ingredients - the saved, structured list.
export interface RecipeIngredient {
  recipe_ingredient_id: number
  recipe_id: number
  item_id: number | null
  raw_text: string
  quantity: number | null
  unit: string | null
  is_bulk: number
  link_check: 'ok' | 'check' | null
  // v35 (tracker #71): 1 = a person deliberately chose this link; link_check then reads 'ok'
  link_confirmed?: number
  sort_order: number | null
  item_name: string | null
  quantity_onhand: number | null
}

// POST /api/recipes/{id}/make
// `unit` is the ITEM's stock unit (what quantity/short_by are counted in);
// `recipe_unit` is the recipe line's own unit (null = none stated). Draws are
// not converted between the two.
export interface MakeRecipeResult {
  consumed: {
    item_id: number; item_name: string; unit: string; recipe_unit: string | null
    quantity: number; stock_id: number | null
  }[]
  shortfalls: {
    item_id: number; item_name: string; unit: string; recipe_unit: string | null
    short_by: number
  }[]
}

// GET /api/meal-plan - a pure working list (see data.list_meal_plan's docstring).
export interface MealPlanOverridePick {
  recipe_ingredient_id?: number
  item_id?: number
  quantity?: number
}
export interface MealPlanEntry {
  meal_plan_id: number
  recipe_id: number
  planned_for: string | null
  notes: string | null
  overrides: MealPlanOverridePick[] | null
  created_at: string
  title: string
  servings: string | null
  // The standing pantry-check recipe (every bulk item) - not a dish.
  is_standing: boolean
  /** The protein CHOSEN on this entry (swap or added extra); null = the recipe as written. */
  protein_item_id: number | null
  /** The recipe's own protein line, if it has one. */
  recipe_protein_item_id: number | null
  recipe_protein_name: string | null
}

// GET /api/meal-plan/shopping-list - direct-consumption ingredients summed
// across every active plan entry, shortfall-only (same shape as the task
// shopping list).
export interface MealPlanShoppingRow {
  item_id: number
  item_name: string
  unit: string
  quantity_required: number
  quantity_onhand: number
  shortfall: number
}

// GET /api/provisioning/plan
export type ProvisionMode = 'undecided' | 'baseline' | 'recipe_only'

export interface ProvisioningRow {
  item_id: number
  item_name: string
  unit: string
  category: string | null
  stowage_state: string | null
  shelf_life_days: number | null
  quantity_onhand: number
  earliest_expiry: string | null
  provision_qty: number | null
  provision_mode: ProvisionMode
  stocking_policy: string
  target_qty: number
  buy_qty: number
}

// GET /api/provisioning/food-cart - ProvisioningRow + the meal-plan merge.
export interface FoodCartRow extends ProvisioningRow {
  meal_plan_qty: number
  // true when a planned recipe needs it but only as "do we have any?" (a bulk
  // item, or recipe/item units that cannot be compared) - buy_qty is then 1
  // when none is on hand, never a recipe measure.
  have_only: boolean
  // "We need more of this" was asked for (pantry check / cart add box); stays until received.
  on_list: boolean
  on_list_since: string | null
  expiring_soon: string | null
}

// GET /api/items/food-expiring, /api/items/stock-expiring
export interface FoodExpiringRow {
  stock_id: number
  item_id: number
  item_name: string
  item_type?: ItemType
  quantity: number
  unit: string
  expiry_date: string
  compartment_name: string | null
  location_name: string | null
  container_name: string | null
  days_left: number
}

// -- telemetry (v9: InfluxDB-backed engine/genset hours + tank levels) ------

// GET /api/telemetry/snapshot - every telemetry_cache row, keyed by metric.
export interface TelemetryCacheEntry {
  metric: string
  value: number | null
  unit: string
  source: string
  observed_at: string | null
  synced_at: string
}

export type TelemetrySnapshot = Record<string, TelemetryCacheEntry>

// GET /api/telemetry/{meter}/status
export type TelemetrySource = 'live' | 'influx' | 'estimate' | 'none'
export interface MeterStatus {
  source: TelemetrySource
  hours: number | null
  observed_at: string | null
}

// -- cockpit/deck GUI --------------------------------------------------------
// See the "Cockpit App - Scope & Architecture" doc + the cockpit-deck-gui
// project memory. Backend touchpoints: backend/routers/cockpit.py.

// GET /api/cockpit/watch-handover/wx - the newest routing briefing's weather summary
// (backend/routers/cockpit.py v3). Every briefing field may be null (routing layout changed,
// half-written file); status 'PENDING' means nothing usable was found and `reason` says why.
export interface WatchHandoverWx {
  status: 'PENDING' | 'ok'
  reason: string
  briefing: {
    stem: string
    generated_at: string
    age_hours?: number
    old?: boolean
    title?: string | null
    generated_text?: string | null
    tropical?: string | null
    wind?: string | null
    seas?: string | null
    pressure?: string | null
    source?: string | null
  } | null
}

// GET /api/tasks/checklists (data.list_checklists) - the top-level checklists with step
// counts; ~20 KB, which is why the cockpit uses it instead of the ~870 KB GET /api/tasks.
export interface ChecklistSummary {
  task_id: number
  task_name: string
  system: string
  last_completed_date: string | null
  retired_at: string | null
  step_count: number
  open_step_count: number
}

// GET / POST /api/cockpit/sail-plan - SignalK sails.activeSet (backend/sail_plan.py, Ship's Automation HB-09)
export type MainState = 'down' | 'full' | 'reef1' | 'reef2' | 'reef3'
export type Headsail = 'none' | 'genoa' | 'staysail'
export type HeadsailState = 'full' | 'reef1' | 'reef2' | 'reef3'
export interface SailSet {
  main: MainState
  headsail: Headsail
  headsailState: HeadsailState | null
  wingOnWing: boolean
  label: string
}
/** v39: 'log' = what the ship's log says (SignalK down / not set up) - then only the label is known. */
export interface SailPlanNow {
  current: (Partial<SailSet> & { label: string }) | null; since: string | null
  from: 'signalk' | 'history' | 'log' | null
  /** after a save: the log entry, and what happened to SignalK ('updated' / 'not set up…' / 'not answering…') */
  entry_ref?: string; signalk?: string
}
/** GET /api/logbook/watchkeeper (v39) */
export interface Watchkeeper { watchkeeper: { on_watch: string; since: string; entry_id: number } | null; crew: string[] }
/** GET /api/logbook/propulsion (v39): the sail set and engine state as logged by hand */
export interface Propulsion {
  sail_set: string | null; sail_since: string | null; engine_on: boolean; engine_since: string | null
  /** the hour meter: mx-inv's best figure now (reading + projection) and the last real reading */
  engine_hours_now: number | null; engine_hours_last: number | null
}
export interface SailPlanTapBody {
  main: MainState
  headsail: Headsail
  headsail_state: HeadsailState | null
  wing_on_wing: boolean
  minutes_ago: number
  author?: string | null
}

// The logbook (schema v37) - backend/routers/logbook.py
export interface LogStamp {
  lat: number | null; lon: number | null; sog_kn: number | null; cog_deg: number | null; mode: string | null
  wind_apparent_kn: number | null; baro_hpa: number | null; sail_set: string | null
  /** v39: signed degrees, + starboard / - port */
  wind_apparent_deg?: number | null
  /** v39: the hour meter, read at Engine on / off */
  engine_hours?: number | null
  card?: Record<string, unknown>
}
export interface LogEntry {
  entry_id: number; entry_ref: string
  /** status = the automatic deck log (backend/deck_log.py) */
  kind: 'failure' | 'observation' | 'incident' | 'watch' | 'event' | 'status' | 'departure' | 'arrival' | 'sail'
    | 'engine'
  occurred_at: string; recorded_at: string; system: string | null; severity: string | null
  /** engine / deck-log entries: 'handover' or 'log' (D-114) - 'log' skips the watch handover */
  record?: string | null
  /** departure / arrival (schema v38): the port of this end, and (departure) where she is bound */
  port?: string | null; bound_for?: string | null
  /** watch entries / departures (v39): who TOOK the watch */
  on_watch?: string | null
  title: string; body: string | null; author: string | null; source: string; simulated: boolean
  follow_on_task_id: number | null; status: string | null
  statuses?: { update_id: number; at: string; status: string; note: string | null; author: string | null }[]
  stamp?: LogStamp | null
}
/** A passage = one leg, a departure to the next arrival (schema v38, the owner 10-05) - derived, GET /api/logbook/passages. */
export interface Passage {
  passage_id: number; passage_ref: string
  from_port: string; bound_for: string; departed_at: string
  arrival_id: number | null; to_port: string | null; arrived_at: string | null; underway: boolean
  hours: number; distance_nm: number | null; fixes: number
  failures: number; incidents: number; observations: number; alarms: number; watches: number
  /** v39: last minus first hour-meter reading logged in the leg */
  engine_hours_run?: number | null
}
export interface PassageEndBody {
  port: string; bound_for?: string | null; body?: string | null; author?: string | null
  /** departure only: who takes the first watch */
  first_watch?: string | null
  source: 'cockpit' | 'desktop'; minutes_ago: number
}
export interface LogEntryBody {
  kind: 'failure' | 'observation' | 'incident'
  title: string; body?: string | null; system?: string | null; severity?: string | null; author?: string | null
  source: 'cockpit' | 'desktop'; minutes_ago: number
  follow_on?: { task_name: string; urgency: string; description?: string | null } | null
}
/** WF-807: one row of the notification journal (GET /api/logbook/notifications). */
export interface NotificationEntry {
  entry_id: number; entry_ref: string; occurred_at: string; title: string
  severity: string | null; simulated: boolean; record: string | null
  event_kind: string | null; origin: string | null; wf_id: string | null
  n2k_path: string | null; n2k_state: string | null; device_message: string | null; n2k_source: string | null
  lat: number | null; lon: number | null; mode: string | null; sog_kn: number | null
}

export interface LogStatusChange {
  update_id: number; entry_id: number; entry_ref: string; at: string; status: string; previous: string
  note: string | null; author: string | null; title: string; system: string | null
}
export interface ThisWatch {
  since: string; since_last_watch_entry: boolean; entries: LogEntry[]; status_changes: LogStatusChange[]
}

// GET /api/tasks/completions - the completion audit trail (schema v26), newest first.
/** The Log tab's filter choices (GET /api/tasks/completions/facets). */
export interface CompletionFacets {
  /** Years that have entries (by date logged), newest first. */
  years: number[]
  systems: { system: string; count: number; devices: { device: string; count: number }[] }[]
}

export interface CompletionEntry {
  completion_id: number
  task_id: number | null
  task_name: string
  system: string
  project_name: string | null
  /** The date the user logged (can be back-dated). */
  completed_on: string
  /** When it was actually recorded (UTC ISO). */
  recorded_at: string
  /** The LOCAL day it was recorded - what the log groups by. */
  recorded_on_local: string
  hours_at_completion: number | null
  task_exists: boolean
  backdated: boolean
  interval_type: string | null
  period: string | null
  // --- maintenance history fields (schema v26, second half) ---
  /** schedule / checklist / project, captured automatically. */
  source: string | null
  was_critical: number | null
  /** The date it was measured against (deferral included); null = no schedule to be late against. */
  due_on: string | null
  /** Positive = late, negative = early, 0 = on time, null = not applicable. */
  days_past_due: number | null
  /** Run-hour tasks only. */
  hours_past_due: number | null
  deferred_units: number | null
  engine_hours: number | null
  genset_hours: number | null
  /** Free text for THIS completion. */
  notes: string | null
  /** Set once the entry is voided (append-only correction); the row stays. */
  voided_at: string | null
  void_reason: string | null
  parts: CompletionPart[]
  // --- schema v31/v33: who, what it cost, and the invoice it is filed under ---
  performed_by: string | null
  vendor: string | null
  /** This entry's OWN cost. Never set together with document_id. */
  cost: number | null
  document_id: number | null
  document_vendor: string | null
  document_number: string | null
  // v34
  outcome: CompletionOutcome | null
  /** v32 columns: what sort of event (null = plain service) and a path to its photo / PDF. */
  event_kind: EventKind | null
  evidence_path: string | null
  /** Follow-on tasks this entry raised (one -> many). */
  follow_ons: { task_id: number; task_name: string; system: string; done: boolean; retired: boolean }[]
}

/** An invoice / receipt on file (schema v33) - the spine of a piece of paper, total stored ONCE. */
export interface InvoiceDocument {
  document_id: number
  vendor: string
  doc_number: string | null
  doc_date: string | null
  period_start: string | null
  period_end: string | null
  total: number | null
  file_path: string | null
  project_id: number | null
  project_name: string | null
  expense_class: string | null
  notes: string | null
  created_at: string
  /** The date it counts toward: doc_date, else period end, else period start. */
  doc_day: string | null
  /** Live history entries filed under it. Zero is legitimate (money out, nothing received). */
  completion_count: number
}

export interface InvoiceDocumentDetail extends InvoiceDocument {
  completions: {
    completion_id: number; task_name: string; system: string; completed_on: string
    source: string | null; voided_at: string | null
  }[]
}

/** GET /api/documents/year/{year} - invoices ON FILE per expense class. Never a total spend. */
export interface InvoiceYearView {
  year: number
  count: number
  untotalled: number
  on_file: number
  classes: {
    expense_class: string; count: number; subtotal: number; untotalled: number
    documents: InvoiceDocument[]
  }[]
}

// One spare/supply used in a completion - name and part number are SNAPSHOTS.
export interface CompletionPart {
  item_id: number | null
  item_name: string
  part_number: string | null
  quantity: number
  unit: string
}

/** A history entry's kind (data.COMPLETION_EVENT_KINDS); null reads as plain service. */
export type EventKind = 'service' | 'grounding' | 'survey' | 'haul_out' | 'modification' | 'incident'
