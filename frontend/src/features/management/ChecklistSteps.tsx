/**
 * Purpose: A checklist's runnable body - its steps AND the tasks linked into it, in one ordered
 *   list you tick through, reorder, group, add to and reset.
 * Version: v10 (2026-10-04) - v10: boxes are disabled while a step tick is in flight (a fast double
 *   tap could fire a second complete); a failed step tick / un-tick shows its error (it vanished
 *   silently - a Wi-Fi drop on the cockpit looked like a missed tap); in readOnly (cockpit) Reset
 *   asks before clearing the run. v9 (2026-09-23) - v9: readOnly prop (tick-only; the cockpit tablet had reorder/edit/delete/add-step controls it should not). v8 (2026-09-23) - v8 (tracker #76, no-detour): the consumption prompt gets
 *   "＋ Used something else" (UsedSomethingElse, exported - TaskCardDetail's Complete panel uses
 *   it too): pick ANY catalog item (or create it inline) with a qty, optionally "remember it for
 *   next time" (PUT /tasks/{id}/items/{item}); group pickers read "＋ New group…".
 *   v7 (2026-09-23) - v7 (tracker #74, "clickable to detail"): a linked task's system chip
 *   and name are two targets (system opens the device); an included checklist's caret expands and
 *   its name opens it; item names on the consumption prompt open the item (box ticks); task names
 *   in the add / link-editor panels open the task.
 *   v6 (2026-09-23) - v6 (tracker #73): a line's NAME opens it (step detail, or the
 *   linked task's master record) when the host passes onOpenStep; only the checkbox ticks. The
 *   name used to be inside the checkbox's label, so tapping it ticked the line.
 *   v5 (2026-09-22) - v5 (tracker #69): the add-existing-task buttons read "Add - keep
 *   its own schedule" (link) / "Add - only with this checklist" (move), matching the task-side
 *   wording in TaskReferencedBy. v4 (tracker #64): ticking a linked task no longer silently draws
 *   zero stock - LinkConsumptionPrompt opens under the row and asks explicitly what was used
 *   (same shape as TaskCardDetail's own Complete panel) before the tick actually fires; a task
 *   with nothing listed still ticks straight away, nothing changed there. v3 was 2026-09-20:
 *   linked tasks sit INLINE in the step order and group and are ticked per run (schema v27,
 *   tracker #48); v2 added the one-box link search. Also the top-level "🖨️ Print" link to the
 *   print-on-demand sheet (tracker #49, backend/print_sheet.py). Optional `onOpenStep` adds a
 *   "Details" button on every line (tracker #28) - the host opens StepDetail or the full record.
 * Scope: PRODUCTION - mx-inv frontend, management feature.
 * Architecture: Rendered by TaskDetail (checklist records), TaskCardDetail (Schedule),
 *   RunChecklistView and CockpitChecklists. Reads GET /api/tasks/{id}/checklist/items (steps +
 *   links in one order). A STEP ticks via complete/clear-completion on itself. A LINK is a
 *   task_references(kind='task') row pointing at a master task that also lives elsewhere: ticking
 *   it records a real completion of the master (noted with this checklist) and un-ticking voids
 *   that completion, so the master's schedule is never blanked; "done" is per run, and Reset
 *   forgets the run's ticks (the completions stay in history). Links and steps share one
 *   sort_order numbering. Included checklists (a link to another checklist) stay a separate
 *   expandable block above the list.
 */
import { useEffect, useRef, useState } from 'react'
import type { ChecklistItem } from '../../api/types'
import { useChecklistGroups, useChecklistItems, useLinkableTasks, useTaskReferences } from './useTasks'
import { useTaskItemsDemand } from '../schedule/useTaskDetail'
import {
  useAddChecklistStep,
  useAddTaskReference,
  useCompleteStep,
  useDeleteTask,
  useDeleteTaskReference,
  useImportTaskAsStep,
  useResetChecklist,
  useTickChecklistLink,
  useUncompleteStep,
  useUntickChecklistLink,
  useUpdateTask,
  useUpdateTaskReference,
  useSetTaskItem,
} from './mutations'
import { StuffPick } from '../warehouse/ItemPick'
import { moved } from './reorder'
import { GroupPicker } from './GroupPicker'
import { useConfirm } from '../../components/ConfirmDialog'
import { CheckRow, RecordLink, SystemTaskLabel } from '../../components/RecordLink'

const TYPE_GLYPH: Record<string, string> = {
  part: '⚙️', spare_unit: '🔁', supply: '🧴', tool: '🔧', tool_accessory: '🪛', food: '🥫',
}

const itemKey = (i: ChecklistItem) => (i.item_kind === 'link' ? `link:${i.ref_id}` : `step:${i.task_id}`)

export function ChecklistSteps({
  checklistId, ancestry = [], onOpenStep, readOnly = false,
}: {
  checklistId: number
  ancestry?: number[]
  /** Tick-only (the cockpit tablet): no reorder / edit / delete / add-step / import controls. */
  readOnly?: boolean
  /** When given, every line gets a "Details" button that opens that task's Details screen /
   *  full record (a linked task opens its master task). The host decides what opens. */
  onOpenStep?: (taskId: number) => void
}) {
  // ancestry is the chain of checklist ids already open above this one in
  // the current "includes another checklist" nesting - passed down so
  // IncludedChecklists can refuse to re-expand a checklist that's already
  // an ancestor of itself (a reference cycle) instead of recursing forever.
  const path = ancestry.includes(checklistId) ? ancestry : [...ancestry, checklistId]
  const { data: items, isLoading } = useChecklistItems(checklistId)
  const addStep = useAddChecklistStep()
  const completeStep = useCompleteStep()
  const uncompleteStep = useUncompleteStep()
  const tickLink = useTickChecklistLink()
  const untickLink = useUntickChecklistLink()
  const deleteStep = useDeleteTask()
  const deleteRef = useDeleteTaskReference()
  const confirm = useConfirm()
  const resetChecklist = useResetChecklist()
  const updateTask = useUpdateTask()
  const updateRef = useUpdateTaskReference()
  const [newStep, setNewStep] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  // A linked task's checkbox does not tick straight away (tracker #64) - if it has any listed
  // spare, LinkConsumptionPrompt opens under the row first and asks explicitly what was used;
  // ticking only fires once that is answered (or immediately, if the task lists nothing).
  const [confirmingRefId, setConfirmingRefId] = useState<number | null>(null)

  if (isLoading) return <p className="mgmt-status">Loading steps…</p>
  if (!items) return null

  const openCount = items.filter((s) => !s.done).length

  // Swap with the neighbour, then renumber 1..N across steps AND links (they share one order);
  // only the lines whose number actually changed are written.
  const move = (index: number, direction: 'up' | 'down') => {
    const next = moved(items, index, direction)
    next.forEach((item, i) => {
      const sort_order = i + 1
      if (item.sort_order === sort_order) return
      if (item.item_kind === 'link') updateRef.mutate({ refId: item.ref_id!, fields: { sort_order } })
      else updateTask.mutate({ taskId: item.task_id, fields: { sort_order } })
    })
  }

  // v10: a STEP tick that failed (Wi-Fi drop on the cockpit tablet) used to vanish silently.
  const tickError = tickLink.error ?? untickLink.error ?? completeStep.error ?? uncompleteStep.error

  return (
    <div className="checklist-steps">
      <div className="checklist-steps-header">
        <h3>Steps ({openCount} open / {items.length})</h3>
        {ancestry.length === 0 && (
          // Print on demand (tracker #49): the server builds a one-page sheet; it opens in a new
          // tab and the browser's Print / Save as PDF does the rest.
          <a
            className="checklist-print-link" href={`/api/tasks/${checklistId}/checklist/print`}
            target="_blank" rel="noopener noreferrer"
            title="Open a one-page printable sheet of this checklist (blank tick boxes, for laminating)"
          >
            🖨️ Print
          </a>
        )}
        <button
          type="button"
          onClick={async () => {
            // v10: on the tick-only cockpit tablet a stray wet tap cleared the whole run - ask first.
            if (readOnly && !(await confirm({
              title: 'Clear every tick on this checklist?',
              message: 'Nothing is logged - the run just starts again from the top.',
              confirmLabel: 'Clear the ticks',
              cancelLabel: 'Keep them',
            }))) return
            resetChecklist.mutate(checklistId)
          }}
          disabled={resetChecklist.isPending}
        >
          ↺ Reset checklist
        </button>
      </div>
      <IncludedChecklists checklistId={checklistId} ancestry={path} onOpenStep={onOpenStep} readOnly={readOnly} />
      {tickError && (
        <p className="mgmt-status mgmt-status--error">
          {(tickError as { detail?: { message?: string } }).detail?.message ?? (tickError as Error).message}
        </p>
      )}
      <ul className="checklist-steps-list">
        {items.map((item, index) => {
          const key = itemKey(item)
          const isLink = item.item_kind === 'link'
          return (
            <li key={key} className={item.done ? 'step-done' : undefined}>
              {editingKey === key ? (
                isLink ? (
                  <LinkEditor checklistId={checklistId} item={item} onDone={() => setEditingKey(null)} />
                ) : (
                  <StepEditor checklistId={checklistId} step={item} onDone={() => setEditingKey(null)} />
                )
              ) : (
                <div className="step-row">
                  {!readOnly && <span className="step-reorder">
                    <button type="button" title="Move up" disabled={index === 0} onClick={() => move(index, 'up')}>
                      ▲
                    </button>
                    <button
                      type="button" title="Move down" disabled={index === items.length - 1}
                      onClick={() => move(index, 'down')}
                    >
                      ▼
                    </button>
                  </span>}
                  <input
                    type="checkbox"
                    aria-label={`Done: ${item.task_name}`}
                    checked={!!item.done}
                    disabled={tickLink.isPending || untickLink.isPending || completeStep.isPending || uncompleteStep.isPending}
                    onChange={() => {
                      if (isLink) {
                        if (item.done) untickLink.mutate(item.ref_id!)
                        else setConfirmingRefId(item.ref_id!)
                      } else if (item.done) uncompleteStep.mutate(item.task_id)
                      else completeStep.mutate(item.task_id)
                    }}
                  />
                  {/* Tracker #73: the name OPENS the step / linked task; only the box ticks it.
                      (It used to sit inside the checkbox's <label>, so tapping the name ticked it.) */}
                  {/* Tracker #74: a linked task's system chip and name are two targets - the
                      chip opens the device, the name opens the task (never both in one button). */}
                  {isLink ? (
                    <span className="step-title">
                      <SystemTaskLabel
                        system={item.system} taskId={item.task_id} taskName={item.task_name}
                        onOpenTask={onOpenStep ? () => onOpenStep(item.task_id) : undefined}
                      />
                    </span>
                  ) : onOpenStep ? (
                    <button
                      type="button" className="step-title step-title--open"
                      title="Open this step"
                      onClick={() => onOpenStep(item.task_id)}
                    >
                      {item.task_name}
                    </button>
                  ) : (
                    <span className="step-title">{item.task_name}</span>
                  )}
                  {isLink && (
                    <span
                      className="step-linked-badge"
                      title="A task that also lives elsewhere - one master record. Ticking it here records a real completion of it (noted with this checklist); un-ticking undoes that."
                    >
                      🔗 linked{item.last_completed_date ? ` · last done ${item.last_completed_date}` : ''}
                    </span>
                  )}
                  {item.checklist_group && <span className="step-group">{item.checklist_group}</span>}
                  {onOpenStep && (
                    <button
                      type="button" className="step-open-details"
                      title="Details: how to do it, what you need, where it is stowed"
                      onClick={() => onOpenStep(item.task_id)}
                    >
                      ℹ️ Details
                    </button>
                  )}
                  {!readOnly && <>
                  <button
                    type="button" className="step-edit"
                    title={isLink ? 'Set the sub-list group for this linked task' : 'Edit this step'}
                    onClick={() => setEditingKey(key)}
                  >
                    ✏️
                  </button>
                  <button
                    type="button" className="step-delete"
                    title={isLink ? 'Take this task out of the checklist (the task itself stays)' : 'Delete step'}
                    onClick={async () => {
                      if (isLink) {
                        if (await confirm({
                          title: `Take "${item.task_name}" out of this checklist?`,
                          message: 'Only the link goes; the task itself, and its history, are not touched.',
                          confirmLabel: 'Take it out',
                          cancelLabel: 'Keep it here',
                        })) deleteRef.mutate(item.ref_id!)
                      } else if (await confirm({
                        title: `Delete step "${item.task_name}"?`,
                        message: 'This removes the step from the checklist for good.',
                        confirmLabel: 'Delete step',
                      })) deleteStep.mutate(item.task_id)
                    }}
                  >
                    ✕
                  </button>
                  </>}
                </div>
              )}
              {editingKey !== key && (
                <p className="step-detail">
                  {item.caution_notes || item.task_description
                    ? (item.caution_notes || item.task_description)
                    : <em>{isLink
                      ? '(no how-to detail - open the task itself to add some)'
                      : readOnly ? '(no how-to detail yet)' : '(no how-to detail yet - click ✏️ to add some)'}</em>}
                </p>
              )}
              {isLink && confirmingRefId === item.ref_id && (
                <LinkConsumptionPrompt
                  taskId={item.task_id}
                  onConfirm={(consumption) => {
                    tickLink.mutate({ refId: item.ref_id!, consumption })
                    setConfirmingRefId(null)
                  }}
                  onCancel={() => setConfirmingRefId(null)}
                />
              )}
            </li>
          )
        })}
      </ul>
      {!readOnly && <>
      <form
        className="add-step-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!newStep.trim()) return
          addStep.mutate(
            { checklistId, step_name: newStep.trim() },
            { onSuccess: () => setNewStep('') },
          )
        }}
      >
        <input
          type="text"
          placeholder="New step name"
          value={newStep}
          onChange={(e) => setNewStep(e.target.value)}
        />
        <button type="submit" disabled={addStep.isPending || !newStep.trim()}>
          + Add step
        </button>
      </form>
      <ImportExistingTask checklistId={checklistId} />
      </>}
    </div>
  )
}

// Tracker #64, the owner 2026-09-22: ticking a task linked into a checklist used to always draw zero
// stock, silently - even for a task with a listed spare, no chance to say otherwise. Opens under
// the row the moment its checkbox is checked; a task with nothing listed confirms itself
// immediately (nothing to ask), otherwise it is the same "tick what you used up" shape as the
// Schedule card's own Complete panel (TaskCardDetail.tsx) - nothing pre-checked, quantity
// defaults to what the task calls for.
function LinkConsumptionPrompt({
  taskId, onConfirm, onCancel,
}: {
  taskId: number
  onConfirm: (consumption?: { item_id: number; quantity: number }[]) => void
  onCancel: () => void
}) {
  const { data: items, isLoading } = useTaskItemsDemand(taskId, true)
  const [picked, setPicked] = useState<Record<number, boolean>>({})
  const [qty, setQty] = useState<Record<number, number>>({})
  const [extras, setExtras] = useState<ExtraUsed[]>([])
  const setTaskItem = useSetTaskItem()
  const confirmedEmpty = useRef(false)

  // Nothing listed - nothing to ask, confirm once demand has loaded. An effect, not a call
  // during render: calling onConfirm (which updates ChecklistSteps' state) while this
  // component is still rendering is exactly the setState-during-render React warns about.
  useEffect(() => {
    if (items && items.length === 0 && !confirmedEmpty.current) {
      confirmedEmpty.current = true
      onConfirm(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  if (isLoading) return <p className="mgmt-status">Checking what this needs…</p>
  if (!items || items.length === 0) return null

  return (
    <div className="task-items-checklist link-consumption-prompt">
      <strong>Items — tick what you used up</strong>
      {items.map((it) => (
        <CheckRow
          key={it.item_id}
          className="task-item-row"
          checked={!!picked[it.item_id]}
          onToggle={(b) => setPicked((s) => ({ ...s, [it.item_id]: b }))}
          to={{ kind: 'item', id: it.item_id }}
          name={<>{TYPE_GLYPH[it.item_type] ?? '•'} {it.item_name}</>}
        >
          <span className="task-item-name">
            · have {it.quantity_onhand} {it.unit}
            {it.shortfall > 0 && <span className="task-item-short"> ⚠️ SHORT</span>}
          </span>
          <input
            type="number" min={0} step={1}
            className="task-item-qty"
            value={qty[it.item_id] ?? it.quantity_required}
            disabled={!picked[it.item_id]}
            onChange={(e) => setQty((s) => ({ ...s, [it.item_id]: Number(e.target.value) }))}
          />
        </CheckRow>
      ))}
      <UsedSomethingElse
        rows={extras}
        onChange={setExtras}
        listedIds={new Set(items.map((it) => it.item_id))}
      />
      <div className="link-consumption-actions">
        <button
          type="button"
          onClick={() => {
            rememberExtras(taskId, extras, setTaskItem.mutate)
            onConfirm([
              ...items
                .filter((it) => picked[it.item_id])
                .map((it) => ({ item_id: it.item_id, quantity: qty[it.item_id] ?? it.quantity_required })),
              ...extraConsumption(extras),
            ])
          }}
        >
          ✓ Tick it done
        </button>
        <button type="button" onClick={onCancel}>✕ Cancel</button>
      </div>
    </div>
  )
}

// Tracker #76 (no-detour, the owner 2026-09-23): the "tick what you used up" list only knew the task's
// own listed items, so using anything else meant backing out to list it on the task first.
// A line per extra item used - any catalog item, or one created right here - with a quantity and an
// optional (default off) "remember it for next time" that lists it on the task. Shared by the
// checklist consumption prompt above and the Schedule card's Complete panel (TaskCardDetail).
export interface ExtraUsed {
  itemId: number
  itemName: string
  unit: string | null
  quantity: number
  remember: boolean
}

/** The extras as completion `consumption` lines (the backend accepts any item_id). */
export function extraConsumption(rows: ExtraUsed[]): { item_id: number; quantity: number }[] {
  return rows.filter((r) => r.quantity > 0).map((r) => ({ item_id: r.itemId, quantity: r.quantity }))
}

/** List the "remember it" extras on the task (PUT /tasks/{id}/items/{item}) - fire and forget. */
export function rememberExtras(
  taskId: number,
  rows: ExtraUsed[],
  setTaskItem: (vars: { taskId: number; itemId: number; quantity_required: number; amount_note: string | null }) => void,
) {
  rows.filter((r) => r.remember).forEach((r) => setTaskItem({
    taskId, itemId: r.itemId, quantity_required: r.quantity > 0 ? r.quantity : 1, amount_note: null,
  }))
}

export function UsedSomethingElse({
  rows, onChange, listedIds,
}: { rows: ExtraUsed[]; onChange: (rows: ExtraUsed[]) => void; listedIds?: Set<number> }) {
  const [picking, setPicking] = useState(false)
  const exclude = new Set([...(listedIds ?? []), ...rows.map((r) => r.itemId)])
  const patch = (i: number, p: Partial<ExtraUsed>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)))

  return (
    <div className="used-something-else">
      {rows.map((r, i) => (
        <div key={r.itemId} className="task-item-row">
          <RecordLink to={{ kind: 'item', id: r.itemId }}>{r.itemName}</RecordLink>
          <input
            type="number" min={0} step={1}
            className="task-item-qty"
            value={r.quantity}
            onChange={(e) => patch(i, { quantity: Number(e.target.value) })}
          />
          {r.unit && <span className="task-item-name">{r.unit}</span>}
          <label className="hint">
            <input type="checkbox" checked={r.remember} onChange={(e) => patch(i, { remember: e.target.checked })} />
            {' '}remember it for next time
          </label>
          <button type="button" title="Not used after all" onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      {picking ? (
        <div className="task-item-row">
          <StuffPick
            value={null}
            excludeIds={exclude}
            placeholder="Type what you used…"
            onPick={(p) => {
              if (p) onChange([...rows, { itemId: p.itemId, itemName: p.itemName, unit: p.unit, quantity: 1, remember: false }])
              setPicking(false)
            }}
          />
          <button type="button" onClick={() => setPicking(false)}>✕</button>
        </div>
      ) : (
        <button type="button" className="used-something-else-add" onClick={() => setPicking(true)}>
          ＋ Used something else
        </button>
      )}
    </div>
  )
}

// Renders a checklist-kind reference (added via TaskReferences' generic
// "+ Add reference" form) as an expandable, runnable sub-checklist inline
// - the "include a checklist inside a checklist rather than copying all
// its steps" ask (the owner, 2026-09-16). Ticking a step here IS the included
// checklist's own step - not a copy - so it stays in sync everywhere it's
// referenced from.
function IncludedChecklists({
  checklistId, ancestry, onOpenStep, readOnly,
}: { checklistId: number; ancestry: number[]; onOpenStep?: (taskId: number) => void; readOnly: boolean }) {
  const { data: refs } = useTaskReferences(checklistId)
  const [openId, setOpenId] = useState<number | null>(null)

  const included = (refs ?? []).filter(
    (r) => r.kind === 'task' && r.ref_task_kind === 'checklist' && r.ref_task_id !== checklistId,
  )
  if (included.length === 0) return null

  return (
    <div className="included-checklists">
      <h4>Includes other checklists</h4>
      <ul className="included-checklists-list">
        {included.map((r) => {
          // A cycle (this checklist is already open somewhere above the
          // current one in the chain, e.g. A includes B includes A) -
          // refuse to expand it again rather than recursing forever.
          const isCycle = ancestry.includes(r.ref_task_id!)
          return (
            <li key={r.ref_id}>
              {isCycle ? (
                <span
                  className="included-checklist-cycle"
                  title="Already open earlier in this chain - not expanded again to avoid a loop"
                >
                  ⚠️ {r.ref_task_name} (already open above - not re-expanded)
                </span>
              ) : (
                <>
                  {/* Tracker #74: the caret expands it here; the name opens the checklist itself. */}
                  <button
                    type="button"
                    className="included-checklist-toggle"
                    title={openId === r.ref_task_id ? 'Collapse' : 'Expand here'}
                    aria-expanded={openId === r.ref_task_id}
                    onClick={() => setOpenId((id) => (id === r.ref_task_id ? null : r.ref_task_id))}
                  >
                    {openId === r.ref_task_id ? '▾' : '▸'}
                  </button>{' '}
                  <RecordLink to={r.ref_task_id ? { kind: 'task', id: r.ref_task_id } : null}>
                    {r.ref_task_name}
                  </RecordLink>
                  {openId === r.ref_task_id && (
                    <div className="included-checklist-body">
                      <ChecklistSteps checklistId={r.ref_task_id!} ancestry={ancestry} onOpenStep={onOpenStep} readOnly={readOnly} />
                    </div>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ImportExistingTask({ checklistId }: { checklistId: number }) {
  // One search box across every task (tracker #48) - not "pick a system, then a task" - and it
  // includes tasks that already live as a step of another checklist, which can be LINKED here
  // (Move is offered only for standalone tasks, since moving would pull a step out of its checklist).
  const { data: linkable } = useLinkableTasks(checklistId)
  const importTask = useImportTaskAsStep()
  const addRef = useAddTaskReference()
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<number | null>(null)

  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (linkable ?? []).filter((t) => {
    const hay = `${t.system} ${t.task_name}`.toLowerCase()
    return words.length > 0 && words.every((w) => hay.includes(w))
  })
  const shown = matches.slice(0, 12)
  const target = (linkable ?? []).find((t) => t.task_id === picked) ?? null
  const done = () => { setPicked(null); setSearch('') }
  const busy = importTask.isPending || addRef.isPending
  const error = addRef.error ?? importTask.error

  return (
    <div className="import-existing-task">
      <p className="step-editor-hint">
        Add an existing task as a step here. Search by name or system, then say whether it
        keeps its own schedule too:
      </p>
      <input
        type="text" placeholder="🔍 e.g. generator pre-start" value={search}
        onChange={(e) => { setSearch(e.target.value); setPicked(null) }}
      />
      {words.length > 0 && (
        <ul className="link-search-results">
          {shown.map((t) => (
            <li key={t.task_id}>
              <button
                type="button"
                className={t.task_id === picked ? 'link-search-hit link-search-hit--picked' : 'link-search-hit'}
                onClick={() => setPicked(t.task_id)}
              >
                <code>{t.system}</code> — {t.task_name}
                {t.parent_name ? <em> · already a step of {t.parent_name}</em> : null}
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="mgmt-empty">No matching task (or it is already linked here).</li>}
          {matches.length > shown.length && (
            <li className="mgmt-status">Showing {shown.length} of {matches.length} - keep typing to narrow.</li>
          )}
        </ul>
      )}
      {target && (
        <div className="add-tasks-control">
          <strong><RecordLink to={{ kind: 'task', id: target.task_id }}>{target.task_name}</RecordLink></strong>
          <button
            type="button"
            title="Links to the same master task - ticking it here records a real completion of it, and it keeps its own schedule"
            disabled={busy}
            onClick={() => addRef.mutate(
              { taskId: checklistId, kind: 'task', label: target.task_name, ref_task_id: target.task_id },
              { onSuccess: done },
            )}
          >
            Add - keep its own schedule
          </button>
          {target.parent_task_id === null && (
            <button
              type="button"
              title="Reparents the task - it stops appearing on its own periodic schedule"
              disabled={busy}
              onClick={() => importTask.mutate({ checklistId, task_id: target.task_id }, { onSuccess: done })}
            >
              Add - only with this checklist
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="mgmt-status mgmt-status--error">
          {(error as { detail?: { message?: string } }).detail?.message ?? (error as Error).message}
        </p>
      )}
    </div>
  )
}

// A linked task's own editable bit here is just its sub-list group (its title and how-to belong
// to the master task and are edited on that task's own record).
function LinkEditor({
  checklistId, item, onDone,
}: { checklistId: number; item: ChecklistItem; onDone: () => void }) {
  const [group, setGroup] = useState(item.checklist_group ?? '')
  const { data: existingGroups } = useChecklistGroups(checklistId)
  const updateRef = useUpdateTaskReference()

  return (
    <div className="step-editor">
      <p className="step-editor-hint">
        <strong><RecordLink to={{ kind: 'task', id: item.task_id }}>{item.task_name}</RecordLink></strong> is a linked task - its title and how-to are edited on the task itself.
      </p>
      <label>
        Sub-list group in this checklist (optional)
        <GroupPicker
          value={group || null}
          options={existingGroups ?? []}
          onChange={(g) => setGroup(g ?? '')}
          noneLabel="— no grouping —"
          newLabel="＋ New group…"
          newPlaceholder="e.g. Engine room"
        />
      </label>
      <div className="step-editor-actions">
        <button
          type="button" disabled={updateRef.isPending}
          onClick={() => updateRef.mutate(
            { refId: item.ref_id!, fields: { checklist_group: group.trim() || null } },
            { onSuccess: onDone },
          )}
        >
          {updateRef.isPending ? 'Saving…' : '💾 Save group'}
        </button>
        <button type="button" onClick={onDone}>Cancel</button>
      </div>
    </div>
  )
}

function StepEditor({
  checklistId, step, onDone,
}: { checklistId: number; step: ChecklistItem; onDone: () => void }) {
  const [title, setTitle] = useState(step.task_name)
  const [detail, setDetail] = useState(step.caution_notes || step.task_description || '')
  const [group, setGroup] = useState(step.checklist_group ?? '')
  const { data: existingGroups } = useChecklistGroups(checklistId)
  const updateTask = useUpdateTask()

  const save = () => {
    updateTask.mutate(
      {
        taskId: step.task_id,
        fields: {
          task_name: title.trim() || step.task_name,
          caution_notes: detail.trim() || undefined,
          checklist_group: group.trim() || null,
        },
      },
      { onSuccess: onDone },
    )
  }

  return (
    <div className="step-editor">
      <label>
        Step title
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        How to do it - enough for someone who hasn't done this before
        <textarea rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} />
      </label>
      <label>
        Sub-list group (optional)
        <GroupPicker
          value={group || null}
          options={existingGroups ?? []}
          onChange={(g) => setGroup(g ?? '')}
          noneLabel="— no grouping —"
          newLabel="＋ New group…"
          newPlaceholder="e.g. Engine room"
        />
      </label>
      <div className="step-editor-actions">
        <button type="button" onClick={save} disabled={updateTask.isPending}>
          {updateTask.isPending ? 'Saving…' : '💾 Save step'}
        </button>
        <button type="button" onClick={onDone}>Cancel</button>
      </div>
    </div>
  )
}
